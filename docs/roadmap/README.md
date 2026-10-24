# Roadmap

Each file in this folder is a research roadmap for one feature. This file holds the release order, the decisions made on 2026-10-17, where each feature connects to the code, and the flags to resolve before building. Where this file and a roadmap file disagree, this file wins.

## Release order

```
code-fix pass ──► release 1 ──────────────────────────────────► release 2 ──────────────► later
                  Audio-Device Selector, then                   Sonic-Similarity Tools    Party extras, Remote Player Agent,
                  Web UI Auth + Roles with the guest jukebox    with text-to-music        Music Assistant Bridge, commercialization
```

1. **Code-fix pass.** Fix the defects the roadmap research found, then commit, before any feature work.
2. **Release 1.** Audio-Device Selector first, tested with a Bluetooth speaker. Then Web UI Auth + Roles, with the guest jukebox from Party Mode built on its guest role.
3. **Release 2.** Sonic-Similarity Tools, including text-to-music search.
4. **Later.** Party extras (votes, LLM moderation), Remote Player Agent without Docker, Music Assistant Bridge and the party chat idea, commercialization.

## Code-fix pass

Done. Each fix has a unit test that failed on the old code. These items stay open:

- No cap on SSE clients (`src/webui/broadcaster.ts:85`, `src/webui/visualizer-hub.ts:42`). Web UI Auth + Roles caps streams per user.
- Cover art uses `Cache-Control: public` (`src/webui/routes/cover.ts:106`). Web UI Auth + Roles changes it to `private`.
- `engines.node` admits Node 20. Web UI Auth + Roles raises it together with the CI matrix.
- The empty `author` field, the "Navidrome" name prefix and the licensing paperwork wait on the owner.

## Audio-Device Selector

Release 1. Roadmap: [audio-device-selector.md](audio-device-selector.md).

**Decisions**
- Two tools, `list_audio_devices` and `set_audio_device`, named like the existing `list_*` and `set_*` tools (`list_playlists`, `set_volume`).
- `list_audio_devices` shows each device's ID beside its description, so two devices with the same name can be told apart.
- A saved device is matched by its ID only.
- When the selected device disappears, playback pauses.
- The choice is saved in the settings store and applied each time mpv starts.
- In the `none` access mode, every LAN viewer of the web remote can list the outputs and switch the output. The live status stream carries only a lost-output flag, never a device ID or name. Web UI Auth + Roles limits the output routes to the admin role.

**Integration points**
- `src/services/playback/audio-devices.ts` (new): parse, filter and match the mpv device list.
- `src/services/playback/playback-engine.ts`: apply the saved device after the IPC connects, watch `audio-device-list` and `current-ao`, pause on loss, add status fields.
- `src/services/playback/mpv-process.ts`: the spawn flag `--audio-fallback-to-null=yes`.
- `src/tools/playback.ts` and the playback handlers in `src/tools/handlers/`: the two tools.
- `src/webui/routes/` and `src/webui/public/`: `GET /api/audio-devices`, `POST /api/controls/audio-device`, and a device picker beside the volume control.
- Settings: `playback.audioDevice` in `src/config/store.ts`, `schema.ts` and `map-config.ts`, the env fallback `PLAYBACK_AUDIO_DEVICE`, and a config app field.

**Flags**
- Windows gives an output a new ID after a driver update or reinstall. With ID-only matching, the saved device then reads as missing and playback pauses until the user picks it again. The pause message must say so and name `set_audio_device`.
- With the saved speaker off, a play request starts paused. The tool result must say the saved output is not connected.
- `set_audio_device` needs a value that returns to the OS default output.
- mpv lists a Bluetooth speaker only while it is connected and active. Pairing alone is not enough.
- The config app save keeps stored keys the form lacks, so a saved `playback.audioDevice` survives a config app save with no form field.

## Web UI Auth + Roles

Release 1. Roadmap: [web-ui-auth-roles.md](web-ui-auth-roles.md). The decisions below replace the roadmap's invite-only design and its trusted loopback browser.

