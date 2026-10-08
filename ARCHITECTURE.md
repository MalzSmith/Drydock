# Drydock architecture

Static, framework-free browser app: Vite + TypeScript, three.js (WebGL2), Web Workers, IndexedDB.

## Principles

- **One runtime code dependency: `three`** (named ES imports only, so it tree-shakes; no `three/examples` controls, the orbit camera is ours). The other runtime dependencies are the self-hosted Barlow and Barlow Condensed fonts (`@fontsource/*`), Latin only: Cyrillic and Chinese fall back to system fonts through `:lang()` overrides of the font tokens in `industry.css`. Dev dependencies: `vite`, `typescript`, `vitest`, `@types/node`, `@types/three`, `playwright-core` (screenshots only, drives the installed Edge).
- **Build the DOM once, patch it on state change.** There is no virtual DOM, and no panel is re-rendered wholesale through innerHTML on a state change. A list rebuilds its rows only when its own data changes.
- **Render on demand.** The GL loop runs only while something animates (camera lerp, drag, turntable). Otherwise a state change draws one frame.
- **Heavy work goes in workers.** Blueprint parsing, source scanning, CSG voxelizing and asset building never block the UI.
- **Performance targets:** first paint < 100 ms; JS bundle < 200 kB gzip without data (three included); a 10k-block bp.sbc goes from drop to frame in < 300 ms; a 105k-block / 54 MB bp.sbc in < 2.5 s; 60 fps orbit at 105k blocks with boxes. With block models every block draws its LOD0 mesh (no LOD switching), so the model frame rate on huge ships is whatever the GPU manages; measured: 88 fps for a 105k-block ship at 1600×1000 with 2× SS.

## Layout

