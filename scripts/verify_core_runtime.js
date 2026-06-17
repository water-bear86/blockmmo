const assert = require('assert');
const path = require('path');

const root = path.join(__dirname, '..');
const sha256 = require(path.join(root, 'game', 'sha256.js'));
const { createChain } = require(path.join(root, 'game', 'chain.js'));
const content = require(path.join(root, 'game', 'content.js'));

assert.strictEqual(
  sha256('abc'),
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  'SHA-256 should match the standard abc test vector'
);

let minedBlock = null;
const chain = createChain({ sha256, difficulty: 1, onBlockMined: (block) => { minedBlock = block; } });
chain.reward('Recorded', 8, 'story: Hearthlight Chapel');

let block = null;
for (let i = 0; i < 2000 && !block; i++) block = chain.tick(200);

assert(block, 'expected a low-difficulty block to mine');
assert.strictEqual(minedBlock, block, 'mined block callback should receive the accepted block');
assert.strictEqual(chain.balanceOf('Recorded'), 8, 'confirmed RUNE balance should include mined reward');
assert.strictEqual(chain.pendingCredit('Recorded'), 0, 'mined tx should leave no pending reward');

assert.strictEqual(content.ECON.GOLD_PER_RUNE, 1, 'economy table should be exported');
assert.deepStrictEqual(
  content.ECON.SPLIT,
  { burn: 0.50, marketing: 0.35, ops: 0.15 },
  'wSOL settlement split should be burn/marketing/ops, not prize pool'
);
assert.strictEqual(content.ECON.MARKETING_ADDR, 'MARKETING', 'marketing address should be exported');
assert.strictEqual(content.ECON.OPS_ADDR, 'OPS', 'ops address should be exported');
assert.strictEqual(Object.prototype.hasOwnProperty.call(content.ECON, 'PRIZE_ADDR'), false, 'economy should not expose prize pool terminology');
assert.strictEqual(Object.prototype.hasOwnProperty.call(content.ECON.SPLIT, 'prize'), false, 'economy split should not expose prize pool terminology');
assert.strictEqual(content.STORY.startQuest, 'q01', 'story should start at Hearthlight Chapel');
assert(content.STORY.quests.some((quest) => quest.id === 'q13'), 'full story table should be exported');
assert(content.ASSETS.player.src.endsWith('/player.png'), 'asset manifest should include the player sheet');
assert(content.AREA1_ENCOUNTERS.tallow.segments.length === 3, 'boss encounter data should be exported');

console.log('core runtime verification passed');
