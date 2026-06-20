// Verify Area 1 explorable-world content (issue #25):
//   - >= 3 off-path lore discoveries (off the q01-q05 quest corridor)
//   - >= 1 hidden dead-end whose reward is a cosmetic (never power, never purchasable)
//   - the reward cosmetic is exploration-exclusive (secret, price 0, hidden from the shop)
//   - the index.html host actually consumes the data (markers, discovery, Codex, mint).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const content = require(path.join(root, 'game', 'content.js'));
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const LORE = content.AREA1_LORE;
assert(Array.isArray(LORE) && LORE.length >= 4, 'AREA1_LORE should export >= 4 lore nodes');

// Each node is well-formed: id, title, position, and >= 2 authored lines.
const ids = new Set();
for (const n of LORE) {
  assert(n.id && !ids.has(n.id), 'lore node needs a unique id: ' + JSON.stringify(n));
  ids.add(n.id);
  assert(typeof n.title === 'string' && n.title.length, n.id + ' needs a title');
  assert(typeof n.x === 'number' && typeof n.y === 'number', n.id + ' needs x/y');
  assert(Math.abs(n.x) <= 2400 && Math.abs(n.y) <= 2400, n.id + ' must be inside the world bounds');
  assert(Array.isArray(n.lines) && n.lines.length >= 2, n.id + ' needs >= 2 authored lore lines');
}

// Off-path: the q01-q05 quest interactables cluster near y in [-140,140] and x in [-112,900].
// A discovery counts as "off-path" if it sits well outside that corridor.
const offPath = LORE.filter((n) => Math.abs(n.y) > 200 || n.x < -200);
assert(offPath.length >= 3, 'at least 3 lore discoveries must sit off the quest path (found ' + offPath.length + ')');

// Hidden dead-end with a cosmetic/lore reward.
const rewardNodes = LORE.filter((n) => n.reward);
assert(rewardNodes.length >= 1, 'at least one lore node must grant a reward (hidden room)');
for (const n of rewardNodes) {
  const skin = content.SKINS.find((s) => s.id === n.reward);
  assert(skin, n.id + ' reward must reference a real SKINS entry: ' + n.reward);
  assert(skin.secret === true, 'reward cosmetic ' + skin.id + ' must be secret (exploration-only)');
  assert(!skin.price, 'reward cosmetic ' + skin.id + ' must not be purchasable (price falsy/0)');
}

// The secret cosmetic must be hidden from the wardrobe shop until owned.
assert(/s\.secret&&!own/.test(index), 'wardrobe must skip secret skins until owned (s.secret&&!own)');

// Host wiring in index.html.
for (const sym of ['AREA1_LORE', 'progress.lore', 'progress.cosmetics', 'function nearestLore', 'function discoverLore', 'function drawLore']) {
  assert(index.includes(sym), 'index.html must wire ' + sym);
}
// The exploration reward is a client-side unlock (not a Gold purchase) and ownedSkin consults it.
assert(/progress\.cosmetics\.add\(node\.reward\)/.test(index), 'discoverLore must grant the reward via progress.cosmetics (client-side unlock, not on-chain spend)');
assert(/progress\.cosmetics&&progress\.cosmetics\.has\(id\)/.test(index), 'ownedSkin must treat exploration-earned cosmetics as owned');
// discoverLore must mint the reward cosmetic and the render loop must draw the markers.
assert(/discoverLore\(lore\)/.test(index), 'doInteract must call discoverLore for nearby lore');
assert(/drawLore\(\)/.test(index), 'render loop must call drawLore()');

console.log('area1 exploration verification passed (' + LORE.length + ' lore nodes, ' + offPath.length + ' off-path, ' + rewardNodes.length + ' hidden-room reward; cosmetic-only)');
