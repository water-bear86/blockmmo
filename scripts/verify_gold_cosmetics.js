const assert = require('assert');
const path = require('path');

const root = path.join(__dirname, '..');
const sha256 = require(path.join(root, 'game', 'sha256.js'));
const { createChain } = require(path.join(root, 'game', 'chain.js'));
const { ECON, SKINS } = require(path.join(root, 'game', 'content.js'));

assert.deepStrictEqual(
  ECON.SPLIT,
  { burn: 0.50, marketing: 0.35, ops: 0.15 },
  'mock wSOL split should be 50% burn, 35% marketing, 15% ops'
);
assert.strictEqual(ECON.BURN_ADDR, 'BURN', 'burn address should remain explicit');
assert.strictEqual(ECON.MARKETING_ADDR, 'MARKETING', 'marketing address should replace prize pool terminology');
assert.strictEqual(ECON.OPS_ADDR, 'OPS', 'ops address should replace fee pool terminology');
assert.strictEqual(Object.prototype.hasOwnProperty.call(ECON, 'PRIZE_ADDR'), false, 'Gold economy should not expose PRIZE_ADDR');
assert.strictEqual(Object.prototype.hasOwnProperty.call(ECON.SPLIT, 'prize'), false, 'Gold split should not expose prize terminology');

const forbiddenSkinPowerKeys = [
  'dmg',
  'hp',
  'sta',
  'runeMult',
  'atkSpeed',
  'iframeOnHit',
  'endgame',
  'level',
  'strength',
  'vigor',
  'endurance',
];

assert(Array.isArray(SKINS) && SKINS.length > 1, 'skin registry should be exported');
for (const skin of SKINS) {
  assert(skin.id && skin.name, 'each skin should have an id and display name');
  assert(Number.isFinite(skin.price) && skin.price >= 0, `skin ${skin.id} should have a non-negative Gold price`);
  for (const key of forbiddenSkinPowerKeys) {
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(skin, key),
      false,
      `skin ${skin.id} must remain cosmetic-only and not define ${key}`
    );
  }
}

const chain = createChain({ sha256, difficulty: 1 });
const player = 'Recorded';
const sol = 1;
const gold = +(sol * ECON.GOLD_PER_SOL).toFixed(2);

chain.credit(player, gold, `bought with ${sol} mock wSOL`, 'GOLD');
chain.credit(ECON.BURN_ADDR, sol * ECON.SPLIT.burn, 'burned', 'SOL');
chain.credit(ECON.MARKETING_ADDR, sol * ECON.SPLIT.marketing, 'marketing', 'SOL');
chain.credit(ECON.OPS_ADDR, sol * ECON.SPLIT.ops, 'ops fee', 'SOL');

assert.strictEqual(chain.pendingCredit(player, 'GOLD'), 1000, 'mock wSOL on-ramp should credit Gold only');
assert.strictEqual(chain.tallyTo(ECON.BURN_ADDR, 'SOL'), 0.5, '50% of mock wSOL should route to burn');
assert.strictEqual(chain.tallyTo(ECON.MARKETING_ADDR, 'SOL'), 0.35, '35% of mock wSOL should route to marketing');
assert.strictEqual(chain.tallyTo(ECON.OPS_ADDR, 'SOL'), 0.15, '15% of mock wSOL should route to ops');
assert.strictEqual(chain.balanceOf(player, 'RUNE'), 0, 'Gold on-ramp must not grant RUNE power currency');

let block = null;
for (let i = 0; i < 5000 && !block; i++) block = chain.tick(200);
assert(block, 'expected mock Gold on-ramp block to mine');
assert.strictEqual(chain.balanceOf(player, 'GOLD'), 1000, 'mined mock on-ramp should confirm Gold balance');
assert.strictEqual(chain.balanceOf(player, 'RUNE'), 0, 'mined mock on-ramp must still not grant RUNE');

chain.debit(player, 120, 'skin: Crimson Lord', 'GOLD', 'GOLD_SINK');
chain.mintCosmetic(player, 'crimson');
block = null;
for (let i = 0; i < 5000 && !block; i++) block = chain.tick(200);
assert(block, 'expected cosmetic purchase block to mine');

assert.strictEqual(chain.balanceOf(player, 'GOLD'), 880, 'cosmetic purchase should spend Gold');
assert.strictEqual(chain.balanceOf(player, 'RUNE'), 0, 'cosmetic purchase must not change RUNE');
assert.deepStrictEqual(chain.cosmeticsOf(player), ['crimson'], 'cosmetic purchase should record cosmetic ownership');
assert.deepStrictEqual(chain.itemsOf(player), [], 'cosmetic purchase must not mint gameplay relics/items');
assert.strictEqual(chain.tallyTo('GOLD_SINK', 'GOLD'), 120, 'Gold cosmetic spend should go to the Gold sink');

console.log('gold cosmetic economy verification passed');
