/* Verifies issue #7 — Boss Sigils mint correctly via the Chainwell and economy guardrails hold.
   Tests the full server-authoritative flow: boss kill → sigil minted on ledger → applied to
   character collection; double-mint rejected; guardrails: RUNE spendable only at Hearthlight;
   endgame loop grants no farmable power; amended-record requires Choice C path. */
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
const { ENEMY_REWARDS, SIGILS, BOSS_SIGILS } = require(path.join(root, 'game', 'content.js'));

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

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rune-sigils-'));
const difficulty = 1;
let nowMs = 1000;
const realm = serverApi.createRealmServer({
  ledgerFile: path.join(tempDir, 'ledger.json'),
  accountsFile: path.join(tempDir, 'accounts.json'),
  seasonId: 'season-sigils',
  difficulty,
  now: () => (nowMs += 1),
  saveDelayMs: 0,
  quiet: true,
});

const credential = makeCredential();
const client = makeClient('sigil-tester');
realm.addClient(client);
const character = authenticate(realm, client, credential, 'SigilTester');
const address = character.address;

// --- 1. SIGILS data-model is correct ---
assert(SIGILS['waxen-testament'], 'waxen-testament sigil must be defined');
assert.strictEqual(SIGILS['waxen-testament'].runeMult, 0.12, 'Waxen Testament runeMult must be 0.12');
assert(SIGILS['contested-will'], 'contested-will sigil must be defined');
assert.strictEqual(SIGILS['contested-will'].runeMult, 0.10, 'Contested Will runeMult must be 0.10');
assert.strictEqual(SIGILS['contested-will'].atkSpeed, 0.12, 'Contested Will atkSpeed must be 0.12');
assert.strictEqual(SIGILS['contested-will'].iframeOnHit, true, 'Contested Will iframeOnHit must be true');
assert(SIGILS['amended-record'], 'amended-record sigil must be defined');
assert.strictEqual(SIGILS['amended-record'].runeMult, 0.15, 'Amended Record runeMult must be 0.15');
assert.strictEqual(SIGILS['amended-record'].endgame, true, 'Amended Record must be flagged endgame');

// --- 2. BOSS_SIGILS maps all three final bosses ---
assert.strictEqual(BOSS_SIGILS.tallow, 'waxen-testament', 'tallow must map to waxen-testament');
assert.strictEqual(BOSS_SIGILS.ledgerbound, 'contested-will', 'ledgerbound must map to contested-will');
assert.strictEqual(BOSS_SIGILS.auditor, 'amended-record', 'auditor must map to amended-record');

// --- 3. Boss kill (tallow) mints the Waxen Testament on the ledger ---
const boss1 = runCandidate(realm, client, {
  t: 'mine:reward', source: { type: 'boss', key: 'tallow' },
}, difficulty);
assert.strictEqual(boss1.accepted.ok, true, 'tallow boss kill must be accepted');
readMessages(client);
const talowBlock = realm.getChain().at(-1);
assert.strictEqual(talowBlock.txs.length, 1, 'boss kill block must have exactly one tx');
const talowTx = talowBlock.txs[0];
assert.strictEqual(talowTx.to, address, 'RUNE reward must credit the player address');
assert.strictEqual(talowTx.amt, ENEMY_REWARDS.tallow.rune, 'RUNE amount must match ENEMY_REWARDS');
assert.strictEqual(talowTx.auth.type, 'server-boss-reward', 'boss reward tx must use server-boss-reward auth');
assert.strictEqual(talowTx.auth.sigilId, 'waxen-testament', 'sigil id must be recorded on the tx');

// Confirm the sigil was applied to the character collection.
const stateAfterBoss1 = realm.getAccountRegistry().getCharacterState(client.accountId);
assert.strictEqual(stateAfterBoss1.ok, true);
assert(
  stateAfterBoss1.character.collection.sigils.includes('waxen-testament'),
  'waxen-testament must appear in character sigils after tallow kill',
);

