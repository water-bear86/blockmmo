const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert(index.includes('const WORLD_ENTRIES=['), 'index.html should define data-driven top-down world entry points');
assert(index.includes("mode:'platformer'"), 'at least one world entry should launch a platformer mode');
assert(index.includes('level:PLAT_LEVEL'), 'the Area 1 world entry should reuse the existing Parish Road platformer payload');
assert(index.includes('returnPoint:{x:'), 'world entries should declare an explicit top-down return point');

for (const fn of ['nearestWorldEntry', 'enterWorldEntry', 'completeWorldEntry', 'drawWorldEntries']) {
  assert(index.includes('function ' + fn + '('), 'index.html should define ' + fn + '()');
}

const interactMatch = index.match(/function doInteract\(\)\{([\s\S]*?)\n\}/);
assert(interactMatch, 'index.html must define doInteract()');
const interactBody = interactMatch[1];
assert(!/if\(!i\)return/.test(interactBody), 'doInteract() must not return before checking world entries and NPC dialogue');
assert(interactBody.includes('const entry=nearestWorldEntry()'), 'doInteract() should look for a nearby world entry');
assert(interactBody.includes('enterWorldEntry(entry)'), 'doInteract() should enter a nearby world entry from E');

const onExitMatch = index.match(/onExit\(id\)\{([\s\S]*?)\},\n  onCreatureDefeated/);
assert(onExitMatch, 'engineApi.onExit should be present');
assert(onExitMatch[1].includes('completeWorldEntry(id)'), 'engineApi.onExit should route platformer exits back to the source world entry');

assert(index.includes('drawWorldEntries();'), 'town terrain should render world entry markers');
assert(index.includes('const entry=state.mode===\'town\'?nearestWorldEntry():null'), 'HUD prompt should advertise nearby world entries only in town');
assert(index.includes("activeWorldEntry=null; state.mode='town'"), 'manual exits should clear active world entry state when returning to town');

console.log('world interior transition verification passed');
