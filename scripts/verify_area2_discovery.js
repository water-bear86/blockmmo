// Verify Area 2 (The Shroud Vaults) S1 content — closes issues #175 / #176 / #178.
//
// Area 2 was authored to Area-1 parity but had no dedicated regression guard (only
// verify_area2_forks covers the Canon/Schism fork mechanic). This locks in the rest so a
// multi-agent edit cannot silently gut the vault's discovery content, NPC dialogue, or
// walk-in interiors and still ship a "complete" Season 1.
//
//   #178  AREA2_LORE (4 fragments + 1 secret cosmetic vault), AREA2_PUZZLES (2 ordered
//         puzzles), PLAT_DEBT_MINES enemies (7 named), secret skins, index.html wiring.
//   #175  All 5 Shroud-Vault NPCs carry full branching dialogue (intro/again/farewell + topics).
//   #176  4 walk-in Area 2 interiors, each a valid INTERIORS entry with a dialogue NPC.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const content = require(path.join(root, 'game', 'content.js'));
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// ── #178 · AREA2_LORE ──────────────────────────────────────────────────────
const LORE = content.AREA2_LORE;
assert(Array.isArray(LORE) && LORE.length >= 4, 'AREA2_LORE should export >= 4 lore fragments');
const loreIds = new Set();
for (const n of LORE) {
  assert(n.id && !loreIds.has(n.id), 'lore fragment needs a unique id: ' + JSON.stringify(n));
  loreIds.add(n.id);
  assert(typeof n.title === 'string' && n.title.length, n.id + ' needs a title');
  assert(typeof n.x === 'number' && typeof n.y === 'number', n.id + ' needs numeric x/y');
  assert(Math.abs(n.x) <= 2400 && Math.abs(n.y) <= 2400, n.id + ' must sit inside world bounds');
  assert(Array.isArray(n.lines) && n.lines.length >= 2, n.id + ' needs >= 2 authored lore lines');
}
// The Shroud Vaults live east of the Gracefall parish — fragments must cluster there.
const inVaults = LORE.filter((n) => n.x >= 800);
assert(inVaults.length >= 3, 'at least 3 lore fragments must sit in the Shroud Vaults (x >= 800); found ' + inVaults.length);

// Exactly the exploration-exclusive secret vault, rewarding a cosmetic (never power/purchase).
const loreRewards = LORE.filter((n) => n.reward);
assert(loreRewards.length >= 1, 'AREA2_LORE needs a hidden vault that grants a reward cosmetic');
for (const n of loreRewards) {
  assert(n.secret === true, n.id + ' reward vault must be secret');
  const skin = content.SKINS.find((s) => s.id === n.reward);
  assert(skin, n.id + ' reward must reference a real SKINS entry: ' + n.reward);
  assert(skin.secret === true, 'reward cosmetic ' + skin.id + ' must be secret (exploration-only)');
  assert(!skin.price, 'reward cosmetic ' + skin.id + ' must not be purchasable (price falsy/0)');
}
assert(loreRewards.some((n) => n.reward === 'fork-pilgrim'), 'the secret Area 2 vault must grant the fork-pilgrim cosmetic');

// ── #178 · AREA2_PUZZLES ───────────────────────────────────────────────────
const PUZZLES = content.AREA2_PUZZLES;
assert(Array.isArray(PUZZLES) && PUZZLES.length >= 2, 'AREA2_PUZZLES should export >= 2 puzzles');
const puzzleIds = PUZZLES.map((p) => p.id);
for (const wanted of ['fork-sequence', 'debt-chain-trace']) {
  assert(puzzleIds.includes(wanted), 'AREA2_PUZZLES must include the ' + wanted + ' puzzle');
}
for (const p of PUZZLES) {
  assert(typeof p.clue === 'string' && p.clue.length, p.id + ' needs a clue');
  assert(Array.isArray(p.nodes) && p.nodes.length >= 3, p.id + ' needs >= 3 sequence nodes');
  // Solvable-but-non-trivial: an explicit order must exist and cover 1..N with no gaps.
  const orders = p.nodes.map((nd) => nd.order).sort((a, b) => a - b);
  orders.forEach((o, i) => assert(o === i + 1, p.id + ' node order must be a contiguous 1..N sequence'));
  assert(Array.isArray(p.solvedLore) && p.solvedLore.length >= 1, p.id + ' needs solvedLore payoff text');
}

