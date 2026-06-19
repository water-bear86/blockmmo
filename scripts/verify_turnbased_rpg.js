const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function loadFactory(rel, name) {
  let src = fs.readFileSync(path.join(root, rel), 'utf8');
  src = src.replace(/^export\s+/gm, '');
  return new Function(src + '\nreturn ' + name + ';')();
}

const createModeManager = loadFactory('engine/mode.js', 'createModeManager');
const createTurnBasedMode = loadFactory('engine/turnbased.js', 'createTurnBasedMode');
const createSegmentSequencer = loadFactory('engine/sequencer.js', 'createSegmentSequencer');

function makeCtx() {
  const calls = [];
  return {
    canvas: { width: 640, height: 360 },
    calls,
    save() { calls.push('save'); },
    restore() { calls.push('restore'); },
    translate() {},
    fillRect() { calls.push('fillRect'); },
    strokeRect() { calls.push('strokeRect'); },
    beginPath() {},
    ellipse() {},
    arc() {},
    fill() {},
    stroke() {},
    fillText() { calls.push('fillText'); },
    set fillStyle(v) { this._fillStyle = v; },
    get fillStyle() { return this._fillStyle; },
    set strokeStyle(v) { this._strokeStyle = v; },
    get strokeStyle() { return this._strokeStyle; },
    set lineWidth(v) { this._lineWidth = v; },
    get lineWidth() { return this._lineWidth; },
    set font(v) { this._font = v; },
    get font() { return this._font; },
    set textAlign(v) { this._textAlign = v; },
    get textAlign() { return this._textAlign; },
    set imageSmoothingEnabled(v) { this._imageSmoothingEnabled = v; },
    get imageSmoothingEnabled() { return this._imageSmoothingEnabled; },
  };
}

function makeApi(opts = {}) {
  const api = {
    viewW: 640,
    viewH: 360,
    logs: [],
    duelResults: [],
    exits: [],
    player: {
      id: 'recorded',
      name: 'Recorded',
      hp: opts.hp || 100,
      maxHp: opts.maxHp || 100,
      sta: opts.sta || 100,
      maxSta: opts.maxSta || 100,
      initiative: opts.initiative,
      getMeleeDamage(reason) {
        api.lastDamageReason = reason;
        return opts.meleeDamage || 20;
      },
      spendStamina(reason) {
        api.lastSpendReason = reason;
        return opts.staminaOk !== false;
      },
      regen() {},
    },
    assets: { drawSheet() { return false; } },
    log(msg) { api.logs.push(String(msg)); },
    onDuelResult(result, data) { this.duelResults.push({ result, data }); },
    onExit(id, data) { this.exits.push({ id, data }); },
  };
  return api;
}

function withPinnedRandom(fn) {
  const orig = Math.random;
  Math.random = () => 0.5;
  try { fn(); } finally { Math.random = orig; }
}

function tick(mode, n = 1, input = {}) {
  for (let i = 0; i < n; i++) mode.update(0.05, input);
}

function runUntil(mode, pred, label, max = 1000) {
  for (let i = 0; i < max; i++) {
    if (pred()) return;
    mode.update(0.05, {});
  }
  assert.fail('timed out waiting for ' + label + ' at phase ' + mode.getState().phase);
}

function selectAction(mode, key) {
  runUntil(mode, () => ['menu', 'win', 'lose'].includes(mode.getState().phase), 'menu');
  assert.strictEqual(mode.getState().phase, 'menu', 'expected menu before selecting ' + key);
  const dual = !!mode.getState().dc;
  const actions = dual ? ['strikeA', 'strikeB', 'strikeAll', 'guard'] : ['strike', 'guard', 'focus', 'flee'];
  const target = Math.max(0, actions.indexOf(key));
  for (let guard = 0; mode.getState().menuIndex !== target && guard < 12; guard++) {
    tick(mode, 1, { down: true });
    tick(mode, 1, {});
  }
  tick(mode, 1, { confirm: true });
  tick(mode, 1, {});
}

function finishWithStrike(mode, api) {
  selectAction(mode, 'strike');
  runUntil(mode, () => mode.getState().finished || api.duelResults.length > 0, 'duel finish', 1000);
}

let pass = 0;
function ok(label) {
  pass++;
  console.log('  ok  ' + label);
}

// Standard mode-manager interface plus renderer smoke.
{
  const ctx = makeCtx();
  const api = makeApi();
  const mode = createTurnBasedMode({ id: 'iface', opponent: { name: 'Interface Foe', hp: 30, attack: 1 } });
  for (const fn of ['enter', 'exit', 'update', 'render']) assert.strictEqual(typeof mode[fn], 'function', fn + ' exported');
  const manager = createModeManager();
  manager.setMode(mode, ctx, api);
  runUntil(mode, () => mode.getState().phase === 'menu', 'intro');
  manager.render(ctx, { x: 0, y: 0, w: 640, h: 360 });
  assert(ctx.calls.includes('fillRect') && ctx.calls.includes('fillText'), 'renderer drew battle scene and menu text');
  assert.strictEqual(mode.getState().turn.actor, 'hero', 'default initiative gives hero the first menu');
  ok('standard mode interface renders a battle scene through the mode manager');
}

