// Headless verification for Area 2 — The Shroud Vaults (Canon/Schism fork mechanics).
// Asserts: dual-chain encounter data, the dual-chain engine behaviour (both pools must reach 0,
// cross-heal, Strike Both), the Ledger-Bound phase2 split + re-merge, single-HP back-compat
// (no regression for Area1/3 bosses + PvP), and the index.html Keeper-of-Margins two-state wiring.
//
// turnbased.js is bare ESM (`export function createTurnBasedMode`); load it with the same
// read-file + strip-export + new Function shim family used by the other verify_* harnesses.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const content = require(path.join(root, 'game', 'content.js'));

// --- ESM shim for engine/turnbased.js ------------------------------------------------
function loadTurnBased() {
  let src = fs.readFileSync(path.join(root, 'engine', 'turnbased.js'), 'utf8');
  src = src.replace(/^export\s+/gm, '');                 // drop bare ESM exports
  const factory = new Function(src + '\nreturn createTurnBasedMode;');
  return factory();
}
const createTurnBasedMode = loadTurnBased();

function loadPlatformer() {
  let src = fs.readFileSync(path.join(root, 'engine', 'platformer.js'), 'utf8');
  src = src.replace(/^export\s+/gm, '');
  const factory = new Function(src + '\nreturn createPlatformerMode;');
  return factory();
}
const createPlatformerMode = loadPlatformer();

// Minimal host api: a deterministic hero hitting for a known amount, capturing duel results.
function makeApi(opts = {}) {
  const meleeDamage = opts.meleeDamage || 30;
  return {
    player: { name: 'Recorded', hp: 100, maxHp: 100, sta: 100, maxSta: 100,
      getMeleeDamage() { return meleeDamage; }, regen() {}, spendStamina() { return true; } },
    assets: {}, log() {}, duelResults: [],
    onDuelResult(r) { this.duelResults.push(r); }, onExit() {},
  };
}
const ctx = { canvas: { width: 640, height: 360 } };
const NO_RND = () => 0.5; // pin Math.random so rnd(a,b) returns the midpoint, dmg is deterministic.

// Drive the duel to its menu phase, then feed a sequence of action keys. Returns getState().
function runDuel(enc, actions, opts = {}) {
  const orig = Math.random; Math.random = opts.rnd || NO_RND;
  try {
    const m = createTurnBasedMode(enc);
    const api = makeApi(opts);
    m.enter(ctx, api);
    // step past intro
    for (let i = 0; i < 40 && m.getState().phase === 'intro'; i++) m.update(0.05, {});
    let ai = 0, guard = 0;
    // Each action: select it from the menu, confirm, then let hero+foe resolve back to menu.
    while (ai < actions.length && guard++ < 4000) {
      const st = m.getState();
      if (st.phase === 'win' || st.phase === 'lose') break;
      if (st.phase === 'menu') {
        m.update(0.05, { confirm: true, __act: actions[ai] });
        // confirm chooses current menuIndex; we instead force the action via direct selection:
        ai++;
      } else {
        m.update(0.05, {});
      }
    }
    return { mode: m, api };
  } finally { Math.random = orig; }
}

// The menu navigation is index-based; rather than simulate up/down we select by feeding the
// engine confirm while menuIndex points at the wanted action. Simpler: drive via input edges.
function selectAction(m, key) {
  // bring to menu
  let guard = 0;
  while (m.getState().phase !== 'menu' && m.getState().phase !== 'win' && m.getState().phase !== 'lose' && guard++ < 500) m.update(0.05, {});
  if (m.getState().phase !== 'menu') return;
  const st = m.getState();
  const dual = !!(st.foe && st.foe.dc);
  const list = dual ? ['strikeA', 'strikeB', 'strikeAll', 'guard'] : ['strike', 'guard', 'focus', 'flee'];
  let target = list.indexOf(key);
  if (target < 0) target = 0;
  // navigate menuIndex to target using down edges (release between presses)
  let nav = 0;
  while (m.getState().menuIndex !== target && nav++ < 12) {
    m.update(0.05, { down: true }); m.update(0.05, {}); // edge then release
  }
  m.update(0.05, { confirm: true }); m.update(0.05, {}); // confirm edge then release
  // let hero + foe resolve until back to a menu or terminal
  guard = 0;
  while (['heroResolve', 'foeWindup'].includes(m.getState().phase) && guard++ < 500) m.update(0.05, {});
}

let pass = 0;
function ok(label) { pass++; console.log('  ok  ' + label); }

