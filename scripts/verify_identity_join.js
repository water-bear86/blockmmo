/* Realm-level end-to-end test of the sign-in flow: device (P-256) + SSO (session) + wallet (Solana)
 * bound to one account over the live WS message dispatch, with RUNECHAIN_REQUIRE_IDENTITY on.
 * Exercises the happy path, returning login, the uniqueness rejections (one-per-device / one-per-wallet),
 * the requirement gates, and confirms the legacy device-only join still works when the flag is off. */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const serverApi = require(path.join(root, 'server.js'));
const identity = require(path.join(root, 'game', 'identity.js'));

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function makeClient(id) {
  return { id, name: id, socket: { writable: true, writes: [], write(f) { this.writes.push(f); }, end() {} }, last: {}, sso: null };
}
function readMessages(client) {
  const messages = [];
  let buffer = Buffer.concat(client.socket.writes.splice(0));
  while (buffer.length) {
    const frame = serverApi.decodeFrame(buffer);
    assert(frame, 'expected complete server frame');
    messages.push(JSON.parse(frame.payload.toString('utf8')));
    buffer = frame.rest;
  }
  return messages;
}
function makeDevice() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    publicKey: publicKey.export({ format: 'jwk' }),
    sign(message) { return base64url(crypto.sign('sha256', Buffer.from(message), { key: privateKey, dsaEncoding: 'ieee-p1363' })); },
  };
}
function makeWallet() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return {
    raw, address: identity.solanaAddress(raw),
    sign(message) { return crypto.sign(null, Buffer.from(message, 'utf8'), privateKey); },
  };
}

