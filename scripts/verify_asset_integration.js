#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { decodePng } = require('./lib/pixel-png');

const ROOT = path.join(__dirname, '..');
const PIXEL_DIR = path.join(ROOT, 'assets', 'pixel');
const SOURCE_DIR = path.join(ROOT, 'assets', 'source');
const manifest = readJson(path.join(PIXEL_DIR, 'manifest.json'));
const sourceManifest = readJson(path.join(SOURCE_DIR, 'manifest.json'));
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const content = fs.readFileSync(path.join(ROOT, 'game', 'content.js'), 'utf8');
const platformer = fs.readFileSync(path.join(ROOT, 'engine', 'platformer.js'), 'utf8');
const battlefield = fs.readFileSync(path.join(ROOT, 'engine', 'battlefield.js'), 'utf8');

const runtimeAssets = [
  ['free-knight-idle', 'free-knight-idle.png', 120, 80, 10],
  ['free-knight-run', 'free-knight-run.png', 120, 80, 10],
  ['free-knight-jump', 'free-knight-jump.png', 120, 80, 3],
  ['free-knight-fall', 'free-knight-fall.png', 120, 80, 3],
  ['free-knight-attack', 'free-knight-attack.png', 120, 80, 4],
  ['free-knight-hit', 'free-knight-hit.png', 120, 80, 1],
  ['free-knight-death', 'free-knight-death.png', 120, 80, 10],
  ['pf-flying-eye', 'pf-flying-eye.png', 64, 64, 6],
  ['pf-goblin', 'pf-goblin.png', 64, 64, 12],
  ['pf-mushroom', 'pf-mushroom.png', 64, 64, 11],
  ['pf-skeleton', 'pf-skeleton.png', 64, 64, 6],
  ['pf-flying-eye-projectile', 'pf-flying-eye-projectile.png', 48, 48, 8],
  ['pf-goblin-bomb', 'pf-goblin-bomb.png', 100, 100, 19],
  ['pf-mushroom-projectile', 'pf-mushroom-projectile.png', 50, 50, 8],
  ['pf-skeleton-sword', 'pf-skeleton-sword.png', 92, 102, 8],
  ['flying-eye', 'flying-eye.png', 24, 24, 4],
  ['mushroom', 'mushroom.png', 24, 24, 4],
];

const relicIcons = [
  ['relic-ember-edge', 'relic-ember-edge.png'],
  ['relic-warden-sigil', 'relic-warden-sigil.png'],
  ['relic-green-knot', 'relic-green-knot.png'],
  ['relic-rune-lens', 'relic-rune-lens.png'],
  ['relic-tallow-brand', 'relic-tallow-brand.png'],
];

for (const id of ['kenney-roguelike', 'free-knight', 'monster-creatures-fantasy', 'items']) {
  assert(sourceManifest.some(entry => entry.id === id), `assets/source/manifest.json missing ${id}`);
  assert(fs.existsSync(path.join(SOURCE_DIR, id)), `assets/source/${id} is missing`);
}

for (const [key, file, frameW, frameH, frames] of runtimeAssets) {
  const meta = manifest[key];
  assert(meta, `manifest missing ${key}`);
  assert(meta.file === file, `${key} file mismatch`);
  assert(meta.frameW === frameW && meta.frameH === frameH, `${key} frame size mismatch`);
  assert((meta.frames || []).length === frames, `${key} frame count mismatch`);
  const img = decodePng(path.join(PIXEL_DIR, file));
  assert(img.width === frameW * frames && img.height === frameH, `${file} dimensions mismatch`);
  assert(
    index.includes(`'${key}':{src:'assets/pixel/${file}',w:${frameW},h:${frameH},img:null}`) ||
    index.includes(`${key}:{src:'assets/pixel/${file}',w:${frameW},h:${frameH},img:null}`) ||
    content.includes(`'${key}':{src:'assets/pixel/${file}',w:${frameW},h:${frameH},img:null}`) ||
    content.includes(`${key}:{src:'assets/pixel/${file}',w:${frameW},h:${frameH},img:null}`),
    `ASSETS table missing ${key}`);
}

for (const [key, file] of relicIcons) {
  const meta = manifest[key];
  assert(meta && meta.type === 'icon', `manifest missing icon ${key}`);
  assert(fs.existsSync(path.join(PIXEL_DIR, file)), `${file} is missing`);
  assert(index.includes(`icon:'${key}'`) || content.includes(`icon:'${key}'`), `RELICS does not use ${key}`);
}

for (const key of ['pf-goblin', 'pf-skeleton', 'pf-mushroom', 'pf-flying-eye']) {
  assert(index.includes(`sprite:'${key}'`) || content.includes(`sprite:'${key}'`), `PLAT_LEVEL missing platformer enemy ${key}`);
}

assert(platformer.includes('function updateEnemies') && platformer.includes('enemyBody'),
  'platformer enemy loop is missing');
assert(platformer.includes('free-knight-run') && platformer.includes('free-knight-attack'),
  'platformer FreeKnight animation keys are missing');
assert(battlefield.includes('asset:t.asset||typeKey') && battlefield.includes('cr.asset||cr.key'),
  'battlefield asset indirection is missing');
assert(index.includes('drawAssetProof') && index.includes('ASSET_PROOF_MODE'),
  'asset proof route is missing');
assert(index.includes('minHollows') && index.includes("spawnEnemy('mushroom'") && index.includes("spawnEnemy('flying-eye'"),
  'town badguy unlock integration is missing');

console.log('asset integration verification passed');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assert(ok, message) {
  if (!ok) throw new Error(message);
}
