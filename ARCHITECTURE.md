# Drydock architecture

Static, framework-free browser app: Vite + TypeScript, three.js (WebGL2), Web Workers, File System Access API.

## Principles

- **One runtime dependency: `three`** (named ES imports only, so it tree-shakes; no `three/examples` controls, the orbit camera is ours). Dev dependencies: `vite`, `typescript`, `vitest`, `playwright-core` (screenshots only, uses the installed Edge/Chrome).
- **Build the DOM once, patch it on state change.** There is no virtual DOM, and no panel is re-rendered wholesale through innerHTML on a state change. A list rebuilds its rows only when its own data changes.
- **Render on demand.** The GL loop runs only while something animates (camera lerp, drag, turntable). Otherwise a state change draws one frame.
- **Heavy work goes in a worker.** Blueprint parsing, source scanning and CSG voxelizing never block the UI.
- **Performance targets:** first paint < 100 ms; JS bundle < 200 kB gzip without data (three included); a 10k-block bp.sbc goes from drop to frame in < 300 ms; the 105k-block / 54 MB workshop blueprint `244850/3489293609` in < 2.5 s; 60 fps orbit at 105k blocks with boxes. With block models every block draws its LOD0 mesh (no LOD switching), so the model frame rate on huge ships is whatever the GPU manages; measured: 88 fps for `3489293609` at 1600×1000 with 2× SS.

## Layout

```
drydock/
  index.html                 app shell markup (static skeleton) + Google Fonts link
  vite.config.ts             base './', worker.format 'es'
  scripts/gen-vanilla.mjs    game Content -> src/data/vanilla-blocks.json (committed)
  scripts/gen-tiles/         dotnet tool: loads Sandbox.Game.dll from SE_GAME_ROOT/Bin64, reads MyCubeGridDefinitions.GetTopologyInfo -> src/data/tile-table.json (committed)
  scripts/shot.mjs           playwright-core + msedge: screenshots of the built app
  src/
    main.ts                  entry: loads app.ts, or waits for "Continue anyway" when index.html flagged a window narrower than 1120 px
    app.ts                   bootstrap: store, UI mounts, renderer, restore sources
    styles/industry.css      design system styles
    styles/app.css           app layout
    state/store.ts           tiny store: get / set / watch(selector, cb)
    state/app.ts             AppState type, initial state, actions (the only place that mutates)
    ui/dom.ts                h(tag, props, ...children), icon(name, size), corners()
    ui/icons.ts              inline Lucide path data (box, folder, download, search, scissors, rotate-cw, maximize, x, check)
    ui/nav.ts  ui/footer.ts  ui/blueprintPanel.ts  ui/composePanel.ts
    ui/viewport.ts           canvas host, overlay canvas (gizmo, frame marks, dim), top controls, caption, readout, toast
    ui/right/view.ts  ui/right/section.ts  ui/right/scene.ts  ui/right/export.ts  ui/right/tabs.ts
    ui/sourcesDialog.ts  ui/missingDialog.ts
    se/xml.ts                minimal fast XML tokenizer (definition files, small docs)
    se/blueprint.ts          targeted bp.sbc scanner -> ParsedBlueprint (no generic tree)
    se/orient.ts             Base6, CreateWorld(forward, up), rotated block extent (ComputeMax)
    se/color.ts              paintColor(hsv) (TextureValue 0.85)
    se/defs.ts               DefRegistry + resolveBlueprint() (vanilla/game/mods, mod selection)
    se/sbcWrite.ts           voxel grid -> bp.sbc text
    sources/idb.ts           IndexedDB wrapper (source meta, snapshots, mod caches, parsed blueprints)
    sources/sources.ts       folder picker input, scan orchestration, snapshot restore, unlink
    compose/csg.ts           shape stack -> voxels (pure, used inside the worker)
    compose/file.ts          composition JSON read/write
    workers/work.worker.ts   one worker module: parseBlueprint, scanSource, indexMod, voxelize
    workers/rpc.ts           promise RPC over postMessage with transferables
    render/renderer.ts       three WebGLRenderer + Scene; setModel, setOptions, draw(target), on-demand loop
    render/camera.ts         orbit camera, presets + damped lerp, persp/ortho, sub-frustum for tiles
    render/boxMaterial.ts    RawShaderMaterial/ShaderMaterial for blocks + background material
    render/background.ts     gradients / studio / stand-in skyboxes
    render/exportImage.ts    tiled offscreen render, supersample downsample, encode, clipboard, turntable
    render/cube.ts           unit cube + per-grid box instancing
    render/detail.ts         RenderModel + meshes + tile table -> model/tile instances, fallback boxes, seam edges (pure)
    render/detailLayer.ts    reference pipeline: materials, g-buffer, composite, glass, downsample, export tiles
    render/detailShaders.ts  GLSL of the reference pipeline
    render/pbr.ts            linear RGB light, environment, emissive and exposure constants of the Textured PBR shading
    render/assets.ts         main-thread mesh/texture registry: worker requests, three textures and attributes
    assets/keys.ts           upload paths -> asset keys (c:<content path>, m:<mod key>:<path>), lookup candidates
    assets/build.ts          worker side: MWM -> mesh (subparts, geometry assets), DDS -> texture levels, IDB cache
    assets/material.ts       material classification and fixed colours
    se/mwm.ts  se/dds.ts     MWM reader, DDS reader + BC1-5/BC7 decoders
    se/tiles.ts              tile table loader + armor pattern offset
    util/zip.ts              store-only zip writer (turntable frames)
    util/save.ts             download(blob, name): every file export is a browser download
    data/vanilla-blocks.json
    data/tile-table.json
  test/                      vitest: blueprint parser, orient, csg, sbcWrite round trip, defs resolution, assets, detail
```