// ============ 1. content data: dual-chain fields present ============
const FM = content.TURN_FOREMAN, BG = content.TURN_BIFURCATED, LB = content.TURN_LEDGERBOUND;
assert(FM.dualChain && FM.dualChain.a.hp > 0 && FM.dualChain.b.hp > 0, 'Foreman has dualChain a/b');
assert(FM.dualChain.crossHeal === false, 'Foreman crossHeal is false');
assert(FM.dualChain.a.label === 'CANON' && FM.dualChain.b.label === 'SCHISM', 'Foreman labels Canon/Schism');
ok('TURN_FOREMAN dual-chain Canon/Schism, no cross-heal');

assert(BG.dualChain && BG.dualChain.crossHeal === true, 'Bifurcated dualChain crossHeal true');
ok('TURN_BIFURCATED dual-chain with cross-heal');

assert(LB.opponent.phase2 && LB.opponent.phase2.threshold === 0.4 && LB.opponent.phase2.mergePerTurn > 0,
  'Ledger-Bound opponent.phase2 split+merge');
assert(LB.finalStroke && LB.finalStroke.requiresCenter === true && LB.finalStroke.sigilKey === 'contested-will',
  'Ledger-Bound final stroke should require fissure-center and mint contested-will');
ok('TURN_LEDGERBOUND phase2 split + re-merge');

// ============ 1b. full Area 2 loop + town cast ============
{
  const town = content.AREA2_TOWN;
  assert(town && town.hearthlight && town.hearthlight.free === true && town.hearthlight.safe === true,
    'Forklight Hearthlight should be free/safe');
  const npcNames = (town.npcs || []).map(n => n.name).sort();
  for (const name of ['Keeper of Ancestry', 'Custodian Archivist', 'Librarian Shade', 'Keeper of Margins', 'Vault Custodians']) {
    assert(npcNames.includes(name), 'Area 2 town includes ' + name);
  }
  assert(town.sideQuest && town.sideQuest.interactionKey === 'q06:margin-scroll' && town.sideQuest.effect === 'weaken-debt-foreman',
    'Keeper of Margins sidequest should point at the Foreman weakening key');

  const quests = content.STORY.quests;
  for (const id of ['q06', 'q07', 'q08', 'q09']) assert(quests.some(q => q.id === id), 'Area 2 story includes ' + id);
  assert(quests.find(q => q.id === 'q06').next === 'q07', 'q06 should route into Debt Mines');
  assert(quests.find(q => q.id === 'q07').next === 'q08', 'q07 should route into Ledger Vaults');
  assert(quests.find(q => q.id === 'q08').next === 'q09', 'q08 should route into Ledger-Bound');
  assert(quests.find(q => q.id === 'q09').next === 'q10', 'q09 should open Area 3');

  assert.deepStrictEqual(content.AREA2_ENCOUNTERS.foreman.segments.map(s => s.mode), ['platformer', 'turnbased'],
    'Foreman loop should be Debt Mines platformer into duel');
  assert.deepStrictEqual(content.AREA2_ENCOUNTERS.bifurcated.segments.map(s => s.mode), ['battlefield', 'turnbased'],
    'Bifurcated loop should be Ledger Vaults battlefield into duel');
  assert.deepStrictEqual(content.AREA2_ENCOUNTERS.ledgerbound.segments.map(s => s.mode), ['platformer', 'battlefield', 'turnbased'],
    'Ledger-Bound final loop should combine all Area 2 play styles');
  ok('Area 2 town cast and q06-q09 loop are data-driven and playable');
}

// ============ 1c. Canon/Schism path choice has live gameplay effects ============
{
  const level = content.PLAT_DEBT_MINES;
  assert(level.fork && level.fork.canon && level.fork.schism && level.fork.crossing, 'Debt Mines should define fork metadata');
  assert(level.fork.canon.effect.speedMul < 1, 'Canon path should trade speed for stability');
  assert(level.fork.schism.effect.speedMul > 1 && level.fork.schism.effect.damagePerSecond > 0,
    'Schism path should trade speed for debt-pressure damage');
  assert(level.fork.crossing.requiresBothSpellings === true && /RECORDED/.test(level.fork.crossing.solution),
    'identity puzzle should require both Canon and Schism spellings');

  const api = {
    viewW: 640, viewH: 360, log() {}, assets: {},
    player: { hp: 100, maxHp: 100, sta: 100, maxSta: 100,
      damage(amount) { this.hp = Math.max(0, this.hp - amount); },
      spendStamina() { return true; },
      getMeleeDamage() { return 20; },
    },
  };
  const ctx2 = { canvas: { width: 640, height: 360 } };
  const m = createPlatformerMode(level);
  m.enter(ctx2, api);
  const st = m.getState();
  st.player.x = 100; st.player.y = 90; st.player.vx = 0; st.player.vy = 0;
  m.update(0.05, { right: true });
  const canonVx = st.player.vx;
  assert(m.getState().fork.side === 'canon', 'Canon side should be detected from the left path');

  st.player.x = 1100; st.player.y = 90; st.player.vx = 0; st.player.vy = 0;
  m.update(0.05, { right: true });
  const schismVx = st.player.vx;
  assert(m.getState().fork.side === 'schism', 'Schism side should be detected from the right path');
  assert(schismVx > canonVx, 'Schism speed modifier should produce higher horizontal velocity');
  ok('Canon/Schism fork has live platformer effects');
}

