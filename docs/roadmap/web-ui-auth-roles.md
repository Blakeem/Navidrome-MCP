# Web UI Auth + Roles

**Status (2026-10-17):** Release 1. The decisions in [README.md](README.md#web-ui-auth--roles) override this file where they differ: an access mode setting with `none` as the default, device access and username-and-password access, a login for every browser when access control is on (no trusted loopback browser), an admin account, and Argon2id. Read its flags before planning.

## Verdict

BUILD. The web remote has no authentication today. With `webui.expose` on, every device on the LAN can control playback and read the library. A web page open in any LAN browser can do the same through DNS rebinding. Node's standard library and the current request pipeline cover every part of the MVP except a QR encoder, which is one small MIT package with no dependencies. MVP effort is 5 to 8 working days [INFERRED]. The full roadmap is 12 to 20 working days, about 2.5 to 4 weeks [INFERRED].

## Scope

```
IN SCOPE:      the principal resolver, the role table, one permission on every web remote route,
               device grants, invite links with QR codes, the grant store, the redeem limiter,
               the origin gate, the host gate extension, SSE authentication and revocation,
               settings fields, config app fields, env vars, the upgrade path,
               extension points for Party Mode and Remote Player Agent
OUT OF SCOPE:  Party Mode request and vote routes and their rules (Party Mode owns them)
               the agent API, agent pairing UX, MCP-server-to-agent TLS (Remote Player Agent owns them)
               transport.authToken on the HTTP MCP transport (MCP clients are not browsers, and it works)
               the config app's access model (it binds loopback only and stays that way)
               native OIDC (rejected, see Releases)
               built-in TLS termination (rejected for now, see Releases)
BOUNDARY CASE: the lease route and the health route → IN, because the new gate sits in front of
               every route and must keep the MCP server process's loopback calls working
BOUNDARY CASE: per-user Navidrome identity for playback and scrobbles → OUT. Rule: auth decides who
               may call a route, not which Navidrome account performs it. The web player process
               always acts as the one configured account
BOUNDARY CASE: an MCP tool that mints a guest invite → OUT (Party Mode), but the invite route it
               calls is IN
```

## Feasibility

| Requirement | Status | Evidence |
|---|---|---|
| One place in the web remote HTTP server can gate every request | Verified | `src/webui/server.ts:97-199` is one flat if-chain. Every request passes the host gate (`:120`) and the JSON gate (`:127`) before any route runs [DIRECT: code] |
| Browser streams and images can carry a credential | Verified for cookies. Refuted for header tokens | `public/connection.js:19` and `public/visualizer.js:86` call `new EventSource(path)`. `public/cover.js:12` sets `img.src`. The `EventSource` constructor takes only `withCredentials`, and a same-origin stream sends cookies by default [DIRECT: WHATWG HTML, 2026-10-16] |
| Tokens and passwords can be hashed with no new dependency | Verified | `randomBytes`, `createHash`, `timingSafeEqual` and `scrypt` are in `node:crypto` for the entire supported range (`package.json:70-72`, `engines.node >=20.18.1`) [DIRECT: Node docs] |
| Grants survive a web player restart | Verified | The web player process stops with its last MCP by default (`src/web/main.ts:116-124`), so in-memory sessions would log phones out often. A file beside `settings.json` is writable: `navidrome-web.log` already lives there (`src/web/file-logging.ts:10`), and the Docker `/config` volume belongs to `node` (`Dockerfile:29-30`) [DIRECT: code] |
| A loopback caller can be told apart from a LAN caller | Verified, with one flaw | `isLocalRequest` requires a loopback peer and a loopback `Host` (`src/webui/loopback.ts:32-34`). nginx sets `Host $proxy_host` by default, so a same-host nginx passes both checks for every proxied request [DIRECT: nginx docs] [DERIVED] |
| Navidrome can back a login provider | Verified | `POST /auth/login` on the live Navidrome 0.62.0 returns `id`, `isAdmin`, `name`, `username`, `token`, `subsonicSalt` and `subsonicToken`. The token is an HS256 JWT with a measured 48-hour lifetime [DIRECT: live probe, 2026-10-17]. That matches the `SessionTimeout` default in v0.64.2 source (`consts/consts.go:36`) [DIRECT] |

Starting-list claims:

- "Token login" held. A random device token in an HttpOnly cookie is the recommended carrier (see Options).
- "A guest role limited to request/vote" held in part. The request and vote routes do not exist. Until Party Mode adds them, the guest role is view-only: now playing, queue, cover art, lyrics and the visualizer.
- "Days to 1 week" held for the MVP, at 5 to 8 working days. It did not hold for the full roadmap.
- "This unblocks everything below" was refuted in part. Music Assistant Bridge and Sonic-Similarity Tools are MCP tool features. Neither passes through the web remote HTTP server. Only Remote Player Agent and Party Mode depend on this item [DERIVED: the starting list's own descriptions].
- Music Assistant shipped this model already. MA 2.7 added users with ADMIN and USER roles. MA 2.8 added a GUEST role and join codes. MA 2.10 added a SERVICE role and a role-to-scope map [DIRECT: MA source at each tag]. That sequence matches the roles proposed here.

## Current system

```
  host browser                         LAN browser (phone, tablet, TV)
  http://127.0.0.1:8808                http://192.168.x.x:8808   (only when webui.expose=true
       │                                    │                     or webui.host is 0.0.0.0 or ::)
       ▼                                    ▼
┌─ web player process (src/web/main.ts) ────────────────────────────────────────────────────────┐
│  web remote HTTP server (src/webui/server.ts, plain node:http, flat if-chain dispatcher)      │
│    the URL parse stage, labeled stage 1                                    server.ts:107-117  │
│    the host gate, labeled stage 2 (loopback bind only)                     server.ts:120      │
│    the JSON gate, labeled stage 3 (every POST needs application/json)      server.ts:127      │
│    the route table, labeled stage 4                                        server.ts:132-198  │
│       open routes ─────────── any peer that reaches the port                                  │
│       loopback-trust routes ── isLocalRequest (src/webui/loopback.ts:32)                      │
│                                                                                               │
│  snapshot broadcaster (src/webui/broadcaster.ts) ──► SSE /api/events                          │
│  visualizer hub (src/webui/visualizer-hub.ts) ─────► SSE /api/visualizer                      │
│  cover proxy (src/webui/routes/cover.ts) ──► Navidrome, signed with navidrome.password        │
│  playback tools (src/tools/playback.ts) ── JSON-IPC ──► mpv                                   │
└──────────────▲─────────────────────────────────────────────────────────▲─────────────────────┘
               │ POST /api/mcp-lease via 127.0.0.1 (src/web/lease.ts:39)  │ writes webui keys
               │ GET /healthz via 127.0.0.1 (src/web/acquire.ts:65)       │ (routes/player.ts:93-116)
  MCP server process(es)                                        settings store
     └─ HTTP MCP transport (src/transport/http.ts),               (settings.json, src/config/store.ts)
        separate port, bearer transport.authToken                            ▲ loopback only
                                                                 config app (src/config-app/)
```

### Route inventory

What an unauthenticated LAN peer gets today, route by route. A LAN peer exists only when the web remote HTTP server has a LAN bind.

| Route | Gate today | What a LAN peer can do |
|---|---|---|
| `GET /healthz` | 404 off-host on a LAN bind (`routes/health.ts:25`) | Nothing |
| `GET /api/events` | none | Open the snapshot stream: now playing, queue, status, theme |
| `GET /api/visualizer`, `GET /api/visualizer/modes` | none | Open the level stream. Opening it starts the mpv level feed (`visualizer-hub.ts:50`) |
| `POST /api/controls/{pause,resume,next,previous,seek,volume,play-index,clear,shuffle}` | the JSON gate | Control playback, clear and shuffle the queue |
| `POST /api/library/play` | the JSON gate | Replace the queue with any album, artist, playlist or song |
| `GET /api/library/{search,artist-albums,album-songs}` | none | Read the entire library |
| `GET /api/library/{recent,favorites}` | none | Read listening history and starred counts |
| `GET /api/playlists` | none | Read up to 500 playlists of the configured account (`routes/playlists.ts:16-28`) |
| `GET /api/network-info` | none | Read the host's LAN addresses |
| `GET /api/player-state` | none | Read the theme and lyrics flags. `isLocal` is false |
| `GET /api/cover/:id` | none | Fetch any cover art by id. The cover proxy signs each Navidrome request with the configured password (`routes/cover.ts:60-65`). The password never reaches the browser |
| `GET /api/lyrics/:id` | none | Read lyrics of songs in the current queue only (`routes/lyrics.ts:65-77`) |
| `GET/POST /api/player/settings`, `POST /api/shutdown`, `POST /api/mcp-lease` | loopback trust (`routes/player.ts:54,72,140,156`) | Nothing (404) |
| static files | none | Load the app shell |

Gate observations:

- The host gate runs only for a loopback bind (`server.ts:120`). On a LAN bind nothing checks `Host`. A page on `evil.example` that rebinds its name to the host's LAN IP becomes same-origin with the web remote and can call every open route [DERIVED].
- The JSON gate is today's CSRF defense. A cross-site form cannot send `application/json`, and a cross-origin `fetch` with that type needs a CORS preflight [DIRECT: Fetch spec, 2026-10-06]. The server answers `OPTIONS` with 404 (`server.ts:198`) and sends no CORS headers, so the preflight fails [DIRECT: code].
- No route reads `Origin` [DIRECT: code].
- No rate limit exists. No cap bounds SSE clients (`broadcaster.ts:85-93`, `visualizer-hub.ts:42-56`).
- `README.md:425-433` documents the open routes and warns against internet exposure.

### HTTP MCP transport comparison

The HTTP MCP transport has one optional static bearer token, `transport.authToken`. It compares SHA-256 digests with `timingSafeEqual` (`src/transport/http.ts:297-306`). It answers 401 with `WWW-Authenticate: Bearer` (`:106-110`). It turns its Host allowlist on only for an unauthenticated loopback bind (`:274-291`). It has no roles, no rate limit and no revocation short of changing the token. `src/index.ts:163` warns about a LAN bind with no token. That model fits machine clients. It does not fit phones, because a bearer header cannot ride on `EventSource` or `<img>`.

### Threat scenarios

```
the loopback scenario       default host-only bind. Reachers: local OS users, web pages in the host browser
the home LAN scenario       webui.expose. Reachers: every LAN device, web pages in any LAN browser
the party Wi-Fi scenario    webui.expose on a network shared with guests. Reachers: guests and their devices
the reverse-proxy scenario  a proxy publishes the remote on the internet. Reachers: anyone on the internet
```

| Scenario | Exposure today | What the design must give |
|---|---|---|
| the loopback scenario | Other local OS users can control playback. The host gate and the JSON gate stop web pages [DIRECT: code] | Nothing new for a single-user host. A switch that turns loopback trust off on a shared host |
| the home LAN scenario | Every LAN device can do everything in the route inventory. Web pages can do the same through DNS rebinding [DERIVED] | Per-device enrollment with no typing, per-device revocation, and an end to rebinding |
| the party Wi-Fi scenario | Every guest can clear the queue and read the library and history. On plain http, a guest who knows a WPA2-Personal passphrase can decrypt another device's captured traffic, cookies included [SINGLE-SOURCE: Vanhoef, 2018-03] | A guest role with fewer permissions, guest grants that expire with the party, one-scan join, and a per-guest identity for Party Mode's limits |
| the reverse-proxy scenario | The internet gets the route inventory. A same-host nginx with its default `Host` rewrite also opens settings, shutdown and lease [DERIVED: nginx docs and `loopback.ts:32`] | Loopback trust that ignores proxied requests, login throttling, TLS at the proxy, optional forward-auth headers |

## Integration point

```
  browser (cookie grant)     machine client (Bearer grant,      host browser (loopback)
                             machine grant release)
        │                              │                               │
        ▼                              ▼                               ▼
┌─ web remote HTTP server (src/webui/server.ts) ───────────────────────────────────────────────┐
│ the URL parse stage                                                                          │
│ the host gate (extended): on a LAN bind, Host must be an IP literal, localhost, the machine  │
│   hostname, or a webui.auth.allowedHosts entry                                               │
│ the JSON gate (unchanged)                                                                    │
│ the origin gate (new, src/webui/auth/origin-gate.ts): on POST, Origin must match Host        │
│ the principal resolver (new, src/webui/auth/principal.ts) → one principal per request:       │
│     loopback principal ── isLocalRequest, trustLoopback on, no forwarding headers → owner    │
│     grant principal ───── Bearer header, else the session cookie → grant store lookup        │
│     anonymous principal ─ role from webui.auth.anonymousRole                                 │
│ the route table: each line names one permission. The permission check reads the role table   │
│   (new, src/webui/auth/roles.ts). A route with no permission is unreachable (default deny)   │
│ the auth routes (new, src/webui/routes/auth.ts) ── the redeem limiter (new)                  │
│ the stream registry: the snapshot broadcaster and the visualizer hub tag each client         │
│   with its grant id, so a revoke closes that device's streams                                │
└──────────────┬────────────────────────────────────────────────▲──────────────────────────────┘
               │ read and write                                  │ POST /api/auth/invites via 127.0.0.1
               ▼                                                 │
  the grant store (new, src/webui/auth/grant-store.ts,      the invite command (new, `navidrome-web invite`)
     file webui-auth.json beside settings.json, mode 0600)
  the settings store: new webui.auth block ◄── the config app (new form fields)
```

### Part placement

| Part | File | Why there |
|---|---|---|
| the host gate extension | `src/webui/server.ts`, helper in `src/webui/loopback.ts` | DNS rebinding needs a DNS name in `Host`. An IP-literal `Host` cannot be rebound, so this check closes rebinding even for anonymous access. Pi-hole uses the same rule in its no-password mode [DIRECT: FTL v6.8 `src/api/auth.c:150-200`] |
| the origin gate | `src/webui/auth/origin-gate.ts` | It runs beside the JSON gate, so every CSRF defense sits in one request pipeline |
| the principal resolver | `src/webui/auth/principal.ts` | It replaces the scattered `isLocalRequest` calls in `routes/player.ts` and `routes/health.ts` with one decision per request |
| the role table | `src/webui/auth/roles.ts` | One static map from role to permission names. Party Mode and Remote Player Agent extend it in this one file |
| the permission check | each dispatcher line in `src/webui/server.ts` | The dispatcher comment (`server.ts:67-70`) keeps every accepted path in plain sight. A permission on the same line keeps every access rule in plain sight too |
| the grant store | `src/webui/auth/grant-store.ts`, file `webui-auth.json` | Grants change on every redeem and revoke. `settings.json` is GUI-managed config, may be mounted read-only in Docker (`docs/DOCKER.md:94`), and is rewritten from the form by the config app (`src/config-app/routes.ts:63-78`) |
| the auth routes | `src/webui/routes/auth.ts` | Same pattern as the other route modules |
| the redeem limiter | `src/webui/auth/rate-limit.ts` | The auth routes use it in the MVP. Party Mode reuses it per principal |
| the stream registry | `src/webui/broadcaster.ts`, `src/webui/visualizer-hub.ts` | `addClient` gains the principal |
| the shared secret helpers | `src/utils/secrets.ts` | The constant-time compare moves out of `transport/http.ts:297-306`, so the transport and the web remote share one implementation |
| the invite command | an argv branch in `src/web/main.ts` | The running web player process owns the grant store, so the command asks it over loopback and never writes the file itself. No entry point parses argv today |
| the join view, the devices panel | `src/webui/public/join.js`, `src/webui/public/devices.js` | The browser client boots from `GET /api/player-state` (`public/app.js:39`). A 401 there shows the join view. The devices panel replaces the `isLocal` toggle in `public/local-controls.js:25` with permission checks |

### Role and permission table

| Permission | Routes | owner | listener | guest | machine |
|---|---|---|---|---|---|
| `player.view` | `GET /api/events`, `/api/visualizer`, `/api/visualizer/modes`, `/api/player-state`, `/api/cover/:id`, `/api/lyrics/:id` | yes | yes | yes | Remote Player Agent decides |
| `player.control` | `POST /api/controls/*` | yes | yes | no | Remote Player Agent decides |
| `library.browse` | `GET /api/library/{search,artist-albums,album-songs}`, `GET /api/playlists` | yes | yes | no (Party Mode decides) | Remote Player Agent decides |
| `library.history` | `GET /api/library/{recent,favorites}` | yes | yes | no | no |
| `library.play` | `POST /api/library/play` | yes | yes | no | Remote Player Agent decides |
| `host.info` | `GET /api/network-info` | yes | yes | no | no |
| `player.settings` | `GET/POST /api/player/settings` | yes | no | no | no |
| `player.power` | `POST /api/shutdown` | yes | no | no | no |
| `player.lease` | `POST /api/mcp-lease` | loopback | no | no | no |
| `health.read` | `GET /healthz` | loopback | no | no | yes |
| `auth.self` | `GET /api/auth/session`, `POST /api/auth/logout` | yes | yes | yes | yes |
| `auth.manage` | `POST /api/auth/invites`, `GET /api/auth/devices`, `POST /api/auth/devices/revoke`, `POST /api/auth/invites/revoke` | yes | no | no | no |
| none (public) | static files, `POST /api/auth/redeem` | | | | |
| `party.request`, `party.vote` (reserved) | Party Mode adds `/api/party/*` | Party Mode decides | Party Mode decides | yes | no |
| `party.moderate` (reserved) | Party Mode adds | yes | no | no | no |
| `agent.control`, `agent.read` (reserved) | Remote Player Agent adds `/api/agent/v1/*` | Remote Player Agent decides | no | no | yes |

The lease route and the health route stay open to loopback peers even with `trustLoopback` off, since the lease client and the port-as-lock probe connect through 127.0.0.1 (`src/web/lease.ts:39-47`, `src/web/acquire.ts:51-65`). Party Mode adds its party control routes to this loopback exception, since the MCP server's party tools call them over 127.0.0.1.

The machine column takes effect with the machine grant release. Until then, only the loopback principal reaches `health.read`. `player.lease` stays loopback-only, since Remote Player Agent runs each agent standalone and no remote MCP server leases it.

### Data shapes

```jsonc
// settings.json, MVP fields
"webui": {
  "auth": {
    "anonymousRole": "none",   // none | guest | listener. listener reproduces today's LAN behavior
    "trustLoopback": true,     // false makes the host browser enroll like any other device
    "allowedHosts": []         // DNS names the host gate accepts on a LAN bind, such as "music.home.arpa:8808"
  }
}

// webui-auth.json, mode 0600, written with the temp-file-and-rename pattern of src/config/store.ts:118-145
{
  "version": 1,
  "grants":  [{ "id", "tokenDigest", "role", "kind": "browser|machine", "label", "inviteId",
                "createdAt", "lastUsedAt", "expiresAt" }],
  "invites": [{ "id", "codeDigest", "role", "label", "maxUses", "uses", "expiresAt" }]
}
```

Device tokens and invite codes are 256-bit values from `randomBytes(32)`. The grant store keeps only their SHA-256 digests. A fast digest is enough for a 256-bit random secret, since slow hashing only protects guessable secrets [INFERRED]. OWASP asks for at least 64 bits of session-id entropy [DIRECT: OWASP Session Management Cheat Sheet].

### Extension points

- Needs from Web UI Auth + Roles, for Party Mode: the guest role, whose permission set Party Mode extends with `party.request` and `party.vote`. Multi-use guest invites with `maxUses` and `expiresAt`. Revocation of every grant redeemed from one invite. A stable `principal.grantId` and `principal.label` passed to route handlers, so per-guest limits are enforced on the server. The redeem limiter, reusable per principal. The stream registry, for guest-only events. `anonymousRole: "guest"` for an open party with no join step.
- Needs from Web UI Auth + Roles, for Remote Player Agent: the machine grant kind, presented as `Authorization: Bearer <token>` and never as a cookie, with the reserved `machine` role. That role holds `health.read`, and Remote Player Agent extends it with `agent.control` and `agent.read` for its agent API. Remote Player Agent also needs a way to create a machine grant on the agent machine that shows the token once. It defines the rest of the `machine` permission set, the pairing UX and transport security.

## Options

### Criteria

| Criterion | Weight | Meaning |
|---|---|---|
| Maintainability | 0.30 | Code size, new dependencies, moving parts, test surface |
| Best-practice match | 0.25 | How popular comparable tools and current security guidance decide it |
| Security | 0.20 | Protection across the four threat scenarios |
| User friction | 0.15 | Effort for phones, guests and headless hosts |
| Extension fit | 0.10 | What Party Mode and Remote Player Agent can reuse |

Scores run from 1 to 5. Each score is a judgment with an uncertainty of about one point. One cell moving one point shifts a weighted total by at most 0.30, so totals within 0.30 count as a tie [INFERRED].

### Enrollment method

How a device first proves it may use the web remote.

| Criterion (weight) | owner password | Navidrome login | invite link + QR | forward-auth header | OIDC |
|---|---|---|---|---|---|
| Maintainability (0.30) | 5 | 3 | 4 | 4 | 1 |
| Best-practice match (0.25) | 4 | 3 | 4 | 4 | 3 |
| Security (0.20) | 3 | 3 | 4 | 2 | 4 |
| User friction (0.15) | 3 | 3 | 5 | 2 | 1 |
| Extension fit (0.10) | 2 | 2 | 5 | 2 | 2 |
| Weighted total | 3.75 | 2.90 | 4.25 | 3.10 | 2.20 |

Flip check: the smallest change that flips the winner is maintainability weight 0.30 to above 0.80, which makes the owner password win. ROBUST.

Score notes:

- The owner password is one hash and one form. One shared secret gets typed on phones over plain http, and it cannot be handed to guests.
- The Navidrome login sends every attempt to Navidrome from the web player process's one IP. Navidrome limits `POST /auth/login` to 5 per 20 s per client IP [DIRECT: Navidrome v0.64.2 `conf/configuration.go:1043-1044`, `server/middlewares.go:235-247`], so one family member's typos throttle the entire household [DERIVED]. Guests have no Navidrome account. A Navidrome that uses reverse-proxy auth has no password to type.
- The invite link + QR needs no typing and gives one revocable grant per device. The same grant model carries guest joins for Party Mode and machine pairing for Remote Player Agent.
- The forward-auth header is a few lines, but it needs an auth proxy and is spoofable when the trusted-source list is wrong.
- OIDC needs an identity provider and https redirect URIs. RFC 9700 forbids http redirect URIs except loopback redirects of native clients [DIRECT: RFC 9700 §2.6], so a plain `http://192.168.x.x` remote cannot use a compliant provider.

Comparable tools:

- Owner password: code-server generates a 24-character password even on 127.0.0.1 [DIRECT: v4.141.0 `src/node/cli.ts:745-760`]. Syncthing uses one user and a bcrypt password. Pi-hole uses one password plus an app password. OwnTone uses `admin_password` over HTTP Basic.
- Invite or join codes: MA 2.8 join codes are 12 characters, last 8 hours, are single use and exist only for GUEST users [DIRECT: MA 2.10.7 `controllers/webserver/auth.py:89-105`]. The MA Party plugin joins guests by QR with no account. Jellyfin Quick Connect pairs a device with a 6-digit code that a logged-in user approves within 10 minutes [DIRECT: Jellyfin v12.2 `QuickConnectManager.cs:26-31`].
- Forward-auth: Navidrome reads `ExtAuth.UserHeader` (default `Remote-User`) only from `ExtAuth.TrustedSources` CIDRs [DIRECT: v0.64.2 `server/auth.go:212-231`]. Grafana uses `auth.proxy` with `X-WEBAUTH-USER` and a whitelist. MA trusts `X-Remote-User-*` only from the Home Assistant Supervisor IP.
- OIDC: Grafana ships generic OAuth. Navidrome has no OIDC and relies on forward-auth.

### Browser session carrier

How an enrolled browser presents its grant on each request.

| Criterion (weight) | HttpOnly cookie | bearer token in localStorage | token in query string |
|---|---|---|---|
| Maintainability (0.30) | 5 | 2 | 4 |
| Best-practice match (0.25) | 4 | 4 | 2 |
| Security (0.20) | 4 | 3 | 1 |
| User friction (0.15) | 5 | 5 | 5 |
| Extension fit (0.10) | 4 | 4 | 3 |
| Weighted total | 4.45 | 3.35 | 2.95 |

Flip check: no single weight change flips the winner, since the HttpOnly cookie scores equal or higher on every criterion. ROBUST.

Score notes:

- The HttpOnly cookie needs no change in `connection.js`, `visualizer.js` or `cover.js`.
- The localStorage bearer needs a fetch-based SSE reader (such as `eventsource-parser` 4.1.2) with its own reconnect, and blob URLs for every cover. OWASP says "Do not store session identifiers in local storage" [DIRECT: OWASP HTML5 Security Cheat Sheet].
- A query-string token leaks into logs, history and caches [DIRECT: OWASP REST Security Cheat Sheet].

Comparable tools: Syncthing (`sessionid-<shortDeviceID>`), code-server (`code-server-session`), Grafana (`grafana_session`) and Pi-hole (`sid`, HttpOnly, SameSite=Lax) use cookies. Navidrome (`X-ND-Authorization`), Jellyfin (`X-Emby-Token`), Home Assistant and MA (Bearer JWT) use header tokens. Home Assistant adds signed media URLs (`authSig`) because an image tag cannot send its bearer token [DIRECT: HA 2026.10.2 `homeassistant/components/http/auth.py:43-92`]. Every surveyed tool gives machines a header token, which is the machine grant's path here.

### Grant persistence

Where an issued grant lives between requests.

| Criterion (weight) | grant store file | stateless signed token | in-memory session |
|---|---|---|---|
| Maintainability (0.30) | 4 | 4 | 5 |
| Best-practice match (0.25) | 5 | 3 | 2 |
| Security (0.20) | 5 | 3 | 4 |
| User friction (0.15) | 5 | 5 | 1 |
| Extension fit (0.10) | 5 | 3 | 2 |
| Weighted total | 4.70 | 3.60 | 3.15 |

Flip check: no single weight change flips the winner. The grant store file scores equal or higher than the stateless signed token on every criterion. The in-memory session would need a maintainability weight above 1.85. ROBUST.

Comparable tools: Home Assistant keeps refresh tokens that expire after 90 days of non-use and offers `/auth/revoke` [DIRECT: HA 2026.10.2 `homeassistant/auth/const.py:5-7`]. MA keeps token rows in its database, with 30-day sliding tokens capped at 90 days and 1-day guest tokens [DIRECT: MA 2.10.7 `auth.py:74-79`]. Jellyfin revokes a device's sessions when the device is deleted. Pi-hole restores sessions across restarts. Navidrome is stateless. A per-user token epoch revokes all of one user's tokens at once [DIRECT: v0.64.2 `core/auth/auth.go:141-154`]. code-server's cookie is a hash of the password, so only a password change logs a device out.

### Role model

| Criterion (weight) | fixed roles over permission names | per-grant custom permissions | one role for every grant |
|---|---|---|---|
| Maintainability (0.30) | 5 | 2 | 5 |
| Best-practice match (0.25) | 5 | 3 | 3 |
| Security (0.20) | 4 | 4 | 2 |
| User friction (0.15) | 5 | 2 | 5 |
| Extension fit (0.10) | 5 | 5 | 1 |
| Weighted total | 4.80 | 2.95 | 3.50 |

Flip check: no single weight change flips the winner, since fixed roles over permission names score equal or higher than both other options on every criterion. ROBUST.

Comparable tools: MA maps ADMIN, USER, GUEST and SERVICE onto scopes such as `PLAYERS_CONTROL` and `QUEUES_READ` [DIRECT: MA 2.10.7 `controllers/webserver/helpers/auth_middleware.py:37-68`]. Grafana maps Viewer, Editor, Admin and None onto RBAC actions. Home Assistant maps `system-admin`, `system-users` and `system-read-only` onto policies. Jellyfin uses per-user policy flags. Snapcast has per-role JSON-RPC method lists in code since v0.32.0, but every release forces them off [DIRECT: v0.35.0 `server/snapserver.cpp`, `settings.auth.enabled = false`]. Syncthing, code-server and OwnTone have one role.

### CSRF defense

Cookie sessions make every browser request carry the grant, so a cross-origin request must not ride on it.

| Criterion (weight) | layered gates | synchronizer token | SameSite only |
|---|---|---|---|
| Maintainability (0.30) | 5 | 3 | 5 |
| Best-practice match (0.25) | 4 | 4 | 2 |
| Security (0.20) | 4 | 5 | 3 |
| User friction (0.15) | 5 | 5 | 5 |
| Extension fit (0.10) | 5 | 4 | 5 |
| Weighted total | 4.55 | 4.05 | 3.85 |

The layered gates are the existing JSON gate, the new origin gate, the extended host gate, and a `SameSite=Strict` cookie.

Flip check: the smallest change that flips the winner is maintainability weight 0.30 to below 0.05, which makes the synchronizer token win. ROBUST.

Score notes:

- Browsers send `Sec-Fetch-Site` only to potentially trustworthy URLs, so a `http://192.168.x.x` remote never receives it [DIRECT: Fetch Metadata WD, 2026-09-21]. The origin gate therefore compares `Origin` with `Host`, the fallback step of Go 1.25's `CrossOriginProtection` [DIRECT: pkg.go.dev net/http, Valsorda 2025-08-13].
- A same-origin `fetch` POST over http carries `Origin` [DIRECT: Fetch spec, 2026-10-06].
- SameSite alone fails here. The site of an IP host is the IP itself, and ports are ignored. Every other service on the same host is therefore same-site [DIRECT: WHATWG HTML "obtain a site"].
- OWASP lists "disallow simple content types" and Origin verification as defenses, and SameSite as defense in depth [DIRECT: OWASP CSRF Prevention Cheat Sheet].
- `SameSite=Strict` costs nothing here, since the app shell is public and every API call is same-origin. Safari is not Lax-by-default, so the attribute is set explicitly [DIRECT: MDN browser-compat-data].

Comparable tools: Syncthing pairs a CSRF cookie with an `X-CSRF-Token-<id>` header [DIRECT: v2.1.6 `lib/api/api_csrf.go:17-96`]. Pi-hole requires a CSRF header only when the session id came from a cookie. code-server compares `Origin` with `Host` and honors `X-Forwarded-Host` [DIRECT: v4.141.0 `src/node/http.ts:340-420`].

### LAN default posture

What a LAN peer gets when the settings store has no `webui.auth` block. This decides the upgrade experience.

| Criterion (weight) | open-LAN default | enrolled-LAN default | enrolled-everywhere default |
|---|---|---|---|
| Maintainability (0.30) | 5 | 4 | 3 |
| Best-practice match (0.25) | 3 | 4 | 5 |
| Security (0.20) | 2 | 4 | 5 |
| User friction (0.15) | 5 | 4 | 2 |
| Extension fit (0.10) | 3 | 5 | 5 |
| Weighted total | 3.70 | 4.10 | 3.95 |

- The open-LAN default sets `anonymousRole: "listener"`, which is today's behavior.
- The enrolled-LAN default sets `anonymousRole: "none"` and keeps loopback trust.
- The enrolled-everywhere default sets `anonymousRole: "none"` and turns loopback trust off. The host browser then enrolls like any device, and the auto-open path (`src/web/main.ts:50-54`) needs a one-time token URL. The lease route and the health route stay open to loopback peers in every posture.

Flip check: the smallest change that flips the winner is user friction weight 0.15 to below 0.075, which makes the enrolled-everywhere default win. FRAGILE, since the gap of 0.15 sits inside the 0.30 tie band.

Comparable tools: Syncthing has no auth until a user and password are set, and shows a danger banner only when the GUI listens off loopback [DIRECT: v2.1.6 `gui/default/index.html:138-151`]. OwnTone trusts the LAN by default (`trusted_networks = { "lan" }`). Pi-hole runs open with a Host guard when no password is set. Home Assistant's `trusted_networks` is opt-in and refuses requests from proxies. code-server, Navidrome, Jellyfin, Home Assistant, MA and Grafana require login everywhere. Grafana's anonymous access is opt-in with a configurable role (`[auth.anonymous] org_role`), which is the model `anonymousRole` follows.

### Password hash

This decision applies to the password login release, where the owner password and the optional password login arrive. The MVP stores only digests of random tokens.

| Criterion (weight) | node:crypto scrypt | node:crypto Argon2id | `argon2` npm | `bcryptjs` |
|---|---|---|---|---|
| Maintainability (0.30) | 5 | 3 | 2 | 4 |
| Best-practice match (0.25) | 4 | 5 | 5 | 3 |
| Security (0.20) | 4 | 5 | 5 | 3 |
| User friction (0.15) | 5 | 4 | 3 | 5 |
| Extension fit (0.10) | 5 | 5 | 5 | 5 |
| Weighted total | 4.55 | 4.25 | 3.80 | 3.80 |

Flip check: the smallest change that flips the winner is maintainability weight 0.30 to below 0.15, which makes node:crypto Argon2id win. A second flip needs no weight change. Raising `engines.node` to `>=24.19` lifts Argon2id's maintainability to 5 and its total to 4.85. FRAGILE.

Score notes:

- `crypto.argon2` arrived in Node 24.7.0 as a release candidate and became stable in 24.19.0 LTS (2026-08-03). Node 22 has none [DIRECT: Node docs and changelogs]. The repo allows Node `>=20.18.1` and the Docker image uses `node:22`. Node 20 reached end of life on 2026-04-30. Node 22 ends on 2027-04-30 [DIRECT: nodejs/Release schedule].
- OWASP lists scrypt at N=2^17, r=8, p=1 (128 MiB) and equal-strength variants such as N=2^15, p=3 [DIRECT: OWASP Password Storage Cheat Sheet]. N=2^17 fails with the default `maxmem` and passes above 128 MiB, at about 300 ms on Node 24.15 [DIRECT: local run by the research agent]. The N=2^15, p=3 variant uses about 32 MiB, which suits a Raspberry Pi [DERIVED].
- The `argon2` npm package is a native addon with prebuilt binaries for a fixed platform list. Other platforms compile with node-gyp [DIRECT: npm registry, 0.45.1].
- `bcryptjs` reads only the first 72 bytes of a password [DIRECT: bcryptjs README, 3.0.3].

Comparable tools: Home Assistant (bcrypt, 12 rounds), Syncthing (bcrypt), code-server (`argon2` npm), Jellyfin (PBKDF2-SHA512), MA (PBKDF2-SHA256, 100000 iterations), Pi-hole (Balloon-SHA256). Navidrome stores passwords with reversible AES-GCM, because Subsonic token auth needs the plaintext [DIRECT: v0.64.2 `utils/encrypt.go:18-24`].

## Recommendation

- Enrollment method: invite link + QR. The owner creates an invite from the devices panel on the host browser, or with the invite command on a headless host. A phone scans the QR, and the join view redeems the code for a device grant. Forward-auth arrives in the proxy deployment release. The owner password and the Navidrome login arrive in the password login release as extra ways to mint the same grant.
- Browser session carrier: an HttpOnly cookie with `SameSite=Strict` and `Path=/`, named with the port (`ndmcp-web-8808`), since cookies are shared across ports of one host [DIRECT: RFC 6265 §8.5]. `Secure` is added only when the request arrived over TLS. Machine grants use `Authorization: Bearer`.
- Grant persistence: the grant store file `webui-auth.json`, holding digests only. Browser grants expire after 90 days of non-use, the same as Home Assistant refresh tokens. Guest grants expire with their invite. Machine grants last until revoked.
- Role model: fixed roles (owner, listener, guest, machine) over permission names, with default deny for any route that names none.
- CSRF defense: the layered gates. The JSON gate stays. The origin gate requires `Origin` to match `Host` on every POST that carries a cookie. The host gate extension closes DNS rebinding.
- LAN default posture: the enrolled-LAN default, with `anonymousRole: "listener"` as a documented one-line opt-out. This decision is open (see Open decisions).
- Password hash: node:crypto scrypt at N=2^15, r=8, p=3 with an explicit `maxmem`, stored as a PHC-style string that names the algorithm, so a later move to Argon2id rehashes at the next login. This decision is open (see Open decisions).

## Open decisions

The LAN default posture decision:

- Options: the enrolled-LAN default, the enrolled-everywhere default, and the open-LAN default.
- What tips it: a lower weight on user friction, a higher weight on security, or a multi-user host where other OS accounts should not control playback, favors the enrolled-everywhere default. A strong wish to avoid any phone re-enrollment on upgrade favors the open-LAN default.
- Question: should the host browser at 127.0.0.1 stay trusted as owner with no login, and should phones on the LAN need an invite after the upgrade, or stay open until you turn auth on?

The password hash decision:

- Options: node:crypto scrypt and node:crypto Argon2id.
- What tips it: raising `engines.node` to `>=24.19` before the password login release, and moving the Docker image to `node:24`, makes Argon2id the winner with no new dependency.
- Question: will the project drop Node 20 and 22 support before the password login release ships?

## Plan overview

Steps in dependency order. Each names the parts it adds or changes.

1. The shared secret helpers: move the constant-time compare from `src/transport/http.ts:297-306` into `src/utils/secrets.ts`, and add random-token and SHA-256-digest helpers. Requires nothing.
2. The settings fields: add `webui.auth` to `SettingsFileSchema` (`src/config/store.ts:60-70`), `ConfigSchema` (`src/config/schema.ts:62-75`), `mapStoreToConfig` (`src/config/map-config.ts:112-121`), `buildEnvRuntimeSettings` (`src/config/env-settings.ts:121-128`, as `WEBUI_AUTH_ANONYMOUS_ROLE`, `WEBUI_AUTH_TRUST_LOOPBACK`, `WEBUI_AUTH_ALLOWED_HOSTS`) and the config app's `FIELDS` table (`src/config-app/public/app.js:7-36`). Requires nothing.
3. The grant store: generalize the atomic write in `src/config/store.ts:118-145` into a shared helper and use it for `webui-auth.json`. Requires step 1.
4. The role table: permission names and the four roles. Requires nothing.
5. The principal resolver: loopback principal (refused when `Forwarded`, `X-Forwarded-For` or `X-Real-IP` is present), grant principal, anonymous principal. Requires steps 1 to 4.
6. The request pipeline in `src/webui/server.ts`: the host gate extension, the origin gate, one permission per dispatcher line, default deny. Requires steps 4 and 5.
7. The auth routes and the redeem limiter: session, redeem, logout, invites, devices, revoke. Requires steps 3, 5 and 6.
8. The stream registry: tag SSE clients with the grant id, and close them on revoke and on expiry. Requires steps 5 and 7.
9. The browser client: the join view, 401 handling in `public/api.js`, permission-driven controls in place of `isLocal`, and the devices panel with a QR image from `uqr`. Requires step 7.
10. The invite command: `navidrome-web invite [--role] [--expires] [--base-url]`, which calls the running web player over loopback and prints a link and a terminal QR. Requires step 7.
11. Tests and docs: one table-driven test that walks every dispatcher route against every role, plus a rewrite of the README security note (`README.md:425-433`). Requires all earlier steps.

## Edge cases

| Edge case | Part | Intended behavior |
|---|---|---|
| A same-host nginx rewrites `Host` to `127.0.0.1:8808` | the principal resolver | A request with `Forwarded`, `X-Forwarded-For` or `X-Real-IP` never becomes the loopback principal |
| A headless host with `webui.expose` upgrades | the join view, the invite command | Phones see enrollment steps. `navidrome-web invite`, or `docker exec <container> node dist/web/main.js invite`, prints a link and a terminal QR. The web player logs one line on start when it has a LAN bind and zero grants |
| `settings.json` is mounted read-only in Docker | the grant store | The grant store writes `webui-auth.json` in the writable `/config` volume. If that write fails, the auth routes answer 503 with the path and reason, and loopback trust keeps working |
| The host browser is on 127.0.0.1 and phones need a LAN URL | the devices panel | The invite link is built from `listLanInterfaces` (`src/webui/network.ts:22`) with an interface picker, not from the page's own origin |
| The invite command runs in a container | the invite command | It accepts `--base-url`, since container IPs are not the host's LAN address |
| A chat app fetches the invite link for a preview | the auth routes | The code sits in the URL fragment, which never reaches the server. Only the join view's POST redeems it, so a GET never consumes an invite |
| A QR reader drops the URL fragment | the join view | Untested on real phones [ABSENT]. The join view also accepts the code in a text field |
| A revoked device holds an open SSE stream | the stream registry | The stream closes at once. The browser's reconnect gets 401, and a non-200 answer leaves `EventSource` closed for good [DIRECT: WHATWG HTML]. The browser client then shows the join view |
| A grant expires during an open stream | the stream registry | The heartbeat sweep closes the stream |
| Every request updates `lastUsedAt` | the grant store | The value updates in memory and flushes at most once every few minutes and at shutdown, which spares SD cards on a Raspberry Pi |
| Another service on the same host receives the cookie | the session cookie | The cookie name carries the port. The README states that every service on that host receives the cookie, and that a separate hostname with TLS isolates it |
| A plain-http LAN origin drops `Secure` cookies | the session cookie | `Secure` is set only on TLS requests. On http the cookie is HttpOnly and SameSite=Strict, and the README states that the LAN can read it |
| Insecure-context browser APIs on a LAN origin | the browser client | Wake lock already falls back to a video (`public/wake-hold.js:7`). The devices panel avoids Clipboard and Web Share on LAN origins and shows a QR plus selectable text. The host browser on 127.0.0.1 is a secure context, so copy works there |
| A request carries a Bearer header and a cookie | the principal resolver | The Bearer header wins. The origin gate skips the `Origin` check only for requests with no cookie |
| A reverse proxy rewrites `Host`, so `Origin` never equals it | the origin gate | The gate also accepts an `Origin` that matches `X-Forwarded-Host` or `Forwarded: host=`, as code-server does. A cross-site page cannot add those headers without a preflight, which the server never approves |
| One device or many guests open SSE streams in bulk | the stream registry | Each grant holds a small fixed number of streams, and the oldest closes first. Anonymous streams share one global cap |
| A listener calls an owner route | the permission check | 403 with a code. `GET /healthz` keeps its 404 off-host, so the version fingerprint stays hidden |
| The owner loses every owner device | the principal resolver, the invite command | Loopback trust or `navidrome-web invite --role owner` from a host shell restores access. With `trustLoopback` off on a headless host, moving `webui-auth.json` to the Recycle Bin resets every grant |
| Two devices redeem the last use of an invite at once | the grant store | The web player process serializes writes, so the first redeem wins and the second gets 410 |
| The env fallback runs with no `settings.json` | the settings fields | The `WEBUI_AUTH_*` env vars apply. The grant store still lives beside the default settings path |
| New secret fields reach the logger | the logger redaction (`src/utils/logger.ts:37-38`) | `tokenDigest` and `codeDigest` do not match the redacted suffixes. The plan extends the suffix list with `digest` and `cookie`, and the auth code never logs the `Cookie` header |
| A config app save omits the new fields | the config app | `FIELDS` gains the `webui.auth` rows, and a test covers the round trip, the same guard `webui.theme` has (`src/config-app/routes.ts:111-116`) |
| A guest Wi-Fi isolates clients from the main LAN | the party Wi-Fi scenario | Auth works on whichever network reaches the port. Network layout is Party Mode's concern [INFERRED: router-dependent] |
| A password login is locked by a LAN attacker (the password login release) | the redeem limiter | Existing grants and loopback trust keep working, since neither uses the password |

## Releases

### Device enrollment MVP

- Capability: phones and tablets join by scanning an invite QR from the host. The owner lists and revokes devices. A guest invite gives a view-only display, such as a TV showing now playing, lyrics and the visualizer. `anonymousRole` restores today's open LAN in one line.
- Parts: the shared secret helpers, the settings fields, the grant store, the role table, the principal resolver, the host gate extension, the origin gate, the auth routes, the redeem limiter, the stream registry, the join view, the devices panel, the invite command.
- Acceptance check:
  1. With `webui.expose` on and default settings, a new LAN client gets 401 from every `/api` route except `/api/auth/session` and `/api/auth/redeem`.
  2. A listener invite lets a phone control playback. A guest invite lets a device only view.
  3. A revoke closes that device's streams within one second, and its next request gets 401.
  4. The host browser at 127.0.0.1 works with no enrollment. The MCP lease and the port-as-lock probe work unchanged.
  5. A request through a same-host nginx never gets owner permissions.
  6. A `Host: evil.example` request to a LAN bind gets 403.
  7. `anonymousRole: "listener"` reproduces today's LAN behavior.
  8. The route-by-role table test passes, and `pnpm check:all`, `pnpm test:run` and `pnpm build` are clean.
- Effort: 5 to 8 working days [INFERRED].

### Password login release

- Capability: an owner password for owner login from any device. An optional Navidrome login that maps `isAdmin` to owner and other users to listener.
- Parts: the password hasher (per the open decision), a login form in the join view, an account-level backoff in the redeem limiter, a Navidrome login provider that calls `POST /auth/login` and keeps neither the password nor the Navidrome token.
- Acceptance check: a correct password mints an owner grant. A sixth wrong attempt inside the window gets 429. A Navidrome non-admin gets a listener grant. The settings store holds only the PHC hash string.
- Effort: 2 to 4 working days [INFERRED].

### Proxy deployment release

- Capability: the web remote runs safely behind Caddy, nginx or Tailscale Serve, with optional single sign-on through a forward-auth proxy.
- Parts: `webui.auth.trustedProxies` (CIDRs whose `X-Forwarded-For` the limiter trusts, as Navidrome's `realIPMiddleware` does), `webui.auth.proxyUserHeader` (such as `Remote-User` or `Tailscale-User-Login`) with a list of owner users, `Secure` cookies on https, `Cache-Control: private` for the cover proxy (today `public`, `routes/cover.ts:106`), `webui.auth.publicUrl` for invite links, README recipes for Caddy and Tailscale Serve.
- Acceptance check: a spoofed user header from an untrusted peer is ignored. A trusted header maps to the configured role. Behind https, the cookie carries `Secure`.
- Effort: 3 to 5 working days [INFERRED].

### Machine grant release

- Capability: an MCP server on another machine probes a web player and calls the agent API that Remote Player Agent adds, with a Bearer token. A TV with no camera shows a short code that the owner approves from a phone, in Jellyfin Quick Connect's direction.
- Parts: the machine grant kind, the `machine` role with `health.read` (Remote Player Agent adds `agent.control` and `agent.read`), a pairing-code route with a short expiry and the redeem limiter.
- Acceptance check: a machine grant passes `GET /healthz` from a non-loopback host, and the lease route still refuses it. A cookie never authenticates a machine grant. A pairing code expires after 10 minutes.
- Effort: 2 to 3 working days [INFERRED]. Remote Player Agent consumes it.

### Rejected ideas

- OIDC, the bearer token in localStorage, the token in query string, the stateless signed token and per-grant custom permissions each lost their matrix in Options. Forward-auth proxies such as Authelia, Authentik and oauth2-proxy give OIDC through the proxy deployment release, the same path Navidrome uses.
- Reusing `transport.authToken` for the web remote. One static secret allows no per-device revocation, and a phone would hold the credential that opens every MCP tool.
- Built-in TLS. Phones warn on self-signed certificates, and mkcert needs its root CA installed on every phone [DIRECT: mkcert README]. Caddy and Tailscale Serve already issue trusted certificates. Revisit on request.
- TOTP two-factor auth. Pi-hole offers it. Per-device grants on a home LAN gain little from it.
- Client-side party limits. The MA Party plugin docs say guest allowances live in the guest's browser. Party Mode must enforce limits on the server by `principal.grantId`.

## Dependencies

On other roadmap items: none. The capabilities this item provides to Party Mode and Remote Player Agent are listed under Extension points.

On external services:

- Navidrome `POST /auth/login`, used only by the password login release. Verified on the live server (0.62.0) and in v0.64.2 source.
- Caddy, nginx or Tailscale Serve, used only by the proxy deployment release recipes. Each is optional for users.

On npm packages:

| Package | Use | License | Status |
|---|---|---|---|
| `uqr` 0.1.3 | QR code as SVG for invite links (MVP) | MIT | Published 2026-04-03, 0 dependencies, ESM, about 6.1M downloads a week |
| `qrcode-generator` 2.0.4 | Alternative to `uqr` | MIT | Published 2025-08-07, 0 dependencies |
| `qrcode` 1.5.4 | Rejected | MIT | 29 installed packages, no release since 2024-08-05 |

The password login release adds no package if the password hash uses node:crypto. No OIDC library is planned.

## Risks

Assume the feature shipped and failed.

| Failure mode | Assumption it violated |
|---|---|
| Headless exposed installs lose phone access after the upgrade, and users roll back | Every owner can reach a browser on the host |
| A same-host nginx hands owner permissions to the internet | A loopback peer is a local user |
| A route added later ships with no permission and is open | Developers remember to gate each new route |
| A guest on party Wi-Fi sniffs the owner's cookie and clears the queue | The LAN is private |
| The grant store wears out an SD card or corrupts on power loss | Writes are cheap and atomic on every device |
| Party guests open hundreds of SSE streams and stall the Raspberry Pi | A home player has few clients |
| Party Mode limits get bypassed by clearing browser storage | Per-guest limits can live in the guest's browser |
| A config app save wipes the new auth fields | The form carries every settings field |
| Chat link previews consume single-use invites | Only a person opens an invite link |

Cheapest to guard now: the same-host nginx failure. The principal resolver refuses loopback trust for any request that carries a forwarding header, which is a few lines in `src/webui/loopback.ts` and also fixes the current code. The default-deny dispatcher with its route-by-role test is the next cheapest, and it guards every later route.

## Sources

### Official docs and specs

| Source | Version or date | Helps with |
|---|---|---|
| [WHATWG HTML, server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html) | Living Standard, 2026-10-16 | `EventSource` options, credentials mode, failure on non-200 |
| [WHATWG HTML, obtain a site](https://html.spec.whatwg.org/multipage/browsers.html#obtain-a-site) | 2026-10-16 | Why other ports on one IP are same-site |
| [WHATWG Fetch, Origin header](https://fetch.spec.whatwg.org/#origin-header) | 2026-10-06 | When `Origin` is sent, CORS-safelisted content types |
| [W3C Fetch Metadata](https://www.w3.org/TR/fetch-metadata/) | WD 2026-09-21 | `Sec-Fetch-Site` is absent on plain http |
| [W3C Secure Contexts](https://w3c.github.io/webappsec-secure-contexts/) | ED 2023-11-10 | Which origins count as secure |
| [MDN, features restricted to secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts/features_restricted_to_secure_contexts) | 2026-03-08 | Wake lock, Clipboard, Web Share, `crypto.randomUUID` on LAN origins |
| [MDN, Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie) | 2026-09-01 | `Secure`, prefixes, SameSite behavior |
| [RFC 6265](https://www.rfc-editor.org/rfc/rfc6265) and [draft-ietf-httpbis-rfc6265bis-22](https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/) | 2011-04, 2025-12-01 | Port sharing of cookies, `Secure` over http |
| [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) | read 2026-10-17 | The origin gate and content-type rules |
| [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) | read 2026-10-17 | Cookie attributes, token entropy |
| [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) | read 2026-10-17 | scrypt and Argon2id parameters |
| [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) | read 2026-10-17 | Lockout and backoff design, error messages |
| [OWASP HTML5 Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html) | read 2026-10-17 | Why not localStorage |
| [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html) | final 2025-07 | Throttling limit, password length rules for the password login release |
| [Node.js crypto docs](https://nodejs.org/api/crypto.html) | v26.12.0 docs | `scrypt` options and `maxmem`, `argon2`, `timingSafeEqual`, `randomBytes` |
| [Node.js release schedule](https://github.com/nodejs/Release/blob/main/schedule.json) | read 2026-10-17 | Node 20, 22 and 24 end-of-life dates |
| [Go net/http CrossOriginProtection](https://pkg.go.dev/net/http#CrossOriginProtection) and [Valsorda, "CSRF"](https://words.filippo.io/csrf/) | go1.25.0, 2025-08-13 | The origin gate's order of checks |
| [nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) | read 2026-10-17 | Default `Host $proxy_host` rewrite |
| [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) | read 2026-10-17 | Host pass-through, `trusted_proxies`, the proxy deployment release recipe |
| [Chrome Local Network Access](https://developer.chrome.com/blog/local-network-access) | 2025-06-09, updated 2025-09-29 | Confirms a LAN page calling its own origin is unaffected |
| [Tailscale Serve](https://tailscale.com/kb/1312/serve) and [Tailscale HTTPS](https://tailscale.com/kb/1153/enabling-https) | 2026-01-20, 2025-12-10 | Trusted certs and identity headers, the proxy deployment release |
| [mkcert](https://github.com/FiloSottile/mkcert) | read 2026-10-17 | Why per-phone CA install rules out built-in TLS |
| [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700) and [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252) | 2025-01, 2017-10 | Why OIDC needs https redirect URIs |

### Comparable projects' source code

| Source | Version | Helps with |
|---|---|---|
| [Navidrome `server/auth.go`](https://github.com/navidrome/navidrome/blob/v0.64.2/server/auth.go), [`core/auth/auth.go`](https://github.com/navidrome/navidrome/blob/v0.64.2/core/auth/auth.go), [`server/middlewares.go`](https://github.com/navidrome/navidrome/blob/v0.64.2/server/middlewares.go) | v0.64.2 | Login payload, JWT epoch revocation, `ExtAuth` trusted sources, per-IP login limiter, trusted real-IP handling |
| [Jellyfin `QuickConnectManager.cs`](https://github.com/jellyfin/jellyfin/blob/v12.2/Emby.Server.Implementations/QuickConnect/QuickConnectManager.cs) | v12.2 | Device-initiated pairing codes for the machine grant release |
| [Home Assistant `homeassistant/auth/`](https://github.com/home-assistant/core/tree/2026.10.2/homeassistant/auth) | 2026.10.2 | Refresh-token lifetimes, `trusted_networks` refusing proxies, groups |
| [Music Assistant `controllers/webserver/auth.py`](https://github.com/music-assistant/server/blob/2.10.7/music_assistant/controllers/webserver/auth.py) and [`controllers/webserver/helpers/auth_middleware.py`](https://github.com/music-assistant/server/blob/2.10.7/music_assistant/controllers/webserver/helpers/auth_middleware.py) | 2.10.7 | The closest model: roles over scopes, guest join codes, token lifetimes, ingress header trust |
| [Syncthing `lib/api/`](https://github.com/syncthing/syncthing/tree/v2.1.6/lib/api) | v2.1.6 | Per-instance cookie names, CSRF header pattern, localhost Host check |
| [code-server `src/node/routes/login.ts`](https://github.com/coder/code-server/blob/v4.141.0/src/node/routes/login.ts) and [`src/node/http.ts`](https://github.com/coder/code-server/blob/v4.141.0/src/node/http.ts) | v4.141.0 | Login limiter, Origin-vs-Host check with forwarded hosts |
| [Pi-hole FTL `src/api/auth.c`](https://github.com/pi-hole/FTL/blob/v6.8/src/api/auth.c) | v6.8 | Host guard in no-password mode, session seats, CSRF only for cookie auth |
| [Grafana `conf/defaults.ini`](https://github.com/grafana/grafana/blob/v13.2.4/conf/defaults.ini) | v13.2.4 | Anonymous role setting, `auth.proxy` whitelist, brute-force limits |
| [Snapcast `server/snapserver.cpp`](https://github.com/snapcast/snapcast/blob/v0.35.0/server/snapserver.cpp) | v0.35.0 | Per-method role permissions (inactive in every release) |
| [OwnTone `owntone.conf.in`](https://github.com/owntone/owntone-server/blob/29.3/owntone.conf.in) | 29.3 | LAN-trusted default with an optional admin password |

### Other

| Source | Version or date | Helps with |
|---|---|---|
| [Music Assistant 2.7 release post](https://www.music-assistant.io/blog/2025/12/17/music-assistant-2-7/) | 2025-12-17 | When MA added users and logins |
| [Music Assistant Party plugin](https://music-assistant.io/plugins/party/) | read 2026-10-17 | Guest QR join, allowances, party duration defaults |
| [Vanhoef, WPA3 notes](https://www.mathyvanhoef.com/2018/03/) | 2018-03 | WPA2-Personal traffic exposure in the party Wi-Fi scenario |
| npm registry: [`uqr`](https://www.npmjs.com/package/uqr), [`qrcode-generator`](https://www.npmjs.com/package/qrcode-generator), [`qrcode`](https://www.npmjs.com/package/qrcode), [`argon2`](https://www.npmjs.com/package/argon2), [`bcryptjs`](https://www.npmjs.com/package/bcryptjs), [`openid-client`](https://www.npmjs.com/package/openid-client), [`eventsource-parser`](https://www.npmjs.com/package/eventsource-parser) | read 2026-10-17 | Versions, licenses and dependency counts in the matrices |
| Live Navidrome probe, read-only `POST /auth/login` and `GET /api/user/{id}` | Navidrome 0.62.0, 2026-10-17 | Login payload fields, JWT claim names, token lifetime, refresh header |