## State

`state/store.ts`:

```ts
createStore<S>(initial: S): {
  get(): S
  set(patch: Partial<S> | ((s: S) => Partial<S>)): void   // shallow merge, nested objects replaced immutably
  watch<T>(sel: (s: S) => T, cb: (v: T, prev: T) => void, eq?: (a: T, b: T) => boolean): () => void
}
```

`AppState`: mode, bp, blueprint list filter (source, search), mods, tab, render, section, scene, export, compose, sources, srcOpen, toast, busy, spin, preset. Camera yaw/pitch/zoom live in `render/camera.ts` and are mutated per frame, not stored. UI modules only read state and call actions from `state/app.ts`. Actions talk to the worker and the renderer.

## Data flow

```
drop / list click / ?bp=<url>
  -> worker.parseBlueprint(ArrayBuffer | File)           -> ParsedBlueprint (typed arrays + string table)
  -> defs.resolveBlueprint(parsed, registry, modToggles) -> RenderModel + table rows + mod rows
  -> renderer.setModel(model)
mod checkbox / missing-mode / tint toggle -> rebuild RenderModel flags on the main thread (no re-parse)
```

### ParsedBlueprint (worker output, transferable)

```ts
{
  name: string
  strings: string[]                     // "Type/Subtype" keys, deduplicated
  skins?: string[]                      // SkinSubtypeId values, deduplicated
  grids: Array<{
    large: boolean
    world: Float32Array(16)             // PositionAndOrientation as CreateWorld(pos, fwd, up)
    key: Uint32Array                    // per block: index into strings
    min: Int32Array                     // per block: x,y,z
    orient: Uint8Array                  // per block: forward*6+up (Base6 order Forward,Backward,Left,Right,Up,Down)
    hsv: Float32Array                   // per block: ColorMaskHSV x,y,z (default 0,-0.8,0)
    skin?: Uint16Array                  // per block: 0 = none, else 1 + index into skins
  }>
}
```

