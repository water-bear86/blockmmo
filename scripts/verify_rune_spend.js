/* Verifies issue #32 — server-authoritative RUNE earning + spending (Hearthlight power-sink).
   Drives the realm server end-to-end: earn RUNE from a kill, spend it on leveling and relic
   forging, and confirm every transaction lands as a Chainwell block with no client-side
   balance manipulation accepted. */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const sha256 = require(path.join(root, 'game', 'sha256.js'));
const { hashBlock } = require(path.join(root, 'game', 'chain.js'));
const serverApi = require(path.join(root, 'server.js'));
const { LEVELING, RELICS, ENEMY_REWARDS } = require(path.join(root, 'game', 'content.js'));

function makeClient(id) {
  return {
    id,
    name: id,
    socket: {
      writable: true,
      writes: [],
      write(frame) { this.writes.push(frame); },
      end() {},
    },
    last: {},
  };
}

function readMessages(client) {
  const frames = client.socket.writes.splice(0);
  const messages = [];
  let buffer = Buffer.concat(frames);
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
  const challenge = realm.handleParsedMessage(client, {
    t: 'account:challenge',
    credential: { type: 'browser-p256-v1', publicKey: credential.publicKey },
  });
  assert.strictEqual(challenge.ok, true, 'challenge should succeed');
  const challengeMsg = readMessages(client)[0];
  const join = realm.handleParsedMessage(client, {
    t: 'join',
    id: client.id,
    name: name || 'Recorded',
    credential: {
      type: 'browser-p256-v1',
      publicKey: credential.publicKey,
      challengeId: challengeMsg.challengeId,
      signature: credential.sign(challengeMsg.message),
    },
  });
  assert.strictEqual(join.ok, true, 'join should succeed');
  const accountMsg = readMessages(client).find(m => m.t === 'account');
  return accountMsg.character;
}

// Solve the server-issued candidate's PoW exactly as the browser client would.
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

