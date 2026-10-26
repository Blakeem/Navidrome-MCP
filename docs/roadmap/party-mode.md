# Party Mode

**Status (2026-10-17):** Release 1 builds the guest jukebox only. The decisions in [README.md](README.md#party-mode-guest-jukebox) override this file where they differ: guest songs go straight to the back of the queue within a per-guest limit, guests remove their own songs, and only the host skips. The request-approval queue, the request feeder, votes and LLM moderation below move to a later release.

## Verdict

BUILD LATER. Party Mode is feasible on parts the project already has: the web player process, its HTTP server, and the mpv playlist. Open-source tools have shipped every core mechanism before, as the Options section cites. It must wait for Web UI Auth + Roles, because today any LAN device that reaches the web remote can clear the queue with no login. The "LLM-moderated" claim holds only in reduced form. Rules decide each request. The LLM reviews through pull tools in any MCP client, and only Claude Code can wake it, through a research-preview feature.

Effort: MVP 2 to 3 weeks after Web UI Auth + Roles ships. Full roadmap 4.5 to 7.5 weeks [INFERRED: scaled from commit `c042c49`, the web remote library browsing feature, which inserted 5,302 lines across 80 files].

## Scope

```
IN SCOPE:      QR join on the LAN, a guest page served by the web player process, guest song
               search, song requests, upvotes, per-guest limits enforced on the server,
               rule-based moderation (explicit flag, banned artists, maximum duration, repeat
               cooldown), host moderation and kick, LLM moderation tools, the request feeder that
               plays requests next, a Wi-Fi join QR, a TV display page, vote-to-skip
OUT OF SCOPE:  public venues and performance licensing (commercialization item, private events only)
               guests off the LAN through a cloud relay (needs a hosted service, see Releases)
               audio on guest phones, such as a silent disco (a different product)
               paid or credit-based priority (venue jukebox model, not a private party)
               the design of guest sessions, roles and invites (Web UI Auth + Roles owns it)
               parties that play on remote players or Music Assistant players (Remote Player Agent
               and Music Assistant Bridge own those outputs)
BOUNDARY CASE: autofill when requests and the background queue run out → IN as a later release,
               using existing similar-track tools. Rule: Party Mode calls existing tools and adds
               no new similarity engine. Sonic similarity stays with Sonic-Similarity Tools.
BOUNDARY CASE: the TV display page → IN as a later release. Rule: it shows only data a guest
               can already see.
BOUNDARY CASE: Docker with the HTTP MCP transport → OUT. Rule: Party Mode lives in the web player
               process, which never starts without mpv (docs/DOCKER.md:17).
BOUNDARY CASE: lyrics-based explicit screening → IN as a later experiment. Rule: it reads only
               lyrics the lyrics feature already fetches.
```

## Feasibility

### Requirements

| Requirement | Result | Evidence |
|---|---|---|
| The web remote HTTP server can serve a guest page to LAN phones | Verified | The static file route serves any file under `src/webui/public` [DIRECT: `src/webui/routes/static-files.ts:62-89`]. `webui.expose` binds `0.0.0.0` [DIRECT: `src/config/map-config.ts:61-63`] |
| The host knows a LAN URL to put in the QR | Verified, with a caveat | The network-info route lists every non-internal IPv4 interface as `http://<address>:<port>` [DIRECT: `src/webui/network.ts:22-38`, `src/webui/routes/network-info.ts:16-29`]. A Windows host also lists virtual adapters, such as WSL and VPN adapters [INFERRED] |
| Guests are isolated from host controls | Refuted today | No guest role exists. In access mode none, control routes and the library play route answer any LAN or VPN peer [DIRECT: the `player.control` rows of `ROUTES` in `src/webui/server.ts`]. In that mode only the player settings and shutdown routes require a loopback peer [DIRECT: `src/webui/auth/roles.ts:27`], and the lease and health routes check for one themselves [DIRECT: `src/webui/routes/player.ts:137`, `src/webui/routes/health.ts:20`]. Protected mode admits only an admin session to every gated route |
| Something can put a song right after the current track | Verified | mpv `loadfile <url> insert-next` exists since mpv 0.38.0 [DIRECT: mpv `DOCS/interface-changes.rst`, `DOCS/man/input.rst`]. The installed mpv is 0.41.0 [DIRECT: `mpv --version`]. The playback engine sends only `replace` and `append` today [DIRECT: `src/services/playback/playback-engine.ts:256-336`] |
| A part can watch track changes and react | Verified | The web player process already subscribes to `playbackEngine.onStateChange` [DIRECT: `src/webui/broadcaster.ts:43`]. mpv `start-file` and `end-file` carry `playlist_entry_id`, and `end-file` carries `reason` [DIRECT: mpv `DOCS/man/input.rst` event list]. The engine does not emit those two events yet [DIRECT: `playback-engine.ts:104-113`] |
| One long-lived process can hold party state across MCP sessions | Verified, with a caveat | The web player process owns the port and counts MCP leases [DIRECT: `src/web/main.ts:73-134`]. It stops when the last MCP exits unless `persistAfterMcpExit` is on [DIRECT: `src/web/player-runtime.ts:43-49`] |
| MCP tools can reach that state | Verified | The MCP server process already calls the web player process over loopback HTTP for the lease [DIRECT: `src/web/lease.ts:25-69`] |
| Navidrome exposes an explicit flag | Verified, low coverage | Native API field `explicitStatus` is `"e"`, `"c"` or `""`. OpenSubsonic returns `"explicit"`, `"clean"` or `""` [DIRECT: live server 0.62.0, OpenSubsonic Child docs updated 2026-05-10]. Navidrome maps tag `ITUNESADVISORY` or `rtng` values 1 and 4 to explicit and 2 to clean [DIRECT: navidrome `model/metadata/map_mediafile.go:168-177`, `resources/mappings.yaml:201-202`]. The field arrived in v0.55.0 on 2025-03-09 [DIRECT: tag diff of `model/mediafile.go`]. The live filter `GET /api/song?explicit_status=e` returns 6 of 16,731 songs, and `=c` returns 0 [DIRECT: live read-only check]. The project's song DTO drops the field [DIRECT: no `explicitStatus` in `src/`] |
| The server can make the LLM act when a guest submits | Refuted in general, partial in Claude Code | See the MCP client support table below |
| A QR can render with the current page security policy | Verified | The policy is `script-src 'self'`, so a CDN script is blocked [DIRECT: `src/webui/http-helpers.ts:17-28`]. A server-rendered SVG needs no script |

### MCP client support for server-initiated LLM work

The current MCP revision is 2026-07-28 [DIRECT: modelcontextprotocol.io/specification/versioning]. It deprecates sampling and logging. Sampling and elicitation may only travel inside the response to a pending `tools/call`, `resources/read` or `prompts/get` [DIRECT: 2026-07-28 changelog and deprecated registry, SEP-2260 Final]. A server therefore cannot start an LLM call when a guest submits a request.

| Client | Sampling | Elicitation | Resource subscriptions | A server push starts a model turn |
|---|---|---|---|---|
| Claude Code | No [DIRECT: claude.com connector docs] | Yes, since v2.1.76 [SINGLE-SOURCE: Claude Code changelog via research agent] | No [DIRECT: claude.com connector docs] | Yes, through channels (research preview, v2.1.80+) [DIRECT: code.claude.com channels reference], and through background tool results (v2.1.212+) [SINGLE-SOURCE: Claude Code docs via research agent] |
| Claude Desktop, claude.ai | No [DIRECT: claude.com connector docs] | ABSENT | No [DIRECT] | ABSENT |
| VS Code Copilot | Yes [DIRECT: VS Code MCP guide, 2026-10-14] | Yes [DIRECT] | Partial, method not named [DIRECT] | ABSENT |
| Cursor | ABSENT | Yes [DIRECT: cursor.com MCP docs] | ABSENT | ABSENT |
| goose, Zed, Continue, LibreChat | No or ABSENT [DIRECT: source at current commits] | goose yes, others ABSENT | ABSENT | ABSENT |

The claude.com connector page lists "Resource subscriptions" and "Sampling" among the features "Claude doesn't yet support" [DIRECT]. The page covers claude.ai, Desktop, mobile, Cowork and Claude Code.

A Claude Code channel is a stdio MCP server that declares `experimental['claude/channel']` and emits `notifications/claude/channel`. A custom channel runs only in an interactive session started with `--dangerously-load-development-channels`. Notifications that arrive while Claude is busy are "delivered together on the next turn". The same page calls "an ungated channel" a "prompt injection vector" [DIRECT: code.claude.com/docs/en/channels-reference.md].

Elicitation asks the human at the client, not the LLM, and only during a tool call. It cannot run unattended.

### Starting-list claims

- "QR join" held. It works only when the guest phone reaches the host's LAN address (see Edge cases).
- "Per-guest limits" held only with a server-issued guest identity and server-side checks. Music Assistant Party and Festify enforce their limits in the browser, and a guest bypasses them by clearing storage [DIRECT: MA frontend `useRateLimiting.ts`, Festify `selectors/track.ts`].
- "Votes" held.
- "LLM-moderated requests" held in part. Sampling and subscriptions do not work in Claude clients. LLM moderation works as pull tools in any client and as push only in Claude Code.
- "Web UI Auth + Roles unblocks everything below" held for Party Mode. The guest isolation requirement above depends on it.
- "Aimed at home parties and private rentals" held. LAN-only reach fits that scope.

## Current system

```
 host browser                                            MCP client (the LLM)
 host remote page  src/webui/public/index.html, app.js    Claude Code, Claude Desktop, VS Code
     | HTTP GET/POST, SSE /api/events                         | MCP over stdio or HTTP
     v                                                        v
+------------------------------------------------+  +-------------------------------------------+
| web player process   src/web/main.ts           |  | MCP server process   src/index.ts         |
|                                                |  |                                           |
| web remote HTTP server  src/webui/server.ts    |  | playback tool handlers                    |
|   control routes      routes/controls.ts       |  |   src/tools/handlers/playback-handlers.ts |
|   library routes      routes/library.ts        |  |          |                                |
|   network-info route  routes/network-info.ts   |  |          v                                |
|   player routes       routes/player.ts         |<-+-- lease client  src/web/lease.ts          |
|     (lease, settings, shutdown: loopback only) |  |   (POST /api/mcp-lease over 127.0.0.1)    |
|   static file route   routes/static-files.ts   |  |                                           |
|   snapshot broadcaster  broadcaster.ts         |  | playback tool functions                   |
|          |                                     |  |   src/tools/playback.ts                   |
|          v                                     |  | saved-queue tools                         |
| playback tool functions  src/tools/playback.ts |  |   src/tools/queue-management.ts           |
|          v                                     |  |   (Navidrome /queue only, never mpv)      |
| playback engine, web instance                  |  |          v                                |
|   src/services/playback/playback-engine.ts     |  | playback engine, MCP instance             |
+------------------+-----------------------------+  +------------------+------------------------+
                   | JSON-IPC, one per-user pipe or socket             |
                   +-------------------------+-------------------------+
                                             v
                     mpv playlist (the live play queue, source of truth)
                                             | HTTP GET /rest/stream
                                             v
                                     Navidrome server
```

Facts about the parts in this diagram:

1. The mpv playlist is the queue's only source of truth. No copy exists in SQLite or in Navidrome's saved queue [DIRECT: `docs/PLAYBACK-SPEC.md:15-16`].
2. The web player process and the MCP server process each run their own playback engine. Each engine has its own mutation lock, and both drive one mpv [DIRECT: `PLAYBACK-SPEC.md:113-118`, `playback-engine.ts:265`]. No lock spans the two processes.
3. The web remote HTTP server dispatches through one flat route table [DIRECT: `ROUTES` in `src/webui/server.ts`]. A new route is one line there, and it names its permission.
4. The library routes already search songs with `searchAll` and the active-library filter [DIRECT: `routes/library.ts:70-97`].
5. The snapshot broadcaster sends the entire mpv playlist and the playback status to every SSE client [DIRECT: `broadcaster.ts:198-219`]. The status carries only `engineRunning`, `volume` and `idle` [DIRECT: `broadcaster.ts:231-233`]. Guests must not receive this snapshot.
6. The saved-queue tools touch only Navidrome's `/queue` [DIRECT: `src/tools/queue-management.ts:44-111`]. Party Mode does not touch them.

## Integration point

```
 guest phone browser               host browser                         MCP client (the LLM)
 guest page (new)                  host remote page                          |
 public/guest.html, guest-*.js     + host party panel (new)                  |
   | scan join QR, then HTTP        public/party-panel.js                    |
   | + guest stream (SSE)             | HTTP + SSE                           |
   v                                  v                                      v
+-------------------------------------------------------------+  +-----------------------------+
| web player process                                          |  | MCP server process          |
|                                                             |  |                             |
| web remote HTTP server                                      |  | party tools (new)           |
|   guest routes (new)          routes/party-guest.ts         |  |   src/tools/party.ts        |
|       permission party.request, party.vote                  |  |   handlers/party-handlers.ts|
|   guest stream (new)          party-stream.ts               |  |          |                  |
|   party host routes (new)     routes/party-host.ts          |  |          | HTTP 127.0.0.1   |
|       permission party.moderate                             |  |          |                  |
|   party control routes (new)  routes/party-host.ts          |<-+----------+                  |
|       loopback only, for the party tools                    |  |                             |
|   party QR route (new)        routes/party-qr.ts            |  | channel notifier (later)    |
|          |                                                  |  |   src/tools/party-channel.ts|
|          v                                                  |  +-------------+---------------+
| party core (new)  src/services/party/                       |                |
|   party session store  ->  guest request queue  ->  request feeder           |
|   party-session.ts         request-queue.ts         request-feeder.ts        |
|                               ^                          |                   |
|                    moderation rules                      | insert-next,      |
|                    moderation-rules.ts                   | start-file events |
|                                                          v                   |
| playback engine, web instance (gains insert-next and lifecycle events)       |
+------------------------------+--------------------------------+--------------+
                               | JSON-IPC                       | JSON-IPC (unchanged)
                               +---------------+----------------+
                                               v
                                         mpv playlist
```

### Where each new part lives

| Part | Location | Why there |
|---|---|---|
| the party session store | `src/services/party/party-session.ts` | Holds the party (join window, rules, approval mode) and the guest list, keyed by the guest identity that Web UI Auth + Roles issues |
| the guest request queue | `src/services/party/request-queue.ts` | Pure logic with no I/O: requests, votes, ordering, per-guest limits. It tests without mpv |
| the moderation rules | `src/services/party/moderation-rules.ts` | A pure function over a song DTO and the party rules. It returns approve, reject with a reason, or hold |
| the request feeder | `src/services/party/request-feeder.ts` | The only party part that writes to mpv. It subscribes to the web instance of the playback engine, as the snapshot broadcaster does |
| the guest routes and the guest stream | `src/webui/routes/party-guest.ts`, `src/webui/party-stream.ts` | The route module pattern. The guest stream sends a reduced snapshot with no host data |
| the party host routes and the party control routes | `src/webui/routes/party-host.ts` | The host party panel calls the host routes. The party tools call the control routes over loopback, as the lease client does |
| the party QR route | `src/webui/routes/party-qr.ts` | Only the server knows the LAN addresses |
| the party tools | `src/tools/party.ts`, `src/tools/handlers/party-handlers.ts` | Registered only when `features.playback` and `webui.enabled` are both on |
| settings | a `party` section in `settings.json`, `src/config/schema.ts` | Default limits, rules and approval mode persist. Live party state stays in memory, per `PLAYBACK-SPEC.md:15` |

Party state lives in the web player process. The MCP server process is the wrong home, since several MCP processes can share one player and each holds its own memory. mpv `user-data` properties could share state across processes, but guests, votes and limits are not playback state, and mpv before 0.36 lacks `user-data` (`PLAYBACK-SPEC.md:232`). Mopidy-Party and Music Assistant also keep party state in the server that serves guests.

The engine changes are small. The playback engine gains an insert-after-current mode and emits `start-file` and `end-file` with `playlist_entry_id` and `reason`. The song transformer keeps `explicitStatus`. `shouldStopForMcpExit` gains a party-active input, so the web player process stays up during a party (`player-runtime.ts:43-49`).

### Request lifecycle in the guest request queue

```
State \ Event | approve   | reject          | remove          | feeder feeds | fed entry starts | fed entry fails | fed entry vanishes | guest kicked    | party ends
pending       | approved  | rejected        | removed         | no change    | no change        | no change       | no change          | removed         | removed
approved      | no change | rejected        | removed         | fed          | no change        | no change       | no change          | removed         | removed
fed           | no change | rejected, feeder| removed, feeder | no change    | played           | failed, feeder  | approved, at head  | removed, feeder | released
              |           | drops mpv entry | drops mpv entry |              |                  | drops mpv entry | of the order       | drops mpv entry | (entry stays in mpv)
```

`played`, `failed`, `rejected`, `removed` and `released` are terminal. Every event leaves them unchanged, and an action on one returns HTTP 409. "Fed entry fails" is an mpv `end-file` with reason `error` for the fed entry's id. mpv moves on after a failed entry (`PLAYBACK-SPEC.md:263`) and keeps the entry in its playlist [INFERRED]. Without this transition, the request feeder would move it back after the current track and retry it forever.

A new request enters `pending` when the approval mode is host. It enters `approved` when the approval mode is auto and the moderation rules pass. It enters `rejected` when a rule fails.

### Request feeder rules

1. The request feeder keeps at most one request in mpv at a time, the fed entry. It records the entry's mpv `playlist_entry_id`.
2. On each `start-file`, the request feeder marks the fed entry played if that entry started.
3. When no fed entry is in mpv and an approved request exists, the request feeder inserts the top approved request right after the current track. It checks at each `start-file`, each approval and each queue event.
4. When the fed entry sits anywhere other than right after the current track, the request feeder moves it back.
5. When mpv goes idle after an `end-file` with reason `eof` (the queue ran out), the request feeder loads the top approved request and plays it. After an explicit stop or clear, it waits for the host.
6. The request feeder holds while a radio stream is current, since the engine treats radio and songs as exclusive (`PLAYBACK-SPEC.md:222-230`). The host party panel says radio is playing.
7. Votes reorder approved requests until the request feeder feeds one. The guest page shows the fed entry as "Up next", locked.

### Interaction with the existing queue tools

The LLM keeps every playback tool. The mpv playlist holds the host's background music. The request feeder places guest requests ahead of it, one at a time.

| Existing tool or route | Effect on the mpv playlist | Effect on the guest request queue |
|---|---|---|
| `play_songs`, `play_albums`, `play_playlist`, `play_*_search` with `replace`, and `POST /api/library/play` | Clears and reloads | The fed entry vanishes. Its request returns to the head of the approved order. The next `start-file` feeds it again |
| the same tools with `append` | Adds to the end | None. Requests still go right after the current track, ahead of appended tracks |
| `clear_play_queue`, the host remote's clear button | mpv `stop` | The fed entry vanishes and is requeued. The request feeder does not restart playback |
| `next` | Skips | When the current track is a fed request, it counts as played |
| `shuffle_play_queue` | Shuffles | The request feeder moves the fed entry back after the current track |
| `move_in_play_queue` | Moves one entry | Same as shuffle for the fed entry. Other entries are untouched |
| `remove_from_play_queue` on the fed entry | Removes it | The fed entry vanishes and is requeued. The tool description points to `moderate_party_request` for dropping a guest request |
| `play_radio_station` | Replaces with a stream | The fed entry vanishes and is requeued. The request feeder holds while radio plays |
| `get_play_queue` | Read only | Shows the fed entry as a normal row. `get_party_requests` shows the rest |

## Options

Scores run from 1 (poor) to 5 (best). A weighted total is the sum of weight times score, divided by 5, out of 100. Maintainability carries weight 30 and match with comparable tools carries weight 25 in every matrix, per the brief.

Margin of error: one score step on the weight-30 criterion moves a total by 6 points. Totals within 6 points are inside the margin.

### Where Party Mode lives

The Music Assistant Party plugin (MA 2.10.7, stage stable) already offers QR join, guest search and add, boost, token-gated skip and duplicate prevention [DIRECT: `music_assistant/providers/party/__init__.py`, manifest.json, music-assistant.io/plugins/party]. It has no votes, no explicit filter, no per-guest kick, and its rate limits live in the guest's browser [DIRECT: same sources, frontend `useRateLimiting.ts`]. It plays on MA players, not on this project's mpv. MA's own MCP server plugin, `fastmcp_server`, is experimental and its docs list no party tools [DIRECT: `providers/fastmcp_server/manifest.json`, music-assistant.io/plugins/fastmcp-server]. That plugin has existed since MA 2.9.0 [SINGLE-SOURCE: the Music Assistant agent's report].