```
drydock/
  index.html                 app shell markup (static skeleton) + the narrow-window notice (inline script flags windows narrower than 1120 px)
  vite.config.ts             base './', worker.format 'es'
  public/count.js            modified GoatCounter counter script (see Visit counter)
  public/THIRD_PARTY_NOTICES.txt  licence notices, copied to the site root by the build
  scripts/gen-vanilla.mjs    game Content -> src/data/vanilla-blocks.json (committed)
  scripts/gen-tiles/         dotnet tool: loads Sandbox.Game.dll from SE_GAME_ROOT/Bin64, reads MyCubeGridDefinitions.GetTopologyInfo (tiles with Id, edges), GetTopologyUniqueOrientation for all 24 orientations and TileGridOrientations -> src/data/tile-table.json v2 (committed)
  scripts/shot.mjs           playwright-core + msedge: screenshots of the built app
  src/
    main.ts                  entry: loads app.ts, or waits for "Continue anyway" when index.html flagged a window narrower than 1120 px
    i18n.ts                  locales (en, de, ru, zh-Hans, zh-Hant): browser detection, drydock.lang setting, lazy JSON chunks (en bundled as fallback), tr() with plurals and {params}, Intl number formats
    locales/*.json           one string tree per locale; index.html inlines the narrow.* strings
    app.ts                   bootstrap: store, UI mounts, renderer, drop handler, restore sources, URL parameters, tour and counter start, window.__drydock
    styles/industry.css      design system styles
    styles/app.css           app layout
    state/store.ts           tiny store: get / set / watch(selector, cb)
    state/app.ts             AppState type, initial state, actions
    state/derive.ts          display strings derived from state (title, dims, caption, block count, mod summary, source status)
    ui/dom.ts                h(tag, props, ...children), icon(name, size), corners(), seg, check, kicker, text, progressBar, t/tAttr/tRich (text and attributes that follow the locale)
    ui/langMenu.ts           header language button and menu
    ui/icons.ts              inline Lucide path data (box, folder, download, search, scissors, rotate-cw, maximize, x, check, chevron-down, languages, circle-help)
    ui/nav.ts  ui/footer.ts  ui/blueprintPanel.ts  ui/composePanel.ts
    ui/viewport.ts           canvas host, overlay canvas (gizmo, frame marks, dim), top controls, caption, readout, toast
    ui/right/view.ts  ui/right/section.ts  ui/right/scene.ts  ui/right/export.ts  ui/right/tabs.ts
    ui/sourcesDialog.ts  ui/missingDialog.ts
    ui/tour.ts               welcome card with the counter opt-out, and the feature tour
    se/xml.ts                minimal fast XML tokenizer (definition files, small docs)
    se/blueprint.ts          targeted bp.sbc scanner -> ParsedBlueprint (no generic tree)
    se/orient.ts             Base6, CreateWorld(forward, up), rotated block extent (ComputeMax)
    se/color.ts              paintColor(hsv) (TextureValue 0.85)
    se/defs.ts               DefRegistry + resolveBlueprint() (vanilla/game/mods, mod selection)
    se/sbcWrite.ts           voxel grid -> bp.sbc text
    se/mods.ts               mod index (subtype -> mods) and pickMods()
    se/env.ts                EnvironmentDefinition skybox paths and orientations, vanilla and seasonal skybox paths
    sources/idb.ts           IndexedDB wrapper (source meta, snapshots, mod caches, parsed blueprints, assets, skybox list entries)
    sources/sources.ts       folder picker input, scan orchestration, snapshot restore, unlink
    sources/fs.ts            directory tree over the uploaded file list, .sbc walker, game/workshop/blueprints root finders
    sources/scan.ts          scanGame, scanBlueprints, scanMods (mod indexing), scanSource
    sources/drop.ts          drag and drop of a bp.sbc or a blueprint folder
    compose/csg.ts           shape stack -> voxels (pure, used inside the worker)
    compose/blocks.ts        Compose block types and their large/small subtypes
    compose/file.ts          composition JSON read/write
    workers/work.worker.ts   one worker module: parseBlueprint, scanSource, cacheBlueprints, voxelize, writeBlueprint, and the asset calls (registerAssets, cacheModels, indexSkies, loadMesh, loadTexture, loadSky)
    workers/client.ts        four lazily started instances of that module: parse, scan, compose, assets
    workers/rpc.ts           promise RPC over postMessage with transferables and progress events; workers can also request values from the main thread (`request`)
    render/renderer.ts       three WebGLRenderer + Scene; setModel, setOptions, draw(target), on-demand loop, export tiles
    render/camera.ts         orbit camera, presets + damped lerp, persp/ortho, centre of mass, fit
    render/shaders.ts        GLSL of the box renderer and the background (gradients, studio backdrops, procedural skies, skyboxes)
    render/sky.ts            skybox data -> three cube texture
    render/exportImage.ts    tiled offscreen render, supersample downsample, encode, clipboard, turntable
    render/cube.ts           unit cube + per-grid box instancing
    render/detail.ts         RenderModel + meshes + tile table -> model/tile instances, fallback boxes, seam edges (pure)
    render/detailLayer.ts    reference pipeline: materials, g-buffer, composite, glass, downsample, export tiles
    render/detailShaders.ts  GLSL of the reference pipeline
    render/pbr.ts            linear RGB light, environment, emissive, exposure and glass constants (diffuse scale, fallback materials) of the Textured PBR shading
    render/assets.ts         main-thread mesh/texture registry: worker requests, three textures and attributes, time-budgeted texture uploads
    assets/files.ts          main-thread map of asset keys to the session's `File`s, served to the asset worker on request
    assets/keys.ts           upload paths -> asset keys (c:<content path>, m:<mod key>:<path>), lookup candidates
    assets/build.ts          worker side: MWM -> mesh (subparts, geometry assets), DDS -> texture levels, IDB cache
    assets/material.ts       material classification and fixed colours
    assets/sky.ts            worker side: skybox faces and mip chains from DDS, thumbnails, sky orientation matrix
    se/mwm.ts  se/dds.ts     MWM reader, DDS reader + BC1-5/BC7 decoders
    se/tiles.ts              tile table loader + armor pattern offset
    util/zip.ts              store-only zip writer (turntable frames)
    util/save.ts             download(blob, name): every file export is a browser download
    util/count.ts            visit counter opt-out and loader
    data/vanilla-blocks.json
    data/tile-table.json
  test/                      vitest: asset keys, blueprint parser, pilot block, paint colour, orient, csg and sbcWrite round trip, composition files, fit, detail, glass, scan and pickMods, skyboxes, zip
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

`watch` calls `cb` once immediately with the current value.

`AppState`: mode, bp, the loaded and composed model info and their version counters, the blueprint list (entries, pinned, listSource, search), mod rows and toggles, unknown blocks and the missing-blocks dialog, scan and asset progress text, tab, render, section, scene, skies, export, compose, sources, srcOpen, tour, toast, busy, spin, preset. Camera yaw/pitch/zoom live in the renderer's view (`render/camera.ts` helpers) and are mutated per frame, not stored. UI modules read state and call actions from `state/app.ts`; `sources/sources.ts` and `render/exportImage.ts` also set their own progress, source list and busy fields directly. Actions talk to the workers and the renderer.

## Data flow

```
drop / list click / ?bp=<url>
  -> worker.parseBlueprint(ArrayBuffer | File)           -> ParsedBlueprint (typed arrays + string table)
  -> mods.pickMods(parsed, lookup, modIndex)            -> mod rows + uncovered block types
  -> defs.resolveBlueprint(parsed, lookup, missingMode, labels, skinOf) -> RenderModel + table rows
  -> renderer.setModel(model)
mod checkbox / missing-mode -> resolve again on the main thread (no re-parse)
tint toggle -> renderer uniform
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

Grids are sorted by block count (× 125 for large). Grid 0 is the main grid. Orientation follows the pilot block of the main grid: the block with `IsMainCockpit`, else the first Cockpit whose subtype contains `Cockpit`, else the first Cockpit that is not a passenger seat, bed, toilet, couch, bathroom or desk, else the first RemoteControl (`ParsedGrid.pilot`). `resolveBlueprint` multiplies every grid's `toMain` by the inverse of that block's `CreateWorld(0, Forward, Up)`, so the pilot faces −Z with +Y up; dims, length, section axes, presets and fit all use this frame. Without a pilot block the grid axes are used. Only `Cockpit` and `RemoteControl` blocks count, so an `IsMainCockpit` inside a projector's stored blueprint is ignored. `PARSE_VERSION` 3 adds `pilot`; older cached parses are re-read from the file when it is available, otherwise the pilot is derived from their block list without the main-cockpit flag until the source is refreshed. `PARSE_VERSION` 4 reads the subtype only from a direct child `SubtypeName` / `SubtypeId` of the block; a self-closing `<SubtypeName />` is the empty subtype (vanilla Gatling Turret, O2/H2 Generator, Gravity Generator), never a `SubtypeName` from the block's inventory or components. Every grid is drawn in main-grid space through `inverse(main.world) * grid.world`. The scanner is a hand-written indexOf/charCode loop over the decoded text. It handles `xsi:type`, `SubtypeName`/`SubtypeId`, `Min` attributes, `BlockOrientation` attributes or children, `ColorMaskHSV`, and nested `CubeBlocks` that aren't the grid's (for example inside ComponentContainer or toolbar data, which never contain `<MyObjectBuilder_CubeBlock`). `.sbcB5` is not supported. When a folder has both files, use `bp.sbc`.

