/*
 * RUNECHAIN overworld
 * Deterministic terrain, roads, landmarks, collision, and minimap helpers.
 * Plain browser script. No build step and no dependencies.
 */
(function attachOverworld(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RUNECHAIN_OVERWORLD = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createOverworld() {
  'use strict';

  const VERSION = '0.1.0';
  const TILE = 16;
  const BOUNDS = Object.freeze({ minX: -768, minY: -576, maxX: 3600, maxY: 576 });

  const REGIONS = Object.freeze([
    Object.freeze({
      id: 'unrecorded-wold',
      name: 'The Unrecorded Wold',
      subtitle: 'Bramble, erased milestones, and a vault the Chainwell missed.',
      minX: -768,
      maxX: -420,
      palette: Object.freeze({
        ground: '#25261f', groundAlt: '#2b2d23', road: '#554938', roadEdge: '#342f29',
        detail: '#596042', prop: '#353c2a', propHi: '#69734c', shadow: '#151713', accent: '#b9a06a'
      }),
      obstacleDensity: 0.11,
      obstacle: 'bramble'
    }),
    Object.freeze({
      id: 'gracefall-parish',
      name: 'Gracefall Parish',
      subtitle: 'A ruined parish kept warm by one stubborn Hearthlight.',
      minX: -420,
      maxX: 520,
      palette: Object.freeze({
        ground: '#30342a', groundAlt: '#363a2e', road: '#665641', roadEdge: '#40372f',
        detail: '#6b7352', prop: '#4a4e3d', propHi: '#7c8061', shadow: '#1c1f19', accent: '#f1c75b'
      }),
      obstacleDensity: 0.045,
      obstacle: 'grave'
    }),
    Object.freeze({
      id: 'mempool-moor',
      name: 'Mempool Moor',
      subtitle: 'Rejected receipts drift through sour reeds and candle smoke.',
      minX: 520,
      maxX: 860,
      palette: Object.freeze({
        ground: '#2b3029', groundAlt: '#31372d', road: '#5e503e', roadEdge: '#38312b',
        detail: '#52684f', prop: '#3d523c', propHi: '#708366', shadow: '#171c17', accent: '#70b0a2'
      }),
      obstacleDensity: 0.065,
      obstacle: 'reed'
    }),
    Object.freeze({
      id: 'shroud-vaults',
      name: 'The Shroud Vaults',
      subtitle: 'Debt sleeps in stone until somebody says its name.',
      minX: 860,
      maxX: 1420,
      palette: Object.freeze({
        ground: '#292b2c', groundAlt: '#303234', road: '#57504a', roadEdge: '#353235',
        detail: '#5f6264', prop: '#414448', propHi: '#74787b', shadow: '#17181b', accent: '#b9c2cf'
      }),
      obstacleDensity: 0.075,
      obstacle: 'stone'
    }),
    Object.freeze({
      id: 'archive-causeway',
      name: 'Archive Causeway',
      subtitle: 'Every footstep becomes testimony before it fades.',
      minX: 1420,
      maxX: 1880,
      palette: Object.freeze({
        ground: '#2d2b31', groundAlt: '#34313a', road: '#5a5162', roadEdge: '#39323e',
        detail: '#686070', prop: '#484151', propHi: '#7b7188', shadow: '#19171c', accent: '#b9a3cc'
      }),
      obstacleDensity: 0.055,
      obstacle: 'column'
    }),
    Object.freeze({
      id: 'seized-grounds',
      name: 'Seized Asset Grounds',
      subtitle: 'Everything here has an owner. None of them are alive.',
      minX: 1880,
      maxX: 2160,
      palette: Object.freeze({
        ground: '#332c2b', groundAlt: '#3a302f', road: '#625044', roadEdge: '#3d302d',
        detail: '#75564a', prop: '#513b37', propHi: '#8b675b', shadow: '#1e1717', accent: '#d17a55'
      }),
      obstacleDensity: 0.05,
      obstacle: 'stake'
    }),
    Object.freeze({
      id: 'auditor-verge',
      name: "The Auditor's Verge",
      subtitle: 'The road narrows into a final, perfectly balanced line.',
      minX: 2160,
      maxX: 2400,
      palette: Object.freeze({
        ground: '#2d2d2e', groundAlt: '#353536', road: '#666261', roadEdge: '#414040',
        detail: '#737173', prop: '#4f4e50', propHi: '#858287', shadow: '#1a1a1b', accent: '#f0f0e8'
      }),
      obstacleDensity: 0.025,
      obstacle: 'record'
    }),
    Object.freeze({
      id: 'amendment-wastes',
      name: 'The Amendment Wastes',
      subtitle: 'Permits for movement through ossified records — only after the ledger is broken.',
      minX: 2400,
      maxX: 2680,
      palette: Object.freeze({
        ground: '#2c2a1e', groundAlt: '#333120', road: '#60532a', roadEdge: '#3d3520',
        detail: '#756b44', prop: '#504935', propHi: '#8a7b50', shadow: '#1a1812', accent: '#c8a84a'
      }),
      obstacleDensity: 0.04,
      obstacle: 'stone'
    }),
    Object.freeze({
      id: 'erased-shore',
      name: 'The Erased Shore',
      subtitle: 'Stories keep time where ledgers cannot reach.',
      minX: 2680,
      maxX: 3000,
      palette: Object.freeze({
        ground: '#1e2c2e', groundAlt: '#243234', road: '#4a6068', roadEdge: '#2e4048',
        detail: '#4a8090', prop: '#2e505a', propHi: '#6098a4', shadow: '#121b1c', accent: '#4ab8c4'
      }),
      obstacleDensity: 0.05,
      obstacle: 'reed'
    }),
    Object.freeze({
      id: 'scribes-purgatory',
      name: "Scribe's Purgatory",
      subtitle: 'Where all endings arrive to wait, and prior seasons remember.',
      minX: 3000,
      maxX: 3600,
      palette: Object.freeze({
        ground: '#201c2c', groundAlt: '#262032', road: '#5c5070', roadEdge: '#38304c',
        detail: '#6a5880', prop: '#463858', propHi: '#8070a4', shadow: '#141018', accent: '#9b74ff'
      }),
      obstacleDensity: 0.03,
      obstacle: 'record'
    })
  ]);

  const ROADS = Object.freeze([
    Object.freeze({
      id: 'parish-road',
      name: 'Parish Road',
      width: 28,
      kind: 'road',
      points: Object.freeze([
        Object.freeze({ x: -700, y: 120 }), Object.freeze({ x: -520, y: 116 }),
        Object.freeze({ x: -380, y: 120 }), Object.freeze({ x: -248, y: 54 }),
        Object.freeze({ x: -96, y: 12 }), Object.freeze({ x: 0, y: 0 }),
        Object.freeze({ x: 156, y: 0 }), Object.freeze({ x: 332, y: -18 }),
        Object.freeze({ x: 456, y: 0 }), Object.freeze({ x: 656, y: -10 }),
        Object.freeze({ x: 812, y: 0 }), Object.freeze({ x: 1076, y: 0 }),
        Object.freeze({ x: 1344, y: -6 }), Object.freeze({ x: 1544, y: 0 }),
        Object.freeze({ x: 1828, y: 0 }), Object.freeze({ x: 2060, y: 0 }),
        Object.freeze({ x: 2280, y: 0 }), Object.freeze({ x: 2370, y: 0 }),
        Object.freeze({ x: 2520, y: 0 }), Object.freeze({ x: 2680, y: -8 }),
        Object.freeze({ x: 2800, y: 0 }), Object.freeze({ x: 2960, y: 10 }),
        Object.freeze({ x: 3080, y: 0 }), Object.freeze({ x: 3200, y: 0 }),
        Object.freeze({ x: 3400, y: 0 }), Object.freeze({ x: 3560, y: 0 })
      ])
    }),
    Object.freeze({
      id: 'pilgrim-track',
      name: 'Pilgrim Track',
      width: 13,
      kind: 'track',
      points: Object.freeze([
        Object.freeze({ x: -94, y: -4 }), Object.freeze({ x: -108, y: -112 }),
        Object.freeze({ x: -8, y: -198 }), Object.freeze({ x: 108, y: -242 }),
        Object.freeze({ x: 240, y: -320 })
      ])
    }),
    Object.freeze({
      id: 'unrecorded-cut',
      name: 'The Unrecorded Cut',
      width: 11,
      kind: 'track',
      points: Object.freeze([
        Object.freeze({ x: -330, y: 42 }), Object.freeze({ x: -422, y: -32 }),
        Object.freeze({ x: -500, y: -136 }), Object.freeze({ x: -570, y: -232 }),
        Object.freeze({ x: -600, y: -300 })
      ])
    }),
    Object.freeze({
      id: 'marsh-boardwalk',
      name: 'Marsh Boardwalk',
      width: 10,
      kind: 'boardwalk',
      points: Object.freeze([
        Object.freeze({ x: 348, y: 92 }), Object.freeze({ x: 390, y: 146 }),
        Object.freeze({ x: 430, y: 220 }), Object.freeze({ x: 478, y: 278 }),
        Object.freeze({ x: 520, y: 320 })
      ])
    }),
    Object.freeze({
      id: 'reconciliation-loop',
      name: 'Reconciliation Loop',
      width: 9,
      kind: 'track',
      points: Object.freeze([
        Object.freeze({ x: 318, y: 96 }), Object.freeze({ x: 386, y: 150 }),
        Object.freeze({ x: 470, y: 190 }), Object.freeze({ x: 470, y: 258 }),
        Object.freeze({ x: 320, y: 262 }), Object.freeze({ x: 300, y: 190 }),
        Object.freeze({ x: 386, y: 150 })
      ])
    }),
    Object.freeze({
      id: 'writ-path',
      name: 'Writ Path',
      width: 9,
      kind: 'track',
      points: Object.freeze([
        Object.freeze({ x: -140, y: 42 }), Object.freeze({ x: -188, y: 94 }),
        Object.freeze({ x: -230, y: 150 }), Object.freeze({ x: -282, y: 220 })
      ])
    })
  ]);

  const LANDMARKS = Object.freeze([
    Object.freeze({ id: 'hearthlight', name: 'Hearthlight Chapel', x: 0, y: 0, kind: 'hearth', radius: 72, major: true }),
    Object.freeze({ id: 'undercroft', name: 'The Sunken Undercroft', x: -250, y: -188, kind: 'portal', radius: 34, unlock: 'q02' }),
    Object.freeze({ id: 'west-milestone', name: 'The West Milestone', x: -380, y: 120, kind: 'milestone', radius: 30 }),
    Object.freeze({ id: 'unrecorded-vault', name: 'The Unrecorded Vault', x: -600, y: -300, kind: 'vault', radius: 42 }),
    Object.freeze({ id: 'pilgrim-cairn', name: 'The Pilgrim Cairn', x: 240, y: -320, kind: 'cairn', radius: 34 }),
    Object.freeze({ id: 'writ-of-succession', name: 'Writ of Succession', x: -230, y: 150, kind: 'puzzle', radius: 150 }),
    Object.freeze({ id: 'reconciliation-yard', name: 'The Reconciliation Yard', x: 386, y: 150, kind: 'puzzle', radius: 150 }),
    Object.freeze({ id: 'drowned-ledger', name: 'The Drowned Ledger', x: 520, y: 320, kind: 'ledger', radius: 38 }),
    Object.freeze({ id: 'gate-sexton', name: 'Gate Sexton Marrow', x: 456, y: 0, kind: 'boss', radius: 50, unlock: 'q02', major: true }),
    Object.freeze({ id: 'mempool-yard', name: 'Mempool Yard', x: 656, y: -10, kind: 'boss', radius: 54, unlock: 'q04', major: true }),
    Object.freeze({ id: 'tallow-house', name: 'Tallow House', x: 812, y: 0, kind: 'boss', radius: 56, unlock: 'q05', major: true }),
    Object.freeze({ id: 'debt-mines', name: 'Debt Mines', x: 1076, y: 0, kind: 'boss', radius: 58, unlock: 'q07', major: true }),
    Object.freeze({ id: 'ledger-vaults', name: 'Ledger Vaults', x: 1344, y: -6, kind: 'boss', radius: 58, unlock: 'q08', major: true }),
    Object.freeze({ id: 'ledger-bound', name: 'The Ledger-Bound', x: 1544, y: 0, kind: 'boss', radius: 60, unlock: 'q09', major: true }),
    Object.freeze({ id: 'archive-ascent', name: 'Archive Ascent', x: 1828, y: 0, kind: 'boss', radius: 58, unlock: 'q11', major: true }),
    Object.freeze({ id: 'seized-yard', name: 'Seized Asset Yard', x: 2060, y: 0, kind: 'boss', radius: 58, unlock: 'q12', major: true }),
    Object.freeze({ id: 'auditor', name: 'The Auditor', x: 2280, y: 0, kind: 'boss', radius: 64, unlock: 'q13', major: true }),
    Object.freeze({ id: 'ossified-spark', name: 'Ossified Spark', x: 2440, y: 0, kind: 'hearth', radius: 60, major: true }),
    Object.freeze({ id: 'grand-auditor', name: 'The Grand Auditor', x: 2520, y: 0, kind: 'boss', radius: 64, major: true }),
    Object.freeze({ id: 'tide-spark', name: 'Tide Spark', x: 2720, y: 0, kind: 'hearth', radius: 60, major: true }),
    Object.freeze({ id: 'tide-keeper', name: 'The Tide Keeper', x: 2800, y: 0, kind: 'boss', radius: 64, major: true }),
    Object.freeze({ id: 'convergence-flame', name: 'Convergence Flame', x: 3080, y: -80, kind: 'hearth', radius: 60, major: true }),
    Object.freeze({ id: 'prior-season', name: 'The Prior Season', x: 3200, y: 0, kind: 'boss', radius: 68, major: true })
  ]);

  const GATES = Object.freeze([
    Object.freeze({ id: 'tallow-threshold', x: 842, y: 0, halfHeight: 54, unlock: 'q07', label: 'SHROUD WARRANT' }),
    Object.freeze({ id: 'archive-threshold', x: 1446, y: 0, halfHeight: 54, unlock: 'q10', label: 'ARCHIVE WRIT' }),
    Object.freeze({ id: 'seizure-threshold', x: 1888, y: 0, halfHeight: 54, unlock: 'q12', label: 'SEIZURE ORDER' }),
    Object.freeze({ id: 'auditor-threshold', x: 2178, y: 0, halfHeight: 54, unlock: 'q13', label: 'FINAL ACCOUNT' })
  ]);

  const WATER = Object.freeze([
    Object.freeze({ x: 520, y: 336, rx: 178, ry: 118 }),
    Object.freeze({ x: 664, y: 286, rx: 116, ry: 82 }),
    Object.freeze({ x: 592, y: -286, rx: 108, ry: 74 })
  ]);

  const CLEARINGS = LANDMARKS.map(function toClearing(mark) {
    return Object.freeze({ x: mark.x, y: mark.y, r: Math.max(28, mark.radius || 28) });
  });

  const DRY_CLEARINGS = LANDMARKS.filter(function isDryLandmark(mark) {
    return mark.kind === 'hearth' || mark.kind === 'puzzle' || mark.kind === 'boss' ||
      mark.kind === 'portal' || mark.kind === 'vault';
  }).map(function toDryClearing(mark) {
    return Object.freeze({ x: mark.x, y: mark.y, r: Math.max(30, mark.radius || 30) });
  });

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / (edge1 - edge0 || 1), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function hash2(x, y, seed) {
    let h = Math.imul((x | 0) ^ 0x9e3779b9, 0x85ebca6b);
    h ^= Math.imul((y | 0) ^ 0xc2b2ae35, 0x27d4eb2d);
    h ^= Math.imul((seed | 0) ^ 0x165667b1, 0x9e3779b1);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function regionAt(x) {
    for (let i = 0; i < REGIONS.length; i += 1) {
      if (x >= REGIONS[i].minX && x < REGIONS[i].maxX) return REGIONS[i];
    }
    return x < REGIONS[0].minX ? REGIONS[0] : REGIONS[REGIONS.length - 1];
  }

  function pointSegmentDistanceSq(px, py, ax, ay, bx, by) {
    const vx = bx - ax;
    const vy = by - ay;
    const wx = px - ax;
    const wy = py - ay;
    const vv = vx * vx + vy * vy;
    const t = vv > 0 ? clamp((wx * vx + wy * vy) / vv, 0, 1) : 0;
    const dx = px - (ax + vx * t);
    const dy = py - (ay + vy * t);
    return dx * dx + dy * dy;
  }

  function roadInfoAt(x, y) {
    let best = null;
    let bestDistance = Infinity;
    let bestScore = Infinity;
    for (let r = 0; r < ROADS.length; r += 1) {
      const road = ROADS[r];
      let roadD2 = Infinity;
      for (let i = 1; i < road.points.length; i += 1) {
        const a = road.points[i - 1];
        const b = road.points[i];
        roadD2 = Math.min(roadD2, pointSegmentDistanceSq(x, y, a.x, a.y, b.x, b.y));
      }
      const distance = Math.sqrt(roadD2);
      if (distance > road.width) continue;
      const score = distance / Math.max(1, road.width);
      if (score < bestScore) {
        bestScore = score;
        bestDistance = distance;
        best = road;
      }
    }
    return best ? { road: best, distance: bestDistance } : null;
  }

  function withinClearing(x, y, padding) {
    const extra = padding || 0;
    for (let i = 0; i < CLEARINGS.length; i += 1) {
      const c = CLEARINGS[i];
      const dx = x - c.x;
      const dy = y - c.y;
      const rr = c.r + extra;
      if (dx * dx + dy * dy <= rr * rr) return true;
    }
    return false;
  }

  function inWater(x, y) {
    for (let i = 0; i < WATER.length; i += 1) {
      const pool = WATER[i];
      const nx = (x - pool.x) / pool.rx;
      const ny = (y - pool.y) / pool.ry;
      if (nx * nx + ny * ny < 1) return true;
    }
    return false;
  }

  function withinDryClearing(x, y) {
    for (let i = 0; i < DRY_CLEARINGS.length; i += 1) {
      const c = DRY_CLEARINGS[i];
      const dx = x - c.x;
      const dy = y - c.y;
      if (dx * dx + dy * dy <= c.r * c.r) return true;
    }
    return false;
  }

  function questReached(options, questId) {
    if (!questId) return true;
    if (!options) return true;
    if (typeof options.questReached === 'function') return !!options.questReached(questId);
    if (options.unlockedQuests && typeof options.unlockedQuests.has === 'function') return options.unlockedQuests.has(questId);
    if (Array.isArray(options.unlockedQuests)) return options.unlockedQuests.indexOf(questId) !== -1;
    return true;
  }

  function lockedGateAt(x, y, options) {
    if (!options || !options.blockLockedGates) return null;
    for (let i = 0; i < GATES.length; i += 1) {
      const gate = GATES[i];
      if (questReached(options, gate.unlock)) continue;
      if (Math.abs(x - gate.x) <= 8 && Math.abs(y - gate.y) <= gate.halfHeight) return gate;
    }
    return null;
  }

  function obstacleAtTile(tx, ty, region, road, x, y) {
    if (road || withinClearing(x, y, 14)) return null;
    const densityNoise = hash2(tx, ty, 17);
    const cluster = hash2(Math.floor(tx / 3), Math.floor(ty / 3), 91);
    const edgeBoost = Math.abs(y) > 410 ? 0.09 : 0;
    const density = region.obstacleDensity + edgeBoost + (cluster > 0.78 ? 0.035 : 0);
    if (densityNoise >= density) return null;
    return {
      kind: region.obstacle,
      variant: Math.floor(hash2(tx, ty, 43) * 4),
      solid: hash2(tx, ty, 61) > 0.26
    };
  }

  function tileAt(x, y, options) {
    const outside = x < BOUNDS.minX || x > BOUNDS.maxX || y < BOUNDS.minY || y > BOUNDS.maxY;
    const region = regionAt(x);
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (outside) {
      return {
        x: x, y: y, tx: tx, ty: ty, region: region, kind: 'void', road: null,
        obstacle: null, blocked: true, water: false, outside: true
      };
    }

    const road = roadInfoAt(x, y);
    const water = inWater(x, y) && !withinDryClearing(x, y) && !(road && road.road.kind === 'boardwalk');
    const gate = lockedGateAt(x, y, options);
    const obstacle = obstacleAtTile(tx, ty, region, road, x, y);
    const solidProps = !options || options.solidProps !== false;
    const waterIsSolid = !options || options.waterIsSolid !== false;
    const kind = road ? road.road.kind : (water ? 'water' : 'ground');
    const blocked = !!gate || !!(water && waterIsSolid) || !!(solidProps && obstacle && obstacle.solid);

    return {
      x: x,
      y: y,
      tx: tx,
      ty: ty,
      region: region,
      kind: kind,
      road: road ? road.road : null,
      roadDistance: road ? road.distance : Infinity,
      obstacle: obstacle,
      blocked: blocked,
      water: water,
      outside: false,
      gate: gate,
      noise: hash2(tx, ty, 7)
    };
  }

  function isBlocked(x, y, options) {
    return tileAt(x, y, options).blocked;
  }

  function circleBlocked(x, y, radius, options) {
    const r = Math.max(0, radius || 0);
    if (isBlocked(x, y, options)) return true;
    if (r <= 0) return false;
    const d = r * 0.70710678118;
    const samples = [
      [r, 0], [-r, 0], [0, r], [0, -r],
      [d, d], [-d, d], [d, -d], [-d, -d]
    ];
    for (let i = 0; i < samples.length; i += 1) {
      if (isBlocked(x + samples[i][0], y + samples[i][1], options)) return true;
    }
    return false;
  }

  function moveCircle(body, dx, dy, options) {
    if (!body || !Number.isFinite(body.x) || !Number.isFinite(body.y)) {
      throw new TypeError('moveCircle expects a body with finite x and y values');
    }
    const startX = body.x;
    const startY = body.y;
    const radius = Number.isFinite(body.radius) ? body.radius : 7;
    const maxMove = Math.max(Math.abs(dx || 0), Math.abs(dy || 0));
    const steps = Math.max(1, Math.ceil(maxMove / 6));
    const stepX = (dx || 0) / steps;
    const stepY = (dy || 0) / steps;
    let hitX = false;
    let hitY = false;

    for (let i = 0; i < steps; i += 1) {
      if (!circleBlocked(body.x + stepX, body.y, radius, options)) body.x += stepX;
      else hitX = true;

      if (!circleBlocked(body.x, body.y + stepY, radius, options)) body.y += stepY;
      else hitY = true;
    }

    return {
      x: body.x,
      y: body.y,
      dx: body.x - startX,
      dy: body.y - startY,
      hitX: hitX,
      hitY: hitY
    };
  }

  function nearestLandmark(x, y, maxDistance, options) {
    const limit = Number.isFinite(maxDistance) ? maxDistance : Infinity;
    let best = null;
    let bestD = limit;
    for (let i = 0; i < LANDMARKS.length; i += 1) {
      const mark = LANDMARKS[i];
      if (options && options.onlyUnlocked && !questReached(options, mark.unlock)) continue;
      const d = Math.hypot(mark.x - x, mark.y - y);
      if (d <= bestD) {
        bestD = d;
        best = mark;
      }
    }
    return best ? { landmark: best, distance: bestD } : null;
  }

  function locationAt(x, y) {
    const near = nearestLandmark(x, y, 74);
    if (near) return { id: near.landmark.id, name: near.landmark.name, kind: near.landmark.kind };
    const region = regionAt(x);
    return { id: region.id, name: region.name, kind: 'region' };
  }

  function screenPoint(wx, wy, camera, viewW, viewH) {
    return {
      x: Math.round(wx - camera.x + viewW / 2),
      y: Math.round(wy - camera.y + viewH / 2)
    };
  }

  function visibleTileRange(camera, viewW, viewH) {
    return {
      minTX: Math.floor((camera.x - viewW / 2) / TILE) - 1,
      maxTX: Math.floor((camera.x + viewW / 2) / TILE) + 1,
      minTY: Math.floor((camera.y - viewH / 2) / TILE) - 1,
      maxTY: Math.floor((camera.y + viewH / 2) / TILE) + 1
    };
  }

  function drawGround(ctx, camera, viewW, viewH, time, options) {
    if (!ctx || !camera) return;
    const range = visibleTileRange(camera, viewW, viewH);
    const t = Number.isFinite(time) ? time : 0;
    ctx.save();
    ctx.imageSmoothingEnabled = false;

    for (let ty = range.minTY; ty <= range.maxTY; ty += 1) {
      for (let tx = range.minTX; tx <= range.maxTX; tx += 1) {
        const wx = tx * TILE + TILE / 2;
        const wy = ty * TILE + TILE / 2;
        const tile = tileAt(wx, wy, options);
        const p = tile.region.palette;
        const sx = Math.round(tx * TILE - camera.x + viewW / 2);
        const sy = Math.round(ty * TILE - camera.y + viewH / 2);

        if (tile.kind === 'void') {
          ctx.fillStyle = '#0d0e0d';
          ctx.fillRect(sx, sy, TILE, TILE);
          continue;
        }

        if (tile.kind === 'water') {
          ctx.fillStyle = tile.noise > 0.5 ? '#263d3e' : '#223638';
          ctx.fillRect(sx, sy, TILE, TILE);
          const wave = Math.floor((t * 12 + tx * 5 + ty * 3) % 16);
          ctx.fillStyle = 'rgba(112,176,162,0.28)';
          ctx.fillRect(sx + wave, sy + 4, 4, 1);
          ctx.fillRect(sx + ((wave + 7) % 14), sy + 11, 3, 1);
          continue;
        }

        if (tile.kind === 'road' || tile.kind === 'track') {
          ctx.fillStyle = p.roadEdge;
          ctx.fillRect(sx, sy, TILE, TILE);
          ctx.fillStyle = p.road;
          const inset = tile.kind === 'track' ? 3 : 1;
          ctx.fillRect(sx + inset, sy + inset, TILE - inset * 2, TILE - inset * 2);
        } else if (tile.kind === 'boardwalk') {
          ctx.fillStyle = '#30291f';
          ctx.fillRect(sx, sy, TILE, TILE);
          ctx.fillStyle = '#756047';
          ctx.fillRect(sx + 1, sy + 2, TILE - 2, 4);
          ctx.fillRect(sx + 1, sy + 9, TILE - 2, 4);
          ctx.fillStyle = '#3e3428';
          ctx.fillRect(sx + 5, sy, 1, TILE);
          ctx.fillRect(sx + 12, sy, 1, TILE);
        } else {
          ctx.fillStyle = tile.noise > 0.56 ? p.groundAlt : p.ground;
          ctx.fillRect(sx, sy, TILE, TILE);
          if (hash2(tx, ty, 29) > 0.72) {
            ctx.fillStyle = p.detail;
            const ox = 2 + Math.floor(hash2(tx, ty, 31) * 11);
            const oy = 2 + Math.floor(hash2(tx, ty, 37) * 11);
            ctx.fillRect(sx + ox, sy + oy, 2, 2);
          }
        }

        if ((tile.kind === 'road' || tile.kind === 'track') && hash2(tx, ty, 67) > 0.76) {
          ctx.fillStyle = 'rgba(20,18,16,0.24)';
          ctx.fillRect(sx + 3 + Math.floor(hash2(tx, ty, 71) * 8), sy + 5, 3, 2);
        }
      }
    }

    drawRoadBorders(ctx, camera, viewW, viewH);
    ctx.restore();
  }

  function drawRoadBorders(ctx, camera, viewW, viewH) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let r = 0; r < ROADS.length; r += 1) {
      const road = ROADS[r];
      if (road.points.length < 2) continue;
      const first = screenPoint(road.points[0].x, road.points[0].y, camera, viewW, viewH);
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < road.points.length; i += 1) {
        const p = screenPoint(road.points[i].x, road.points[i].y, camera, viewW, viewH);
        ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = road.kind === 'boardwalk' ? 'rgba(25,20,15,0.55)' : 'rgba(18,17,15,0.16)';
      ctx.lineWidth = Math.max(2, road.width * 2 + 4);
      ctx.stroke();
      ctx.strokeStyle = road.kind === 'boardwalk' ? 'rgba(117,96,71,0.28)' : 'rgba(121,106,79,0.12)';
      ctx.lineWidth = Math.max(1, road.width * 2 - 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPixelGrave(ctx, sx, sy, p, variant) {
    ctx.fillStyle = p.shadow;
    ctx.fillRect(sx + 3, sy + 11, 10, 3);
    ctx.fillStyle = p.prop;
    ctx.fillRect(sx + 5, sy + 5, 7, 8);
    ctx.fillRect(sx + 6, sy + 3, 5, 2);
    ctx.fillStyle = p.propHi;
    ctx.fillRect(sx + 6, sy + 5, 1, 6);
    if (variant === 2) ctx.fillRect(sx + 9, sy + 2, 1, 3);
  }

  function drawPixelBramble(ctx, sx, sy, p, variant) {
    ctx.fillStyle = p.shadow;
    ctx.fillRect(sx + 2, sy + 11, 12, 3);
    ctx.fillStyle = p.prop;
    ctx.fillRect(sx + 3, sy + 6, 11, 6);
    ctx.fillRect(sx + 5, sy + 3, 3, 7);
    ctx.fillRect(sx + 10, sy + 2, 2, 8);
    ctx.fillStyle = p.propHi;
    ctx.fillRect(sx + 4 + variant, sy + 5, 2, 2);
    ctx.fillRect(sx + 11, sy + 8, 2, 2);
  }

  function drawPixelReed(ctx, sx, sy, p, variant) {
    ctx.fillStyle = p.shadow;
    ctx.fillRect(sx + 2, sy + 13, 12, 2);
    ctx.fillStyle = p.prop;
    ctx.fillRect(sx + 4, sy + 5, 2, 9);
    ctx.fillRect(sx + 8, sy + 2, 1, 12);
    ctx.fillRect(sx + 11, sy + 6, 2, 8);
    ctx.fillStyle = p.propHi;
    ctx.fillRect(sx + 3, sy + 4, 4, 2);
    ctx.fillRect(sx + 9, sy + 5 + variant, 4, 2);
  }

  function drawPixelStone(ctx, sx, sy, p, variant) {
    ctx.fillStyle = p.shadow;
    ctx.fillRect(sx + 2, sy + 11, 12, 3);
    ctx.fillStyle = p.prop;
    ctx.fillRect(sx + 3, sy + 7, 11, 5);
    ctx.fillRect(sx + 5, sy + 4, 7, 5);
    ctx.fillStyle = p.propHi;
    ctx.fillRect(sx + 6, sy + 5, 4 + (variant % 2), 1);
  }

  function drawPixelColumn(ctx, sx, sy, p, variant) {
    ctx.fillStyle = p.shadow;
    ctx.fillRect(sx + 2, sy + 12, 12, 2);
    ctx.fillStyle = p.prop;
    ctx.fillRect(sx + 5, sy + 3 + variant, 7, 9 - variant);
    ctx.fillRect(sx + 3, sy + 11, 11, 2);
    ctx.fillStyle = p.propHi;
    ctx.fillRect(sx + 6, sy + 4 + variant, 1, 6 - Math.min(variant, 2));
  }

  function drawPixelStake(ctx, sx, sy, p, variant) {
    ctx.fillStyle = p.shadow;
    ctx.fillRect(sx + 2, sy + 13, 12, 2);
    ctx.fillStyle = p.prop;
    ctx.fillRect(sx + 7, sy + 2, 3, 12);
    ctx.fillRect(sx + 3, sy + 5 + variant, 11, 2);
    ctx.fillStyle = p.propHi;
    ctx.fillRect(sx + 8, sy + 3, 1, 8);
  }

  function drawPixelRecord(ctx, sx, sy, p, variant) {
    ctx.fillStyle = p.shadow;
    ctx.fillRect(sx + 2, sy + 12, 12, 2);
    ctx.fillStyle = p.prop;
    ctx.fillRect(sx + 4, sy + 4, 9, 9);
    ctx.fillStyle = p.propHi;
    ctx.fillRect(sx + 6, sy + 6, 5, 1);
    ctx.fillRect(sx + 6, sy + 8 + (variant % 2), 4, 1);
    ctx.fillRect(sx + 6, sy + 11, 5, 1);
  }

  function drawObstacle(ctx, obstacle, sx, sy, palette) {
    switch (obstacle.kind) {
      case 'bramble': drawPixelBramble(ctx, sx, sy, palette, obstacle.variant); break;
      case 'reed': drawPixelReed(ctx, sx, sy, palette, obstacle.variant); break;
      case 'stone': drawPixelStone(ctx, sx, sy, palette, obstacle.variant); break;
      case 'column': drawPixelColumn(ctx, sx, sy, palette, obstacle.variant); break;
      case 'stake': drawPixelStake(ctx, sx, sy, palette, obstacle.variant); break;
      case 'record': drawPixelRecord(ctx, sx, sy, palette, obstacle.variant); break;
      default: drawPixelGrave(ctx, sx, sy, palette, obstacle.variant); break;
    }
  }

  function drawGate(ctx, gate, camera, viewW, viewH, options) {
    const locked = !questReached(options, gate.unlock);
    const p = screenPoint(gate.x, gate.y, camera, viewW, viewH);
    if (p.x < -24 || p.x > viewW + 24 || p.y < -80 || p.y > viewH + 80) return;
    ctx.save();
    ctx.fillStyle = locked ? '#2a2220' : '#2b3028';
    ctx.fillRect(p.x - 5, p.y - gate.halfHeight, 10, gate.halfHeight * 2);
    ctx.fillStyle = locked ? '#9a6552' : '#67735f';
    ctx.fillRect(p.x - 3, p.y - gate.halfHeight + 3, 2, gate.halfHeight * 2 - 6);
    ctx.fillRect(p.x + 1, p.y - gate.halfHeight + 3, 2, gate.halfHeight * 2 - 6);
    if (locked) {
      ctx.fillStyle = '#d8c4a4';
      ctx.font = '7px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(gate.label, p.x, p.y - gate.halfHeight - 7);
    }
    ctx.restore();
  }

  function drawProps(ctx, camera, viewW, viewH, time, options) {
    if (!ctx || !camera) return;
    const range = visibleTileRange(camera, viewW, viewH);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (let ty = range.minTY; ty <= range.maxTY; ty += 1) {
      for (let tx = range.minTX; tx <= range.maxTX; tx += 1) {
        const wx = tx * TILE + TILE / 2;
        const wy = ty * TILE + TILE / 2;
        const tile = tileAt(wx, wy, options);
        if (!tile.obstacle || tile.outside) continue;
        const sx = Math.round(tx * TILE - camera.x + viewW / 2);
        const sy = Math.round(ty * TILE - camera.y + viewH / 2);
        drawObstacle(ctx, tile.obstacle, sx, sy, tile.region.palette);
      }
    }
    if (!options || options.drawGates !== false) {
      for (let i = 0; i < GATES.length; i += 1) drawGate(ctx, GATES[i], camera, viewW, viewH, options);
    }
    ctx.restore();
  }

  function landmarkColor(mark) {
    if (mark.kind === 'hearth') return '#f1c75b';
    if (mark.kind === 'boss') return '#d06a54';
    if (mark.kind === 'portal') return '#70b0a2';
    if (mark.kind === 'puzzle') return '#b9a3cc';
    if (mark.kind === 'vault') return '#b9a06a';
    return '#c7c1b4';
  }

  function drawLandmarkIcon(ctx, mark, sx, sy, time) {
    const color = landmarkColor(mark);
    const pulse = mark.kind === 'hearth' ? Math.round(Math.sin(time * 3) * 2) : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(sx - 7, sy + 5, 14, 3);
    ctx.fillStyle = color;
    if (mark.kind === 'hearth') {
      ctx.fillRect(sx - 2, sy - 10 - pulse, 5, 14 + pulse);
      ctx.fillRect(sx - 6, sy - 4, 13, 4);
      ctx.fillStyle = '#fff0a8';
      ctx.fillRect(sx, sy - 8 - pulse, 1, 8 + pulse);
    } else if (mark.kind === 'vault' || mark.kind === 'portal') {
      ctx.fillRect(sx - 6, sy - 5, 13, 11);
      ctx.fillStyle = '#171715';
      ctx.fillRect(sx - 2, sy - 2, 5, 8);
    } else if (mark.kind === 'cairn') {
      ctx.fillRect(sx - 6, sy + 2, 13, 4);
      ctx.fillRect(sx - 4, sy - 2, 9, 4);
      ctx.fillRect(sx - 2, sy - 5, 5, 3);
    } else if (mark.kind === 'ledger' || mark.kind === 'puzzle') {
      ctx.fillRect(sx - 6, sy - 5, 13, 11);
      ctx.fillStyle = '#2a2421';
      ctx.fillRect(sx, sy - 4, 1, 9);
    } else {
      ctx.fillRect(sx - 4, sy - 7, 9, 13);
      ctx.fillStyle = '#24211f';
      ctx.fillRect(sx - 2, sy - 4, 5, 1);
      ctx.fillRect(sx - 2, sy - 1, 5, 1);
    }
  }

  function drawLandmarks(ctx, camera, viewW, viewH, time, options) {
    if (!ctx || !camera) return;
    const opts = options || {};
    const showLabels = opts.labels !== false;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < LANDMARKS.length; i += 1) {
      const mark = LANDMARKS[i];
      if (opts.onlyUnlocked && !questReached(opts, mark.unlock)) continue;
      const p = screenPoint(mark.x, mark.y, camera, viewW, viewH);
      if (p.x < -80 || p.x > viewW + 80 || p.y < -50 || p.y > viewH + 50) continue;
      drawLandmarkIcon(ctx, mark, p.x, p.y, time || 0);
      if (showLabels && (mark.major || opts.allLabels)) {
        ctx.font = '8px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(12,11,12,0.82)';
        const width = Math.ceil(ctx.measureText(mark.name).width) + 8;
        ctx.fillRect(Math.round(p.x - width / 2), p.y - 23, width, 11);
        ctx.fillStyle = landmarkColor(mark);
        ctx.fillText(mark.name.toUpperCase(), p.x, p.y - 15);
      }
    }
    ctx.restore();
  }

  function drawRegionTitle(ctx, x, y, region) {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.font = 'bold 9px ui-monospace, monospace';
    ctx.fillStyle = region.palette.accent;
    ctx.fillText(region.name.toUpperCase(), x, y);
    ctx.restore();
  }

  function worldToMapX(x, mapX, mapW) {
    return mapX + ((x - BOUNDS.minX) / (BOUNDS.maxX - BOUNDS.minX)) * mapW;
  }

  function worldToMapY(y, mapY, mapH) {
    return mapY + ((y - BOUNDS.minY) / (BOUNDS.maxY - BOUNDS.minY)) * mapH;
  }

  function drawMinimap(ctx, x, y, width, height, player, options) {
    if (!ctx) return;
    const opts = options || {};
    const w = width || 184;
    const h = height || 64;
    ctx.save();
    ctx.fillStyle = 'rgba(10,9,12,0.88)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(241,199,91,0.55)';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    for (let i = 0; i < REGIONS.length; i += 1) {
      const region = REGIONS[i];
      const x0 = worldToMapX(region.minX, x, w);
      const x1 = worldToMapX(region.maxX, x, w);
      ctx.fillStyle = region.palette.groundAlt;
      ctx.fillRect(Math.floor(x0), y + 2, Math.ceil(x1 - x0), h - 4);
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let r = 0; r < ROADS.length; r += 1) {
      const road = ROADS[r];
      const first = road.points[0];
      ctx.beginPath();
      ctx.moveTo(worldToMapX(first.x, x, w), worldToMapY(first.y, y, h));
      for (let i = 1; i < road.points.length; i += 1) {
        const p = road.points[i];
        ctx.lineTo(worldToMapX(p.x, x, w), worldToMapY(p.y, y, h));
      }
      ctx.strokeStyle = road.kind === 'boardwalk' ? '#80694f' : '#8d785b';
      ctx.lineWidth = road.id === 'parish-road' ? 2 : 1;
      ctx.stroke();
    }

    if (opts.landmarks !== false) {
      for (let i = 0; i < LANDMARKS.length; i += 1) {
        const mark = LANDMARKS[i];
        if (!mark.major && !opts.allLandmarks) continue;
        if (opts.onlyUnlocked && !questReached(opts, mark.unlock)) continue;
        ctx.fillStyle = landmarkColor(mark);
        const mx = Math.round(worldToMapX(mark.x, x, w));
        const my = Math.round(worldToMapY(mark.y, y, h));
        ctx.fillRect(mx - 1, my - 1, mark.kind === 'hearth' ? 4 : 3, mark.kind === 'hearth' ? 4 : 3);
      }
    }

    if (player && Number.isFinite(player.x) && Number.isFinite(player.y)) {
      const px = Math.round(worldToMapX(player.x, x, w));
      const py = Math.round(worldToMapY(player.y, y, h));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px - 2, py - 2, 5, 5);
      ctx.fillStyle = '#17151a';
      ctx.fillRect(px, py, 1, 1);
    }

    ctx.restore();
  }

  function contentLandmarks(content) {
    if (!content) return [];
    const out = [];
    if (Array.isArray(content.AREA1_LORE)) {
      for (let i = 0; i < content.AREA1_LORE.length; i += 1) {
        const item = content.AREA1_LORE[i];
        out.push({ id: item.id, name: item.title || item.id, x: item.x, y: item.y, kind: item.kind || 'lore' });
      }
    }
    if (Array.isArray(content.AREA1_PUZZLES)) {
      for (let i = 0; i < content.AREA1_PUZZLES.length; i += 1) {
        const puzzle = content.AREA1_PUZZLES[i];
        if (puzzle.clue) out.push({ id: puzzle.id, name: puzzle.title || puzzle.id, x: puzzle.clue.x, y: puzzle.clue.y, kind: 'puzzle' });
      }
    }
    if (Array.isArray(content.WORLD_PORTALS)) {
      for (let i = 0; i < content.WORLD_PORTALS.length; i += 1) {
        const portal = content.WORLD_PORTALS[i];
        out.push({ id: portal.id, name: portal.label || portal.id, x: portal.x, y: portal.y, kind: portal.kind || 'portal', unlock: portal.unlock });
      }
    }
    return out;
  }

  return Object.freeze({
    VERSION: VERSION,
    TILE: TILE,
    BOUNDS: BOUNDS,
    REGIONS: REGIONS,
    ROADS: ROADS,
    LANDMARKS: LANDMARKS,
    GATES: GATES,
    WATER: WATER,
    clamp: clamp,
    lerp: lerp,
    smoothstep: smoothstep,
    hash2: hash2,
    regionAt: regionAt,
    roadInfoAt: roadInfoAt,
    tileAt: tileAt,
    isBlocked: isBlocked,
    circleBlocked: circleBlocked,
    moveCircle: moveCircle,
    nearestLandmark: nearestLandmark,
    locationAt: locationAt,
    contentLandmarks: contentLandmarks,
    drawGround: drawGround,
    drawProps: drawProps,
    drawLandmarks: drawLandmarks,
    drawRegionTitle: drawRegionTitle,
    drawMinimap: drawMinimap
  });
});
