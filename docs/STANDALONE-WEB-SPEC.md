# Standalone Web Mode & Shared-Core Spec

**Status:** Draft for review
**Date:** 2026-05-29
**Author:** Blake McDonald (design w/ Claude)
**Scope:** Make the Navidrome MCP web UI runnable as a first-class standalone
application (eventually a Tauri desktop app + system tray), sharing a single
business-logic core with the MCP server, with centralized GUI-managed settings.

---

## 1. Goals

1. **Run the web interface without the MCP server** — launched directly (icon /
   Tauri app / CLI), usable for "remote play" from a phone or browser.
2. **One shared core** — the exact same code services MCP tool calls *and* the
   web interface. No duplicated playback/queue/search logic.
3. **Harmonious coexistence** — MCP server and a standalone web instance can run
   at the same time for the same user without fighting over the port or mpv.
4. **MCP launches the *same* server it would run standalone** — not a second,
   embedded copy. Closing the MCP server must **not** stop the web service.
5. **Zero-config UX** — a first-run settings GUI collects everything the MCP
   JSON carries today (Navidrome URL, credentials, API keys, options). Both the
   MCP server and the web app become launchable with no manual env setup.
6. **Smart, shared mpv lifecycle** — a single decision function, used by every
   entry point, decides whether to leave mpv playing or shut it down on exit.
7. **Cross-platform** — Linux, macOS, Windows.

> **Playback model (confirmed).** Audio always plays on the **host machine**
> (the one running mpv). The phone/browser web UI and the AI (MCP) are **remote
> controls + now-playing views** for that host's audio — they do *not* play audio
> on their own device. "Remote play from a phone" means "control the host's
> playback from your phone," not "stream audio to the phone."

### Non-goals (this spec)

- Rewriting the existing tool/transformer/client layers (they already separate
  cleanly — see §3).
- Replacing `node:http` with a framework. The bare-http server stays.
- Hot-reloading config into a running process (restart remains required, per
  the existing project convention).
- **Streaming audio to the browser/phone** (audio is host-only — see the
  playback-model note above). That would be a different application.

---

## 2. What already exists (foundation)

The hard parts are largely done. This spec is mostly *extraction + coordination*,
not greenfield.

| Capability | Where | State |
|---|---|---|
| Business logic separated from MCP wiring | `src/tools/*.ts` (impl) vs `src/tools/handlers/*.ts` (schemas+dispatch) | ✅ Done |
| Web UI already reuses tool impl fns | `src/webui/routes/controls.ts`, `src/webui/broadcaster.ts` call `pause()`, `seek()`, `nowPlaying()`, `getPlayQueue()` directly | ✅ Done |
| mpv as user-scoped, out-of-process singleton | `src/services/playback/mpv-process.ts` (`getDefaultIpcPath()`, `spawnMpv()` with `detached:true`+`unref()`) | ✅ Done |
| Latch onto existing mpv without spawning | `playbackEngine.ensureAttached()` | ✅ Done |
| Web server (http + SSE + cover proxy + static) | `src/webui/server.ts`, `broadcaster.ts`, `routes/` | ✅ Done |
| Singleton client/config passed everywhere | `NavidromeClient`, `Config` constructed in `src/index.ts` | ✅ Done |

**The gaps** (what this spec adds):

- **G1 — No standalone entry point.** The web UI only initializes as a child of
  the MCP server (`src/index.ts:85`). There is no `navidrome-web` binary and no
  shared bootstrap both paths call.
- **G2 — No cross-process coexistence.** Two processes both calling `bind()` race
  to `listen()` on the same port; the loser just logs `EADDRINUSE` and gives up
  (`src/webui/index.ts:119`). There is no "detect the running server and attach."
- **G3 — Config is env-only.** `loadConfig()` (`src/config.ts:139`) reads only
  `process.env`. A GUI/icon launch has no MCP client to inject env. No persisted,
  GUI-editable settings store exists.