// ── #178 · PLAT_DEBT_MINES enemies ─────────────────────────────────────────
const mines = content.PLAT_DEBT_MINES;
assert(mines && Array.isArray(mines.enemies), 'PLAT_DEBT_MINES must carry an enemies array');
const enemyIds = mines.enemies.map((e) => e.id);
for (const wanted of ['canon-acolyte-1', 'canon-acolyte-2', 'schism-specter-1', 'schism-specter-2', 'debt-ghost', 'ledger-eye', 'debt-warden']) {
  assert(enemyIds.includes(wanted), 'PLAT_DEBT_MINES must spawn the ' + wanted + ' enemy');
}
assert(mines.enemies.length >= 7, 'PLAT_DEBT_MINES needs >= 7 named enemies; found ' + mines.enemies.length);
for (const e of mines.enemies) {
  assert(e.hp > 0 && e.damage > 0 && e.speed > 0, e.id + ' needs positive hp/damage/speed');
  assert(typeof e.patrolMin === 'number' && typeof e.patrolMax === 'number' && e.patrolMax > e.patrolMin, e.id + ' needs a valid patrol range');
}

// ── #178 · secret cosmetics ────────────────────────────────────────────────
for (const id of ['fork-pilgrim', 'canon-clerk']) {
  const skin = content.SKINS.find((s) => s.id === id);
  assert(skin, 'SKINS must define the ' + id + ' Area 2 cosmetic');
  assert(skin.secret === true && !skin.price, id + ' must be secret and unpurchasable');
}

// ── #175 · all 5 Shroud-Vault NPCs have full branching dialogue ────────────
// Dialogue lives across the overworld NPCS array and the walk-in INTERIORS.
const dialogueByName = new Map();
const collect = (npc) => {
  if (npc && npc.name && npc.dialogue && npc.dialogue.nodes) dialogueByName.set(npc.name, npc.dialogue);
};
(content.NPCS || []).forEach(collect);
(content.INTERIORS || []).forEach((it) => (it.npcs || []).forEach(collect));

const area2Npcs = ['Keeper of Ancestry', 'Custodian Archivist', 'Librarian Shade', 'Keeper of Margins', 'Vault Custodians'];
assert((content.AREA2_TOWN.npcs || []).length >= 5, 'AREA2_TOWN roster must list >= 5 NPCs');
for (const name of area2Npcs) {
  const d = dialogueByName.get(name);
  assert(d, name + ' must have an authored dialogue tree');
  assert(d.nodes.intro, name + ' dialogue needs an intro node');
  assert(d.nodes[d.repeat || 'again'], name + ' dialogue needs a repeat node');
  // A real tree: intro branches, and at least one node ends the conversation.
  assert(Array.isArray(d.nodes.intro.choices) && d.nodes.intro.choices.length >= 2, name + ' intro needs >= 2 choices');
  assert(Object.values(d.nodes).some((n) => n.end === true), name + ' needs a farewell (end:true) node');
}

// ── #176 · 4 walk-in Area 2 interiors ──────────────────────────────────────
const wantInteriors = ['vault-registry', 'fissured-cistern', 'archivist-reading-room', 'margin-chamber'];
for (const id of wantInteriors) {
  const it = (content.INTERIORS || []).find((x) => x.id === id);
  assert(it, 'Area 2 interior "' + id + '" must exist in INTERIORS');
  assert(it.building && typeof it.building.door === 'object', id + ' needs a building footprint with a door');
  assert(typeof it.w === 'number' && typeof it.h === 'number', id + ' needs interior bounds');
  assert(it.spawn && it.exit, id + ' needs a spawn and an exit pad (escapable)');
  assert(Array.isArray(it.npcs) && it.npcs.length >= 1 && it.npcs.every((n) => n.dialogue), id + ' needs interior NPC(s) with dialogue');
}
const marginChamber = content.INTERIORS.find((x) => x.id === 'margin-chamber');
assert(marginChamber.building.secret === true, 'margin-chamber must be a secret building');
assert(marginChamber.reward === 'canon-clerk', 'margin-chamber must reward the canon-clerk cosmetic');

// ── #178 · index.html host wiring ──────────────────────────────────────────
assert(/\.\.\.\(AREA2_LORE\|\|\[\]\)/.test(index), 'index.html LORE must spread in AREA2_LORE');
assert(/\.\.\.\(AREA2_PUZZLES\|\|\[\]\)/.test(index), 'index.html PUZZLES must spread in AREA2_PUZZLES');
assert(index.includes('AREA2_LORE') && index.includes('AREA2_PUZZLES'), 'index.html must destructure AREA2_LORE/AREA2_PUZZLES');

console.log('area2 discovery verification passed ('
  + LORE.length + ' lore, ' + PUZZLES.length + ' puzzles, '
  + mines.enemies.length + ' mine enemies, ' + area2Npcs.length + ' NPC dialogue trees, '
  + wantInteriors.length + ' interiors)');
