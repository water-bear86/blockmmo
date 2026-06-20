// Regression guard for the town E-interaction handler in index.html.
//
// A bad three-way merge (commit 8092393) once left doInteract() with duplicated
// bodies, causing two bugs:
//   1. NPC dialogue via E was unreachable dead code (an early `if(!i)return`
//      short-circuited the nearestNpc()/Dialogue.open() fallback).
//   2. Story.event('interact') fired TWICE per key press, so count-2/3 quest
//      steps and puzzles completed in half the intended interactions.
//
// This verify pins the consolidated handler: exactly one interact-event fire,
// and a reachable NPC dialogue fallback.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// Extract the doInteract function body (balanced enough for this single fn).
const m = index.match(/function doInteract\(\)\{([\s\S]*?)\n\}/);
assert(m, 'index.html must define doInteract()');
const body = m[1];

// 1. Exactly one interact-event fire per invocation (no double counting).
const fires = body.match(/Story\.event\('interact'/g) || [];
assert.strictEqual(fires.length, 1,
  `doInteract must fire Story.event('interact') exactly once (found ${fires.length})`);

// 2. NPC dialogue fallback must be present AND reachable. The interactable
//    branch must return from inside an `if(i){...}` block rather than an early
//    `if(!i)return` that strands the NPC path as dead code.
assert(/const n=nearestNpc\(\)/.test(body) && /Dialogue\.open\(n\)/.test(body),
  'doInteract must keep the nearestNpc()/Dialogue.open() fallback');
assert(/if\(i\)\{/.test(body),
  'doInteract must guard the interactable path with if(i){...} so the NPC fallback is reachable');
assert(!/if\(!i\)return/.test(body),
  'doInteract must NOT early-return on !i (that strands the NPC dialogue fallback)');

console.log('town interaction verification passed (single interact fire + reachable NPC dialogue)');