Criteria: maintainability of this repo (30), match with popular tools (25), coverage of the stated goal of votes, server-side limits, moderation and kick (20), runs on the current mpv setup (15), cost of roadmap dependencies (10).

| Criterion (weight) | the web remote party | the MA party provider through the Music Assistant Bridge item |
|---|---|---|
| maintainability (30) | 3 | 5 |
| match (25) | 4 | 5 |
| goal coverage (20) | 5 | 2 |
| runs on current mpv setup (15) | 5 | 1 |
| roadmap dependency cost (10) | 3 | 2 |
| Weighted total | 79 | 70 |

Flip check: the smallest change that flips the winner is goal coverage weight 20 to 4, which makes the MA party provider win. ROBUST, because the stated goal names votes, per-guest limits and moderation.

How comparable tools decided: Music Assistant built party features into its own server. Mopidy-Party is an extension of the Mopidy server it controls. No project found delegates guest requests to another product's server [ABSENT].

### Request holding model

Options: the held-queue feeder (requests wait in the guest request queue, and the request feeder puts one at a time after the current track), the live guest section (each approved request goes into mpv at once, after earlier guest entries), the mirrored tail (the guest request queue rewrites the mpv entries after the current track on every change).

Criteria: maintainability (30), match (25), vote and order support (15), survives host and LLM queue edits (15), visibility in the existing queue tools (15).