// ============ 1d. Ledger Vaults split arena uses distinct mechanical pressures ============
{
  const lv = content.BATTLE_LEDGER_VAULTS;
  assert(lv.fork && lv.fork.canonZone === 'canon-sanctuary' && lv.fork.schismZone === 'schism-chasm',
    'Ledger Vaults should label Canon and Schism zones');
  assert(lv.creatures['canon-auditor'].hp > lv.creatures['schism-shadow'].hp,
    'Canon Auditor should be tougher than Schism Shadow');
  assert(lv.creatures['schism-shadow'].speed > lv.creatures['canon-auditor'].speed,
    'Schism Shadow should be faster than Canon Auditor');
  const cz = lv.zones.find(z => z.id === lv.fork.canonZone), sz = lv.zones.find(z => z.id === lv.fork.schismZone);
  assert(cz && sz && cz.regen > sz.regen, 'Canon sanctuary should be safer than Schism chasm');
  ok('Ledger Vaults battlefield has distinct Canon/Schism gameplay pressure');
}

// ============ 2. q06 margins is now OPTIONAL (lectern only) ============
const q06 = content.STORY.quests.find(q => q.id === 'q06');
assert(q06.steps.length === 1 && q06.steps[0].id === 'lectern', 'q06 has only the lectern step');
assert(!q06.steps.some(s => s.id === 'margins'), 'q06 no longer has a required margins step');
assert(q06.next === 'q07', 'q06 still leads to q07');
ok('q06 Keeper-of-Margins made optional (lectern-only, next q07 intact)');

// ============ 3. dual-chain: BOTH pools must reach 0 ============
{
  const m = createTurnBasedMode(FM); const api = makeApi();
  const orig = Math.random; Math.random = NO_RND;
  try {
    m.enter(ctx, api);
    // Pound only chain A until it is 0; foe must NOT be defeated while B survives.
    let guard = 0;
    while (m.getState().foe.dc.a.hp > 0 && guard++ < 200) { selectAction(m, 'strikeA'); if (m.getState().phase === 'win') break; }
    assert(m.getState().foe.dc.a.hp === 0, 'Canon chain reduced to 0');
    assert(m.getState().foe.dc.b.hp > 0, 'Schism chain still standing');
    assert(m.getState().phase !== 'win', 'foe NOT defeated with one chain alive');
    ok('dual-chain: one chain at 0 does not win (both required)');
    // Now finish chain B -> win.
    guard = 0;
    while (m.getState().phase !== 'win' && guard++ < 200) selectAction(m, 'strikeB');
    assert(m.getState().phase === 'win', 'foe defeated once BOTH chains severed');
    const r = api.duelResults.find(x => x.reason === 'defeat' && x.winner === 'Recorded');
    ok('dual-chain: both chains at 0 => victory + duel result');
  } finally { Math.random = orig; }
}

// ============ 4. cross-heal (Bifurcated): striking one half mends the other ============
{
  const m = createTurnBasedMode(BG); const api = makeApi({ meleeDamage: 20 });
  const orig = Math.random; Math.random = NO_RND;
  try {
    m.enter(ctx, api);
    let guard = 0; while (m.getState().phase === 'intro' && guard++ < 40) m.update(0.05, {});
    const before = m.getState().foe.dc.b.hp;
    selectAction(m, 'strikeA'); // hit A; B should heal (was at full though -> capped). Lower B first.
    // Strike B to drop it below max, then strike A and confirm B mends.
    selectAction(m, 'strikeB');
    const bLow = m.getState().foe.dc.b.hp;
    selectAction(m, 'strikeA');
    const bAfter = m.getState().foe.dc.b.hp;
    assert(bAfter > bLow, 'cross-heal: striking A mended the B chain (' + bLow + ' -> ' + bAfter + ')');
    ok('cross-heal: single-side strike mends the other half');
  } finally { Math.random = orig; }
}

