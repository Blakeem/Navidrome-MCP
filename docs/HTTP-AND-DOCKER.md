# HTTP and Docker

By default the MCP client starts the server as a child process and talks to it over stdio, so a client on another machine can't reach it. The HTTP transport makes the server reachable over the network, and the Docker image runs it as an always-on endpoint for the library tools.

## When You Need It

The transport decides who can reach the MCP protocol. It does not move where the audio comes out, since the Jukebox Remote is a control panel and not an audio stream. The machine that runs the server is always the machine that makes the sound.

| Deployment | MCP reachable from | Local audio (mpv) | Jukebox Remote |
|---|---|---|---|
| **stdio** (default) | the client that spawned it, same machine | ✅ plays on your machine | ✅ `localhost:8808`, LAN with **Expose on LAN** |
| **HTTP on your machine** | any host that can reach `host:3000` | ✅ plays on your machine | ✅ same as stdio |
| **HTTP in Docker** (this image) | any host that can reach the published port | ❌ no mpv in the image | ❌ never starts (needs mpv) |
| **HTTP in Docker + mpv installed** | same | ⚠️ only with host audio passthrough, Linux hosts only | ✅ if you publish `8808` and set `WEBUI_EXPOSE=true` |

## HTTP Transport

With the transport set to `http`, the server listens at `/mcp` with the MCP [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http). It runs as a standalone process, and network MCP clients connect to it with no bridge such as `supergateway` or `mcp-proxy`.

Set the transport in the **MCP transport** card of the settings page, or add a `transport` block to `settings.json`. `host` defaults to `127.0.0.1` (loopback only). Set `expose: true` to bind all interfaces (`0.0.0.0`), so a remote client can reach it. An explicit `host` overrides `expose`. Set `authToken` to require bearer auth. The settings page has a **Generate** button for it.

```json
"transport": {
  "type": "http",
  "port": 3000,
  "expose": true,
  "authToken": "a-long-random-secret"
}
```