- **G4 — No smart mpv shutdown.** mpv survives parent exit *by deliberate
  design* (`playback-engine.ts:1121` — "No 'exit' handler kills mpv — by
  design"). Nothing ever *stops* it, so an idle mpv can linger indefinitely.
  We add a **narrow, owner-only** stop decision + idle reaper (§8) that preserves
  the "survives MCP close" guarantee while reclaiming a stopped/idle mpv.
- **G5 — No native launcher.** No icon, no tray, no Tauri.
- **G6 — Scrobbling is MCP-process-only.** `ScrobbleTracker` is attached solely
  in `registry.ts` (MCP path). Once playback survives MCP close, scrobbling would
  stop — a regression. We relocate it (§6.4).

---

## 3. Target architecture

### 3.1 The "shared *code*, two processes, one mpv" model

> **Important correction (per review).** There is **no single shared-core
> runtime**. The "shared core" is shared *source code* (the tool impl functions,
> client, engine class, config resolver) compiled into **two separate
> processes** — the MCP server and the `navidrome-web` server. Each process has
> its **own module-singleton `playbackEngine`**, and *both* attach to the **one**
> user-scoped mpv IPC socket. MCP tools and web routes do **not** proxy through a
> single server — each calls its own in-process engine, which talks to the shared
> mpv. This is the crux that drives the ownership rules in §6.4 (engine config,
> managers, and the single-scrobbler rule).

```
   MCP server process                          navidrome-web process
 ┌───────────────────────┐                  ┌───────────────────────────┐
 │ tool impl fns (code)  │                  │ tool impl fns (code)      │
 │ NavidromeClient        │                  │ NavidromeClient            │
 │ playbackEngine (inst A)│                  │ playbackEngine (inst B)    │
 │ managers + scrobbler?  │                  │ managers + scrobbler  ★    │
 │ stdio ⇄ AI             │                  │ http/SSE ⇄ browsers/phone  │
 └───────────┬───────────┘                  └─────────────┬─────────────┘
             │  mpv JSON-IPC                                │  mpv JSON-IPC
             └───────────────┬──────────────────────────────┘
                             ▼
                 ┌───────────────────────────┐
                 │  ONE mpv process (audio)  │  user-scoped socket,
                 │  host speakers            │  detached, survives both
                 └───────────────────────────┘

  ★ single-scrobbler rule (§6.4): exactly one process scrobbles — the
    navidrome-web server (the playback survivor). MCP does NOT scrobble.

  Browsers / Tauri window / phone all connect to the ONE navidrome-web
  HTTP face (port-as-lock, §5); the Tauri window is just a webview onto it.
```

Key invariants:

- **mpv is the single shared audio process** (already user-scoped via IPC socket),
  playing on the **host's** speakers. Everything that "plays" drives this one
  mpv. ✅ exists.
- **Each process owns its own engine instance** but they converge on one mpv.
  Mutations are serialized *within* a process by the engine mutex; *across*
  processes they serialize at the mpv socket. (Pre-existing behavior — multiple
  MCP servers already shared one mpv this way.)
- **Exactly one process scrobbles** (§6.4) — the `navidrome-web` server.
- **The web server is the single shared HTTP face.** Only one process binds the
  configured port; everything else (Tauri webview, phone, MCP-triggered browser
  open) connects to it. This is enforced by **port-as-lock** (§5).
- **Tauri is a thin native shell**, not the server. Its webview points at
  `http://127.0.0.1:<port>`; it spawns/supervises the Node web server as a
  sidecar. (Same pattern as ComfyUI-desktop / Electron-wrapping-a-sidecar.)

### 3.2 Three "entry points," one bootstrap

All three call a single shared bootstrap that resolves settings, builds the
`NavidromeClient`, and initializes managers — so behavior is identical regardless
of who launched it.

| Entry point | Binary / trigger | Responsibilities |
|---|---|---|
| **MCP server** | `navidrome-mcp` (stdio, launched by Claude Desktop) | Register tools/resources; **spawn the standalone web server** (detached) if enabled; participate in mpv lifecycle as a controller. |
| **Standalone web** | `navidrome-web` (CLI) / Tauri sidecar | Run the web server (bootstrap → bind port → serve UI/API/SSE). |
| **Settings app** | `navidrome-config` / Tauri config window / MCP `open_settings` tool | First-run + ongoing settings GUI; writes the canonical settings store. |

---

## 4. Centralized settings (resolves G3)

### 4.1 Decision

**Chosen: a single GUI-managed canonical settings store (the "Tauri store"),
which is a plain JSON file on disk — used by dev and prod alike.** `.env` and
`dotenv` are dropped; `process.env` remains only as an optional override for
CI/tests/power users. A first-run config UI collects everything the MCP JSON
carries today, giving zero-config launches, and a one-time **env-import
migration** pre-fills it from any legacy env so existing users don't re-type.

> **Why this works without hard Tauri coupling:** the canonical store is an
> ordinary JSON file at a **known OS-conventional path**, written by the config
> UI (via Tauri's `fs` API in our own shape — *not* `tauri-plugin-store`, see
> §9.2) and read by the Node core with plain `JSON.parse`. Node never needs Tauri
> to be running — it only needs the file to exist (created by the config UI on
> first run, by the env-import migration, or hand-written in dev).

**`.env` and `dotenv` are removed entirely.** Since config no longer flows from
the MCP client JSON as env, `.env`'s only purpose (a fallback for `process.env`)
disappears. `settings.json` is the **single canonical store for everyone,
including dev**. `process.env` survives *only* as a thin, optional, undocumented-
for-normal-users override layer — retained because CI and unit tests already
inject config via env (`test:ci`, several `process.env[...]` unit tests) and
rewriting the whole test harness to fixtures is out of scope. See §4.9 for the
test/CI impact.

### 4.2 Resolution order (settings.json wins for humans)

> **Revised per review (M5 footgun).** The earlier draft let `process.env` win,
> which silently defeats GUI edits when a stale `NAVIDROME_URL` is still exported
> (e.g. left in the MCP client JSON after migration). Fixed below: **the file
> wins by default; env can only override behind an explicit opt-in flag that CI
> sets and humans never do.**

```
built-in defaults
  < process.env                 (read ONLY when settings.json is absent, OR per-field
                                 when NAVIDROME_CONFIG_ALLOW_ENV_OVERRIDE is set)
  < settings.json               (canonical for humans — wins by default)
```

Concretely:

- **`settings.json` present (normal):** the file is authoritative. A GUI edit
  always takes effect. `process.env` is **ignored** for config fields.
- **`settings.json` absent:** fall back to `process.env` (this is the seed for
  the migration in §4.6, and the path CI uses — CI has no file).
- **`NAVIDROME_CONFIG_ALLOW_ENV_OVERRIDE=1`:** opt-in escape hatch that re-enables
  env-over-file layering. **CI/tests set this**; it is undocumented for normal
  users. This is what lets `test:ci` force `NAVIDROME_URL=http://ci-dummy…` even
  if a file somehow exists, without giving humans a silent footgun.
- **No `.env` file at runtime, no runtime `dotenv`.** `dotenv` is retained as a
  **devDependency** used *only* by the migration script (§4.6 / §4.8) — never on
  the runtime path.
- **MCP JSON:** no longer carries credentials. Its only job is *launching the MCP
  server binary* (command + args).

### 4.3 Canonical store path

Mirror the OS-awareness already used by `getDefaultIpcPath()`:

| OS | Path |
|---|---|
| Linux | `${XDG_CONFIG_HOME:-~/.config}/navidrome-mcp/settings.json` |
| macOS | `~/Library/Application Support/navidrome-mcp/settings.json` |
| Windows | `%APPDATA%\navidrome-mcp\settings.json` |

- New helper: `src/config/store-path.ts` → `getSettingsStorePath()`. The Tauri
  store plugin is configured to use this exact path so both sides agree.
- **`NAVIDROME_CONFIG_PATH` env var overrides the location** — used by tests
  (isolated temp file per run), portable installs, and multi-profile setups. This
  is a *location* override, not a config-value override.
- **Dev uses the same path as prod** (answering "where would this live?"): on
  Blake's machine, `~/.config/navidrome-mcp/settings.json`. Populated once via the
  config UI or the `pnpm config:migrate` script (§4.6). Tests point
  `NAVIDROME_CONFIG_PATH` at a throwaway file so they never touch the real store.

### 4.4 Schema

The store holds everything currently derived from env in `src/config.ts`:

```jsonc
{
  "navidrome": { "url": "...", "username": "...", "password": "..." },
  "features": {
    "lastFmApiKey": "...",
    "radioBrowserUserAgent": "...",
    "lyricsProvider": "lrclib",
    "lrclibUserAgent": "..."
  },
  "playback": {
    "mpvPath": null,                 // null = auto-detect
    "transcodeFormat": "mp3",
    "transcodeBitrate": "192"
  },
  "webui": { "enabled": true, "port": 8808, "expose": false },
  "library": { "defaultLibraryIds": [] },
  "advanced": { "debug": false, "cacheTtl": 300, "tokenExpiry": 86400 }
}
```

### 4.5 Credentials

**Chosen: stored in the settings store file** alongside other settings (the
canonical `settings.json`). Trust model matches the `.env` file it replaces.
Hardening:

- **Atomic, secure write order** (per review S6): write to a temp file in the
  *same* directory, `fchmod` it to `0600` **before** writing any secret bytes,
  then `rename()` over the target (atomic on POSIX). Never write-then-chmod (that
  leaves a default-perms window).
- **Windows has no POSIX mode bits** — `0600` is a no-op there. Real owner-only
  ACL requires an `icacls` shell-out (or accepting inherited user-profile perms).
  Treat this as an explicit Phase-0 task, not a footnote. (Acceptable v1 fallback:
  rely on the per-user `%APPDATA%` location + document the limitation.)
- The settings file/API is **local-only and never exposed** (§4.7). Credentials
  are never sent over the LAN-exposed player interface.
- (Future option, out of scope: migrate secrets to OS keychain.)

**Single-writer rule** (per review S7): to avoid two writers clobbering the file,
**only the GUI/Tauri side writes `settings.json` during normal operation**
(via Tauri's `fs` API, in the exact §4.4 shape — *not* `tauri-plugin-store`, see
§9.2). The Node core is **read-only** except for the one-shot migration, which
only ever writes when the file is **absent**. So at most one writer touches the
file at a time.

### 4.6 First-run, env-import migration, and unconfigured handling

Two related concerns: (a) seamless migration for existing users, and (b) the
chicken-and-egg that the MCP server boots headless under Claude Desktop (stdio)
and cannot pop a GUI on its own.

**Env-import migration (so users don't re-type).** On any startup where
`settings.json` does **not** exist, gather a partial config from *legacy sources*:

1. `process.env` legacy vars (`NAVIDROME_URL`, `NAVIDROME_USERNAME`,
   `NAVIDROME_PASSWORD`, `LASTFM_API_KEY`, `RADIO_BROWSER_USER_AGENT`,
   `LYRICS_PROVIDER`, `LRCLIB_USER_AGENT`, `MPV_PATH`, `WEBUI_PORT`,
   `WEBUI_EXPOSE`, `WEBUI_ENABLED`, `NAVIDROME_DEFAULT_LIBRARIES`, …) — covers
   anyone who set them in their MCP client JSON or shell.
2. A legacy `.env` file at the project root / cwd, **parsed once for import
   only using `dotenv` as a devDependency** (per review S8 — a hand-rolled parser
   would mishandle exactly the shell-special chars this project's `.env` is known
   to contain, e.g. parens in `RADIO_BROWSER_USER_AGENT`; see `CLAUDE.md`). This
   is import-only and never on the runtime path — covers dev installs.

Then:

- **GUI available** (Tauri/web first-run): pre-fill the config form with the
  imported values; the user reviews and saves → writes `settings.json`.
- **Headless + complete** (MCP server, env fully specifies a valid config):
  write `settings.json` automatically and continue. Log a one-line
  "migrated legacy env → settings.json" notice.
- **`pnpm config:migrate`** dev script (`scripts/migrate-env-to-store.mjs`):
  explicit one-shot import of the current `.env`/env into `settings.json` for
  developers who want to migrate before running anything.

> The legacy `.env` parse is import-only and best-effort; after migration the
> `.env` file is never read again at runtime.

**Degraded mode (still unconfigured after import).** If no credentials can be
resolved from store *or* legacy import:

1. **Don't poison the `Config` type** (per review M6). Keep
   `loadConfig(): Promise<Config>` throwing as today for the configured path
   (it's threaded into `NavidromeClient`, `libraryManager`, `playbackEngine`,
   every tool category, and `buildStreamUrl` — a union return would force a
   discriminant check at every `config.navidromeUrl` site under ultra-strict TS).
   Instead add a **separate** `resolveConfigState(): Promise<{configured:true,
   config:Config} | {configured:false}>` that *only the two entry points*
   (`src/index.ts`, `src/web/main.ts`) call to branch into normal vs degraded.
2. The MCP server still starts but registers only a minimal toolset:
   - `open_settings` — launches the settings app (§7).
   - `test_connection` — reports "not configured; run open_settings."
   All other tools are withheld (or return a uniform "not configured" error).
3. The standalone web server, if unconfigured, serves only a setup page that
   launches/redirects to the settings app.
4. After the user saves settings, a **restart** of the MCP server / web server
   picks them up (consistent with the existing "MCP doesn't auto-reload" rule).

### 4.7 Local-only settings (hard requirement)

> *"The settings should never be exposed anywhere but local."*

- Settings **read/write** happens via Tauri local IPC (preferred) and/or an HTTP
  route bound to loopback only.
- Even when `webui.expose = true` (player UI reachable on `0.0.0.0` for the
  phone), any `/api/settings*` route **must reject non-loopback remote
  addresses** (`req.socket.remoteAddress` not in `127.0.0.1/::1`). Add a
  loopback-guard middleware in `src/webui/server.ts`.
- The player/control API and cover-art proxy *may* be exposed; settings never.

### 4.8 Refactor required

- Extract config resolution: `defaults → settings.json` (humans), with
  `process.env` consulted only when the file is absent or
  `NAVIDROME_CONFIG_ALLOW_ENV_OVERRIDE` is set (§4.2). Keep
  `loadConfig(): Promise<Config>` throwing for the configured path; add a
  **separate** `resolveConfigState()` for the configured/unconfigured branch
  (§4.6, M6) — do **not** turn `Config` into a union.
- **Move `dotenv` from `dependencies` to `devDependencies`** and delete the two
  runtime `loadDotenv` blocks in `src/config.ts` (lines ~27-46 and ~145-166).
  `dotenv` survives only inside `scripts/migrate-env-to-store.mjs`.
- Add `getSettingsStorePath()` (`src/config/store-path.ts`, honoring
  `NAVIDROME_CONFIG_PATH`) + a typed store **reader** (`src/config/store.ts`)
  with Zod validation reusing the existing `ConfigSchema` shape. Node writes only
  via the migration (file-absent case); all other writes are the GUI's (§4.5).
- Add env-import migration (`src/config/migrate.ts`) + `scripts/migrate-env-to-store.mjs`
  + `config:migrate` npm script (§4.6).
- Keep `mpv` auto-detection (`detectMpvBinary()`); `playback` stays gated on mpv
  presence, but `mpvPath` may also come from the store.
- **Delete `.env`, `.env.test`, `.env.example`** from the repo; replace
  `.env.example` with a `settings.example.json` (documents the store shape).

### 4.9 Test / CI impact (must address upfront)

Removing the `.env` file changes how tests get config. Current state:

- `test:ci` injects `NAVIDROME_URL/USERNAME/PASSWORD` inline as env. To keep it
  working with the new file-wins precedence (§4.2), **add
  `NAVIDROME_CONFIG_ALLOW_ENV_OVERRIDE=1` to the `test:ci` env** (and any test
  runner that relies on env). With no `settings.json` present in CI, env is the
  only source anyway; the flag just guarantees env still wins if a stray file
  exists. No fixture rewrite.
- Unit tests that set `process.env[...]` (timeouts, `XDG_RUNTIME_DIR`, etc.) —
  **unaffected** (those aren't store-managed config).
- **Integration/playback tests** currently rely on `loadConfig()` auto-loading
  `.env`. Once runtime `dotenv` is gone, they must get config another way.
  **(Recommended)** a test bootstrap (`tests/helpers/`) that writes a **temp
  `settings.json`** from the developer's existing `.env` values and points
  `NAVIDROME_CONFIG_PATH` at it — keeps `.env` as the thing the *developer*
  edits, while the runtime reads a store file (and never touches the real
  `~/.config` store). This doubles as the first real exercise of the store
  reader.
- `.env.test` is **vestigial** (not referenced in code) — delete it.

### 4.10 New multi-process test category (per review G)

The existing suite is **single-process** by construction — `vitest.playback.config.ts`
forces `singleFork` + `isolate:false` precisely because the engine is a singleton.
But port-as-lock (§5), double-spawn (§6), "survives MCP close," and the
owner-only shutdown/reaper (§8) are **inherently multi-process** behaviors the
current harness cannot express. Add a coordination test category that **spawns
real child processes** and asserts on port ownership, attach-not-bind, mpv
survival across a simulated MCP exit, and reaper cleanup. Because these touch a
real socket + real mpv, they belong under the **`test:playback` umbrella** (gated
like the live suite, skipped when mpv/Navidrome absent), and must honor
`tests/CLAUDE.md`'s "mock writes / don't mutate server data" rule (these tests
manipulate local mpv + ports only, not Navidrome state). This is a Phase-0
deliverable — §11 lists it explicitly.

This is the single most fiddly part of the `.env` removal; it must be resolved in
Phase 0 or the integration suite breaks.

---

## 5. Coexistence: port-as-lock (resolves G2)

### 5.1 Decision

**Chosen: the configured TCP port is the lock.** Whoever binds
`webui.host:webui.port` first owns the web server. Anyone else **probes a health
endpoint, confirms it's our server, and stands down** (connecting to it instead
of binding). No lockfile → no stale-PID problem.

> Honors the requirement to *"use the port that is configured"* — the lock is
> always the user's configured port, not a hardcoded one.

### 5.2 Mechanism

1. **Health endpoint:** add `GET /healthz` to `src/webui/server.ts` returning a
   small JSON signature, e.g. `{ "app": "navidrome-mcp-web", "version": "..." }`.
   This distinguishes *our* server from some unrelated process squatting the port.
   **Probe always uses loopback `127.0.0.1`** even when the eventual bind host is
   `0.0.0.0` (per review S1: binding `0.0.0.0` accepts loopback connections, so a
   loopback probe reaches it — do **not** "fix" the probe to use the bind host).
   Decide consciously whether `/healthz` itself is loopback-only when
   `expose=true` (minor version-fingerprint leak on the LAN otherwise; §4.7 is
   strict about settings routes — apply the same judgement here).
2. **Acquire sequence** (new `src/web/acquire.ts`):
   ```
   async function acquireOrAttach(config):
     probe GET http://127.0.0.1:port/healthz   (short timeout)
       → 200 + matching signature  ⇒ ALREADY RUNNING → return { mode: 'attached', url }
       → connection refused        ⇒ try to bind:
            listen(port, host)
              success               ⇒ return { mode: 'owner', server }
              EADDRINUSE (race)     ⇒ re-probe; if ours → 'attached', else surface error
       → 200 + foreign signature   ⇒ port conflict with another app → surface clear error
       → timeout / connects-but-hangs ⇒ treat as foreign/unusable → surface clear error
                                        (per review S1 — don't block forever)
   ```
3. **MCP server:** on startup (if `webui.enabled`), runs `acquireOrAttach`. If it
   would be the owner, it instead **spawns the standalone `navidrome-web`
   process detached** (so the server outlives the MCP process) rather than
   binding in-process. If already running, it does nothing. (See §6.)
4. **Tauri app:** its sidecar runs `acquireOrAttach`. If a server is already up
   (e.g. MCP started one), the sidecar exits and the webview just points at the
   existing URL. If not, the sidecar becomes the owner.
5. **Cold-start double-spawn** (per review S2): if two launchers (e.g. MCP +
   Tauri, or two MCPs) both pass the probe and both spawn/try to bind, one wins
   `listen`; every loser runs `acquireOrAttach` itself and **self-exits cleanly**
   on `EADDRINUSE→re-probe→attached`. The MCP spawner must **not** treat a child
   that immediately exits (because it attached instead of binding) as an error.
   Combined with the in-process double-spawn guard (§6.2), transient orphan spawns
   are harmless.

### 5.3 Resulting behaviors (all required scenarios satisfied)

| Sequence | Outcome |
|---|---|
| MCP starts → user opens Tauri | MCP spawned the server; Tauri attaches to it. |
| Tauri starts → MCP starts | Tauri's sidecar owns it; MCP probes, stands down. |
| Build playlists in MCP, close MCP, open web later | Server (spawned detached) **survives MCP close**; web keeps working; controls the still-playing mpv. |
| Two browsers / phone + desktop | All connect to the one owner; all drive the same mpv. |

---

## 6. MCP launches the standalone server (resolves G1 + req #4)

### 6.1 Decision

**Chosen: MCP spawns the *same* `navidrome-web` process it would run standalone,
detached** — instead of constructing `WebUIServer` in-process. Eager at startup
(not lazy), gated by `webui.enabled`, default on, disableable, local unless
exposed.

> Honors *"launch it at the start if enabled… same as running the web interface
> directly… stopping the MCP server should not stop the service."*

### 6.2 Changes

- **New entry:** `src/web/main.ts` → compiled to `dist/web/main.js`, exposed as
  bin `navidrome-web`. It runs the **full** bootstrap (§6.4), then
  `acquireOrAttach` → if owner, bind and serve; install shutdown handlers.
- **New shared bootstrap:** `src/bootstrap.ts` exporting `createRuntime()`. Per
  review M2, this must wire **everything the process needs to actually function**,
  not just `{config, client}`:
  ```ts
  // createRuntime(): does ALL of:
  //   resolveConfigState()  → config (or degraded)
  //   new NavidromeClient(config); await client.initialize()
  //   await libraryManager.initialize(client, config)
  //   await filterCacheManager.initialize(client, config)
  //   playbackEngine.configure(config)        // ← required or buildStreamUrl() breaks
  //   return { config, client }
  ```
  Both `src/index.ts` (MCP) and `src/web/main.ts` (web) call it, so the web
  process's cover-art proxy (needs `client`), queue metadata (needs configured
  engine), and stream URLs (need `config`) all work standalone. **Scrobbler
  attach is NOT here** — it's process-conditional (§6.4).