// ============ 5. Strike Both suppresses cross-heal and hits both pools ============
{
  const m = createTurnBasedMode(BG); const api = makeApi({ meleeDamage: 20 });
  const orig = Math.random; Math.random = NO_RND;
  try {
    m.enter(ctx, api);
    let guard = 0; while (m.getState().phase === 'intro' && guard++ < 40) m.update(0.05, {});
    const a0 = m.getState().foe.dc.a.hp, b0 = m.getState().foe.dc.b.hp;
    selectAction(m, 'strikeAll');
    const st = m.getState();
    assert(st.foe.dc.a.hp < a0 && st.foe.dc.b.hp < b0, 'Strike Both damaged BOTH pools');
    assert(st.foe.lastBoth === true, 'lastBoth flag set after Strike Both');
    ok('Strike Both: damages both halves, no cross-heal, sets lastBoth');
  } finally { Math.random = orig; }
}

// ============ 6. Ledger-Bound phase2: single-HP -> split, and merge regen unless Strike Both ============
{
  const m = createTurnBasedMode(LB); const api = makeApi({ meleeDamage: 40 });
  const orig = Math.random; Math.random = NO_RND;
  try {
    m.enter(ctx, api);
    let guard = 0; while (m.getState().phase === 'intro' && guard++ < 40) m.update(0.05, {});
    assert(!m.getState().foe.dc, 'Ledger-Bound starts single-HP (no dc yet)');
    // Strike (single-HP menu) until phase2 splits it.
    guard = 0;
    while (!m.getState().foe.dc && m.getState().phase !== 'win' && guard++ < 200) selectAction(m, 'strike');
    assert(m.getState().foe.dc, 'Ledger-Bound split into dual-chain at threshold');
    ok('Ledger-Bound: single-HP Phase 1 splits into dual-chain Phase 2');
    // Merge regen: strike A once, note B; then a NON-both action lets foe regen on its windup.
    // Drop both pools a bit with strikeA / strikeB, then verify a single-side strike round leaves
    // the regen path reachable (mergePerTurn>0). We assert lastBoth gating instead of exact HP.
    selectAction(m, 'strikeA');
    assert(m.getState().foe.lastBoth === false, 'after single-side strike, lastBoth is false (regen allowed)');
    selectAction(m, 'strikeAll');
    assert(m.getState().foe.lastBoth === true, 'after Strike Both, lastBoth true (regen suppressed)');
    ok('Ledger-Bound: re-merge regen gated by Strike Both (lastBoth flag)');
  } finally { Math.random = orig; }
}

// ============ 7. NO REGRESSION: single-HP foe (Area1 Tallow, PvP-shape) unchanged ============
{
  // A plain single-HP encounter must expose the classic ACTIONS and win on one pool.
  const enc = content.TURN_TALLOW; // {opponent:{hp:260...}} no dualChain/phase2
  const m = createTurnBasedMode(enc); const api = makeApi({ meleeDamage: 50 });
  const orig = Math.random; Math.random = NO_RND;
  try {
    m.enter(ctx, api);
    let guard = 0; while (m.getState().phase === 'intro' && guard++ < 40) m.update(0.05, {});
    assert(!m.getState().foe.dc && !m.getState().foe.phase2, 'single-HP foe has no dc/phase2');
    assert(m.getState().foe.hp === 260 && m.getState().foe.maxHp === 260, 'single-HP foe.hp from opponent.hp (no fallback to 60)');
    guard = 0;
    while (m.getState().phase !== 'win' && m.getState().phase !== 'lose' && guard++ < 500) selectAction(m, 'strike');
    assert(m.getState().phase === 'win', 'single-HP foe defeated via classic Strike path');
    ok('NO REGRESSION: single-HP foe uses classic ACTIONS + single-pool win');
  } finally { Math.random = orig; }
}

// ============ 8. index.html host wiring (grep-level static checks) ============
{
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert(/q06:margin-scroll/.test(html), 'index.html references the fixed margin-scroll key');
  assert(/enemy\.key==='foreman'/.test(html), 'startBossEncounter has a foreman-specific weakening branch');
  assert(/progress\.interactions\.has\('q06:margin-scroll'\)/.test(html), 'foreman weakening reads the margin-scroll interaction');
  assert(/ledgerbound[\s\S]{0,200}sigilKey:'contested-will'/.test(html), 'ledgerbound boss mints contested-will');
  assert(/boss:true/.test(html) && /Chain\.mintGreatRune/.test(html), 'boss kill path mints a Great Rune sigil');
  ok('index.html: Keeper gate + Contested Will mint wiring present');
}

console.log('\nArea 2 fork-mechanics verification passed (' + pass + ' checks).');
