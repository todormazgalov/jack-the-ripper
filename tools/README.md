# Map extraction scripts

One-off scripts that produced `shared/src/map/whitechapel.json`. You don't need them to play.
They expect a working folder containing:

- `work/board.webp`: the board photo (same image as `client/public/board.webp`)
- `work/graph.webp`: the clean schematic graph image
- `wcr.json`: whitechapelR's `roads`, `alley` and `node_locations`, converted from its `.rda` files

They need Python with `opencv-python-headless`, `numpy` and `pillow`. Run them in this order:

1. `detect_graph.py work/graph.webp work/g_det.json`: finds the circles and squares on the schematic.
2. `match_ids.py work/g_det.json wcr.json '<anchors json>'`: numbers the circles by fitting an affine transform to the reference coordinates.
3. `detect_board.py work/board.webp work/b_det.json`, then `match_ids.py` again for the board photo.
4. `trace_edges.py work/graph.webp work/g_det.json wcr.json work/g_graph.json`: traces the lines into street segments and finds junctions.
5. `compare.py work/g_graph.json wcr.json`: compares the derived adjacency with the reference.
6. `build_map.py`: works out the house blocks (planar faces) and compares the alley pairs.
7. `to_board.py`: maps everything onto the board photo and snaps crossings to the squares detected there.
8. `export.py <out map json> <out fixture json>`: writes the final files.

For small fixes, use the in-app editor at `/editor` instead.

`upscale_board.py` makes `client/public/board-hd.webp`, the smoother 2x photo the game shows behind the vector board.
