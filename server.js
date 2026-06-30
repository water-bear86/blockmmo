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
const { ENEMY_REWARDS, STORY, RELICS, LEVELING, BOSS_SIGILS, AUDITOR_ENDINGS } = require('./game/content.js');
const { createAnnounceFeed } = require('./game/announce.js');
const identity = require('./game/identity.js');
const agentClaim = require('./game/agent-claim.js');
const { createGoogleOAuth, createStore, parseCookies, serializeCookie } = require('./game/oauth-google.js');

const DEFAULT_PORT = process.env.PORT || 8080;
const DEFAULT_SEASON_ID = 'preseason-1';
const ACCOUNT_CREDENTIAL_TYPE = 'browser-p256-v1';
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'; // WebSocket magic string
const AUDITOR_ENDING_BY_ID = new Map((AUDITOR_ENDINGS || []).map((ending) => [ending.id, ending]));
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
    'chat-relay',
  ]),
});
const CHAINWELL_BLOCK_RULES = Object.freeze({
  rawClientBlocks: 'disabled',
  acceptedSubmission: 'server-issued-mine-submit',
  forkPolicy: 'server-canonical-tip',
  validator: 'validateBlockCandidate',
  candidateMatchFields: Object.freeze(['index', 'prev', 'time', 'txs']),
  submittedProofFields: Object.freeze(['nonce', 'hash']),
  rejectionCodes: Object.freeze({
    rawClientBlock: 'client_block_submission_disabled',
    unknownCandidate: 'unknown_mining_candidate',
    invalidCandidate: 'invalid_mining_candidate',
    replayedCandidate: 'mining_candidate_replayed',
    invalidBlockIndex: 'invalid_block_index',
    invalidBlockParent: 'invalid_block_parent',
    invalidBlockTime: 'invalid_block_time',
    invalidBlockHash: 'invalid_block_hash',
    invalidBlockDifficulty: 'invalid_block_difficulty',
    invalidBlockNonce: 'invalid_block_nonce',
  }),
});
const SERVER_ARBITRATED_MESSAGE_TYPES = new Set([
  'rc:pvp:hit',
  'rc:pvp:forfeit',
  'rc:pvp:result',
  'rc:pvp:turn:state',
  'rc:pvp:turn:result',
  'rc:pvp:error',
]);
const PVP_TURN_ACTIONS = new Set(['strike', 'guard', 'focus', 'flee']);
const PVP_DUEL_DEFAULTS = Object.freeze({
  hp: 100,
  stamina: 100,
  attack: 18,
  focusCost: 20,
  focusDamage: 30,
  guardRegen: 10,
});

