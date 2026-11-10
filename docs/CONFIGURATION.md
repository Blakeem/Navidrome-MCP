# Configuration

## Where Settings Live

Every setting lives in one `settings.json` file, which the settings page edits. Open the settings page with **All settings** in the Jukebox Remote's gear menu on the host computer, or run `navidrome-mcp settings` in a terminal. The settings page binds to loopback only, so it opens only on the host computer.

The settings page shows where it saves the file. The default location depends on the operating system.

- **Windows:** `%APPDATA%\navidrome-mcp\settings.json`
- **macOS:** `~/Library/Application Support/navidrome-mcp/settings.json`
- **Linux:** `~/.config/navidrome-mcp/settings.json`, or `$XDG_CONFIG_HOME/navidrome-mcp/settings.json` when that variable is set

The `NAVIDROME_CONFIG_PATH` environment variable moves the file to another path. [`settings.example.json`](../settings.example.json) shows the file's shape.

## When Changes Apply

These settings apply live.

- The theme, visualizer, and keep-playing settings in the gear menu.
- The guest song limit in the **Guests** dialog.
- The share link in the **Jukebox** dialog.

Other Jukebox Remote settings apply after **Shut down player** in the gear menu and a new start. A new start is the next play from the AI, a restart of the MCP client, or `navidrome-mcp jukebox`.

MCP server settings apply after the MCP server restarts. A stdio server restarts with its MCP client. An HTTP server started with `navidrome-mcp serve` needs its own restart.

A new admin password applies to a running player within about 10 seconds and signs out every admin session. This holds when the player runs from `settings.json` and **Access** already uses a password. A change of **Access**, or a player started from environment variables, needs a restart.

## Settings

