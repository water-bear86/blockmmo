# RUNECHAIN — Design Bible (Acts 1–3)

> Canonical design reference. Locked from the story-quorum workflow (3 writers →
> opus moderator → quorum in 2 rounds → opus show-runner). Raw output:
> [`quorum-blueprint.json`](quorum-blueprint.json). Art prompts:
> [`ASSET-PROMPTS.md`](ASSET-PROMPTS.md).
>
> Economy/balance numbers below are **RATIFIED** (see Rulings). Engine/gameplay
> specs are stable. This file is the source of truth; do not contradict it.

## Premise

RUNECHAIN is a pixel cozy-gothic Soulslike MMO with fully original IP. A literal
on-chain ledger called the **Chainwell** governs death, debt, and identity beneath
the ruined **Gracefall Parish**. Players are the **Recorded**: souls who awaken into
administrative afterlife and must be filed correctly to exist. Monsters drop **RUNE**,
mined by the player's browser via real SHA-256 proof-of-work; RUNE buys **power**
(leveling Vigor/Endurance/Strength, forging relics) **only at Hearthlight**
safe-rest sites. **Gold** buys **cosmetics only**, never power. Bosses mint
one-of-a-kind on-chain **Boss Sigils**. The three areas are three strata of one
ledger, escalating from accepting debt, to inheriting and contesting it, to seizing
authorship of the record itself.

## Tone

Melancholic folk-gothic fused with dry bureaucratic/institutional horror. Candles,
bells, graves, wax, sextons, parish religion on one hand; receipts, audits,
confirmations, pending queues, compounding interest, repossession on the other.
Warmth is administrative and conditional; the horror is being *correctly processed*.
Defeats are re-filings and re-sealings, not cruelties; the final note is not a kill
but a signature.

**Palette per area:** A1 warm candle-amber → A2 cold mineral blue-green over a
Canon/Schism amber-vs-sickly-green split → A3 phosphorescent ledger-white bleeding
into hyperinflation reds.

## Throughline — from being WRITTEN to WRITING

| Area | Debt verb | Boss Sigil | Who controls your record |
|---|---|---|---|
| 1 · Gracefall Parish | **accepted** | The Waxen Testament | granted by the system |
| 2 · The Shroud Vaults | **inherited & contested** | The Contested Will | wrested from inheritance |
| 3 · The Archive of Attestation | **co-authored** | The Amended Record | written alongside the system |

Final line, shown to all players on all servers regardless of ending:
**"You have been recorded. Now — what will you record?"**

## Terminology