// Explicit initiative can give the foe first turn without changing default hero-first behavior.
withPinnedRandom(() => {
  const ctx = makeCtx();
  const api = makeApi({ hp: 100 });
  const mode = createTurnBasedMode({
    id: 'initiative',
    initiative: { hero: 1, foe: 9 },
    opponent: { name: 'Fast Foe', hp: 40, attack: 6, defense: 0 },
  });
  mode.enter(ctx, api);
  runUntil(mode, () => mode.getState().phase === 'foeWindup', 'foe initiative');
  assert.strictEqual(mode.getState().turn.initiative.first, 'foe');
  assert.strictEqual(mode.getState().turn.actor, 'foe');
  runUntil(mode, () => mode.getState().phase === 'menu', 'hero menu after foe turn');
  assert(api.player.hp < api.player.maxHp, 'foe first turn damaged the hero');
  assert.strictEqual(mode.getState().turn.actor, 'hero');
  ok('initiative selects first actor and advances into hero turn');
});

// 1v1 duel is playable end-to-end and returns a PvP-compatible duel result once.
withPinnedRandom(() => {
  const ctx = makeCtx();
  const api = makeApi({ meleeDamage: 30 });
  const mode = createTurnBasedMode({
    id: 'verify-duel',
    duelId: 'duel-verify',
    peerId: 'peer-1',
    opponent: { name: 'Peer Recorded', hp: 24, attack: 1, defense: 0 },
  });
  mode.enter(ctx, api);
  finishWithStrike(mode, api);
  assert.strictEqual(api.duelResults.length, 1, 'duel result fired once');
  assert.deepStrictEqual(api.duelResults[0].data, { mode: 'turnbased' });
  assert.strictEqual(api.duelResults[0].result.duelId, 'duel-verify');
  assert.strictEqual(api.duelResults[0].result.reason, 'defeat');
  assert.strictEqual(api.duelResults[0].result.winner, 'Recorded');
  assert.strictEqual(api.exits[0].id, 'verify-duel');
  assert.strictEqual(mode.getState().turn.submittedAction, 'strike');
  mode.update(0.05, {});
  mode.update(0.05, {});
  assert.strictEqual(api.duelResults.length, 1, 'finished duel is idempotent');
  ok('1v1 PvP-shaped duel resolves end-to-end with stable result');
});

// Boss RPG phase is usable from the segment sequencer.
withPinnedRandom(() => {
  const ctx = makeCtx();
  const api = makeApi({ meleeDamage: 40 });
  let activeMode = null;
  let completed = null;
  const script = {
    id: 'verify-boss',
    name: 'Verifier Boss',
    beat: 0.01,
    segments: [
      { mode: 'turnbased', name: 'Face to face', payload: { id: 'boss-duel', opponent: { name: 'Boss Phase', hp: 28, attack: 1 } }, complete: { event: 'duel' } },
    ],
  };
  const sequencer = createSegmentSequencer(script);
  api.onDuelResult = function(result, data) {
    this.duelResults.push({ result, data });
    sequencer.segmentEvent('duel', result);
  };
  api.onBossComplete = function(_script, result) { completed = result; };
  sequencer.enter(api, {
    startMode(segment) {
      assert.strictEqual(segment.mode, 'turnbased');
      activeMode = createTurnBasedMode(segment.payload);
      activeMode.enter(ctx, api);
    },
    exitMode() { activeMode = null; },
  });
  sequencer.update(0.05);
  assert(activeMode, 'sequencer started turnbased mode');
  const modeRef = activeMode;
  finishWithStrike(modeRef, api);
  assert(sequencer.isDone(), 'sequencer completed after duel event');
  assert(completed && completed.completed, 'boss complete callback fired');
  ok('turn-based boss phase completes through the segment sequencer');
});

// Static host seam checks: rc:pvp accept metadata reaches the turn-based encounter.
{
  const battlefield = fs.readFileSync(path.join(root, 'engine', 'battlefield.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert(battlefield.includes("call(api, 'onDuelAccepted'") && battlefield.includes('acceptedBy:localId()'),
    'acceptDuel should surface the accepted handshake to the host');
  assert(index.includes('startTurnDuel(m&&m.from,m&&m.duelId)'), 'host should pass accepted duelId into turn duel');
  assert(index.includes('duelId:duelId||null'), 'turn duel encounter should retain PvP duelId');
  assert(!pkg.scripts || !pkg.scripts.build, 'no build step should be introduced');
  ok('PvP challenge/accept handoff remains local and buildless');
}

console.log('\nturn-based RPG verification passed (' + pass + ' checks).');