| Criterion (weight) | the held-queue feeder | the live guest section | the mirrored tail |
|---|---|---|---|
| maintainability (30) | 4 | 3 | 1 |
| match (25) | 4 | 4 | 2 |
| vote and order support (15) | 5 | 2 | 5 |
| survives queue edits (15) | 4 | 2 | 2 |
| visibility in queue tools (15) | 3 | 5 | 5 |
| Weighted total | 80 | 65 | 52 |

Flip check: the smallest change that flips the winner is visibility weight 15 to 53, which makes the live guest section win. ROBUST.

How comparable tools decided: tools with votes hold their own list and pick the top at play time. Ampache Democratic Play removes the top-voted song at each stream fetch [DIRECT: Ampache 7.10.5 `PlayAction.php:479-528`]. Festify and TopSpot sort their own list and play its head [DIRECT: Festify `vote-processor.ts`, TopSpot `lib/party/queue.ts:13-28`]. Tools without votes insert straight into the live queue after the current track and earlier guest entries [DIRECT: Mopidy-Party v1.3.0 `__init__.py:51-84`, MA `_add_to_priority_section` and `_find_section_end`]. The mirrored tail is the bidirectional sync that `PLAYBACK-SPEC.md:16` rejects.

### Moderation gate

Options: the rules-first gate (rules decide each request at submit time, auto approval by default, and an optional host approval mode), the manual approval gate (every request waits for the host or the LLM), the LLM push gate (each request waits for the LLM, woken by a push).

