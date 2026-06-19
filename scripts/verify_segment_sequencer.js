const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const content = require(path.join(root, 'game', 'content.js'));

function loadEngineFactory(relPath, exportName) {
  let src = fs.readFileSync(path.join(root, relPath), 'utf8');
  src = src.replace(/^export\s+/m, '');
  return new Function(src + '\nreturn ' + exportName + ';')();
}

const createSegmentSequencer = loadEngineFactory(path.join('engine', 'sequencer.js'), 'createSegmentSequencer');
const createModeManager = loadEngineFactory(path.join('engine', 'mode.js'), 'createModeManager');

function makeRenderContext() {
  const calls = [];
  return {
    calls,
    save() {},
    restore() {},
    fillRect(x, y, w, h) { calls.push({ type: 'rect', x, y, w, h, fillStyle: this.fillStyle }); },
    fillText(text, x, y) { calls.push({ type: 'text', text: String(text), x, y, fillStyle: this.fillStyle }); },
  };
}

function textCalls(ctx) {
  return ctx.calls.filter((c) => c.type === 'text').map((c) => c.text);
}

const script = content.AREA1_ENCOUNTERS.tallow;
assert(script, 'Mother Tallow encounter script should be exported');
assert.strictEqual(script.id, 'mother-tallow', 'Mother Tallow script id should be stable');
assert.deepStrictEqual(
  script.segments.map((seg) => seg.mode),
  ['platformer', 'battlefield', 'turnbased'],
  'Mother Tallow should run platformer -> battlefield -> turnbased'
);
assert.strictEqual(script.segments[0].payload, content.PLAT_TALLOW_HOUSE, 'platformer segment should reuse existing platformer payload');
assert.strictEqual(script.segments[1].payload, content.BATTLE_TALLOW_ECHOES, 'battlefield segment should reuse existing battlefield payload');
assert.strictEqual(script.segments[2].payload, content.TURN_TALLOW, 'turn-based segment should reuse existing duel payload');
assert.deepStrictEqual(
  script.segments.map((seg) => seg.complete && seg.complete.event),
  ['boss', 'cleared', 'duel'],
  'Mother Tallow should complete on existing engine seam events'
);

const player = { name: 'Recorded', hp: 87, maxHp: 120, sta: 42, maxSta: 100, earned: { sigils: 0, echoes: 0 } };
const logs = [];
const completions = [];
const api = {
  player,
  logs,
  completions,
  log(msg) { logs.push(String(msg)); },
  onBossComplete(doneScript, result) {
    completions.push({
      script: doneScript,
      result,
      snapshot: {
        hp: player.hp,
        sta: player.sta,
        earned: Object.assign({}, player.earned),
      },
    });
  },
};

const observed = [];
const exited = [];
const manager = createModeManager(null, { canvas: { width: 640, height: 360 } }, api);

function modeForSegment(seg) {
  return {
    enter(ctx, modeApi) {
      observed.push({
        mode: seg.mode,
        payload: seg.payload,
        hp: modeApi.player.hp,
        sta: modeApi.player.sta,
        earned: Object.assign({}, modeApi.player.earned),
      });
      if (seg.mode === 'platformer') {
        modeApi.player.hp = 81;
        modeApi.player.sta = 31;
        modeApi.player.earned.sigils = 1;
      } else if (seg.mode === 'battlefield') {
        modeApi.player.hp = 66;
        modeApi.player.sta = 19;
        modeApi.player.earned.echoes = 7;
      } else if (seg.mode === 'turnbased') {
        modeApi.player.hp = 54;
        modeApi.player.sta = 9;
        modeApi.player.earned.sigils = 2;
      }
    },
    exit() { exited.push(seg.mode); },
    update() {},
    render() {},
  };
}

const deps = {
  startMode(seg) {
    manager.setMode(modeForSegment(seg), { canvas: { width: 640, height: 360 } }, api);
  },
  exitMode() {
    manager.setMode(null, { canvas: { width: 640, height: 360 } }, api);
  },
  log(msg) { api.logs.push(String(msg)); },
};