[Configuration](CONFIGURATION.md#transport) lists each transport key with its environment variable.

Start the server in a terminal, since no MCP client starts an HTTP server.

```bash
navidrome-mcp serve
```

Point an HTTP-capable MCP client at `http://<host>:<port>/mcp`.

```json
{
  "mcpServers": {
    "navidrome": {
      "type": "http",
      "url": "http://your-host:3000/mcp",
      "headers": { "Authorization": "Bearer a-long-random-secret" }
    }
  }
}
```

When a token is set, every `/mcp` request must carry `Authorization: Bearer <token>`, which the server compares in constant time. Anything else gets a `401`. `GET /healthz` is an unauthenticated liveness endpoint for container health checks. It returns `200 {"status":"ok"}` and makes no Navidrome call.

> **Single account, shared state.** One process serves every HTTP session with one Navidrome account. So a `set_active_libraries` call changes the library filter for every connected session.

## Host Filtering

On the default bind, loopback with no auth token, the server rejects requests whose `Host` header isn't a loopback name. This blocks DNS rebinding, so a malicious web page can't drive the server through your browser. Setting an `authToken` or binding a non-loopback address turns the automatic filter off, since a remote deployment is reached by names the server can't know in advance. A lured browser can't attach your token, so the bearer token already blocks rebinding.

To pin the accepted names, set `transport.allowedHosts`, which applies whenever it is present. Each entry is the exact `Host` header value, with the port when it is not 80 or 443, such as `mcp.example.com:3000`. Set `transport.allowedOrigins` only for browser clients. It gates the `Origin` header.

## Security

The server holds an authenticated Navidrome session, so anyone who reaches an open port controls your library. When the port is reachable beyond loopback, set an auth token or limit access with a firewall, a Kubernetes NetworkPolicy, or a reverse proxy that adds TLS. If the transport binds a non-loopback address with no token, the server logs a warning at startup. It still starts, so that a deployment locked down by a firewall or NetworkPolicy runs. Keep the default stdio transport unless you need remote access.

## Remote Playback

Since mpv runs beside the server, the HTTP transport on a machine outside a container gives remote MCP access with working playback.

1. Run `navidrome-mcp serve` on the machine wired to your speakers.
2. Point remote clients at `http://that-machine:3000/mcp`.
3. Set an `authToken`.

## ChatGPT

ChatGPT's MCP support, on the web and desktop, needs a hosted HTTPS endpoint. It does not work with local stdio servers. You can host this server over the HTTP transport behind a reverse proxy that adds TLS, with no bridge such as [`mcp-remote`](https://www.npmjs.com/package/mcp-remote). A client with stdio support is simpler for a self-hosted music server.

## Docker Quick Start

A prebuilt multi-arch image is published on each release.

```bash
docker pull ghcr.io/blakeem/navidrome-mcp:latest
```

Or build it from source with `docker build -t navidrome-mcp .`, then use `navidrome-mcp` in place of the GHCR name below.

The image defaults to the HTTP transport bound to all interfaces. It bakes in `MCP_TRANSPORT=http` and `MCP_HTTP_EXPOSE=true` as env fallbacks, so the only required config is your Navidrome credentials.

```bash
docker run --rm -p 3000:3000 \
  -e NAVIDROME_URL=http://your-navidrome:4533 \
  -e NAVIDROME_USERNAME=mcp \
  -e NAVIDROME_PASSWORD=your-password \
  -e MCP_HTTP_AUTH_TOKEN=a-long-random-secret \
  ghcr.io/blakeem/navidrome-mcp:latest
```

The MCP endpoint is then at `http://localhost:3000/mcp`. The image ships a Docker `HEALTHCHECK` that polls `GET /healthz` on port 3000, so `docker ps` shows `healthy` and orchestrators can use the same endpoint. The image runs as a non-root user. [Configuration](CONFIGURATION.md) lists every environment variable and the [env fallback](CONFIGURATION.md#without-a-settings-page) rules.

The HTTP socket binds only after the server has logged in to Navidrome and loaded its caches, so give health checks time to start. The image's `HEALTHCHECK` sets `--start-period=10s`. In Kubernetes, use a `startupProbe` so that a slow Navidrome does not get the pod killed before it binds.

## No Audio in the Image

mpv is not installed, so the container registers the library tools only. The 22 playback tools, such as `play_songs`, `pause`, and the live queue tools, are absent from `tools/list`, and the Jukebox Remote never starts. Search, playlists, ratings, listening history, radio, Last.fm, and lyrics work as they do over stdio. Radio discovery and LRCLIB lyrics stay off until their environment variables are set.

### Adding mpv to the Image

Installing mpv in the image makes the playback tools and the Jukebox Remote appear. Audio still has to reach a real sound device, so running the server on the host is the better route to audio.

- **Linux host:** pass a device through with `--device /dev/snd` (ALSA), or mount the PulseAudio or PipeWire socket and set `PULSE_SERVER`. Publish `8808` and set `WEBUI_EXPOSE=true` for the Jukebox Remote. Open the Jukebox Remote by the host's IP address. To open it by a host name, list that name in `WEBUI_ALLOWED_HOSTS`, since the container's own name is not the host's.
- **Docker Desktop (Windows and macOS):** audio does not work. The engine runs in a Linux VM with no audio device. `--device /dev/snd` fails with *no such file or directory*, even with `--privileged`.
- **Radio station names:** the `node:24-bookworm-slim` base installs mpv 0.35.1, which lacks the `user-data` property. A radio station that shares its stream URL with another saved station is then named after the first matching station. The correct name needs mpv 0.36 or later.

Without a device, mpv's ALSA, PipeWire, and JACK backends fail, and mpv falls back to its null output. The engine pauses playback, and the play tools return `paused: true` with a message that no audio output device is available.

## Mounting a settings.json

A `settings.json` mounted at `/config/settings.json` replaces the environment variables, since the image points `NAVIDROME_CONFIG_PATH` there. Some unusable files block the env fallback, as [Without a Settings Page](CONFIGURATION.md#without-a-settings-page) lists. Setup mode cannot run under `MCP_TRANSPORT=http`, so the container then logs the reason and exits with code 1. The image runs as the `node` user (UID 1000), which must be able to read the mounted file. An unreadable file stops the container the same way.

The file holds your Navidrome credentials in plain text. So in an orchestrator, mount it from a secret store such as a Kubernetes `Secret` or compose secrets, not from a plain config object.

```bash
docker run --rm -p 3000:3000 \
  -v "$PWD/settings.json:/config/settings.json:ro" \
  ghcr.io/blakeem/navidrome-mcp:latest
```

> **With a mounted `settings.json`, the file is the entire config.** The image's env defaults no longer apply, so the file itself must set `transport.type: "http"` and `transport.expose: true`. A container has to bind `0.0.0.0`, not loopback, to be reachable through the published port.
>
> Left at the `stdio` default, the container starts, connects to Navidrome, and exits with code 0 within a second. Since stdio expects a client on stdin and a detached container has none, the transport sees EOF at once. Docker shows `Exited (0)`, the log ends in `Navidrome MCP Server started successfully`, and no port is bound. With a restart policy the container restarts in a loop with no error, so check for `transport.type: "http"` first when a container with a mounted config won't stay up.
