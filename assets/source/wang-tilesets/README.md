# Parish Wang Tilesets (source)

Bespoke top-down terrain generated with PixelLab AI (corner-based Wang autotiling,
16×16, high top-down, selective outline / medium shading / medium detail). All five
sets are anchored to one canonical **grass** base tile so the grass is pixel-identical
across every transition.

Canonical grass base-tile id: `c25c0a02-46bc-4317-bc72-b145f4898d69`
(prompt: *"dark rich forest green grass, deep mossy meadow with faint pale wildflowers, muted and somber"*)

| Row | Set    | Feature terrain (upper unless noted)            | PixelLab tileset id                     |
| --- | ------ | ----------------------------------------------- | --------------------------------------- |
| 0   | cobble | weathered cracked grey cobblestone path         | edfaeb43-c9d7-4cfe-9f22-3fc1d024ddd9    |
| 1   | water  | dark murky pond water *(grass is upper here)*   | b9f12f4f-f4f9-4eee-a74a-7fc74a0ac2d0    |
| 2   | dirt   | freshly turned dark grave soil                  | 3781618a-3514-404c-8b8d-94f72dcf7780    |
| 3   | cursed | corrupted ashen purple-grey blight              | 96fc96e0-8ac9-4526-b08a-e0731267a7b1    |
| 4   | plaza  | golden tan sandstone temple flagstones          | 3dbce297-4f54-4355-a249-4defdce74a9b    |

## Rebuilding the shipped atlas

`../pixel/tiles-parish.png` is a normalized **16 cols (corner signature) × 5 rows (feature)**
atlas, packed so a corner is `1` when it is the feature terrain (handles the water set's
grass-is-upper inversion). Column = `NW<<3 | NE<<2 | SW<<1 | SE`. Row = feature id − 1
(`COBBLE=1 WATER=2 DIRT=3 CURSED=4 PLAZA=5`; `GRASS=0` is column 0).

A somber color-grade (≈0.82 sat, 0.80 brightness, faint cool tint) is baked into the
shipped atlas. To re-grade or extend, re-pack from these source png/json files.

The in-game autotiler lives in `index.html` (`terrainAt` / `drawWang` / `drawTerrain`).