### Definitions

`DefRecord = { type, subtype, large, size: [x,y,z], name, source, render? }`, where `source` = 'vanilla' (bundled), 'game', or a mod key. Parsing: `Id` as attribute or child, `CubeSize`, and `Size` as attributes, at least 1. `render` holds `Model`, `ModelOffset`, and, when `BlockTopology` is `Cube` or there is no model, the `CubeTopology` index and the `Sides` (`Model`, `PatternWidth/Height`, `ScaleTileU/V`); paths are lower-cased with `/` separators. `TransparentMaterial` definitions are kept as glass materials (`GlassDef`: texture paths normalised like render paths, `Color` default 1,1,1,1, `ColorAdd` 0, numbers 0, `LightMultiplier` X as `light`, default 1). `AssetModifier` definitions become skins (`DefaultColor` via `ColorToHsvDx11`, `MetalnessColorable`, texture changes per material `Location`). The bundled vanilla table has no `render`; models need the game source. Display names come from `Localization/MyTexts.resx` for vanilla. Mod names that are `DisplayName_*` keys fall back to the subtype.

Lookup order for a block: exact `Type/Subtype` in the active layers, then a subtype-only match that prefers the same grid size. Layers from low to high priority: bundled vanilla → game source(s) → selected mods, in source-list order (later sources override earlier ones).

Mod selection per blueprint: keys that are still unknown after vanilla/game are matched against the mod index (subtype → mods). Mods are picked greedily by how many unknown blocks they cover. The picked mods form "MODS IN THIS BLUEPRINT" and are on by default. Unchecking a mod turns its blocks into missing blocks. Blocks that no installed mod covers form one aggregate row, tagged `Not installed`. Its label: `Unresolved blocks`; meta: `<n> block types · <m> blocks`. Blueprints carry no mod list, so the real mod can't be named. The panel header then shows a "Missing blocks, click to view" button; it opens a dialog listing these block types (TypeId, SubtypeId, block count; `Picks.uncovered`).

Bundled vanilla table (`scripts/gen-vanilla.mjs`): reads `SE_GAME_ROOT` (default `C:\Program Files (x86)\Steam\steamapps\common\SpaceEngineers`) and writes `{ v: 1, blocks: [[type, subtype, large(0/1), sx, sy, sz, name], ...] }`. Keep the file small: drop the `MyObjectBuilder_` prefix, no indentation. Load it with a dynamic `import()` so it doesn't block the first paint.

Unknown blocks (no definition anywhere) are drawn as 1×1×1 placeholders in bright magenta `#ff2bd6` with an accent stroke and the diagonal cross. Missing-mode `Substitute` draws them as a plain block in their paint colour. `Hide` drops them.

### RenderModel

```ts
{
  name, gridLarge, dims: [x,y,z] /* main-grid cells */, lengthM, cellMin, mainCell, blockCount,
  boundsMin, boundsMax /* meters, main-grid space */,
  grids: Array<{ cell: 2.5 | 0.5, toMain: Float32Array(16), inst: ArrayBuffer /* 32 B per block */, count,
                 detail?: { def: Int32Array /* index into defs, -1 unknown */, orient: Uint8Array, hsv: Float32Array, skin: Uint16Array } }>
  defs?: DefRecord[]                    // definitions referenced by detail.def
  skins?: Array<SkinRecord | null>      // resolved ParsedBlueprint.skins
  glass?: Record<string, GlassRecord>   // transparent materials by lower-case subtype: game, then enabled mods (later overrides)
}
```

Instance layout (32 bytes, one interleaved VBO per grid): `min.xyz` f32 (cells), `size.xyz` f32 (cells, already rotated), `color` u32 RGBA8 (paint), `flags` u32 (bit0 missing-placeholder, bit1 modded, bit2 hidden, bit3 shrink to 0.96 = missing model in the reference pipeline). The extent is `Min .. Min + |R·(size−1)|` (`MySlimBlock.ComputeMax`), with `R` from `CreateWorld(0, Forward, Up)`.

## Renderer (three.js)

Two pipelines. With no block model loaded for the current model (no game source, or nothing cached yet) the box renderer below draws the blocks. As soon as one model is available, the reference pipeline (next section) takes over, and blocks without a model are drawn as boxes inside it.