Each table covers one section of `settings.json`. The settings page column names the field label, or "none" with the place that sets the key instead. The environment variable column names the variable the [env fallback](#without-a-settings-page) reads.

### navidrome

| Settings page | `settings.json` key | Environment variable | Default | Effect |
|---|---|---|---|---|
| **Server URL** | `navidrome.url` | `NAVIDROME_URL` | none | The Navidrome address, with `http://` or `https://`. |
| **Username** | `navidrome.username` | `NAVIDROME_USERNAME` | none | The Navidrome account the server uses. |
| **Password** | `navidrome.password` | `NAVIDROME_PASSWORD` | none | The password of that account, stored in plain text. |

### transport

| Settings page | `settings.json` key | Environment variable | Default | Effect |
|---|---|---|---|---|
| **Type** | `transport.type` | `MCP_TRANSPORT` | `stdio` | `stdio` lets the MCP client start the server. `http` serves MCP at `/mcp` for network clients, as [HTTP and Docker](HTTP-AND-DOCKER.md) describes. |
| **Bind host** | `transport.host` | `MCP_HTTP_HOST` | `null` | The address the HTTP transport binds. Blank binds `127.0.0.1`, or `0.0.0.0` with `transport.expose`. A value here overrides `transport.expose`. |
| **Port** | `transport.port` | `MCP_HTTP_PORT` | `3000` | The port the HTTP transport listens on. |
| **Expose on network** | `transport.expose` | `MCP_HTTP_EXPOSE` | `false` | Binds `0.0.0.0`, so remote clients can reach the server. |
| **Auth token** | `transport.authToken` | `MCP_HTTP_AUTH_TOKEN` | blank | Every `/mcp` request must carry `Authorization: Bearer <token>`. Blank means no auth. **Generate** makes a token. |
| **Allowed hosts** | `transport.allowedHosts` | `MCP_HTTP_ALLOWED_HOSTS` | `[]` | The `Host` header values the server accepts. [Host Filtering](HTTP-AND-DOCKER.md#host-filtering) describes the default. |
| **Allowed origins** | `transport.allowedOrigins` | `MCP_HTTP_ALLOWED_ORIGINS` | `[]` | The `Origin` header values the server accepts. Only browser clients need it. |

### library

| Settings page | `settings.json` key | Environment variable | Default | Effect |
|---|---|---|---|---|
| **Default libraries** | `library.defaultLibraryIds` | `NAVIDROME_DEFAULT_LIBRARIES` | `[]` | The library IDs that are active at startup. Empty means all. `set_active_libraries` changes them until the server restarts. |
| **Cache filter/tag values at startup** | `library.filterCacheEnabled` | `NAVIDROME_FILTER_CACHE_ENABLED` | `true` | Loads the genre and tag values once at startup. `false` fetches them on each filtered search, so new tag values show at once. |

### features

| Settings page | `settings.json` key | Environment variable | Default | Effect |
|---|---|---|---|---|
| **API key** (Last.fm) | `features.lastFmApiKey` | `LASTFM_API_KEY` | `null` | Turns on the Last.fm tools. A key is free at [last.fm/api](https://www.last.fm/api/account/create). |
| **MusicBrainz user agent** | `features.musicBrainzUserAgent` | `MUSICBRAINZ_USER_AGENT` | `Navidrome-MCP (https://github.com/Blakeem/Navidrome-MCP)` | Identifies the server to MusicBrainz for discography lookups. |
| **Radio Browser user agent** | `features.radioBrowserUserAgent` | `RADIO_BROWSER_USER_AGENT` | `null` | Turns on radio discovery and identifies the server to Radio Browser. |
| **Radio Browser base URL** | `features.radioBrowserBase` | `RADIO_BROWSER_BASE` | `null` | A Radio Browser server. Blank picks a mirror automatically. |
| **Provider** (Lyrics) | `features.lyricsProvider` | `LYRICS_PROVIDER` | `null` | `lrclib` turns on LRCLIB lyrics when an LRCLIB user agent is set. |
| **LRCLIB user agent** | `features.lrclibUserAgent` | `LRCLIB_USER_AGENT` | `null` | Identifies the server to LRCLIB. LRCLIB lyrics need it. |
| **LRCLIB base URL** | `features.lrclibBase` | `LRCLIB_BASE` | `https://lrclib.net` | The LRCLIB server. |

The first run of the settings page fills in `Navidrome-MCP` for both user agents and `lrclib` for the provider, so radio discovery and LRCLIB lyrics start on. The env fallback leaves them off until you set their variables.

### playback

| Settings page | `settings.json` key | Environment variable | Default | Effect |
|---|---|---|---|---|
| **mpv binary path** | `playback.mpvPath` | `MPV_PATH` | `null` | The mpv binary. Blank finds mpv on `PATH`. Without mpv, the server registers no playback tools and starts no Jukebox Remote. |
| **Transcode format** | `playback.transcodeFormat` | `PLAYBACK_TRANSCODE_FORMAT` | `raw` | `raw` streams the original file with reliable seeking. A codec such as `mp3` or `opus` suits slow or metered links. |
| **Transcode bitrate (kbps)** | `playback.transcodeBitrate` | `PLAYBACK_TRANSCODE_BITRATE` | `192` | Applies only when a codec is set. |
| **Audio output** | `playback.audioDevice` | `PLAYBACK_AUDIO_DEVICE` | `null` | The output mpv plays through. `null` uses the system default. `set_audio_device` also saves it. The environment variable takes an `id` from `list_audio_devices`. |

### webui

| Settings page | `settings.json` key | Environment variable | Default | Effect |
|---|---|---|---|---|
| **Run the Jukebox Remote** | `webui.enabled` | `WEBUI_ENABLED` | `true` | `false` turns off the Jukebox Remote. The AI still plays music through mpv. |
| **Port** | `webui.port` | `WEBUI_PORT` | `8808` | The port the player listens on. Change it when another program uses 8808. |
| **Bind host** | `webui.host` | `WEBUI_HOST` | `null` | One of `127.0.0.1`, `0.0.0.0`, or `::`. Any other value binds `127.0.0.1`. A value here overrides `webui.expose`. |
| **Expose on LAN** | `webui.expose` | `WEBUI_EXPOSE` | `false` | Binds `0.0.0.0`, so other devices on your LAN can reach the player. |
| **Allowed hosts** | `webui.allowedHosts` | `WEBUI_ALLOWED_HOSTS` | `[]` | Extra host names the player accepts on a LAN bind, such as `music.home.lan`. An IP address, `localhost`, this computer's name, and the Public URL host always work. Other host names get `403`, which blocks DNS rebinding. |
| **Public URL** | `webui.publicUrl` | `WEBUI_PUBLIC_URL` | `null` | The address internet guests use, with no path, such as `https://jukebox.duckdns.org:8808`. It starts with `https://` when the HTTPS files are set. The **Jukebox** dialog adds a join code for it. |
| **Open the player in your browser automatically** | `webui.autoOpenBrowser` | `WEBUI_AUTO_OPEN_BROWSER` | `false` | Opens the player when the MCP server starts it. `navidrome-mcp jukebox` always opens a browser. |
| **Keep playing after the MCP server closes** | `webui.persistAfterMcpExit` | `WEBUI_PERSIST_AFTER_MCP_EXIT` | `false` | Keeps a player the MCP server started running after the last MCP server closes. The gear menu also sets it. |
| **Show a music visualizer in the player** | `webui.visualizer` | `WEBUI_VISUALIZER` | `true` | `false` removes the visualizer and the audio analysis it adds to mpv. The analysis uses about 2.5% of one CPU core while music plays. The gear menu also sets it. |
| **HTTPS certificate file** | `webui.tls.certPath` | `WEBUI_TLS_CERT` | `null` | The PEM certificate chain, such as `fullchain.pem` from Let's Encrypt. Set both HTTPS files to serve HTTPS. |
| **HTTPS key file** | `webui.tls.keyPath` | `WEBUI_TLS_KEY` | `null` | The PEM private key, such as `privkey.pem`. The player loads a renewed pair within a minute. A missing or invalid file stops the player from starting. |
| **Access** | `webui.auth.mode` | `WEBUI_AUTH_MODE` | `none` | `none` (Open), `password` (Admin password), or `jukebox` (Admin password and jukebox). [Internet Access](INTERNET-ACCESS.md) describes what each mode exposes. |
| **Admin password** | `webui.auth.adminPasswordHash` | `WEBUI_ADMIN_PASSWORD` | `null` | The settings page stores only the hash of the password you type. Passwords are 12 to 128 characters. |
| **Admin login allowed from** | `webui.auth.adminAccess` | `WEBUI_ADMIN_ACCESS` | `localhost` | Where an admin can log in, one of `localhost` (this computer), `lan`, or `anywhere`. |
| none (the gear menu's **Theme**) | `webui.theme` | none | unset | Forces `light` or `dark` on every device viewing the player. When unset, each device follows its own setting. **System** in the gear menu clears it. |

### jukebox

| Settings page | `settings.json` key | Environment variable | Default | Effect |
|---|---|---|---|---|
| **Guest song limit** | `jukebox.guestQueueLimit` | `JUKEBOX_GUEST_QUEUE_LIMIT` | `3` | How many songs each jukebox guest can have waiting, from 1 to 20. The **Guests** dialog also sets it. |
| none (the **Jukebox** dialog) | `jukebox.shareLink` | none | `lan` | Which link the jukebox code holds, `lan` or `internet`. The **Local network** and **Internet** buttons set it. |

### advanced

| Settings page | `settings.json` key | Environment variable | Default | Effect |
|---|---|---|---|---|
| **Verbose debug logging** | `advanced.debug` | `DEBUG` | `false` | `true` turns on verbose logs. |
| **Token expiry (seconds)** | `advanced.tokenExpiry` | `TOKEN_EXPIRY` | `86400` | How long the server keeps a Navidrome login token. |

## Without a Settings Page

The settings page binds loopback only, so a host with no browser, such as a VPS or a Docker container, runs from environment variables instead.

- The server reads the environment variables when `settings.json` is absent, fails the settings schema, or has no Navidrome URL.
- A `settings.json` that cannot be read, is not valid JSON, or has a Navidrome URL that fails validation starts setup mode instead.
- An unusable `settings.json` that sets an access mode with the admin password also starts setup mode, so a broken file never opens a player that needs a password.
- With `MCP_TRANSPORT=http`, the server logs the reason and exits with code 1 instead of starting setup mode.
- A usable `settings.json` always wins over the environment variables.

A boolean variable takes `true` or `false`, and a list variable takes comma-separated values. A value that is not a number, not `true` or `false`, or not a supported option logs a warning, and the server uses the default. `WEBUI_AUTH_MODE` is the one exception, as the next paragraph describes. A value that breaks a setting's rule, such as a port above `65535` or a malformed URL, makes the configuration invalid. The server then starts setup mode, or exits with code 1 under `MCP_TRANSPORT=http`.

`WEBUI_AUTH_MODE` takes `none`, `password`, or `jukebox`. Any other value turns on `password`, so a typo never leaves the player open. `WEBUI_ADMIN_PASSWORD` takes the password itself, which the player hashes at startup. The player reads it only when it runs from environment variables, so a new value needs a restart.

On a first run, the settings form pre-fills from the environment variables in your shell and from a `.env` file. The form sees the `env` block in your MCP client's JSON only when the MCP server opens the settings page itself. A `.env` file is never read at runtime.

These variables have no `settings.json` key.

| Environment variable | Default | Effect |
|---|---|---|
| `NAVIDROME_REQUEST_TIMEOUT_MS` | `15000` | The timeout of each Navidrome request, in milliseconds. |
| `NAVIDROME_AUTH_TIMEOUT_MS` | `10000` | The timeout of a Navidrome login, in milliseconds. |
| `EXTERNAL_API_TIMEOUT_MS` | `15000` | The timeout of each Last.fm, MusicBrainz, LRCLIB, and Radio Browser request, in milliseconds. |
| `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` | unset | Routes the Last.fm, MusicBrainz, LRCLIB, and Radio Browser requests through a proxy. Lowercase names work too. Navidrome requests and radio stream checks always go direct. The server reads them once, so a change needs a restart. |
| `NAVIDROME_CONFIG_PATH` | unset | Moves `settings.json` to this path. |
| `NAVIDROME_WEB_AUTO_OPEN` | unset | `0` stops `navidrome-mcp jukebox` from opening a browser. |
