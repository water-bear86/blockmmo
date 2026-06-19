// Verify Area 1 puzzles require deliberate thought (issue #26 / Q-N3).
// The point of the issue is that the old puzzles had "puzzle shape" only — press E N times in
// any order. These must encode a solution ORDER that is NOT recoverable from spatial layout or
// declaration order, so the player has to read the clue and DEDUCE it. The host engine must never
// reveal the order.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const content = require(path.join(root, 'game', 'content.js'));
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const PUZZLES = content.AREA1_PUZZLES;
assert(Array.isArray(PUZZLES) && PUZZLES.length >= 2, 'AREA1_PUZZLES should export >= 2 puzzles');

const sameArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

for (const p of PUZZLES) {
  assert(p.id && p.title, 'puzzle needs id + title');
  assert(Array.isArray(p.nodes) && p.nodes.length >= 3, p.id + ' needs >= 3 nodes');
  assert(p.clue && Array.isArray(p.clue.lines) && p.clue.lines.length >= 2, p.id + ' needs a clue with >= 2 lines');
  assert(p.clue.label && typeof p.clue.x === 'number' && typeof p.clue.y === 'number', p.id + ' clue needs label + position');
  assert(typeof p.stamp === 'string' && typeof p.wrong === 'string', p.id + ' needs stamp + wrong feedback');
  assert(Array.isArray(p.solvedLore) && p.solvedLore.length >= 1, p.id + ' needs solvedLore payoff');

  const nodeIds = p.nodes.map((n) => n.id);
  assert(new Set(nodeIds).size === nodeIds.length, p.id + ' node ids must be unique');
  // order is a full permutation of the node ids (every node used exactly once).
  assert(Array.isArray(p.order) && p.order.length === nodeIds.length, p.id + ' order must cover every node');
  assert(p.order.every((id) => nodeIds.includes(id)) && new Set(p.order).size === p.order.length,
    p.id + ' order must be a permutation of node ids');

  // NON-TRIVIAL: the solution order must differ from spatial (x-sorted) order and from the raw
  // declaration order — otherwise it could be solved without reading the clue.
  const byX = [...p.nodes].sort((a, b) => a.x - b.x).map((n) => n.id);
  assert(!sameArr(p.order, byX), p.id + ' order must NOT equal left-to-right spatial order (would be trivial)');
  assert(!sameArr(p.order, nodeIds), p.id + ' order must NOT equal declaration order (would be trivial)');

  // Every node carries a readable inscription (the per-stone clue the player reasons over).
  for (const n of p.nodes) assert(n.label && n.inscription, p.id + ' node ' + n.id + ' needs label + inscription');
}

// Sanity on the reconciliation puzzle: the intended order is ascending by debt value.
const recon = PUZZLES.find((p) => p.id === 'reconciliation');
if (recon) {
  const valOf = (id) => recon.nodes.find((n) => n.id === id).value;
  const asc = [...recon.order].sort((a, b) => valOf(a) - valOf(b));
  assert(sameArr(recon.order, asc), 'reconciliation order must be ascending by value (matches its clue)');
}

// Host wiring in index.html — engine consumes the data and never leaks the order.
for (const sym of ['AREA1_PUZZLES', 'progress.puzzles', 'function nearestPuzzleTarget', 'function stampPuzzle', 'function readPuzzleClue', 'function drawPuzzles']) {
  assert(index.includes(sym), 'index.html must wire ' + sym);
}
assert(/stampPuzzle\(pz\.puzzle,pz\.node\)/.test(index), 'doInteract must route node stamps through stampPuzzle');
assert(/drawPuzzles\(\)/.test(index), 'render loop must call drawPuzzles()');
// Guard against regressing to a trivial implementation: the engine must compare against p.order.
assert(/p\.order\[idx\]/.test(index), 'stampPuzzle must validate against the expected order index');

console.log('area1 puzzles verification passed (' + PUZZLES.length + ' puzzles; order non-trivial, clue-gated)');
