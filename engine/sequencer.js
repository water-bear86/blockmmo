// Segment sequencer (PRD F3). Sits ABOVE the mode manager: a boss is a data-driven
// SCRIPT — an ordered list of segments, each naming a mode + a level/encounter payload
// + a completion event. When a segment completes, the sequencer plays a brief transition
// beat (F3.3, not seamless) and advances, telling the host to swap the mode manager's
// active mode (F3.2). Segment payloads reuse the existing level/encounter formats (F3.4).
//
// Script shape:
//   { id, name, beat?, carry?:['hp','sta'],
//     segments:[ { mode:'platformer'|'battlefield'|'turnbased', name?, payload, beat?,
//                  beatText?, complete:{ event } } ] }
//
// Completion (Q-F3a): the host fires segmentEvent(eventName, payload) from the engines'
// existing seam events (platformer onBossTrigger='boss'/onExit='exit', battlefield
// 'cleared', turnbased onDuelResult='duel'). Carry-over (Q-F3b): HP/stamina persist across
// segments by default; the host reads script.carry to decide what to keep.

function call(fn, ...args) { return typeof fn === 'function' ? fn(...args) : undefined; }

export function createSegmentSequencer(script = {}) {
  let api = null, deps = null;
  const segments = script.segments || [];
  let index = -1, active = null, beatT = 0, beatMsg = '', done = false, result = null;

  // deps: { startMode(segment), exitMode(), log(msg) }  — host wires these to its mode manager.
  function enter(nextApi, nextDeps) {
    api = nextApi || {}; deps = nextDeps || {};
    index = -1; active = null; beatT = 0; done = false; result = null;
    advance();
  }

  function advance() {
    if (active) call(deps.exitMode);
    index++;
    if (index >= segments.length) {
      done = true; result = { script: script.id || 'boss', name: script.name, completed: true };
      call(api.log, (script.name || 'The boss') + ' is overcome.');
      call(api.onBossComplete, script, result);
      return;
    }
    const seg = segments[index];
    beatMsg = seg.beatText || script.name || '';
    beatT = seg.beat != null ? seg.beat : (script.beat != null ? script.beat : 0.6);
    active = { seg, started: false };
  }

  function startSegment() {
    active.started = true;
    call(deps.startMode, active.seg);
    call(api.log, 'Segment ' + (index + 1) + '/' + segments.length + ': ' + (active.seg.name || active.seg.mode));
  }

  // Called by the host when an engine seam event fires; advances if it matches this segment.
  function segmentEvent(type, payload) {
    if (done || !active || !active.started) return false;
    const cond = active.seg.complete;
    const want = cond ? cond.event : defaultEvent(active.seg.mode);
    const targetOk = !cond || !cond.target || (payload && (payload.id === cond.target || payload === cond.target));
    if (type === want && targetOk) { advance(); return true; }
    return false;
  }

  function defaultEvent(mode) {
    if (mode === 'platformer') return 'boss';
    if (mode === 'battlefield') return 'cleared';
    if (mode === 'turnbased') return 'duel';
    return 'exit';
  }

  function update(dt) {
    if (beatT > 0) { beatT -= dt; if (beatT <= 0 && active && !active.started) startSegment(); }
  }

  // The transition beat (F3.3): a short diegetic cut that hides engine teardown/setup.
  function render(ctx, cam) {
    if (beatT <= 0 || !ctx) return false;
    const W = (cam && cam.w) || 640, H = (cam && cam.h) || 360;
    ctx.save();
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#d6a84f'; ctx.font = '16px ui-monospace,monospace'; ctx.textAlign = 'center';
    ctx.fillText(beatMsg || '…', W / 2, H / 2 - 4);
    ctx.fillStyle = '#8c8470'; ctx.font = '11px ui-monospace,monospace';
    ctx.fillText('segment ' + Math.min(index + 1, segments.length) + ' of ' + segments.length, W / 2, H / 2 + 16);
    ctx.restore();
    return true;
  }

  return {
    enter, advance, segmentEvent, update, render,
    isBeat() { return beatT > 0; },
    isDone() { return done; },
    activeMode() { return active && active.started ? active.seg.mode : null; },
    getState() { return { index, total: segments.length, done, beatT, seg: active && active.seg, result }; },
  };
}