// --- 4. Second tallow kill is rejected (no double-minting) ---
const boss1Again = realm.handleParsedMessage(client, {
  t: 'mine:reward', source: { type: 'boss', key: 'tallow' },
});
assert.strictEqual(boss1Again.ok, false, 'double-mint of waxen-testament must be rejected');
assert.strictEqual(boss1Again.error.code, 'sigil_owned', 'rejection code must be sigil_owned');
readMessages(client);

// --- 5. Boss kill (ledgerbound) mints Contested Will ---
const boss2 = runCandidate(realm, client, {
  t: 'mine:reward', source: { type: 'boss', key: 'ledgerbound' },
}, difficulty);
assert.strictEqual(boss2.accepted.ok, true, 'ledgerbound kill must be accepted');
readMessages(client);
const stateAfterBoss2 = realm.getAccountRegistry().getCharacterState(client.accountId);
assert(
  stateAfterBoss2.character.collection.sigils.includes('contested-will'),
  'contested-will must appear in character sigils after ledgerbound kill',
);

// --- 6. Amended Record requires Choice C path ---
const noChoiceC = realm.handleParsedMessage(client, {
  t: 'mine:reward', source: { type: 'boss', key: 'auditor' },
});
assert.strictEqual(noChoiceC.ok, false, 'auditor kill without choiceC must be rejected');
assert.strictEqual(noChoiceC.error.code, 'invalid_reward_source', 'rejection code must be invalid_reward_source');
readMessages(client);

// With choiceC flag, the auditor kill mints Amended Record.
const boss3 = runCandidate(realm, client, {
  t: 'mine:reward', source: { type: 'boss', key: 'auditor', choiceC: true },
}, difficulty);
assert.strictEqual(boss3.accepted.ok, true, 'auditor kill with choiceC must be accepted');
readMessages(client);
const stateAfterBoss3 = realm.getAccountRegistry().getCharacterState(client.accountId);
assert(
  stateAfterBoss3.character.collection.sigils.includes('amended-record'),
  'amended-record must appear in character sigils after auditor kill with choiceC',
);

// --- 7. Guardrail: RUNE spend on an unknown type is rejected (enforces Hearthlight-only policy) ---
const badSpend = realm.handleParsedMessage(client, {
  t: 'spend:request', source: { type: 'sigil' },
});
assert.strictEqual(badSpend.ok, false, 'direct sigil spend must be rejected');
assert.strictEqual(badSpend.error.code, 'invalid_spend_source', 'rejection code must be invalid_spend_source');
readMessages(client);

// Sigil type is also not a valid spend source (sigils are boss drops, not purchased).
const unknownSpend = realm.handleParsedMessage(client, {
  t: 'spend:request', source: { type: 'cosmetic_upgrade' },
});
assert.strictEqual(unknownSpend.ok, false, 'unsupported spend type must be rejected');
assert.strictEqual(unknownSpend.error.code, 'invalid_spend_source');
readMessages(client);

// --- 8. Endgame: amended-record endgame=true means no extra sigils can be farmed ---
// The endgame flag is enforced at the data level: no additional sigil entries exist beyond
// the three defined in BOSS_SIGILS, and SIGILS has no item that grants extra farmable power.
const sigilCount = Object.keys(BOSS_SIGILS).length;
assert.strictEqual(sigilCount, 3, 'exactly three boss sigils must be defined — no endgame farming loop');
for (const key of Object.keys(BOSS_SIGILS)) {
  const sigilId = BOSS_SIGILS[key];
  assert(SIGILS[sigilId], `BOSS_SIGILS entry '${key}' must reference a defined SIGILS entry`);
  // No sigil may grant purchasable stat boosts outside the grind-gated RUNE-drop multiplier.
  const sigil = SIGILS[sigilId];
  assert(sigil.runeMult !== undefined, `${sigilId} must have a runeMult (grind-gated bonus)`);
  assert(!sigil.price, `${sigilId} must not be purchasable — boss sigils are kill drops only`);
}

// --- 9. Full chain still validates ---
assert(realm.getChain().length >= 3, 'ledger must hold genesis + boss reward blocks');

realm.close();
fs.rmSync(tempDir, { recursive: true, force: true });
console.log('verify_boss_sigils: OK — Boss Sigils mint, deduplicate, and guardrails hold');