Grids are sorted by block count (× 125 for large). Grid 0 is the main grid. Orientation follows the pilot block of the main grid: the block with `IsMainCockpit`, else the first Cockpit whose subtype contains `Cockpit`, else the first Cockpit that is not a passenger seat, bed, toilet, couch, bathroom or desk, else the first RemoteControl (`ParsedGrid.pilot`). `resolveBlueprint` multiplies every grid's `toMain` by the inverse of that block's `CreateWorld(0, Forward, Up)`, so the pilot faces −Z with +Y up; dims, length, section axes, presets and fit all use this frame. Without a pilot block the grid axes are used. Only `Cockpit` and `RemoteControl` blocks count, so an `IsMainCockpit` inside a projector's stored blueprint is ignored. `PARSE_VERSION` 3 adds `pilot`; older cached parses are re-read from the file when it is available, otherwise the pilot is derived from their block list without the main-cockpit flag until the source is refreshed. Every grid is drawn in main-grid space through `inverse(main.world) * grid.world`. The scanner is a hand-written indexOf/charCode loop over the decoded text. It handles `xsi:type`, `SubtypeName`/`SubtypeId`, `Min` attributes, `BlockOrientation` attributes or children, `ColorMaskHSV`, and nested `CubeBlocks` that aren't the grid's (for example inside ComponentContainer or toolbar data, which never contain `<MyObjectBuilder_CubeBlock`). `.sbcB5` is not supported. When a folder has both files, use `bp.sbc`.

### Definitions

`DefRecord = { type, subtype, large, size: [x,y,z], name, source, render? }`, where `source` = 'vanilla' (bundled), 'game', or a mod key. Parsing: `Id` as attribute or child, `CubeSize`, and `Size` as attributes, at least 1. `render` holds `Model`, `ModelOffset`, and, when `BlockTopology` is `Cube` or there is no model, the `CubeTopology` index and the `Sides` (`Model`, `PatternWidth/Height`, `ScaleTileU/V`); paths are lower-cased with `/` separators. `AssetModifier` definitions become skins (`DefaultColor` via `ColorToHsvDx11`, `MetalnessColorable`, texture changes per material `Location`). The bundled vanilla table has no `render`; models need the game source. Display names come from `Localization/MyTexts.resx` for vanilla. Mod names that are `DisplayName_*` keys fall back to the subtype.

Lookup order for a block: exact `Type/Subtype` in the active layers, then a subtype-only match that prefers the same grid size. Layers from low to high priority: bundled vanilla → game source(s) → selected mods, in source-list order (later sources override earlier ones).

Mod selection per blueprint: keys that are still unknown after vanilla/game are matched against the mod index (subtype → mods). Mods are picked greedily by how many unknown blocks they cover. The picked mods form "MODS IN THIS BLUEPRINT" and are on by default. Unchecking a mod turns its blocks into missing blocks. Blocks that no installed mod covers form one aggregate row, tagged `Not installed`. Its label: `Unresolved blocks`; meta: `<n> block types · <m> blocks`. Blueprints carry no mod list, so the real mod can't be named. The panel header then shows a "Missing blocks, click to view" button; it opens a dialog listing these block types (TypeId, SubtypeId, block count; `Picks.uncovered`).

Bundled vanilla table (`scripts/gen-vanilla.mjs`): reads `SE_GAME_ROOT` (default `C:\Program Files (x86)\Steam\steamapps\common\SpaceEngineers`) and writes `{ v: 1, blocks: [[type, subtype, large(0/1), sx, sy, sz, name], ...] }`. Keep the file small: drop the `MyObjectBuilder_` prefix, no indentation. Load it with a dynamic `import()` so it doesn't block the first paint.

Unknown blocks (no definition anywhere) are drawn as 1×1×1 placeholders in bright magenta `#ff2bd6` with an accent stroke and the diagonal cross. Missing-mode `Substitute` draws them as a plain block in their paint colour. `Hide` drops them.

### RenderModel

```ts
{
  name, gridLarge, dims: [x,y,z] /* main-grid cells */, lengthM, blockCount,
  boundsMin, boundsMax /* meters, main-grid space */,
  grids: Array<{ cell: 2.5 | 0.5, toMain: Float32Array(16), inst: ArrayBuffer /* 32 B per block */, count,
                 detail?: { def: Int32Array /* index into defs, -1 unknown */, orient: Uint8Array, hsv: Float32Array, skin: Uint16Array } }>
  defs?: DefRecord[]                    // definitions referenced by detail.def
  skins?: Array<SkinRecord | null>      // resolved ParsedBlueprint.skins
}
```

