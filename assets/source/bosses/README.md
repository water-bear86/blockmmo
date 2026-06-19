# Area-1 enemy + boss sprites (source)

PixelLab sprites for the Gracefall Parish enemies/bosses, replacing placeholders.
Each shipped sheet is a single-row 4-frame strip in `drawEnemy`'s
`[idle1, idle2, windup, hurt]` order (frame picks: breathing-idle 0 & 2 ·
cross-punch 3 (windup) · taking-punch 2 (hurt)), cropped to a shared
center-symmetric bbox, squared, resized to the target cell.

| Sheet | Enemy | cell | PixelLab character id | Wiring |
| --- | --- | --- | --- | --- |
| `../../pixel/knight.png` | Fallen Knight | 24 | `c49a181c-e4bf-47df-a0eb-8ae9ffacb100` | pure swap |
| `../../pixel/sorcerer.png` | Hollow Sorcerer | 24 | `84ec1e51-4380-4893-b051-816cd562b10c` | pure swap (also used by `mempool`) |
| `../../pixel/sexton.png` | Gate Sexton Marrow | 24 | `32c53c31-8144-4f62-a364-693f7c259a4c` | NEW: `ASSETS.sexton` + `TYPES.sexton.asset='sexton'` |
| `../../pixel/tallow.png` | Mother Tallow (boss) | 48 | `49674162-e5bd-4ee8-b3e3-a2668ae0583e` | NEW: `ASSETS.tallow` + `TYPES.tallow.asset='tallow'` + `TURN_TALLOW.sprite='tallow'` |

Sexton/Tallow previously reused the generic `knight`/`sentinel` sprites; they now
have dedicated keys. `mempool` (Mempool Warden) still shares `sorcerer` — give it a
dedicated sprite in a future pass. Mother Tallow has `boss:true` (renders 48px); the
same strip serves both the real-time fight and the turn-based `TURN_TALLOW` duel.
