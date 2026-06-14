# RUNECHAIN — Asset prompt worksheet (PixelLab)

Turnkey sheet for the art lane. Each entry has a **PixelLab prompt** (copy-paste) and
the exact **import command** to bring the export into the game. Pipeline + conventions:
[`scripts/ASSETS.md`](../../scripts/ASSETS.md). Canon: [`DESIGN-BIBLE.md`](DESIGN-BIBLE.md).

**Flow:** generate in PixelLab → export frames (animation) or rotations (8-dir) → run
the import command → the sheet lands in `assets/pixel/` and is recorded in
`assets/pixel/manifest.json`. Every prompt ends with *"original IP, no franchise
references"* on purpose — keep it that way.

```bash
# animation strip (bosses, enemies, props): export 4 frames to a folder, then:
node scripts/import_assets.js <type> --name <key> --src ~/Downloads/<export>/frames --frame <px>
# 8-direction hero/NPC: export the rotations folder (south.png, south-east.png, ...), then:
node scripts/import_assets.js hero --name <key> --src ~/Downloads/<export>/rotations
```

## Reuse (already in repo — no action)

`player` (+ `player-directions`), `hollow`, `hound`, `knight`, `sorcerer`, `sentinel`,
`phantom`. Several mini-bosses intentionally **reuse** these strips at recolor until
dedicated art exists: `sexton`→knight, `mempool`→sorcerer, `tallow`→sentinel. Generate
the dedicated art below only when you want to replace the placeholder.

---

## New bosses & mini-bosses

### Gate Sexton Marrow — `sexton` (A1 platformer mini-boss)
```
Pixel boss sprite, ~56px frame, side-view, a skeletal parish clerk in tattered grey robes wielding a giant ledger-stamp / seal-hammer; brass #d8b36b seal-trim, ledger-dust motes around him. 4 frames: idle, walk, overhead stamp-slam (with ground shockwave + ink-pool), enraged faster stamp. Cozy-gothic limited palette, candle-amber light, transparent background, original IP, no franchise references.
```
`node scripts/import_assets.js boss --name sexton --src ~/Downloads/sexton/frames --frame 56`

### Mempool Warden — `mempool` (A1 battlefield mini-boss)
```
Pixel boss sprite, ~56px frame, a hunched ink-stained figure dragging chains of keys, wax seals, and crumpled ledger-paper; rune-violet #b88cff glow. 4 frames: idle, slow melee, ranged seal-bolt cast, summon Pending Hollow add. Cozy-gothic bureaucratic-horror palette, transparent background, original IP, no franchise references.
```
`node scripts/import_assets.js boss --name mempool --src ~/Downloads/mempool/frames --frame 56`

### Mother Tallow — `tallow` (A1 final boss)
```
Pixel boss sprite, ~64px frame, a tall robed candle-woman wreathed in smoke, body melting into wax, surrounded by small wax effigies bearing carved names; candle-gold #f1c75b inner glow, ringed by lit and dark candles. 4 frames: idle, close wax-melt touch, ranged candle-spark projectile, phase-2 thick-smoke summon (exploding wax-double). Melancholic cozy-gothic palette, transparent background, original IP — she is the first record-keeper, not any existing character.
```
`node scripts/import_assets.js boss --name tallow --src ~/Downloads/tallow/frames --frame 64`

### The Debt Foreman — `foreman` (A2 platformer mini-boss)
```
Pixel boss sprite, ~64px frame, a massive stooped giant of crystallized blue-green ledger-stone bound in mountain-heavy iron-black chains, his body etched with thousands of bone-white names and compound-interest figures. 4 frames: idle, heavy chain-swing, floor-cracking slam (chasm + Hollow Ancestor add), shatter. Cold mineral cozy-gothic palette, faint amber Canon glow on one side and sickly-green Schism glow on the other, transparent background, original IP.
```
`node scripts/import_assets.js boss --name foreman --src ~/Downloads/foreman/frames --frame 64`

