const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const sha256 = require(path.join(root, 'game', 'sha256.js'));
const chainApi = require(path.join(root, 'game', 'chain.js'));

assert.strictEqual(typeof chainApi.hashBlock, 'function', 'Chainwell should export hashBlock');
assert.strictEqual(typeof chainApi.validateBlockCandidate, 'function', 'Chainwell should export validateBlockCandidate');
assert.strictEqual(typeof chainApi.validateChain, 'function', 'Chainwell should export validateChain');

const { createChain, hashBlock, validateBlockCandidate, validateChain } = chainApi;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mineNextBlock(tip, txs, difficulty, time) {
  const block = {
    index: tip.index + 1,
    prev: tip.hash,
    time,
    txs,
    nonce: 0,
  };
  const target = '0'.repeat(difficulty);
  do {
    block.hash = hashBlock(block, sha256);
    if (block.hash.startsWith(target)) return block;
    block.nonce++;
  } while (block.nonce < 200000);
  throw new Error('test block did not mine within nonce budget');
}

function unminedNextBlock(tip, txs, time) {
  const block = {
    index: tip.index + 1,
    prev: tip.hash,
    time,
    txs,
    nonce: 0,
  };
  while (true) {
    block.hash = hashBlock(block, sha256);
    if (!block.hash.startsWith('00')) return block;
    block.nonce++;
  }
}

function assertRejected(result, code) {
  assert.strictEqual(result.ok, false, `expected ${code} rejection`);
  assert.strictEqual(result.error.code, code);
}

function mineBlock(block, difficulty) {
  const mined = clone(block);
  const target = '0'.repeat(difficulty);
  while (mined.nonce < 200000) {
    mined.hash = hashBlock(mined, sha256);
    if (mined.hash.startsWith(target)) return mined;
    mined.nonce++;
  }
  throw new Error('test block did not mine within nonce budget');
}

const localChain = createChain({ sha256, difficulty: 1 });
const genesis = localChain.chain[0];
const validBlock = mineNextBlock(genesis, [{ to: 'Recorded', amt: 8, note: 'test reward', cur: 'RUNE', id: 'tx-valid' }], 1, 1000);

assert.strictEqual(
  validateBlockCandidate(validBlock, genesis, { sha256, difficulty: 1, now: () => 2000 }).ok,
  true,
  'valid next block should pass block validation'
);
assert.strictEqual(
  validateChain([genesis, validBlock], { sha256, difficulty: 1 }).ok,
  true,
  'valid chain should pass full-chain validation'
);

const tamperedTxs = clone(validBlock);
tamperedTxs.txs[0].amt = 9999;
assertRejected(validateBlockCandidate(tamperedTxs, genesis, { sha256, difficulty: 1, now: () => 2000 }), 'invalid_block_hash');

const wrongParent = mineNextBlock({ ...genesis, hash: 'f'.repeat(64) }, validBlock.txs, 1, 1000);
wrongParent.index = 1;
wrongParent.hash = hashBlock(wrongParent, sha256);
while (!wrongParent.hash.startsWith('0')) {
  wrongParent.nonce++;
  wrongParent.hash = hashBlock(wrongParent, sha256);
}
assertRejected(validateBlockCandidate(wrongParent, genesis, { sha256, difficulty: 1, now: () => 2000 }), 'invalid_block_parent');

const gapIndex = clone(validBlock);
gapIndex.index = 3;
gapIndex.hash = hashBlock(gapIndex, sha256);
while (!gapIndex.hash.startsWith('0')) {
  gapIndex.nonce++;
  gapIndex.hash = hashBlock(gapIndex, sha256);
}
assertRejected(validateBlockCandidate(gapIndex, genesis, { sha256, difficulty: 1, now: () => 2000 }), 'invalid_block_index');

const weakDifficulty = unminedNextBlock(genesis, validBlock.txs, 1000);
assertRejected(validateBlockCandidate(weakDifficulty, genesis, { sha256, difficulty: 2, now: () => 2000 }), 'invalid_block_difficulty');

const invalidNonce = clone(validBlock);
invalidNonce.nonce = -1;
assertRejected(validateBlockCandidate(invalidNonce, genesis, { sha256, difficulty: 1, now: () => 2000 }), 'invalid_block_nonce');

const futureBlock = mineNextBlock(genesis, validBlock.txs, 1, 1000 + 60001);
assertRejected(
  validateBlockCandidate(futureBlock, genesis, { sha256, difficulty: 1, now: () => 1000, futureSkewMs: 60000 }),
  'invalid_block_time'
);

const earlyBlock = mineNextBlock(validBlock, [{ to: 'Recorded', amt: 1, note: 'too early', cur: 'RUNE', id: 'tx-early' }], 1, 999);
assertRejected(validateBlockCandidate(earlyBlock, validBlock, { sha256, difficulty: 1, now: () => 2000 }), 'invalid_block_time');

