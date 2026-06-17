// Turn-based RPG battle mode (PRD F2.4). Same enter/exit/update/render interface as
// the platformer/battlefield modes, so it slots into the existing mode manager and
// can also serve as a boss RPG segment (F3). Two combatants, strict alternating turns,
// a command menu, server-validatable outcomes surfaced through api.onDuelResult.
//
// Encounter payload:
//   { id, name, opponent:{ name, hp, attack, defense?, color? },
//     peerId?, duelId? }   // peerId/duelId set => resolved from the rc:pvp handshake (F2.3)
//
// PvP turn arbitration over the live relay (Q-S2c, server-authoritative) is OPEN; this
// resolves locally vs. a scripted/AI opponent, which also covers the boss-RPG case.

const ACTIONS = [
  { key: 'strike', label: 'Strike', hint: 'a measured cut' },
  { key: 'guard',  label: 'Guard',  hint: 'halve the next blow' },
  { key: 'focus',  label: 'Focus',  hint: 'spend stamina for a heavy strike' },
  { key: 'flee',   label: 'Flee',   hint: 'withdraw from the duel' },
];

// Dual-chain (forked) foes present a different command set: two single-chain
// strikes plus a split blow. Additive — single-HP foes keep ACTIONS unchanged.
const DUAL_ACTIONS = [
  { key: 'strikeA',   label: 'Strike A',    hint: 'cut the first chain' },
  { key: 'strikeB',   label: 'Strike B',    hint: 'cut the second chain' },
  { key: 'strikeAll', label: 'Strike Both', hint: 'split your blow across both' },
  { key: 'guard',     label: 'Guard',       hint: 'halve the next blow' },
];

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function rnd(a, b) { return a + Math.random() * (b - a); }
function call(api, name, ...args) { return api && typeof api[name] === 'function' ? api[name](...args) : undefined; }