### The Bifurcated Guard — `bifurcated` (A2 battlefield mini-boss)
```
Pixel boss sprite, ~56px frame, a headless vault-knight whose body splits into two linked halves connected by a chain of ledger-paper inscribed with one name twice; LEFT half armored amber #d8b36b (orderly Canon), RIGHT half armored sickly-green #6fae6a (chaotic Schism). 4 frames: idle, dual attack, mutual heal-pulse, collapse into the fissure. Cozy-gothic underground palette, transparent background, original IP, no franchise references.
```
`node scripts/import_assets.js boss --name bifurcated --src ~/Downloads/bifurcated/frames --frame 56`

### The Ledger-Bound — `ledgerbound` (A2 final boss)
```
Pixel boss sprite, large ~80px frame, a colossal humanoid golem of crystallized ledger-stone inscribed with thousands of glowing bone-white ancestral names, amber Canon veins on its left and sickly-green Schism veins on its right. 4 frames: grinding heavy step/idle (ledger-clock motif), crystallized-debt projectile hurl, confirmation-ripple stun, phase-2 fracture-split into two linked halves. Cold mineral cozy-gothic palette, transparent background, original IP — the pooled will of ancestors, no existing-franchise references.
```
`node scripts/import_assets.js boss --name ledgerbound --src ~/Downloads/ledgerbound/frames --frame 80`

### The Scrivener — `scrivener` (A3 platformer mini-boss)
```
Pixel boss sprite, ~64px frame, a furious many-armed figure made of quills, parchment, and ink, scratching ceaselessly; ink-black body, white parchment scraps, redaction-bar greys, faint rune-violet #b88cff edits. 4 frames: idle scratch, room-rewrite cast (platforms vanish / gravity flip), summon ink Audit Wolf, pen-snap death. Bureaucratic cozy-gothic horror palette, transparent background, original IP.
```
`node scripts/import_assets.js boss --name scrivener --src ~/Downloads/scrivener/frames --frame 64`

### The Cascade Anchor — `cascade` (A3 battlefield mini-boss)
```
Pixel boss sprite, large ~72px frame, a towering crystalline entity of hyperlinked ledger-entries, prismatic white crystal with hyperlink-blue refractions, holding three overlapping reality-zones together; hazard-red decree text orbits it. 4 frames: idle, decree-publish flash, summon mismatched phantom enemies, destabilize-and-retreat. Cozy-gothic phosphorescent palette, transparent background, original IP, no franchise references.
```
`node scripts/import_assets.js boss --name cascade --src ~/Downloads/cascade/frames --frame 72`

### The Auditor — `auditor` (A3 final boss)
```
Pixel boss sprite, large ~80px frame, a humanoid silhouette composed entirely of scrolling, self-rewriting phosphorescent ledger-white text on void-black, enclosed in a slowly rotating three-dimensional wireframe ledger-cube; hyperinflation-red ticker accents, a gold #f1c75b co-author seal. 4 frames: idle text-scroll, correction text-line cut, rejection-stamp / paradox-wave, calm co-authoring dialogue pose. Solemn cozy-gothic palette, not a god and not a demon — a ghost of pure ledger-logic, transparent background, fully original IP, no franchise references.
```
`node scripts/import_assets.js boss --name auditor --src ~/Downloads/auditor/frames --frame 80`

---

## New enemies, adds & recolors

| Key | What | Import command |
|---|---|---|
| `audit-wolf` | ink-and-ledger wolf; RUNE-draining adds (A3) | `boss`→ use `monster --name audit-wolf --frame 32` |
| `tallow-echo` | exploding wax-double add (A1) | `monster --name tallow-echo --frame 24` |
| `hollow-ancestor` | Hollow Inheritor bloodline husk (A2) | `monster --name hollow-ancestor --frame 24` |
| `canon-auditor` | armored methodical Canon enemy (A2) | `monster --name canon-auditor --frame 24` |
| `schism-shadow` | fast phasing Schism enemy (A2) | `monster --name schism-shadow --frame 24` |
| `relic-shade` | repossessed-relic husk (A3) | `monster --name relic-shade --frame 24` |