- **Dev vs prod spawn path** (per review S3): in prod, resolve `dist/web/main.js`
  relative to `import.meta.url` (mirror `config.ts:31`). In **dev** (MCP runs
  under `tsx`, no `dist/`), spawn `tsx src/web/main.ts` instead. Detect via
  presence of `dist/` or an explicit `NAVIDROME_DEV=1` flag.
- **Child env propagation** (per review S3): the spawned child must inherit
  `NAVIDROME_CONFIG_PATH` (so parent/child agree on the store, critical for
  tests) and, because of file-wins precedence (§4.2), the child reading the
  parent's inherited `NAVIDROME_*` env is now harmless (the file wins).
- **Child logging** (per review S5): the web process is where playback, SSE, and
  (post-§6.4) **scrobbling** live — i.e. the interesting logs. It is detached
  with `stdio:'ignore'`, so it **must log to a file**
  (`${stateDir}/navidrome-web.log`). The MCP-stdio-safety reason `logger` targets
  stderr does not apply to the web process (it's not on MCP stdio).
- **Double-spawn guard** (per review S2): `ensureWebServerRunning` keeps an
  in-process "already spawned" flag so a transient probe miss can't spawn two
  children in one MCP process; cross-process double-spawn is harmless because each
  child runs `acquireOrAttach` and the bind loser self-exits cleanly (MCP must not
  treat an immediately-exiting child as an error).
- **Delete `src/webui/index.ts` (`WebUIServer`)** (per review F): the reusable
  units are `createServer(deps)` (`src/webui/server.ts`) + `SseBroadcaster`, which
  `src/web/main.ts` imports directly. The lazy-bind lifecycle wrapper is obsolete
  once the web server is its own eager process. **Grep `tests/` for `WebUIServer`
  imports before deleting** (the dead-code gate + tests must stay green).

  ```ts
  if (config.features.playback && config.webui.enabled) {
    await ensureWebServerRunning(config);   // spawns navidrome-web detached if not already up
  }
  ```

### 6.3 Why a separate process (not in-process)

- Guarantees "closing MCP doesn't stop the web service."
- Guarantees the MCP-launched server is *byte-for-byte* the standalone server.
- Lets Tauri attach to / supervise the identical artifact.

### 6.4 Engine, managers, and scrobbler ownership (the two-engine reality)

Per review M1 + M2, and §3.1: MCP and `navidrome-web` are **separate processes,
each with its own `playbackEngine` instance**, both attached to one mpv. Both
drive mpv directly (MCP via `play_*` tools, web via `/api/controls/*`).

1. **Both processes `configure()` their engine** (done by `createRuntime`, §6.2)
   — neither proxies through the other.

2. **Scrobbling is part of the shared playback layer and tracks *mpv*, not the
   initiator.** This is the load-bearing principle: the `ScrobbleTracker` observes
   the engine↔mpv state stream (track changes, position). Because mpv is the
   single shared audio process, **a song is scrobbled identically whether MCP or
   the web UI started it** — the tracker sees the same mpv playback either way.
   "Playing a song" is tracked the same in both cases by construction. The
   scrobbler is therefore wired in the **shared** playback subsystem (alongside
   the engine), not bolted onto one transport — today's placement in
   `registry.ts:126` (MCP-only) is the bug to fix (G6).

3. **Single *active submitter* — an anti-duplication guard, NOT a limit on what
   gets tracked.** Since both processes independently observe the same mpv, if
   *both* submitted, every play would hit Navidrome's `/scrobble` **twice**. So
   exactly one process is the *active submitter* at a time. This does **not** mean
   only one interface's plays count — the active submitter scrobbles **everything
   mpv plays, regardless of who initiated it.**
   - **Election:** the `navidrome-web` **port owner** is the active submitter when
     it exists (it's the playback survivor — must keep scrobbling after MCP
     closes). Port-as-lock guarantees exactly one owner, so exactly one submitter.
   - **MCP-only fallback:** when `webui.enabled=false` (no web server), the MCP
     process is the active submitter so scrobbling still works in MCP-only mode.
     The decision rule both processes evaluate: *"I submit iff I am the web port
     owner, or no web server is configured/running and I am MCP."*
   - **Handoff window:** if a web server comes up or goes down while MCP runs, the
     submitter role transfers; ensure the transition neither double-submits (brief
     overlap) nor drops the in-flight track (on attach, the new submitter primes
     from the current mpv state rather than re-scrobbling the already-counted
     track). Minor edge; note it for implementation.

   **Net effect (the guarantee you want):** every play through mpv is scrobbled
   **exactly once, the same way**, whether it came from the AI (MCP) or the web
   UI — and it keeps being scrobbled after you close MCP.

---

## 7. Settings app + `open_settings` tool

### 7.1 Components

- **`open_settings` MCP tool** (`src/tools/settings.ts` + handler): launches the
  settings GUI. In a packaged install it spawns the Tauri config window; in dev
  it can open the local settings web page.
- **Standalone config launcher** (`navidrome-config` bin / Tauri config window):
  for users who only want the remote-play web UI and never run the MCP server.
- **First-run flow:** when `settings.json` is absent, any entry point that has a
  GUI available routes the user into the config app before normal operation.

> **Degraded-mode bootstrapping gap (per review).** Two coupled problems:
> (1) Today the web UI is implicitly gated on `config.features.playback` (mpv
> present) — see `index.ts:85` and the `ConfigSchema.webui` comment. (2) In
> unconfigured mode there may be **no mpv and no web server**, so a "open the
> `/settings` web page" fallback has nothing to open, and spawning a Tauri window
> from a headless MCP-under-Claude-Desktop process isn't guaranteed (no display,
> esp. Linux/SSH).
> **Resolution:** decouple the **setup/settings server** from the playback gate —
> a minimal settings HTTP server (loopback-only, §4.7) must be able to start
> **without mpv** so `open_settings` always has a target, and the packaged Tauri
> app provides the GUI directly. Spell out in implementation: `webui.enabled`
> gating applies to the *player* surface; the *settings* surface is always
> available locally when unconfigured.