const malformedTxs = clone(validBlock);
malformedTxs.txs = 'not an array';
malformedTxs.hash = hashBlock(malformedTxs, sha256);
assertRejected(validateBlockCandidate(malformedTxs, genesis, { sha256, difficulty: 1, now: () => 2000 }), 'invalid_block_transactions');

const forkedClient = createChain({ sha256, difficulty: 1 });
forkedClient.reward('Recorded', 8, 'local fork reward');
let orphanedLocalBlock = null;
for (let i = 0; i < 2000 && !orphanedLocalBlock; i++) orphanedLocalBlock = forkedClient.tick(200);
assert(orphanedLocalBlock, 'expected local fork block to mine');
assert.strictEqual(forkedClient.pendingCredit('Recorded'), 0, 'mined local tx should leave the mempool before authority responds');

const competingAuthorityBlock = mineNextBlock(
  forkedClient.chain[0],
  [{ to: 'Other', amt: 1, note: 'peer won the height', cur: 'RUNE', id: 'tx-peer-won' }],
  1,
  orphanedLocalBlock.time
);
assert.strictEqual(
  forkedClient.replaceFromAuthority([forkedClient.chain[0], competingAuthorityBlock]),
  true,
  'client should accept a competing authoritative chain'
);
assert.strictEqual(
  forkedClient.pendingCredit('Recorded'),
  8,
  'transactions from orphaned local blocks should return to the mempool after authority sync'
);

const serverApi = require(path.join(root, 'server.js'));
assert.strictEqual(typeof serverApi.createRealmServer, 'function', 'server should export createRealmServer');
assert.strictEqual(typeof serverApi.decodeFrame, 'function', 'server should export decodeFrame');

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

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chainwell-authority-'));
const ledgerFile = path.join(tempDir, 'ledger.json');
let nowMs = 2000;
const realm = serverApi.createRealmServer({
  ledgerFile,
  difficulty: 1,
  now: () => nowMs,
  saveDelayMs: 0,
  quiet: true,
});
const submitter = makeClient('submitter');
const peer = makeClient('peer');
realm.addClient(submitter);
realm.addClient(peer);

assert.strictEqual(realm.getChain().length, 1, 'empty server ledger should start at genesis');
const serverGenesis = realm.getChain()[0];
const forgedLongerChain = [
  serverGenesis,
  { index: 1, prev: serverGenesis.hash, time: 2000, txs: [], nonce: 0, hash: 'f'.repeat(64) },
  { index: 2, prev: 'f'.repeat(64), time: 2001, txs: [], nonce: 0, hash: 'e'.repeat(64) },
];

realm.handleParsedMessage(submitter, { t: 'join', id: 'submitter', name: 'Recorder', chain: forgedLongerChain });
assert.strictEqual(realm.getChain().length, 1, 'join should not adopt a longer client-supplied chain');
assert.deepStrictEqual(readMessages(submitter)[0], { t: 'chain', chain: [serverGenesis] });

const forgedBlock = mineNextBlock(serverGenesis, [{ to: 'Recorded', amt: 5, note: 'forged', cur: 'RUNE', id: 'tx-forged' }], 1, 2000);
forgedBlock.txs[0].amt = 5000;
const rejected = realm.handleParsedMessage(submitter, { t: 'block', block: forgedBlock });
assertRejected(rejected, 'invalid_block_hash');
assert.strictEqual(realm.getChain().length, 1, 'rejected block should not append');
assert.strictEqual(fs.existsSync(ledgerFile), false, 'rejected block should not save the ledger');
assert.strictEqual(readMessages(peer).length, 0, 'rejected block should not broadcast to peers');
const rejectionMessage = readMessages(submitter)[0];
assert.strictEqual(rejectionMessage.t, 'block:error');
assert.strictEqual(rejectionMessage.error.code, 'invalid_block_hash');
assert.deepStrictEqual(rejectionMessage.chain, [serverGenesis]);

nowMs = 3000;
const unauthorizedRuneCredit = mineNextBlock(
  serverGenesis,
  [{ to: 'Recorded', amt: 5, note: 'client-authored reward', cur: 'RUNE', id: 'tx-client-reward' }],
  1,
  3000
);
const rejectedUnauthorizedCredit = realm.handleParsedMessage(submitter, { t: 'block', block: unauthorizedRuneCredit });
assertRejected(rejectedUnauthorizedCredit, 'unauthorized_rune_credit');
assert.strictEqual(realm.getChain().length, 1, 'unauthorized RUNE credit should not append even with valid PoW');
assert.strictEqual(readMessages(peer).length, 0, 'unauthorized RUNE credit should not broadcast');
assert.strictEqual(readMessages(submitter)[0].error.code, 'unauthorized_rune_credit');