**Decisions**
- One setting picks the access mode. `none` is the default and keeps today's open LAN behavior, so existing users see no change.
- The other modes are device access and username-and-password access. Both are to be supported.
- With access control on, every browser logs in, including one on the host machine.
- An admin account manages users, devices and roles.
- Roles split queue rights. A guest adds to the queue within a limit. An admin holds the full control the web remote has today, including replace and clear.
- Passwords are hashed with Argon2id from `node:crypto`, which raises the minimum Node version.
- A maintained library for users, sessions and roles is preferred over custom code, if one fits this server and works on Windows, macOS and Linux.
- The settings store and the config app gain the access mode and its fields.

**Integration points** (from the roadmap, to confirm at planning)
- `src/webui/server.ts`: the Host check on LAN binds, an Origin check on POST, one permission on every route line, and default deny.
- `src/webui/auth/` (new): the principal resolver, the role table, the user and device store, and the rate limiter.
- `src/webui/routes/auth.ts` (new): login, logout, join, and user and device management.
- `src/webui/broadcaster.ts` and `src/webui/visualizer-hub.ts`: each stream client carries its user, so a revoke closes that user's streams.
- A user store file beside `settings.json`, mode 0600.
- `src/config/` and `src/config-app/`: the `webui.auth` settings and form fields.
- `src/webui/public/`: the login page, the user icon and the user panel.
- The MCP server's own loopback calls stay exempt: `/api/mcp-lease`, `/healthz`, and the party control routes.

**Flags** (questions to answer before planning)
- **MAC address allow list.** This cannot work as described. A browser never sends the device's MAC address. The server can read a MAC only for a device on the same local network segment, through the OS ARP table, never for a device on the internet or behind a router. iOS 14 and later and Android 10 and later use a random MAC per Wi-Fi network by default, and any device can fake a MAC. The roadmap's alternative is a device token. A device joins once, by QR code or admin approval, and receives a long-lived token in a cookie. The admin panel lists devices by name and revokes each one. Question: use device tokens in place of MAC addresses?
- **Internet access.** Guests on the internet need the web player published through a port forward, a reverse proxy or a tunnel (such as Cloudflare Tunnel or Tailscale Funnel), with HTTPS. Without HTTPS, passwords and session tokens cross the internet in clear text. A tunnel or proxy on the host machine connects from 127.0.0.1, so in `none` mode the entire internet would get today's open LAN control. Proposed rule: publishing to the internet requires an access mode other than `none`. Question: which publishing method do you plan to use?
- **JWT.** A JWT stays valid until it expires unless the server keeps a revocation list, and removing a guest needs revocation. One server issues and checks every token here, so an opaque random token with a server-side record does the same job with revocation built in. In both designs, the QR code carries a short-lived join code. The server swaps it for an HttpOnly session cookie and removes it from the address bar, so the code does not stay in browser history or in a shared screenshot. Question: opaque tokens in place of JWT?
- **Node version.** The auth roadmap says built-in Argon2id is stable from Node 24.19. Verify this at planning. Raising the minimum drops Node 22, which is supported until 2027-04-30, so Node 22 users must upgrade Node before they update.
- **Library choice.** Candidates to evaluate at planning, unverified: Better Auth, Passport, iron-session, and the guides that replaced the Lucia library. The web remote uses Node's `http` module with no framework, and the project has no database. A library that needs Express or a database brings a large change.

## Party Mode: guest jukebox

Release 1, built on the guest role. Roadmap: [party-mode.md](party-mode.md). The decisions below replace the roadmap's request-approval queue, request feeder and votes for release 1.

**Decisions**
- A guest scans a QR code, opens the guest page in a browser, searches the library and adds songs to the queue.
- Guests see the queue, the lyrics and the visualizations. They cannot pause, skip, change the volume or reorder.
- A guest removes their own songs with a trash icon beside each song they added.
- A new guest song goes to the back of the queue.
- Only the host skips.
- Each guest can queue a limited number of songs. The limit lives in settings, defaults to 3, and a change applies without a restart.
- The admin opens a user panel from a user icon. It lists access requests and each user's queued song count, and expands to show the songs.
- The QR code holds a limited access key that expires. The guest page works over the internet as well as the LAN.
- Security of the guest path is the top priority.
- Votes, LLM moderation and request approval move to a later release.