export function createTurnBasedMode(encounter = {}) {
  let ctx = null, api = null, camera = null;
  let phase = 'intro', timer = 0, menuIndex = 0, logLine = '', result = null;
  let hero = null, foe = null, pending = null, shakeT = 0, heroFlash = 0, foeFlash = 0;
  const prev = { up: false, down: false, confirm: false, flee: false };

  function reset() {
    const p = api && api.player;
    hero = { name: (p && p.name) || 'Recorded', hp: (p && p.hp) || 100, maxHp: (p && p.maxHp) || 100,
      sta: (p && p.sta) || 100, maxSta: (p && p.maxSta) || 100, guarding: false };
    const o = encounter.opponent || {};
    foe = { name: o.name || encounter.name || 'Adversary', hp: o.hp || 60, maxHp: o.hp || 60,
      attack: o.attack || 9, defense: o.defense || 0, color: o.color || '#b0563f', sprite: o.sprite || '', guarding: false };
    // Dual-chain (Area 2 fork mechanic) is strictly additive: the lines above are byte-identical
    // to the single-HP path. A forked foe carries foe.dc {a,b}; a phase-splitting foe carries
    // foe.phase2 and converts to dual-chain mid-fight (resolveFoe). lastBoth tracks Strike Both.
    foe.dc = null; foe.phase2 = null; foe.lastBoth = false; foe.crossHeal = false;
    const dc = encounter.dualChain;
    if (dc) {
      foe.dc = { a: { hp: dc.a.hp, maxHp: dc.a.hp, label: dc.a.label || 'A', color: dc.a.color || '#d4a83e' },
                 b: { hp: dc.b.hp, maxHp: dc.b.hp, label: dc.b.label || 'B', color: dc.b.color || '#4ecb7a' } };
      foe.crossHeal = !!dc.crossHeal;
    } else if (o.phase2) { foe.phase2 = o.phase2; }
    phase = 'intro'; timer = 0.9; menuIndex = 0; pending = null; result = null;
    shakeT = 0; heroFlash = 0; foeFlash = 0;
    logLine = (encounter.peerId ? 'A duel begins — ' : 'You face ') + foe.name + '.';
  }

  function enter(nextCtx, nextApi) {
    ctx = nextCtx; api = nextApi || {};
    camera = { x: 0, y: 0, w: (ctx && ctx.canvas && ctx.canvas.width) || api.viewW || 640,
      h: (ctx && ctx.canvas && ctx.canvas.height) || api.viewH || 360 };
    reset();
    call(api, 'log', 'Turn-based battle: ' + foe.name + '. (Up/Down choose, J/Space confirm)');
  }

  function exit() { call(api, 'log', 'Leaving the duel.'); }

  function heroAttack() {
    const p = api && api.player;
    return (p && typeof p.getMeleeDamage === 'function' ? p.getMeleeDamage('turnbased') : 0) || 12;
  }

  function syncHeroHp() { if (api && api.player) api.player.hp = Math.max(0, Math.round(hero.hp)); }

  // Rising-edge detection from held action-shape inputs (host stays source-agnostic, A3).
  function edges(input) {
    const held = {
      up: !!(input.up || input.moveUp),
      down: !!(input.down || input.moveDown),
      confirm: !!(input.confirm || input.confirmPressed || input.attack || input.attackPressed || input.jump || input.jumpPressed),
      flee: !!(input.forfeit || input.forfeitPressed),
    };
    const e = { up: held.up && !prev.up, down: held.down && !prev.down, confirm: held.confirm && !prev.confirm, flee: held.flee && !prev.flee };
    prev.up = held.up; prev.down = held.down; prev.confirm = held.confirm; prev.flee = held.flee;
    return e;
  }

  // The command set depends on the foe shape; never mutate the module-level ACTIONS.
  function activeActions() { return foe && foe.dc ? DUAL_ACTIONS : ACTIONS; }

  function chooseAction(key) {
    pending = key; phase = 'heroResolve'; timer = 0.4;
    if (key === 'strike') logLine = 'You strike at ' + foe.name + '.';
    else if (key === 'strikeA') logLine = 'You strike the ' + foe.dc.a.label + ' chain.';
    else if (key === 'strikeB') logLine = 'You strike the ' + foe.dc.b.label + ' chain.';
    else if (key === 'strikeAll') logLine = 'You split your blow across both chains.';
    else if (key === 'guard') logLine = 'You raise your guard.';
    else if (key === 'focus') logLine = 'You focus your strength...';
    else if (key === 'flee') logLine = 'You break away from the duel.';
  }

  function resolveHero() {
    // Dual-chain branch (additive). Both pools must reach 0. crossHeal foes mend the
    // untouched pool when only one is struck; Strike Both hits both and suppresses the heal.
    if (foe.dc) {
      function hitPool(pool, mult) {
        let dmg = heroAttack() * rnd(0.85, 1.15) * mult - foe.defense;
        if (foe.guarding) dmg *= 0.5;
        dmg = Math.max(1, Math.round(dmg));
        pool.hp = Math.max(0, pool.hp - dmg);
        return dmg;
      }
      if (pending === 'strikeA') {
        const d = hitPool(foe.dc.a, 1);
        if (foe.crossHeal && foe.dc.b.hp > 0) foe.dc.b.hp = Math.min(foe.dc.b.maxHp, foe.dc.b.hp + Math.ceil(d * 0.5));
        foe.lastBoth = false;
        logLine = foe.dc.a.label + ' chain takes ' + d + (foe.crossHeal ? ' — the other mends.' : '.');
      } else if (pending === 'strikeB') {
        const d = hitPool(foe.dc.b, 1);
        if (foe.crossHeal && foe.dc.a.hp > 0) foe.dc.a.hp = Math.min(foe.dc.a.maxHp, foe.dc.a.hp + Math.ceil(d * 0.5));
        foe.lastBoth = false;
        logLine = foe.dc.b.label + ' chain takes ' + d + (foe.crossHeal ? ' — the other mends.' : '.');
      } else if (pending === 'strikeAll') {
        const dA = hitPool(foe.dc.a, 0.6), dB = hitPool(foe.dc.b, 0.6);
        foe.lastBoth = true;
        logLine = 'You split the blow — ' + dA + ' / ' + dB + '.';
      } else if (pending === 'guard') {
        hero.guarding = true;
        if (api && api.player && typeof api.player.regen === 'function') api.player.regen(10, 1, { mode: 'turnbased' });
        hero.hp = Math.min(hero.maxHp, hero.hp + 6); syncHeroHp();
        foe.lastBoth = false;
      } else if (pending === 'flee') {
        result = { duelId: encounter.duelId, reason: 'fled', winner: encounter.peerId || foe.name, loser: hero.name };
        phase = 'lose'; timer = 0.7; return;
      }
      foeFlash = 0.2; shakeT = 0.18; foe.guarding = false;
      if (foe.dc.a.hp <= 0 && foe.dc.b.hp <= 0) {
        result = { duelId: encounter.duelId, reason: 'defeat', winner: hero.name, loser: foe.name };
        phase = 'win'; timer = 0.9;
        logLine = foe.phase2 ? 'Both chains fracture from the center.' : foe.name + ' falls — both chains severed.';
      } else { phase = 'foeWindup'; timer = 0.55; }
      return;
    }
    if (pending === 'strike') {
      let dmg = heroAttack() * rnd(0.85, 1.15) - foe.defense;
      if (foe.guarding) dmg *= 0.5;
      dmg = Math.max(1, Math.round(dmg));
      foe.hp = Math.max(0, foe.hp - dmg); foeFlash = 0.18; shakeT = 0.16;
      logLine = foe.name + ' takes ' + dmg + '.';
    } else if (pending === 'guard') {
      hero.guarding = true;
      if (api && api.player && typeof api.player.regen === 'function') api.player.regen(10, 1, { mode: 'turnbased' });
      hero.hp = Math.min(hero.maxHp, hero.hp + 6); syncHeroHp();
    } else if (pending === 'focus') {
      const ok = !(api && api.player && typeof api.player.spendStamina === 'function') || api.player.spendStamina('turnbased') !== false;
      if (ok) {
        let dmg = Math.max(1, Math.round((heroAttack() * 1.85 - foe.defense) * (foe.guarding ? 0.5 : 1)));
        foe.hp = Math.max(0, foe.hp - dmg); foeFlash = 0.24; shakeT = 0.22;
        logLine = 'Focused blow! ' + foe.name + ' takes ' + dmg + '.';
      } else { logLine = 'Not enough stamina — the strike falters.'; }
    } else if (pending === 'flee') {
      result = { duelId: encounter.duelId, reason: 'fled', winner: encounter.peerId || foe.name, loser: hero.name };
      phase = 'lose'; timer = 0.7; return;
    }
    foe.guarding = false; // foe's guard only blocks one incoming blow
    if (foe.hp <= 0) { result = { duelId: encounter.duelId, reason: 'defeat', winner: hero.name, loser: foe.name }; phase = 'win'; timer = 0.9; logLine = foe.name + ' falls.'; }
    else { phase = 'foeWindup'; timer = 0.55; }
  }

  function resolveFoe() {
    // PHASE 2 (additive): a single-HP foe with opponent.phase2 splits into a dual-chain
    // foe once its HP crosses the threshold. From here the dual-chain render/menu take over.
    if (foe.phase2 && !foe.dc && foe.hp <= foe.phase2.threshold * foe.maxHp) {
      const p = foe.phase2;
      foe.dc = { a: { hp: p.aHp, maxHp: p.aHp, label: p.aLabel || 'A', color: p.aColor || '#d4a83e' },
                 b: { hp: p.bHp, maxHp: p.bHp, label: p.bLabel || 'B', color: p.bColor || '#4ecb7a' } };
      foe.crossHeal = false; menuIndex = 0; foe.guarding = false;
      logLine = foe.name + ' splits along the fissure!';
      phase = 'menu'; return;
    }
    // MERGE REGEN (additive): while split, the re-merging halves regenerate each foe turn
    // unless the hero's last action was Strike Both (which holds the split open).
    if (foe.dc && foe.phase2 && !foe.lastBoth) {
      const m = foe.phase2.mergePerTurn || 5;
      if (m > 0) {
        if (foe.dc.a.hp > 0) foe.dc.a.hp = Math.min(foe.dc.a.maxHp, foe.dc.a.hp + m);
        if (foe.dc.b.hp > 0) foe.dc.b.hp = Math.min(foe.dc.b.maxHp, foe.dc.b.hp + m);
        logLine = foe.name + ' re-merges its halves...';
      }
    }
    // Simple AI: guard occasionally when wounded, otherwise attack; heavier blow at low HP.
    const wounded = foe.hp < foe.maxHp * 0.4;
    if (wounded && Math.random() < 0.25) { foe.guarding = true; logLine = foe.name + ' steels itself.'; }
    else {
      const heavy = wounded && Math.random() < 0.45;
      let dmg = foe.attack * rnd(0.8, 1.2) * (heavy ? 1.6 : 1);
      if (hero.guarding) dmg *= 0.5;
      dmg = Math.max(1, Math.round(dmg));
      hero.hp = Math.max(0, hero.hp - dmg); syncHeroHp(); heroFlash = 0.2; shakeT = 0.18;
      logLine = (heavy ? foe.name + ' lands a heavy blow — ' : foe.name + ' hits for ') + dmg + '.';
    }
    hero.guarding = false;
    if (hero.hp <= 0) { result = { duelId: encounter.duelId, reason: 'defeat', winner: foe.name, loser: hero.name }; phase = 'lose'; timer = 0.9; }
    else { phase = 'menu'; }
  }

  function finish() {
    call(api, 'onDuelResult', result || { reason: 'over' }, { mode: 'turnbased' });
    call(api, 'onExit', encounter.id || 'turnbased', { mode: 'turnbased', result });
  }

  function update(dt, input = {}) {
    if (!hero) return;
    dt = Math.min(dt || 0, 0.05);
    if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);
    if (heroFlash > 0) heroFlash = Math.max(0, heroFlash - dt);
    if (foeFlash > 0) foeFlash = Math.max(0, foeFlash - dt);
    const e = edges(input);
    if (phase === 'intro') { timer -= dt; if (timer <= 0) { phase = 'menu'; logLine = 'Choose your move.'; } return; }
    if (phase === 'menu') {
      const A = activeActions();
      if (menuIndex >= A.length) menuIndex = 0;
      if (e.up) menuIndex = (menuIndex + A.length - 1) % A.length;
      if (e.down) menuIndex = (menuIndex + 1) % A.length;
      if (e.flee) { chooseAction('flee'); return; }
      if (e.confirm) chooseAction(A[menuIndex].key);
      return;
    }
    if (phase === 'heroResolve') { timer -= dt; if (timer <= 0) resolveHero(); return; }
    if (phase === 'foeWindup') { timer -= dt; if (timer <= 0) resolveFoe(); return; }
    if (phase === 'win' || phase === 'lose') { timer -= dt; if (timer <= 0) finish(); return; }
  }

  function bar(c, x, y, w, h, frac, fill) {
    c.fillStyle = '#08090a'; c.fillRect(x, y, w, h);
    c.fillStyle = fill; c.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * clamp(frac, 0, 1)), h - 2);
  }

  function render(nextCtx = ctx, nextCamera) {
    const c = nextCtx || ctx; if (!c || !hero) return;
    const cam = nextCamera || camera; const W = cam.w, H = cam.h;
    if (nextCamera) { nextCamera.x = 0; nextCamera.y = 0; nextCamera.w = W; nextCamera.h = H; }
    const sh = shakeT > 0 ? (Math.random() * 2 - 1) * 3 : 0;
    const spr = api && api.assets && api.assets.drawSheet;
    c.save(); c.imageSmoothingEnabled = false; c.translate(Math.round(sh), 0);
    c.fillStyle = '#12161b'; c.fillRect(-4, 0, W + 8, H);
    c.fillStyle = '#1b2630';
    for (let x = 0; x < W; x += 40) c.fillRect(x, 0, 1, H);
    c.fillStyle = '#0d1116'; c.fillRect(0, Math.round(H * 0.62), W, 2);
    // foe (right)
    const fx = Math.round(W * 0.72), fy = Math.round(H * 0.42);
    c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(fx, fy + 30, 34, 9, 0, 0, Math.PI * 2); c.fill();
    if (!(spr && foe.sprite && spr(foe.sprite, fx, fy + 30, foeFlash > 0 ? 3 : 0, 2.6))) {
      c.fillStyle = foeFlash > 0 ? '#f4eee0' : foe.color; c.fillRect(fx - 26, fy - 34, 52, 64);
      c.fillStyle = '#0c0e12'; c.fillRect(fx - 14, fy - 18, 8, 8); c.fillRect(fx + 6, fy - 18, 8, 8);
    }
    // hero (left)
    const hx = Math.round(W * 0.26), hy = Math.round(H * 0.5);
    c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(hx, hy + 24, 24, 7, 0, 0, Math.PI * 2); c.fill();
    if (!(spr && spr('player', hx, hy + 24, heroFlash > 0 ? 3 : 0, 2.2))) {
      c.fillStyle = heroFlash > 0 ? '#f4eee0' : '#5a6b9e'; c.fillRect(hx - 18, hy - 26, 36, 50);
      c.fillStyle = '#e4cdae'; c.fillRect(hx - 11, hy - 38, 22, 14);
    }
    if (hero.guarding) { c.strokeStyle = '#9eb4ff'; c.lineWidth = 2; c.strokeRect(hx - 22, hy - 42, 44, 70); }
    // name + HP plates
    c.font = '12px ui-monospace,monospace'; c.textAlign = 'left';
    c.fillStyle = '#f0e6cf'; c.fillText(foe.name, fx - 60, 28);
    bar(c, fx - 60, 34, 132, 8, foe.hp / foe.maxHp, '#c95b52');
    if (foe.dc) {
      // Two stacked chain bars: BOTH must reach 0. Each labelled by its faction.
      bar(c, fx - 60, 46, 132, 6, foe.dc.a.hp / foe.dc.a.maxHp, foe.dc.a.color);
      bar(c, fx - 60, 55, 132, 6, foe.dc.b.hp / foe.dc.b.maxHp, foe.dc.b.color);
      c.font = '9px ui-monospace,monospace';
      c.fillStyle = foe.dc.a.color; c.fillText(foe.dc.a.label, fx + 76, 52);
      c.fillStyle = foe.dc.b.color; c.fillText(foe.dc.b.label, fx + 76, 61);
      c.font = '12px ui-monospace,monospace';
    }
    c.fillStyle = '#f0e6cf'; c.fillText(hero.name, 16, 28);
    bar(c, 16, 34, 132, 8, hero.hp / hero.maxHp, '#5aa66f');
    bar(c, 16, 45, 132, 5, hero.sta / hero.maxSta, '#caa24a');
    // command box / log
    const boxY = H - 92, boxH = 80;
    c.fillStyle = 'rgba(9,11,14,.88)'; c.fillRect(12, boxY, W - 24, boxH);
    c.strokeStyle = '#4a463d'; c.lineWidth = 2; c.strokeRect(12, boxY, W - 24, boxH);
    if (phase === 'menu') {
      const A = activeActions();
      for (let i = 0; i < A.length; i++) {
        const sel = i === menuIndex;
        c.fillStyle = sel ? '#d6a84f' : '#cfc4ac';
        c.fillText((sel ? '> ' : '  ') + A[i].label, 26 + (i % 2) * 150, boxY + 22 + Math.floor(i / 2) * 22);
      }
      c.fillStyle = '#8c8470'; c.fillText(A[Math.min(menuIndex, A.length - 1)].hint, 26, boxY + boxH - 10);
    } else {
      c.fillStyle = '#e8dfc8'; c.fillText(logLine, 26, boxY + 26);
      if (phase === 'win') { c.fillStyle = '#7fd0a0'; c.fillText('Victory.', 26, boxY + 52); }
      if (phase === 'lose') { c.fillStyle = '#d68a8a'; c.fillText(result && result.reason === 'fled' ? 'You withdrew.' : 'You fell.', 26, boxY + 52); }
    }
    c.restore();
  }

  return { enter, exit, update, render, getState() { return { phase, hero, foe, menuIndex, result, logLine, dc: (foe && foe.dc) || null }; } };
}
