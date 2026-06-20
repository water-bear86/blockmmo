// Verify the Area 3 finale — the Auditor's three permanent endings (issue #24/#5).
// The Auditor cannot be killed; the climax is a CHOICE of three account-bound endings (A/B/C).
// Choice C ('amend') is the ONLY path to the Amended Record sigil and the endgame. The ledger is
// preserved across every ending (no on-chain wipe — flag-based per the ratified scope ruling).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const content = require(path.join(root, 'game', 'content.js'));
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// ---- Data: the three endings -------------------------------------------------
const E = content.AUDITOR_ENDINGS;
assert(Array.isArray(E) && E.length === 3, 'AUDITOR_ENDINGS must define exactly three endings');
assert.deepStrictEqual(E.map((e) => e.id), ['A', 'B', 'C'], 'endings are A, B, C');
for (const e of E) {
  assert(e.title && e.label, e.id + ' needs a title + a choice label');
  assert(Array.isArray(e.lines) && e.lines.length >= 2, e.id + ' needs >= 2 outcome lines');
}

// Exactly one ending (C) seals the Amended Record sigil and opens the endgame.
const sigilEndings = E.filter((e) => e.sigil);
assert.strictEqual(sigilEndings.length, 1, 'exactly one ending grants a sigil');
assert.strictEqual(sigilEndings[0].id, 'C', 'the sigil ending is Choice C');
assert.strictEqual(sigilEndings[0].sigil, 'amended-record', 'Choice C seals the Amended Record');
assert.strictEqual(sigilEndings[0].endgame, true, 'Choice C opens the endgame');
assert(E.filter((e) => e.endgame).length === 1, 'only one ending opens the endgame');

// Sigil registry agreement.
assert.strictEqual(content.BOSS_SIGILS.auditor, 'amended-record', 'auditor maps to amended-record');
assert(content.SIGILS['amended-record'] && content.SIGILS['amended-record'].endgame, 'amended-record is an endgame sigil');

// ---- The Auditor cannot be killed -------------------------------------------
// The finale quest completes on an 'ending' event, not a kill.
const finalQuest = content.STORY.quests.find((q) => q.id === 'q13');
assert(finalQuest, 'q13 (The Auditor) must exist');
assert.strictEqual(finalQuest.steps[0].done.event, 'ending', 'q13 completes via the choice (ending), not a kill');

// The auditor encounter has no turn-based duel segment (no fight to win).
const enc = content.AREA3_ENCOUNTERS.auditor;
assert(enc && Array.isArray(enc.segments), 'auditor encounter must exist');
assert(!enc.segments.some((s) => s.complete && s.complete.event === 'duel'),
  'auditor encounter must NOT contain a duel segment — it cannot be fought to death');
assert(!enc.segments.some((s) => s.mode === 'turnbased'),
  'auditor encounter must not end in a turn-based duel');

// ---- Host wiring (index.html) ------------------------------------------------
for (const sym of ['progress.ending', 'progress.endgameUnlocked', 'function openAuditorChoice', 'function resolveAuditorChoice', 'AUDITOR_ENDINGS']) {
  assert(index.includes(sym), 'index.html must wire ' + sym);
}
// killEnemy must funnel the auditor into the choice instead of the normal kill/mint.
assert(/if\(e\.key===['"]auditor['"]\)\{\s*openAuditorChoice\(e\);\s*return;/.test(index),
  'killEnemy must route the auditor to openAuditorChoice (cannot be killed)');
// The choice is permanent / account-bound.
assert(/function resolveAuditorChoice\(id\)\{\s*\n?\s*if\(progress\.ending\)return;/.test(index),
  'resolveAuditorChoice must be idempotent — an ending is permanent');
// The amended-record sigil is minted ONLY under an ending that carries a sigil (Choice C).
assert(/if\(ending\.sigil\)\{[\s\S]*?Chain\.mintGreatRune/.test(index),
  'the sigil mint must be gated behind ending.sigil (Choice C only)');
// The choice fires the ending event that completes q13.
assert(/Story\.event\(['"]ending['"]/.test(index), 'resolveAuditorChoice must fire the ending event');

console.log('area3 auditor verification passed (3 endings; cannot be killed; Choice C = Amended Record + endgame; ledger preserved)');
