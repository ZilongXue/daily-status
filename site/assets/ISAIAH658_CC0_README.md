# isaiah658 "50+ Monsters Pack" (2D + 3D)

Source: https://opengameart.org/content/50-monsters-pack-2d and https://opengameart.org/content/50-monsters-pack-3d (version 1.0, fetched 2026-10-11).
License: **CC0** (public domain). Author: isaiah658. Monsters #26 and #47 are based on CC0 designs by j0j0n4th4n. Original credits in CREDITS_2D.txt / CREDITS_3D.txt.
The author deliberately gave the monsters numbers, not names.

Role in this project: placeholder creatures for the Phase 1 greybox. The 2D sprites and the 3D models are the same 56 designs, so the
2D battle screen and the pixelated-3D scene can use the same cast.

Layout (files renamed from the originals, numbers zero-padded):
- `sprites/monster_NN_front.png`, `monster_NN_back.png` (64x64, pure black + 4 colors), `*_alt.png` = alternative palette.
- `models/monster_NN.obj` static mesh, no rig, no animation; UV-mapped onto `textures/monster_NN.png` (a 4x1 palette, use nearest filtering); `*_alt.png` = alternative palette.
- Human previews live in `docs/asset-previews/isaiah658/` (kept out of the Godot import).