**Integration points**
- The guest role and its permissions in the auth role table.
- `src/webui/routes/` (new guest routes): search, add, remove own song, read the queue.
- An owner map in the web player process, from mpv playlist entry ID to guest. It lives in memory, so it resets when the web player restarts.
- `src/services/playback/playback-engine.ts`: append for a guest, remove by entry ID, report entry IDs on start and end.
- `src/webui/public/`: the guest page, the user icon, the user panel, and the trash icon in the queue list.
- Settings: `party.guestQueueLimit` (default 3) and the join key expiry.

**Flags** (questions to answer before planning)
- **Back of the queue.** If the host queued a 200-song playlist, a guest song waits behind all of it. The options are the back of the entire queue (as decided), or the back of the guest songs, ahead of the host's music. Question: which?
- **Limit meaning.** Assumed: 3 unplayed songs at a time, and a slot frees when one plays or is removed. The alternative is 3 for the entire party. Question: which?
- **Host replace.** When the host or the LLM replaces the queue, the guest songs go with it. Question: keep that, or re-add the unplayed guest songs after a replace?
- **Visualizations.** The visualizer style is picked per browser and stored in that browser (`src/webui/public/visualizer.js:284`), so a guest's pick changes only their own screen. The visualizer on/off switch is a player setting (`src/webui/public/settings.js:31`), and guests must not reach it.
- **Explicit filter.** Navidrome flags only 6 of the 16,731 songs in this library as explicit, so an explicit filter would block almost nothing.

## Sonic-Similarity Tools

Release 2. Roadmap: [sonic-similarity.md](sonic-similarity.md).

**Decisions**
- Release 2, after release 1.
- Text-to-music search ships in release 2. This picks the hybrid route: Navidrome's sonic endpoints plus AudioMuse-AI's REST API for text search.

**Integration points**
- `src/services/` (new): a sonic extension probe that calls `getOpenSubsonicExtensions` once at startup.
- `src/tools/sonic-similarity.ts` and `src/tools/handlers/sonic-handlers.ts` (new), registered only when the probe finds the `sonicSimilarity` extension.
- `src/utils/audiomuse.ts` (new): the AudioMuse-AI client for text search, gated by a `features` setting.
- The existing play path for the sonic play tools, and the active-library filter for results.

**Flags**
- You deploy AudioMuse-AI and its Navidrome plugin. Analysis needs a 4-core AVX2 CPU and 8 GB of RAM, and takes hours to days for this library.
- The roadmap names `get_sonic_similar_songs` and `find_sonic_path`. The existing similarity tools say "tracks" (`get_similar_tracks`), while the library tools say "songs" (`search_songs`). Settle the names at planning.

## Remote Player Agent

Later. Roadmap: [remote-player-agent.md](remote-player-agent.md).

**Decisions**
- No Docker for now, for any feature. The roadmap's Docker sections are deferred.
- The target setup is a PC driving a Bluetooth or wired speaker.
- Discovery and the rest of the design wait until release 1 testing shows the use cases.

## Music Assistant Bridge

Later, undecided. Roadmap: [music-assistant-bridge.md](music-assistant-bridge.md).

**Decisions**
- Undecided. A related idea is recorded for later: a chat box on the guest page, backed by a Claude Code session with a limited tool set, so a guest can ask for a genre or a band and get songs queued.

**Flags**
- Guest messages would reach an LLM that can call tools. Only a tool allowlist (search, and add within the guest's limit) contains a prompt injection.
- Each chat message costs model usage.
- The idea depends on Claude Code. Other MCP clients need research.

## Commercialization

Later. `commercialization.md` is ignored by git and stays private. Its open questions are unanswered.