Prompts (4 frames each: idle, move, attack, death — unless noted):
```
audit-wolf:      Pixel enemy sprite, 32px, an ink-and-ledger wolf of running black ink with ledger-line white seams and a faint #b88cff RUNE-drain glow at the jaws. Frames: idle, run, bite/RUNE-drain, death. Cozy-gothic, transparent background, original IP.
tallow-echo:     Pixel add sprite, 24px, a small melting tallow-cream wax-double with a candle-gold #f1c75b core and smoke-grey wisps. Frames: spawn, shamble, swell, explode. Cozy-gothic, transparent background, original IP.
hollow-ancestor: Pixel enemy sprite, 24px, a grey debtor husk crusted with crystallized blue-green ledger-stone and faded gilt heirloom trim. Frames: idle, walk, attack, death. Cozy-gothic, transparent background, original IP.
canon-auditor:   Pixel enemy sprite, 24px, an armored methodical clerk-knight in amber #d8b36b plate with an orderly ledger-seal tabard. Frames: idle, march, rule-strike, death. Cozy-gothic, transparent background, original IP.
schism-shadow:   Pixel enemy sprite, 24px, a fast low-alpha phasing figure of sickly-green #6fae6a mirror-text static. Frames: idle flicker, dash, phase-strike, dissipate. Cozy-gothic, transparent background, original IP.
relic-shade:     Pixel enemy sprite, 24px, a husk-grey phantom shaped like a stolen weapon-relic; two variants — Ember Edge (ember-orange) and Rune-Lens (#b88cff). Frames: idle, patrol, relic-attack, repossess-death. Cozy-gothic, transparent background, original IP.
```

---

## Tilesets *(you're grabbing these statically — normalizer ready)*

Any terrain sheet you grab slices into a 16px atlas + index:
```bash
node scripts/import_assets.js tileset --name tiles-vaults  --src ~/Downloads/vaults.png
node scripts/import_assets.js tileset --name tiles-archive --src ~/Downloads/archive.png
node scripts/import_assets.js tileset --name tiles-fx      --src ~/Downloads/fx.png
```
- **`tiles-vaults`** — Shroud Vaults: crystallized ledger-stone walls, frigid mineral pools, cold blue-green flame, family-name vault doors, Canon (amber/firm) vs Schism (green/flickering) split-floor variants, debt-gas pools, pendulum-ledgers.
- **`tiles-archive`** — Archive: impossible Escher shelving, phosphorescent ledger-lamps, fluttering pages, numbered account-line platforms, Great Redaction black-out tiles, three-zone overlap floor, hyperinflation-red ticker props, burning-away footing.
- **`tiles-fx`** — shared overlays: ledger-dust, ink-pools (DoT), confirmation-ripples, smoke, gravity-inversion markers, redaction bars, ledger-line trails, candle lit/dark.
- **Existing `tiles.png`** (Gracefall surface) — extend in place; **never break existing tile indices.**

---

## Boss Sigil item icons — `sigil-icons` (32px each)
```
Three 32px pixel item icons in a cozy-gothic ledger style on transparent background: (1) Waxen Testament — a wax seal stamped with a candle and a confirmation mark, candle-gold #f1c75b; (2) Contested Will — a torn family-tree ledger page with a name split down a glowing fissure, amber-vs-sickly-green; (3) Amended Record — a single seal showing both 'Recorded' and 'Unrecorded' text overlaid and contradictory, co-signed with a gold and a void quill. Crisp readable icons, original IP.
```
Import as a 3-frame strip: `node scripts/import_assets.js prop --name sigil-icons --src ~/Downloads/sigils/frames --frame 32`

---

## Optional — Meshy 3D *(only if the project ever returns to a 3D client)*

Non-blocking; the playable demo stays web-pixel-first (see `models/README.md`). Costs
Meshy credits — confirm before generating.
```
Low-poly stylized cozy-gothic game-ready model, single-file GLB, neutral T-pose, ~5k tris, hand-painted texture in a limited candle-amber and mineral-blue-green palette. Variants: (a) Ledger-Bound stone golem inscribed with glowing names, amber and green veins; (b) Auditor humanoid of floating text panels inside a wireframe cube; (c) Scrivener many-armed ink-and-quill figure.
```
