# RUNECHAIN on-chain programs

The Solana edge of the economy (PRD F6/F7), reconciled with `DESIGN-BIBLE.md` rulings
7–10 (C1–C4). Two Anchor programs:

| Program | PRD | Purpose |
|---|---|---|
| `runechain-settlement` | F6 | Atomic real-money settlement: split a payment **50% burn · 35% marketing · 15% ops** and emit a receipt the Chainwell credits Gold against. |
| `runechain-character` | F7 | Season-gated, conditionally-transferable character with the **one cash-out** (sell a season-complete character). |

> **Why Rust/Anchor here (A2).** The client stays buildless (`index.html` + `engine/*.js`).
> On-chain programs cannot be buildless — there is no JS path for an atomic 3-way split or a
> program-gated NFT transfer — so per architecture rule A2 this lives in a dependency-flexible
> Anchor/Rust workspace, isolated under `contracts/`. The web client is untouched.

> **Go-live is legal-gated (F6.3 / F7).** Both programs ship **paused** (`Config.paused = true`).
> Enabling real settlement and real sales in production is a hard legal/compliance precondition,
> flipped by the admin via `set_paused` — designed and built now, switched on later. **Not deployed.**

## How it sits next to the off-chain ledger (S1.2 seam)

The in-game **Chainwell** (the SHA-256 PoW ledger in `server.js`) stays the **permanent ledger
of record** for RUNE, Gold, levels, items, and season state. Solana lives **only** at two seams:

- **Solana → Chainwell** — a `purchase_gold` settles real money; the `GoldPurchased` event is
  reconciled by the authoritative server, which credits **Gold** (a cosmetic currency, ruling 7).
  Gold is **never minted on-chain**.
- **Chainwell ↔ Solana** — the character NFT + its lifecycle state are on-chain; on a sale the
  `CharacterSold` event tells the server to **carry the collection (items + cosmetics) to the
  buyer, reset stats to zero, and flag the seller to restart** (ruling 8). Power is never inherited.

## `runechain-settlement` (F6)

- `init_config(marketing, ops)` — admin creates the singleton config; starts **paused**. Verifies the split sums to 10000 bps.
- `set_paused(paused)` — the legal go-live toggle (F6.3).
- `purchase_gold(amount)` — **atomic** (F6.1): `burn_checked` 50% (true SPL burn, F6.2), transfer 35% → marketing, 15% → ops, in one instruction; dust from integer division is absorbed by the ops leg. Emits `GoldPurchased`. Reverts if paused.

"Marketing" is a single operator-discretion bucket (F5.4) — **not** a committed prize pool.
Consistent with **C1**: settlement buys **Gold, a cosmetic currency** — it never buys power.
Per **Q-F6a**, this is a custom Anchor program, not a client-built multi-instruction
transaction, so the server can construct/validate one authoritative settlement payload and
the program can enforce the atomic split in one instruction. Per **Q-F6b**, the settlement
asset is the SPL Token Program native wSOL mint
`So11111111111111111111111111111111111111112`; deployment and server integration must pin
or validate that mint rather than treating the settlement asset as an arbitrary deploy-time
pick.

## `runechain-character` (F7)

Escrow-gate mechanism (the transfer-hook alternative; Q-F7b still open). The NFT sits in a
program escrow while listed and is released only on a valid sale.

- `init_config(oracle)` — admin; `oracle` is the authoritative server key (U7) allowed to mark completion. Starts **paused**.
- `set_paused(paused)` · `set_season(season_id, open)` — admin season-window control (F7.1).
- `register_character(season_id)` — a player records their character NFT into lifecycle state.
- `mark_complete()` — **oracle-only**; marks the mandatory tasks done while the window is open (F7.1).
- `list_for_sale(price)` — reverts unless **season-complete** (tasks done **and** window closed) — F7.3 rules 1 & 2; moves the NFT to escrow.
- `buy()` — pays the seller, releases the escrowed NFT to the buyer, flags the seller to restart at zero (F7.3 rule 3), moves ownership; the server then carries the collection and resets stats.
- `cancel_listing()` — seller reclaims an unsold NFT.

## Program IDs

- settlement: `A7A2G4qnQaKBZiCqUPtuNbeDrvdPGK4gE9wip61dXPpN`
- character:  `FAidaRiKduPztNQmKK1C1T4ikmmqAXpiWwMzXbnJhNN3`

Keypairs live in `contracts/keys/` (gitignored — they are deploy secrets). Regenerate +
`declare_id!`/`Anchor.toml` if you rotate them.

## Closed decisions (tracked in PRD)

- **Q-F6a** — settlement is a custom Anchor program, not a client-built multi-instruction tx.
- **Q-F6b** — settlement uses the SPL Token Program native wSOL mint `So11111111111111111111111111111111111111112`.

## Open questions (tracked in PRD)

- **Q-F7a** — status of a character whose window closed with tasks unfinished (locked / penalty / auto-reset). The gate currently just keeps it unsellable; needs an explicit rule.
- **Q-F7b** — transfer-hook vs escrow gating. **Escrow** is implemented; transfer-hook is the alternative.
- **Ruling 8 (open)** — whether power-granting RUNE relics / Boss Sigils transfer with the collection or reset with stats. Decides whether a sale can convey any power.

## Build / deploy

See [`BUILD.md`](BUILD.md). Status: **code complete; not deployed (legal-gated).**