### 7.2 Settings UI surface

Form fields mirror §4.4: Navidrome URL / username / password, Last.fm key,
Radio Browser user-agent, lyrics provider + user-agent, mpv path (optional),
transcode format/bitrate, web port, `expose` toggle (with a clear "exposes the
player to your LAN — settings stay local" note), default libraries, debug.

A **"Test connection"** button calls the existing `test_connection` logic against
the entered values before saving.

---

## 8. Smart mpv lifecycle (resolves G4)

> **Revised per review (M3).** The earlier draft had a cross-process heartbeat
> registry and let *any* "last controller" kill mpv. The review showed this is
> both fragile (graceful exit deletes the heartbeat instantly → fast-restart kills
> a wanted mpv; a crashed last controller never re-evaluates → mpv orphaned
> forever) **and** it reverses the existing deliberate design
> (`playback-engine.ts:1121`: "No 'exit' handler kills mpv — by design").
> Replaced with the **web-owner-authority + idle-reaper** model you chose.

### 8.1 Decision — only the web owner ever kills mpv

- **MCP exit NEVER kills mpv.** This preserves the existing, deliberate
  "survives parent" design and goal #4 ("closing MCP must not stop the service").
  No heartbeat registry; the cross-process presence question disappears.
- **Only the `navidrome-web` port owner** is a candidate to kill mpv, and only:
  - **on its own graceful shutdown** — kill mpv **iff not playing** (keep iff
    playing, so music survives a web restart); and
  - **via an idle reaper** while running — see §8.3.

```ts
// src/services/playback/shutdown.ts  (called ONLY by the web owner)
function shouldKillMpvOnOwnerShutdown(isPlaying: boolean): boolean {
  return !isPlaying;   // playing → keep (detached); stopped/idle → kill
}
```

This satisfies your intent ("if stopped and they close everything, close mpv;
if playing, keep it") without the fragile registry: the web owner is the single
authority, MCP never interferes.

### 8.2 "Is it playing?" — from the engine cache (with documented bias)

Add `playbackEngine.isPlaying(): boolean` next to `isRunning()`/`getStatus()`,
derived from cached properties: `playlist-count > 0` AND `pause === false` AND
`idle-active !== true` AND not end-of-file. **Documented semantics** (per review
M4):

- **Biased toward "keep."** `idle-active` does not emit until something plays
  (`playback-engine.ts:719`), so a freshly-attached owner may read it as
  `undefined`; `!== true` treats that as "playing" → we keep. Safe direction
  (never kills a maybe-playing mpv), but means "kill on idle" rarely fires for a
  brand-new attach — that's fine, the reaper (§8.3) catches lingering idle later.
- **Radio streams** read as perpetually "playing" (`playlist-count===1`, never
  EOF) → effectively never auto-killed. Intended, not a bug.
- `isPlaying()` is consulted **only** on the owner's shutdown / by the reaper —
  it is not a general truth source for other features.

### 8.3 Idle reaper (covers the crash-orphan case)

A crashed owner can't run shutdown logic, so a stopped mpv could otherwise linger
forever. The reaper handles this without a registry:

- While the **active host** runs (the web owner; or MCP in MCP-only mode — same
  election as the scrobbler, §6.4/§8.6), a timer checks mpv every N minutes
  (e.g. 10). If mpv has been **continuously idle/stopped** for the whole window
  (not playing, not paused-mid-track — i.e. truly idle/`idle-active`), the host
  quits mpv to reclaim the audio device + resources.
- A *paused mid-track* mpv is **not** reaped (the user may resume) — only genuine
  idle. (Tune the exact predicate during implementation; bias toward not reaping.)
- **Crash recovery:** if the owner itself crashed, the next process to start and
  attach (MCP or a new web owner) inherits a possibly-idle mpv; the new web
  owner's reaper trips on its next tick, or the idle mpv is simply reused on the
  next `play_*`. Either way no permanent orphan, and no cross-process bookkeeping.

### 8.4 Race & edge cases

- **No multi-controller race** — only one process (the single port owner) ever
  decides. MCP exits are inert w.r.t. mpv.
- **Web restart while playing** → `isPlaying` true → keep → new owner reattaches
  to the still-playing mpv (existing `ensureAttached` path). ✅
- **MCP-only mode** (`webui.enabled=false`, no web server): MCP is the active
  host, so it runs the scrobbler *and* reaper (best-effort) while alive. But MCP
  exit never kills mpv, so if MCP closes while mpv is idle, the idle mpv lingers
  until something adopts it (today's behavior). Acceptable.

### 8.5 Shutdown wiring

- **MCP (`src/index.ts`):** keep a SIGINT/SIGTERM handler, but it only does MCP
  cleanup — **it must not touch mpv** (remove any mpv-stop). It does *not* stop
  the spawned web server (goal #4).
- **Web (`src/web/main.ts`):** SIGINT/SIGTERM → `onOwnerExit()` that (1) stops the
  HTTP server + broadcaster + scrobbler, (2) if this process is the port owner,
  calls `shouldKillMpvOnOwnerShutdown(engine.isPlaying())` and quits mpv via IPC
  if true. A non-owner web process (lost the bind race) does nothing to mpv.

### 8.6 Lifecycle: hosts vs observers vs mpv (the orphan edge cases)

The scrobbler (§6.4) and reaper (§8.3) are **in-process components of the active
host**, not separate processes/daemons. There is no independent "is the reaper
running?" to track — it lives and dies with its host, so its liveness *is* the
host's liveness (the port probe for the web owner). Three tiers, **different
lifetimes**:

| Tier | What | Lifetime | Can exist alone? |
|---|---|---|---|
| **mpv** | audio process | most durable; detached; outlives controllers | ✅ can run with no host |
| **active host** | the process running engine + scrobbler + reaper (web owner; MCP in MCP-only mode) | as long as its process | ✅ can run with no mpv (idle, waiting) |
| **observers** | scrobbler + reaper (in-process) | armed only while the host is attached to a live mpv | ❌ die with their host |

**Rules:**

- **Single active host** runs *both* observers (scrobbler + reaper) — same
  election as §6.4 (web owner; MCP fallback). Prevents double-scrobble and
  redundant double-reap.
- **Arm-on-attach / disarm-on-detach.** The host arms the observers when it
  attaches to a live mpv (startup `ensureAttached`, or spawning on first play),
  and disarms them via the engine's IPC disconnect handler when mpv goes away.
- **Reaping mpv does NOT close the host.** When the reaper quits an idle mpv, the
  host stays alive as a dormant control surface (URL stays reachable; next play
  re-spawns mpv + re-arms observers). The host exits only on explicit stop
  (Ctrl-C, Tauri tray Quit, OS shutdown). *(Optional future enhancement: a
  headless MCP-spawned web server could self-exit after being fully idle — no mpv,
  no SSE clients — for a long window; deferred, Tauri makes it moot.)*
- **Adopt-on-startup.** Every host runs `ensureAttached` on startup; if an mpv is
  already running (e.g. spawned by a since-closed MCP), it adopts it and arms the
  observers on the in-progress playback. This is the orphan-recovery path.

**Edge-case matrix (the ones raised in review/discussion):**

| Scenario | Outcome |
|---|---|
| mpv running + host running | Normal — observers armed; scrobbles + reaps. |
| mpv running + **no host** (orphan) | No scrobble/reap until a host starts; next host **adopts** via `ensureAttached`. A truly host-less orphan can't be reaped (reaping needs a live process) → lingers until adopted or machine restart. **Fundamental limit; acceptable.** |
| host running + **no mpv** | Fine — observers idle; first play spawns mpv + arms observers. |
| host crashes while **playing** | mpv keeps playing (detached); unscrobbled until next host adopts it. |
| host crashes while **idle** | Idle orphan; reaped by next host's reaper after adoption, or reused on next play. |

> **Detecting "mpv without a host":** mpv liveness = connect to its IPC socket
> (what `ensureAttached` already does); host liveness = the port probe.
> `mpv-alive && no-host` ⇒ orphan — but only a *running* process can observe this,
> so it is resolved at host startup via adoption, **not** by a standalone
> watchdog. We deliberately do not add a separate watchdog process.

---

## 9. Native launcher & Tauri (resolves G5)

### 9.1 Decision

**Chosen: Tauri app (window + system tray) wrapping the Node web server as a
sidecar.** The webview renders `http://127.0.0.1:<port>` (same UI the phone sees);
the tray offers Open / Show-hide / Stop / Quit and (later) now-playing.

### 9.2 Architecture notes

> **Two reality-checks from review (E).** (1) Tauri sidecars expect a **bundled
> binary** declared in `tauri.conf.json > bundle.externalBin`, invoked with a
> platform-suffixed name (`navidrome-web-x86_64-unknown-linux-gnu`) — *not*
> `node dist/web/main.js`. (2) `tauri-plugin-store` does **not** persist a
> hand-editable flat JSON the Node side can `JSON.parse` naively; it manages its
> own keyed format. Both are corrected below.

- **Sidecar = the Node web server.**
  - **Dev:** Tauri spawns the server via a `Command::new("node")` (or `tsx`) —
    requires Node on PATH, fine for development.
  - **Distribution:** package the Node server as a **single-file executable**
    (e.g. Node SEA / `pkg`-style) and declare it as `externalBin` so end users
    don't need Node. **This packaging is the single biggest Phase-2 risk** (size,
    per-OS build, code signing / macOS notarization — see
    `docs/MACOS_TROUBLESHOOTING.md`).
- **Settings interop = our own `settings.json`, NOT `tauri-plugin-store`.** The
  Tauri config window writes the canonical `settings.json` (§4.4 shape) via
  Tauri's `fs` API or a small Rust command, at `getSettingsStorePath()`. The Node
  side reads it with plain `JSON.parse`. This guarantees both sides agree by
  construction **and** keeps a single writer (§4.5 / review S7). Do not rely on
  the plugin's serialization as the contract.
- **Tray-to-system behavior:** "minimize to tray" keeps the server running;
  "Quit" triggers the same `onOwnerExit()` smart-shutdown (§8.5).
- **Remote/phone access** is unaffected — it always goes to the Node server's
  exposed port, independent of whether the Tauri window is open.

### 9.3 Bundle identifier

Pick a stable identifier (e.g. `com.navidrome-mcp.app`) so the store path and
any OS integration are consistent across versions.

---

## 10. Refactor map (file-by-file)

| Area | File(s) | Change |
|---|---|---|
| Shared bootstrap | `src/bootstrap.ts` *(new)* | `createRuntime()` → config + client + initialized managers + `engine.configure()` (§6.2). NOT scrobbler. |
| Config resolve | `src/config.ts` | File-wins resolution (§4.2); `loadConfig()` keeps `Promise<Config>` (throws); add separate `resolveConfigState()`. |
| Remove runtime dotenv | `src/config.ts`, `package.json` | Delete the two `loadDotenv` blocks; **move `dotenv` to devDependencies** (migration-only). |
| Settings store | `src/config/store-path.ts`, `src/config/store.ts` *(new)* | OS-aware path (+ `NAVIDROME_CONFIG_PATH`); typed **reader** + Zod validate; atomic+`0600` writer used only by migration (§4.5). |
| Env-import migration | `src/config/migrate.ts`, `scripts/migrate-env-to-store.mjs` *(new)* | First-run import from env + legacy `.env` (via dotenv devDep); `config:migrate` script. |
| Remove `.env` files | `.env`, `.env.test`, `.env.example` | Delete; add `settings.example.json`. |
| Test/CI config | `tests/helpers/` *(new)*, `package.json` (`test:ci`) | Temp `settings.json` via `NAVIDROME_CONFIG_PATH`; add `NAVIDROME_CONFIG_ALLOW_ENV_OVERRIDE=1` to `test:ci` (§4.9). |
| Multi-process tests | `tests/integration/coordination/` *(new)* | Spawn real children; assert port ownership, mpv survival, reaper (under `test:playback` gate, §4.10). |
| Docs | `CLAUDE.md`, `tests/CLAUDE.md`, `README.md` | Update curl recipes + setup from `.env` → settings.json (§13). |
| Port-as-lock | `src/web/acquire.ts` *(new)*, `src/webui/server.ts` | `acquireOrAttach` (loopback probe, foreign/hang branch); add `/healthz`; loopback guard for settings routes. |
| Standalone web entry | `src/web/main.ts` *(new)* | bin `navidrome-web`; `createRuntime` → attach scrobbler → acquire → serve → owner-shutdown + reaper; logs to file. |
| MCP spawns web | `src/index.ts` | Replace in-process `WebUIServer` block with `ensureWebServerRunning()` (dev/prod path, child env, double-spawn guard); SIGINT/TERM must NOT touch mpv. |
| Delete WebUIServer | `src/webui/index.ts` *(delete)* | Fold lifecycle into `src/web/main.ts`; reuse `createServer` + `SseBroadcaster`. Grep `tests/` first. |
| Scrobbler relocation | `registry.ts`, `src/web/main.ts` | Move `ScrobbleTracker.attach()` out of MCP registration; single-scrobbler rule + MCP-only fallback (§6.4). |
| Smart shutdown | `src/services/playback/shutdown.ts` *(new)*, `playback-engine.ts` | `shouldKillMpvOnOwnerShutdown()`, `isPlaying()`, idle reaper; **no** controller registry (§8). |
| Settings tool | `src/tools/settings.ts` + handler *(new)* | `open_settings`; degraded-mode toolset; loopback-only setup server decoupled from mpv gate (§7). |
| Package | `package.json` | Add `navidrome-web` (and later `navidrome-config`) to `bin`; build copies web assets (already does via `scripts/build-webui.mjs`). |
| Tauri (Phase 2) | `src-tauri/` *(new)* | Tauri shell, tray, sidecar (`externalBin`), settings written as our `settings.json` via fs (NOT plugin-store). |

**Quality gates** (per `CLAUDE.md`): every step must pass `pnpm check:all`,
`pnpm test:run`, `pnpm build`; playback changes also `pnpm test:playback`. Remove
exports of any deleted functions (dead-code gate blocks PRs).

---

## 11. Proposed build order

Per your sequencing — **spec it all first, then build incrementally**:

### Phase 0 — Refactor to get ready (foundation, no user-visible feature)
- Centralized settings store **reader** (§4); remove runtime `dotenv` (devDep
  only); file-wins resolution + `resolveConfigState()`; env-import migration
  (§4.6); resolve the test/CI config path + `NAVIDROME_CONFIG_ALLOW_ENV_OVERRIDE`
  (§4.9).
- Shared `createRuntime()` bootstrap incl. `engine.configure()` + managers (§6.2).
- **Scrobbler relocation** + single-scrobbler rule (§6.4) — *do this with the
  spawn change so scrobbling never silently dies.*
- Audit tool impl functions so every web-needed action has a transport-agnostic
  impl (most already do — audit `controls.ts` coverage).
- Smart mpv shutdown: owner-only `shouldKillMpvOnOwnerShutdown` + `isPlaying()` +
  idle reaper; **no controller registry**; MCP exit must not touch mpv (§8).
- Port-as-lock `acquireOrAttach` + `/healthz` (loopback probe) + loopback settings
  guard (§5, §4.7).
- Standalone `navidrome-web` bin (logs to file); MCP spawns it detached with
  dev/prod path + double-spawn guard (§6). Delete `WebUIServer`.
- **Multi-process coordination tests** (§4.10).
- **Outcome:** standalone headless web server fully works; MCP + web coexist;
  music *and scrobbling* survive MCP close; idle mpv reaped. No GUI yet.

### Phase 1 — Settings app (Tauri) — proof of concept, useful on its own
- Tauri config window that **writes our `settings.json`** (via fs, the §4.4 shape
  — *not* `tauri-plugin-store`) at `getSettingsStorePath()`.
- First-run flow; `open_settings` MCP tool; degraded mode + loopback-only setup
  server decoupled from the mpv gate (§4.6, §7).
- "Test connection" before save.
- **Outcome:** zero-config onboarding for both MCP and web; validates the Tauri
  toolchain on a small surface before the bigger UI.

### Phase 2 — Web controller interface (Tauri) — full native app
- Tauri window rendering the player UI + system tray (Open/Stop/Quit/now-playing).
- Packaged Node sidecar (`externalBin`, single-file executable) for distribution;
  per-OS signing/notarization.
- Tray-aware owner-shutdown.
- **Outcome:** the slick ComfyUI-style desktop experience, with phone/LAN remote
  control of host audio unchanged.

---

## 12. Open questions / risks

1. **Packaging the Node sidecar** (Phase 2) is the largest unknown — single-file
   Node build (SEA/`pkg`) vs bundling a runtime; per-OS code signing/notarization
   (macOS Gatekeeper especially — see `docs/MACOS_TROUBLESHOOTING.md`).
2. **Idle-reaper predicate + threshold** (§8.3) — needs tuning during
   implementation (how long idle before reaping; ensure paused-mid-track is never
   reaped). Bias toward not reaping.
3. **Config live-reload** — out of scope; restart required. Confirm that's fine
   for the settings app (save → prompt "restart to apply").
4. **`expose=true` security** — exposing the player to the LAN with no auth. Do
   we want a lightweight token/PIN on the *player* API when exposed? (Settings are
   loopback-only regardless.) Also decide whether `/healthz` is loopback-only when
   exposed (minor version-fingerprint leak). Flagged for a later decision.
5. **Windows ACL for `settings.json`** (§4.5) — `0600` is a no-op on Windows; an
   `icacls` shell-out (or accepting `%APPDATA%` per-user perms) is a real task.
6. **MCP-only scrobbler fallback handoff** (§6.4) — confirm the transition logic
   when a web server starts/stops while MCP is running never double- or
   zero-scrobbles during the handoff window.

> **Resolved by review + your decisions (no longer open):** env precedence
> (file-wins + CI opt-in flag, §4.2); mpv shutdown model (web-owner authority +
> idle reaper, no heartbeat registry, §8); playback model (remote control of host
> audio, §1); Tauri settings interop (our `settings.json` via fs, not
> plugin-store, §9.2); scrobbler ownership (§6.4); `loadConfig` contract (separate
> `resolveConfigState`, §4.6).

---

## 13. Documentation updates required (consequence of removing `.env`)

The `.env` removal ripples into docs that currently teach the env workflow:

- **`CLAUDE.md`** — the curl recipe pulls creds via `grep '^NAVIDROME_URL=' .env`.
  Rewrite to read from `settings.json` (e.g. `jq -r '.navidrome.url' "$(…store path…)"`).
  Update the "Environment" + "Local config lives in `.env`" sections to describe
  the settings store + `NAVIDROME_CONFIG_PATH`.
- **`tests/CLAUDE.md`** — update any `.env.test` / env-based testing guidance to
  the temp-`settings.json` approach (§4.9).
- **`README.md` / `docs/`** — replace MCP-JSON-with-env setup instructions with
  "launch, configure in the first-run UI" (env still documented as an advanced
  override).
- **`.env.example` → `settings.example.json`** — document the store shape.

These are tracked as Phase 0 deliverables (doc + code land together so the repo
is never in a state where the instructions don't match the code).

---

## 14. Summary of decisions

| # | Decision | Choice |
|---|---|---|
| Coexistence | How MCP-web and standalone-web share a host | **Port-as-lock + shared mpv**, on the *configured* port |
| MCP web launch | Embedded vs spawned | **MCP spawns the standalone `navidrome-web` detached**, eager at startup |
| Survive MCP close | Yes/no | **Yes** — separate process |
| Playback model | Where audio plays | **Host machine only**; phone/web/AI are remote controls (no browser audio) |
| Settings store | Where settings live | **Single GUI-managed JSON store**, dev + prod; **`.env`/runtime `dotenv` removed** (dotenv → devDep) |
| Settings precedence | File vs env | **File wins**; env only when file absent OR `NAVIDROME_CONFIG_ALLOW_ENV_OVERRIDE=1` (CI) |
| Settings writer | Who writes the file | **GUI/Tauri only** (via fs, our shape — *not* plugin-store); Node read-only except file-absent migration |
| Migration | Don't make users re-type | **Env-import on first run** (process.env + legacy `.env` via dotenv devDep) + `config:migrate` |
| Credentials | Where secrets live | **In the store file**, atomic `0600` write, never exposed remotely |
| `loadConfig` contract | Sentinel vs throw | Keep `loadConfig(): Config` throwing; add separate `resolveConfigState()` |
| First-run | Zero-config | **Config GUI on first run** + `open_settings` + degraded mode (settings server decoupled from mpv gate) |
| Settings exposure | Remote allowed? | **Never** — loopback only, even when player is exposed |
| Scrobbler | How plays are tracked | **Shared playback layer, observes mpv** → MCP- and web-initiated plays tracked identically. Single *active submitter* (web owner; MCP fallback) only to avoid double-submit — every mpv play scrobbled exactly once |
| mpv shutdown | When to stop mpv | **Web-owner authority**: owner kills on its shutdown iff not playing; **idle reaper** for crash-orphans; **MCP exit never kills mpv**; no heartbeat registry |
| Launcher | Icon/app | **Tauri window + system tray** wrapping the Node server as `externalBin` sidecar |
| Sequencing | Order | **Phase 0 refactor → Phase 1 settings app → Phase 2 web app** |
