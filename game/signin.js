/* RUNECHAIN client-side sign-in orchestration.
 *
 * Drives the browser half of the three-leg flow: SSO session check + "Sign in with Google" redirect,
 * Solana wallet connect + ownership-challenge signing, and assembling the wallet proof for the WS join.
 * The device (P-256) leg stays in game/account.js. This module talks ONLY to the wallet manager
 * abstraction (game/wallet.js) and fetch — never a wallet SDK directly (A1/A3). The pure helpers are
 * unit-testable headlessly; the browser glue (loadSession/connectWallet) is injected for tests too. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RUNECHAIN_SIGNIN = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function base64url(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    let bin = '';
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    const b64 = (typeof btoa === 'function') ? btoa(bin) : Buffer.from(u8).toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function parseSession(json) {
    json = json || {};
    return {
      signedIn: !!json.signedIn,
      ssoEnabled: !!json.ssoEnabled,
      requireIdentity: !!json.requireIdentity,
      requireWallet: !!json.requireWallet,
      sso: json.sso || null,
    };
  }

  async function loadSession(fetchImpl) {
    const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!f) return parseSession({});
    try {
      const res = await f('/auth/session', { credentials: 'same-origin' });
      if (!res.ok) return parseSession({});
      return parseSession(await res.json());
    } catch (_) {
      return parseSession({});
    }
  }

  // Redirect the browser into Google's consent screen, returning to the current page afterward.
  function beginGoogleSignIn(loc) {
    const l = loc || (typeof location !== 'undefined' ? location : null);
    if (!l) return;
    const next = encodeURIComponent((l.pathname || '/') + (l.search || ''));
    l.href = '/auth/google/start?next=' + next;
  }

  async function logout(fetchImpl) {
    const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!f) return false;
    try { await f('/auth/logout', { method: 'POST', credentials: 'same-origin' }); return true; } catch (_) { return false; }
  }

  // Connect the required Solana wallet and expose an address + a message signer. Talks only to the
  // wallet manager (game/wallet.js), so any registered adapter (Phantom, future mobile) works.
  async function connectWallet(manager, adapterName) {
    const name = adapterName || 'phantom';
    if (!manager || !manager.has || !manager.has(name)) throw new Error('No ' + name + ' wallet is available. Install Phantom or pick another wallet.');
    const address = await manager.connect(name);
    if (!address) throw new Error('Wallet did not return an address.');
    return { address: String(address), signMessage: (message) => manager.signMessage(message) };
  }

  // Assemble the wallet ownership proof for the join message from a signMessage() result.
  function buildWalletProof(challenge, signResult, chain) {
    if (!challenge || !challenge.nonce) throw new Error('wallet challenge missing nonce');
    if (!signResult || !signResult.publicKeyBytes || !signResult.signatureBytes) throw new Error('wallet signMessage result incomplete');
    return {
      chain: chain || 'solana',
      publicKey: base64url(signResult.publicKeyBytes),
      signature: base64url(signResult.signatureBytes),
      nonce: challenge.nonce,
    };
  }

  // Friendly, actionable copy for each server-side join rejection.
  const JOIN_ERRORS = {
    sso_required: 'Sign in with Google to enter the realm.',
    wallet_required: 'Connect your Solana wallet to enter the realm.',
    sso_in_use: 'This Google account is already linked to another device. Each account is limited to one device.',
    sso_conflict: 'This device is already linked to a different Google account.',
    wallet_in_use: 'That wallet is already linked to another account.',
    wallet_mismatch: 'This account is already linked to a different wallet.',
    invalid_wallet_signature: 'Your wallet signature could not be verified — please try connecting again.',
    invalid_wallet_challenge: 'The wallet challenge expired. Please try again.',
    wallet_address_mismatch: 'The connected wallet did not match the signed address. Please try again.',
  };
  function joinErrorMessage(code) {
    return JOIN_ERRORS[code] || ('Sign-in was rejected (' + (code || 'unknown') + ').');
  }

  // Does this account:challenge response require the wallet leg before we can join? The wallet is
  // gated by its OWN flag (requireWallet), independent of the SSO requirement (requireIdentity).
  function needsWalletLeg(authState, walletConnected) {
    return !!(authState && authState.requireWallet) || !!walletConnected;
  }

  return {
    base64url,
    parseSession,
    loadSession,
    beginGoogleSignIn,
    logout,
    connectWallet,
    buildWalletProof,
    joinErrorMessage,
    needsWalletLeg,
  };
});
