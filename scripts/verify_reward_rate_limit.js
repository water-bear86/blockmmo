/* Verifies issue #89 — unproven real-time reward claims (mine:reward) are rate-limited per
   character so a client cannot farm unbounded RUNE by replaying kill claims. The real-time arena
   has no kill proof (unlike the proven solo `segment:complete` path), so a per-character rolling
   window caps issuance. This guards the economy + the cash-out gate without changing legit play. */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const sha256 = require(path.join(root, 'game', 'sha256.js'));
const { hashBlock } = require(path.join(root, 'game', 'chain.js'));
const serverApi = require(path.join(root, 'server.js'));

function makeClient(id) {
  return {
    id,
    name: id,
    socket: { writable: true, writes: [], write(frame) { this.writes.push(frame); }, end() {} },
    last: {},
  };
}

function readMessages(client) {
  const frames = client.socket.writes.splice(0);
  let buffer = frames.length ? Buffer.concat(frames) : Buffer.alloc(0);
  const messages = [];
  while (buffer.length) {
    const frame = serverApi.decodeFrame(buffer);
    assert(frame, 'expected complete server frame');
    messages.push(JSON.parse(frame.payload.toString('utf8')));
    buffer = frame.rest;
  }
  return messages;
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function makeCredential() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    publicKey: publicKey.export({ format: 'jwk' }),
    sign(message) {
      return base64url(crypto.sign('sha256', Buffer.from(message), { key: privateKey, dsaEncoding: 'ieee-p1363' }));
    },
  };
}

function authenticate(realm, client, credential, name) {
  realm.handleParsedMessage(client, { t: 'account:challenge', credential: { type: 'browser-p256-v1', publicKey: credential.publicKey } });
  const challengeMsg = readMessages(client)[0];
  const join = realm.handleParsedMessage(client, {
    t: 'join', id: client.id, name,
    credential: { type: 'browser-p256-v1', publicKey: credential.publicKey, challengeId: challengeMsg.challengeId, signature: credential.sign(challengeMsg.message) },
  });
  assert.strictEqual(join.ok, true, 'join should succeed');
  return readMessages(client).find((m) => m.t === 'account').character;
}

function mineWork(work, difficulty) {
  const block = JSON.parse(JSON.stringify(work.block));
  const target = '0'.repeat(difficulty);
  block.nonce = 0;
  for (;;) {
    block.hash = hashBlock(block, sha256);
    if (block.hash.startsWith(target)) return block;
    block.nonce += 1;
    if (block.nonce > 5_000_000) throw new Error('PoW budget exhausted');
  }
}

// Full reward cycle: request work -> solve PoW -> submit. Returns the issuance result if the
// server refused to issue work (e.g. rate-limited), else the accepted result.
function rewardCycle(realm, client, difficulty) {
  const issued = realm.handleParsedMessage(client, { t: 'mine:reward', source: { type: 'enemy', key: 'hollow' } });
  if (!issued.ok) return { issued };
  readMessages(client);
  const accepted = realm.handleParsedMessage(client, { t: 'mine:submit', candidateId: issued.work.candidateId, block: mineWork(issued.work, difficulty) });
  readMessages(client);
  return { issued, accepted };
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reward-rate-'));
const difficulty = 1;
let nowMs = 1000;
const windowMs = 100_000;
const realm = serverApi.createRealmServer({
  ledgerFile: path.join(tempDir, 'ledger.json'),
  accountsFile: path.join(tempDir, 'accounts.json'),
  seasonId: 'reward-rate',
  difficulty,
  rewardRateMax: 3,
  rewardRateWindowMs: windowMs,
  now: () => (nowMs += 1),
  saveDelayMs: 0,
  quiet: true,
});

const client = makeClient('farmer');
realm.addClient(client);
authenticate(realm, client, makeCredential(), 'Farmer');

// Up to the cap, claims are issued and accepted.
for (let i = 0; i < 3; i += 1) {
  const r = rewardCycle(realm, client, difficulty);
  assert.strictEqual(r.accepted && r.accepted.ok, true, 'reward ' + (i + 1) + ' within the cap should be accepted');
}

// The next claim inside the same window is rate-limited at issuance (no work handed out).
const overCap = rewardCycle(realm, client, difficulty);
assert.strictEqual(overCap.issued.ok, false, 'claim beyond the cap must be refused');
assert.strictEqual(overCap.issued.error.code, 'reward_rate_limited', 'over-cap refusal must be reward_rate_limited');
assert.strictEqual(overCap.accepted, undefined, 'no mining work is issued for a rate-limited claim');

// After the window slides, claims are allowed again (it is a rolling cap, not a hard ceiling).
nowMs += windowMs + 1_000;
const afterWindow = rewardCycle(realm, client, difficulty);
assert.strictEqual(afterWindow.accepted && afterWindow.accepted.ok, true, 'claims resume after the window slides');

realm.close();

// rewardRateMax <= 0 disables the cap entirely (the documented escape hatch).
const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'reward-rate-off-'));
let now2 = 5000;
const realm2 = serverApi.createRealmServer({
  ledgerFile: path.join(tempDir2, 'ledger.json'),
  accountsFile: path.join(tempDir2, 'accounts.json'),
  seasonId: 'reward-rate-off',
  difficulty,
  rewardRateMax: 0,
  now: () => (now2 += 1),
  saveDelayMs: 0,
  quiet: true,
});
const client2 = makeClient('farmer-unbounded');
realm2.addClient(client2);
authenticate(realm2, client2, makeCredential(), 'Unbounded');
for (let i = 0; i < 6; i += 1) {
  const r = rewardCycle(realm2, client2, difficulty);
  assert.strictEqual(r.accepted && r.accepted.ok, true, 'with the cap disabled, claim ' + (i + 1) + ' is accepted');
}
realm2.close();

fs.rmSync(tempDir, { recursive: true, force: true });
fs.rmSync(tempDir2, { recursive: true, force: true });
console.log('reward rate-limit verification passed (#89)');