Instance layout (32 bytes, one interleaved VBO per grid): `min.xyz` f32 (cells), `size.xyz` f32 (cells, already rotated), `color` u32 RGBA8 (paint), `flags` u32 (bit0 missing-placeholder, bit1 modded, bit2 hidden, bit3 shrink to 0.96 = missing model in the reference pipeline). The extent is `Min .. Min + |R·(size−1)|` (`MySlimBlock.ComputeMax`), with `R` from `CreateWorld(0, Forward, Up)`.

## Renderer (three.js)

Two pipelines. With no block model loaded for the current model (no game source, or nothing cached yet) the box renderer below draws exactly as before. As soon as one model is available, the reference pipeline (next section) takes over, and blocks without a model are drawn as boxes inside it.

- One `InstancedBufferGeometry` per grid: a shared unit-cube (24 verts, 36 indices; face normal and face-local coordinate as attributes) plus one `InterleavedBuffer` (32 B/instance) exposed as `InterleavedBufferAttribute`s. One `Mesh` per grid under a `Group` whose matrix is `toMain`; `frustumCulled = false` or a correct bounding sphere. Model swap disposes geometries.
- One custom `ShaderMaterial` (GLSL3) shared by all grids, styles switched by uniform (no material per style, no recompiles on toggle):
  - Shaded: paint × lambert `0.52 + 0.48·dot(n, sun) + 0.05·n.y`, with the sun from the azimuth and a fixed elevation.
  - Clay: `#e2e2e5` with the same lambert.
  - Line: `#f2f2f3` fill and `rgba(89,128,166,.9)` 0.8 px edges.
  - Seams (`Block seams`): the block outline drawn in the shader from the face-local coordinate, anti-aliased with `fwidth`. Shaded uses `rgba(20,22,24,.28)` at 0.6 px. No line geometry.
  - Tint modded: `#94bce3`. Placeholder: magenta + cross + accent stroke.
- Section (main-grid cell layers): the vertex shader collapses an instance whose cell range lies wholly on the removed side. For subgrids it uses the block centre in main-grid space. Slice keeps `thick` layers. Flip inverts. X · Beam and Z · Keel count layers from the high end of the axis (`sectionCut` mirrors the position and the side), so the cut face looks toward the Iso camera; Y · Deck counts from the bottom. Highlight cut faces: on visible blocks that touch the last kept layer, faces whose normal points to the removed side mix 35 % toward accent-200, with `rgba(65,97,128,.85)` edges.
- Background: a fullscreen-triangle mesh with its own material, rendered first (`renderOrder`, `depthWrite false`); not `scene.background` (export tiles need it to follow the view offset). Gradients and the studio backdrops (drafting grid paper, hangar, steel, haze, transparent checker, custom top/bottom) are built in the shader. The procedural skies (Deep space, Planet orbit "In orbit", Nebula) stay, built from gradients and hashed stars; planets are not modelled. Real skyboxes: every `EnvironmentDefinition.EnvironmentTexture` in the game and in linked mods (mods without blocks count too), plus the vanilla seasonal swaps `BackgroundCube_ScaryFace`/`_Christmas` that `MyEnvironmentDefinition` substitutes for `BackgroundCube.dds`. After a game or mod source is linked the asset worker reads only one mip level of each face (≤ 1024², `File.slice`, so the 134 MB vanilla cube costs ~6 MB), keeps BC1/2/3/7 compressed and decodes other formats to RGBA (BC6H/HDR cubes are skipped), and caches it in IndexedDB (`skies` data, `skymeta` name/source/orientation/JPEG panorama thumbnail); "Caching skyboxes n/m" shows in the footer. The Scene tab lists cached skyboxes above the procedural ones (`bg = 'sky:<asset key>'`). The background shader (mode 7) builds the view ray from the perspective camera's rotation and FOV (also in ortho), then samples like `EnvAmbient.hlsli`: `dir = Rᵀ·ray`, `dir.z *= -1`, with `R = Ry(yaw)·Rx(pitch)·Rz(roll)` from `EnvironmentOrientation`; XML values are used as radians, as `MyOrientation.ToQuaternion` does (the default when the element is missing is the degree-converted `Defaults.EnvironmentOrientation`). Texels are written as stored (sRGB values, no tone mapping).
- Camera: free orbit around the bounds centre. Pitch is not clamped: dragging can go over the poles and spin forever; past the pole the horizontal drag direction flips so it keeps following the cursor, preset lerps take the shortest arc, and the readout shows the pitch wrapped to ±180°. Distance at zoom 1 frames the bounding sphere. The default projection is orthographic. Perspective FOV 35°. Orthographic half-height = radius × 1.1 / zoom. In Compose, an edit whose new bounding box has a corner outside the current frame triggers the Frame fit with damping; edits that stay inside, and shrinking, leave the camera alone. Opening a composition JSON frames the result (like the Frame button). Damping: k = min(1, dt·9). `iso` is the view direction `normalize(1, -0.75, 1.1)` (front-left). Uses three `PerspectiveCamera` / `OrthographicCamera`; export tiles use `camera.setViewOffset`.
- Axis gizmo, frame marks and export dimming go on a 2D overlay canvas above the GL canvas.
- `WebGLRenderer({ antialias: true, preserveDrawingBuffer: false })`, `setPixelRatio(devicePixelRatio)` + ResizeObserver, `outputColorSpace` set so the design hex colours come out exact (do the colour math in the shader in sRGB, or convert consistently — verify with a pixel probe). Exports render into `WebGLRenderTarget`s.