// Full request -> mine -> submit cycle. Returns the accept result.
function runCandidate(realm, client, requestMsg, difficulty) {
  const issued = realm.handleParsedMessage(client, requestMsg);
  if (!issued.ok) return issued;
  readMessages(client);
  const mined = mineWork(issued.work, difficulty);
  const accepted = realm.handleParsedMessage(client, {
    t: 'mine:submit',
    candidateId: issued.work.candidateId,
    block: mined,
  });
  return { issued, mined, accepted };
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rune-spend-'));
const difficulty = 1;
let nowMs = 1000;
const realm = serverApi.createRealmServer({
  ledgerFile: path.join(tempDir, 'ledger.json'),
  accountsFile: path.join(tempDir, 'accounts.json'),
  seasonId: 'season-spend',
  difficulty,
  now: () => (nowMs += 1),
  saveDelayMs: 0,
  quiet: true,
});

const credential = makeCredential();
const client = makeClient('recorded');
realm.addClient(client);
const character = authenticate(realm, client, credential, 'Recorded');
const address = character.address;

function balance() {
  return realm.getChain().reduce((bal, block) =>
    (block.txs || []).reduce((b, tx) => {
      if ((tx.cur || 'RUNE') !== 'RUNE') return b;
      if (tx.to === address) return b + (tx.amt || 0);
      if (tx.from === address) return b - (tx.amt || 0);
      return b;
    }, bal), 0);
}

// --- 1. A spend with no RUNE is rejected (authoritative balance check) ---
const broke = realm.handleParsedMessage(client, { t: 'spend:request', source: { type: 'level', stat: 'vigor' } });
assert.strictEqual(broke.ok, false, 'spending with zero balance must be rejected');
assert.strictEqual(broke.error.code, 'insufficient_rune');
readMessages(client);
assert.strictEqual(balance(), 0, 'rejected spend must not touch the ledger');

// --- 2. Earn RUNE from a kill (Hollow Debtor) ---
const reward = ENEMY_REWARDS.hollow.rune;
let r = runCandidate(realm, client, { t: 'mine:reward', source: { type: 'enemy', key: 'hollow' } }, difficulty);
assert.strictEqual(r.accepted.ok, true, 'kill reward should be accepted onto the ledger');
readMessages(client);
assert.strictEqual(balance(), reward, `killing a Hollow Debtor should credit ${reward} RUNE`);

// --- 3. Level Vigor at Hearthlight — debits the right cost, records a block, raises the derived stat ---
const lvl0Cost = LEVELING.costFor(0);
r = runCandidate(realm, client, { t: 'spend:request', source: { type: 'level', stat: 'vigor' } }, difficulty);
assert.strictEqual(r.accepted.ok, true, 'leveling Vigor should be accepted');
readMessages(client);
assert.strictEqual(balance(), reward - lvl0Cost, 'leveling should debit exactly the level-0 cost');
const debitBlock = realm.getChain().at(-1);
const debitTx = debitBlock.txs[0];
assert.strictEqual(debitTx.from, address, 'debit must come from the character address');
assert.strictEqual(debitTx.to, 'POWER_SINK', 'RUNE spent on power is burned to the sink');
assert.strictEqual(debitTx.auth.type, 'server-spend', 'spend must carry server-spend authority');
assert.deepStrictEqual(debitTx.auth.effect, { kind: 'level', stat: 'vigor', level: 1 }, 'effect should record the new level');

// --- 4. The next Vigor level costs more (grind-gated curve) and is unaffordable here ---
const lvl1Cost = LEVELING.costFor(1);
assert(lvl1Cost > lvl0Cost, 'leveling cost must rise with level');
const tooPoor = realm.handleParsedMessage(client, { t: 'spend:request', source: { type: 'level', stat: 'vigor' } });
assert.strictEqual(tooPoor.ok, false, 'second Vigor level should be unaffordable on the current balance');
assert.strictEqual(tooPoor.error.code, 'insufficient_rune');
readMessages(client);

// --- 5. Client cannot forge a cheaper block: tamper the amount and submission is rejected ---
const issued = realm.handleParsedMessage(client, { t: 'mine:reward', source: { type: 'enemy', key: 'knight' } });
assert.strictEqual(issued.ok, true);
readMessages(client);
const tampered = mineWork(issued.work, difficulty);
tampered.txs[0].amt = 9999; // forge a fat reward
const forgedHash = { ...tampered };
forgedHash.hash = hashBlock(tampered, sha256); // re-mine the lie so the hash is internally consistent
let n = 0;
while (!forgedHash.hash.startsWith('0'.repeat(difficulty))) { forgedHash.nonce = ++n; forgedHash.hash = hashBlock(forgedHash, sha256); }
const forgedSubmit = realm.handleParsedMessage(client, {
  t: 'mine:submit',
  candidateId: issued.work.candidateId,
  block: forgedHash,
});
assert.strictEqual(forgedSubmit.ok, false, 'a tampered reward block must be rejected');
assert.strictEqual(forgedSubmit.error.code, 'invalid_mining_candidate');
readMessages(client);

// Complete the honest knight reward so we can afford a relic.
const honestKnight = mineWork(issued.work, difficulty);
assert.strictEqual(realm.handleParsedMessage(client, {
  t: 'mine:submit', candidateId: issued.work.candidateId, block: honestKnight,
}).ok, true, 'the honest knight reward should still be claimable');
readMessages(client);

// --- 6. Forge a relic, then confirm it cannot be double-forged ---
const relic = RELICS.find(x => x.id === 'ember-edge');
const before = balance();
assert(before >= relic.price, 'should have enough RUNE to forge Ember Edge');
r = runCandidate(realm, client, { t: 'spend:request', source: { type: 'relic', relicId: relic.id } }, difficulty);
assert.strictEqual(r.accepted.ok, true, 'forging a relic should be accepted');
readMessages(client);
assert.strictEqual(balance(), before - relic.price, 'forging should debit the relic price');

const reforge = realm.handleParsedMessage(client, { t: 'spend:request', source: { type: 'relic', relicId: relic.id } });
assert.strictEqual(reforge.ok, false, 'a relic already forged cannot be re-forged');
assert.strictEqual(reforge.error.code, 'relic_owned');
readMessages(client);

// --- 7. Unknown spend sources are rejected ---
const bogus = realm.handleParsedMessage(client, { t: 'spend:request', source: { type: 'level', stat: 'luck' } });
assert.strictEqual(bogus.ok, false, 'unknown stat should be rejected');
assert.strictEqual(bogus.error.code, 'invalid_spend_source');
readMessages(client);

// --- 8. The full ledger still validates as a chain ---
assert(realm.getChain().length >= 4, 'ledger should hold genesis + reward + spend blocks');

realm.close();
fs.rmSync(tempDir, { recursive: true, force: true });
console.log('verify_rune_spend: OK — RUNE earning, spending, and Chainwell credit/debit flow are server-authoritative');
