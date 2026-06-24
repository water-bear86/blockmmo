/* Tests for the client sign-in layer: game/signin.js pure helpers (headless) + structural assertions
 * that index.html wires the three-leg flow. The full browser+Phantom path can only be smoke-tested in
 * a real browser; this locks the logic and the wiring. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const Signin = require(path.join(root, 'game', 'signin.js'));

let passed = 0;
function ok(label) { passed++; if (process.env.VERBOSE) console.log('  ok -', label); }

(async () => {
  // ---- base64url --------------------------------------------------------------------------------
  assert.strictEqual(Signin.base64url(new Uint8Array([1, 2, 3])), 'AQID');
  assert.strictEqual(Signin.base64url([255, 255, 255]), '____');
  assert.strictEqual(Signin.base64url(new Uint8Array(0)), '');
  ok('base64url encodes bytes url-safe');

  // ---- parseSession defaults --------------------------------------------------------------------
  assert.deepStrictEqual(Signin.parseSession({}), { signedIn: false, ssoEnabled: false, requireIdentity: false, requireWallet: false, sso: null });
  assert.deepStrictEqual(
    Signin.parseSession({ signedIn: true, ssoEnabled: true, requireIdentity: true, requireWallet: true, sso: { email: 'a@b' } }),
    { signedIn: true, ssoEnabled: true, requireIdentity: true, requireWallet: true, sso: { email: 'a@b' } }
  );
  ok('parseSession normalizes flags');

  // ---- needsWalletLeg (gated by requireWallet, independent of requireIdentity) -------------------
  assert.strictEqual(Signin.needsWalletLeg({ requireWallet: true }, false), true, 'wallet required -> needs wallet');
  assert.strictEqual(Signin.needsWalletLeg({ requireWallet: false }, true), true, 'already connected -> include wallet');
  assert.strictEqual(Signin.needsWalletLeg({ requireWallet: false }, false), false, 'wallet optional -> skip wallet');
  assert.strictEqual(Signin.needsWalletLeg({ requireIdentity: true, requireWallet: false }, false), false, 'Google-only -> skip wallet');
  ok('needsWalletLeg gates the wallet round-trip');

  // ---- loadSession via mock fetch ---------------------------------------------------------------
  const goodFetch = async () => ({ ok: true, json: async () => ({ signedIn: true, ssoEnabled: true, requireIdentity: true, requireWallet: false, sso: { email: 'p@x' } }) });
  assert.deepStrictEqual(await Signin.loadSession(goodFetch), { signedIn: true, ssoEnabled: true, requireIdentity: true, requireWallet: false, sso: { email: 'p@x' } });
  const badFetch = async () => { throw new Error('offline'); };
  assert.strictEqual((await Signin.loadSession(badFetch)).signedIn, false, 'fetch failure degrades to signed-out');
  ok('loadSession reads /auth/session + fails soft');

  // ---- beginGoogleSignIn redirect ---------------------------------------------------------------
  const loc = { pathname: '/play', search: '?a=1', href: '' };
  Signin.beginGoogleSignIn(loc);
  assert.strictEqual(loc.href, '/auth/google/start?next=' + encodeURIComponent('/play?a=1'));
  ok('beginGoogleSignIn redirects with sanitized next');

  // ---- connectWallet via mock manager -----------------------------------------------------------
  const manager = {
    has: (n) => n === 'phantom',
    connect: async () => 'Wa11etAddr',
    signMessage: async () => ({ publicKeyBytes: new Uint8Array(32), signatureBytes: new Uint8Array(64) }),
  };
  const wallet = await Signin.connectWallet(manager);
  assert.strictEqual(wallet.address, 'Wa11etAddr');
  await assert.rejects(() => Signin.connectWallet({ has: () => false }), /No phantom wallet/);
  ok('connectWallet binds the active adapter address + signer');

  // ---- buildWalletProof -------------------------------------------------------------------------
  const signRes = await wallet.signMessage('challenge');
  const proof = Signin.buildWalletProof({ nonce: 'wnonce_1' }, signRes);
  assert.strictEqual(proof.chain, 'solana');
  assert.strictEqual(proof.nonce, 'wnonce_1');
  assert.strictEqual(typeof proof.publicKey, 'string');
  assert.strictEqual(typeof proof.signature, 'string');
  assert.throws(() => Signin.buildWalletProof({}, signRes), /nonce/);
  ok('buildWalletProof assembles the join wallet payload');

  // ---- joinErrorMessage -------------------------------------------------------------------------
  assert.match(Signin.joinErrorMessage('sso_in_use'), /one device/i);
  assert.match(Signin.joinErrorMessage('wallet_required'), /wallet/i);
  assert.match(Signin.joinErrorMessage('weird_unknown'), /weird_unknown/);
  ok('joinErrorMessage maps codes to friendly copy');

  // ---- index.html structural wiring -------------------------------------------------------------
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert(index.includes('src="game/wallet.js"'), 'wallet.js script included');
  assert(index.includes('src="game/signin.js"'), 'signin.js script included');
  assert(index.includes('id="signin"') && index.includes('id="google-signin"') && index.includes('id="wallet-connect"'), 'sign-in panel present');
  assert(index.includes("m.t==='wallet:challenge'"), 'client handles wallet:challenge');
  assert(index.includes('Signin.needsWalletLeg'), 'join branches on the wallet leg');
  assert(index.includes('Signin.buildWalletProof'), 'join attaches the wallet proof');
  assert(index.includes('RUNECHAIN_WALLET') && index.includes('createPhantomAdapter'), 'wallet manager instantiated');
  assert(index.includes('bootSignin') && index.includes('loadSession'), 'session loaded at boot');
  ok('index.html wires the three-leg sign-in flow');

  console.log(`sign-in client verification passed (${passed} groups)`);
})().catch((err) => { console.error(err); process.exit(1); });
