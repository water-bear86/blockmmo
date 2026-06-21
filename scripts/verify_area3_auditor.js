// Verify the Area 3 finale — the Auditor's three permanent endings (issue #24/#5).
// The Auditor cannot be killed; the climax is a CHOICE of three account-bound endings (A/B/C).
// Choice C ('amend') is the ONLY path to the Amended Record sigil and the endgame. The ledger is
// preserved across every ending (no on-chain wipe — flag-based per the ratified scope ruling).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const content = require(path.join(root, 'game', 'content.js'));
const serverApi = require(path.join(root, 'server.js'));
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function makeCredential() {
  const { publicKey, privateKey } = require('crypto').generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    publicKey: publicKey.export({ format: 'jwk' }),
    sign(message) {
      return base64url(require('crypto').sign('sha256', Buffer.from(message), { key: privateKey, dsaEncoding: 'ieee-p1363' }));
    },
  };
}

function makeClient(id) {
  return {
    id,
    name: id,
    socket: {
      writable: true,
      writes: [],
      write(frame) { this.writes.push(frame); },
      end() {},
    },
    last: {},
  };
}

function readMessages(client) {
  const frames = client.socket.writes.splice(0);
  const messages = [];
  let buffer = Buffer.concat(frames);
  while (buffer.length) {
    const frame = serverApi.decodeFrame(buffer);
    assert(frame, 'expected complete server frame');
    messages.push(JSON.parse(frame.payload.toString('utf8')));
    buffer = frame.rest;
  }
  return messages;
}

function authenticate(realm, client, credential, name) {
  const challenge = realm.handleParsedMessage(client, {
    t: 'account:challenge',
    credential: { type: 'browser-p256-v1', publicKey: credential.publicKey },
  });
  assert.strictEqual(challenge.ok, true, 'challenge should succeed');
  const challengeMsg = readMessages(client)[0];
  const join = realm.handleParsedMessage(client, {
    t: 'join',
    id: client.id,
    name,
    credential: {
      type: 'browser-p256-v1',
      publicKey: credential.publicKey,
      challengeId: challengeMsg.challengeId,
      signature: credential.sign(challengeMsg.message),
    },
  });
  assert.strictEqual(join.ok, true, 'join should succeed');
  return readMessages(client).find((m) => m.t === 'account');
}

function assertRejected(result, code) {
  assert.strictEqual(result.ok, false, 'expected rejection ' + code);
  assert.strictEqual(result.error.code, code);
}

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

// ---- Server persistence + public visibility --------------------------------
const os = require('os');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'area3-auditor-'));
const accountsFile = path.join(tempDir, 'accounts.json');
let nowMs = 10_000;
const registry = serverApi.createAccountRegistry({
  accountsFile,
  season: { id: 'area3', opensAt: 1, closesAt: 99_999, mandatoryTasks: [] },
  now: () => nowMs,
});
const recorderCredential = makeCredential();
const recorderJoin = (() => {
  const challenge = registry.createChallenge({ type: 'browser-p256-v1', publicKey: recorderCredential.publicKey });
  assert.strictEqual(challenge.ok, true, 'registry challenge should succeed');
  const join = registry.verifyJoin({
    type: 'browser-p256-v1',
    publicKey: recorderCredential.publicKey,
    challengeId: challenge.challenge.challengeId,
    signature: recorderCredential.sign(challenge.challenge.message),
  }, 'Second Scribe');
  assert.strictEqual(join.ok, true, 'registry join should succeed');
  return join;
})();
const recorded = registry.recordAuditorEnding(recorderJoin.accountId, 'C', 12_345);
assert.strictEqual(recorded.ok, true, 'server should record a valid Auditor ending');
assert.strictEqual(recorded.character.auditorEnding.id, 'C', 'ending C should persist on the season character');
assert.strictEqual(recorded.character.auditorEnding.public, true, 'recorded ending must be explicitly public');
assert.strictEqual(recorded.character.endgameUnlocked, true, 'Choice C opens the persisted endgame flag');
assert(recorded.character.collection.sigils.includes('amended-record'), 'Choice C persists the Amended Record sigil');
assertRejected(registry.recordAuditorEnding(recorderJoin.accountId, 'A', 12_346), 'auditor_ending_locked');

const reloaded = serverApi.createAccountRegistry({
  accountsFile,
  season: { id: 'area3', opensAt: 1, closesAt: 99_999, mandatoryTasks: [] },
  now: () => nowMs,
});
const reloadedState = reloaded.getCharacterState(recorderJoin.accountId, 'area3').character;
assert.strictEqual(reloadedState.auditorEnding.id, 'C', 'recorded ending survives registry reload');

const realm = serverApi.createRealmServer({
  ledgerFile: path.join(tempDir, 'ledger.json'),
  accountsFile: path.join(tempDir, 'realm-accounts.json'),
  seasonId: 'area3',
  season: { id: 'area3', opensAt: 1, closesAt: 99_999, mandatoryTasks: [] },
  now: () => ++nowMs,
  saveDelayMs: 0,
  quiet: true,
});
const recorder = makeClient('recorder');
const witness = makeClient('witness');
realm.addClient(recorder);
realm.addClient(witness);
authenticate(realm, recorder, makeCredential(), 'Recorder');
authenticate(realm, witness, makeCredential(), 'Witness');
readMessages(witness);
const recordMsg = realm.handleParsedMessage(recorder, { t: 'auditor:ending', ending: 'C' });
assert.strictEqual(recordMsg.ok, true, 'realm should accept a first valid Auditor ending');
const ack = readMessages(recorder).find((m) => m.t === 'auditor:ending');
assert(ack && ack.ending.id === 'C', 'recorder should receive an ending acknowledgement');
realm.handleParsedMessage(recorder, { t: 'state', skin: 'tarnished', x: 11, y: 0, z: 22, yaw: 0, moving: false });
const publicState = readMessages(witness).find((m) => m.t === 'state');
assert(publicState && publicState.auditorEnding && publicState.auditorEnding.id === 'C',
  'peer-visible state must include the public Auditor ending');
assert.strictEqual(publicState.auditorEnding.public, true, 'public state ending must be marked public');
fs.rmSync(tempDir, { recursive: true, force: true });

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
for (const sym of ['progress.ending', 'progress.endgameUnlocked', 'function openAuditorChoice', 'function resolveAuditorChoice', 'AUDITOR_ENDINGS', 'recordAuditorEnding']) {
  assert(index.includes(sym), 'index.html must wire ' + sym);
}
assert(/const\s*\{[\s\S]*\bAUDITOR_ENDINGS\b[\s\S]*\}\s*=\s*Content;/.test(index),
  'index.html must import AUDITOR_ENDINGS from RUNECHAIN_CONTENT at runtime');
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