## Block models and textures (reference pipeline)

Render style is `Textured | Shaded | Clay | Line`. Textured = full material shading, Shaded = flat shading with paint colours, Clay / Line = the same shading with albedo `#e2e2e5` / paper `#f2f2f3` (glass stays tinted).

- Scene (`render/detail.ts`): a block with `render.model` is one instance at `(Min+Max)/2·cell + R·ModelOffset`. A block with topology and sides becomes one instance per cell and tile (`tile.LocalMatrix · R`, translation `cell·gridSize`) with the armor pattern UV offset. Tiles whose `FullQuad` (or Box) normal faces a full 1×1×1 Box-topology neighbour are moved to section-only instance groups: drawn only while a section is on and only where that neighbour is cut away, so cut faces close. Tile-table edges become deduplicated seam segments. Blocks whose model is still loading stay boxes; missing or uncached models become 0.96-scaled paint boxes (for armor this covers any side tile that is not loaded, so the block is never drawn as bare seam edges); unknown blocks keep the magenta placeholder. Instances are pre-multiplied into main-grid space (31 floats: rotation rows, translation, colour-mask HSV, packed paint, UV offset, section cell ranges of the block and of the culled neighbour, flags). One instanced geometry per (model, skin, part), materials per part.
- Shading (`render/detailShaders.ts`): flat = `0.42 + 0.58·lambert + 0.12·fill` on the face normal facing the viewer, lights `0.75 + 0.25·lambert`; textured = PBR in linear space (CM/ADD sampled as sRGB, NG linear; base colourized by ADD alpha reduced by metalness; normal map with per-triangle tangent frame from derivatives; `albedo = base·(1−metal)`, `f0 = mix(0.04, base, metal)`, roughness `1−gloss`; the `brdf` chunk is the single swap point: Lambert, GGX D, height-correlated Smith visibility, Schlick F, Toksvig-style alpha widening from the length of the filtered NG normal, Karis env-BRDF; two directional lights (key, fill) plus an analytic sky/ground hemisphere studio environment for diffuse and roughness-blurred specular, scaled by AO; emissive `base·e·k` on light parts; constants in `render/pbr.ts`; then exposure and tone `x·8/(1+7x)` per channel); missing maps use the game's default patterns, a part without CM/NG/ADD falls back to flat; alpha-masked parts clip at 0.5; `DECAL` parts blend by alphamask (pulled 3 cm toward the camera), `DECAL_CUTOUT` clips. Lighting is a camera-relative key `normalize(−dir·0.6 + up·0.75 − right·0.3)` and fill `normalize(−dir·0.3 − up·0.2 + right·0.8)`; the Sun azimuth slider rotates both about the camera's up axis by `azimuth − 40°`, so 40° is the neutral setting.
- Passes (`render/detailLayer.ts`): (1) g-buffer target (colour, packed normal with a seam mask in alpha, float depth texture) with models, decals and seam quads (1 output px wide, pulled `0.05·cell` toward the camera, multiplying the mask to 0); (2) depth min/max reduction (8×8 steps to 1×1, float targets); (3) composite target: background, then the composite pass (seam darkening `1 − 0.28·fade(cellPx)`, depth cue up to 30 % over the frame's depth range, ×0.55 at depth jumps over `0.14·cell`, ×0.8 at normal creases below 0.8; the Line style mixes these toward `rgba(89,128,166,.9)` instead) writing depth; glass as nearest surface only: depth pre-pass, then colour with `EQUAL` depth plus a stencil mark so coplanar inner/outer panes blend once (`GlassColor·(0.55 + 0.75·shade)` at 0.5 opacity); (4) box downsample to the canvas. The viewport renders at 2× device pixels (1× when `devicePixelRatio ≥ 2`). Export tiles run passes 1 and 3 at tile resolution with a 1 px overlap (so edges match across tiles), with the depth range measured once per export on a ≤1024 px full-frame render; the export SS setting is the supersampling.
- Assets: linking a source also sends its `.mwm` and `.dds` files to an asset worker, keyed `c:<path under Content>` or `m:<sourceId>/<folder>:<path>` (lower case). Lookups try the mod first, then Content; subparts load from the parent's folder with `Matrix.Normalize(dummy)`, `GeometryDataAsset` from the mod root then Content. Meshes and textures are built in the worker and cached in IndexedDB (`meshes`, `textures`, keyed by asset key, fingerprint `size|lastModified`). Textures are cached lazily, when a blueprint uses them. Models are cached eagerly (so switching blueprints after a reload needs no re-link): after a game or mod source is linked, the asset worker builds every block model its definitions reference (`Model` and the `Sides` of cube topologies, LOD0 only; the game is ~1.6k models) and the footer shows "Caching models n/m"; a mod definition pointing at a Content model is left to the game source. Textures are not cached eagerly: the game's block textures are 15+ GB. Files exist only for the session; after a reload cached assets render and the rest fall back to flat shading or boxes, with one toast per blueprint ("Textures missing: M textures · N models not cached · link the game folder again to load them"). Loading progress shows in the footer status ("Loading models n/m", "Loading textures n/m"). Textures go to the GPU at full resolution: BC1/2/3/7 stay compressed when `WEBGL_compressed_texture_s3tc(+_srgb)` / `EXT_texture_compression_bptc` exist and the mip chain is complete, otherwise they are decoded in the worker (with mips generated by 2×2 box filter). Sampling is bilinear within one mip level (`LinearMipmapNearest`). Skins come from the game and the enabled mods; a block's `SkinSubtypeId` swaps the textures of matching materials and its `DefaultColor` replaces the colouring key.
- Compose uses the same pipeline: voxels carry their block type and resolve to the game's armor definitions.

## Image export

The framed region (aspect from the export settings) is rendered offscreen at resolution × SS. Total pixels are capped at 64 MP (halve SS until it fits). Tiles are at most min(4096, MAX_RENDERBUFFER_SIZE), each via `camera.setViewOffset`. Tiles go through `readRenderTargetPixels` into a 2D canvas (flipped), the canvas is downsampled in halving steps with `imageSmoothingQuality = 'high'`, and `toBlob(type, 0.92)`. Transparent PNG skips the background pass with clear alpha 0. The file name expands `{blueprint}`, `{view}` and `{date}`. All file exports are plain downloads (no File System Access writes). Clipboard copy uses `ClipboardItem` with a PNG. Turntable renders 36 frames at 10° yaw steps into a store-only zip download.

## Compose

`compose/csg.ts` semantics: top → bottom, add/subtract/intersect, inside tests, bounds = union of add AABBs + 1, capped at 160. Wall hollowing: instead of testing a uniformly shrunk inner shape (which leaves holes on slopes and stretched curves), a shape with Wall k keeps the solid voxels that have an empty voxel within Euclidean distance k (squared distance from three separable 1D passes over the shape's own box, padded by one and clipped to the grid ± k+1). With k = 1 this is every voxel with an empty face neighbour, so walls are always closed. Output: a `Uint8Array` voxel grid (0 = empty, otherwise 1 + block-type index) plus dims. Shapes: Box, Sphere, Cylinder, Ellipsoid, Torus (Size X/Z = outer diameter, Size Y = ring height, Tube = tube width; the ring centre line follows the outer ellipse inset by half the tube; Wall hollows the tube) and Pyramid (square base at −Y tapering to the apex at +Y within the Size box; named Pyramid, not prism). Only these two can be turned, in 90° steps about world X/Y/Z (`rot`, an integer 3×3 matrix composed per click, Reset back to identity); voxels are tested in the shape's local frame (`Rᵀ·(p − pos)`) and the add AABB uses the rotated extent. It runs in the worker. Edits are debounced to one in-flight job: the latest edit wins and stale results are dropped. The result becomes a RenderModel with the default paint. Block types: Light Armor, Heavy Armor, Interior Wall. When add shapes overlap, the earlier shape in the stack keeps its block type for the overlapping voxels. `se/sbcWrite.ts` writes the bp.sbc, which is downloaded as `bp.sbc`. Below the export button the panel always shows block count and estimated file size (`estimateSbcBytes`: header and footer plus per-block-type line length with average coordinate digits, within 1 % of the real file); above 50,000 blocks it also shows a warning, and above 1,000,000 blocks the export is refused. Interior Wall subtypes: `LargeBlockInteriorWall` (large) and no small variant. When a small-grid composition uses Interior Wall, export fails with a toast. All shapes start collapsed. The open (selected) shape is tinted green: the worker gets the selected index, flags final voxels inside that shape with `FLAG_SELECTED` (16) on their instance, and the box, reference-box and model shaders mix in the tint while `u_sel` is on; image export turns it off. Save JSON / Open JSON write and read the stack as a `drydock-composition` file (version 1: name, grid, and per shape op, type, size, pos, block, shell, tube, rot, one shape per line); `compose/file.ts` validates every field and a file from a newer version is refused. Opening replaces the stack, grid and name.

## Sources

Kinds: `game | workshop | torch | mods | blueprints`. Five link cards in the dialog: Game, Workshop, Torch, Mods, Blueprints ("Blueprints folder (local)", the `%AppData%\SpaceEngineers\Blueprints` folder).

- One code path for every kind: `<input type="file" webkitdirectory>` created on click. No File System Access API, no stored directory handles, no permission flow. The file list is filtered on the main thread to `.sbc`, `.resx` and `modinfo.sbmi` and sent to the worker (`.mwm` and `.dds` go to the asset worker, see the reference pipeline), which rebuilds a directory tree from `webkitRelativePath` (`treeFromFiles`) and runs the scan over it. A browser upload confirmation ("Upload N files") is expected.
- Status: as soon as the input is clicked the footer and the dialog show "Waiting for browser to list files…" (the `cancel` event clears it). On `change` it becomes "Reading file list… N files", then real progress from the worker with a progress bar ("Building file index…", "Parsing definitions 50/176", "Reading blueprints 12/196", "Indexing mods 37/196", "Saving snapshot…", "Caching blueprints 12/58").
- `game`: accepts the SE root or its `Content` folder. If `Content/Data` is missing, a toast warns and the source is added anyway. Scan `Content/Data/**/*.sbc`, skipping `Prefabs, Scenarios, PlanetDataFiles, Localization, Blueprints, CustomWorlds`, and keep only files containing `<CubeBlocks`. Parse `Localization/MyTexts.resx` for names.
- `workshop`: each subfolder `<id>` with `bp.sbc` is a workshop blueprint. One with `Data/` is a mod. Legacy `.bin`/`.sbm` zip mods are not read (phase 2).
- `torch`: find `content/244850` or `Instance/content/244850` under the picked folder and treat it like `workshop` (mods only).
- `mods`: subfolders with `Data/` are mods, named by folder.
- `blueprints`: `local/` under the pick (or the pick itself) -> subfolders with `bp.sbc`.
- Mod indexing (CubeBlocks, skins and environment skyboxes) runs in the worker. Per-mod cache in IndexedDB keyed by `<sourceId>/<folder>`, fingerprint = hash of the sorted `relative path|size|lastModified` lines of its `.sbc` files, taken from the upload's file list (no file reads). Unchanged mods come from the cache, changed ones are re-parsed, vanished ones are pruned.
- A source id is stable: adding a folder with the same kind and folder name as an existing source refreshes that source (same id, same cache keys).
- Blueprint list entries: the name comes from `Id Subtype` (first 4 KB), the grid size from the first `GridSizeEnum` (first 64 KB; Large if not found). Meta is `Large grid · <file size>`, then `Large grid · <n> mods` from the `bpmeta` cache once opened.
- List meta: `<Large|Small> grid · <n> mods` or `· vanilla`. The mod count comes from the `bpmeta` cache, or is filled in the background on the main thread by running `pickMods` over each cached parsed blueprint (`actions.fillMods`, after restore and after caching). Until then a row shows only `<grid> grid`.
- Copy: `Link folders`, `N sources linked`; a source restored from a snapshot counts as linked.
- Kind cannot be changed after adding (it would need a new upload); the dialog shows a kind tag instead of the retype control.
- Drag & drop: a `bp.sbc` file, or a folder via `DataTransferItem.getAsFileSystemHandle()` read once. Without File System Access (Firefox), file inputs still work.

## Snapshot cache

Goal: the app starts with everything it learned from earlier uploads, without an upload. IndexedDB `drydock` v4 (the v2 → v3 → v4 upgrades only add stores):

- `sources`: `{ id, name, kind, when, note }` per source (what the dialog lists: "Snapshot from <date>", file/blueprint/mod counts, scan time).
- `snap`: per source id, the scan result: game definition tuples, blueprint list metadata (without `File`), mod list (`key, name, folder, subs`).
- `mods`: per-mod `{ fp, name, subs, defs }`, loaded lazily by key when a blueprint resolves.
- `bps`: per blueprint `<sourceId>/<folder>` -> `{ fp: "<size>|<lastModified>", v, parsed: ParsedBlueprint }` (typed arrays + string table, no XML). `v` is the parser version (2 adds `SkinSubtypeId`); older entries still open, and the next refresh re-parses them.
- `bpmeta`: opened-blueprint mod counts for the list meta.
- `meshes`, `textures`: processed block models and texture levels by asset key (see the reference pipeline); a source's `m:<id>/` entries are dropped when it is unlinked.
- `skies`, `skymeta`: cached skybox faces and their list entries by asset key (see Background); dropped with the source like meshes.

Flow: after a scan the worker writes `snap` and prunes removed mods, the list is shown, then the worker parses every blueprint in the background (sequentially, "Caching blueprints n/m") and stores it; blueprints whose `size|lastModified` is unchanged are reused, removed ones are dropped. On startup `restoreSources()` reads `sources` and `snap`, publishes list and definitions at once (`body.dataset.snapshot = '1'`); opening an entry reads `bps` (when the fingerprint matches the list entry) instead of parsing. Refresh = pick the folder again from the row; it replaces that source's snapshot. Dropped files and `?bp` are never cached. Storage failures (quota) show a toast and the session continues from memory; entries without a cached parse fall back to their `File` while the page is open.

## Test seams

- `?bp=<url>` loads a bp.sbc by URL on start, through the same path as a drop. Vite dev serves repo files under `/@fs/`.
- `?view=iso|front|side|top|rear`, `?style=textured|shaded|clay|line` and `?w=..&h=..` exist for screenshot scripts.
- `scripts/shot.mjs <url> <out.png>` drives `playwright-core` with `channel: 'msedge'` and waits for `document.body.dataset.ready === '1'`, which the app sets after the first frame of a loaded model.
- `test/blueprint.test.ts` checks parsed block counts against every `<dir>/*/bp.sbc` under `DRYDOCK_BP_DIR`; `test/assets.test.ts` reads game files from `SE_GAME_ROOT`. Both are skipped when the folders are missing.