const seq = createSegmentSequencer(script);
seq.enter(api, deps);
assert(seq.isBeat(), 'sequencer should open with a transition beat before segment setup');

const beatCtx = makeRenderContext();
assert.strictEqual(seq.render(beatCtx, { w: 320, h: 180 }), true, 'transition beat should render');
const beatText = textCalls(beatCtx);
assert(
  beatText.some((text) => /gate slams shut/i.test(text)),
  'transition beat should explicitly present the gate-slam wipe'
);
assert(
  beatText.some((text) => /wax names burn/i.test(text)),
  'transition beat should retain segment-specific beat text'
);

seq.update(1);
assert.strictEqual(seq.isBeat(), false, 'first segment should start after beat time elapses');
assert.strictEqual(seq.activeMode(), 'platformer', 'first active mode should be platformer');
assert(manager.getMode(), 'sequencer should drive the existing mode manager through deps.startMode');
assert.strictEqual(observed[0].payload, content.PLAT_TALLOW_HOUSE, 'platformer mode should receive the script payload');
assert.strictEqual(observed[0].hp, 87, 'first segment should receive current player HP');
assert.strictEqual(observed[0].sta, 42, 'first segment should receive current player stamina');

assert.strictEqual(seq.segmentEvent('cleared', {}), false, 'wrong seam event should not advance the platformer segment');
assert.strictEqual(seq.getState().index, 0, 'wrong seam event should leave the segment index unchanged');
assert.strictEqual(seq.segmentEvent('boss', { id: 'mother-tallow' }), true, 'platformer boss seam should advance');
assert.deepStrictEqual(exited, ['platformer'], 'advancing should tear down the previous mode before the next beat');

seq.update(1);
assert.strictEqual(seq.activeMode(), 'battlefield', 'second active mode should be battlefield');
assert.strictEqual(observed[1].payload, content.BATTLE_TALLOW_ECHOES, 'battlefield mode should receive the script payload');
assert.strictEqual(observed[1].hp, 81, 'battlefield should receive carried HP from platformer');
assert.strictEqual(observed[1].sta, 31, 'battlefield should receive carried stamina from platformer');
assert.deepStrictEqual(observed[1].earned, { sigils: 1, echoes: 0 }, 'battlefield should receive carried earned state from platformer');

assert.strictEqual(seq.segmentEvent('cleared', {}), true, 'battlefield clear seam should advance');
seq.update(1);
assert.strictEqual(seq.activeMode(), 'turnbased', 'third active mode should be turn-based');
assert.strictEqual(observed[2].payload, content.TURN_TALLOW, 'turn-based mode should receive the script payload');
assert.strictEqual(observed[2].hp, 66, 'turn-based segment should receive carried HP from battlefield');
assert.strictEqual(observed[2].sta, 19, 'turn-based segment should receive carried stamina from battlefield');
assert.deepStrictEqual(observed[2].earned, { sigils: 1, echoes: 7 }, 'turn-based should receive carried earned state from battlefield');

assert.strictEqual(seq.segmentEvent('duel', { reason: 'defeat', winner: 'Recorded' }), true, 'duel seam should finish the boss script');
assert(seq.isDone(), 'sequencer should be done after the last segment');
assert.strictEqual(manager.getMode(), null, 'final advance should clear the mode manager');
assert.deepStrictEqual(exited, ['platformer', 'battlefield', 'turnbased'], 'each segment should be torn down exactly once');
assert.strictEqual(api.completions.length, 1, 'sequencer should report one boss completion');
assert.strictEqual(api.completions[0].script, script, 'completion callback should receive the source script');
assert.deepStrictEqual(api.completions[0].snapshot, { hp: 54, sta: 9, earned: { sigils: 2, echoes: 7 } }, 'completion should preserve final carried state');
assert(api.logs.some((msg) => /Segment 1\/3/.test(msg)), 'sequencer should log segment start progress');
assert(api.logs.some((msg) => /Mother Tallow is overcome/.test(msg)), 'sequencer should log boss completion');

console.log('segment sequencer verification passed');
