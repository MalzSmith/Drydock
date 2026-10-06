# Drydock

Drydock is a browser application for viewing and rendering Space Engineers blueprints and for building simple hull blueprints from geometric shapes. It runs entirely in the browser. Files are read locally and are not uploaded to any server.

## Features

**Blueprint viewer**

- Open a `bp.sbc` file or a blueprint folder by drag and drop.
- Link the game folder, the Steam Workshop folder, a Torch server instance, a mod folder or the local blueprints folder. Linked folders are stored as a snapshot in the browser and are available on the next start.
- Draws blocks with the game's models and textures when the game folder is linked. Without it, blocks are drawn as boxes.
- Detects the mods a blueprint uses. Mods can be switched off individually. Block types that no linked source defines are listed in a separate dialog.
- Render styles: Textured, Shaded, Clay, Line. Perspective and orthographic projection.
- Section view along all three axes (cut or slice).
- Backgrounds: gradients, studio backdrops, procedural skies and the skyboxes of the game and linked mods.

**Image export**

- PNG, JPG or WEBP up to 64 megapixels, with supersampling and optional transparent background.
- Copy to clipboard.
- Turntable: 36 frames as a ZIP file.

**Compose**

- Build a hull from a stack of shapes: box, sphere, cylinder, ellipsoid, torus, pyramid.
- Each shape adds, subtracts or intersects. Shapes can be hollowed to a wall thickness.
- Block types: Light Armor, Heavy Armor, Interior Wall. Large or small grid.
- Export as `bp.sbc` for use in the game.
- Save and open the shape stack as a JSON file.

## Requirements

- Node.js 22.12 or newer
- A browser with WebGL 2 support. Chromium-based browsers (Chrome, Edge) support all features. Folder drag and drop is not available in Firefox.

## Build

```
npm install
npm run dev       # development server
npm run build     # production build in dist/
npm test          # unit tests
```

The tests need nothing but the repository. A few extra checks build meshes and textures from real game files; they run only when `SE_GAME_ROOT` points at a Space Engineers install.

The production build in `dist/` is a static website and can be served by any web server.

## Bundled data

Two data files in `src/data/` are generated and committed. They only need to be regenerated after a game update.

- `vanilla-blocks.json`: vanilla block definitions. Requires an installed copy of Space Engineers.

  ```
  npm run gen-vanilla
  ```

  The game folder defaults to `C:\Program Files (x86)\Steam\steamapps\common\SpaceEngineers`. Set the environment variable `SE_GAME_ROOT` to use a different folder.

- `tile-table.json`: armor tile geometry per cube topology, read from the game's `Sandbox.Game.dll`. Requires an installed copy of Space Engineers and the .NET 8 SDK or newer. It uses the same `SE_GAME_ROOT` variable.

  ```
  dotnet run -c Release --project scripts/gen-tiles -- src/data/tile-table.json
  ```

## Documentation

`ARCHITECTURE.md` describes the internal structure, data flow and rendering pipeline.

## Disclaimer

Drydock is an unofficial fan project. It is not affiliated with, endorsed by or sponsored by Keen Software House. Space Engineers is a trademark of Keen Software House.

Drydock does not include any of the game's models, textures or other assets. They are read from the user's own installation of the game when the game folder is linked, and they stay in the browser.
