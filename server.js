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
const path = require('path');

const sha256 = require('./game/sha256.js');
const {
  DEFAULT_DIFFICULTY,
  createGenesisBlock,
  hashBlock,
  validateBlockCandidate,
  validateChain,
} = require('./game/chain.js');
const { ENEMY_REWARDS, STORY, RELICS, LEVELING, BOSS_SIGILS } = require('./game/content.js');

const DEFAULT_PORT = process.env.PORT || 8080;
const DEFAULT_SEASON_ID = 'preseason-1';
const ACCOUNT_CREDENTIAL_TYPE = 'browser-p256-v1';
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'; // WebSocket magic string
const AUTHORITY_TIERS = Object.freeze({
  authoritative: Object.freeze([
    'economy-state',
    'rune-credit-debit',
    'leveling',
    'death',
    'character-season-state',
    'pvp-outcome',
  ]),
  validated: Object.freeze([
    'solo-segment-outcome',
  ]),
  nonAuthoritative: Object.freeze([
    'movement-relay',
  ]),
});
const SERVER_ARBITRATED_MESSAGE_TYPES = new Set([
  'rc:pvp:hit',
  'rc:pvp:forfeit',
  'rc:pvp:result',
]);

function createRealmServer(options = {}) {
  const port = options.port == null ? DEFAULT_PORT : options.port;
  const ledgerFile = options.ledgerFile || path.join(__dirname, 'ledger.json');
  const accountsFile = options.accountsFile || path.join(__dirname, 'accounts.json');
  const seasonConfig = normalizeSeasonConfig(options.season || options.seasonState || {
    id: options.seasonId || DEFAULT_SEASON_ID,
    opensAt: options.seasonOpensAt,
    closesAt: options.seasonClosesAt,
    mandatoryTasks: options.mandatoryTasks,
  });
  const seasonId = seasonConfig.id;
  const difficulty = options.difficulty == null ? DEFAULT_DIFFICULTY : options.difficulty;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const saveDelayMs = options.saveDelayMs == null ? 800 : options.saveDelayMs;
  const futureSkewMs = options.futureSkewMs;
  const miningTtlMs = options.miningTtlMs == null ? 30000 : options.miningTtlMs;
  const staleThresholdMs = options.staleThresholdMs == null ? 10000 : options.staleThresholdMs;
  const quiet = !!options.quiet;
  const clients = new Set();
  const pendingMining = new Map();
  const validatedOutcomes = new Set();
  const accountRegistry = options.accountRegistry || createAccountRegistry({ accountsFile, seasonId, now });
  let saveTimer = null;
  let sweepInterval = null;
  let masterChain = loadLedger();
  let peerNonce = 0;

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
        client.lastStateAt = now();
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
      case 'segment:complete': {
        const account = requireAccount(client);
        if (!account.ok) return account;
        return issueValidatedOutcomeMiningWork(client, message.outcome);
      }
      case 'mine:submit': {
        const account = requireAccount(client);
        if (!account.ok) return account;
        return acceptMinedWork(client, message.candidateId, message.block);
      }
      default:
        if (message && SERVER_ARBITRATED_MESSAGE_TYPES.has(message.t)) {
          const account = requireAccount(client);
          if (!account.ok) return account;
          const result = blockError('authoritative_message_requires_server', 'PvP outcomes are authoritative and must be resolved by the server.');
          send(client, { t: 'authority:error', error: result.error });
          return result;
        }
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
    for (const peer of clients) {
      if (peer !== client && peer.id && peer.last && peer.last.t) send(client, peer.last);
    }
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
    // Deduplicate boss sigils — a boss sigil can only be minted once per character.
    if (reward.sigilId && ownsSigil(client.character.address, reward.sigilId)) {
      const result = blockError('sigil_owned', 'That boss sigil is already recorded on the Chainwell.');
      send(client, { t: 'mine:error', error: result.error });
      return result;
    }
    return issueMiningCandidate(client, (candidateId) => ({
      to: client.character.address,
      amt: reward.amt,
      note: reward.note,
      cur: 'RUNE',
      id: candidateId,
      auth: reward.sigilId ? {
        type: 'server-boss-reward',
        source: reward.sourceKey,
        sigilId: reward.sigilId,
        accountId: client.accountId,
        characterId: client.character.id,
        seasonId,
      } : {
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
    const currentCharacter = accountRegistry.getCharacterState(client.accountId);
    const spend = resolveSpendSource(source, address, currentCharacter.ok ? currentCharacter.character : client.character);
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

  function issueValidatedOutcomeMiningWork(client, outcome) {
    const validated = validateSoloSegmentOutcome(client, outcome);
    if (!validated.ok) {
      send(client, { t: 'mine:error', error: validated.error });
      return validated;
    }
    const replayKey = validated.outcomeKey;
    if (validatedOutcomes.has(replayKey)) {
      const result = blockError('segment_outcome_replayed', 'That solo segment outcome has already been submitted for ledger validation.');
      send(client, { t: 'mine:error', error: result.error });
      return result;
    }
    const reward = resolveRewardSource(validated.source);
    if (!reward.ok) {
      send(client, { t: 'mine:error', error: reward.error });
      return reward;
    }
    validatedOutcomes.add(replayKey);
    const issued = issueMiningCandidate(client, (candidateId) => ({
      to: client.character.address,
      amt: reward.amt,
      note: 'validated outcome: ' + reward.note,
      cur: 'RUNE',
      id: candidateId,
      auth: {
        type: 'server-validated-outcome',
        tier: 'validated',
        source: reward.sourceKey,
        segmentId: validated.segmentId,
        mode: validated.mode,
        accountId: client.accountId,
        characterId: client.character.id,
        seasonId,
      },
    }));
    if (!issued.ok) validatedOutcomes.delete(replayKey);
    return issued;
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

  function ownsSigil(address, sigilId) {
    for (const block of masterChain) {
      for (const tx of block.txs || []) {
        const auth = tx.auth;
        if (tx.to === address && auth && auth.type === 'server-boss-reward' &&
            auth.sigilId === sigilId) {
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
    accountRegistry.applyAcceptedBlock(block);
    const currentCharacter = accountRegistry.getCharacterState(client.accountId);
    if (currentCharacter.ok) client.character = currentCharacter.character;
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
    if (source.type === 'boss') {
      const enemy = ENEMY_REWARDS[source.key];
      if (!enemy) return blockError('invalid_reward_source', 'Unknown boss reward source.');
      const sigilId = BOSS_SIGILS[source.key];
      if (!sigilId) return blockError('invalid_reward_source', 'Boss has no sigil defined.');
      // amended-record (The Auditor) requires Choice C path.
      if (sigilId === 'amended-record' && !source.choiceC) {
        return blockError('invalid_reward_source', 'The Amended Record requires the Choice C ending path.');
      }
      return {
        ok: true,
        amt: enemy.rune,
        note: enemy.name + ' defeated — ' + sigilId,
        sourceKey: 'boss:' + source.key,
        sigilId,
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

  function validateSoloSegmentOutcome(client, outcome) {
    if (!outcome || typeof outcome !== 'object') return blockError('invalid_segment_outcome', 'Solo segment outcome is required.');
    const mode = sanitizeText(outcome.mode || '', 24);
    if (mode !== 'platformer' && mode !== 'turnbased') {
      return blockError('invalid_segment_outcome', 'Only solo platformer and turn-based segment outcomes are validated by this path.');
    }
    const segmentId = sanitizeText(outcome.segmentId || '', 80);
    if (!segmentId) return blockError('invalid_segment_outcome', 'Solo segment outcome must include a segment id.');
    const proof = outcome.proof;
    if (!proof || typeof proof !== 'object' || proof.completed !== true) {
      return blockError('invalid_segment_outcome', 'Solo segment outcome proof must show completion.');
    }
    const source = outcome.source;
    if (!source || typeof source !== 'object') return blockError('invalid_segment_outcome', 'Solo segment outcome must include a reward source.');
    if (source.type === 'enemy') {
      const kills = Array.isArray(proof.kills) ? proof.kills : [];
      const matched = kills.some((kill) => kill && kill.key === source.key && (kill.count == null || kill.count >= 1));
      if (!matched) return blockError('invalid_segment_outcome', 'Enemy reward outcomes require matching kill proof.');
    } else if (source.type === 'story') {
      if (proof.questId !== source.questId) return blockError('invalid_segment_outcome', 'Story reward outcomes require matching quest proof.');
    } else {
      return blockError('invalid_segment_outcome', 'Unsupported solo segment reward source.');
    }
    return {
      ok: true,
      mode,
      segmentId,
      source: clone(source),
      outcomeKey: [seasonId, client.character.id, mode, segmentId, JSON.stringify(source)].join('|'),
    };
  }

  function resolveSpendSource(source, address, characterState) {
    if (!source || typeof source !== 'object') return blockError('invalid_spend_source', 'Spend source is required.');
    if (source.type === 'level') {
      const def = LEVELING.stats[source.stat];
      if (!def) return blockError('invalid_spend_source', 'Unknown stat to level.');
      const persistedLevel = characterState && characterState.stats ? characterState.stats[source.stat] || 0 : 0;
      const level = Math.max(statLevelOf(address, source.stat), persistedLevel);
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
      const ownsPersistedRelic = characterState && characterState.collection &&
        Array.isArray(characterState.collection.relics) && characterState.collection.relics.includes(source.relicId);
      if (ownsRelic(address, source.relicId) || ownsPersistedRelic) return blockError('relic_owned', 'That relic is already forged.');
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
    sweepInterval = setInterval(sweepStaleClients, 5000);
    server.on('close', () => {
      if (sweepInterval) { clearInterval(sweepInterval); sweepInterval = null; }
    });
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

  function sweepStaleClients() {
    const cutoff = now() - staleThresholdMs;
    for (const client of clients) {
      if (client.id && client.lastStateAt && client.lastStateAt < cutoff) {
        broadcast({ t: 'leave', id: client.id }, client);
        client.last = {};
        client.lastStateAt = 0;
      }
    }
  }

  function close(callback) {
    if (sweepInterval) {
      clearInterval(sweepInterval);
      sweepInterval = null;
    }
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
    getAccountRegistry: () => accountRegistry,
    listen,
    close,
  };
}

function createAccountRegistry(options = {}) {
  const accountsFile = options.accountsFile || path.join(__dirname, 'accounts.json');
  const seasonConfig = normalizeSeasonConfig(options.season || options.seasonState || {
    id: options.seasonId || DEFAULT_SEASON_ID,
    opensAt: options.seasonOpensAt,
    closesAt: options.seasonClosesAt,
    mandatoryTasks: options.mandatoryTasks,
  });
  const seasonId = seasonConfig.id;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const challengeTtlMs = options.challengeTtlMs == null ? 60000 : options.challengeTtlMs;
  const pendingChallenges = new Map();
  let registry = loadRegistry();
  ensureSeasonState();

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
      season: getSeasonState(),
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
      const carry = resolveCharacterCarry(account);
      character = createSeasonCharacter(id, seasonId, displayName, ts, carry);
      account.characters[seasonId] = character;
      createdCharacter = true;
      consumeCharacterCarry(account, carry);
    } else {
      normalizeCharacterState(character);
      character.name = displayName;
      character.lastSeenAt = ts;
    }

    saveRegistry();
    return { account, character, createdAccount, createdCharacter };
  }

  function getSeasonState(id = seasonId) {
    const season = registry.seasons && registry.seasons[id];
    if (!season) return null;
    const at = now();
    return { ...clone(season), open: isSeasonOpen(season, at), now: at };
  }

  function completeMandatoryTask(accountId, taskId, at = now()) {
    const account = registry.accounts[accountId];
    if (!account) return accountError('unknown_account', 'Account is unknown.');
    const character = account.characters && account.characters[seasonId];
    if (!character) return accountError('unknown_character', 'Account has no character for this season.');
    const season = registry.seasons[seasonId];
    if (!isSeasonOpen(season, at)) return accountError('season_closed', 'Mandatory tasks can only complete while the season window is open.');
    const cleanTaskId = sanitizeText(taskId, 64);
    if (!cleanTaskId) return accountError('invalid_season_task', 'Season task id is required.');
    if (season.mandatoryTasks.length && !season.mandatoryTasks.includes(cleanTaskId)) {
      return accountError('invalid_season_task', 'Task is not part of this season completion set.');
    }

    normalizeCharacterState(character);
    character.mandatoryTasks[cleanTaskId] = { completedAt: at };
    updateSeasonComplete(character, season, at);
    character.lastSeenAt = at;
    saveRegistry();
    return { ok: true, season: getSeasonState(), character: clone(character), seasonComplete: !!character.seasonComplete };
  }

  function markSeasonComplete(accountId, at = now()) {
    const account = registry.accounts[accountId];
    if (!account) return accountError('unknown_account', 'Account is unknown.');
    const character = account.characters && account.characters[seasonId];
    if (!character) return accountError('unknown_character', 'Account has no character for this season.');
    const season = registry.seasons[seasonId];
    if (!isSeasonOpen(season, at)) return accountError('season_closed', 'Season completion can only be recorded while the season window is open.');

    normalizeCharacterState(character);
    if (!allMandatoryTasksComplete(character, season)) {
      return accountError('season_tasks_unfinished', 'Mandatory tasks are unfinished.');
    }
    character.seasonComplete = true;
    character.completedAt = at;
    character.lastSeenAt = at;
    saveRegistry();
    return { ok: true, season: getSeasonState(), character: clone(character), seasonComplete: true };
  }

  function isCharacterSeasonComplete(accountId, characterId) {
    const found = characterId ? findCharacterById(characterId) : findCurrentCharacter(accountId);
    if (!found) return { ok: true, seasonComplete: false };
    const season = registry.seasons[found.character.seasonId];
    return { ok: true, seasonComplete: isSeasonComplete(found.character, season), character: clone(found.character), season: clone(season) };
  }

  function recordCharacterProgress(accountId, progress = {}) {
    const found = findCurrentCharacter(accountId);
    if (!found) return accountError('unknown_character', 'Account has no character for this season.');
    applyCharacterProgress(found.character, progress);
    found.character.lastSeenAt = now();
    saveRegistry();
    return { ok: true, character: clone(found.character) };
  }

  function getCharacterState(accountId, idSeason = seasonId) {
    const account = registry.accounts[accountId];
    if (!account || !account.characters || !account.characters[idSeason]) {
      return accountError('unknown_character', 'Account has no character for that season.');
    }
    normalizeCharacterState(account.characters[idSeason]);
    return { ok: true, character: clone(account.characters[idSeason]) };
  }

  function canSellCharacter(accountId, at = now(), characterId) {
    const found = characterId ? findCharacterById(characterId) : findCurrentCharacter(accountId);
    if (!found || found.account.id !== accountId) return accountError('unknown_character', 'Seller does not own that character.');
    const season = registry.seasons[found.character.seasonId];
    if (isSeasonOpen(season, at)) return accountError('season_open', 'Cannot sell while the season window is open.');
    if (!isSeasonComplete(found.character, season)) {
      return accountError('season_tasks_unfinished', 'Character is not season-complete.');
    }
    return { ok: true, character: clone(found.character), season: clone(season) };
  }

  function recordCharacterSale(sellerAccountId, buyerAccountId, options = {}) {
    const at = options.at == null ? now() : Number(options.at);
    const buyer = registry.accounts[buyerAccountId];
    if (!buyer) return accountError('unknown_buyer', 'Buyer account is unknown.');
    const eligibility = canSellCharacter(sellerAccountId, at, options.characterId);
    if (!eligibility.ok) return eligibility;
    const found = findCharacterById(eligibility.character.id);
    const character = found.character;

    normalizeCharacterState(character);
    normalizeAccountState(found.account);
    normalizeAccountState(buyer);
    const collection = clone(character.collection);
    const sale = {
      sourceCharacterId: character.id,
      sourceSeasonId: character.seasonId,
      sellerAccountId,
      buyerAccountId,
      soldAt: at,
    };
    character.sale = clone(sale);
    found.account.restartNextSeason = { ...clone(sale), reason: 'sold-character' };
    buyer.pendingSeasonCarry = {
      mode: 'sale-transfer',
      sourceCharacterId: character.id,
      sourceSeasonId: character.seasonId,
      sellerAccountId,
      soldAt: at,
      collection,
      stats: zeroStats(),
    };
    saveRegistry();
    return { ok: true, sale: clone(sale), seller: clone(found.account), buyer: clone(buyer) };
  }

  function applyAcceptedBlock(block) {
    let changed = false;
    for (const tx of block && block.txs || []) {
      const auth = tx && tx.auth;
      if (!auth || !auth.characterId) continue;
      const found = findCharacterById(auth.characterId);
      if (!found) continue;
      if (auth.type === 'server-spend' && auth.effect) {
        applySpendEffect(found.character, auth.effect);
        changed = true;
      } else if (auth.type === 'server-boss-reward' && auth.sigilId) {
        applySpendEffect(found.character, { kind: 'sigil', sigilId: auth.sigilId });
        changed = true;
      }
    }
    if (changed) saveRegistry();
    return { ok: true, changed };
  }

  function ensureSeasonState() {
    if (!registry.seasons || typeof registry.seasons !== 'object' || Array.isArray(registry.seasons)) registry.seasons = {};
    const existing = registry.seasons[seasonId];
    const next = {
      id: seasonId,
      opensAt: seasonConfig.opensAt,
      closesAt: seasonConfig.closesAt,
      mandatoryTasks: seasonConfig.mandatoryTasks.slice(),
      createdAt: existing && existing.createdAt || now(),
      updatedAt: now(),
    };
    if (!existing ||
        existing.opensAt !== next.opensAt ||
        existing.closesAt !== next.closesAt ||
        JSON.stringify(existing.mandatoryTasks || []) !== JSON.stringify(next.mandatoryTasks)) {
      registry.seasons[seasonId] = next;
      saveRegistry();
    }
    return registry.seasons[seasonId];
  }

  function createSeasonCharacter(id, idSeason, displayName, ts, carry) {
    return {
      id,
      seasonId: idSeason,
      name: displayName,
      address: id,
      createdAt: ts,
      lastSeenAt: ts,
      seasonComplete: false,
      completedAt: null,
      mandatoryTasks: {},
      collection: clone(carry.collection || emptyCollection()),
      stats: clone(carry.stats || zeroStats()),
      carry: {
        mode: carry.mode,
        sourceCharacterId: carry.sourceCharacterId || null,
        sourceSeasonId: carry.sourceSeasonId || null,
        statsReset: !!carry.statsReset,
      },
    };
  }

  function resolveCharacterCarry(account) {
    normalizeAccountState(account);
    if (account.pendingSeasonCarry) {
      return {
        mode: account.pendingSeasonCarry.mode || 'sale-transfer',
        sourceCharacterId: account.pendingSeasonCarry.sourceCharacterId || null,
        sourceSeasonId: account.pendingSeasonCarry.sourceSeasonId || null,
        collection: clone(account.pendingSeasonCarry.collection || emptyCollection()),
        stats: zeroStats(),
        statsReset: true,
        consumePending: true,
      };
    }
    if (account.restartNextSeason) {
      return {
        mode: 'restart-zero',
        sourceCharacterId: account.restartNextSeason.sourceCharacterId || null,
        sourceSeasonId: account.restartNextSeason.sourceSeasonId || null,
        collection: emptyCollection(),
        stats: zeroStats(),
        statsReset: true,
        consumeRestart: true,
      };
    }
    const previous = latestCharacterBeforeSeason(account, seasonId);
    if (previous) {
      normalizeCharacterState(previous);
      return {
        mode: 'keep',
        sourceCharacterId: previous.id,
        sourceSeasonId: previous.seasonId,
        collection: clone(previous.collection),
        stats: clone(previous.stats),
        statsReset: false,
      };
    }
    return { mode: 'fresh', collection: emptyCollection(), stats: zeroStats(), statsReset: false };
  }

  function consumeCharacterCarry(account, carry) {
    if (carry.consumePending) delete account.pendingSeasonCarry;
    if (carry.consumeRestart) delete account.restartNextSeason;
  }

  function latestCharacterBeforeSeason(account, idSeason) {
    let latest = null;
    for (const character of Object.values(account.characters || {})) {
      if (!character || character.seasonId === idSeason) continue;
      if (!latest || (character.createdAt || 0) > (latest.createdAt || 0)) latest = character;
    }
    return latest;
  }

  function findCurrentCharacter(accountId) {
    const account = registry.accounts[accountId];
    if (!account || !account.characters || !account.characters[seasonId]) return null;
    normalizeCharacterState(account.characters[seasonId]);
    return { account, character: account.characters[seasonId] };
  }

  function findCharacterById(characterId) {
    for (const account of Object.values(registry.accounts || {})) {
      for (const character of Object.values(account.characters || {})) {
        if (character && character.id === characterId) {
          normalizeCharacterState(character);
          return { account, character };
        }
      }
    }
    return null;
  }

  function allMandatoryTasksComplete(character, season) {
    const tasks = season && Array.isArray(season.mandatoryTasks) ? season.mandatoryTasks : [];
    if (!tasks.length) return true;
    return tasks.every((taskId) => {
      const task = character.mandatoryTasks && character.mandatoryTasks[taskId];
      return task && isWithinSeason(task.completedAt, season);
    });
  }

  function updateSeasonComplete(character, season, at) {
    if (!allMandatoryTasksComplete(character, season)) {
      character.seasonComplete = false;
      character.completedAt = null;
      return false;
    }
    character.seasonComplete = true;
    character.completedAt = at;
    return true;
  }

  function isSeasonComplete(character, season) {
    normalizeCharacterState(character);
    return !!character.seasonComplete && isWithinSeason(character.completedAt, season) && allMandatoryTasksComplete(character, season);
  }

  function applyCharacterProgress(character, progress) {
    normalizeCharacterState(character);
    if (progress.stats && typeof progress.stats === 'object') {
      for (const stat of Object.keys(zeroStats())) {
        if (Object.prototype.hasOwnProperty.call(progress.stats, stat)) {
          character.stats[stat] = Math.max(0, Math.floor(finiteNumber(progress.stats[stat])));
        }
      }
    }
    if (progress.collection && typeof progress.collection === 'object') {
      mergeCollection(character.collection, progress.collection);
    }
  }

  function applySpendEffect(character, effect) {
    normalizeCharacterState(character);
    if (effect.kind === 'level' && Object.prototype.hasOwnProperty.call(character.stats, effect.stat)) {
      character.stats[effect.stat] = Math.max(character.stats[effect.stat], Math.max(0, Math.floor(finiteNumber(effect.level))));
    } else if (effect.kind === 'relic' && effect.relicId) {
      mergeCollection(character.collection, { relics: [effect.relicId] });
    } else if (effect.kind === 'cosmetic' && effect.skinId) {
      mergeCollection(character.collection, { cosmetics: [effect.skinId] });
    } else if (effect.kind === 'item' && effect.itemId) {
      mergeCollection(character.collection, { items: [effect.itemId] });
    } else if (effect.kind === 'sigil' && effect.sigilId) {
      mergeCollection(character.collection, { sigils: [effect.sigilId] });
    }
  }

  function cleanupChallenges() {
    const cutoff = now() - challengeTtlMs;
    for (const [challengeId, challenge] of pendingChallenges) {
      if (challenge.issuedAt < cutoff) pendingChallenges.delete(challengeId);
    }
  }

  function loadRegistry() {
    if (!fs.existsSync(accountsFile)) return { version: 1, seasons: {}, accounts: {} };
    const data = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
    if (!data || data.version !== 1 || !data.accounts || typeof data.accounts !== 'object' || Array.isArray(data.accounts)) {
      throw new Error('Account registry is malformed.');
    }
    if (!data.seasons || typeof data.seasons !== 'object' || Array.isArray(data.seasons)) data.seasons = {};
    for (const account of Object.values(data.accounts)) normalizeAccountState(account);
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
    getSeasonState,
    completeMandatoryTask,
    markSeasonComplete,
    isCharacterSeasonComplete,
    getCharacterState,
    recordCharacterProgress,
    recordCharacterSale,
    canSellCharacter,
    applyAcceptedBlock,
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

function normalizeSeasonConfig(value = {}) {
  const id = sanitizeText(value.id || value.seasonId || DEFAULT_SEASON_ID, 64) || DEFAULT_SEASON_ID;
  const opensAt = timestampOr(value.opensAt, 0);
  const closesAt = timestampOr(value.closesAt, Number.MAX_SAFE_INTEGER);
  return {
    id,
    opensAt,
    closesAt,
    mandatoryTasks: uniqueTextArray(value.mandatoryTasks || value.tasks || []),
  };
}

function timestampOr(value, fallback) {
  if (value instanceof Date) {
    const n = value.getTime();
    return Number.isFinite(n) ? n : fallback;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isSeasonOpen(season, at) {
  if (!season) return false;
  const t = timestampOr(at, Date.now());
  return t >= timestampOr(season.opensAt, 0) && t < timestampOr(season.closesAt, Number.MAX_SAFE_INTEGER);
}

function isWithinSeason(at, season) {
  if (!season) return false;
  const t = timestampOr(at, NaN);
  return Number.isFinite(t) && t >= timestampOr(season.opensAt, 0) && t < timestampOr(season.closesAt, Number.MAX_SAFE_INTEGER);
}

function normalizeAccountState(account) {
  if (!account.characters || typeof account.characters !== 'object' || Array.isArray(account.characters)) account.characters = {};
  for (const character of Object.values(account.characters)) normalizeCharacterState(character);
  if (account.pendingSeasonCarry) {
    account.pendingSeasonCarry.collection = normalizeCollection(account.pendingSeasonCarry.collection);
    account.pendingSeasonCarry.stats = zeroStats(account.pendingSeasonCarry.stats);
  }
}

function normalizeCharacterState(character) {
  if (!character || typeof character !== 'object') return;
  if (typeof character.seasonComplete !== 'boolean') character.seasonComplete = false;
  if (!Object.prototype.hasOwnProperty.call(character, 'completedAt')) character.completedAt = null;
  if (!character.mandatoryTasks || typeof character.mandatoryTasks !== 'object' || Array.isArray(character.mandatoryTasks)) character.mandatoryTasks = {};
  character.collection = normalizeCollection(character.collection);
  character.stats = zeroStats(character.stats);
  if (!character.carry || typeof character.carry !== 'object' || Array.isArray(character.carry)) {
    character.carry = { mode: 'legacy', sourceCharacterId: null, sourceSeasonId: null, statsReset: false };
  }
}

function zeroStats(seed = {}) {
  const stats = {};
  for (const key of Object.keys(LEVELING.stats || {})) {
    const n = Number(seed && seed[key]);
    stats[key] = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }
  return stats;
}

function emptyCollection() {
  return { items: [], cosmetics: [], relics: [], sigils: [] };
}

function normalizeCollection(value = {}) {
  return {
    items: uniqueTextArray(value.items),
    cosmetics: uniqueTextArray(value.cosmetics),
    relics: uniqueTextArray(value.relics),
    sigils: uniqueTextArray(value.sigils),
  };
}

function mergeCollection(target, source) {
  const clean = normalizeCollection(source);
  for (const key of Object.keys(emptyCollection())) {
    target[key] = uniqueTextArray([...(target[key] || []), ...(clean[key] || [])]);
  }
}

function uniqueTextArray(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const text = sanitizeText(item, 80);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sanitizeText(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
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
  AUTHORITY_TIERS,
  createRealmServer,
  createAccountRegistry,
  decodeFrame,
  encodeFrame,
};