- One `InstancedBufferGeometry` per grid: a shared unit-cube (24 verts, 36 indices; face normal and face-local coordinate as attributes) plus one `InterleavedBuffer` (32 B/instance) exposed as `InterleavedBufferAttribute`s. One `Mesh` per grid under a `Group` whose matrix is `toMain`; `frustumCulled = false`. Model swap disposes geometries.
- One custom `ShaderMaterial` (GLSL3, `render/shaders.ts`) shared by all grids, styles switched by uniform (no material per style, no recompiles on toggle):
  - Shaded: paint × lambert `0.52 + 0.48·dot(n, sun) + 0.05·n.y`, with the sun from the azimuth and a fixed elevation.
  - Clay: `#e2e2e5` with the same lambert.
  - Line: `#f2f2f3` fill × `0.93 + 0.07·lambert` and `rgba(89,128,166,.9)` 1 px edges.
  - Seams (`Block seams`): the block outline drawn in the shader from the face-local coordinate, anti-aliased with `fwidth`, `rgba(20,22,24,.28)` at 1.5 px, faded out as cells get smaller than about 7 px. No line geometry.
  - Tint modded: `#94bce3`. Placeholder: magenta + cross + 1.2 px accent stroke. The selected Compose shape mixes 30 % toward green.
- Section (main-grid cell layers): the vertex shader collapses an instance whose cell range lies wholly on the removed side. For subgrids it uses the block centre in main-grid space. Slice keeps `thick` layers. Flip inverts. X · Beam and Z · Keel count layers from the high end of the axis (`sectionCut` mirrors the position and the side), so the cut face looks toward the Iso camera; Y · Deck counts from the bottom. Highlight cut faces: on visible blocks that touch the last kept layer, faces whose normal points to the removed side mix 35 % toward accent-200, with `rgba(65,97,128,.85)` 1.5 px edges.
- Background: a fullscreen-triangle mesh with its own material, rendered first (`renderOrder`, `depthWrite false`); not `scene.background` (export tiles need it to follow the view offset). Gradients and the studio backdrops (Drafting grid paper, Hangar, Steel, Haze, Transparent checker, Custom top/bottom) are built in the shader. The procedural skies (Deep space, Planet orbit, Nebula field) are built from colour blobs and hashed stars; Planet orbit adds a flat planet disc with a rim. Real skyboxes: every `EnvironmentDefinition.EnvironmentTexture` in the game and in linked mods (mods without blocks count too), plus the vanilla seasonal swaps `BackgroundCube_ScaryFace`/`_Christmas` that `MyEnvironmentDefinition` substitutes for `BackgroundCube.dds`. Skybox images are never cached. After a game or mod source is linked the asset worker stores only a list entry per skybox in IndexedDB (`skymeta`: name, source, orientation, `size|lastModified`, JPEG panorama thumbnail made from the 64² mip level); "Indexing skyboxes n/m" shows in the footer. The Scene tab lists them above the procedural ones (`bg = 'sky:<asset key>'`); vanilla entries whose file is not linked in this session are greyed out with a hint to link the game folder, mod entries without a linked file are left out of the list, and a selected sky whose file goes away falls back to Deep space. Selecting one makes the worker read the DDS from the session `File` at full resolution (capped at `MAX_CUBE_MAP_TEXTURE_SIZE`) with its whole mip chain; BC1/2/3/7 with a complete chain stay compressed when the GPU supports them, everything else is decoded to RGBA with mips from a 2×2 box filter (BC6H/HDR cubes are skipped). Sampling is trilinear. The background shader (mode 7) builds the view ray from the perspective camera's rotation and FOV (also in ortho), then samples like `EnvAmbient.hlsli`: `dir = Rᵀ·ray`, `dir.z *= -1`, with `R = Ry(yaw)·Rx(pitch)·Rz(roll)` from `EnvironmentOrientation`; XML values are used as radians, as `MyOrientation.ToQuaternion` does (the default when the element is missing is the degree-converted `Defaults.EnvironmentOrientation`). Texels are written as stored (sRGB values, no tone mapping).
- Camera: free orbit around the centre of mass (every block of every grid weighs 1, block centre in main-grid space; `centerOfMass` in `render/camera.ts`); the camera always looks at it, so a long or lopsided ship turns about its bulk rather than an AABB corner. The radius used for near/far is the farthest AABB corner from that point. Pitch is not clamped: dragging can go over the poles and spin forever; past the pole the horizontal drag direction flips so it keeps following the cursor, preset lerps take the shortest arc, and the readout shows the pitch wrapped to ±180°. Distance at zoom 1 (`computeFit`) is the smallest one at which every block fits inside `FIT_FILL` of the frame around the centre of mass for the current view direction; there is no off-centre framing shift. Right-drag pans: it moves the orbit centre in the camera plane (`pan`, world units per pixel from the current fit, zoom and frame height), so the view then turns about the new point; Frame, the presets, double-click and every refit (blueprint load, mod toggles, Compose framing) reset it to the centre of mass. Moving the camera by hand (orbit drag, pan, wheel zoom) clears the selected preset, so clicking the same preset again returns to it. The default projection is orthographic. Perspective FOV 35°. Orthographic half-height = the fit's half-height (largest projected block extent around the centre of mass / `FIT_FILL`) / zoom. Zoom is clamped to 0.3–6. In Compose, an edit whose new bounding box has a corner outside the current frame triggers the Frame fit with damping; edits that stay inside, and shrinking, leave the camera alone. Opening a composition JSON frames the result (like the Frame button). Damping: k = min(1, dt·9). `iso` is the view direction `normalize(1, -0.75, 1.1)` (front-left). Uses three `PerspectiveCamera` / `OrthographicCamera`; export tiles use `camera.setViewOffset`.
- Axis gizmo, frame marks and export dimming go on a 2D overlay canvas above the GL canvas.
- `WebGLRenderer({ antialias: true, preserveDrawingBuffer: false })`, `setPixelRatio(devicePixelRatio)` from a ResizeObserver in `ui/viewport.ts`. The box and background shaders do their colour math in sRGB and write the design hex colours directly. Exports render into `WebGLRenderTarget`s.

