# Q-F7a ruling — a character whose season window closed with tasks unfinished

**Status:** DECIDED (proposed; maintainer may override). Closes issue #34.
**Refs:** PRD F7 (the one cash-out), F7.1, F7.3, F7.5; DESIGN-BIBLE C2.

## The gap

PRD F7.1/F7.3 define two clean character states — **mid-season** (window open) and
**season-complete** (finished the mandatory tasks while the window was open → sale-eligible).
F7.5 defines a third: the **completer who keeps** their character and carries everything
grind-earned into the next season.

None of these cover the character that is *neither* mid-season *nor* season-complete: the
**window closed while mandatory tasks were unfinished**. The transfer gate already refuses to
sell it (tasks-done is required, F7.3), but its forward status was undefined.

## Decision: **Carried as "failed."**

A character whose window closed with mandatory tasks unfinished (and which was never sold) is
**failed**. It:

- **Keeps its collection** — cosmetics, relics, sigils. These are non-economic keepsakes
  (Gold-cosmetics-only, ruling 7); keeping them is harmless and avoids punishing the player's
  identity/wardrobe.
- **Cannot be sold.** The cash-out gate stays *earned-only*: value leaves the system only by
  selling a genuinely season-complete character (F7, U5). A failed character is not a partial
  cash-out — there is no "sell at a penalty" path. This keeps the #1 legal-review surface
  (secondary market for completed characters) from widening.
- **Re-attempts next season with stats reset to zero.** Failing forfeits the season's
  **grind-earned stats**; the player starts the next season fresh but with their collection
  intact, and may try to complete the mandatory tasks again.

### Why these options were rejected

| Option | Rejected because |
| --- | --- |
| Locked forever | Harsh; strands the account's only character with no path forward. |
| Sellable at a penalty | Opens a partial cash-out — exactly the secondary-market/securities surface the cash-out design works to *contain* (PRD F7 risk note). |
| Auto-reset (wipe) | Destroys the non-economic collection for no design benefit; feels punitive. |
| **Carried as failed** (chosen) | Matches issue #34's own phrasing ("retains collection but cannot sell; can re-attempt next season"); keeps the cash-out earned-only; gives a forward path. |

### Relationship to F7.5

F7.5 ("non-seller continuity") is about a **completer who keeps** their character — that player
carries grind-earned stats *and* collection forward (only the paid-QOL layer resets, U4). The
failed character is deliberately **distinct**: it keeps the collection but **does not** carry
grind-earned stats. Completing a season is therefore meaningfully better than failing it. If the
maintainer prefers full F7.5-style durability for failed characters too (keep stats, just can't
sell), flip the `reattempt` carry to keep `previous.stats` — the status/gate logic is unchanged.

## Implementation

- `server.js` `characterStatus(accountId, at, characterId)` → `mid-season | season-complete |
  failed | sold`, plus `canSell` / `canReattempt` flags. The transfer gate (`canSellCharacter`)
  already enforces *closed + complete*, so a failed character is gate-blocked with
  `season_tasks_unfinished`.
- `server.js` `resolveCharacterCarry` → a failed previous character resolves to a new
  **`reattempt`** carry mode: `collection` kept, `stats` zeroed, `statsReset: true`. (Distinct
  from `keep` = completer continuity, `sale-transfer` = buyer inherit, `restart-zero` = seller.)

## Edge case — window closes exactly when the player is mid-task

The season window is the half-open interval `[opensAt, closesAt)` (`isSeasonOpen` /
`isWithinSeason` use `t < closesAt`). A mandatory task completed at exactly `closesAt` is
**rejected** (`season_closed`) and does not count — so a player racing to finish the last task as
the clock strikes close ends **failed**, not season-complete. Covered by
`scripts/verify_character_season_state.js`.