// Drive the full client handshake. Returns the join result (no asserts so callers can test rejections).
function attemptJoin(realm, client, { device, wallet, sso, name = 'Recorder', badWalletSig = false }) {
  client.sso = sso || null;
  // 1. device challenge
  realm.handleParsedMessage(client, { t: 'account:challenge', credential: { type: 'browser-p256-v1', publicKey: device.publicKey } });
  const challenge = readMessages(client).find((m) => m.t === 'account:challenge');
  const credential = { type: 'browser-p256-v1', publicKey: device.publicKey, challengeId: challenge.challengeId, signature: device.sign(challenge.message) };

  // 2. wallet challenge + proof
  let walletProof;
  if (wallet) {
    realm.handleParsedMessage(client, { t: 'wallet:challenge', wallet: { address: wallet.address } });
    const wc = readMessages(client).find((m) => m.t === 'wallet:challenge');
    const sig = wallet.sign(badWalletSig ? wc.message + 'TAMPER' : wc.message);
    walletProof = { chain: 'solana', publicKey: base64url(wallet.raw), signature: base64url(sig), nonce: wc.nonce };
  }

  // 3. join
  const result = realm.handleParsedMessage(client, { t: 'join', name, credential, wallet: walletProof });
  return { result, messages: readMessages(client) };
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-join-'));
let nowMs = 10_000;
const realm = serverApi.createRealmServer({
  ledgerFile: path.join(tempDir, 'ledger.json'),
  accountsFile: path.join(tempDir, 'accounts.json'),
  seasonId: 'season-one', difficulty: 1, now: () => nowMs, saveDelayMs: 0, quiet: true,
  requireIdentity: true, requireWallet: true, // full enforcement: both legs required
});

const ssoA = { provider: 'google', sub: 'google-sub-A', email: 'a@x.io', emailVerified: true, name: 'Ada' };
const ssoB = { provider: 'google', sub: 'google-sub-B', email: 'b@x.io', emailVerified: true, name: 'Bo' };
const deviceA = makeDevice();
const walletA = makeWallet();

// --- requirement gates -----------------------------------------------------------------------------
const noSso = attemptJoin(realm, makeClient('c1'), { device: makeDevice(), wallet: makeWallet(), sso: null });
assert.strictEqual(noSso.result.ok, false);
assert.strictEqual(noSso.result.error.code, 'sso_required', 'no session -> sso_required');

const noWallet = attemptJoin(realm, makeClient('c2'), { device: makeDevice(), wallet: null, sso: ssoA });
assert.strictEqual(noWallet.result.error.code, 'wallet_required', 'sso but no wallet -> wallet_required');

// --- bad wallet signature --------------------------------------------------------------------------
const badSig = attemptJoin(realm, makeClient('c3'), { device: makeDevice(), wallet: makeWallet(), sso: ssoB, badWalletSig: true });
assert.strictEqual(badSig.result.error.code, 'invalid_wallet_signature', 'tampered wallet signature rejected');

// --- happy path: new signup binds all three --------------------------------------------------------
const signup = attemptJoin(realm, makeClient('a'), { device: deviceA, wallet: walletA, sso: ssoA, name: 'Ada' });
assert.strictEqual(signup.result.ok, true, JSON.stringify(signup.result));
const acctMsg = signup.messages.find((m) => m.t === 'account');
assert.strictEqual(acctMsg.createdAccount, true);
assert.strictEqual(signup.result.identity.sso.email, 'a@x.io');
assert.strictEqual(signup.result.identity.wallet.address, walletA.address);
assert.strictEqual(signup.result.identity.wallet.chain, 'solana');
const acctId = signup.result.accountId;

// Persisted: identity legs present, no secrets stored.
const persisted = JSON.parse(fs.readFileSync(path.join(tempDir, 'accounts.json'), 'utf8'));
assert.strictEqual(persisted.accounts[acctId].identity.sso.sub, 'google-sub-A');
assert.strictEqual(persisted.accounts[acctId].identity.wallet.address, walletA.address);
assert(persisted.accounts[acctId].devices.length >= 1, 'device bound');
const dump = JSON.stringify(persisted);
assert(!dump.includes('signature'), 'no login/wallet signatures persisted');

// --- returning login: same device + same sso + same wallet -> same account, not created ------------
nowMs = 11_000;
const returning = attemptJoin(realm, makeClient('a2'), { device: deviceA, wallet: walletA, sso: ssoA, name: 'Ada Renamed' });
assert.strictEqual(returning.result.ok, true);
assert.strictEqual(returning.result.accountId, acctId, 'returning login resolves to the same account');
assert.strictEqual(returning.messages.find((m) => m.t === 'account').createdAccount, false);

// --- one signup per device: the SAME Google account from a DIFFERENT device is rejected ------------
const sameSsoNewDevice = attemptJoin(realm, makeClient('a3'), { device: makeDevice(), wallet: makeWallet(), sso: ssoA });
assert.strictEqual(sameSsoNewDevice.result.error.code, 'sso_in_use', 'second device with same Google -> sso_in_use');

// --- one account per wallet: a new account presenting the existing wallet is rejected --------------
const reusedWallet = attemptJoin(realm, makeClient('a4'), { device: makeDevice(), wallet: walletA, sso: ssoB });
assert.strictEqual(reusedWallet.result.error.code, 'wallet_in_use', 'reused wallet on a new account -> wallet_in_use');

// --- a genuinely distinct second account (new device + new sso + new wallet) succeeds --------------
const second = attemptJoin(realm, makeClient('b'), { device: makeDevice(), wallet: makeWallet(), sso: ssoB, name: 'Bo' });
assert.strictEqual(second.result.ok, true);
assert.notStrictEqual(second.result.accountId, acctId);
realm.close();

// --- Google-only mode: requireIdentity ON, requireWallet OFF -> SSO required, wallet OPTIONAL -------
const ssoOnlyRealm = serverApi.createRealmServer({
  ledgerFile: path.join(tempDir, 'ledger-ssoonly.json'),
  accountsFile: path.join(tempDir, 'accounts-ssoonly.json'),
  seasonId: 'season-one', difficulty: 1, now: () => 13_000, saveDelayMs: 0, quiet: true,
  requireIdentity: true, requireWallet: false,
});
const ssoC = { provider: 'google', sub: 'google-sub-C', email: 'c@x.io', emailVerified: true, name: 'Cy' };
// no session -> still rejected (SSO is required)
assert.strictEqual(attemptJoin(ssoOnlyRealm, makeClient('s1'), { device: makeDevice(), sso: null }).result.error.code, 'sso_required', 'Google-only still requires SSO');
// signed in, NO wallet -> succeeds (wallet not required in this mode)
const ssoOnly = attemptJoin(ssoOnlyRealm, makeClient('s2'), { device: makeDevice(), wallet: null, sso: ssoC, name: 'Cy' });
assert.strictEqual(ssoOnly.result.ok, true, 'Google-only: SSO without a wallet joins');
assert.strictEqual(ssoOnly.result.identity.sso.email, 'c@x.io');
assert.strictEqual(ssoOnly.result.identity.wallet, null, 'no wallet bound in Google-only mode');
ssoOnlyRealm.close();

// --- legacy path: with requireIdentity OFF, device-only join still works ----------------------------
const legacyRealm = serverApi.createRealmServer({
  ledgerFile: path.join(tempDir, 'ledger-legacy.json'),
  accountsFile: path.join(tempDir, 'accounts-legacy.json'),
  seasonId: 'season-one', difficulty: 1, now: () => 12_000, saveDelayMs: 0, quiet: true,
  // requireIdentity defaults off
});
const legacyClient = makeClient('legacy');
legacyRealm.handleParsedMessage(legacyClient, { t: 'account:challenge', credential: { type: 'browser-p256-v1', publicKey: deviceA.publicKey } });
const lc = readMessages(legacyClient).find((m) => m.t === 'account:challenge');
const legacyJoin = legacyRealm.handleParsedMessage(legacyClient, {
  t: 'join', name: 'Legacy',
  credential: { type: 'browser-p256-v1', publicKey: deviceA.publicKey, challengeId: lc.challengeId, signature: deviceA.sign(lc.message) },
});
assert.strictEqual(legacyJoin.ok, true, 'legacy device-only join works when identity not required');
assert.strictEqual(readMessages(legacyClient).find((m) => m.t === 'account').createdAccount, true);
legacyRealm.close();

fs.rmSync(tempDir, { recursive: true, force: true });
console.log('identity join verification passed (gates + happy path + returning + uniqueness + legacy)');
