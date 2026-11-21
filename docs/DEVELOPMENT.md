# Development

The published package may lag behind the `dev` branch. This page covers running the server from a clone.

## Clone and Build

The build needs [Node.js](https://nodejs.org/) 24.19 or later and [pnpm](https://pnpm.io/).

```bash
git clone https://github.com/Blakeem/Navidrome-MCP.git
cd Navidrome-MCP
pnpm install
pnpm build
```

`pnpm build` also copies the Jukebox Remote's static files into `dist/`, which the MCP server and the player run from. So after an edit under `src/webui/public/`, run `pnpm build` and reload the page.

## Run From Source

From a clone, run `node dist/index.js <command>` in place of `navidrome-mcp <command>`.

```bash
node dist/index.js settings   # opens the settings page
node dist/index.js serve      # starts the MCP server in this terminal
node dist/index.js jukebox    # starts the Jukebox Remote
node dist/index.js shortcut   # creates a desktop shortcut to this build
node dist/index.js help       # lists the commands and the settings and log paths
pnpm dev                      # starts the MCP server with hot reload
```

The MCP client runs the built server with `node` and the absolute path to `dist/index.js`.

```json
{
  "mcpServers": {
    "navidrome": {
      "command": "node",
      "args": ["/absolute/path/to/Navidrome-MCP/dist/index.js"]
    }
  }
}
```

Run `node dist/index.js shortcut` again after you move or rebuild the clone, so the shortcut's paths stay current. `NAVIDROME_DEV=1` makes the MCP server start the Jukebox Remote from `src/web/main.ts` through tsx instead of from `dist/`.

## Quality Gates

Each change passes these three commands with zero issues.

```bash
pnpm check:all    # lint, typecheck (src and tests), and dead-code check
pnpm test:run     # one-shot unit tests
pnpm build        # production bundle
```

`pnpm test` runs the unit tests in watch mode.

## MCP Inspector

[MCP Inspector](https://github.com/modelcontextprotocol/inspector) calls the tools of a built server.

```bash
pnpm build
npx @modelcontextprotocol/inspector node dist/index.js                  # web UI
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call --tool-name search_all --tool-arg query="jazz"    # CLI
```

## Custom Visualizers

Each visualizer style is one file in `src/webui/public/visualizers/`. To add a style, copy `_template.js` to a new file whose name uses lowercase letters, digits, and dashes. The template lists the rules a style follows. `pnpm test:run` checks every style against those rules. Then run `pnpm build` and reload the player page, and the new style joins the click cycle.

## Design Specs

- [PLAYBACK-SPEC.md](PLAYBACK-SPEC.md) describes local playback through mpv, its tools, and the visualizer filter.
- [ARTIST-ALBUMS-SPEC.md](ARTIST-ALBUMS-SPEC.md) describes `get_artist_albums` and `get_album_info`.
