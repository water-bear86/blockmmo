const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const api = fs.readFileSync(path.join(root, 'engine', 'api.md'), 'utf8');

assert(
  index.includes("mode:state.mode==='town'?'town':'encounter'"),
  'network state payload should advertise town vs encounter presence mode'
);
assert(
  index.includes("encounter:state.mode==='town'?null:state.mode"),
  'network state payload should include the active solo segment as encounter metadata'
);
assert(
  index.includes("moving:state.mode==='town'&&player.moving"),
  'encounter presence should not broadcast active town movement'
);
assert(
  index.includes("r.mode=m.mode||'town'"),
  'remote state should persist the peer presence mode'
);
assert(
  index.includes('function drawEncounterMarker'),
  'town renderer should have an explicit encounter marker renderer'
);
assert(
  index.includes("remote&&p.mode&&p.mode!=='town'"),
  'remote players in non-town modes should render as encounter markers'
);
assert(
  index.includes('Net.updatePeers(); log(\'Returned to Hearthlight.'),
  'peer list should refresh when the local player returns to town'
);
assert(
  index.includes("state.mode=name; Net.updatePeers();"),
  'peer list should refresh when the local player enters direct engine modes'
);
assert(
  index.includes("state.mode='sequencer'; Net.updatePeers();"),
  'peer list should refresh when the local player enters sequenced boss encounters'
);
assert(
  api.includes('Shared-world presence while in solo segments (Q-F2b)'),
  'engine API docs should document Q-F2b presence behavior'
);
assert(
  api.includes('mode:"encounter"') && api.includes('In Encounter'),
  'engine API docs should document encounter state payload and marker semantics'
);

console.log('presence mode verification passed');