const forgedRuneTransfer = mineNextBlock(
  serverGenesis,
  [{ from: 'FAKE_TREASURY', to: 'Recorded', amt: 500, note: 'forged transfer', cur: 'RUNE', id: 'tx-forged-transfer' }],
  1,
  3001
);
const rejectedForgedTransfer = realm.handleParsedMessage(submitter, { t: 'block', block: forgedRuneTransfer });
assertRejected(rejectedForgedTransfer, 'unauthorized_rune_credit');
assert.strictEqual(realm.getChain().length, 1, 'forged positive RUNE transfer should not append');
assert.strictEqual(readMessages(peer).length, 0, 'forged positive RUNE transfer should not broadcast');
assert.strictEqual(readMessages(submitter)[0].error.code, 'unauthorized_rune_credit');

const acceptedBlock = mineNextBlock(serverGenesis, [{ to: 'AUDIT', amt: 0, note: 'non-reward proof', cur: 'RUNE', id: 'tx-nonreward' }], 1, 3000);
const accepted = realm.handleParsedMessage(submitter, { t: 'block', block: acceptedBlock });
assert.strictEqual(accepted.ok, true, 'valid submitted block should be accepted');
assert.strictEqual(realm.getChain().length, 2, 'accepted block should append');
assert.deepStrictEqual(JSON.parse(fs.readFileSync(ledgerFile, 'utf8')), [serverGenesis, acceptedBlock]);
assert.deepStrictEqual(readMessages(peer)[0], { t: 'block', block: acceptedBlock });
assert.strictEqual(readMessages(submitter).length, 0, 'accepted block should not echo to submitter');

const replayed = realm.handleParsedMessage(submitter, { t: 'block', block: acceptedBlock });
assertRejected(replayed, 'invalid_block_index');
assert.strictEqual(realm.getChain().length, 2, 'replayed block should not append');
assert.strictEqual(readMessages(peer).length, 0, 'replayed block should not broadcast');
assert.strictEqual(readMessages(submitter)[0].error.code, 'invalid_block_index');

nowMs = 4000;
const rewardRequest = realm.handleParsedMessage(submitter, {
  t: 'mine:reward',
  source: { type: 'enemy', key: 'hollow' },
});
assert.strictEqual(rewardRequest.ok, true, 'server should issue mining work for a known RUNE reward source');
const rewardWork = readMessages(submitter)[0];
assert.strictEqual(rewardWork.t, 'mine:work');
assert.strictEqual(rewardWork.work.difficulty, 1);
assert.strictEqual(rewardWork.work.block.index, 2);
assert.strictEqual(rewardWork.work.block.prev, acceptedBlock.hash);
assert.deepStrictEqual(rewardWork.work.block.txs, [{
  to: 'Recorder',
  amt: 14,
  note: 'Hollow Debtor slain',
  cur: 'RUNE',
  id: rewardWork.work.candidateId,
  auth: { type: 'server-reward', source: 'enemy:hollow' },
}]);

const duplicateRewardRequest = realm.handleParsedMessage(submitter, {
  t: 'mine:reward',
  source: { type: 'enemy', key: 'auditor' },
});
assertRejected(duplicateRewardRequest, 'mining_candidate_pending');
assert.strictEqual(realm.getChain().length, 2, 'pending reward work should cap each client at one candidate');
assert.strictEqual(readMessages(submitter)[0].error.code, 'mining_candidate_pending');

const tamperedWork = mineBlock({
  ...rewardWork.work.block,
  txs: [{ ...rewardWork.work.block.txs[0], amt: 1400 }],
}, 1);
const rejectedTamperedWork = realm.handleParsedMessage(submitter, {
  t: 'mine:submit',
  candidateId: rewardWork.work.candidateId,
  block: tamperedWork,
});
assertRejected(rejectedTamperedWork, 'invalid_mining_candidate');
assert.strictEqual(realm.getChain().length, 2, 'tampered server work should not append');
assert.strictEqual(readMessages(peer).length, 0, 'tampered server work should not broadcast');
assert.strictEqual(readMessages(submitter)[0].error.code, 'invalid_mining_candidate');

const minedRewardBlock = mineBlock(rewardWork.work.block, 1);
const acceptedRewardWork = realm.handleParsedMessage(submitter, {
  t: 'mine:submit',
  candidateId: rewardWork.work.candidateId,
  block: minedRewardBlock,
});
assert.strictEqual(acceptedRewardWork.ok, true, 'server-authorized mined reward work should be accepted');
assert.strictEqual(realm.getChain().length, 3, 'accepted reward work should append');
assert.deepStrictEqual(realm.getChain()[2], minedRewardBlock);
assert.deepStrictEqual(readMessages(submitter)[0], { t: 'mine:accepted', block: minedRewardBlock });
assert.deepStrictEqual(readMessages(peer)[0], { t: 'block', block: minedRewardBlock });
assert.deepStrictEqual(JSON.parse(fs.readFileSync(ledgerFile, 'utf8')), [serverGenesis, acceptedBlock, minedRewardBlock]);

realm.close();
fs.rmSync(tempDir, { recursive: true, force: true });

console.log('chainwell authority verification passed');
