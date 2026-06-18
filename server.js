/* ============================================================================
   RUNECHAIN - authoritative realm server (MMO relay)
   Zero dependencies. Pure Node: serves the client over HTTP and runs a
   hand-rolled WebSocket server on the SAME port (8080).

       node server.js
       open http://localhost:8080  (in two+ browser tabs / machines)

   It relays player transforms and accepts only server-issued Chainwell reward work
   so every connected Recorded shares one world and one ledger.
   ========================================================================== */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sha256 = require('./game/sha256.js');
const {
  DEFAULT_DIFFICULTY,
  createGenesisBlock,
  hashBlock,
  validateBlockCandidate,
  validateChain,
} = require('./game/chain.js');
const { ENEMY_REWARDS, STORY, RELICS, LEVELING } = require('./game/content.js');

const DEFAULT_PORT = process.env.PORT || 8080;
const DEFAULT_PREVIEW_PLAY_URL = 'https://play.runechaingame.com';
const DEFAULT_SEASON_ID = 'preseason-1';
const ACCOUNT_CREDENTIAL_TYPE = 'browser-p256-v1';
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'; // WebSocket magic string
const GAME_OPEN = process.env.GAME_OPEN === '1' || process.env.GAME_OPEN === 'true';

function createRealmServer(options = {}) {
  const port = options.port == null ? DEFAULT_PORT : options.port;
  const ledgerFile = options.ledgerFile || path.join(__dirname, 'ledger.json');
  const accountsFile = options.accountsFile || path.join(__dirname, 'accounts.json');
  const mailingListFile = options.mailingListFile || process.env.RUNECHAIN_WAITLIST_CSV ||
    path.join(process.env.VERCEL ? os.tmpdir() : __dirname, 'runechain-waitlist.csv');
  const waitlistExportToken = options.waitlistExportToken || process.env.WAITLIST_EXPORT_TOKEN || '';
  const previewPlayUrl = options.previewPlayUrl || process.env.RUNECHAIN_PREVIEW_URL || DEFAULT_PREVIEW_PLAY_URL;
  const seasonId = options.seasonId || DEFAULT_SEASON_ID;
  const difficulty = options.difficulty == null ? DEFAULT_DIFFICULTY : options.difficulty;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const saveDelayMs = options.saveDelayMs == null ? 800 : options.saveDelayMs;
  const futureSkewMs = options.futureSkewMs;
  const miningTtlMs = options.miningTtlMs == null ? 30000 : options.miningTtlMs;
  const quiet = !!options.quiet;
  const clients = new Set();
  const pendingMining = new Map();
  const accountRegistry = options.accountRegistry || createAccountRegistry({ accountsFile, seasonId, now });
  let saveTimer = null;
  let masterChain = loadLedger();
  let peerNonce = 0;

  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const route = requestUrl.pathname;

    if (route === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('ok');
    }

    if (route === '/api/waitlist') {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
      return handleWaitlistSignup(req, res);
    }

    if (route === '/api/waitlist.csv') {
      if (req.method !== 'GET') return sendText(res, 405, 'method not allowed');
      return handleWaitlistExport(requestUrl, res);
    }

    if (route === '/preview-play') {
      res.writeHead(302, { Location: previewPlayUrl, 'Cache-Control': 'no-store' });
      return res.end();
    }

    // GAME_OPEN (set on the AWS game host) serves the playable client at / and /play;
    // unset (Vercel/marketing) keeps the coming-soon gate.
    const file = GAME_OPEN
      ? (route === '/' || route === '/play' ? '/index.html' : route)
      : (route === '/' ? '/landing.html'
         : route === '/play' || route === '/index.html' ? '/coming-soon.html'
         : route);
    const normalized = path.normalize(file).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
    const full = path.join(__dirname, normalized);
    if (!full.startsWith(__dirname)) {
      res.writeHead(404);
      return res.end('not found');
    }
    fs.readFile(full, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('not found');
      }
      const ext = path.extname(full);
      const type = ext === '.html' ? 'text/html'
                 : ext === '.js' ? 'text/javascript'
                 : ext === '.json' ? 'application/json'
                 : ext === '.png' ? 'image/png'
                 : ext === '.svg' ? 'image/svg+xml'
                 : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    });
  });

  function handleWaitlistSignup(req, res) {
    readRequestBody(req, 65536, (err, raw) => {
      if (err) return sendJson(res, 413, { ok: false, error: 'request_too_large' });

      const parsed = parseSignupBody(req, raw);
      if (!parsed.ok) return respondSignup(req, res, 400, { ok: false, error: parsed.error });

      const signup = normalizeSignup(parsed.body, req);
      if (!signup.ok) return respondSignup(req, res, 400, { ok: false, error: signup.error });

      try {
        appendWaitlistCsv(signup.row);
      } catch (writeErr) {
        log('waitlist write failed:', writeErr.message);
        return respondSignup(req, res, 500, { ok: false, error: 'waitlist_unavailable' });
      }

      return respondSignup(req, res, 201, { ok: true });
    });
  }

  function handleWaitlistExport(requestUrl, res) {
    if (!waitlistExportToken || requestUrl.searchParams.get('token') !== waitlistExportToken) {
      return sendText(res, 403, 'forbidden');
    }

    let csv = waitlistCsvHeader();
    try {
      if (fs.existsSync(mailingListFile)) csv = fs.readFileSync(mailingListFile, 'utf8');
    } catch (err) {
      log('waitlist export failed:', err.message);
      return sendText(res, 500, 'waitlist unavailable');
    }

    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="runechain-waitlist.csv"',
      'Cache-Control': 'no-store',
    });
    res.end(csv);
  }

  function respondSignup(req, res, status, payload) {
    if (isFormPost(req)) {
      if (status >= 200 && status < 300) {
        res.writeHead(303, { Location: '/?joined=1#join' });
        return res.end();
      }
      res.writeHead(303, { Location: '/?joined=0#join' });
      return res.end();
    }
    return sendJson(res, status, payload);
  }

  function appendWaitlistCsv(row) {
    fs.mkdirSync(path.dirname(mailingListFile), { recursive: true });
    if (!fs.existsSync(mailingListFile)) fs.writeFileSync(mailingListFile, waitlistCsvHeader());
    fs.appendFileSync(mailingListFile, row.map(csvCell).join(',') + '\n');
  }

  function waitlistCsvHeader() {
    return 'created_at,email,source,name,note,ip_hash\n';
  }

  function normalizeSignup(body, req) {
    const email = sanitizeText(body.email, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return blockError('invalid_email', 'Enter a valid email address.');
    return {
      ok: true,
      row: [
        new Date().toISOString(),
        email,
        sanitizeText(body.source || 'runechain-lander', 80),
        sanitizeText(body.name, 80),
        sanitizeText(body.note, 180),
        hashIp(req),
      ],
    };
  }

  function parseSignupBody(req, raw) {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type === 'application/json') {
      try {
        return { ok: true, body: JSON.parse(raw || '{}') };
      } catch (_) {
        return blockError('invalid_json', 'Signup payload must be valid JSON.');
      }
    }
    if (type === 'application/x-www-form-urlencoded' || !type) {
      return { ok: true, body: Object.fromEntries(new URLSearchParams(raw)) };
    }
    return blockError('unsupported_content_type', 'Signup content type is not supported.');
  }

  function isFormPost(req) {
    return String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded');
  }

  function readRequestBody(req, maxBytes, callback) {
    let raw = '';
    let received = 0;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      received += Buffer.byteLength(chunk);
      if (received > maxBytes) {
        req.destroy();
        callback(new Error('request_too_large'));
        return;
      }
      raw += chunk;
    });
    req.on('end', () => callback(null, raw));
    req.on('error', callback);
  }

  function csvCell(value) {
    const text = String(value == null ? '' : value);
    return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function hashIp(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const raw = forwarded || req.socket.remoteAddress || '';
    if (!raw) return '';
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  }

  function sendJson(res, status, payload) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(payload));
  }

  function sendText(res, status, body) {
    res.writeHead(status, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  }

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

    const client = { socket, id: null, name: 'Recorded', accountId: null, character: null, last: {} };
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
      case 'account:challenge':
        return issueAccountChallenge(client, message.credential);
      case 'join':
        return joinClient(client, message);
      case 'state': {
        const account = requireAccount(client);
        if (!account.ok) return account;
        const state = canonicalStateMessage(client, message);
        client.last = state;
        broadcast(state, client);
        return { ok: true };
      }
      case 'block': {
        const account = requireAccount(client);
        if (!account.ok) return account;
        const result = acceptBlock(message.block);
        send(client, { t: 'block:error', error: result.error, chain: masterChain });
        return result;
      }
      case 'mine:reward': {
        const account = requireAccount(client);
        if (!account.ok) return account;
        return issueRewardMiningWork(client, message.source);
      }
      case 'spend:request': {
        const account = requireAccount(client);
        if (!account.ok) return account;
        return issueSpendMiningWork(client, message.source);
      }
      case 'mine:submit': {
        const account = requireAccount(client);
        if (!account.ok) return account;
        return acceptMinedWork(client, message.candidateId, message.block);
      }
      default:
        return { ok: false, error: { code: 'unknown_message_type', message: 'Unknown message type.' } };
    }
  }

  function issueAccountChallenge(client, credential) {
    const result = accountRegistry.createChallenge(credential);
    if (!result.ok) {
      send(client, { t: 'join:error', error: result.error });
      return result;
    }
    send(client, { t: 'account:challenge', ...result.challenge });
    return result;
  }

  function joinClient(client, message) {
    const name = sanitizeDisplayName(message.name);
    const result = accountRegistry.verifyJoin(message.credential, name);
    if (!result.ok) {
      send(client, { t: 'join:error', error: result.error });
      return result;
    }

    client.id = createPeerId();
    client.name = name;
    client.accountId = result.accountId;
    client.character = result.character;
    log(`* ${client.name} entered the realm  (${clients.size} online)`);
    send(client, {
      t: 'account',
      accountId: result.accountId,
      peerId: client.id,
      seasonId: result.seasonId,
      character: result.character,
      createdAccount: result.createdAccount,
      createdCharacter: result.createdCharacter,
    });
    send(client, { t: 'chain', chain: masterChain });
    return result;
  }

  function requireAccount(client) {
    if (client.accountId && client.character) return { ok: true };
    const result = blockError('account_required', 'Join with a verified game account before sending realm messages.');
    send(client, { t: 'join:error', error: result.error });
    return result;
  }

  function canonicalStateMessage(client, message) {
    return {
      t: 'state',
      id: client.id,
      characterId: client.character.id,
      name: client.name,
      skin: sanitizeText(message.skin || 'tarnished', 32),
      x: finiteNumber(message.x),
      y: finiteNumber(message.y),
      z: finiteNumber(message.z),
      yaw: finiteNumber(message.yaw),
      moving: !!message.moving,
    };
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

  function acceptBlock() {
    return blockError('client_block_submission_disabled', 'Connected realms only accept server-issued mining work.');
  }

  function appendBlock(block) {
    masterChain.push(block);
    log(`chain block #${block.index} accepted - ${block.txs ? block.txs.length : 0} tx`);
    saveLedger();
    return { ok: true, block };
  }

  function issueRewardMiningWork(client, source) {
    const reward = resolveRewardSource(source);
    if (!reward.ok) {
      send(client, { t: 'mine:error', error: reward.error });
      return reward;
    }
    return issueMiningCandidate(client, (candidateId) => ({
      to: client.character.address,
      amt: reward.amt,
      note: reward.note,
      cur: 'RUNE',
      id: candidateId,
      auth: {
        type: 'server-reward',
        source: reward.sourceKey,
        accountId: client.accountId,
        characterId: client.character.id,
        seasonId,
      },
    }));
  }

  function issueSpendMiningWork(client, source) {
    const address = client.character.address;
    const spend = resolveSpendSource(source, address);
    if (!spend.ok) {
      send(client, { t: 'mine:error', error: spend.error });
      return spend;
    }
    // Authoritative balance check. Only one candidate can be pending per character
    // (enforced below), so a confirmed-ledger balance check here has no double-spend window.
    if (runeBalanceOf(address) < spend.amt) {
      const result = blockError('insufficient_rune', 'Not enough RUNE on the Chainwell ledger for this purchase.');
      send(client, { t: 'mine:error', error: result.error });
      return result;
    }
    return issueMiningCandidate(client, (candidateId) => ({
      from: address,
      to: 'POWER_SINK',
      amt: spend.amt,
      note: spend.note,
      cur: 'RUNE',
      id: candidateId,
      auth: {
        type: 'server-spend',
        source: spend.sourceKey,
        effect: spend.effect,
        accountId: client.accountId,
        characterId: client.character.id,
        seasonId,
      },
    }));
  }

  // Build a server-issued mining candidate from a tx and hand the PoW work to the client.
  function issueMiningCandidate(client, buildTx) {
    cleanupMiningCandidates();
    const pendingCandidate = findPendingCandidateForCharacter(client.character.id);
    if (pendingCandidate) {
      const result = blockError('mining_candidate_pending', 'Finish the current server-issued mining candidate before requesting another.');
      send(client, { t: 'mine:error', error: result.error });
      return result;
    }

    const candidateId = 'srv-' + crypto.randomBytes(8).toString('hex');
    const tx = buildTx(candidateId);
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
      accountId: client.accountId,
      characterId: client.character.id,
      block,
      createdAt: now(),
    });
    send(client, { t: 'mine:work', work });
    return { ok: true, work };
  }

  // Authoritative RUNE balance for an address, summed from accepted ledger blocks only.
  function runeBalanceOf(address) {
    let bal = 0;
    for (const block of masterChain) {
      for (const tx of block.txs || []) {
        if ((tx.cur || 'RUNE') !== 'RUNE') continue;
        if (tx.to === address) bal += tx.amt || 0;
        if (tx.from === address) bal -= tx.amt || 0;
      }
    }
    return bal;
  }

  // A stat's level is the count of accepted level-up spends for that address, read from the ledger.
  function statLevelOf(address, stat) {
    let level = 0;
    for (const block of masterChain) {
      for (const tx of block.txs || []) {
        const auth = tx.auth;
        if (tx.from === address && auth && auth.type === 'server-spend' &&
            auth.effect && auth.effect.kind === 'level' && auth.effect.stat === stat) {
          level += 1;
        }
      }
    }
    return level;
  }

  function ownsRelic(address, relicId) {
    for (const block of masterChain) {
      for (const tx of block.txs || []) {
        const auth = tx.auth;
        if (tx.from === address && auth && auth.type === 'server-spend' &&
            auth.effect && auth.effect.kind === 'relic' && auth.effect.relicId === relicId) {
          return true;
        }
      }
    }
    return false;
  }

  function acceptMinedWork(client, candidateId, block) {
    cleanupMiningCandidates();
    const candidate = pendingMining.get(candidateId);
    if (!candidate || candidate.characterId !== client.character.id) {
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

  function findPendingCandidateForCharacter(characterId) {
    for (const [candidateId, candidate] of pendingMining) {
      if (candidate.characterId === characterId) return { candidateId, candidate };
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

  function resolveSpendSource(source, address) {
    if (!source || typeof source !== 'object') return blockError('invalid_spend_source', 'Spend source is required.');
    if (source.type === 'level') {
      const def = LEVELING.stats[source.stat];
      if (!def) return blockError('invalid_spend_source', 'Unknown stat to level.');
      const level = statLevelOf(address, source.stat);
      if (level >= LEVELING.maxLevel) return blockError('stat_maxed', def.name + ' is already at the maximum level.');
      return {
        ok: true,
        amt: LEVELING.costFor(level),
        note: 'Hearthlight: ' + def.name + ' ' + (level + 1),
        sourceKey: 'level:' + source.stat,
        effect: { kind: 'level', stat: source.stat, level: level + 1 },
      };
    }
    if (source.type === 'relic') {
      const relic = RELICS.find(r => r.id === source.relicId);
      if (!relic) return blockError('invalid_spend_source', 'Unknown relic to forge.');
      if (ownsRelic(address, source.relicId)) return blockError('relic_owned', 'That relic is already forged.');
      return {
        ok: true,
        amt: relic.price,
        note: 'Hearthlight: forge ' + relic.name,
        sourceKey: 'relic:' + relic.id,
        effect: { kind: 'relic', relicId: relic.id },
      };
    }
    return blockError('invalid_spend_source', 'Unsupported spend source type.');
  }

  function sanitizeDisplayName(value) {
    return sanitizeText(value || 'Recorded', 14) || 'Recorded';
  }

  function createPeerId() {
    let id;
    do {
      peerNonce += 1;
      id = 'peer_' + peerNonce.toString(36);
    } while ([...clients].some((client) => client.id === id));
    return id;
  }

  function sanitizeText(value, max) {
    return String(value == null ? '' : value).trim().slice(0, max);
  }

  function finiteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function blockError(code, message) {
    return { ok: false, error: { code, message } };
  }

  function broadcast(obj, except) {
    const data = encodeFrame(Buffer.from(JSON.stringify(obj)), 0x1);
    for (const client of clients) {
      if (client !== except && client.accountId && client.socket.writable) client.socket.write(data);
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

function createAccountRegistry(options = {}) {
  const accountsFile = options.accountsFile || path.join(__dirname, 'accounts.json');
  const seasonId = options.seasonId || DEFAULT_SEASON_ID;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const challengeTtlMs = options.challengeTtlMs == null ? 60000 : options.challengeTtlMs;
  const pendingChallenges = new Map();
  let registry = loadRegistry();

  function createChallenge(credential) {
    const parsed = parseCredentialPublicKey(credential);
    if (!parsed.ok) return parsed;

    cleanupChallenges();
    const accountId = accountIdForPublicKey(parsed.publicKey);
    const challengeId = 'chal_' + crypto.randomBytes(12).toString('hex');
    const issuedAt = now();
    const message = [
      'runechain-auth-v1',
      'type=' + ACCOUNT_CREDENTIAL_TYPE,
      'season=' + seasonId,
      'account=' + accountId,
      'challenge=' + challengeId,
      'issued=' + issuedAt,
    ].join('\n');

    pendingChallenges.set(challengeId, {
      accountId,
      publicKey: parsed.publicKey,
      message,
      issuedAt,
    });

    return {
      ok: true,
      challenge: {
        credentialType: ACCOUNT_CREDENTIAL_TYPE,
        challengeId,
        accountId,
        seasonId,
        message,
      },
    };
  }

  function verifyJoin(credential, displayName) {
    const parsed = parseCredentialPublicKey(credential);
    if (!parsed.ok) return parsed;
    if (!credential || typeof credential.challengeId !== 'string') {
      return accountError('invalid_account_challenge', 'Account challenge is missing or invalid.');
    }

    cleanupChallenges();
    const accountId = accountIdForPublicKey(parsed.publicKey);
    const challenge = pendingChallenges.get(credential.challengeId);
    if (!challenge || challenge.accountId !== accountId || !samePublicKey(challenge.publicKey, parsed.publicKey)) {
      return accountError('invalid_account_challenge', 'Account challenge is unknown, expired, or already used.');
    }

    if (!verifyP256Signature(parsed.publicKey, challenge.message, credential.signature)) {
      return accountError('invalid_account_signature', 'Account signature does not verify.');
    }

    pendingChallenges.delete(credential.challengeId);
    const binding = bindAccount(accountId, parsed.publicKey, displayName);
    return {
      ok: true,
      accountId,
      seasonId,
      character: clone(binding.character),
      createdAccount: binding.createdAccount,
      createdCharacter: binding.createdCharacter,
    };
  }

  function bindAccount(accountId, publicKey, displayName) {
    const ts = now();
    let account = registry.accounts[accountId];
    let createdAccount = false;
    if (!account) {
      account = {
        id: accountId,
        credentialType: ACCOUNT_CREDENTIAL_TYPE,
        publicKey: clone(publicKey),
        createdAt: ts,
        lastSeenAt: ts,
        characters: {},
      };
      registry.accounts[accountId] = account;
      createdAccount = true;
    }

    account.lastSeenAt = ts;
    account.publicKey = clone(publicKey);

    let character = account.characters[seasonId];
    let createdCharacter = false;
    if (!character) {
      const id = characterIdForAccountSeason(accountId, seasonId);
      character = {
        id,
        seasonId,
        name: displayName,
        address: id,
        createdAt: ts,
        lastSeenAt: ts,
      };
      account.characters[seasonId] = character;
      createdCharacter = true;
    } else {
      character.name = displayName;
      character.lastSeenAt = ts;
    }

    saveRegistry();
    return { account, character, createdAccount, createdCharacter };
  }

  function cleanupChallenges() {
    const cutoff = now() - challengeTtlMs;
    for (const [challengeId, challenge] of pendingChallenges) {
      if (challenge.issuedAt < cutoff) pendingChallenges.delete(challengeId);
    }
  }

  function loadRegistry() {
    if (!fs.existsSync(accountsFile)) return { version: 1, accounts: {} };
    const data = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
    if (!data || data.version !== 1 || !data.accounts || typeof data.accounts !== 'object' || Array.isArray(data.accounts)) {
      throw new Error('Account registry is malformed.');
    }
    return data;
  }

  function saveRegistry() {
    fs.mkdirSync(path.dirname(accountsFile), { recursive: true });
    const tempFile = accountsFile + '.tmp-' + process.pid + '-' + Date.now();
    fs.writeFileSync(tempFile, JSON.stringify(registry, null, 2));
    fs.renameSync(tempFile, accountsFile);
  }

  function getState() {
    return clone(registry);
  }

  return {
    createChallenge,
    verifyJoin,
    getState,
    accountIdForPublicKey,
  };
}

function parseCredentialPublicKey(credential) {
  if (!credential || credential.type !== ACCOUNT_CREDENTIAL_TYPE) {
    return accountError('invalid_account_credential', 'Account credential type is missing or unsupported.');
  }
  const key = credential.publicKey;
  if (!key || key.kty !== 'EC' || key.crv !== 'P-256' || typeof key.x !== 'string' || typeof key.y !== 'string') {
    return accountError('invalid_account_credential', 'Account credential public key must be a P-256 JWK.');
  }
  return {
    ok: true,
    publicKey: {
      kty: 'EC',
      crv: 'P-256',
      x: key.x,
      y: key.y,
    },
  };
}

function accountIdForPublicKey(publicKey) {
  return 'acct_' + crypto.createHash('sha256').update(canonicalPublicKey(publicKey)).digest('hex').slice(0, 24);
}

function characterIdForAccountSeason(accountId, seasonId) {
  return 'char_' + crypto.createHash('sha256').update(accountId + '|' + seasonId).digest('hex').slice(0, 24);
}

function canonicalPublicKey(publicKey) {
  return JSON.stringify({ crv: publicKey.crv, kty: publicKey.kty, x: publicKey.x, y: publicKey.y });
}

function samePublicKey(a, b) {
  return !!a && !!b && canonicalPublicKey(a) === canonicalPublicKey(b);
}

function verifyP256Signature(publicKey, message, signature) {
  try {
    const sig = base64urlDecode(signature);
    if (!sig.length) return false;
    const key = crypto.createPublicKey({ key: publicKey, format: 'jwk' });
    return crypto.verify('sha256', Buffer.from(message), {
      key,
      dsaEncoding: sig.length === 64 ? 'ieee-p1363' : 'der',
    }, sig);
  } catch (_) {
    return false;
  }
}

function base64urlDecode(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return Buffer.alloc(0);
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return Buffer.from(padded, 'base64');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function accountError(code, message) {
  return { ok: false, error: { code, message } };
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
  createAccountRegistry,
  decodeFrame,
  encodeFrame,
};
