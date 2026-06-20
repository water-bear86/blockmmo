(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RUNECHAIN_CHAIN = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ZERO_HASH = '0'.repeat(64);
  const DEFAULT_DIFFICULTY = 3;
  const DEFAULT_FUTURE_SKEW_MS = 60000;

  function resolveSha256(sha256) {
    const fn = sha256 || (typeof RUNECHAIN_SHA256 !== 'undefined' ? RUNECHAIN_SHA256 : null);
    if (typeof fn !== 'function') throw new Error('Chainwell hashing requires a sha256 function');
    return fn;
  }

  function serializeBlockForHash(b) {
    // Optimization: Cache the prefix part of the block string (everything except the nonce)
    // to avoid expensive JSON.stringify calls during PoW mining loops.
    if (b._hashPrefix === undefined || b._lastIndex !== b.index || b._lastPrev !== b.prev || b._lastTime !== b.time || b._lastTxs !== b.txs) {
      b._hashPrefix = b.index + '|' + b.prev + '|' + b.time + '|' + JSON.stringify(b.txs) + '|';
      b._lastIndex = b.index;
      b._lastPrev = b.prev;
      b._lastTime = b.time;
      b._lastTxs = b.txs;
    }
    return b._hashPrefix + b.nonce;
  }

  function hashBlock(b, sha256) {
    return resolveSha256(sha256)(serializeBlockForHash(b));
  }

  function createGenesisBlock(sha256) {
    const g = { index: 0, prev: ZERO_HASH, time: 0, txs: [{ to: 'GENESIS', amt: 0, note: 'Chainwell spark' }], nonce: 0 };
    g.hash = hashBlock(g, sha256);
    return g;
  }

  function blockError(code, message) {
    return { ok: false, error: { code, message } };
  }

  function validHexHash(value) {
    return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
  }

  function readNowMs(now) {
    if (now == null) return null;
    return typeof now === 'function' ? now() : now;
  }

  function validateBlockShape(b) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return blockError('invalid_block_shape', 'Block must be an object.');
    if (!Number.isSafeInteger(b.index) || b.index < 0) return blockError('invalid_block_index', 'Block index must be a non-negative safe integer.');
    if (typeof b.prev !== 'string') return blockError('invalid_block_parent', 'Block parent hash must be a string.');
    if (!Number.isSafeInteger(b.time) || b.time < 0) return blockError('invalid_block_time', 'Block time must be a non-negative safe integer.');
    if (!Array.isArray(b.txs)) return blockError('invalid_block_transactions', 'Block transactions must be an array.');
    if (!Number.isSafeInteger(b.nonce) || b.nonce < 0) return blockError('invalid_block_nonce', 'Block nonce must be a non-negative safe integer.');
    if (!validHexHash(b.hash)) return blockError('invalid_block_hash', 'Block hash must be a 64-character lowercase hex string.');
    return { ok: true };
  }

  function validateGenesisBlock(block, options = {}) {
    const sha256 = resolveSha256(options.sha256);
    const shape = validateBlockShape(block);
    if (!shape.ok) return shape;
    if (block.index !== 0) return blockError('invalid_block_index', 'Genesis block must have index 0.');
    if (block.prev !== ZERO_HASH) return blockError('invalid_block_parent', 'Genesis block must point to the zero hash.');
    const nowMs = readNowMs(options.now);
    const futureSkewMs = options.futureSkewMs == null ? DEFAULT_FUTURE_SKEW_MS : options.futureSkewMs;
    if (nowMs != null && block.time > nowMs + futureSkewMs) return blockError('invalid_block_time', 'Genesis block time is too far in the future.');
    if (block.hash !== hashBlock(block, sha256)) return blockError('invalid_block_hash', 'Genesis block hash does not match its contents.');
    return { ok: true, block };
  }

  function validateBlockCandidate(block, tip, options = {}) {
    const sha256 = resolveSha256(options.sha256);
    const difficulty = options.difficulty == null ? DEFAULT_DIFFICULTY : options.difficulty;
    const shape = validateBlockShape(block);
    if (!shape.ok) return shape;
    if (!tip || typeof tip !== 'object') return blockError('invalid_block_parent', 'A parent tip is required.');
    if (block.index !== tip.index + 1) return blockError('invalid_block_index', 'Block index must extend the current tip by one.');
    if (block.prev !== tip.hash) return blockError('invalid_block_parent', 'Block parent hash must match the current tip.');
    if (!Number.isSafeInteger(tip.time) || block.time < tip.time) return blockError('invalid_block_time', 'Block time must not be earlier than its parent.');
    const nowMs = readNowMs(options.now);
    const futureSkewMs = options.futureSkewMs == null ? DEFAULT_FUTURE_SKEW_MS : options.futureSkewMs;
    if (nowMs != null && block.time > nowMs + futureSkewMs) return blockError('invalid_block_time', 'Block time is too far in the future.');
    if (block.hash !== hashBlock(block, sha256)) return blockError('invalid_block_hash', 'Block hash does not match its contents.');
    if (!block.hash.startsWith('0'.repeat(difficulty))) return blockError('invalid_block_difficulty', 'Block hash does not satisfy Chainwell difficulty.');
    return { ok: true, block };
  }

  function validateChain(candidate, options = {}) {
    if (!Array.isArray(candidate)) return blockError('invalid_chain_shape', 'Chain must be an array.');
    if (!candidate.length) return blockError('invalid_chain_empty', 'Chain must contain a genesis block.');
    const genesis = validateGenesisBlock(candidate[0], options);
    if (!genesis.ok) return genesis;
    for (let i = 1; i < candidate.length; i++) {
      const result = validateBlockCandidate(candidate[i], candidate[i - 1], options);
      if (!result.ok) return result;
    }
    return { ok: true, chain: candidate };
  }

  function cloneChain(candidate) {
    return candidate.map((b) => ({ ...b, txs: (b.txs || []).map((t) => ({ ...t })) }));
  }

  function createChain(options = {}) {
    const sha256 = options.sha256 || (typeof RUNECHAIN_SHA256 !== 'undefined' ? RUNECHAIN_SHA256 : null);
    if (typeof sha256 !== 'function') throw new Error('createChain requires a sha256 function');

    const DIFFICULTY = options.difficulty == null ? DEFAULT_DIFFICULTY : options.difficulty;
    let chain = [], mempool = [], miner = null, hashes = 0, hrTimer = 0, hashrate = 0;
    const rid = () => Math.random().toString(36).slice(2, 8);
    const onBlockMined = typeof options.onBlockMined === 'function' ? options.onBlockMined : null;

    function valid(b) {
      return validateBlockCandidate(b, chain[chain.length - 1], { sha256, difficulty: DIFFICULTY }).ok;
    }

    function genesis() {
      chain = [createGenesisBlock(sha256)];
    }

    genesis();

    function credit(to, amt, note, cur) {
      mempool.push({ to, amt: +(+amt).toFixed(4), note, cur: cur || 'RUNE', id: rid() });
    }

    function debit(from, amt, note, cur, to) {
      mempool.push({ from, to: to || 'POWER_SINK', amt: +(+amt).toFixed(4), note, cur: cur || 'RUNE', id: rid() });
    }

    function reward(to, amt, note) { credit(to, amt, note, 'RUNE'); }
    function spend(from, amt, note) { debit(from, amt, note, 'RUNE', 'POWER_SINK'); }
    function mintGreatRune(to, rune) { mempool.push({ to, amt: 0, greatRune: rune, note: 'Boss Sigil: ' + rune.name, cur: 'RUNE', id: rid() }); }
    function mintCosmetic(to, id) { mempool.push({ to, amt: 0, cosmetic: id, note: 'skin ' + id, cur: 'GOLD', id: rid() }); }
    function mintItem(to, id) { mempool.push({ to, amt: 0, item: id, note: 'relic ' + id, cur: 'RUNE', id: rid() }); }

    function startBlock() {
      if (miner || !mempool.length) return;
      const prev = chain[chain.length - 1];
      miner = { index: prev.index + 1, prev: prev.hash, time: Date.now(), txs: mempool.slice(0, 6), nonce: 0 };
    }

    function tick(budget) {
      if (!miner) startBlock();
      if (!miner) return null;
      for (let i = 0; i < budget; i++) {
        const h = hashBlock(miner, sha256);
        hashes++;
        if (h.startsWith('0'.repeat(DIFFICULTY))) {
          miner.hash = h;
          chain.push(miner);
          const landed = miner;
          mempool = mempool.slice(landed.txs.length);
          miner = null;
          if (onBlockMined) onBlockMined(landed);
          return landed;
        }
        miner.nonce++;
      }
      return null;
    }

    function updateHashrate(dt) {
      hrTimer += dt;
      if (hrTimer >= 0.5) {
        hashrate = Math.round(hashes / hrTimer);
        hashes = 0;
        hrTimer = 0;
      }
    }

    function acceptRemote(b) {
      const tip = chain[chain.length - 1];
      if (b && b.index === tip.index + 1 && b.prev === tip.hash && valid(b)) {
        chain.push(b);
        const ids = new Set((b.txs || []).map(t => t.id));
        mempool = mempool.filter(t => !ids.has(t.id));
        if (miner && miner.index <= b.index) miner = null;
        return true;
      }
      return false;
    }

    function pool() { return miner ? mempool.concat(miner.txs) : mempool; }

    function balanceOf(name, cur = 'RUNE') {
      let bal = 0;
      for (const b of chain) for (const t of b.txs || []) {
        if ((t.cur || 'RUNE') !== cur) continue;
        if (t.to === name) bal += t.amt || 0;
        if (t.from === name) bal -= t.amt || 0;
      }
      return bal;
    }

    function pendingCredit(name, cur = 'RUNE') {
      let p = 0;
      for (const t of pool()) if ((t.cur || 'RUNE') === cur && t.to === name) p += t.amt || 0;
      return p;
    }

    function pendingDebit(name, cur = 'RUNE') {
      let p = 0;
      for (const t of pool()) if ((t.cur || 'RUNE') === cur && t.from === name) p += t.amt || 0;
      return p;
    }

    function spendable(name, cur = 'RUNE') { return balanceOf(name, cur) - pendingDebit(name, cur); }

    function tallyTo(addr, cur = 'RUNE') {
      let v = 0;
      for (const b of chain) for (const t of b.txs || []) if (t.to === addr && (t.cur || 'RUNE') === cur) v += t.amt || 0;
      for (const t of pool()) if (t.to === addr && (t.cur || 'RUNE') === cur) v += t.amt || 0;
      return v;
    }

    function greatRunesOf(name) {
      const out = [];
      for (const b of chain) for (const t of b.txs || []) if (t.to === name && t.greatRune) out.push(t.greatRune);
      for (const t of pool()) if (t.to === name && t.greatRune) out.push(t.greatRune);
      return out;
    }

    function cosmeticsOf(name) {
      const out = [];
      for (const b of chain) for (const t of b.txs || []) if (t.to === name && t.cosmetic) out.push(t.cosmetic);
      for (const t of pool()) if (t.to === name && t.cosmetic) out.push(t.cosmetic);
      return out;
    }

    function itemsOf(name) {
      const out = [];
      for (const b of chain) for (const t of b.txs || []) if (t.to === name && t.item) out.push(t.item);
      for (const t of pool()) if (t.to === name && t.item) out.push(t.item);
      return out;
    }

    function replaceFromAuthority(remote) {
      if (!validateChain(remote, { sha256, difficulty: DIFFICULTY }).ok) return false;
      const nextChain = cloneChain(remote);
      const confirmedIds = new Set();
      const authorityHashes = new Set(nextChain.map(b => b.hash));
      for (const b of nextChain) for (const t of b.txs || []) if (t.id) confirmedIds.add(t.id);

      const nextMempool = mempool.filter(t => !t.id || !confirmedIds.has(t.id));
      const pendingIds = new Set(nextMempool.map(t => t.id).filter(Boolean));
      for (const b of chain) {
        if (authorityHashes.has(b.hash)) continue;
        for (const t of b.txs || []) {
          if (!t.id || confirmedIds.has(t.id) || pendingIds.has(t.id)) continue;
          nextMempool.push({ ...t });
          pendingIds.add(t.id);
        }
      }

      chain = nextChain;
      mempool = nextMempool;
      const tip = chain[chain.length - 1];
      if (miner && (miner.index <= tip.index || miner.prev !== tip.hash)) miner = null;
      return true;
    }

    return {
      DIFFICULTY, reward, spend, credit, debit, mintGreatRune, mintCosmetic, mintItem, tick, updateHashrate, acceptRemote,
      balanceOf, pendingCredit, pendingDebit, spendable, tallyTo, greatRunesOf, cosmeticsOf, itemsOf,
      get chain() { return chain; },
      get mining() { return miner; },
      get hashrate() { return hashrate; },
      replaceFromAuthority,
      replaceIfLonger(remote) {
        return Array.isArray(remote) && remote.length > chain.length ? replaceFromAuthority(remote) : false;
      }
    };
  }

  return {
    ZERO_HASH,
    DEFAULT_DIFFICULTY,
    DEFAULT_FUTURE_SKEW_MS,
    createChain,
    createGenesisBlock,
    serializeBlockForHash,
    hashBlock,
    validateBlockCandidate,
    validateChain,
  };
});
