# RUNECHAIN — Product Requirements (Living)

> **Status: LIVING DOCUMENT.** No dates, no phases, no timeline. Sections evolve
> as decisions are made. Every claim is tagged with its confidence:
>
> - **[DECIDED]** — settled in conversation; treat as intent.
> - **[OPEN]** — a real unresolved question; needs a decision before build.
> - **[TENSION]** — conflicts with the ratified canon; see the Conflict Register.
> - **[NUMBER]** — design intent is decided, the value is a balance-tuning placeholder.
>
> **Authority note.** [`DESIGN-BIBLE.md`](DESIGN-BIBLE.md) remains the **ratified
> source of truth**. This PRD is a **proposed economy/gameplay revision** layered on
> top of it. Where the two disagree (power, cash-out, combat stakes), the bible stays
> canon until explicitly reconciled — every such point is logged in the
> [Conflict Register](#conflict-register-prd-vs-ratified-design-bible) and marked
> **[TENSION]** inline. Do not treat **[TENSION]** items as canon.

---

## How to read this document

The structure is **player-facing**: it leads with what a player does and experiences,
and folds the systems (ledger, netcode, settlement, server authority) underneath the
features they serve. Cross-cutting rules that span every feature live in
[Universal Rules](#universal-rules). All unresolved items are consolidated in the
[Open Questions Register](#open-questions-register) and all canon conflicts in the
[Conflict Register](#conflict-register-prd-vs-ratified-design-bible) so nothing scatters.

---

## Product vision

RUNECHAIN is a browser-native pixel cozy-gothic Soulslike with a real on-chain economy,
set in the ruined parish of Gracefall. A player is **Recorded** into the **Chainwell**
(the in-game ledger) and progresses by grinding, not by paying. The hook is two-fold:
a single game that **switches between play-styles** — a shared MMO town, real-time
top-down battle arenas, single-player 2D platforming, and turn-based RPG duels — and an
economy where **real money can speed and beautify the journey but never buys an
exclusive outcome**, with exactly one way for value to ever leave the system: selling a
character you actually finished.

---

## Universal Rules

These hold across every feature below. They exist once, here, so they cannot drift.

- **U1 — No exclusive paid advantage. [DECIDED]** Anything real money can obtain is
  also reachable by grinding. Money never unlocks power, items, or outcomes a
  non-payer cannot eventually reach.
- **U2 — Money never skips the grind. [DECIDED]** Season completion is gated on
  performing the mandatory grind tasks. No purchase bypasses that gate; miss the tasks
  and the season is not complete regardless of spend.
- **U3 — Paid acceleration is hard-capped. [DECIDED][NUMBER]** Real money can speed the
  grind up to a ceiling; past the ceiling payer and non-payer are identical. The cap is
  the *whole* story on paid advantage — there is no second, uncapped paid lever (see
  F4/Death recovery, which is deliberately RUNE-only to preserve this).
- **U4 — Paid quality-of-life resets every season, for everyone. [DECIDED]** Real-money
  QOL boosts are seasonal and non-durable. They evaporate at each season boundary for
  every role (owner, buyer, seller). They are therefore never tradeable and never carry
  across a sale.
- **U5 — One real-value exit only. [DECIDED]** The single way value leaves the system to
  a player is **selling a completed character**. RUNE, Gold, relics, and sigils never
  individually cash out.
- **U6 — One character per account per season. [DECIDED]** A hard cap of one. For the
  prototype, "account" binds to a browser-local P-256 game-account credential verified
  by a server challenge. This is a low-friction pseudonymous cap, not proof of one human.
  Stronger sybil resistance and production compliance remain gated by legal/compliance
  work before any real-money character-sale market.
- **U7 — Server is authoritative for all value. [DECIDED]** Clients propose; the server
  disposes. The "trust the client" relay posture is retired for anything touching the
  ledger or PvP outcomes (see [Server Authority](#system--server-authority--anti-cheat)).
- **U8 — Two ledgers, narrow seam. [DECIDED]** The in-game **Chainwell** (custom SHA-256
  PoW chain) is the permanent ledger of record for the gameplay economy. **Solana** lives
  only at the real-money edge (purchase settlement) and the character-sale boundary. The
  crossing points are few and are treated as first-class, reconciled interfaces.

---

## Player-facing features

### F1 — Living in Gracefall (the MMO town)

**What the player does.** Spawns into a shared, persistent top-down world. Other Recorded
are visible and move in real time. The town (Hearthlight Chapel and the parish around it)
is where players rest, level, forge, shop cosmetics, and stage into the other play-styles.

**Current state.** Implemented. `index.html` hosts the top-down renderer, story gates,
combat, relics, and wardrobe; `server.js` relays player transforms and gossips ledger
blocks so the realm converges on one world. Hearthlight rest is free and safe.

**Target state.** Unchanged in spirit. The town is the hub the play-style switcher
(F5) launches from. The safe-rest invariant is preserved (canon Ruling 1).

**Open/risk.** None specific beyond the cross-cutting server-authority migration (U7).

---

### F2 — The four play-styles

The defining feature: one game, four modes, all sharing one player record and one economy.

| Mode | World | Networking | Status in repo |
|---|---|---|---|
| MMO town (top-down hub) | Shared | Relay (non-authoritative movement) | Built (host) |
| Real-time battle arena (PvNPC + PvP **initiation**) | Shared | Relay + server-arbitrated outcomes | Built (`battlefield.js`) |
| 2D platformer (run/jump/avoid) | **Solo** | None (single-player) | Built (`platformer.js`) |
| Turn-based RPG battle (PvP resolution + boss RPG phases) | Solo (2 combatants) | Server-arbitrated turns | **Not built** |

- **F2.1 — Real-time vs. solo split. [DECIDED]** Shared-world modes (town, arena) broadcast
  transforms; solo modes (platformer, turn-based battle) do not touch the movement relay.
- **F2.2 — Platformer is single-player only. [DECIDED]** Just the player and the level. No
  transform sync, no inter-player collision, no ghost presence.
- **F2.3 — Combat is two systems, real-time is the entry point. [DECIDED]** Monsters
  (PvNPC) are fought in **real time** in the arena. **Players** are fought **turn-based**:
  the real-time layer *initiates* a PvP encounter (reusing the existing
  `rc:pvp:challenge`/`accept` handshake), and on accept both players transition into a
  separate **turn-based RPG battle mode**.
- **F2.4 — The turn-based battle mode is new. [DECIDED]** A third engine mode implementing
  the same `enter/exit/update/render` interface as the others, so it slots into the existing
  mode manager and can also serve as a boss segment (see F3).

**Remaining open questions.**
- **Q-F2a [OPEN]** What carries from the real-time engagement into the turn-based battle —
  just the two combatants, or also positioning/initiative/HP-state at the moment of
  engagement (an ambush advantage)?
- **Q-F2b [OPEN]** While a player is in a solo segment, what do others in the shared world
  see of them — vanish, "in an encounter" marker, or frozen avatar?

---

### F3 — Boss encounters that combine play-styles

**What the player does.** A boss encounter chains multiple play-styles in sequence: e.g.
a platformer run to reach the arena, a real-time battlefield wave, then a turn-based RPG
phase against the boss — interleaved as the encounter demands.

- **F3.1 — Designer-scripted per boss. [DECIDED]** A boss is **not** a fixed
  platformer→arena→RPG pipeline. Each boss is a data-driven **script**: an ordered list of
  **segments**, each naming a mode + a level payload + a completion condition. Segments may
  repeat and interleave freely ("any mix thereof").
- **F3.2 — A segment-sequencer drives the script. [DECIDED]** A new component sits *above*
  the existing mode manager. When a segment signals completion, the sequencer advances and
  tells the mode manager to swap. This **extends** the existing architecture (the mode
  manager, the engines' seam events) rather than replacing it.
- **F3.3 — Transitions are a brief beat, not seamless. [DECIDED]** Between segments the
  player sees a short wipe/cut (diegetic: "the gate slams shut"). The beat hides the engine
  teardown/setup and the carry-over handoff. No real-time reconciliation of two engines'
  cameras/coordinates is required.
- **F3.4 — Segment payloads reuse existing level formats. [DECIDED]** The platformer-level
  JSON and battlefield-level JSON already defined in `engine/api.md` become per-segment
  payloads. No parallel formats are invented.

**Reconciliation note.** The bible already describes combined final bosses narratively
(Mother Tallow, The Ledger-Bound, The Auditor). F3 is the *engine mechanism* to deliver
them and is consistent with the bible's intent.

**Open.**
- **Q-F3a [OPEN]** What defines a segment's "completion" — reuse existing events (`onExit`
  for platformer, `onZoneCleared`/boss-HP for battlefield), or an explicit per-segment
  declared condition? (Leaning toward reusing events for consistency.)
- **Q-F3b [OPEN]** Exact carry-over payload across the transition beat — which player state
  (HP, stamina, combatants, earned state) persists between segments.

---

### F4 — Death, loss, and recovery

**What the player does.** On losing a fight, drops a portion of their items/currency, and
can recover the dropped portion by grinding the cost back.

- **F4.1 — Partial loss on death. [DECIDED][NUMBER]** Death drops *some* of the player's
  items/currency, not all. The retained-vs-dropped fraction is a balance placeholder.
- **F4.2 — Recovery is RUNE-only. [DECIDED]** The dropped portion is recovered by paying
  **RUNE** (the grind currency). This makes recovery a pure **grind sink** — the
  sustainability lever the economy needs — and deliberately keeps **Gold out of the
  combat-consequence path**, preserving U1/U3. *(This resolved an earlier tension: Gold was
  briefly considered for recovery; it was closed off precisely because an uncapped
  Gold-funded recovery would route around the U3 cap.)*

**[TENSION] vs. canon.** The bible rules PvP/endgame stakes as **cosmetic only, no power
transfer, no farmable power**. Real item/currency loss on death is power-bearing and is a
proposed revision. See Conflict Register C3.

**Open.**
- **Q-F4a [OPEN][NUMBER]** What fraction of items/currency is lost vs. retained on death?
- **Q-F4b [OPEN]** Does loss-on-death apply equally to PvNPC and turn-based PvP, or differ?

---

### F5 — The economy: earning, spending, and paying

Two currencies, and the line between them is the design.

- **RUNE** — grind/power currency. Browser-mined via SHA-256 PoW, recorded on the
  Chainwell. In connected realms, reward credits are server-issued work that the browser
  mines and the server re-verifies before append; local solo mode keeps prototype local
  mining. Powers leveling and relics. **Never for sale.** Also the death-recovery sink (F4).
- **Gold** — the real-money-adjacent currency. Funds cosmetics **and** the capped grind
  acceleration (U3). Two one-way on-ramps fill it; there is no Gold cash-out.

- **F5.1 — Paid quality-of-life, capped. [DECIDED][NUMBER]** Real money buys "quality of
  stuff": cosmetics, plus grind acceleration up to the U3 cap. It never buys an exclusive
  advantage (U1) and never skips the mandatory grind (U2). The cap's unit (max % boost, or
  capped count of boosted actions per day/season) is a balance placeholder.
- **F5.2 — Paid QOL is seasonal. [DECIDED]** Per U4, all purchased QOL resets at each
  season boundary, for every role.
- **F5.3 — On-ramps. [DECIDED]** (a) Convert confirmed RUNE → Gold at a flat rate;
  (b) buy Gold with wrapped SOL, which triggers the settlement split (F6).
- **F5.4 — The split is 50 / 35 / 15. [DECIDED]** Each wSOL purchase routes **50% burn ·
  35% marketing · 15% ops fee**, three destinations, atomic. "Marketing" is a single
  operator-discretion bucket (covers paying artists for skins, promotion, etc.) — **not** a
  committed player-facing prize pool. The 15% ops fee is a single wallet, one recipient.

**[TENSION] vs. canon.** The bible's inviolable rule is "**Gold buys cosmetics only, never
power**." F5.1's capped grind acceleration is Gold touching progression *speed*, which the
bible's framing forbids. This is the single largest proposed revision. See Conflict
Register C1.

**Code discrepancy (low-risk relabel). [DECIDED]** The repo's `ECON` table names the 35%
destination `PRIZE_POOL` / "prize pool." Design intent is **marketing**. This is a
naming change, not a behavior change — log and relabel.

**Open.**
- **Q-F5a [OPEN][NUMBER]** The U3 cap's exact unit and value.
- **Q-F5b [OPEN][NUMBER]** RUNE→Gold conversion rate and wSOL→Gold rate.
- **Q-F5c [OPEN][NUMBER]** At each season reset (U4), do paid QOL stats reset to **zero**
  (re-buy each season) or to a **baseline floor**?

---

### F6 — Real-money settlement (on Solana)

**In scope. [DECIDED]** The PRD specifies the settlement design now (it is not deferred).

**What it is.** Replace the devnet-mock `Econ.buyGoldWithSol()` with real settlement: a
wrapped-SOL payment that **atomically** routes the 50/35/15 split (F5.4) and credits Gold
to the player on the Chainwell.

- **F6.1 — Atomicity. [DECIDED]** The split is all-or-nothing in a single transaction. A
  partial split (burn succeeds, fee fails) must be impossible.
- **F6.2 — Burn is a true burn. [DECIDED]** Use the SPL `Burn` instruction
  (`createBurnCheckedInstruction`), which reduces supply, **not** the incinerator address
  (which leaves supply unchanged). Applies to whichever mint is settled in.
- **F6.3 — Go-live precondition. [DECIDED]** Activating real settlement in production
  carries a documented **legal/compliance sign-off** gate. This is *not* a phase or date —
  it is a hard precondition, because the system has a real cash-out (F7) and real money in.
  Designing it now is in scope; flipping it live is gated. *(Recorded as a dependency, not
  a refusal — the design proceeds fully.)*
- **F6.4 — Wallet abstraction. [DECIDED]** Per the platform stance (U: browser-now,
  don't-preclude-mobile), the wallet integration treats a browser-extension wallet
  (e.g. Phantom) as **one adapter**, not the only path, so a future mobile-wallet
  connection is not designed out.

**Open.**
- **Q-F6a [OPEN]** Settlement as a custom **Anchor program** (clean atomic 3-way routing in
  one instruction) vs. a **client-built multi-instruction transaction** using the standard
  SPL token program. The burn alone is doable client-side and trustlessly; atomic 3-way
  routing argues for a program. Server-authority (U7) also argues for server-constructed/
  validated transactions.
- **Q-F6b [OPEN]** Which wrapped-SOL mint is settled in.

---

### F7 — Characters, seasons, and the one cash-out

The most load-bearing feature: the only way value ever leaves the system (U5).

- **F7.1 — A season is a shared window + per-character completion. [DECIDED]** Seasons
  open and close on a **shared real-world clock** for everyone. A character is
  "season-complete" only if it **finished the mandatory tasks while the window was open**.
  Sell-eligibility specifically means *tasks done*.
- **F7.2 — Conditionally-transferable character, not literally soulbound. [DECIDED]** The
  character is a **normal transferable NFT whose transfer is program-gated by
  season-state**. "Soulbound" was the informal name; the precise behavior is
  **transfer-locked during a season, unlocked on completion**. (A true Token-2022
  `NonTransferable` token can *never* transfer, so it cannot implement "sellable at season
  end" — confirmed by research.) Likely mechanism: a **Token-2022 transfer-hook** that
  vetoes transfers failing the season-complete check; escrow-program gating is the
  alternative.
- **F7.3 — The three sale rules live in the gate. [DECIDED]**
  - Can't sell mid-season → transfer reverts if the window is open / tasks unfinished.
  - Can't sell a half-completed season → same check (tasks-done is required).
  - Sell ⇒ restart from the beginning next season → a successful sale flags the *seller's*
    account to start the next season at zero.
- **F7.4 — What the buyer inherits. [DECIDED]** The buyer **inherits the character's full
  grind-earned progress** (levels, relics, sigils, grind-earned cosmetics). But per U4, the
  **paid QOL stats reset** at the next season boundary — so a buyer cannot acquire
  purchased power by proxy. The durable, tradeable value of a character is *earned* progress
  only.
- **F7.5 — Non-seller continuity. [DECIDED]** A player who keeps their character carries
  **everything grind-earned** into the next season; only the paid QOL layer resets (U4).
  Loyalty is pure continuation.
- **F7.6 — Role symmetry.** The three roles apply one rule (the durable/seasonal split)
  uniformly: non-seller keeps earned + loses paid-QOL each season; buyer inherits earned +
  loses paid-QOL each season; seller cashes out + restarts at zero. No special cases.

**[TENSION] vs. canon.** The bible (and README) treat characters/relics as **soulbound**
with **no season-sale cash-out** — its only economic exits are cosmetic. F7's
conditionally-transferable character with a real cash-out is a major proposed revision.
See Conflict Register C2.

**Risk — this is the #1 legal-review item.** Concentrating all cash-out into character
sales does not remove regulatory exposure; it *relocates* it. A market where completed
characters sell for crypto is a secondary market for game assets — the structure that
external sources flag as reopening securities/gambling/tax questions. The repo's own README
anticipates this ("a tradeable secondary market would reopen far more"). Mitigants already
in the design: the U6 one-char-per-season cap rate-limits the market to ≤1 sale per account
per season, and U4/F7.4 ensure only *earned* (not purchased) value is tradeable. Still,
**legal/compliance sign-off is a hard precondition on enabling sales in production** (ties
to F6.3). *Not legal advice; flagged so it is not a silent omission.*

**Open.**
- **Q-F7a [OPEN]** Status of a character whose window **closed with tasks unfinished** —
  neither mid-season nor complete. Locked forever? Sellable at a penalty? Auto-reset?
  Carried as "failed"? (Needs an explicit rule; the gate must handle this state.)
- **Q-F7b [OPEN]** `NonTransferable` is unusable for F7.2 — confirm transfer-hook vs.
  escrow-program as the gating mechanism.
- **Q-A1 [DECIDED FOR PROTOTYPE][LEGAL OPEN]** (also U6) The one-per-season cap binds
  to a browser-local P-256 game account credential. The server owns the binding, issues a
  challenge, verifies the signature, and keys Chainwell value to the season character id
  instead of a display name. This is deliberately soft sybil resistance for prototype
  playtests; verified identity, wallet linkage, or sale-boundary controls remain a
  separate compliance decision before production cash-out.

---

## Underlying systems

### System — The Chainwell (in-game ledger of record)

- **S1.1 — Permanent, not scaffolding. [DECIDED]** The custom SHA-256 PoW chain is the
  **permanent** ledger for the gameplay economy (RUNE, levels, relics, sigils, and
  character/season state). Solana is **only** the real-money edge (F6) and the
  character-sale boundary (F7). It does not absorb the in-game economy.
- **S1.2 — Crossing points are first-class. [DECIDED]** Two seams cross between ledgers and
  concentrate the risk: **Solana → Chainwell** (wSOL purchase → Gold credited) and
  **Chainwell ↔ Solana** (character progress → the sellable NFT; sale proceeds + the
  restart-at-zero flag back). These get explicit reconciliation and failure-state handling.
- **S1.3 — Prototype mechanics graduate to ledger-grade. [DECIDED]** Two repo behaviors
  acceptable as a demo are **must-fix** now that this is the permanent ledger of record:
  the server **trusts client block validation** ("trust client validation for this demo"
  and keeps the longest chain) — an exploit surface for forged balances; and browser-side
  PoW mining as the credit mechanism invites client tampering. Block validation and RUNE
  reward minting now move through server validation; full gameplay outcome authority
  remains the broader server-authority migration below.

---

### System — Server authority & anti-cheat

- **S2.1 — Authoritative by requirement. [DECIDED]** Clients propose; the server disposes
  (U7). The server **validates every block** before accepting it into the Chainwell,
  **owns and arbitrates** all economy state (RUNE credit/debit, leveling, death loss/
  recovery, character/season state), and **arbitrates turn-based PvP outcomes**.
- **S2.2 — Three-tier authority model. [DECIDED]**
  - **Authoritative:** all economy state and PvP outcomes — server-owned, server-validated.
  - **Validated:** solo-segment outcomes (platformer, turn-based battle local feel) may run
    client-side for responsiveness, but their *outcomes* are server-validated before they
    touch the ledger.
  - **Non-authoritative:** casual movement broadcast in shared-world modes (the surviving
    relay role).
- **S2.3 — Client stays thin and buildless.** Moving authority to the server *removes* state
  ownership from the client; it does not add a client build step (see Architecture
  Constraints). If anything the client gets thinner: propose + render.
- **S2.4 — Browser mining stays, reward authority moves server-side. [DECIDED][IMPLEMENTED]**
  Q-S2b uses the hybrid model: the client asks for reward work (`mine:reward`), the server
  constructs the exact RUNE reward candidate (`mine:work`), the browser searches the nonce,
  and the server re-validates the submitted block (`mine:submit`) before appending it.
  Raw client-authored positive RUNE credits to value recipients are rejected, including
  forged transfers that try to add a fake `from` account. The client does not run local
  Chainwell mining while connected, so online reward credits flow through server-issued PoW.
- **S2.5 — Three-tier server authority enforcement. [DECIDED][IMPLEMENTED]** `server.js`
  exports and enforces the three-tier model. Raw client Chainwell blocks are disabled;
  RUNE credit/debit and Hearthlight power spends are server-issued candidates; validated
  solo outcomes use `segment:complete` before any ledger touch; casual movement remains a
  canonicalized relay; client-authored PvP result/hit/forfeit messages are rejected until
  server arbitration is implemented.

**Open / remaining.**
- **Q-S2a [CLOSED]** Authoritative Chainwell block validation uses `validateBlockCandidate`
  against the server tip for every accepted `mine:submit`; raw client blocks never append.
- **Q-S2c [OPEN]** Turn-arbitration protocol for turn-based PvP (turn submission, ordering,
  resolution, timeout/forfeit) — a meaningfully different networking shape from the current
  rebroadcast relay.

---

## Architecture constraints

- **A1 — Client: buildless, hard constraint. [DECIDED]** No build step, no framework,
  minimal/zero runtime dependencies. The client stays browser-native ES modules
  (`index.html` + `engine/*.js`, imported the way `engine/mode.js` already is). **New client
  functionality arrives as new ES modules, never as a framework or bundler.** Note: "no
  build step" ≠ "one big file" — the client grows by adding modules. *Any* proposal that
  would add a client build step is flagged as violating a hard constraint.
- **A2 — Server & contracts: dependency-flexible. [DECIDED]** Dependencies, tooling, and
  frameworks are permitted server-side and for on-chain contracts **with stated
  justification**. This is what makes the plan buildable: the Solana settlement program
  effectively requires the Anchor/Rust toolchain (no buildless on-chain program exists), and
  server-authority/turn-based netcode may justify real deps. A server/contract dependency
  needs a one-line justification; it is not otherwise gated.
- **A3 — Platform: browser-now, don't preclude native/mobile. [DECIDED]** Build and
  optimize for the web; avoid one-way doors that would make a future native/mobile client
  impossible. Concretely: keep input routed through the engine's source-agnostic
  **action-shape** (no raw `KeyboardEvent` handling inside engine logic — the abstraction
  already exists in `api.md`), and keep wallet integration adapter-based (F6.4). No effort
  is spent building for platforms not being shipped.
- **A4 — Extend, don't replace. [DECIDED]** The mode manager, the engine adapter boundary
  (`engine/api.md`), the existing level JSON formats, and the `rc:pvp` handshake are reused.
  The segment-sequencer (F3.2) and turn-based mode (F2.4) are **additions** that sit within
  the existing seams, consistent with the project's "extend over abstract" preference.

---

## Open Questions Register

Consolidated. Each is referenced inline above.

| ID | Question | Type |
|---|---|---|
| Q-F2a | What state carries from real-time engagement into turn-based battle (ambush?) | Design |
| Q-F2b | What do shared-world players see of someone in a solo segment | Design/UX |
| Q-F3a | What defines segment "completion" — reuse events vs. declared condition | Design |
| Q-F3b | Exact carry-over payload across the transition beat | Design |
| Q-F4a | Fraction of items/currency lost vs. retained on death | Balance |
| Q-F4b | Does death-loss apply equally to PvNPC and turn-based PvP | Design |
| Q-F5a | U3 cap's exact unit and value | Balance |
| Q-F5b | RUNE→Gold and wSOL→Gold rates | Balance |
| Q-F5c | Season reset of paid QOL — to zero or to a baseline floor | Design |
| Q-F6a | Settlement: custom Anchor program vs. client-built multi-instruction tx | Architecture |
| Q-F6b | Which wrapped-SOL mint to settle in | Architecture |
| Q-F7a | Status of a character whose window closed with tasks unfinished | Design (gate) |
| Q-F7b | Transfer-gating mechanism: transfer-hook vs. escrow-program | Architecture |
| Q-S2a | CLOSED: authoritative Chainwell validates server-issued `mine:submit` blocks only | Architecture |
| Q-S2c | Turn-arbitration protocol for turn-based PvP | Architecture |

---

## Conflict Register (PRD vs. ratified DESIGN-BIBLE)

**RECONCILED 2026-06-14.** C1–C4 were ruled and promoted into `DESIGN-BIBLE.md` (rulings 7–10),
which is now canon on these points. The original conflicts are kept below for traceability;
the resolution follows the table.

| ID | PRD proposal | Conflicts with bible | Bible's standing rule |
|---|---|---|---|
| **C1** | Gold funds **capped grind acceleration** (F5.1) | Terminology + premise: "**Gold buys cosmetics only, never power**" | Gold = "Dyes/vestments/skins/VFX only. Never power." (Terminology); "RUNE buys power only at Hearthlight" is "inviolable" (Ruling 1) |
| **C2** | **Conditionally-transferable character with real cash-out via sale** (F7) | Premise/README treat characters & relics as **soulbound**; the only economic exits in canon are cosmetic — no season-sale cash-out exists | "forging **soulbound** relics"; README: soulbound, no cash-out; "a tradeable secondary market would reopen far more" |
| **C3** | **Real item/currency loss on death**, RUNE-recoverable (F4) | Stakes are ruled **cosmetic only, no power transfer / no farmable power** | A3 PvP: "cosmetic stakes only, no power transfer"; Ruling 4: endgame grants "no farmable power" |
| **C4** | **Real money in + real value out** as first-class (F6, F7, U5) | The bible's entire economy assumes no real-money power and no cash-out | Premise + Rulings 1–6 are built on grind-only power and cosmetic-only spend |

**Resolution (ratified 2026-06-14 → `DESIGN-BIBLE.md` rulings 7–10).**

- **C1 — kept bible.** Gold stays cosmetics-only; the capped grind-acceleration (F5.1) is **rejected**. PRD U3/U4 are inapplicable — there is no paid power lever.
- **C2 — ratified.** Conditionally-transferable character; selling a season-complete character is the single value-exit; production go-live legal-gated.
- **C3 — modified (supersedes F4's death-loss).** No item/currency loss on death. Instead a character's **collection — items + cosmetics, some rare — persists and transfers; stats reset to zero** on sale/season-restart. Power is never inherited, only re-earned. *(Open: whether power-granting relics/Sigils transfer with the collection or reset with stats.)*
- **C4 — ratified.** Real money in (Solana settlement) + out (character sale) is canon as a designed system; production go-live legal-gated.

Builders now follow the bible's updated rulings 7–10 on these points.

---

## Out of scope / non-goals (current)

- A custom L1 / app-chain. The "blockchain" is the in-game Chainwell (S1) plus Solana at the
  edge (F6). No bespoke chain is built.
- A committed player-facing prize pool. The 35% is operator-discretion **marketing** (F5.4),
  deliberately *not* a payout pool (which would add tournament/gambling structure).
- Gold cash-out, or any cash-out other than character sale (U5).
- A native/mobile client as a build target (kept *possible* per A3, not *built*).
- Seamless (no-beat) engine transitions (F3.3 uses a transition beat by decision).