Criteria: maintainability (30), match (25), works with nobody watching (20), host content control (10), works with any MCP client or none (15).

| Criterion (weight) | the rules-first gate | the manual approval gate | the LLM push gate |
|---|---|---|---|
| maintainability (30) | 4 | 4 | 2 |
| match (25) | 5 | 2 | 1 |
| works with nobody watching (20) | 5 | 1 | 3 |
| host content control (10) | 3 | 5 | 4 |
| client portability (15) | 5 | 5 | 1 |
| Weighted total | 90 | 63 | 40 |

Flip check: the smallest change that flips the winner is host content control weight 10 to 78, which makes the manual approval gate win. ROBUST.

How comparable tools decided: Mopidy-Party, Festify, Ampache, Music Assistant Party and TopSpot apply no approval step [DIRECT: each project's add path]. SpotiQueue offers an optional approval list, its prequeue [DIRECT: `routes/prequeue.js:11-131`]. Rockbot approves only songs outside the venue library [DIRECT: Rockbot help center, updated 2026-08-27]. TouchTunes uses operator filter sets with an explicit toggle [DIRECT: TouchTunes FAQ].

### LLM integration path

Options: the pull tools (the LLM calls `get_party_requests` and `moderate_party_request` when asked, or on a schedule such as the Claude Code `/loop` command), the Claude Code channel (the server pushes a notice that starts a turn), the long-poll tool (a tool call that blocks until a request arrives, which Claude Code backgrounds after 2 minutes), MCP sampling.

Criteria: maintainability (30), match with the spec and documented client behavior (25), client portability (20), reacts with no user prompt (10), exposure of guest text to the model (15, higher score means less exposure).

| Criterion (weight) | the pull tools | the Claude Code channel | the long-poll tool | MCP sampling |
|---|---|---|---|---|
| maintainability (30) | 5 | 3 | 2 | 3 |
| match (25) | 5 | 3 | 1 | 1 |
| client portability (20) | 5 | 1 | 1 | 1 |
| reacts with no user prompt (10) | 1 | 5 | 4 | 1 |
| guest text exposure (15) | 4 | 2 | 3 | 3 |
| Weighted total | 89 | 53 | 38 | 38 |

Flip check: the smallest change that flips the winner is "reacts with no user prompt" weight 10 to 56, which makes the Claude Code channel win. ROBUST.

How comparable tools decided: no comparable party tool uses an LLM [ABSENT]. Anthropic's fakechat and Telegram channel plugins push chat into Claude Code and gate on a sender allowlist [DIRECT: channels reference].

### Request ordering

Options: the vote-count order (votes descending, then request time ascending), the fair rounds order (each guest's next request in turn, votes break ties inside a round), the FIFO-with-caps order (no votes, request time only, per-guest caps).

Criteria: maintainability (30), match (25), fairness across guests (20), votes visibly matter (15), a guest can predict their place (10).

| Criterion (weight) | the vote-count order | the fair rounds order | the FIFO-with-caps order |
|---|---|---|---|
| maintainability (30) | 5 | 3 | 5 |
| match (25) | 5 | 1 | 4 |
| fairness (20) | 2 | 5 | 3 |
| votes visibly matter (15) | 5 | 3 | 1 |
| predictable place (10) | 4 | 3 | 5 |
| Weighted total | 86 | 58 | 75 |

Flip check: the smallest change that flips the winner is "votes visibly matter" weight 15 to 1, which makes the FIFO-with-caps order win. ROBUST, because votes are in the stated goal.

Fairness comes from per-guest caps in every option. A cap of 3 active requests per guest bounds any guest's share of the approved order.

How comparable tools decided: Festify sorts by `(added_at - created_at) - vote_count * 1e12` ascending [DIRECT: Festify `functions/lib/vote-processor.ts`]. Ampache sorts by vote count descending, then oldest vote [DIRECT: `Democratic.php:206`]. TopSpot sorts by votes descending, then add time [DIRECT: `lib/party/queue.ts:13-28`]. Music Assistant and Mopidy-Party use FIFO. No project found implements round-robin across guests [ABSENT].

### Skip rule

Options: the host-only skip (the host panel and the LLM's `next` tool skip), the absolute-count skip (a fixed number of guest votes skips, such as 3), the active-share skip (guest votes reach a share of active guests, with a floor, such as max(3, 50% of active guests)).

Criteria: maintainability (30), match (25), abuse resistance across party sizes (20), guest agency (15), explainability (10).

| Criterion (weight) | the host-only skip | the absolute-count skip | the active-share skip |
|---|---|---|---|
| maintainability (30) | 5 | 5 | 4 |
| match (25) | 4 | 3 | 3 |
| abuse resistance (20) | 5 | 2 | 5 |
| guest agency (15) | 1 | 3 | 4 |
| explainability (10) | 5 | 5 | 4 |
| Weighted total | 83 | 72 | 79 |

Flip check: the smallest change that flips the winner is guest agency weight 15 to 22, which makes the active-share skip win. FRAGILE, because the weight of guest agency is a host preference with no evidence to pin it.

How comparable tools decided: Mopidy-Party skips at a fixed count, default 3, one vote per IP [DIRECT: `ext.conf`, `VoteRequestHandler`]. Festify lets only the owner skip [DIRECT: `database.rules.bolt:122`]. Music Assistant gives guests an immediate skip behind a token, off by default [DIRECT: MA party `__init__.py:331`, `skip_current`]. Rockbot removes a request at a downvote threshold "calculated based on the number of customers logged into your site", formula unpublished [DIRECT: Rockbot help center]. TopSpot counts a guest online when seen within 120 s [DIRECT: `lib/party/queue.ts:126`].

### Guest identity

This decision states what Party Mode needs from the identity. Web UI Auth + Roles issues it.

Options: the device token with a nickname (a random server-issued token per device in an httpOnly cookie, plus a nickname), the client IP, the shared guest user (one account for all guests, limits in the browser), Navidrome accounts.

Criteria: maintainability (30), match (25), limit enforcement (20), guest friction (15), kick and ban support (10).

| Criterion (weight) | the device token with a nickname | the client IP | the shared guest user | Navidrome accounts |
|---|---|---|---|---|
| maintainability (30) | 4 | 5 | 4 | 2 |
| match (25) | 5 | 2 | 3 | 2 |
| limit enforcement (20) | 4 | 2 | 1 | 5 |
| guest friction (15) | 5 | 5 | 5 | 1 |
| kick and ban (10) | 4 | 2 | 1 | 5 |
| Weighted total | 88 | 67 | 60 | 55 |

Flip check: the smallest change that flips the winner is maintainability weight 30 to 136, which makes the client IP win. ROBUST.

How comparable tools decided: SpotiQueue sets a random 16-byte id in an httpOnly cookie for 1 year [DIRECT: `routes/fingerprint.js:11-54`]. Festify and TopSpot use anonymous Firebase identities [DIRECT: Festify `util/auth.ts:64-82`, TopSpot `lib/auth/guest.ts`]. Mopidy-Party uses the IP from `X-Forwarded-For` when present, which any client can set [DIRECT: `__init__.py:17-18`]. Music Assistant shares one `party_guest` user [DIRECT: `guest_access.py:28-55`]. The Web UI Auth + Roles file already chose per-device grants from invite links, which matches the winning option.

### Guest surface

Options: the shared listener (guests use the web remote's port, and the guest role from Web UI Auth + Roles limits them to party routes), the separate guest listener (a second port in the web player process serves only the guest page and party guest routes).

Criteria: maintainability (30), match (25), isolation of host routes (20), guest URL simplicity (15), independence from the Web UI Auth + Roles schedule (10).

| Criterion (weight) | the shared listener | the separate guest listener |
|---|---|---|
| maintainability (30) | 4 | 3 |
| match (25) | 5 | 2 |
| isolation of host routes (20) | 4 | 5 |
| guest URL simplicity (15) | 5 | 4 |
| schedule independence (10) | 1 | 5 |
| Weighted total | 82 | 70 |

Flip check: the smallest change that flips the winner is schedule independence weight 10 to 26, which makes the separate guest listener win. ROBUST while the starting list's order holds, since Web UI Auth + Roles is item 2 with an MVP of 5 to 8 working days per its own file.

How comparable tools decided: Music Assistant, SpotiQueue, Mopidy-Party and TopSpot all serve guests from the same server as the host [DIRECT: each project's routes]. No project found uses a separate guest port [ABSENT].

### QR generation

Options: the server SVG route (the party QR route renders SVG with an npm encoder), the vendored browser module (a copied ESM encoder file in `public/`). A CDN script is excluded by the page security policy. A third-party QR web API is excluded because it would receive the LAN URL and the Wi-Fi password.

Criteria: maintainability (30), match (25), knows the LAN URL (15), keeps the Wi-Fi password on the server (15), works without a frontend bundler (15).

| Criterion (weight) | the server SVG route | the vendored browser module |
|---|---|---|
| maintainability (30) | 5 | 3 |
| match (25) | 4 | 3 |
| knows the LAN URL (15) | 5 | 3 |
| Wi-Fi password on the server (15) | 4 | 3 |
| no bundler needed (15) | 5 | 4 |
| Weighted total | 92 | 63 |

Flip check: no single weight change flips the winner, since the vendored browser module never scores higher. ROBUST.

Encoder: Web UI Auth + Roles picks `uqr` 0.1.3 (MIT, no dependencies, 2026-04-03) for invite QRs. Party Mode reuses it, so the repo holds one encoder. The alternative `qr` 0.7.2 (MIT OR Apache-2.0, 2026-09-28) releases more often and requires Node 20.19.0 or later, which the `>=24.19.0` floor in `package.json:71` meets [DIRECT: npm registry]. `uqr` defaults to error correction L and a 1-module border, so the party QR route sets M and 4 [DIRECT: `uqr` README, INFERRED: ISO 4-module quiet zone, not read].

## Recommendation

**Where Party Mode lives.** Build it in the web remote, with party state in the web player process. A host who already runs Music Assistant can use its Party plugin today, with no work in this repo.

**Request holding model.** Use the held-queue feeder. Approved requests wait in the guest request queue. The request feeder puts one request at a time right after the current track. This keeps the mpv playlist the source of truth for what plays, keeps votes effective until a request is fed, and survives an LLM `replace`.

**Moderation gate.** Use the rules-first gate with auto approval by default. The moderation rules check the explicit flag, banned artists, maximum duration, repeat cooldown and duplicates. A host who wants control switches the approval mode to host, and then the host panel or the LLM approves each request.

**LLM integration path.** Ship the pull tools in the MVP: `get_party_requests`, `moderate_party_request`, `set_party_rules`. Add the Claude Code channel later as an opt-in. It sends only a count of pending requests, and the LLM pulls details through the tools. This keeps guest text out of the pushed message.

**Request ordering.** Use the vote-count order with per-guest caps.

**Skip rule.** This decision is open. The matrix leans to the host-only skip for the MVP.

**Guest identity.** Use the per-device grant that Web UI Auth + Roles issues from a guest invite, plus a nickname. Party Mode keys every limit on `principal.grantId`.

**Guest surface.** Use the shared listener with the guest role. Revisit only if Party Mode moves ahead of Web UI Auth + Roles.

**QR generation.** Render SVG on the server with `uqr`, shared with Web UI Auth + Roles.

## Open decisions

**Skip rule for the MVP.** The options are the host-only skip (83) and the active-share skip (79). They sit 4 points apart, inside the margin. The flip check is FRAGILE.
- What would tip it: how much the host wants guests to remove a song without the host acting.
- The active-share skip adds an "active guest" count, a guest with an open guest stream or an action in the last 5 minutes, and a vote reset at each `start-file`.
- Question: Should guests be able to vote a playing song off in the MVP, or should only you and the LLM skip?

## Plan overview

Steps in dependency order. Each step names the parts it adds or changes.

1. **Engine support.** The playback engine gains an insert-after-current enqueue mode. It uses `loadfile insert-next` on mpv 0.38 or later, and `append` plus `playlist-move` on older mpv. It also emits `start-file` and `end-file` with entry id and reason. Requires nothing.
2. **Explicit flag.** The song transformer keeps `explicitStatus`. Requires nothing.
3. **Party settings.** A `party` section in the settings store holds default limits, rules and approval mode, and the config app shows them. Requires nothing.
4. **Party core.** The party session store, the guest request queue and the moderation rules, as pure modules with unit tests. Requires step 2 and step 3.
5. **Request feeder.** The request feeder in the web player process, with the rules in the Integration point section. Requires step 1 and step 4.
6. **Web player lifetime.** `shouldStopForMcpExit` gains the party-active input. Requires step 4.
7. **Routes.** The guest routes, the guest stream, the party host routes, the party control routes and the party QR route, each with a permission on its dispatcher line. Requires step 4 and Web UI Auth + Roles.
8. **Pages.** The guest page (join with nickname, song search, request, upvote, now playing, up next, my requests with reasons and limits) and the host party panel (start and end, QR, rules, approval list, kick). Requires step 7.
9. **Party tools.** `get_party_requests`, `moderate_party_request` and `set_party_rules`, calling the party control routes over loopback. The `remove_from_play_queue` description gains a pointer to `moderate_party_request`. Requires step 7.
10. **Docs.** A party section in `PLAYBACK-SPEC.md`, including a fourth naming domain for `*_party_*` tools beside saved playlists, saved queue and live play queue. Requires step 9.

## Edge cases

| Edge case | Part it hits | Intended behavior |
|---|---|---|
| A guest requests a song already in the approved order | the guest request queue | The request becomes an upvote on the existing request, as Festify does |
| A guest requests a song that played recently | the moderation rules | Rejected with a reason until the repeat cooldown ends. Default 60 minutes. TopSpot uses 30, Ampache makes it configurable |
| A guest hits the active request cap or the hourly cap | the guest request queue | HTTP 429 with the time until the next allowed request. Defaults: 3 active, 6 per hour |
| A tagged explicit song is requested with the explicit rule on | the moderation rules | Rejected with the reason "explicit". Search results show it disabled, as TouchTunes does |
| A song has an unknown explicit status, or Navidrome is older than 0.55.0 | the moderation rules, the host party panel | The song passes. The panel shows tag coverage from the `/api/song?explicit_status=e` and `=c` counts, or marks the filter unavailable |
| A requested song is outside the active libraries or missing | the guest routes | Rejected. Search already filters by library, and the request path re-checks with `fetchSongMetadata(..., { scopeToActiveLibraries: true })` |
| A request is approved in the last 30 s of a track while no fed entry exists | the request feeder | It defers to the next `start-file`. mpv prefetch "assumes you won't edit the playlist" [DIRECT: mpv `options.rst`], and the cache settings read ahead 20 to 30 s (`PLAYBACK-SPEC.md:98-101`). The gap risk is untested |
| The request feeder and an MCP tool mutate mpv at once | the request feeder | No lock spans the processes. The request feeder reconciles on the next queue event. The worst case is a fed request landing inside a new list |
| The last MCP client exits during a party | the web player process | The party-active input keeps the web player process running |
| The web player process restarts mid-party | the party session store | The MVP loses the party. Guests rejoin by scanning again. A later release persists state |
| The host LAN address changes through DHCP | the party QR route | The host party panel re-renders the QR from current interfaces. Advise a DHCP reservation |
| The host has several adapters, such as WSL or VPN | the party QR route | The host picks the interface. The default prefers RFC 1918 Wi-Fi and Ethernet adapters. The URL prints under the QR |
| A guest phone sits on the guest SSID, on mobile data, or on a Wi-Fi with no internet | the guest page | The page never loads. eero, TP-Link, Meraki and Google Nest guest networks block local devices [DIRECT: vendor docs]. A private address has no route from the internet [DIRECT: RFC 1918 §3]. Android prefers a validated network and may keep traffic on mobile data [DIRECT: Android network-state docs, 2026-10-16], with an untested effect on LAN addresses. The host screen shows a checklist and the Wi-Fi QR for the main network |
| The guest browser opens a plain-http LAN page | the guest page | Chrome Local Network Access does not gate main-frame navigation or same-origin calls [DIRECT: Chrome LNA guide, 2026-05-18]. iOS exempts Safari and WKWebView from the local network permission [DIRECT: Apple TN3179, 2026-10-06]. The page avoids `crypto.randomUUID`, Clipboard and Web Share, which need a secure context [DIRECT: MDN] |
| A guest clears cookies to reset limits | the guest identity | A new grant gets new limits. The redeem limiter from Web UI Auth + Roles slows this per IP. The host can rotate the join code |
| A guest picks an abusive nickname or embeds instructions in it | the party session store, the party tools | Nicknames are 1 to 24 characters of letters, digits, spaces and basic punctuation. The party tools show a server label such as "Guest 7" beside it. The tool description marks nicknames as untrusted data |
| The host kicks a guest | the party session store | The grant is revoked and the guest's votes are removed. The lifecycle table covers the guest's requests |
| The party duration ends | the party session store | The party ends. Default 8 hours, as in Music Assistant. All guest grants from the party invite are revoked |
| Guest requests scrobble to the host's account | the scrobble tracker | The MVP scrobbles them as normal. A later release pauses scrobbling during a party |
| The Wi-Fi password contains `; \ , " :` | the Wi-Fi QR | Backslash escaping per ZXing, which Android follows [DIRECT: ZXing wiki, AOSP `WifiUriParser.java`]. The panel warns about `%` and non-ASCII characters and asks the host to test one phone |

## Releases

### MVP: party requests

- Capability: the host starts a party from the host party panel and shows a QR. Guests join with a nickname, search songs, request and upvote. The moderation rules filter requests. The host and the LLM approve, reject or remove requests, and the host kicks guests. The request feeder plays each request next.
- Parts: the engine support, the explicit flag, the party settings, the party session store, the guest request queue, the moderation rules, the request feeder, the guest routes, the guest stream, the party host routes, the party control routes, the party QR route, the guest page, the host party panel, the party tools.
- Acceptance checks:
  1. A phone on the same Wi-Fi scans the QR, requests a song, and the song plays after the current track.
  2. A second guest's upvote moves a request ahead of an older one.
  3. A fourth active request from one guest returns 429.
  4. A tagged explicit song is rejected with the reason "explicit" while the explicit rule is on.
  5. The LLM lists pending requests and rejects one through `get_party_requests` and `moderate_party_request`.
  6. An LLM `play_songs` with `replace` does not lose an approved request.
  7. A guest calling `POST /api/controls/clear` gets 403.
  8. Ending the party revokes every guest grant from the party invite.
- Effort: 2 to 3 weeks [INFERRED].

### Fair play

- Capability: vote-to-skip by the active-share rule, if the open decision keeps it out of the MVP. A fair rounds ordering toggle. A ban that refuses new grants for a kicked device. Host rename of a guest.
- Parts: the guest request queue, the guest routes, the host party panel.
- Acceptance check: with 6 active guests and the default rule, 3 skip votes skip the current song, and the votes reset at the next `start-file`.
- Effort: 3 to 5 working days [INFERRED].

### Party display and Wi-Fi join

- Capability: a TV display page with now playing, up next, the top requests and the join QR. A Wi-Fi join QR in the format `WIFI:T:WPA;S:<ssid>;P:<password>;;`, with `H:true;` for a hidden SSID and no `T` for an open network.
- Parts: a display page in `public/`, the party QR route.
- Acceptance check: an Android 10+ phone and an iOS 11+ phone join the network from the Wi-Fi QR, then open the guest page from the join QR.
- Effort: 2 to 4 working days [INFERRED].

### LLM wake-up in Claude Code

- Capability: an opt-in channel notifier in the MCP server process declares `experimental['claude/channel']` and sends "N party requests pending", batched. The LLM then pulls details through `get_party_requests`.
- Parts: the channel notifier, a party-events stream from the web player process to the MCP server process over loopback.
- Acceptance check: with Claude Code started with `--dangerously-load-development-channels server:navidrome`, a new request in host approval mode starts a turn, and the LLM approves or rejects it with no user prompt.
- Effort: 3 to 5 working days [INFERRED].
- Limits: channels are a research preview that needs claude.ai or Console authentication [DIRECT: code.claude.com channels.md]. Claude Code does not register a channel server that negotiates revision 2026-07-28 [DIRECT: same page]. The planned MCP 2.0 migration (`docs/MCP-2.0-MIGRATION.md`) must keep its 2025-era protocol path for this release to work.

### Autofill and stats hygiene

- Capability: when no approved requests remain and the mpv playlist runs out, the request feeder appends from a host-chosen playlist or from similar tracks of recent requests. Scrobbling pauses during a party through a shared mpv `user-data` flag, the pattern the radio station tag uses (`playback-engine.ts:60-65`).
- Parts: the request feeder, the scrobble tracker.
- Acceptance check: the queue never goes idle while autofill is on. No scrobble reaches Navidrome during a party with the pause on.
- Effort: 3 to 5 working days [INFERRED].

### Party persistence

- Capability: the party survives a web player restart within the party window.
- Parts: the party session store writes a JSON snapshot beside `settings.json` on each change and restores it at start.
- Acceptance check: after a restart, guests keep their grants and the approved order is unchanged.
- Effort: 2 to 3 working days [INFERRED].

### Rejected ideas

- MCP sampling and resource subscriptions for moderation. The Feasibility section shows why neither works in Claude clients.
- The long-poll tool. It holds a tool call open as a timer and times out in clients other than Claude Code.
- Free-text guest messages or dedications. They add a prompt injection path and moderation load.
- Downvotes that remove requests (Rockbot, TopSpot). A small party can brigade one guest. The skip rule covers bad songs.
- Paid or credit priority (TouchTunes Fast Pass, Rockbot Priority Pick). It fits venues, not private parties.
- A cloud relay for guests off the LAN. Music Assistant does this through `app.music-assistant.io` and WebRTC. It needs a hosted service, abuse handling, and an AGPL network service on the internet.
- A `.local` hostname in the QR. Android resolves `.local` only from November 2021 builds and not over mobile data or VPN [DIRECT: source.android.com DNS resolver]. The IP literal is the default.

## Dependencies

### Other roadmap items

- **Web UI Auth + Roles** (hard dependency). Party Mode needs these capabilities, named as that item's file names them:
  - the guest role, extended by Party Mode with `party.request` and `party.vote`
  - `party.moderate` on the owner role, for the party host routes
  - multi-use guest invites with `maxUses` and `expiresAt`, which the join QR encodes
  - revocation of every grant redeemed from one invite (party end) and of one grant (kick)
  - a stable `principal.grantId` and `principal.label` passed to route handlers
  - the redeem limiter, reusable per principal and per IP
  - the stream registry, so the guest stream carries guest-only events
  - default deny for any route that names no permission
  - the party control routes stay reachable by the MCP server process over loopback, as the lease route does
- **Sonic-Similarity Tools** (optional). The autofill release can call its similarity tools when they exist. Existing similar-track tools suffice without it.
- **Music Assistant Bridge** (none). The MA party provider stays an alternative for hosts who already run Music Assistant.
- **Audio-Device Selector**, **Remote Player Agent** (none). The request feeder targets the local mpv only.
- **Commercial step** (none). Private events only.

### External services

- Navidrome 0.55.0 or later for `explicitStatus` [DIRECT: tag diff]. Older versions work with the explicit rule off.
- mpv 0.38.0 or later for `loadfile insert-next` [DIRECT: mpv interface changes]. Older mpv uses `append` plus `playlist-move`.

### npm packages

| Package | License | Status | Use |
|---|---|---|---|
| `uqr` 0.1.3 | MIT | Published 2026-04-03, previous release 2023-08-16, no dependencies, about 6.1M downloads a week [DIRECT: npm registry] | Join QR and Wi-Fi QR as SVG. Shared with Web UI Auth + Roles |

No other new package. SSE, HTTP and timers come from Node and the existing helpers.

## Risks

Assume Party Mode shipped and failed.

| Failure mode | The assumption it violated |
|---|---|
| Guests could not open the guest page | Guests share the host's LAN segment. Guest SSIDs isolate clients by default |
| A guest found the host remote and cleared the queue | Guests are isolated from host routes. This holds only with Web UI Auth + Roles in place |
| One guest flooded requests from several identities | One device equals one identity. Clearing cookies mints a new one |
| The party died when the host closed their MCP client | The web player process outlives MCP sessions |
| An explicit song played at a family party | Library tags carry explicit status for most songs |
| Nobody moderated, and the LLM never acted | The LLM is present during the party. MCP gives it no way to be woken outside Claude Code |
| The channel notifier stopped working after an upgrade | Claude Code channels and the MCP protocol revision stay stable. Both changed in 2026 |
| A nickname steered the LLM's moderation | Guest text is inert data for the model |
| Guest requests vanished after the LLM queued an album | Every mpv change made by the MCP server process reaches the request feeder as an event it can reconcile |
| Gaps appeared between tracks | Inserting near a track's end does not disturb mpv prefetch |

The cheapest failure to guard against now is the host-route exposure. The guard is an ordering decision, not code. Party Mode ships only after Web UI Auth + Roles, and `webui.expose` stays off by default until then.

## Sources

### Official docs

| Link | Version or date | Helps with |
|---|---|---|
| https://modelcontextprotocol.io/specification/versioning | current revision 2026-07-28, read 2026-10-17 | Which MCP revision governs server-to-client requests |
| https://modelcontextprotocol.io/specification/2026-07-28/changelog and `/deprecated` | 2026-07-28 | Sampling and logging deprecation, the request pattern that replaced server-initiated requests |
| https://modelcontextprotocol.io/seps/2260-Require-Server-requests-to-be-associated-with-Client-requests | Final, created 2026-02-16 | Why sampling cannot moderate unattended |
| https://claude.com/docs/connectors/building/index.md | read 2026-10-17 | Claude clients lack sampling and resource subscriptions |
| https://code.claude.com/docs/en/channels-reference.md | research preview, read 2026-10-17 | The channel notifier release: capability, notification format, dev flag, sender gating |
| https://code.claude.com/docs/en/mcp.md and the Claude Code CHANGELOG | top entry 2.1.302 | Elicitation and background tool-result versions |
| https://code.visualstudio.com/api/extension-guides/ai/mcp | 2026-10-14 | VS Code sampling and elicitation support |
| https://cursor.com/docs/mcp.md | read 2026-10-17 | Cursor elicitation support |
| npm `@modelcontextprotocol/sdk` | 1.32.1, 2026-10-05 (repo installs 1.17.4) | `server.notification()` for channels, `elicitInput` for host prompts |
| https://opensubsonic.netlify.app/docs/responses/child/ | updated 2026-05-10 | `explicitStatus` values and tag mapping |
| https://www.navidrome.org/docs/usage/features/jukebox/ | read 2026-10-17 | Navidrome's jukebox is admin-only and shares one queue, so it is not a party mode |
| mpv `DOCS/man/input.rst`, `DOCS/man/options.rst`, `DOCS/interface-changes.rst` (master) | mpv 0.38.0 added `insert-next` | The request feeder's insert command, lifecycle event fields, prefetch behavior |
| https://music-assistant.io/plugins/party/ | site version 2.10.7 | MA party feature set, defaults, guest session length |
| https://music-assistant.io/plugins/fastmcp-server/ | site version 2.10.6, stage experimental | MA's MCP plugin exposes no party tools |
| https://support.spotify.com/us/article/jam/ | read 2026-10-17 | Jam join methods and host controls |
| support.rockbot.com help center | articles updated 2026-08-27 | Per-user caps, downvote removal, content ratings |
| touchtunes.helpshift.com FAQs 766, 1514, 816 and business.touchtunes.com/faq | read 2026-10-17 | Priority buckets, filter sets, explicit toggle |
| MDN `mdn/content` secure-context pages | main, 2026-10-17 | APIs the plain-http guest page must avoid |
| Chrome "New permission prompt for Local Network Access" and the LNA adoption guide | 2025-06-09 (updated 2025-09-29), 2026-05-18 | A QR navigation to a LAN IP gets no prompt |
| Apple TN3179 | revision 2026-10-06 | Safari is exempt from the iOS local network permission |
| developer.android.com reading-network-state, local-network-permission, and source.android.com dns-resolver | 2026-10-16, 2026-10-02, 2026-10-09 | Android routing on Wi-Fi without internet, Android 17 local network permission, `.local` support |
| eero 207895123, TP-Link FAQ 1492, Meraki Wireless Client Isolation, Google Nest 6327302 | 2026-09-01, 2022-06-28, undated, undated | Guest network isolation behavior |
| https://raw.githubusercontent.com/nodejs/Release/main/schedule.json | read 2026-10-17 | Node 20 reached end of life on 2026-04-30 |

### Comparable projects' source code

| Link | Version or date | Helps with |
|---|---|---|
| https://github.com/music-assistant/server `music_assistant/providers/party/__init__.py`, `helpers/guest_access.py` | dev, release 2.10.7 | Insert after current and earlier guest entries (`_add_to_priority_section`, `_find_section_end`), duplicate check, join code lifetime, guest token revocation |
| https://github.com/music-assistant/frontend `useRateLimiting.ts`, `PartyGuestView.vue` | main | Token-bucket defaults, and the lesson that browser-side limits are bypassable |
| https://github.com/Lesterpig/mopidy-party `__init__.py`, `ext.conf` | v1.3.0, 2025-10-12 | Insert position after the last party track, fixed-count skip vote, per-IP add window |
| https://github.com/ty22117/mopidy-party-plus | pushed 2026-08-11 | Last.fm-seeded refill when the queue runs low (autofill release) |
| https://github.com/Festify/app `functions/lib/vote-processor.ts`, `database.rules.bolt` | last commit 2022-03-18 | Vote ordering formula, add equals vote, owner-only skip, fallback playlist |
| https://github.com/ampache/ampache `Democratic.php`, `PlayAction.php` | 7.10.5, 2026-10-13 | Pick-at-play-time model, vote ordering SQL, cooldown, base playlist fallback |
| https://github.com/StroepWafel/SpotiQueue `routes/queue.js`, `routes/prequeue.js`, `routes/fingerprint.js` | last commit 2026-08-02 | Cookie device id, cooldown windows, optional approval list, server-side explicit ban |
| https://github.com/MattiVboiii/topspot `lib/party/queue.ts`, `lib/party/tracks.ts` | last commit 2026-10-13 | Active-request cap, repeat cooldown, online-guest window, downvote threshold |
| https://github.com/navidrome/navidrome `model/metadata/map_mediafile.go`, `resources/mappings.yaml`, `model/mediafile.go` at v0.55.0 | master, v0.64.2 latest (2026-09-24) | Explicit tag mapping and the version that added it |
| https://github.com/navidrome/navidrome/discussions/5517 | 2026-05-22 | Demand signal. The maintainer defers party features to a future Navidrome API |
| https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/fakechat | main | A working channel server to copy for the channel notifier |

### Specs and standards

| Link | Version or date | Helps with |
|---|---|---|
| Wi-Fi Alliance WPA3 Specification §7 | v3.5, 2025-02-26 | The `WIFI:` URI grammar and `R:` transition-disable values |
| https://github.com/zxing/zxing/wiki/Barcode-Contents | last edit 2026-10-16 | The de facto `WIFI:` format and backslash escaping |
| AOSP `packages/modules/Wifi` `WifiUriParser.java`, `packages/apps/Settings` `WifiNetworkConfig.java` | main | How Android parses and generates `WIFI:` codes, `T:SAE` handling |
| https://www.iana.org/assignments/uri-schemes/prov/wifi | 2020-08-26, updated 2020-12-15 | Points to the WPA3 specification for the scheme |
| RFC 1918 §3 | 1996 | Why phones on mobile data cannot reach the host |

### Other

| Link | Version or date | Helps with |
|---|---|---|
| npm `uqr` | 0.1.3, 2026-04-03 | The QR encoder shared with Web UI Auth + Roles |
| npm `qr` | 0.7.2, 2026-09-28 | Alternative encoder if `engines.node` moves past Node 20 |
| `docs/roadmap/web-ui-auth-roles.md` in this repo | 2026-10-17 | The guest role, invite and grant names this file depends on |
