'use strict';

const assert = require('node:assert/strict');
const Overworld = require('../game/overworld.js');

function test(name, fn) {
  try {
    fn();
    process.stdout.write('ok  ' + name + '\n');
  } catch (error) {
    process.stderr.write('not ok  ' + name + '\n');
    throw error;
  }
}

test('exports the browser and Node API', function () {
  assert.equal(Overworld.VERSION, '0.1.0');
  assert.equal(Overworld.TILE, 16);
  assert.equal(typeof Overworld.drawGround, 'function');
  assert.equal(typeof Overworld.moveCircle, 'function');
});

test('terrain sampling is deterministic', function () {
  const a = Overworld.tileAt(1192, 143);
  const b = Overworld.tileAt(1192, 143);
  assert.deepEqual(a, b);
});

test('Hearthlight is safe and walkable', function () {
  const tile = Overworld.tileAt(0, 0);
  assert.equal(tile.blocked, false);
  assert.equal(tile.road.id, 'parish-road');
  assert.equal(Overworld.locationAt(0, 0).id, 'hearthlight');
});

test('existing off-path lore coordinates stay reachable', function () {
  const coordinates = [
    [-380, 120, 'west-milestone'],
    [-600, -300, 'unrecorded-vault'],
    [240, -320, 'pilgrim-cairn'],
    [520, 320, 'drowned-ledger'],
    [386, 150, 'reconciliation-yard'],
    [-230, 150, 'writ-of-succession']
  ];

  for (const coordinate of coordinates) {
    const x = coordinate[0];
    const y = coordinate[1];
    const id = coordinate[2];
    assert.equal(Overworld.tileAt(x, y).blocked, false, id + ' should be walkable');
    assert.equal(Overworld.nearestLandmark(x, y, 2).landmark.id, id);
  }
});

test('the quest corridor remains walkable at every major encounter', function () {
  const xs = [0, 156, 456, 656, 812, 1076, 1344, 1544, 1828, 2060, 2280, 2520, 2800, 3080];
  for (const x of xs) {
    assert.equal(Overworld.tileAt(x, 0).blocked, false, 'corridor blocked at x=' + x);
  }
});

test('locked gates are optional and can become solid', function () {
  const unlockedByDefault = Overworld.tileAt(1446, 0);
  assert.equal(unlockedByDefault.blocked, false);

  const locked = Overworld.tileAt(1446, 0, {
    blockLockedGates: true,
    questReached: function () { return false; }
  });
  assert.equal(locked.blocked, true);
  assert.equal(locked.gate.id, 'archive-threshold');

  const opened = Overworld.tileAt(1446, 0, {
    blockLockedGates: true,
    questReached: function (id) { return id === 'q10'; }
  });
  assert.equal(opened.blocked, false);
});

test('water blocks movement while the marsh boardwalk does not', function () {
  assert.equal(Overworld.tileAt(600, 350).water, true);
  assert.equal(Overworld.tileAt(600, 350).blocked, true);
  assert.equal(Overworld.tileAt(520, 320).kind, 'boardwalk');
  assert.equal(Overworld.tileAt(520, 320).blocked, false);
});

test('world bounds stop a moving circle without tunneling', function () {
  const body = { x: 3580, y: 0, radius: 7 };
  const result = Overworld.moveCircle(body, 80, 0, { solidProps: false });
  assert.equal(result.hitX, true);
  assert.ok(body.x <= Overworld.BOUNDS.maxX - body.radius);
});

test('content landmarks can be derived from existing Content data', function () {
  const content = {
    AREA1_LORE: [{ id: 'lore', title: 'Lore', x: 1, y: 2, kind: 'cairn' }],
    AREA1_PUZZLES: [{ id: 'puzzle', title: 'Puzzle', clue: { x: 3, y: 4 } }],
    WORLD_PORTALS: [{ id: 'portal', label: 'Portal', x: 5, y: 6, kind: 'cave', unlock: 'q02' }]
  };
  const marks = Overworld.contentLandmarks(content);
  assert.equal(marks.length, 3);
  assert.deepEqual(marks.map(function (mark) { return mark.id; }), ['lore', 'puzzle', 'portal']);
});

test('collision can be disabled for a visual-only integration', function () {
  const tile = Overworld.tileAt(600, 350, { solidProps: false, waterIsSolid: false });
  assert.equal(tile.water, true);
  assert.equal(tile.blocked, false);
});

test('all branch road centerlines remain walkable', function () {
  for (const road of Overworld.ROADS) {
    for (let i = 1; i < road.points.length; i += 1) {
      const a = road.points[i - 1];
      const b = road.points[i];
      for (let step = 0; step <= 8; step += 1) {
        const t = step / 8;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        assert.equal(Overworld.tileAt(x, y).blocked, false, road.id + ' blocked near ' + x + ',' + y);
      }
    }
  }
});

test('render helpers complete against a minimal Canvas context', function () {
  const context = {
    save: function () {}, restore: function () {}, beginPath: function () {},
    moveTo: function () {}, lineTo: function () {}, stroke: function () {},
    fillRect: function () {}, strokeRect: function () {}, fillText: function () {},
    measureText: function (text) { return { width: String(text).length * 6 }; }
  };
  const camera = { x: 0, y: 0 };
  const options = { solidProps: false, waterIsSolid: false, questReached: function () { return true; } };
  Overworld.drawGround(context, camera, 320, 180, 1, options);
  Overworld.drawProps(context, camera, 320, 180, 1, options);
  Overworld.drawLandmarks(context, camera, 320, 180, 1, { labels: true, allLabels: true });
  Overworld.drawMinimap(context, 0, 0, 160, 60, { x: 0, y: 0 }, options);
});

test('S2 regions exist in REGIONS and world extends to 3600', function () {
  assert.ok(Overworld.BOUNDS.maxX >= 3600, 'world must extend to x=3600 for S2 content');
  const ids = Overworld.REGIONS.map(function (r) { return r.id; });
  assert.ok(ids.includes('amendment-wastes'), 'amendment-wastes region must exist');
  assert.ok(ids.includes('erased-shore'), 'erased-shore region must exist');
  assert.ok(ids.includes('scribes-purgatory'), 'scribes-purgatory region must exist');
});

test('S2 boss landmarks exist in LANDMARKS', function () {
  const lids = Overworld.LANDMARKS.map(function (l) { return l.id; });
  assert.ok(lids.includes('grand-auditor'), 'grand-auditor landmark must exist');
  assert.ok(lids.includes('tide-keeper'), 'tide-keeper landmark must exist');
  assert.ok(lids.includes('prior-season'), 'prior-season landmark must exist');
});

process.stdout.write('\nAll overworld tests passed.\n');