## Block models and textures (reference pipeline)

Render style is `Textured | Shaded | Clay | Line`. Textured = full material shading, Shaded = flat shading with paint colours, Clay / Line = the same shading with albedo `#e2e2e5` / paper `#f2f2f3` (glass stays tinted).

- Scene (`render/detail.ts`): a block with `render.model` is one instance at `(Min+Max)/2·cell + R·ModelOffset`. A block with topology and sides becomes one instance per cell and tile with the armor pattern UV offset, built like `MyCubeGrid.GetCubeParts` with `topologyCheck`: `R` is first replaced by the topology's unique orientation (`uniq`, e.g. every Box is identity), the tile normal is rotated by it, a tile with an `Id` (`Square`, `Slope`) whose rotated normal signs match a `TileGridOrientations` entry uses that entry's fixed matrix, otherwise `tile.LocalMatrix · R`; translation `cell·gridSize`. Tiles whose `FullQuad` (or Box) normal faces a full 1×1×1 Box-topology neighbour are moved to section-only instance groups: drawn only while a section is on and only where that neighbour is cut away, so cut faces close. Tile-table edges become deduplicated seam segments. Blocks whose model is still loading stay boxes; missing or uncached models become 0.96-scaled paint boxes (for armor this covers any side tile that is not loaded, so the block is never drawn as bare seam edges); unknown blocks keep the magenta placeholder. Instances are pre-multiplied into main-grid space (31 floats: rotation rows, translation, colour-mask HSV, packed paint, UV offset, section cell ranges of the block and of the culled neighbour, flags). One instanced geometry per (model, skin, part), materials per part.
- Shading (`render/detailShaders.ts`): flat = `0.42 + 0.58·lambert + 0.12·fill` on the face normal facing the viewer, lights `0.75 + 0.25·lambert`; textured = PBR in linear space (CM/ADD sampled as sRGB, NG linear; base colourized by ADD alpha reduced by metalness; normal map with per-triangle tangent frame from derivatives; `albedo = base·(1−metal)`, `f0 = mix(0.04, base, metal)`, roughness `1−gloss`; the `brdf` chunk is the single swap point: Lambert, GGX D, height-correlated Smith visibility, Schlick F, Toksvig-style alpha widening from the length of the filtered NG normal, Karis env-BRDF; two directional lights (key, fill) plus an analytic sky/ground hemisphere studio environment for diffuse and roughness-blurred specular, scaled by AO; emissive `base·e·k` on light parts; constants in `render/pbr.ts`, calibrated against in-game screenshots of a painted ship with lamps off (lit areas match; shadows deliberately lighter than the game), read every frame so `window.__drydock.pbr` can be edited live; then exposure `PBR.exposure · 2^EV` (View tab Exposure slider, −2…+2 EV in 0.1 steps, double-click resets, shown only for Textured) and the ACES filmic fit (Narkowicz) per channel); missing maps use the game's default patterns, a part without CM/NG/ADD falls back to flat; alpha-masked parts clip at 0.5; `DECAL` parts blend by alphamask (pulled 3 cm toward the camera), `DECAL_CUTOUT` clips. Lighting is a camera-relative key `normalize(−dir·0.6 + up·0.75 − right·0.3)` and fill `normalize(−dir·0.3 − up·0.2 + right·0.8)`; the Sun azimuth slider rotates both about the camera's up axis by `azimuth − 40°`, so 40° is the neutral setting. Scene tab Lighting `Directional | Uniform` (`scene.lighting`): Uniform is for technical shots: no key or fill, the same ambient `PBR.uniform` from every direction (Textured), a constant 0.85 flat shade (Shaded / Clay / Line), the depth cue and outlines stay on in Textured, and the Sun azimuth slider is hidden. The box renderer (no models loaded) ignores it.
- Passes (`render/detailLayer.ts`): (1) g-buffer target (colour, packed normal with a seam mask in alpha, float depth texture) with models, decals and seam quads (1 output px wide, pulled `0.05·cell` toward the camera, multiplying the mask to 0); (2) depth min/max reduction (8×8 steps to 1×1, float targets); (3) composite target: background, then the composite pass (seam darkening `1 − 0.28·fade(cellPx)`, depth cue up to 30 % over the frame's depth range, ×0.55 at depth jumps over `0.14·cell`, ×0.8 at normal creases below 0.8; the depth cue and both edge terms are off in Textured with Directional lighting (`u_refLook`) so it looks like the game, while the seam darkening stays; the Line style mixes these toward `rgba(89,128,166,.9)` instead) writing depth; glass as nearest visible surface only: depth pre-pass, then colour with `EQUAL` depth plus a stencil mark so coplanar inner/outer panes blend once, premultiplied blending (`One, OneMinusSrcAlpha`). Both passes use one fragment shader that discards a pane whose interpolated vertex normal faces away from the viewer (normal-based, not winding-based; the materials stay `DoubleSide`), so each of the two coincident panes of a window shows from its own side only. Textured glass is shaded from the part's transparent material (`rgb = diffuse·cover + colorAdd.rgb + spec·w`, `cover = clamp(Color.a·tex.a + ColorAdd.a)`, `w = clamp(Reflectivity + Fresnel·(1 − N·V)^5)`, alpha `max(cover, w)`, gloss = gloss-texture alpha + `GlossTextureAdd`, diffuse scaled by `light · PBR.glassDiffuse`, reflections of a near-black space hemisphere `PBR.glassSky/glassGround` instead of the studio env; the colour is tone-mapped un-premultiplied (`rgb/alpha`) and premultiplied afterwards, so faint reflections don't get the tone curve's low-end gain on top of what's behind); Shaded / Clay / Line keep the flat tint `(0.17,0.22,0.28)·(0.55 + 0.75·shade)` at 0.5 opacity (0.15 for inside panes); (4) box downsample to the canvas. The viewport renders at 2× device pixels (1× when `devicePixelRatio ≥ 2`). Export tiles run passes 1 and 3 at tile resolution with a 1 px overlap (so edges match across tiles), with the depth range measured once per export on a ≤1024 px full-frame render; the export SS setting is the supersampling.
- Assets: linking a source registers its `.mwm` and `.dds` files with the asset worker, keyed `c:<path under Content>` or `m:<sourceId>/<folder>:<path>` (lower case). Only the keys are sent to the worker; the `File`s stay on the main thread (`assets/files.ts`) and the worker requests each one when it reads it, because cloning tens of thousands of `File`s in one message blocks the main thread for seconds. Lookups try the mod first, then Content; subparts load from the parent's folder with `Matrix.Normalize(dummy)`, `GeometryDataAsset` from the mod root then Content. Meshes and textures are built in the worker and cached in IndexedDB (`meshes`, `textures`, keyed by asset key, fingerprint `size|lastModified`). Textures are cached lazily, when a blueprint uses them. Models are cached eagerly (so switching blueprints after a reload needs no re-link): after a game or mod source is linked, the asset worker builds every block model its definitions reference (`Model` and the `Sides` of cube topologies, LOD0 only; the game is ~1.6k models) and the footer shows "Caching models n/m"; a mod definition pointing at a Content model is left to the game source. Textures are not cached eagerly: the game's block textures are 15+ GB. Files exist only for the session; after a reload cached assets render and the rest fall back to flat shading or boxes, with one toast per blueprint ("Textures missing: M textures · N models not cached · link the game folder again to load them"). Loading progress shows in the footer status ("Loading models n/m", "Loading textures n/m"). Textures go to the GPU at full resolution: BC1/2/3/7 stay compressed when `WEBGL_compressed_texture_s3tc(+_srgb)` / `EXT_texture_compression_bptc` exist and the mip chain is complete, otherwise they are decoded in the worker (with mips generated by 2×2 box filter). Sampling is bilinear within one mip level (`LinearMipmapNearest`). Arrived textures are uploaded (`initTexture`) from a queue drained at most ~6 ms per animation frame, so a blueprint's textures never upload in one long frame. Arriving models rebuild the scene once all requested models are in (at most every 400 ms while some are still loading). Detail geometries get a precomputed bounding sphere (the centre three.js would compute, once per mesh) so three.js doesn't walk every part's vertices on each rebuild. When `KHR_parallel_shader_compile` exists, the detail and pass shaders are compiled in the background at startup on stand-in materials that stay alive, so the first textured frame doesn't wait for compilation and the programs survive blueprint switches. Glass materials: a part's material name is the `SubtypeId` of a `TransparentMaterial` (`Texture` colour+alpha, `GlossTexture` gloss in alpha, `Color`, `ColorAdd`, `Reflectivity`, `Fresnel`, `GlossTextureAdd`); the MWM `GLASS` technique's second string (`GlassCCW`) is the fallback name (`PartData.glass`). Unknown names fall back to `GlassInside` / `GlassOutside` (name contains `inside`) from the definitions, then to built-in constants in `render/pbr.ts`. Glass textures follow the skin rules (mod then Content) and are kept alive with the material. Skins come from the game and the enabled mods; a block's `SkinSubtypeId` swaps the textures of matching materials and its `DefaultColor` replaces the colouring key.
- Compose uses the same pipeline: voxels carry their block type and resolve to the game's armor definitions.

## Image export

The framed region (aspect from the export settings) is rendered offscreen at resolution × SS. Total pixels are capped at 64 MP (halve SS until it fits). Tiles are at most min(4096, MAX_TEXTURE_SIZE), each via `camera.setViewOffset`. Tiles go through `readRenderTargetPixels` into a 2D canvas (flipped), the canvas is downsampled in halving steps with `imageSmoothingQuality = 'high'`, and `toBlob(type, 0.92)`; JPG is flattened onto white first. Transparent PNG, and the Transparent background, skip the background pass with clear alpha 0 and un-premultiply the pixels. The file name expands `{blueprint}` and `{date}`. All file exports are plain downloads (no File System Access writes). Clipboard copy uses `ClipboardItem` with a PNG. Turntable renders 36 frames at 10° yaw steps, with one fit that holds for all of them, in the selected format into a store-only zip download.

## Compose

`compose/csg.ts` semantics: top → bottom, add/subtract/intersect, inside tests, bounds = union of add AABBs + 1, capped at 160. Wall hollowing: instead of testing a uniformly shrunk inner shape (which leaves holes on slopes and stretched curves), a shape with Wall k keeps the solid voxels that have an empty voxel within Euclidean distance k (squared distance from three separable 1D passes over the shape's own box, padded by one and clipped to the grid ± k+1). With k = 1 this is every voxel with an empty face neighbour, so walls are always closed. Output: a `Uint8Array` voxel grid (0 = empty, otherwise 1 + block-type index) plus dims. Shapes: Box, Sphere, Cylinder, Ellipsoid, Torus (Size X/Z = outer diameter, Size Y = ring height, Tube = tube width; the ring centre line follows the outer ellipse inset by half the tube; Wall hollows the tube) and Pyramid (square base at −Y tapering to the apex at +Y within the Size box; named Pyramid, not prism). Only Cylinder, Torus and Pyramid can be turned (turning a box, sphere or ellipsoid only swaps its sizes), in 90° steps about world X/Y/Z (`rot`, an integer 3×3 matrix composed per click, Reset back to identity); voxels are tested in the shape's local frame (`Rᵀ·(p − pos)`) and the add AABB uses the rotated extent. It runs in the worker. Edits are debounced to one in-flight job: the latest edit wins and stale results are dropped. The result becomes a RenderModel with the default paint. Block types: Light Armor, Heavy Armor, Interior Wall. When add shapes overlap, the earlier shape in the stack keeps its block type for the overlapping voxels. `se/sbcWrite.ts` writes the bp.sbc, which is downloaded as `bp.sbc`. Below the export button the panel always shows block count and estimated file size (`estimateSbcBytes`: header and footer plus per-block-type line length with average coordinate digits, within 1 % of the real file); above 50,000 blocks it also shows a warning, and above 1,000,000 blocks the export is refused. Interior Wall subtypes: `LargeBlockInteriorWall` (large) and no small variant. When a small-grid composition uses Interior Wall, export fails with a toast. One "+ Add shape" button adds a Box (11³) and opens it; the type is switched in the shape editor. All shapes start collapsed. The open (selected) shape is tinted green: the worker gets the selected index, flags final voxels inside that shape with `FLAG_SELECTED` (16) on their instance, and the box, reference-box and model shaders mix in the tint while `u_sel` is on; image export turns it off. Save JSON / Open JSON write and read the stack as a `drydock-composition` file (version 1: name, grid, and per shape op, type, size, pos, block, shell, tube, rot, one shape per line); `compose/file.ts` validates every field and a file from a newer version is refused. Opening replaces the stack, grid and name.

## Sources

Kinds: `game | workshop | torch | mods | blueprints`. Five link cards in the dialog: Game, Workshop, Torch, Mods, Blueprints ("Blueprints folder (local)", the `%AppData%\SpaceEngineers\Blueprints` folder).

- One code path for every kind: `<input type="file" webkitdirectory>` created on click. No File System Access API, no stored directory handles, no permission flow. The file list is filtered on the main thread to `.sbc`, `.resx` and `modinfo.sbmi` and sent to the worker (`.mwm` and `.dds` go to the asset worker, see the reference pipeline), which rebuilds a directory tree from `webkitRelativePath` (`treeFromFiles`) and runs the scan over it. A browser upload confirmation ("Upload N files") is expected.
- Status: as soon as the input is clicked the footer and the dialog show "Waiting for browser to list files…" (the `cancel` event clears it). On `change` it becomes "Reading file list… N files", then real progress from the worker with a progress bar ("Building file index…", "Parsing definitions 50/176", "Reading blueprints 12/196", "Indexing mods 37/196", "Saving snapshot…", "Caching blueprints 12/58").
- `game`: accepts the SE root or its `Content` folder. If `Content/Data` is missing, a toast warns and the source is added anyway. Scan `Content/Data/**/*.sbc`, skipping `Prefabs, Scenarios, PlanetDataFiles, Localization, Blueprints, CustomWorlds`. Every file is read for skins, glass materials and skyboxes; block definitions come only from files containing `<CubeBlocks`. Parse `Localization/MyTexts.resx` for names.
- `workshop`: the picked `244850` folder, or `244850` / `content/244850` under the pick. Each subfolder `<id>` with `bp.sbc` is a workshop blueprint. One with `Data/` is a mod. Legacy `.bin`/`.sbm` zip mods are not read.
- `torch`: find `content/244850` or `Instance/content/244850` under the picked folder and treat it like `workshop` (mods only).
- `mods`: subfolders with `Data/` are mods, named by folder.
- `blueprints`: `local/` under the pick (or the pick itself) -> subfolders with `bp.sbc`.
- Mod indexing (CubeBlocks, skins, glass materials and environment skyboxes) runs in the worker. Per-mod cache in IndexedDB keyed by `<sourceId>/<folder>`, fingerprint = hash of the sorted `relative path|size|lastModified` lines of its `.sbc` files, taken from the upload's file list (no file reads). Unchanged mods come from the cache, changed ones are re-parsed, vanished ones are pruned.
- A source id is stable: adding a folder with the same kind and folder name as an existing source refreshes that source (same id, same cache keys).
- Blueprint list entries: the name comes from `Id Subtype` (first 4 KB), the grid size from the first `GridSizeEnum` (first 64 KB; Large if not found). The row meta is described under List meta.
- List meta: `<Large|Small> grid · <n> blocks · <n> mods` (or `· vanilla`). Block count (all grids) and mod count come from the `bpmeta` cache, or are filled in the background on the main thread from each cached parsed blueprint (`actions.fillMods`, after restore and after caching; `pickMods` only when the mod count is missing). Parts that are not known yet are left out, so a row may show only `<grid> grid`. The viewport card shows `<grid> grid · <n> blocks · X×Y×Z · <length> m long`.
- Copy: the nav button reads `Link folders` until a source exists, then `Sources`. The status line reads `N sources linked` once a game source is linked, `Mods linked · no game folder yet` without one. A source restored from a snapshot counts as linked.
- Kind cannot be changed after adding (it would need a new upload); the dialog shows a kind tag instead of the retype control.
- Drag & drop (`sources/drop.ts`): a `bp.sbc` file, or a blueprint folder whose `bp.sbc` is read once. Folders go through `DataTransferItem.getAsFileSystemHandle()` where it exists, otherwise `webkitGetAsEntry()`. Linking folders through the file input does not depend on either.

## Snapshot cache

Goal: the app starts with everything it learned from earlier uploads, without an upload. IndexedDB `drydock` v4 (the v2 → v3 → v4 upgrades only add stores):

- `sources`: `{ id, name, kind, when, note }` per source (what the dialog lists: "Snapshot from <date>", file/blueprint/mod counts, scan time).
- `snap`: per source id, the scan result: game definition tuples, skins, glass materials and skies for the game source (older snapshots without `glass` have no glass materials until refreshed), blueprint list metadata (without `File`), mod list (`key, name, folder, subs`).
- `mods`: per-mod `{ fp, name, subs, defs, skins, glass, skies }` (a record without `skies` or `glass`, or whose glass lacks `light`, is re-parsed), loaded lazily by key when a blueprint resolves.
- `bps`: per blueprint `<sourceId>/<folder>` -> `{ fp: "<size>|<lastModified>", v, parsed: ParsedBlueprint }` (typed arrays + string table, no XML). `v` is `PARSE_VERSION` (currently 4). An entry with another version is used only when the blueprint's file is not available in this session; the next caching pass re-parses it.
- `bpmeta`: `{ mods, blocks }` per blueprint for the list meta (older entries hold only the mod count as a number; the block count is then filled in again).
- `meshes`, `textures`: processed block models and texture levels by asset key (see the reference pipeline); a source's `m:<id>/` entries are dropped when it is unlinked.
- `skymeta`: skybox list entries by asset key (see Background); a mod's entries are dropped with the source like meshes. The `skies` store from earlier versions is emptied on startup.

Flow: after a scan the worker writes `snap` and prunes removed mods, the list is shown, then the worker parses every blueprint in the background (sequentially, "Caching blueprints n/m") and stores it; blueprints whose `size|lastModified` is unchanged are reused, removed ones are dropped. On startup `restoreSources()` reads `sources` and `snap`, publishes list and definitions at once (`body.dataset.snapshot = '1'`); opening an entry reads `bps` (when the fingerprint matches the list entry) instead of parsing. Refresh = pick the folder again from the row; it replaces that source's snapshot. Dropped files and `?bp` are never cached. Storage failures (quota) show a toast and the session continues from memory; entries without a cached parse fall back to their `File` while the page is open.

## Test seams

- `?bp=<path>` loads a bp.sbc from the same origin on start, through the same path as a drop. Other origins are ignored. Vite dev serves repo files under `/@fs/`.
- `?view=iso|front|side|top|rear`, `?style=textured|shaded|clay|line`, `?light=directional|uniform`, `?proj=persp|ortho`, `?missing=placeholder|substitute|hide`, `?tab=view|section|scene|export`, `?bg=<id>`, `?mode=compose`, `?seams=0`, `?tint=1`, `?sources=1`, `?tour=1` and `?w=..&h=..` (app size in px) exist for screenshot scripts.
- `window.__drydock` exposes the store, the actions, the renderer, the live `PBR` constants (`pbr`), timing helpers (`bench`, `fps`, `perf`, `index`, `compose`, `exportMs`) used by `scripts/shot.mjs`, and `probe` / `info` for pixel and renderer checks.
- `scripts/shot.mjs <url> <out.png>` drives `playwright-core` with `channel: 'msedge'`, marks the tour as seen, and waits for `document.body.dataset.ready === '1'`, which the app sets after the first frame of a loaded model.
- Tests are self-contained (synthetic XML, in-memory trees) except the `game assets` suite in `test/assets.test.ts`, which builds real meshes and textures from the game's `Content` folder. It reads `SE_GAME_ROOT`, defaults to `C:/Program Files (x86)/Steam/steamapps/common/SpaceEngineers`, and is skipped when no install is found there.

## Welcome card and visit counter

On the first visit (no `drydock.tourSeen` in localStorage, or `?tour=1`) `ui/tour.ts` shows a welcome card with a "Count my visit anonymously" checkbox and the feature tour. `util/count.ts` loads the counter only after the welcome card is closed, or at start when the tour was already seen, and only on `malzsmith.github.io`. The checkbox stores `drydock.count` (`1`/`0`); without a stored choice, Do Not Track or Global Privacy Control turn the counter off. The counter is `public/count.js`, a copy of GoatCounter's `count.js` that sends only the page path (no query string, empty referrer and title, screen width 0) to `drydock.goatcounter.com`.
