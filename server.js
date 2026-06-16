/* ============================================================================
   RUNECHAIN - authoritative realm server (MMO relay)
   Zero dependencies. Pure Node: serves the client over HTTP and runs a
   hand-rolled WebSocket server on the SAME port (8080).

       node server.js
       open http://localhost:8080  (in two+ browser tabs / machines)

   It relays player transforms and accepts only server-validated Chainwell blocks
   so every connected Recorded shares one world and one ledger.
   ========================================================================== */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const sha256 = require('./game/sha256.js');
const {
  DEFAULT_DIFFICULTY,
  createGenesisBlock,
  hashBlock,
  validateBlockCandidate,
  validateChain,
} = require('./game/chain.js');
const { ECON, ENEMY_REWARDS, STORY } = require('./game/content.js');

const DEFAULT_PORT = process.env.PORT || 8080;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'; // WebSocket magic string

function createRealmServer(options = {}) {
  const port = options.port == null ? DEFAULT_PORT : options.port;
  const ledgerFile = options.ledgerFile || path.join(__dirname, 'ledger.json');
  const difficulty = options.difficulty == null ? DEFAULT_DIFFICULTY : options.difficulty;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const saveDelayMs = options.saveDelayMs == null ? 800 : options.saveDelayMs;
  const futureSkewMs = options.futureSkewMs;
  const miningTtlMs = options.miningTtlMs == null ? 30000 : options.miningTtlMs;
  const quiet = !!options.quiet;
  const clients = new Set();
  const pendingMining = new Map();
  const runeCreditSinks = new Set(['POWER_SINK', ECON.EXCHANGE_ADDR]);
  let saveTimer = null;
  let masterChain = loadLedger();

  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('ok');
    }

    const route = req.url.split('?')[0];
    const file = route === '/' ? '/index.html' : route;
    const full = path.join(__dirname, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
    fs.readFile(full, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('not found');
      }
      const ext = path.extname(full);
      const type = ext === '.html' ? 'text/html'
                 : ext === '.js' ? 'text/javascript'
                 : ext === '.png' ? 'image/png'
                 : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    });
  });

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    const client = { socket, id: null, name: 'Recorded', last: {} };
    addClient(client);

    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      let frame;
      while ((frame = decodeFrame(buffer))) {
        buffer = frame.rest;
        if (frame.opcode === 0x8) {
          socket.end();
          return;
        }
        if (frame.opcode === 0x9) {
          socket.write(encodeFrame(frame.payload, 0xA));
          continue;
        }
        if (frame.opcode === 0x1 && frame.payload != null) handleMessage(client, frame.payload.toString('utf8'));
      }
    });
    socket.on('close', () => dropClient(client));
    socket.on('error', () => dropClient(client));
  });

  function log(...args) {
    if (!quiet) console.log(...args);
  }

  function addClient(client) {
    clients.add(client);
    return client;
  }

  function dropClient(client) {
    if (!clients.has(client)) return;
    clients.delete(client);
    if (client.id) broadcast({ t: 'leave', id: client.id }, client);
    log(`* ${client.name} left the realm  (${clients.size} online)`);
  }

  function handleMessage(client, raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch (_) {
      return { ok: false, error: { code: 'invalid_message_json', message: 'Message must be valid JSON.' } };
    }
    return handleParsedMessage(client, message);
  }

  function handleParsedMessage(client, message) {
    switch (message && message.t) {
      case 'join':
        client.id = message.id;
        client.name = (message.name || 'Recorded').slice(0, 14);
        log(`* ${client.name} entered the realm  (${clients.size} online)`);
        send(client, { t: 'chain', chain: masterChain });
        return { ok: true };
      case 'state':
        client.last = message;
        broadcast(message, client);
        return { ok: true };
      case 'block': {
        const result = acceptBlock(message.block);
        if (result.ok) {
          broadcast({ t: 'block', block: result.block }, client);
          return result;
        }
        send(client, { t: 'block:error', error: result.error, chain: masterChain });
        return result;
      }
      case 'mine:reward':
        return issueRewardMiningWork(client, message.source);
      case 'mine:submit':
        return acceptMinedWork(client, message.candidateId, message.block);
      default:
        return { ok: false, error: { code: 'unknown_message_type', message: 'Unknown message type.' } };
    }
  }

  function loadLedger() {
    try {
      const data = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
      const result = validateChain(data, { sha256, difficulty });
      if (result.ok) {
        log(`chain ledger restored from disk - ${data.length} block(s)`);
        return data;
      }
      log(`ledger rejected on load: ${result.error.code}`);
    } catch (_) {
      // No persisted ledger yet; start a fresh realm.
    }
    return [createGenesisBlock(sha256)];
  }

  function saveLedger() {
    if (saveDelayMs <= 0) {
      fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
      fs.writeFileSync(ledgerFile, JSON.stringify(masterChain));
      return;
    }
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
      fs.writeFile(ledgerFile, JSON.stringify(masterChain), (err) => {
        if (err) console.error('ledger save failed:', err.message);
      });
    }, saveDelayMs);
  }

  function acceptBlock(block) {
    const tip = masterChain[masterChain.length - 1];
    const result = validateBlockCandidate(block, tip, { sha256, difficulty, now, futureSkewMs });
    if (!result.ok) return result;
    const auth = validateSubmittedTransactions(block);
    if (!auth.ok) return auth;

    return appendBlock(block);
  }

  function appendBlock(block) {
    masterChain.push(block);
    log(`chain block #${block.index} accepted - ${block.txs ? block.txs.length : 0} tx`);
    saveLedger();
    return { ok: true, block };
  }

  function issueRewardMiningWork(client, source) {
    cleanupMiningCandidates();
    const pendingCandidate = findPendingCandidateForClient(client.id);
    if (pendingCandidate) {
      const result = blockError('mining_candidate_pending', 'Finish the current server-issued mining candidate before requesting another.');
      send(client, { t: 'mine:error', error: result.error });
      return result;
    }

    const reward = resolveRewardSource(source);
    if (!reward.ok) {
      send(client, { t: 'mine:error', error: reward.error });
      return reward;
    }

    const candidateId = 'srv-' + crypto.randomBytes(8).toString('hex');
    const tx = {
      to: client.name || 'Recorded',
      amt: reward.amt,
      note: reward.note,
      cur: 'RUNE',
      id: candidateId,
      auth: { type: 'server-reward', source: reward.sourceKey },
    };
    const tip = masterChain[masterChain.length - 1];
    const block = {
      index: tip.index + 1,
      prev: tip.hash,
      time: now(),
      txs: [tx],
      nonce: 0,
    };
    block.hash = hashBlock(block, sha256);

    const work = { candidateId, difficulty, block };
    pendingMining.set(candidateId, {
      clientId: client.id,
      block,
      createdAt: now(),
    });
    send(client, { t: 'mine:work', work });
    return { ok: true, work };
  }

  function acceptMinedWork(client, candidateId, block) {
    cleanupMiningCandidates();
    const candidate = pendingMining.get(candidateId);
    if (!candidate || candidate.clientId !== client.id) {
      const result = blockError('unknown_mining_candidate', 'Mining candidate is unknown or no longer valid.');
      send(client, { t: 'mine:error', error: result.error, chain: masterChain });
      return result;
    }

    if (!matchesMiningCandidate(candidate.block, block)) {
      const result = blockError('invalid_mining_candidate', 'Submitted block does not match the server-issued mining candidate.');
      send(client, { t: 'mine:error', error: result.error, chain: masterChain });
      return result;
    }

    const tip = masterChain[masterChain.length - 1];
    const result = validateBlockCandidate(block, tip, { sha256, difficulty, now, futureSkewMs });
    if (!result.ok) {
      if (isStaleCandidateError(result.error.code)) pendingMining.delete(candidateId);
      send(client, { t: 'mine:error', error: result.error, chain: masterChain });
      return result;
    }

    pendingMining.delete(candidateId);
    const accepted = appendBlock(block);
    send(client, { t: 'mine:accepted', block });
    broadcast({ t: 'block', block }, client);
    return accepted;
  }

  function validateSubmittedTransactions(block) {
    for (const tx of block.txs || []) {
      if (isUnauthorizedRuneCredit(tx)) {
        return blockError('unauthorized_rune_credit', 'RUNE credits must be mined from server-issued reward work.');
      }
    }
    return { ok: true };
  }

  function isUnauthorizedRuneCredit(tx) {
    if (!tx || (tx.cur || 'RUNE') !== 'RUNE' || !tx.to || !(Number(tx.amt) > 0)) return false;
    return !runeCreditSinks.has(tx.to);
  }

  function findPendingCandidateForClient(clientId) {
    for (const [candidateId, candidate] of pendingMining) {
      if (candidate.clientId === clientId) return { candidateId, candidate };
    }
    return null;
  }

  function cleanupMiningCandidates() {
    const cutoff = now() - miningTtlMs;
    for (const [candidateId, candidate] of pendingMining) {
      if (candidate.createdAt < cutoff) pendingMining.delete(candidateId);
    }
  }

  function isStaleCandidateError(code) {
    return code === 'invalid_block_index' || code === 'invalid_block_parent' || code === 'invalid_block_time';
  }

  function matchesMiningCandidate(candidateBlock, submittedBlock) {
    if (!submittedBlock || typeof submittedBlock !== 'object') return false;
    return submittedBlock.index === candidateBlock.index &&
      submittedBlock.prev === candidateBlock.prev &&
      submittedBlock.time === candidateBlock.time &&
      JSON.stringify(submittedBlock.txs) === JSON.stringify(candidateBlock.txs);
  }

  function resolveRewardSource(source) {
    if (!source || typeof source !== 'object') return blockError('invalid_reward_source', 'Reward source is required.');
    if (source.type === 'enemy') {
      const enemy = ENEMY_REWARDS[source.key];
      if (!enemy) return blockError('invalid_reward_source', 'Unknown enemy reward source.');
      return {
        ok: true,
        amt: enemy.rune,
        note: enemy.name + ' slain',
        sourceKey: 'enemy:' + source.key,
      };
    }
    if (source.type === 'story') {
      const quest = (STORY.quests || []).find(q => q.id === source.questId);
      const rune = quest && quest.rewards && quest.rewards.rune;
      if (!quest || !rune) return blockError('invalid_reward_source', 'Unknown story reward source.');
      return {
        ok: true,
        amt: rune,
        note: 'story: ' + quest.title,
        sourceKey: 'story:' + quest.id,
      };
    }
    return blockError('invalid_reward_source', 'Unsupported reward source type.');
  }

  function blockError(code, message) {
    return { ok: false, error: { code, message } };
  }

  function broadcast(obj, except) {
    const data = encodeFrame(Buffer.from(JSON.stringify(obj)), 0x1);
    for (const client of clients) {
      if (client !== except && client.socket.writable) client.socket.write(data);
    }
  }

  function send(client, obj) {
    if (client.socket.writable) client.socket.write(encodeFrame(Buffer.from(JSON.stringify(obj)), 0x1));
  }

  function listen(callback) {
    server.listen(port, () => {
      log('');
      log('  RUNECHAIN realm server is live');
      log(`  -> http://localhost:${port}`);
      log('  Open in 2+ tabs to see real multiplayer');
      log('');
      if (callback) callback();
    });
    return server;
  }

  function close(callback) {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (server.listening) server.close(callback);
    else if (callback) callback();
  }

  function getChain() {
    return masterChain.map((block) => ({ ...block, txs: (block.txs || []).map((tx) => ({ ...tx })) }));
  }

  return {
    server,
    clients,
    addClient,
    dropClient,
    handleMessage,
    handleParsedMessage,
    acceptBlock,
    getChain,
    listen,
    close,
  };
}

function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const fin = buf[0] & 0x80;
  const opcode = buf[0] & 0x0f;
  const masked = buf[1] & 0x80;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }
  let mask;
  if (masked) {
    if (buf.length < offset + 4) return null;
    mask = buf.slice(offset, offset + 4);
    offset += 4;
  }
  if (buf.length < offset + len) return null;
  let payload = buf.slice(offset, offset + len);
  if (masked) {
    const out = Buffer.alloc(len);
    for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i % 4];
    payload = out;
  }
  return { fin, opcode, payload, rest: buf.slice(offset + len) };
}

function encodeFrame(payload, opcode = 0x1) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

if (require.main === module) {
  createRealmServer().listen();
}

module.exports = {
  createRealmServer,
  decodeFrame,
  encodeFrame,
};
