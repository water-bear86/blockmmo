# Building the RUNECHAIN programs

## Prerequisites

- Rust + cargo (host)
- Solana CLI (`solana --version`) and the SBF platform-tools (`cargo-build-sbf`)
- Anchor (optional, via `avm`) — `cargo build-sbf` builds the programs without it

## Build

```bash
cd contracts
cargo build-sbf
```

Outputs go to `contracts/target/deploy/` (`.so` + IDL JSON).

### Verification status & toolchain

**Both programs build to deployable `.so` artifacts** with a current toolchain. Verified with
cargo 1.94, solana-cli 3.1 (Agave), anchor-cli 1.0, `cargo-build-sbf` 4.0: `cargo build-sbf`
produces `runechain_settlement.so` and `runechain_character.so` under `target/deploy/` (only
deprecation/unused warnings, no errors).

> **Older platform-tools note.** The Solana dependency tree pulls crates on **Rust edition
> 2024**, so the SBF build needs platform-tools whose bundled cargo is **≥ 1.85**. Releases with
> cargo `1.79`/`1.84` (older `--tools-version` defaults like `v1.43`/`v1.50`) fall short; pass a
> newer `--tools-version` if your installed default is older:
>
> ```bash
> cargo build-sbf --tools-version <release-with-cargo-1.85+>
> ```

(Go-live is legal-gated regardless — F6.3/F7 — so producing a deployable `.so` does not enable
real settlement or sales.)

## Program keypairs

Live in `contracts/keys/` (gitignored — deploy secrets). The pubkeys are wired into each
program's `declare_id!` and `Anchor.toml`. If you rotate them, update both (or `anchor keys sync`).

## Deploy — **gated**

Do **not** deploy to a production cluster until the **legal/compliance sign-off** (F6.3 / F7)
is complete. Both programs ship `paused = true`; even once deployed, settlement and sales stay
off until an admin calls `set_paused(false)` after sign-off.

```bash
# localnet / devnet only, for development:
solana program deploy target/deploy/runechain_settlement.so
solana program deploy target/deploy/runechain_character.so
```

## Tests

Two layers:

**Unit (pure-logic, no validator).** In-crate `#[cfg(test)]` modules cover the load-bearing
decision logic — the F5.4 split math (exact/lossless, ops absorbs the remainder, bps must sum to
10 000) and the F7.3 transfer-gate truth table + post-sale transition. Run anywhere:

```bash
cd contracts
cargo test
```

**Integration (instruction-level, in-process via litesvm).** `tests-integration/` loads the
compiled `.so` into an in-process SVM and exercises the real handlers, account constraints, and
CPIs — the happy paths and the gate reverts (settlement: starts paused, purchase reverts while
paused, atomic 50/35/15 split with a true burn; character: list reverts with tasks unfinished,
list reverts mid-season, sale releases escrow + flags seller restart, buy reverts while paused):

```bash
cd contracts/tests-integration
cargo test
```

The integration suite's runtime needs **native OpenSSL**, so it builds/runs on Linux (or any
host with OpenSSL) — it won't build on a bare Windows host that lacks OpenSSL. Run it after
`cargo build-sbf` has produced the `.so` (the suite `include_bytes!`s them from
`target/deploy/`). The crate is a detached workspace so its host-only test deps never enter the
`cargo build-sbf` on-chain build.

> No CI workflow is committed for these yet (the contributor token lacks the `workflow` scope).
> Until one is added, run the suite on a Linux host as above.
