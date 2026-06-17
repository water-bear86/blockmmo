# Recorded Pilgrim — top-down player character (source)

Bespoke protagonist replacing the old FreeKnight. Generated with PixelLab (v3, low
top-down, 8 directions). A tarnished hooded knight-pilgrim in ashen plate + dark green
cloak — fits the PRD's cozy-gothic parish and the default "tarnished" skin.

- PixelLab character id: `bd69a972-17c7-45d7-b7c8-2a489517583d`  (name: "Recorded Pilgrim")
- Canvas 80×80; content crops to a 37×42 cell.
- Animation so far: `walking-4-frames` (all 8 directions).

## Shipped sheet
`../../pixel/hero-knight-directions.png` — single row, 32 cells of 37×42, packed in the
game's order `frame = walkFrame*8 + dirFrame`, dirFrame ∈
[south, south-east, east, north-east, north, north-west, west, south-west].
`content.js` heroKnightDir is `{w:37,h:42}`; `drawHeroKnightPlayer` scales ×1.3.

## To add states later (attack / hit / death)
animate_character(character_id="bd69a972-...", template_animation_id="cross-punch" | "taking-punch" | "falling-back-death")
then re-pack into a parallel sheet and branch on p.attack / p.hurt in drawHeroKnightPlayer.
