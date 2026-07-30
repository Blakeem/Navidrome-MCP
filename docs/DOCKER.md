# Running in Docker

The included [`Dockerfile`](../Dockerfile) packages the server for the
[HTTP transport](../README.md#running-over-http): an always-on, library-only MCP
endpoint you can run next to Navidrome.

## What each deployment shape gives you

The transport decides who can reach the MCP protocol; it does not move where the
audio comes out (the MPV Remote is a control panel, not an audio stream). The
machine that runs the server is always the machine that makes the sound.

| Deployment | MCP reachable from | Local audio (mpv) | MPV Remote web UI |
|---|---|---|---|
| **stdio** (default) | the client that spawned it, same machine | ✅ plays on your machine | ✅ `localhost:8808`, LAN with **Expose on LAN** |
| **HTTP on your machine** | any host that can reach `host:3000` | ✅ plays on your machine | ✅ same as stdio |
| **HTTP in Docker** (this image) | any host that can reach the published port | ❌ no mpv in the image | ❌ never starts (needs mpv) |
| **HTTP in Docker + mpv installed** | same | ⚠️ only with host audio passthrough, Linux hosts only | ✅ if you publish `8808` and set `WEBUI_EXPOSE=true` |

Want remote MCP access *and* working audio? Skip the container: run the server with
the HTTP transport on the machine wired to your speakers (see
[Running over HTTP](../README.md#running-over-http)).

## Quick start

A prebuilt multi-arch image is published on each release:

```bash
docker pull ghcr.io/blakeem/navidrome-mcp:latest
```

Or build it from source with `docker build -t navidrome-mcp .`.

The image defaults to the HTTP transport bound to all interfaces (`MCP_TRANSPORT=http`
and `MCP_HTTP_EXPOSE=true` are baked in as env fallbacks), so the only required config
is your Navidrome credentials:

```bash
docker run --rm -p 3000:3000 \
  -e NAVIDROME_URL=http://your-navidrome:4533 \
  -e NAVIDROME_USERNAME=mcp \
  -e NAVIDROME_PASSWORD=your-password \
  -e MCP_HTTP_AUTH_TOKEN=a-long-random-secret \
  navidrome-mcp
```

The MCP endpoint is then at `http://localhost:3000/mcp`. The image ships a Docker
`HEALTHCHECK` that polls `GET /healthz` on port 3000 (so `docker ps` shows `healthy`;
orchestrators can use the same endpoint), and runs as a non-root user.

One timing note for orchestrators: the HTTP socket binds only after the server has
authenticated to Navidrome and primed its caches, so give health checks startup
slack. The image's `HEALTHCHECK` sets `--start-period=10s`; in Kubernetes, use a
`startupProbe` so a slow Navidrome doesn't get the pod killed before it ever binds.

## No audio in the image, by design

mpv is not installed, so the container registers the library toolset only: the 20
playback tools (`play_songs`, `pause`, `seek`, `set_volume`, the mpv play-queue
tools, ...) are absent from `tools/list`, and the MPV Remote web UI never starts.
Everything else (search, playlists, ratings, listening history, radio, Last.fm,
lyrics) works exactly as it does over stdio.

### Adding mpv to the image (rarely what you want)

Installing mpv in the image does make the playback tools and the web remote appear,
but audio still has to reach a real sound device:

- **Linux host:** pass one through with `--device /dev/snd` (ALSA), or mount the
  PulseAudio / PipeWire socket and set `PULSE_SERVER`. Publish `8808` and set
  `WEBUI_EXPOSE=true` (the env form of **Expose on LAN** / `webui.expose`) for the
  remote.
- **Docker Desktop (Windows/macOS):** not possible. The engine runs in a Linux VM
  with no audio device at all; `--device /dev/snd` fails with *no such file or
  directory*, even `--privileged`.

Without a device, the failure is silent to the assistant: `play_songs` still returns
`{"success": true}` and mpv accepts the queue, while mpv's ALSA/PipeWire/JACK
backends all fail in the log and playback goes straight to idle. Nothing plays and
the LLM is not told. Prefer running the server on the host when you want audio.

## Mounting a settings.json

Prefer a file over env vars? Mount a `settings.json` at `/config/settings.json` (the
image points `NAVIDROME_CONFIG_PATH` there); a mounted file always wins over env.
The file holds your Navidrome credentials in plaintext, so in an orchestrator mount
it from a secret store (a Kubernetes `Secret`, compose secrets), not a plain config
object:

```bash
docker run --rm -p 3000:3000 \
  -v "$PWD/settings.json:/config/settings.json:ro" \
  navidrome-mcp
```

> **With a mounted `settings.json`, the file is the whole config.** The image's env
> defaults no longer apply, so the file itself must set `transport.type: "http"` and
> `transport.expose: true` (a container has to bind `0.0.0.0`, not loopback, to be
> reachable through the published port).
>
> Left at the `stdio` default, the container starts, connects to Navidrome, then
> exits with code 0 within a second: stdio expects a client on stdin, and a detached
> container has none, so the transport sees EOF immediately. You get `Exited (0)`
> with a log ending in `Navidrome MCP Server started successfully` and no port
> bound. It looks like a clean run; it is a misconfiguration. With a restart policy
> it becomes a silent restart loop, so check for `transport.type: "http"` first when
> a mounted-config container won't stay up.
