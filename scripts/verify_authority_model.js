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
    name: name || client.name,
    credential: {
      type: 'browser-p256-v1',
      publicKey: credential.publicKey,
      challengeId: challengeMsg.challengeId,
      signature: credential.sign(challengeMsg.message),
    },
  });
  assert.strictEqual(join.ok, true, 'join should succeed');
  const messages = readMessages(client);
  return messages.find((m) => m.t === 'account');
}

function mineWork(work, difficulty) {
  const block = JSON.parse(JSON.stringify(work.block));
  const target = '0'.repeat(difficulty);
  block.nonce = 0;
  while (block.nonce < 5_000_000) {
    block.hash = hashBlock(block, sha256);
    if (block.hash.startsWith(target)) return block;
    block.nonce += 1;
  }
  throw new Error('PoW budget exhausted');
}

function assertRejected(result, code) {
  assert.strictEqual(result.ok, false, 'expected rejection ' + code);
  assert.strictEqual(result.error.code, code);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-model-'));
const difficulty = 1;
let nowMs = 10_000;
const realm = serverApi.createRealmServer({
  ledgerFile: path.join(tempDir, 'ledger.json'),
  accountsFile: path.join(tempDir, 'accounts.json'),
  seasonId: 'authority-model',
  difficulty,
  now: () => (nowMs += 1),
  saveDelayMs: 0,
  quiet: true,
});

const recorded = makeClient('recorded');
const peer = makeClient('peer');
realm.addClient(recorded);
realm.addClient(peer);

const account = authenticate(realm, recorded, makeCredential(), 'Recorded');
authenticate(realm, peer, makeCredential(), 'Witness');

assert.strictEqual(serverApi.AUTHORITY_TIERS.authoritative.includes('rune-credit-debit'), true, 'server should export authoritative RUNE policy');
assert.strictEqual(serverApi.AUTHORITY_TIERS.validated.includes('solo-segment-outcome'), true, 'server should export validated solo-segment policy');
assert.strictEqual(serverApi.AUTHORITY_TIERS.nonAuthoritative.includes('movement-relay'), true, 'server should export non-authoritative movement policy');

// Non-authoritative: movement/state relay survives but is canonicalized by the server identity.
const move = realm.handleParsedMessage(recorded, {
  t: 'state',
  id: 'forged-id',
  characterId: 'fake-character',
  name: 'Mallory',
  skin: 'specter',
  x: 12,
  y: 1,
  z: 34,
  yaw: 0.5,
  moving: true,
});
assert.strictEqual(move.ok, true, 'casual movement relay should remain accepted');
assert.deepStrictEqual(readMessages(peer)[0], {
  t: 'state',
  id: account.peerId,
  characterId: account.character.id,
  name: 'Recorded',
  skin: 'specter',
  x: 12,
  y: 1,
  z: 34,
  yaw: 0.5,
  moving: true,
});

// Authoritative: raw client ledger blocks never append, even if they are internally valid.
const genesis = realm.getChain()[0];
const forgedBlock = {
  index: 1,
  prev: genesis.hash,
  time: nowMs + 1,
  txs: [{ to: account.character.address, amt: 999, note: 'forged local credit', cur: 'RUNE', id: 'forged' }],
  nonce: 0,
  hash: '',
};
while (true) {
  forgedBlock.hash = hashBlock(forgedBlock, sha256);
  if (forgedBlock.hash.startsWith('0'.repeat(difficulty))) break;
  forgedBlock.nonce += 1;
}
assertRejected(realm.handleParsedMessage(recorded, { t: 'block', block: forgedBlock }), 'client_block_submission_disabled');
assert.strictEqual(realm.getChain().length, 1, 'raw client block must not append');
readMessages(recorded);
assert.strictEqual(readMessages(peer).length, 0, 'raw client block must not broadcast');

// Authoritative PvP outcomes are not relay messages; they require server arbitration.
const pvpResult = realm.handleParsedMessage(recorded, {
  t: 'rc:pvp:result',
  duelId: 'duel-forged',
  winner: account.peerId,
  loser: 'peer_fake',
  reason: 'forged-result',
});
assertRejected(pvpResult, 'authoritative_message_requires_server');
assert.strictEqual(readMessages(peer).length, 0, 'forged PvP result must not relay to peers');
assert.strictEqual(readMessages(recorded)[0].error.code, 'authoritative_message_requires_server');

// Validated: solo-segment outcomes can request ledger-touching rewards only after server checks shape/source.
const badSolo = realm.handleParsedMessage(recorded, {
  t: 'segment:complete',
  outcome: { mode: 'platformer', segmentId: 'seg-bogus', reward: { type: 'enemy', key: 'hollow' } },
});
assertRejected(badSolo, 'invalid_segment_outcome');
assert.strictEqual(readMessages(recorded)[0].error.code, 'invalid_segment_outcome');

const issued = realm.handleParsedMessage(recorded, {
  t: 'segment:complete',
  outcome: {
    mode: 'platformer',
    segmentId: 'seg-platformer-hollow',
    source: { type: 'enemy', key: 'hollow' },
    proof: { completed: true, kills: [{ key: 'hollow', count: 1 }] },
  },
});
assert.strictEqual(issued.ok, true, 'validated solo segment outcome should issue server mining work');
assert.strictEqual(issued.work.block.txs[0].auth.type, 'server-validated-outcome', 'validated outcome rewards should be marked distinctly');
assert.strictEqual(issued.work.block.txs[0].auth.tier, 'validated', 'validated outcome rewards should carry the validated tier');
const workMsg = readMessages(recorded)[0];
assert.strictEqual(workMsg.t, 'mine:work');

const duplicate = realm.handleParsedMessage(recorded, {
  t: 'segment:complete',
  outcome: {
    mode: 'platformer',
    segmentId: 'seg-platformer-hollow',
    source: { type: 'enemy', key: 'hollow' },
    proof: { completed: true, kills: [{ key: 'hollow', count: 1 }] },
  },
});
assertRejected(duplicate, 'segment_outcome_replayed');
assert.strictEqual(readMessages(recorded)[0].error.code, 'segment_outcome_replayed');

const tamperedWork = mineWork(issued.work, difficulty);
tamperedWork.txs[0].amt = 9999;
tamperedWork.hash = hashBlock(tamperedWork, sha256);
while (!tamperedWork.hash.startsWith('0'.repeat(difficulty))) {
  tamperedWork.nonce += 1;
  tamperedWork.hash = hashBlock(tamperedWork, sha256);
}
assertRejected(realm.handleParsedMessage(recorded, {
  t: 'mine:submit',
  candidateId: issued.work.candidateId,
  block: tamperedWork,
}), 'invalid_mining_candidate');
assert.strictEqual(realm.getChain().length, 1, 'tampered validated outcome work must not append');
readMessages(recorded);

const honestBlock = mineWork(issued.work, difficulty);
assert.strictEqual(realm.handleParsedMessage(recorded, {
  t: 'mine:submit',
  candidateId: issued.work.candidateId,
  block: honestBlock,
}).ok, true, 'honest validated outcome mining work should append');
assert.strictEqual(realm.getChain().length, 2, 'honest validated outcome should touch the ledger after server sign-off');
assert.deepStrictEqual(realm.getChain()[1], honestBlock);
readMessages(recorded);
readMessages(peer);

realm.close();
fs.rmSync(tempDir, { recursive: true, force: true });
console.log('authority model verification passed');