- **Recorded** — the player; a soul filed into the Chainwell (replaces legacy "Tarnished").
- **Chainwell** — the literal on-chain ledger beneath the parish. Stays unreachable and cosmic; never a god.
- **Hearthlight** — a safe rest site. Rest is always FREE, SAFE, enemy-free (hard invariant). RUNE→power and relic-forging happen only here. Per area: Hearthlight Chapel (A1), the Forklight (A2), the Celestial Spark (A3).
- **RUNE** — grind/power currency, browser-mined via SHA-256 PoW. Power only, only at a Hearthlight.
- **Gold** — cosmetic currency. Dyes/vestments/skins/VFX only. **Never power** (re-affirmed over the PRD's acceleration proposal — see ruling 7 / C1).
- **Boss Sigil** — unique on-chain final-boss drop. Three: Waxen Testament, Contested Will, Amended Record.
- **Mempool Yard** — the queue of pending/unconfirmed dead in Gracefall.
- **Hollow** — a debtor processed into a husk. Base enemy family; per-area variants (Debtor, Inheritor, Contradiction).
- **Canon / Schism** — the two contradictory ledger-chains the deep archive forked into; both claim the same souls. Canon = amber/orderly, Schism = sickly-green/chaotic. Crossing flips allegiance + move-set.
- **The Auditor** — A3 final boss; the accumulated will of every entry, the ledger's GHOST. Not a god, not malevolent — only consistent. Can become a co-author.
- **Husk / Relic Shade** — a repossessed player relic (from real on-chain inventory) animated as a hollow patroller in A3.
- **Confirmation** — a pending death/entry being finalized. Tied to bells (A1), re-inscription (A2), amendment (A3).
- **Character** — the player's account-character: a conditionally-transferable on-chain asset. Transfer-locked while a season is open; unlocks on season-completion. On sale/season-restart its **collection (items + cosmetics) carries; stats reset to zero** (C2/C3).
- **Season** — a shared real-world window. A character is "season-complete" (sale-eligible) only if it finished the mandatory tasks while the window was open.
- **Sale (cash-out)** — the single way value leaves the system: selling a season-complete character. Seller restarts at zero next season. Production go-live is gated on legal sign-off (C2/C4).
- **Rare item** — collected items vary in rarity; since stats reset on transfer, a character's **collection** (rare items + cosmetics) is its durable, tradeable value (C3).

## Economy rulings — RATIFIED

1. **Safe-rest invariant holds in every area.** Hearthlight rest is always free/safe/enemy-free. Later-area Hearthlights may *thematically* strain (flavor flashes only) but never cost or gate. Fees/inflation attach only to **optional, non-power** actions (e.g. viewing ancestral chains in A2). "RUNE buys power only at Hearthlight" is inviolable.
2. **Waxen Testament = +12% RUNE drop** + a "Legitimately Recorded" cosmetic marking + reduced confirmation-time at Hearthlight forges. The "scent of legitimacy" proximity passive is **cut** pending a future balance pass.
3. **The A3 "Final Audit / surrender all RUNE" is narrative pressure only** — never a hard pre-boss power-gate.
4. **Auditor endgame ships BOTH** the repeatable "Weekly Contestation" Echo *and* the creative "Amendment Content" sandbox. **Neither grants farmable power** (cosmetics/Gold pittances only, no extra Sigils).
5. **Area 2's Keeper-of-Margins side-quest is canonical and mechanical** — completing it weakens the Debt Foreman, so that fight has two difficulty states.
6. **The A/B/C final ending is permanent, account-bound, and publicly viewable** by other players (on-chain identity).

### Real-money & character lifecycle — RECONCILED (PRD C1–C4, ratified 2026-06-14)

These resolve the PRD Conflict Register; the bible is updated, so they are now canon.

7. **C1 — Gold stays cosmetics-only.** The PRD's capped grind-acceleration is **rejected**. Gold buys dyes/vestments/skins/VFX only and never touches progression speed; RUNE stays the sole power currency (no pay-to-win, no paid acceleration). PRD U3/U4 (paid-acceleration cap, seasonal QOL reset) are therefore **inapplicable** — there is no paid power lever.
8. **C3 — Items and cosmetics persist; stats reset only on transfer.** Death never drops items or currency (the PRD's death-loss is **rejected**) — dying just returns you to Hearthlight. A character's durable value is its **collection**: items (some **rare**) and cosmetics. On a **sale or season-restart** the collection carries to the new owner / next season, but **stats (levels) reset to zero**. Power is never inherited, only re-earned. *[OPEN] whether power-granting RUNE relics / Boss Sigils transfer with the collection or reset with stats — needs a call, since it decides whether a sale can convey any power.*
9. **C2 — The character is a conditionally-transferable asset with one cash-out.** Transfer-locked while a season is open / tasks unfinished; unlocks on season-completion. Selling a season-complete character is the **single value-exit**; buyer inherits the collection, not stats; seller restarts at zero; one character per account per season. *Production go-live is gated on legal/compliance sign-off — a hard precondition.*
10. **C4 — Real money in and out is a designed, canon system.** Gold is purchased via Solana settlement (wrapped-SOL, 50/35/15 split, true SPL burn); value exits only via the character sale. The **Chainwell** stays the permanent ledger of record; Solana lives only at the real-money edge and the sale boundary. *Go-live gated on legal sign-off (ties to ruling 9).*

> These supersede the bible's prior soulbound / no-cash-out framing on exactly these points. RUNE-power-only, the safe-rest invariant (ruling 1), and Gold-cosmetics-only (ruling 7) are unchanged. Balance values remain placeholders. Full design: `PRD.md` F4–F7, U1–U8.

---

# AREA 1 — Gracefall Parish *(canonical Act 1, extended)*

**Theme:** the unpaid-debt spiral and bureaucratic acceptance. Debtors who can't
repay become Hollows whose debt compounds; the Recorded must be filed correctly to
exist. Warm candlelit bureaucracy bleeding into institutional horror — the entry
point into servitude. **Extends the existing q01–q05 Act 1; never contradicts it.**

### Town — Hearthlight Chapel
The canonical safe hub atop the Chainwell, a former tax-house turned sanctuary; the
Hearthlight is a glowing registry well where RUNE is confirmed and relics forged; its
bells once marked time and now mark confirmations. **Rest is FREE/SAFE/enemy-free.**
- **Recorder/Chaplain** — Hearthlight keeper; levels stats + forges relics; intervenes at Mother Tallow's defeat.
- **Scribe/Archivist** — RUNE relic vendor + lore; reveals Tallow's legacy, seeds the inheritance theme.
- **Debt Confessional** — shows how debtors are processed into Hollows; points north to the Vaults.
- **Chapel Acolyte** — Gold cosmetics ONLY.
- **Sexton grave-tenders** — atmospheric lore around Paid/Unpaid graves.
- Interactables (exist): registry stone (q01), verification bells (q02).

### Platformer — Parish Road Receipts → mini-boss **Gate Sexton Marrow** (q02)
Forgiving side-scroller that teaches the aesthetic of debt before combat. Hazards:
muddy debt-fields (slow + stamina drain), clinging wax pools, tolling bells (stun, or
ring to lure), floating ledger-pages (chip damage), two moving receipt-post platforms.
Ringing both verification bells in sequence opens the collapsed tithe-house and spawns
the mini-boss.
- **Gate Sexton Marrow** — registry `sexton` (asset reuses `knight`); hp 96, dmg 14, speed 27, reward 34, color `#d8b36b`. Slow ledger-stamp slams leave ink-pools (DoT); enrages <50% HP. Arena: collapsed tithe-house with ledger-dust clouds that obscure telegraphs. Defeat = stamps your entry "witnessed," drops cosmetic "Sexton's Stamp."

### Battlefield — The Chainwell Ledger & Mempool Yard → mini-boss **Mempool Warden** (q04)
Open courtyard over the Chainwell pit; escalating debt-waves + opt-in RPG-style PvP
duels ("settling accounts"). Confirm pending tablets to weaken hazardous spirits.
- Creatures: Hollow Debtor (`hollow`), Red Hound (`hound`), Fallen Knight (`knight`), pending spirits.
- **Mempool Warden** — registry `mempool` (asset reuses `sorcerer`), ranged; hp 92, dmg 13, speed 22, reward 42, reach 88, color `#b88cff`. Spawns 2–3 Pending Hollow adds when wounded and grows stronger over time → speed-kill / batch-confirm tablets to weaken it.

### Final boss — **Mother Tallow** (q05) → Sigil **The Waxen Testament**
The FIRST RECORDED and the parish's original record-keeper, who melted into wax to
bind names and grew into the ledger's avatar — she bound herself to give debtors a
path to confirmation. Registry `tallow` (asset reuses `sentinel`, boss); hp 260,
dmg 22, speed 20, reward 100, color `#f1c75b`; `sigilName:"The Waxen Testament"`,
`sigilBuff:12`.
- **Combines:** TOWN — Hearthlight-blessed relics deal bonus damage; the Chaplain intervenes at her defeat. PLATFORMER — extinguishing the platformer candles permanently weakens her; wax pools echo the platformer hazard. BATTLEFIELD — exploding "Tallow Echoes" adds + ranged candle-spark pressure.
- **Phases:** (1) wax-melt touch (corrodes armor) + telegraphed candle-spark projectiles + periodic Echoes. (2) <50% HP: smoke thickens, visibility drops, Echoes spawn faster.
- **Defeat is merciful:** the Chaplain reveals her history; she is re-sealed/liberated; the system mints your first Boss Sigil, naming you the second in the recording tradition. Opens the path north to the Shroud Vaults.

---

# AREA 2 — The Shroud Vaults

**Theme:** inherited debt and the **forked archive**. Crystallized records of every
prior Recorded; bloodline debts compound generations back (RUNE now pays what
ancestors owed). The deep archive forked into two contradictory chains, **Canon** and
**Schism**, both claiming the same souls — the system's authority visibly cracks.

### Town — The Vault Anteroom & Archive Foyer *(Forklight Hearthlight)*
Crumbling bedrock half-submerged in frigid mineral pools, cold blue-green flame; a
central lectern shows the player's ancestor-chain as a visual ancestry tree.
**Forklight rest stays FREE/SAFE** — thematically strained only (resting flashes
"Your debt compounds deeper," brief red wash; no cost, no gate).
- **Keeper of Ancestry** — explains the inherited debt-chain + the fork; confirms your authorship at the Ledger-Bound's fracture.
- **Custodian Archivist** — warns the deep records never stay rested.
- **Librarian Shade** — advanced RUNE relic vendor; explains you can contest your own chain.
- **Keeper of Margins** — young scribe whose entry is being erased by the Schism. **Side-quest (canonical, mechanical):** re-inscribe her original entry → she testifies and significantly weakens the Debt Foreman.
- **Vault Custodians** — Gold cosmetics ONLY.
- Mechanic: leveling surfaces an "Ancestral Debt" counter that grows deeper down.

### Platformer — The Debt Mines & Ledger Cistern → mini-boss **The Debt Foreman**
Descent through crystallized ledger-stone (semi-transparent name-etched walls).
Midway the shaft FORKS: Canon side (amber, firm, predictable) vs Schism side (mirror
text, sickly-green fire, flickering platforms). Pick one early, **forced to cross** at
the halfway point via a name-spelling identity puzzle. Hazards: falling crystal shards,
toxic debt-gas (damage + RUNE bleed), resonant stun-echoes, water currents, swinging
pendulum-ledgers, **belief-platforms** (exist only on the chain you currently believe).
- **The Debt Foreman** — registry `foreman` (recolor a heavy `knight`-class strip crystalline blue-green). Slow, devastating; swings crack the floor into chasms; shatters names into Hollow Ancestor adds. **Dual-chain gimmick:** Canon hits damage one health bar, Schism hits another; bars don't sync — both must reach 0. **Graft:** Keeper-of-Margins testimony weakens him. Defeat writes "[Ancestor] released from stewardship."

### Battlefield — The Ledger Vaults / The Well's Mouth → mini-boss **The Bifurcated Guard**
Underground duel-arena lined with family-name vault doors; living floor scrolls live
transactions from all connected players; split Canon (amber sanctuary) / Schism
(green chasm). Pay RUNE to open sealed vaults and read ancestors' accounts (optional,
non-power). Clearing one side's creatures makes that half a temporary sanctuary.
- Creatures: Hollow Inheritor, Canon Auditor (armored/methodical), Schism Shadow (fast/phasing).
- PvP: duels can cross the fissure-line — stepping over flips allegiance + move-set.
- **The Bifurcated Guard** — registry `bifurcated` (two linked recolors of `knight`, amber + green, joined by a ledger-paper chain). Hitting one heals the other unless both are struck near-simultaneously; the final blow must hit both. Drops "Contested Key."

### Final boss — **The Ledger-Bound** → Sigil **The Contested Will**
A colossal golem of crystallized ledger-stone inscribed with thousands of ancestral
names — the pooled will of every forebear seeking to bind you forever. Registry
`ledgerbound` (boss); `sigilName:"The Contested Will"`.
- **Combines:** TOWN — embodies the Anteroom ancestor-chain; the Keeper appears at its fracture. PLATFORMER — FORKED arena (Canon-safe / Schism-DoT halves); lingering one side weakens your damage there, echoing belief-platforms + the dual-chain Foreman. BATTLEFIELD — Phase 2 splits into linked re-merging halves (escalates the Bifurcated Guard) and spawns Ancestor Paladins/Shades mirroring Canon Auditors/Schism Shadows.
- **Phases:** (1) ~60% HP: grinding ledger-clock steps, crystallized-debt projectiles, confirmation-ripple stuns, name-shatter adds; forked arena forces movement. (2) <40% HP: splits into Canon/Schism halves with independent re-merging health bars; the killing stroke must land from the CENTER of the fissure.
- Doesn't die — **fractures**: "[Your name] contested the inheritance and severed their name from the ancestral chain." **Sigil:** +attack speed, +RUNE gain; passive: brief "unrecorded" invulnerability when struck. Opens the ascent to the Archive.

---

# AREA 3 — The Archive of Attestation

**Theme:** paradox, hyperinflation, seizure → resolving in **co-authorship**. If you
are both Recorded (A1) AND freed of inheritance (A2), the system can't reconcile you.
The **Auditor** hunts that contradiction to enforce consistency; RUNE hyperinflates
toward worthlessness; repossessed player relics patrol as husks. The climax is not
combat but renegotiation: become the second scribe.

### Town — The Archive Tower / Chamber of Attestation *(Celestial Spark Hearthlight)*
An impossible Escher-tower spiraling up and down; a reading-desk writes the player in
real time; a hyperinflation ticker shows RUNE rewards decaying. **Celestial Spark rest
stays SAFE** — thematically *watched* only (resting flashes "Your amendment is noted,"
faint ledger-line trail ~10s; no cost, no gate).
- **Archivist** — now HOSTILE; uses the Auditor to "correct" the paradoxical player.
- **Prime Witness** — dying ancient inscribed with all history; reveals the Auditor is a ghost not a god; gates the platformer with "recorded, unrecorded, or rewritten?"
- **Unrecorded Pilgrim** — tempts toward Choice B.
- **Contradiction Echoes** — ghosts of alternate-choice versions of the player.
- **Archivist Phantom** — Gold-only void-skin cosmetics.
- Mechanic: a "Ledger State" UI rewrites in real time; all players' records are visible in a communal read-write archive. Optional "Void Seals" side-quest flavor-stabilizes the ticker.

### Platformer — The Ascent of Testimony / Corruption Cascades → mini-boss **The Scrivener**
A grueling vertical climb where the ledger eats itself. Numbered account-line
platforms: descending bleeds RUNE (inflation), ascending costs stamina (compliance).
Text doubles/contradicts; **gravity inverts at the halfway point**; a "Great
Redaction" zone blacks out the level (navigate by memory). Hazards: falling
account-pages, ink-static (stun + stat-drain), paradox-echoes (inverted player:
you-deal = you-take), Audit Wolves (`audit-wolf`, RUNE-draining adds).
- **The Scrivener** — registry `scrivener` (recolor `sorcerer`, ink-black). Rewrites the room each turn (platforms vanish, gravity flips), greys out chunks of your stat-sheet (temp nerfs). **Speed-kill gimmick:** faster kill = fewer stats nerfed. Death writes "[Your name] grants themselves write-access. Amendment pending," and drops "Scrivener's Quill" (one free respec) — this is the write-access you wield against the Auditor.

### Battlefield — The Seized Asset Yard / Contradiction Field → mini-boss **The Cascade Anchor**
An arena overlapping THREE ledger-zones (Recorded-obedient / Unrecorded-free /
nonexistent); footing flickers and burns away. Defeat Contradiction Hollows; interact
with core ledgers to stabilize your record. Here you realize the Auditor isn't evil,
only consistent — the paradox is your own creation.
- Creatures: Contradiction Hollow (phases all three zones); **Relic Shades** (`relic-shade`) — your own repossessed on-chain relics as husks (Ember Edge Shade, Rune-Lens Shade).
- PvP: duelists can briefly "raid" each other's relics (cosmetic stakes only, no power transfer).
- **The Cascade Anchor** — registry `cascade` (recolor `sentinel`, prismatic white). Summons mismatched A1/A2 phantoms; publishes stat-nerf decrees (e.g. "Registered as Indebted" −20% dmg 10s). **Contest gimmick:** cannot be damaged — contest three consecutive decrees via QTE to destabilize and retreat it. Drops cosmetic "Paradox Anchor."

### Final boss — **The Auditor** → Sigil **The Amended Record** *(Choice C only)*
A humanoid silhouette of scrolling self-rewriting text in a rotating ledger-cube. NOT
malevolent; CANNOT be killed in combat. Registry `auditor` (boss); `sigilName:"The
Amended Record"`.
- **Combines:** TOWN — the live-rewrite "Ledger State" UI + hyperinflation ticker become weapons; the Prime Witness's three-way question becomes the three choice-platforms. PLATFORMER — inherits the Scrivener's stat-greying, paradox-waves (control/perception flips), and the write-access its death granted you. BATTLEFIELD — temporal rifts spawn past/future versions of every enemy + seized relic; the three overlapping zones resolve into the choice-platforms.
- **Encounter phase:** defensive/contextual attacks only — corrections (cut, −~1 RUNE/hit, narrative not a gate), paradox-waves, rejection-stamps (erase ~15s of your sheet), temporal rifts.
- **Choice phase:** reach a choice-platform, stand ~10s while attacks become pure lore-context. **Three permanent, account-bound, publicly-viewable endings:**
  - **(A) Accept full recording** — eternally-bound Recorded, maxed RUNE-gen, locked identity; Auditor becomes your ally; *a trap that feels like winning.* Cosmetic Auditor's Robe.
  - **(B) Reject the ledger** — erase all RUNE, break all relics, step out Anonymous/unRecorded — free but powerless. Cosmetic Void-Skin.
  - **(C) Become the Second Scribe** — AMEND: entries become contestable/rewritable; the Auditor becomes your co-author and a neutral record-keeper. Cosmetic Scribe's Robes. **Drops The Amended Record** (the first two-author Sigil; hash shows both "Recorded" and "Unrecorded" — the contradiction is the point). **Unlocks endgame:** Weekly Contestation Echo + Amendment Content sandbox (no farmable power, no extra Sigils). A and B lock further ledger progression but preserve the story.

---

## Boss & Sigil summary

| Area | Platformer mini-boss | Battlefield mini-boss | Final boss | Sigil | Registry key |
|---|---|---|---|---|---|
| 1 | Gate Sexton Marrow (`sexton`) | Mempool Warden (`mempool`) | Mother Tallow (`tallow`) | The Waxen Testament (+12% RUNE) | `tallow` |
| 2 | The Debt Foreman (`foreman`) | The Bifurcated Guard (`bifurcated`) | The Ledger-Bound (`ledgerbound`) | The Contested Will (+atk spd/RUNE) | `ledgerbound` |
| 3 | The Scrivener (`scrivener`) | The Cascade Anchor (`cascade`) | The Auditor (`auditor`, 3 endings) | The Amended Record (Choice C) | `auditor` |

## Assets

See [`ASSET-PROMPTS.md`](ASSET-PROMPTS.md) for the per-asset PixelLab prompts and the
exact `import_assets.js` command for each. Existing sheets (`player`, `hollow`,
`hound`, `knight`, `sorcerer`, `sentinel`, `phantom`) are reused; new sprites are
`foreman`, `bifurcated`, `scrivener`, `audit-wolf`, `cascade`, `ledgerbound`,
`auditor`, `tallow-echo`, `hollow-ancestor`, `canon-auditor`, `schism-shadow`,
`relic-shade`. New tilesets: `tiles-vaults`, `tiles-archive`, `tiles-fx` (extend
`tiles.png` in place; never break existing indices).