function createRealmServer(options = {}) {
  const port = options.port == null ? DEFAULT_PORT : options.port;
  const ledgerFile = options.ledgerFile || path.join(__dirname, 'ledger.json');
  const accountsFile = options.accountsFile || path.join(__dirname, 'accounts.json');
  const s2ContentFile = options.s2ContentFile || path.join(__dirname, 's2_content.json');
  const halvingFile = options.halvingFile || path.join(__dirname, 'halving_schedule.json');
  const MOLT_BROKER_URL = options.moltBrokerUrl || process.env.MOLT_BROKER_URL || '';
  const MOLT_INGEST_KEY = options.moltIngestKey || process.env.MOLT_INGEST_KEY || '';
  const ADMIN_TOKEN = options.adminToken || process.env.RUNECHAIN_ADMIN_TOKEN || '';
  const S2_CONTENT_TYPES = new Set(['npc_dialogue','lore_fragment','boss_script','quest_outline','cosmetic_name','area_intro_text']);
  let s2Content = [];
  try { s2Content = JSON.parse(fs.readFileSync(s2ContentFile, 'utf8')); } catch (_) { s2Content = []; }
  function saveS2Content() {
    const tmp = s2ContentFile + '.tmp';
    fs.writeFile(tmp, JSON.stringify(s2Content, null, 2), err => { if (!err) fs.rename(tmp, s2ContentFile, () => {}); });
  }

  // ---- Halving mechanics (issue #107) ----------------------------------------
  // halving_schedule.json: { halvingAt: ISO8601, newSeasonId, noticeSentAt, triggeredAt }
  let halvingState = null;
  try { halvingState = JSON.parse(fs.readFileSync(halvingFile, 'utf8')); } catch (_) { halvingState = null; }
  let halvingNoticeSent = !!(halvingState && halvingState.noticeSentAt);
  let halvingFired     = !!(halvingState && halvingState.triggeredAt);

  function saveHalvingState() {
    const tmp = halvingFile + '.tmp';
    try {
      fs.mkdirSync(path.dirname(halvingFile), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(halvingState, null, 2));
      fs.renameSync(tmp, halvingFile);
    } catch (e) { log('[halving] save failed: ' + e.message); }
  }

  // Build a server-direct halving-debit block (no PoW required).
  function buildHalvingDebitBlock(halvingDebits) {
    const tip = masterChain[masterChain.length - 1] || { index: -1, hash: '0'.repeat(64) };
    const ts = Date.now();
    const block = {
      index:    tip.index + 1,
      prevHash: tip.hash || '0'.repeat(64),
      ts,
      nonce:    0,
      txs: halvingDebits.map(({ address, amt }) => ({
        from: address,
        to:   'halving-sink',
        amt,
        cur:  'RUNE',
        auth: { type: 'halving-debit', firedAt: ts },
      })),
    };
    // Deterministic hash so it's auditable even without PoW.
    block.hash = require('crypto').createHash('sha256').update(JSON.stringify(block)).digest('hex');
    return block;
  }

  function fireHalving() {
    if (!halvingState || halvingFired) return;
    const newSeasonId = halvingState.newSeasonId || 's2';
    log(`[halving] firing — newSeasonId=${newSeasonId}`);

    // Collect all non-minted-out character addresses.
    const reg = accountRegistry.listAllAccounts ? accountRegistry.listAllAccounts() : [];
    const halvingDebits = [];
    for (const account of reg) {
      if (account.mintedOut) continue;
      const address = account.character && account.character.address;
      if (!address) continue;
      const bal = runeBalanceOf(address);
      if (bal > 0) {
        halvingDebits.push({ address, amt: Math.floor(bal / 2) });
      }
    }

    if (halvingDebits.length > 0) {
      const block = buildHalvingDebitBlock(halvingDebits);
      appendBlock(block);
      log(`[halving] debited ${halvingDebits.length} address(es)`);
    }

    halvingFired = true;
    halvingState.triggeredAt = new Date().toISOString();
    halvingState.activeSeasonId = newSeasonId;
    saveHalvingState();

    // Update active season in account registry.
    if (accountRegistry.setActiveSeason) accountRegistry.setActiveSeason(newSeasonId);

    const dwindlingLevel = halvingState.dwindlingLevel || 4;
    broadcast({ t: 'halving', newSeasonId, dwindlingLevel });
    log(`[halving] complete — season=${newSeasonId}, ${halvingDebits.length} debits`);
  }

  function checkHalvingTimer() {
    if (!halvingState || halvingFired) return;
    const halvingAt = new Date(halvingState.halvingAt).getTime();
    const nowMs = Date.now();
    const NOTICE_LEAD_MS = 24 * 60 * 60 * 1000;

    if (!halvingNoticeSent && nowMs >= halvingAt - NOTICE_LEAD_MS) {
      halvingNoticeSent = true;
      halvingState.noticeSentAt = new Date().toISOString();
      saveHalvingState();
      broadcast({ t: 'halving-notice', halvingAt: halvingState.halvingAt, dwindlingLevel: halvingState.dwindlingLevel || 4 });
      log('[halving] 24h notice broadcast sent');
    }

    if (nowMs >= halvingAt) {
      fireHalving();
    }
  }

  // Poll every 60s. Cleared on server close.
  let halvingInterval = setInterval(checkHalvingTimer, 60 * 1000);
  // Check immediately on start (handles restarts after scheduled halvingAt).
  setImmediate(checkHalvingTimer);
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
  const pvpTurnTimeoutMs = options.pvpTurnTimeoutMs == null ? 30000 : options.pvpTurnTimeoutMs;
  // #89: cap unproven real-time reward claims per character per rolling window so a client
  // cannot farm unbounded RUNE by replaying kill claims (the real-time arena has no kill proof,
  // unlike the proven solo `segment:complete` path). [NUMBER] balance placeholder — tune freely;
  // set rewardRateMax<=0 to disable. Generous enough never to hinder legitimate play.
  const rewardRateMax = options.rewardRateMax == null ? 100 : options.rewardRateMax;
  const rewardRateWindowMs = options.rewardRateWindowMs == null ? 60000 : options.rewardRateWindowMs;
  const quiet = !!options.quiet;
  const clients = new Set();
  const pendingMining = new Map();
  const settledMiningCandidates = new Map();
  const validatedOutcomes = new Set();
  const rewardIssueTimes = new Map();
  const pvpDuels = new Map();
  // Sign-in flow: identity binding is OPT-IN for a safe rollout. With requireIdentity off (default),
  // the legacy device-key-only join keeps working unchanged; flip RUNECHAIN_REQUIRE_IDENTITY=1 once
  // the SSO+wallet client UI ships and the Google OAuth app is registered.
  const requireIdentity = options.requireIdentity != null ? !!options.requireIdentity : process.env.RUNECHAIN_REQUIRE_IDENTITY === '1';
  // Wallet enforcement is a SEPARATE flag from SSO so they roll out independently — require Google
  // sign-in first (RUNECHAIN_REQUIRE_IDENTITY), add the wallet requirement once its leg is proven.
  const requireWallet = options.requireWallet != null ? !!options.requireWallet : process.env.RUNECHAIN_REQUIRE_WALLET === '1';
  const accountRegistry = options.accountRegistry || createAccountRegistry({ accountsFile, season: seasonConfig, now, requireIdentity, requireWallet });
  const announceFeed = options.announceFeed || createAnnounceFeed({ seasonId });

  // SSO leg (Google) + browser sessions. Secrets come from env, never the client.
  const secureCookies = options.secureCookies != null ? !!options.secureCookies : process.env.RUNECHAIN_SECURE_COOKIES === '1';
  const oauth = options.googleOAuth || createGoogleOAuth({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || `http://localhost:${port}/auth/google/callback`,
    now,
  });
  const sessionStore = options.sessionStore || createStore({ ttlMs: options.sessionTtlMs == null ? 30 * 24 * 60 * 60 * 1000 : options.sessionTtlMs, now });
  const oauthStateStore = createStore({ ttlMs: 10 * 60 * 1000, now }); // short-lived CSRF state
  const claimStore = agentClaim.createClaimStore({ ttlMs: options.claimTtlMs, now }); // agent claim codes
  let saveTimer = null;
  let sweepInterval = null;
  let masterChain = loadLedger();
  let peerNonce = 0;

  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('ok');
    }

    if (announceFeed.enabled && req.url.split('?')[0] === '/announce-feed') {
      const since = Number(new URL(req.url, 'http://realm').searchParams.get('since')) || 0;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(announceFeed.since(since)));
    }

    if (req.url.split('?')[0].startsWith('/auth/')) {
      handleAuthRoute(req, res);
      return;
    }

    if (/^\/claim(\/|$)/.test(req.url.split('?')[0])) {
      handleClaimRoute(req, res);
      return;
    }

    // ---- Halving admin endpoints ------------------------------------------------
    const halvingRoute = req.url.split('?')[0];

    // POST /admin/halving/schedule  { halvingAt, newSeasonId, dwindlingLevel? }
    if (halvingRoute === '/admin/halving/schedule' && req.method === 'POST') {
      if (!ADMIN_TOKEN || req.headers['x-admin-token'] !== ADMIN_TOKEN) {
        res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'unauthorized' }));
      }
      let body = '';
      req.on('data', d => { body += d; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        try {
          const { halvingAt, newSeasonId, dwindlingLevel } = JSON.parse(body);
          if (!halvingAt || isNaN(new Date(halvingAt).getTime()))
            return (res.writeHead(400), res.end(JSON.stringify({ error: 'halvingAt must be a valid ISO8601 timestamp' })));
          if (new Date(halvingAt).getTime() <= Date.now())
            return (res.writeHead(400), res.end(JSON.stringify({ error: 'halvingAt must be in the future' })));
          halvingState = { halvingAt, newSeasonId: newSeasonId || 's2', dwindlingLevel: dwindlingLevel || 4, noticeSentAt: null, triggeredAt: null };
          halvingNoticeSent = false;
          halvingFired = false;
          saveHalvingState();
          log(`[halving] scheduled for ${halvingAt} → season ${halvingState.newSeasonId}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true, halvingAt, newSeasonId: halvingState.newSeasonId }));
        } catch (_) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'invalid_json' })); }
      });
      return;
    }

    // GET /admin/halving/status
    if (halvingRoute === '/admin/halving/status' && req.method === 'GET') {
      if (!ADMIN_TOKEN || req.headers['x-admin-token'] !== ADMIN_TOKEN) {
        res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'unauthorized' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ scheduled: !!halvingState, state: halvingState }));
    }

    // POST /character/mint-out  (auth-gated — requires active session + character)
    if (halvingRoute === '/character/mint-out' && req.method === 'POST') {
      const sessionId = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('rc_session='))?.slice('rc_session='.length);
      const session = sessionId && sessionStore.get(sessionId);
      if (!session) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'not_signed_in' })); }
      const result = accountRegistry.setMintedOut(session.accountId);
      if (!result.ok) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: result.error.code })); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, mintedOut: true }));
    }

    // S2 player-compute endpoints
    if (req.url.split('?')[0] === '/rc-config.json') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ broker: MOLT_BROKER_URL }));
    }

    if (req.url.split('?')[0] === '/api/s2/content') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ chunks: s2Content.filter(c => c.status === 'approved').map(c => ({ id: c.id, type: c.type, area: c.area, payload_json: c.payload_json })) }));
      }
      if (req.method === 'POST') {
        if (MOLT_INGEST_KEY && req.headers.authorization !== 'Bearer ' + MOLT_INGEST_KEY) {
          res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'unauthorized' }));
        }
        let body = '';
        req.on('data', d => { body += d; if (body.length > 65536) req.destroy(); });
        req.on('end', () => {
          try {
            const { id, type, area, payload_json, entropy_seed } = JSON.parse(body);
            if (!id || !type || !area || !payload_json) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'missing_fields' })); }
            if (!S2_CONTENT_TYPES.has(type)) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'invalid_type' })); }
            if (s2Content.find(c => c.id === id)) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, id, duplicate: true })); }
            s2Content.push({ id, type, area, payload_json, entropy_seed: entropy_seed || null, status: 'approved', created_at: Date.now() });
            saveS2Content();
            res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, id }));
          } catch (_) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'invalid_json' })); }
        });
        return;
      }
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

    // The SSO session rides the same-origin WS upgrade as a cookie; attach the verified profile so
    // the join handler can bind it. No session -> client.sso stays null (legacy join still allowed
    // unless requireIdentity is on).
    const cookies = parseCookies(req.headers && req.headers.cookie);
    const session = cookies.rc_session ? sessionStore.get(cookies.rc_session) : null;
    const client = { socket, id: null, name: 'Recorded', accountId: null, character: null, last: {}, sessionId: cookies.rc_session || null, sso: session ? session.sso : null };
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
    finishPvpDuelsForDroppedClient(client);
    clients.delete(client);
    if (client.id) broadcast({ t: 'leave', id: client.id }, client);
    log(`* ${client.name} left the realm  (${clients.size} online)`);
  }

  // ---- sign-in HTTP routes (SSO leg) -------------------------------------------------------------
  function sessionCookie(value, maxAgeSeconds) {
    return serializeCookie('rc_session', value, { maxAge: maxAgeSeconds, httpOnly: true, secure: secureCookies, sameSite: 'Lax' });
  }
  function redirect(res, location, setCookies) {
    const headers = { Location: location, 'Cache-Control': 'no-store' };
    if (setCookies && setCookies.length) headers['Set-Cookie'] = setCookies;
    res.writeHead(302, headers);
    res.end();
  }
  function jsonResponse(res, status, body, setCookies) {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    if (setCookies && setCookies.length) headers['Set-Cookie'] = setCookies;
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  }

  function readJsonBody(req, res, cb) {
    let data = '';
    let aborted = false;
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 16384 && !aborted) { aborted = true; jsonResponse(res, 413, { code: 'body_too_large' }); req.destroy(); }
    });
    req.on('end', () => {
      if (aborted) return;
      let body;
      try { body = data ? JSON.parse(data) : {}; } catch (_) { return jsonResponse(res, 400, { code: 'invalid_json' }); }
      cb(body && typeof body === 'object' ? body : {});
    });
    req.on('error', () => { if (!aborted) jsonResponse(res, 400, { code: 'read_error' }); });
  }

  // ---- agent claim routes (grid worker <-> game identity binding) --------------------------------
  function handleClaimRoute(req, res) {
    const url = new URL(req.url, 'http://realm');
    const route = url.pathname;
    const cookies = parseCookies(req.headers && req.headers.cookie);
    const session = cookies.rc_session ? sessionStore.get(cookies.rc_session) : null;
    const ssoAccount = () => (session && session.sso ? accountRegistry.resolveAccountBySso(session.sso) : null);

    // The /claim page itself (the logged-in human confirms here).
    if (route === '/claim' && req.method === 'GET') {
      return fs.readFile(path.join(__dirname, 'claim.html'), (err, data) => {
        if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('claim page not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        res.end(data);
      });
    }
    // Agent starts a claim (unauthenticated — it only sends its PUBLIC key).
    if (route === '/claim/start' && req.method === 'POST') {
      return readJsonBody(req, res, (body) => {
        const r = claimStore.start({ agentPubkey: body.agentPubkey, label: body.label });
        if (!r.ok) return jsonResponse(res, 400, r.error);
        const proto = req.headers['x-forwarded-proto'] || 'https';
        const base = proto + '://' + (req.headers.host || 'play.runechaingame.com');
        jsonResponse(res, 200, { code: r.code, label: r.label, agentAddress: r.agentAddress, expiresAt: r.expiresAt, claimUrl: base + '/claim?code=' + encodeURIComponent(r.code) });
      });
    }
    // Agent polls for confirmation.
    if (route === '/claim/poll' && req.method === 'GET') {
      return jsonResponse(res, 200, claimStore.poll(url.searchParams.get('code')));
    }
    // Human's page reads what a code is claiming.
    if (route === '/claim/lookup' && req.method === 'GET') {
      const r = claimStore.lookup(url.searchParams.get('code'));
      return jsonResponse(res, r.ok ? 200 : 404, r.ok ? r : r.error);
    }
    // Human confirms the claim -> binds the agent to their account (session-authenticated).
    if (route === '/claim/confirm' && req.method === 'POST') {
      if (!session || !session.sso) return jsonResponse(res, 401, { code: 'sso_required', message: 'Sign in with Google to confirm an agent claim.' });
      const accountId = ssoAccount();
      if (!accountId) return jsonResponse(res, 409, { code: 'no_account', message: 'Enter the game once so your account exists, then claim agents.' });
      return readJsonBody(req, res, (body) => {
        const conf = claimStore.confirm(body.code, accountId);
        if (!conf.ok) return jsonResponse(res, 409, conf.error);
        const bound = accountRegistry.bindAgentToAccount(accountId, conf.agent.b64, conf.label);
        if (!bound.ok) return jsonResponse(res, 409, bound.error);
        jsonResponse(res, 200, { ok: true, agent: bound.agent });
      });
    }
    // Human lists / revokes their claimed agents.
    if (route === '/claim/agents' && req.method === 'GET') {
      const accountId = ssoAccount();
      if (!accountId) return jsonResponse(res, 200, { ok: true, agents: [] });
      return jsonResponse(res, 200, accountRegistry.listAgents(accountId));
    }
    if (route === '/claim/revoke' && req.method === 'POST') {
      const accountId = ssoAccount();
      if (!accountId) return jsonResponse(res, 401, { code: 'sso_required' });
      return readJsonBody(req, res, (body) => {
        const r = accountRegistry.revokeAgentForAccount(accountId, body.address);
        jsonResponse(res, r.ok ? 200 : 404, r.ok ? r : r.error);
      });
    }
    // Broker relying-party verification: agent signed `message`; is the key bound + valid?
    if (route === '/claim/verify' && req.method === 'POST') {
      return readJsonBody(req, res, (body) => {
        const r = accountRegistry.verifyAgentRequest(body.agentPubkey, body.message, body.signature);
        jsonResponse(res, r.ok ? 200 : 401, r.ok ? { ok: true, accountId: r.accountId, agentAddress: r.agentAddress } : r.error);
      });
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'claim_route_not_found' }));
  }

  function handleAuthRoute(req, res) {
    const url = new URL(req.url, 'http://realm');
    const route = url.pathname;
    const cookies = parseCookies(req.headers && req.headers.cookie);

    // Begin Google sign-in: stash CSRF state, redirect the browser to Google.
    if (route === '/auth/google/start' && req.method === 'GET') {
      if (!oauth.enabled) return redirect(res, '/?auth=sso_unconfigured');
      const next = sanitizeNext(url.searchParams.get('next'));
      const state = oauthStateStore.create({ next });
      const stateCookie = serializeCookie('rc_oauth_state', state, { maxAge: 600, httpOnly: true, secure: secureCookies, sameSite: 'Lax' });
      return redirect(res, oauth.authUrl({ state, nonce: state }), [stateCookie]);
    }

    // Google redirects back here with ?code&state. Verify, exchange, open a session.
    if (route === '/auth/google/callback' && req.method === 'GET') {
      const qErr = url.searchParams.get('error');
      if (qErr) return redirect(res, '/?auth=denied');
      const state = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      if (!state || cookies.rc_oauth_state !== state) return redirect(res, '/?auth=state_invalid');
      const stateData = oauthStateStore.take(state); // single-use
      if (!stateData) return redirect(res, '/?auth=state_invalid');
      const clearState = serializeCookie('rc_oauth_state', '', { maxAge: 0, httpOnly: true, secure: secureCookies, sameSite: 'Lax' });

      oauth.exchangeCode(code).then((result) => {
        if (!result.ok) return redirect(res, '/?auth=' + encodeURIComponent(result.error.code), [clearState]);
        const sid = sessionStore.create({ sso: result.profile });
        const maxAge = Math.floor((options.sessionTtlMs == null ? 30 * 24 * 60 * 60 * 1000 : options.sessionTtlMs) / 1000);
        return redirect(res, sanitizeNext(stateData.next) || '/', [clearState, sessionCookie(sid, maxAge)]);
      }).catch(() => redirect(res, '/?auth=sso_error', [clearState]));
      return;
    }

    // The client polls this to learn whether it is signed in (and as whom).
    if (route === '/auth/session' && req.method === 'GET') {
      const session = cookies.rc_session ? sessionStore.get(cookies.rc_session) : null;
      const sso = session && session.sso ? { provider: session.sso.provider, email: session.sso.email, name: session.sso.name } : null;
      return jsonResponse(res, 200, { signedIn: !!sso, sso, ssoEnabled: oauth.enabled, requireIdentity, requireWallet });
    }

    if (route === '/auth/logout' && (req.method === 'POST' || req.method === 'GET')) {
      if (cookies.rc_session) sessionStore.destroy(cookies.rc_session);
      return jsonResponse(res, 200, { ok: true }, [sessionCookie('', 0)]);
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'auth_route_not_found' }));
  }

  // Only allow same-origin relative redirect targets (defeats open-redirect via ?next=).
  function sanitizeNext(next) {
    if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) return '/';
    return next.slice(0, 256);
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
      case 'wallet:challenge':
        return issueWalletChallenge(client, message.wallet);
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
      case 'chat': {
        const account = requireAccount(client);
        if (!account.ok) return account;
        const text = sanitizeText(message.text, 160);
        if (!text) return { ok: false, error: { code: 'empty_chat', message: 'Chat message is empty.' } };
        // Non-authoritative proximity chat: relayed verbatim, never recorded to the ledger.
        broadcast({ t: 'chat', id: client.id, name: client.name, text, interior: sanitizeText(message.interior || '', 40) || null }, client);
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
      case 'auditor:ending': {
        const account = requireAccount(client);
        if (!account.ok) return account;
        return recordAuditorEndingForClient(client, message);
      }
      case 'mine:submit': {
        const account = requireAccount(client);
        if (!account.ok) return account;
        return acceptMinedWork(client, message.candidateId, message.block);
      }
      case 'rc:pvp:challenge': {
        const account = requireAccount(client);
        if (!account.ok) return account;
        return issuePvpChallenge(client, message);
      }
      case 'rc:pvp:accept': {
        const account = requireAccount(client);
        if (!account.ok) return account;
        return acceptPvpChallenge(client, message.duelId);
      }
      case 'rc:pvp:decline': {
        const account = requireAccount(client);
        if (!account.ok) return account;
        return declinePvpChallenge(client, message.duelId, message.reason);
      }
      case 'rc:pvp:turn:submit': {
        const account = requireAccount(client);
        if (!account.ok) return account;
        return acceptPvpTurnSubmission(client, message);
      }
      case 'rc:pvp:turn:forfeit': {
        const account = requireAccount(client);
        if (!account.ok) return account;
        return acceptPvpTurnSubmission(client, { ...message, action: 'flee' });
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

  function issueWalletChallenge(client, wallet) {
    const result = accountRegistry.issueWalletChallenge(wallet && wallet.address);
    if (!result.ok) {
      send(client, { t: 'join:error', error: result.error });
      return result;
    }
    send(client, { t: 'wallet:challenge', ...result.challenge });
    return result;
  }

  function joinClient(client, message) {
    const name = sanitizeDisplayName(message.name);
    // Use the identity-binding path when SSO/wallet are in play (or required); otherwise the legacy
    // device-key-only join keeps working for the current client + existing tests.
    const useIdentity = requireIdentity || requireWallet || !!client.sso || !!message.wallet;
    const result = useIdentity
      ? accountRegistry.verifyIdentityJoin({ credential: message.credential, wallet: message.wallet, sso: client.sso, name })
      : accountRegistry.verifyJoin(message.credential, name);
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
    const state = {
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
      // Presence so peers can show who is in an encounter and co-locate inside interiors.
      mode: sanitizeText(message.mode || 'town', 24) || 'town',
      encounter: sanitizeText(message.encounter || '', 24) || null,
      interior: sanitizeText(message.interior || '', 40) || null,
    };
    const ending = publicAuditorEnding(client.character);
    if (ending) state.auditorEnding = ending;
    return state;
  }

  function recordAuditorEndingForClient(client, message) {
    const result = accountRegistry.recordAuditorEnding(client.accountId, message.ending || message.id || message.choice);
    if (!result.ok) {
      send(client, { t: 'auditor:ending:error', error: result.error });
      return result;
    }
    client.character = result.character;
    send(client, { t: 'auditor:ending', ending: result.ending, character: result.character });
    return result;
  }

  function issuePvpChallenge(client, message) {
    const targetPeerId = sanitizeText(message.to || '', 80);
    const target = findClientByPeerId(targetPeerId);
    if (!target || !target.accountId || !target.character) {
      return sendPvpError(client, null, 'pvp_peer_unavailable', 'PvP challenge target is not available.');
    }
    if (target.id === client.id) {
      return sendPvpError(client, null, 'pvp_invalid_challenge', 'PvP challenge target must be another player.');
    }

    const duelId = createPvpDuelId();
    const duel = {
      id: duelId,
      status: 'pending',
      areaId: sanitizeText(message.areaId || 'battlefield', 80),
      createdAt: now(),
      acceptedAt: 0,
      finishedAt: 0,
      sequence: 0,
      turn: 1,
      actorPeerId: client.id,
      turnDeadlineAt: 0,
      challengerPeerId: client.id,
      challengedPeerId: target.id,
      participants: {
        a: createPvpParticipant(client, 'a'),
        b: createPvpParticipant(target, 'b'),
      },
      seenSubmissionIds: new Set(),
      seenActorTurns: new Set(),
      result: null,
    };
    pvpDuels.set(duelId, duel);

    const challenge = {
      t: 'rc:pvp:challenge',
      duelId,
      from: client.id,
      to: target.id,
      areaId: duel.areaId,
    };
    send(client, {
      ...challenge,
      t: 'rc:pvp:challenge:created',
    });
    send(target, challenge);
    return { ok: true, duelId, challenge };
  }

  function acceptPvpChallenge(client, duelId) {
    const duel = pvpDuels.get(sanitizeText(duelId || '', 96));
    if (!duel) return sendPvpError(client, duelId, 'pvp_duel_unknown', 'PvP duel is unknown.');
    if (duel.status === 'finished') return sendPvpError(client, duel.id, 'pvp_duel_finished', 'PvP duel is already finished.');
    if (duel.status !== 'pending') return sendPvpError(client, duel.id, 'pvp_duel_not_pending', 'PvP duel is not awaiting acceptance.');
    if (client.id !== duel.challengedPeerId) return sendPvpError(client, duel.id, 'pvp_not_participant', 'Only the challenged player can accept this duel.');

    duel.status = 'active';
    duel.acceptedAt = now();
    duel.sequence += 1;
    duel.turn = 1;
    duel.actorPeerId = duel.challengerPeerId;
    duel.turnDeadlineAt = now() + pvpTurnTimeoutMs;

    const accepted = {
      t: 'rc:pvp:accept',
      duelId: duel.id,
      sequence: duel.sequence,
      areaId: duel.areaId,
      challengerPeerId: duel.challengerPeerId,
      challengedPeerId: duel.challengedPeerId,
      from: client.id,
      turn: duel.turn,
      actorPeerId: duel.actorPeerId,
      deadlineAt: duel.turnDeadlineAt,
      state: pvpPublicState(duel),
    };
    sendPvpAcceptFrame(duel, duel.challengerPeerId, duel.challengedPeerId, accepted);
    sendPvpAcceptFrame(duel, duel.challengedPeerId, duel.challengerPeerId, accepted);
    return { ok: true, duelId: duel.id, accepted };
  }

  function declinePvpChallenge(client, duelId, reason) {
    const duel = pvpDuels.get(sanitizeText(duelId || '', 96));
    if (!duel) return sendPvpError(client, duelId, 'pvp_duel_unknown', 'PvP duel is unknown.');
    if (client.id !== duel.challengedPeerId) return sendPvpError(client, duel.id, 'pvp_not_participant', 'Only the challenged player can decline this duel.');
    if (duel.status !== 'pending') return sendPvpError(client, duel.id, 'pvp_duel_not_pending', 'PvP duel is not awaiting a decline.');

    duel.status = 'finished';
    duel.finishedAt = now();
    duel.result = {
      t: 'rc:pvp:decline',
      duelId: duel.id,
      from: client.id,
      reason: sanitizeText(reason || 'declined', 40) || 'declined',
    };
    sendPvpParticipants(duel, duel.result);
    return { ok: true, duelId: duel.id, result: duel.result };
  }

  function acceptPvpTurnSubmission(client, message) {
    const duelId = sanitizeText(message.duelId || '', 96);
    const duel = pvpDuels.get(duelId);
    if (!duel) return sendPvpError(client, duelId, 'pvp_duel_unknown', 'PvP duel is unknown.');
    if (!pvpParticipantByPeer(duel, client.id)) {
      return sendPvpError(client, duel.id, 'pvp_not_participant', 'Only duel participants can submit turns.');
    }
    if (duel.status === 'finished') return sendPvpError(client, duel.id, 'pvp_duel_finished', 'PvP duel is already finished.');
    if (duel.status !== 'active') return sendPvpError(client, duel.id, 'pvp_duel_not_active', 'PvP duel is not active.');

    const submissionId = sanitizeText(message.submissionId || message.clientTurnId || '', 96);
    if (!submissionId) return sendPvpError(client, duel.id, 'invalid_turn_submission', 'PvP turn submission id is required.');
    const submissionKey = client.id + '|' + submissionId;
    if (duel.seenSubmissionIds.has(submissionKey)) {
      return sendPvpError(client, duel.id, 'turn_submission_replayed', 'PvP turn submission has already been accepted.');
    }

    const submittedTurn = Math.trunc(Number(message.turn));
    if (!Number.isFinite(submittedTurn) || submittedTurn < 1) {
      return sendPvpError(client, duel.id, 'invalid_turn_submission', 'PvP turn number is required.');
    }
    if (submittedTurn !== duel.turn) {
      const code = submittedTurn < duel.turn ? 'stale_turn_submission' : 'pvp_wrong_turn';
      return sendPvpError(client, duel.id, code, 'PvP turn submission does not match the server turn.', {
        expectedTurn: duel.turn,
      });
    }
    if (client.id !== duel.actorPeerId) {
      return sendPvpError(client, duel.id, 'pvp_wrong_actor', 'It is not this player\'s PvP turn.', {
        expectedActorPeerId: duel.actorPeerId,
      });
    }

    const action = sanitizeText(message.action || '', 24);
    if (!PVP_TURN_ACTIONS.has(action)) {
      return sendPvpError(client, duel.id, 'invalid_turn_action', 'Unsupported PvP turn action.');
    }

    const actorTurnKey = client.id + '|' + submittedTurn;
    if (duel.seenActorTurns.has(actorTurnKey)) {
      return sendPvpError(client, duel.id, 'turn_submission_replayed', 'PvP actor turn has already been accepted.');
    }

    const result = resolvePvpTurn(duel, client.id, submittedTurn, action, submissionId);
    // Only consume the replay/turn slot once the action actually resolved. A rejected
    // submission (e.g. Focus with insufficient stamina, server.js resolvePvpTurn) must NOT
    // lock the actor out of the turn — otherwise they could never submit a valid action for
    // this turn and would lose on the turn timeout.
    if (result && result.ok) {
      duel.seenSubmissionIds.add(submissionKey);
      duel.seenActorTurns.add(actorTurnKey);
    }
    return result;
  }

  function resolvePvpTurn(duel, actorPeerId, submittedTurn, action, submissionId) {
    const actor = pvpParticipantByPeer(duel, actorPeerId);
    const target = pvpOpponent(duel, actorPeerId);
    const events = [];

    if (action === 'flee') {
      return finishPvpDuel(duel, {
        winnerPeerId: target.peerId,
        loserPeerId: actor.peerId,
        reason: 'forfeit',
        action,
        submissionId,
      });
    }

    if (action === 'guard') {
      actor.guarding = true;
      actor.sta = Math.min(actor.maxSta, actor.sta + PVP_DUEL_DEFAULTS.guardRegen);
      events.push({ type: 'guard', actorPeerId: actor.peerId, stamina: actor.sta });
    } else {
      let damage = actor.attack;
      if (action === 'focus') {
        if (actor.sta < PVP_DUEL_DEFAULTS.focusCost) {
          return sendPvpError(findClientByPeerId(actor.peerId), duel.id, 'pvp_insufficient_stamina', 'Not enough server-authoritative stamina for Focus.');
        }
        actor.sta -= PVP_DUEL_DEFAULTS.focusCost;
        damage = PVP_DUEL_DEFAULTS.focusDamage;
      }
      if (target.guarding) damage = Math.max(1, Math.ceil(damage / 2));
      target.guarding = false;
      target.hp = Math.max(0, target.hp - damage);
      events.push({ type: 'damage', actorPeerId: actor.peerId, targetPeerId: target.peerId, amount: damage, action });
    }

    if (target.hp <= 0) {
      return finishPvpDuel(duel, {
        winnerPeerId: actor.peerId,
        loserPeerId: target.peerId,
        reason: 'defeat',
        action,
        submissionId,
      });
    }

    duel.sequence += 1;
    duel.turn += 1;
    duel.actorPeerId = target.peerId;
    duel.turnDeadlineAt = now() + pvpTurnTimeoutMs;

    const frame = {
      t: 'rc:pvp:turn:state',
      duelId: duel.id,
      sequence: duel.sequence,
      turn: submittedTurn,
      actorPeerId: actor.peerId,
      action,
      submissionId,
      events,
      nextTurn: duel.turn,
      nextActorPeerId: duel.actorPeerId,
      deadlineAt: duel.turnDeadlineAt,
      state: pvpPublicState(duel),
    };
    sendPvpParticipants(duel, frame);
    return { ok: true, duelId: duel.id, turn: frame };
  }

  function finishPvpDuel(duel, result) {
    if (duel.status === 'finished') return { ok: true, duelId: duel.id, result: duel.result };
    duel.status = 'finished';
    duel.finishedAt = now();
    duel.sequence += 1;
    duel.result = {
      t: 'rc:pvp:result',
      duelId: duel.id,
      sequence: duel.sequence,
      turn: duel.turn,
      winner: result.winnerPeerId,
      loser: result.loserPeerId,
      reason: result.reason,
      action: result.action || null,
      submissionId: result.submissionId || null,
      state: pvpPublicState(duel),
    };
    sendPvpParticipants(duel, duel.result);
    return { ok: true, duelId: duel.id, result: duel.result };
  }

  function sweepPvpTurnTimeouts() {
    let resolved = 0;
    const t = now();
    for (const duel of pvpDuels.values()) {
      if (duel.status !== 'active' || !duel.turnDeadlineAt || duel.turnDeadlineAt >= t) continue;
      const actor = pvpParticipantByPeer(duel, duel.actorPeerId);
      const opponent = pvpOpponent(duel, duel.actorPeerId);
      if (!actor || !opponent) continue;
      finishPvpDuel(duel, {
        winnerPeerId: opponent.peerId,
        loserPeerId: actor.peerId,
        reason: 'timeout',
      });
      resolved += 1;
    }
    return resolved;
  }

  function createPvpParticipant(client, slot) {
    const stats = client.character && client.character.stats || {};
    const vigor = finiteNumber(stats.vigor);
    const endurance = finiteNumber(stats.endurance);
    const strength = finiteNumber(stats.strength);
    const hp = PVP_DUEL_DEFAULTS.hp + vigor * 8;
    const sta = PVP_DUEL_DEFAULTS.stamina + endurance * 5;
    return {
      slot,
      peerId: client.id,
      accountId: client.accountId,
      characterId: client.character.id,
      name: client.name,
      hp,
      maxHp: hp,
      sta,
      maxSta: sta,
      attack: PVP_DUEL_DEFAULTS.attack + strength * 2,
      guarding: false,
    };
  }

  function pvpPublicState(duel) {
    const participants = {};
    for (const participant of Object.values(duel.participants)) {
      participants[participant.peerId] = {
        slot: participant.slot,
        peerId: participant.peerId,
        characterId: participant.characterId,
        name: participant.name,
        hp: participant.hp,
        maxHp: participant.maxHp,
        sta: participant.sta,
        maxSta: participant.maxSta,
        guarding: participant.guarding,
      };
    }
    return {
      status: duel.status,
      turn: duel.turn,
      actorPeerId: duel.actorPeerId,
      deadlineAt: duel.turnDeadlineAt,
      participants,
    };
  }

  function pvpParticipantByPeer(duel, peerId) {
    return Object.values(duel.participants).find((participant) => participant.peerId === peerId) || null;
  }

  function pvpOpponent(duel, peerId) {
    return Object.values(duel.participants).find((participant) => participant.peerId !== peerId) || null;
  }

  function sendPvpParticipants(duel, obj) {
    for (const participant of Object.values(duel.participants)) {
      const target = findClientByPeerId(participant.peerId);
      if (target) send(target, obj);
    }
  }

  function sendPvpAcceptFrame(duel, targetPeerId, opponentPeerId, obj) {
    const target = findClientByPeerId(targetPeerId);
    if (target) send(target, { ...obj, from: opponentPeerId, to: targetPeerId });
  }

  function sendPvpError(client, duelId, code, message, extra) {
    const result = blockError(code, message);
    send(client, { t: 'rc:pvp:error', duelId: duelId || null, error: result.error, ...(extra || {}) });
    return result;
  }

  function findClientByPeerId(peerId) {
    for (const client of clients) {
      if (client.id === peerId) return client;
    }
    return null;
  }

  function createPvpDuelId() {
    let duelId;
    do {
      duelId = 'duel-' + crypto.randomBytes(8).toString('hex');
    } while (pvpDuels.has(duelId));
    return duelId;
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
    return blockError(CHAINWELL_BLOCK_RULES.rejectionCodes.rawClientBlock, 'Connected realms only accept server-issued mining work.');
  }

  function appendBlock(block) {
    masterChain.push(block);
    log(`chain block #${block.index} accepted - ${block.txs ? block.txs.length : 0} tx`);
    saveLedger();
    announceFeed.recordBlock(block);
    return { ok: true, block };
  }

  function issueRewardMiningWork(client, source) {
    if (source && source.type === 'enemy') {
      const result = blockError('invalid_reward_source', 'Direct enemy reward claims require a validated solo segment outcome.');
      send(client, { t: 'mine:error', error: result.error });
      return result;
    }
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
    // #89: bound unproven real-time reward claims per character (the kill itself is not
    // server-verified here). Without this, a client can replay kill claims to farm RUNE.
    const rate = checkRewardRate(client.character.id);
    if (!rate.ok) {
      send(client, { t: 'mine:error', error: rate.error });
      return rate;
    }
    const issued = issueMiningCandidate(client, (candidateId) => ({
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
    // Count only successfully issued candidates toward the window (a failed issue mints nothing).
    if (issued.ok) recordRewardIssue(client.character.id);
    return issued;
  }

  // #89 helpers: a per-character sliding-window cap on issued reward candidates.
  function checkRewardRate(characterId) {
    if (!(rewardRateMax > 0)) return { ok: true };
    const cutoff = now() - rewardRateWindowMs;
    const times = (rewardIssueTimes.get(characterId) || []).filter((t) => t > cutoff);
    rewardIssueTimes.set(characterId, times);
    if (times.length >= rewardRateMax) {
      return blockError('reward_rate_limited', 'Too many reward claims in a short window — slow down.');
    }
    return { ok: true };
  }

  function recordRewardIssue(characterId) {
    const times = rewardIssueTimes.get(characterId) || [];
    times.push(now());
    rewardIssueTimes.set(characterId, times);
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
    const replay = settledMiningCandidates.get(candidateId);
    if (replay && replay.accountId === client.accountId && replay.characterId === client.character.id) {
      const result = blockError(CHAINWELL_BLOCK_RULES.rejectionCodes.replayedCandidate, 'Mining candidate has already been accepted.');
      send(client, { t: 'mine:error', error: result.error, chain: masterChain });
      return result;
    }

    const candidate = pendingMining.get(candidateId);
    if (!candidate || candidate.accountId !== client.accountId || candidate.characterId !== client.character.id) {
      const result = blockError(CHAINWELL_BLOCK_RULES.rejectionCodes.unknownCandidate, 'Mining candidate is unknown or no longer valid.');
      send(client, { t: 'mine:error', error: result.error, chain: masterChain });
      return result;
    }

    if (!matchesMiningCandidate(candidate.block, block)) {
      const result = blockError(CHAINWELL_BLOCK_RULES.rejectionCodes.invalidCandidate, 'Submitted block does not match the server-issued mining candidate.');
      send(client, { t: 'mine:error', error: result.error, chain: masterChain });
      return result;
    }

    const tip = masterChain[masterChain.length - 1];
    const canonicalBlock = canonicalMinedBlock(candidate.block, block);
    const result = validateBlockCandidate(canonicalBlock, tip, { sha256, difficulty, now, futureSkewMs });
    if (!result.ok) {
      if (isStaleCandidateError(result.error.code)) pendingMining.delete(candidateId);
      send(client, { t: 'mine:error', error: result.error, chain: masterChain });
      return result;
    }

    pendingMining.delete(candidateId);
    settledMiningCandidates.set(candidateId, {
      accountId: candidate.accountId,
      characterId: candidate.characterId,
      blockHash: canonicalBlock.hash,
      settledAt: now(),
    });
    const accepted = appendBlock(canonicalBlock);
    accountRegistry.applyAcceptedBlock(canonicalBlock);
    const currentCharacter = accountRegistry.getCharacterState(client.accountId);
    if (currentCharacter.ok) client.character = currentCharacter.character;
    send(client, { t: 'mine:accepted', block: canonicalBlock });
    broadcast({ t: 'block', block: canonicalBlock }, client);
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
    for (const [candidateId, candidate] of settledMiningCandidates) {
      if (candidate.settledAt < cutoff) settledMiningCandidates.delete(candidateId);
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

  function canonicalMinedBlock(candidateBlock, submittedBlock) {
    return {
      index: candidateBlock.index,
      prev: candidateBlock.prev,
      time: candidateBlock.time,
      txs: clone(candidateBlock.txs),
      nonce: submittedBlock.nonce,
      hash: submittedBlock.hash,
    };
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
    sweepPvpTurnTimeouts();
    const cutoff = now() - staleThresholdMs;
    for (const client of clients) {
      if (client.id && client.lastStateAt && client.lastStateAt < cutoff) {
        broadcast({ t: 'leave', id: client.id }, client);
        client.last = {};
        client.lastStateAt = 0;
      }
    }
  }

  function finishPvpDuelsForDroppedClient(client) {
    if (!client || !client.id) return;
    for (const duel of pvpDuels.values()) {
      if (duel.status !== 'active' && duel.status !== 'pending') continue;
      const dropped = pvpParticipantByPeer(duel, client.id);
      if (!dropped) continue;
      const opponent = pvpOpponent(duel, client.id);
      if (opponent) {
        finishPvpDuel(duel, {
          winnerPeerId: opponent.peerId,
          loserPeerId: dropped.peerId,
          reason: 'disconnect',
        });
      }
    }
  }

  function close(callback) {
    if (sweepInterval) {
      clearInterval(sweepInterval);
      sweepInterval = null;
    }
    if (halvingInterval) {
      clearInterval(halvingInterval);
      halvingInterval = null;
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
    sweepPvpTurnTimeouts,
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
  const walletChallengeTtlMs = options.walletChallengeTtlMs == null ? 60000 : options.walletChallengeTtlMs;
  const requireIdentity = !!options.requireIdentity;
  const requireWallet = !!options.requireWallet;
  const pendingChallenges = new Map();
  const pendingWalletChallenges = new Map();
  let registry = loadRegistry();
  let identityIndex = identity.buildIndex(registry.accounts); // in-memory uniqueness indices, rebuilt on load
  let agentIndex = agentClaim.buildAgentIndex(registry.accounts); // agentAddress -> accountId (active bindings)
  ensureSeasonState();

  function reindex() {
    identityIndex = identity.buildIndex(registry.accounts);
    agentIndex = agentClaim.buildAgentIndex(registry.accounts);
  }

  // Resolve the account behind an SSO session (sso.sub -> accountId via the binding built at join time).
  function resolveAccountBySso(sso) {
    if (!sso || !sso.sub) return null;
    return identityIndex.sso.get(identity.ssoIndexKey(sso.provider || 'google', sso.sub)) || null;
  }

  // Bind an agent's claimed pubkey to an account (the human confirmed the claim code).
  function bindAgentToAccount(accountId, agentPubkeyB64, label) {
    const account = registry.accounts[accountId];
    if (!account) return accountError('unknown_account', 'Account is unknown.');
    const agent = agentClaim.parseAgentPubkey(agentPubkeyB64);
    if (!agent) return accountError('invalid_agent_key', 'Agent public key is invalid.');
    const owner = agentIndex.get(agent.address);
    if (owner && owner !== accountId) return accountError('agent_in_use', 'That agent is already claimed by another account.');
    const entry = agentClaim.bindAgent(account, agent, label, now());
    saveRegistry();
    reindex();
    return { ok: true, agent: { address: entry.address, label: entry.label, claimedAt: entry.claimedAt } };
  }

  function listAgents(accountId) {
    const account = registry.accounts[accountId];
    if (!account) return accountError('unknown_account', 'Account is unknown.');
    agentClaim.ensureAgentsShape(account);
    return { ok: true, agents: account.agents.filter((a) => !a.revokedAt).map((a) => ({ address: a.address, label: a.label, claimedAt: a.claimedAt, lastSeenAt: a.lastSeenAt })) };
  }

  function revokeAgentForAccount(accountId, address) {
    const account = registry.accounts[accountId];
    if (!account) return accountError('unknown_account', 'Account is unknown.');
    const did = agentClaim.revokeAgent(account, String(address || ''), now());
    if (!did) return accountError('unknown_agent', 'No active agent with that address on this account.');
    saveRegistry();
    reindex();
    return { ok: true };
  }

  // Broker relying-party check: an agent signed `message`; confirm the key is bound + the sig verifies.
  function verifyAgentRequest(agentPubkeyB64, message, signatureB64) {
    const agent = agentClaim.parseAgentPubkey(agentPubkeyB64);
    if (!agent) return accountError('invalid_agent_key', 'Agent public key is invalid.');
    const accountId = agentIndex.get(agent.address);
    if (!accountId) return accountError('agent_not_claimed', 'This agent is not bound to any account.');
    const sig = identity.base64urlDecode(signatureB64);
    if (!sig || sig.length !== 64 || !agentClaim.verifyAgentSignature(agent.raw, String(message || ''), sig)) {
      return accountError('invalid_agent_signature', 'Agent signature does not verify.');
    }
    return { ok: true, accountId, agentAddress: agent.address };
  }

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

  // Verify possession of the device (browser P-256) credential against an outstanding challenge.
  // Shared by the legacy join and the identity-binding join.
  function verifyDeviceCredential(credential) {
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
    return { ok: true, publicKey: parsed.publicKey, accountId };
  }

  function verifyJoin(credential, displayName) {
    const device = verifyDeviceCredential(credential);
    if (!device.ok) return device;
    const binding = bindAccount(device.accountId, device.publicKey, displayName);
    return {
      ok: true,
      accountId: device.accountId,
      seasonId,
      season: getSeasonState(),
      character: clone(binding.character),
      createdAccount: binding.createdAccount,
      createdCharacter: binding.createdCharacter,
    };
  }

  // ---- wallet ownership proof (the REQUIRED economic leg) ----------------------------------------
  function cleanupWalletChallenges() {
    const cutoff = now() - walletChallengeTtlMs;
    for (const [nonce, c] of pendingWalletChallenges) if (c.issuedAt < cutoff) pendingWalletChallenges.delete(nonce);
  }

  function issueWalletChallenge(walletAddress) {
    const addr = sanitizeText(walletAddress, 64);
    if (!addr) return accountError('invalid_wallet', 'A wallet address is required to start a wallet challenge.');
    cleanupWalletChallenges();
    const nonce = 'wnonce_' + crypto.randomBytes(12).toString('hex');
    const issuedAt = now();
    const message = identity.buildWalletChallenge({ seasonId, walletAddress: addr, nonce, issuedAt });
    pendingWalletChallenges.set(nonce, { address: addr, message, issuedAt });
    return { ok: true, challenge: { walletAddress: addr, nonce, message, issuedAt } };
  }

  // Verify a Solana wallet signed our single-use challenge; returns the canonical (server-derived) address.
  function verifyWalletProof(wallet) {
    if (!wallet || typeof wallet !== 'object') return accountError('wallet_proof_missing', 'Wallet proof is required.');
    cleanupWalletChallenges();
    const challenge = pendingWalletChallenges.get(wallet.nonce);
    if (!challenge) return accountError('invalid_wallet_challenge', 'Wallet challenge is unknown, expired, or already used.');
    const pub = identity.base64urlDecode(wallet.publicKey);
    if (!pub || pub.length !== 32) return accountError('invalid_wallet_key', 'Wallet public key must be a 32-byte base64url value.');
    const address = identity.solanaAddress(pub);
    if (address !== challenge.address) return accountError('wallet_address_mismatch', 'Signed wallet does not match the challenged address.');
    const sig = identity.base64urlDecode(wallet.signature);
    if (!sig || sig.length !== 64) return accountError('invalid_wallet_signature', 'Wallet signature must be a 64-byte base64url value.');
    if (!identity.verifyEd25519(pub, challenge.message, sig)) return accountError('invalid_wallet_signature', 'Wallet signature does not verify.');
    pendingWalletChallenges.delete(wallet.nonce);
    return { ok: true, address, chain: !wallet.chain || wallet.chain === 'solana' ? 'solana' : sanitizeText(wallet.chain, 24) };
  }

  // ---- full sign-in: device + SSO + wallet, bound to one account ---------------------------------
  function verifyIdentityJoin(input) {
    input = input || {};
    const displayName = input.name;
    const device = verifyDeviceCredential(input.credential);
    if (!device.ok) return device;

    let walletAddress = null;
    let walletChain = 'solana';
    if (input.wallet) {
      const proof = verifyWalletProof(input.wallet);
      if (!proof.ok) return proof;
      walletAddress = proof.address;
      walletChain = proof.chain;
    }

    const sso = input.sso && input.sso.sub ? input.sso : null;
    const decision = identity.decideBinding({
      deviceAccountId: device.accountId,
      ssoSub: sso ? sso.sub : null,
      ssoProvider: sso ? (sso.provider || 'google') : 'google',
      walletAddress,
      index: identityIndex,
      requireSso: requireIdentity,
      requireWallet: requireWallet,
    });
    if (!decision.ok) return decision;

    const binding = bindAccount(decision.accountId, device.publicKey, displayName);
    const account = registry.accounts[decision.accountId];
    identity.applyIdentityLinks(account, {
      ssoProfile: sso,
      walletAddress,
      walletChain,
      devicePublicKey: device.publicKey,
      deviceType: input.credential && input.credential.type,
      at: now(),
    });
    saveRegistry();
    reindex();
    return {
      ok: true,
      accountId: decision.accountId,
      seasonId,
      season: getSeasonState(),
      character: clone(binding.character),
      createdAccount: binding.createdAccount,
      createdCharacter: binding.createdCharacter,
      identity: identitySummary(account),
    };
  }

  function identitySummary(account) {
    identity.ensureIdentityShape(account);
    return {
      sso: account.identity.sso ? { provider: account.identity.sso.provider, email: account.identity.sso.email, name: account.identity.sso.name } : null,
      wallet: account.identity.wallet ? { chain: account.identity.wallet.chain, address: account.identity.wallet.address } : null,
      devices: account.devices.length,
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

  function recordAuditorEnding(accountId, endingId, at = now()) {
    const found = findCurrentCharacter(accountId);
    if (!found) return accountError('unknown_character', 'Account has no character for this season.');
    const ending = resolveAuditorEnding(endingId);
    if (!ending) return accountError('invalid_auditor_ending', 'Auditor ending must be A, B, or C.');

    normalizeCharacterState(found.character);
    if (found.character.auditorEnding) {
      if (found.character.auditorEnding.id !== ending.id) {
        return accountError('auditor_ending_locked', 'Auditor ending is permanent for this account-bound character.');
      }
      return {
        ok: true,
        ending: publicAuditorEnding(found.character),
        character: clone(found.character),
        alreadyRecorded: true,
      };
    }

    found.character.auditorEnding = createAuditorEndingRecord(ending, at);
    found.character.endgameUnlocked = !!ending.endgame;
    if (ending.sigil) mergeCollection(found.character.collection, { sigils: [ending.sigil] });
    found.character.lastSeenAt = at;
    saveRegistry();
    return {
      ok: true,
      ending: publicAuditorEnding(found.character),
      character: clone(found.character),
      alreadyRecorded: false,
    };
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
    if (hasRecordedSaleInSeason(found.account, found.character.seasonId)) {
      return accountError('season_sale_limit_reached', 'Account already sold a character this season.');
    }
    const season = registry.seasons[found.character.seasonId];
    if (isSeasonOpen(season, at)) return accountError('season_open', 'Cannot sell while the season window is open.');
    if (!isSeasonComplete(found.character, season)) {
      return accountError('season_tasks_unfinished', 'Character is not season-complete.');
    }
    return { ok: true, character: clone(found.character), season: clone(season) };
  }

  // Q-F7a ruling (docs/design/Q-F7a-season-window-ruling.md): a character whose window closed with
  // mandatory tasks unfinished is 'failed' — it keeps its (non-economic) collection, cannot be sold
  // (the cash-out gate stays earned-only), and may re-attempt next season with stats reset to zero.
  //   mid-season       window still open
  //   season-complete  closed + mandatory tasks finished inside the window  → sale-eligible
  //   failed           closed + tasks unfinished, not sold                  → re-attempt next season
  //   sold             already transferred to a buyer
  function characterStatus(accountId, at = now(), characterId) {
    const found = characterId ? findCharacterById(characterId) : findCurrentCharacter(accountId);
    if (!found || found.account.id !== accountId) return accountError('unknown_character', 'Account does not own that character.');
    const character = found.character;
    const season = registry.seasons[character.seasonId];
    const complete = isSeasonComplete(character, season);
    let status;
    if (character.sale) status = 'sold';
    else if (isSeasonOpen(season, at)) status = 'mid-season';
    else if (complete) status = 'season-complete';
    else status = 'failed';
    return {
      ok: true,
      status,
      canSell: status === 'season-complete',
      canReattempt: status === 'failed',
      seasonComplete: complete,
      character: clone(character),
      season: season ? clone(season) : null,
    };
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
      auditorEnding: null,
      endgameUnlocked: false,
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
      const prevSeason = registry.seasons[previous.seasonId];
      // Q-F7a: a 'failed' previous character (window closed, tasks unfinished, never sold) re-attempts
      // next season — it keeps its non-economic collection but its grind stats reset to zero, so
      // failing a season is meaningfully different from completing it. A completer keeps both.
      if (!previous.sale && !isSeasonComplete(previous, prevSeason)) {
        return {
          mode: 'reattempt',
          sourceCharacterId: previous.id,
          sourceSeasonId: previous.seasonId,
          collection: clone(previous.collection),
          stats: zeroStats(),
          statsReset: true,
        };
      }
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

  function hasRecordedSaleInSeason(account, idSeason) {
    normalizeAccountState(account);
    return Object.values(account.characters || {}).some((character) =>
      character && character.seasonId === idSeason && !!character.sale
    );
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
    for (const account of Object.values(data.accounts)) {
      normalizeAccountState(account);
      identity.ensureIdentityShape(account); // additive: migrate legacy publicKey -> devices[]; no file-version bump
      agentClaim.ensureAgentsShape(account); // additive: account.agents[] for claimed grid workers
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

  // ---- Halving support -------------------------------------------------------

  // Return all accounts with their current-season character for halving enumeration.
  function listAllAccounts() {
    return Object.values(registry.accounts).map(acc => ({
      id: acc.id,
      mintedOut: !!acc.mintedOut,
      character: acc.characters && acc.characters[seasonId] ? clone(acc.characters[seasonId]) : null,
    }));
  }

  // Mark the current season's character as minted-out (excluded from Halving).
  function setMintedOut(accountId) {
    const account = registry.accounts[accountId];
    if (!account) return accountError('unknown_account', 'Account not found.');
    const character = account.characters && account.characters[seasonId];
    if (!character) return accountError('no_character', 'No character in current season to mint out.');
    if (account.mintedOut) return { ok: true, already: true };
    account.mintedOut = true;
    account.mintedOutAt = new Date().toISOString();
    saveRegistry();
    return { ok: true };
  }

  // Update active season ID in the registry on Halving fire.
  function setActiveSeason(newSeasonId) {
    registry.activeSeason = newSeasonId;
    saveRegistry();
  }

  return {
    createChallenge,
    verifyJoin,
    issueWalletChallenge,
    verifyWalletProof,
    verifyIdentityJoin,
    getState,
    getSeasonState,
    completeMandatoryTask,
    markSeasonComplete,
    isCharacterSeasonComplete,
    getCharacterState,
    recordCharacterProgress,
    recordAuditorEnding,
    recordCharacterSale,
    canSellCharacter,
    characterStatus,
    applyAcceptedBlock,
    accountIdForPublicKey,
    resolveAccountBySso,
    bindAgentToAccount,
    listAgents,
    revokeAgentForAccount,
    verifyAgentRequest,
    listAllAccounts,
    setMintedOut,
    setActiveSeason,
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
  if (character.auditorEnding && typeof character.auditorEnding === 'object') {
    const ending = resolveAuditorEnding(character.auditorEnding.id);
    character.auditorEnding = ending ? createAuditorEndingRecord(ending, character.auditorEnding.recordedAt) : null;
  } else {
    character.auditorEnding = null;
  }
  character.endgameUnlocked = !!(character.auditorEnding && character.auditorEnding.endgame);
  if (!character.carry || typeof character.carry !== 'object' || Array.isArray(character.carry)) {
    character.carry = { mode: 'legacy', sourceCharacterId: null, sourceSeasonId: null, statsReset: false };
  }
}

function resolveAuditorEnding(id) {
  const key = sanitizeText(id, 8).toUpperCase();
  return AUDITOR_ENDING_BY_ID.get(key) || null;
}

function createAuditorEndingRecord(ending, recordedAt) {
  return {
    id: ending.id,
    key: ending.key,
    title: ending.title,
    recordedAt: timestampOr(recordedAt, 0),
    public: true,
    endgame: !!ending.endgame,
    sigil: ending.sigil || null,
  };
}

function publicAuditorEnding(character) {
  if (!character || !character.auditorEnding) return null;
  const ending = resolveAuditorEnding(character.auditorEnding.id);
  return ending ? createAuditorEndingRecord(ending, character.auditorEnding.recordedAt) : null;
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

// Zero-dep .env loader (no dotenv dependency — A1 buildless). Loaded only when run as a CLI,
// so tests/requires are unaffected. Real process env always wins over the file; missing file is a no-op.
function loadDotEnv(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return; }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    process.env[key] = val;
  }
}

if (require.main === module) {
  loadDotEnv(path.join(__dirname, '.env'));
  createRealmServer().listen();
}

module.exports = {
  AUTHORITY_TIERS,
  CHAINWELL_BLOCK_RULES,
  createRealmServer,
  createAccountRegistry,
  decodeFrame,
  encodeFrame,
};
