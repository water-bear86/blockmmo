// Verify the wallet abstraction layer (issue #38 / PRD F6.4 / A3):
//   - a single adapter contract (connect/disconnect/getPublicKey/signTransaction)
//   - Phantom implemented as one concrete adapter over an injectable provider
//   - an adapter-agnostic manager so swapping wallets needs no game-logic change
//   - the sign-only seam: adapters sign a server-serialized tx, never build one
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const wallet = require(path.join(root, 'game', 'wallet.js'));
const { ADAPTER_METHODS, isAdapter, createPhantomAdapter, createMockAdapter, createWalletManager } = wallet;

(async () => {
  let pass = 0;
  const ok = (label) => { pass++; console.log('  ok  ' + label); };

  // 1. The contract is explicit and both concrete adapters satisfy it.
  assert.deepStrictEqual(ADAPTER_METHODS, ['connect', 'disconnect', 'getPublicKey', 'signTransaction']);
  assert(isAdapter(createMockAdapter()), 'mock adapter satisfies the contract');
  assert(isAdapter(createPhantomAdapter({ isPhantom: true })), 'phantom adapter satisfies the contract');
  assert(!isAdapter({ name: 'partial', connect() {} }), 'a partial object is not a valid adapter');
  ok('adapter contract is explicit and concrete adapters satisfy it');

  // 2. Mock adapter connect -> getPublicKey -> sign -> disconnect.
  const mock = createMockAdapter({ publicKey: 'PK_MOCK' });
  assert.strictEqual(mock.getPublicKey(), null, 'no key before connect');
  await assert.rejects(mock.signTransaction('tx'), /connect\(\) before signing/, 'cannot sign before connect');
  assert.strictEqual(await mock.connect(), 'PK_MOCK');
  assert.strictEqual(mock.getPublicKey(), 'PK_MOCK');
  const signed = await mock.signTransaction('SERVER_SERIALIZED_TX');
  assert.deepStrictEqual(signed, { signedBy: 'PK_MOCK', payload: 'SERVER_SERIALIZED_TX', mock: true });
  await mock.disconnect();
  assert.strictEqual(mock.getPublicKey(), null, 'key cleared on disconnect');
  ok('mock adapter: connect -> sign server-serialized tx -> disconnect');

  // 3. Phantom adapter wraps an injected provider (no real extension needed). It reads
  //    publicKey.toString() and delegates signing to the provider — it never builds the tx.
  const calls = [];
  const fakeProvider = {
    isPhantom: true,
    publicKey: { toString: () => 'PHANTOM_PK' },
    async connect() { calls.push('connect'); return { publicKey: { toString: () => 'PHANTOM_PK' } }; },
    async disconnect() { calls.push('disconnect'); },
    async signTransaction(tx) { calls.push('sign:' + tx); return 'SIGNED(' + tx + ')'; },
  };
  const phantom = createPhantomAdapter(fakeProvider);
  assert.strictEqual(phantom.available(), true, 'available reflects provider.isPhantom');
  assert.strictEqual(await phantom.connect(), 'PHANTOM_PK');
  assert.strictEqual(await phantom.signTransaction('TX1'), 'SIGNED(TX1)');
  assert.deepStrictEqual(calls, ['connect', 'sign:TX1'], 'adapter delegates straight to the provider');
  // No provider -> not available, and connect/sign fail loudly rather than constructing anything.
  const noPhantom = createPhantomAdapter(null);
  assert.strictEqual(noPhantom.available(), false);
  await assert.rejects(noPhantom.connect(), /not found/);
  ok('phantom adapter wraps an injectable provider and only signs');

  // 4. The manager is adapter-agnostic: the SAME call sites work across different adapters, so
  //    adding a wallet is a new adapter module with no game-logic change (A3 acceptance).
  const manager = createWalletManager({ adapters: [createMockAdapter({ name: 'mobile', publicKey: 'PK_MOBILE' }), phantom] });
  assert.deepStrictEqual(manager.list().sort(), ['mobile', 'phantom']);
  await assert.rejects(manager.signTransaction('tx'), /no wallet connected/);
  assert.strictEqual(await manager.connect('mobile'), 'PK_MOBILE');
  assert.strictEqual(manager.activeName(), 'mobile');
  const mobileSigned = await manager.signTransaction('TX2');
  assert.strictEqual(mobileSigned.signedBy, 'PK_MOBILE', 'manager routes signing to the active adapter');
  // swap to a totally different adapter via the same API — no other code changes.
  assert.strictEqual(await manager.connect('phantom'), 'PHANTOM_PK');
  assert.strictEqual(await manager.signTransaction('TX3'), 'SIGNED(TX3)');
  await assert.rejects(manager.connect('nope'), /unknown wallet adapter/);
  manager.register(createMockAdapter({ name: 'late-added' }));
  assert(manager.has('late-added'), 'new adapters register at runtime without touching the manager');
  ok('manager is adapter-agnostic: same call sites, swap adapters, register new ones freely');

  // 5. Registering a non-conforming adapter is rejected up front.
  assert.throws(() => createWalletManager({ adapters: [{ name: 'bad' }] }), /must implement/);
  ok('manager rejects adapters that break the contract');

  // 6. The client (index.html) actually WIRES the adapter into the buy-Gold flow (F6.4) —
  //    the abstraction is not just present, it is on the live path: the module is loaded, a
  //    manager is built from phantom + mock adapters, the purchase signs a server-built tx
  //    through the manager, and no raw wallet SDK call leaks into game code.
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert(/<script\s+src="game\/wallet\.js">/.test(html), 'index.html loads game/wallet.js');
  assert(/createWalletManager\s*\(/.test(html), 'client builds a wallet manager');
  assert(/createPhantomAdapter\s*\(/.test(html) && /createMockAdapter\s*\(/.test(html),
    'manager registers phantom + mock adapters (swap = new adapter, no game-logic change)');
  // The Buy-Gold handler must sign through the adapter/manager before crediting Gold.
  const buy = html.slice(html.indexOf("getElementById('wBuy')"));
  const buyHandler = buy.slice(0, buy.indexOf('function toggleWallet'));
  assert(/\.signTransaction\s*\(/.test(buyHandler), 'buy-Gold flow signs the tx through the adapter');
  assert(buyHandler.indexOf('signTransaction') < buyHandler.indexOf('buyGoldWithSol'),
    'Gold is credited only AFTER a signed settlement (S1.2 reconciliation)');
  assert(/builtBy\s*:\s*'server'/.test(html), 'settlement tx is server-built/serialized (U7), client only signs');
  // No raw wallet SDK call (window.solana.signTransaction) outside the adapter module.
  assert(!/window\.solana\.signTransaction/.test(html), 'no raw window.solana.* signing in game code (all via adapter)');
  ok('client wires the adapter into the live buy-Gold flow (no raw wallet SDK in game code)');

  console.log('\nwallet adapter verification passed (' + pass + ' checks).');
})().catch((err) => { console.error(err); process.exit(1); });
