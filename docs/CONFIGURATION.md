# Configuration

## Where Settings Live

Every setting lives in one `settings.json` file, which the settings page edits. Open the settings page with **All settings** in the Jukebox Remote's gear menu on the host computer, or run `navidrome-mcp settings` in a terminal. The settings page binds to loopback only, so it opens only on the host computer.

The settings page shows where it saves the file. The default location depends on the operating system.

- **Windows:** `%APPDATA%\navidrome-mcp\settings.json`
- **macOS:** `~/Library/Application Support/navidrome-mcp/settings.json`
- **Linux:** `~/.config/navidrome-mcp/settings.json`, or `$XDG_CONFIG_HOME/navidrome-mcp/settings.json` when that variable is set

The `NAVIDROME_CONFIG_PATH` environment variable moves the file to another path. [`settings.example.json`](../settings.example.json) shows a short file with the keys people change most, and the tables below list every key.

## When Changes Apply

After **Save settings**, the settings page names the restarts the change needs. The first Save of a new install names the next step and the Jukebox Remote address instead. A Jukebox Remote started with no usable settings, such as from the desktop shortcut, opens the settings page and starts once a Save makes the settings usable.

These settings apply live.

- The theme, visualizer, and keep-playing settings in the gear menu.
- The guest song limit in the **Guests** dialog.
- The share link in the **Jukebox** dialog.

A new admin password applies to a running player within about 10 seconds and signs out every admin session. **Ask for the admin password on this computer** and **Admin login allowed from** apply to a running player the next time one of its pages loads. Turning the ask back on, or narrowing **Admin login allowed from**, signs out the affected admin sessions within about 10 seconds. This holds when the player runs from `settings.json` and **Access** already uses a password. A change of **Access**, or a player started from environment variables, needs a restart.

Other Jukebox Remote settings apply after **Shut down player** in the gear menu and a new start. A new start is the next play from the AI, a restart of the MCP client, or `navidrome-mcp jukebox`.

MCP server settings apply after the MCP server restarts. A stdio server restarts with its MCP client. An HTTP server started with `navidrome-mcp serve` needs its own restart.

## Settings

Each table covers one section of `settings.json`. The settings page column names the field label, or "none" with the place that sets the key instead. The top of the settings page holds the three Navidrome fields, the Last.fm **API key**, the radio and lyrics boxes, **Audio output**, **Run the Jukebox Remote**, **Open the player in your browser automatically**, **Expose on LAN**, **Access**, **Admin password**, and **Ask for the admin password on this computer**. Every other field sits under **Advanced settings**. The environment variable column names the variable the [env fallback](#without-a-settings-page) reads.

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
| **Default libraries** | `library.defaultLibraryIds` | `NAVIDROME_DEFAULT_LIBRARIES` | `[]` | The library IDs that are active at startup. Empty means all. The settings page lists the libraries by name once the connection works, and shows no field for a single library. `set_active_libraries` changes them until the server restarts. |
| **Cache filter/tag values at startup** | `library.filterCacheEnabled` | `NAVIDROME_FILTER_CACHE_ENABLED` | `true` | Loads the genre and tag values once at startup. `false` fetches them on each filtered search, so new tag values show at once. |

### features

| Settings page | `settings.json` key | Environment variable | Default | Effect |
|---|---|---|---|---|
| **API key** (Last.fm) | `features.lastFmApiKey` | `LASTFM_API_KEY` | `null` | Turns on the Last.fm tools. A key is free at [last.fm/api](https://www.last.fm/api/account/create). |
| **Find internet radio stations** | `features.radio` | none | `false` | `true` turns on radio discovery through Radio Browser. |
| **Look up lyrics online from LRCLIB** | `features.lyrics` | none | `false` | `true` turns on LRCLIB lyrics. Lyrics stored in your music files show without it. |
| **Radio Browser user agent** | `features.radioBrowserUserAgent` | `RADIO_BROWSER_USER_AGENT` | `Navidrome-MCP` | Optional override of the name the server sends to Radio Browser. |
| **Radio Browser base URL** | `features.radioBrowserBase` | `RADIO_BROWSER_BASE` | `null` | Optional override of the Radio Browser server. Blank picks a mirror automatically. |
| **LRCLIB user agent** | `features.lrclibUserAgent` | `LRCLIB_USER_AGENT` | `Navidrome-MCP` | Optional override of the name the server sends to LRCLIB. |
| **LRCLIB base URL** | `features.lrclibBase` | `LRCLIB_BASE` | `https://lrclib.net` | Optional override of the LRCLIB server. |
| none | `features.musicBrainzUserAgent` | `MUSICBRAINZ_USER_AGENT` | `Navidrome-MCP (https://github.com/Blakeem/Navidrome-MCP)` | Optional override of the name the server sends to MusicBrainz for discography lookups. |
| none | `features.lyricsProvider` | `LYRICS_PROVIDER` | `null` | Read only from a file with no `features.lyrics`, as the next paragraphs describe. |

The first run of the settings page checks both boxes, so radio discovery and LRCLIB lyrics start on. A file written before `features.radio` and `features.lyrics` existed keeps its earlier state through the older keys. A file that names neither the booleans nor the older keys turns both off.

- With no `features.radio`, radio is on when `features.radioBrowserUserAgent` holds a value.
- With no `features.lyrics`, lyrics are on when `features.lyricsProvider` is `lrclib` and `features.lrclibUserAgent` holds a value.

The next Save writes both booleans and removes `features.lyricsProvider`.

The env fallback has no variable for the two boxes. `RADIO_BROWSER_USER_AGENT` turns radio on. `LYRICS_PROVIDER=lrclib` with `LRCLIB_USER_AGENT` turns lyrics on. The provider name matches in any letter case. Any other non-blank `LYRICS_PROVIDER` or `features.lyricsProvider` turns lyrics off and logs a warning.

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
| none (the gear menu's **Keep playing after the MCP server closes**) | `webui.persistAfterMcpExit` | `WEBUI_PERSIST_AFTER_MCP_EXIT` | `false` | Keeps a player the MCP server started running after the last MCP server closes. |
| none (the gear menu's **Show the visualizer beside the track info**) | `webui.visualizer` | `WEBUI_VISUALIZER` | `true` | `false` removes the visualizer and the audio analysis it adds to mpv. The analysis uses about 2.5% of one CPU core while music plays. |
| **HTTPS certificate file** | `webui.tls.certPath` | `WEBUI_TLS_CERT` | `null` | The PEM certificate chain, such as `fullchain.pem` from Let's Encrypt. Set both HTTPS files to serve HTTPS. |
| **HTTPS key file** | `webui.tls.keyPath` | `WEBUI_TLS_KEY` | `null` | The PEM private key, such as `privkey.pem`. The player loads a renewed pair within a minute. A missing or invalid file stops the player from starting. |
| **Access** | `webui.auth.mode` | `WEBUI_AUTH_MODE` | `none` | `none` (Open), `password` (Admin password), or `jukebox` (Admin password and jukebox). [Internet Access](INTERNET-ACCESS.md) describes what each mode exposes. |
| **Admin password** | `webui.auth.adminPasswordHash` | `WEBUI_ADMIN_PASSWORD` | `null` | The settings page stores only the hash of the password you type. Passwords are 8 to 128 characters. With no password set in mode `password` or `jukebox`, this computer opens the player as admin with no login, and no other device can log in as admin. The **Ask for the admin password on this computer** row says which launchers open it with no login. |
| **Ask for the admin password on this computer** | `webui.auth.askPasswordOnThisComputer` | none | `true` | `false` opens the player as admin with no login on this computer in mode `password` or `jukebox`. Other devices still need the password. This computer counts only at a `localhost`, `127.0.0.1`, or `[::1]` address with no proxy header, such as `X-Forwarded-For`. The player must also be opened by the desktop shortcut, `navidrome-mcp jukebox`, the AI or the settings page link shown when a Save starts the player, since each adds a launch key to the address. The env fallback always asks. |
| **Admin login allowed from** | `webui.auth.adminAccess` | `WEBUI_ADMIN_ACCESS` | `localhost` | Where an admin can log in, one of `localhost` (this computer), `lan`, or `anywhere`. |
| none (the gear menu's **Theme**) | `webui.theme` | none | unset | Forces `light` or `dark` on every device viewing the player. When unset, each device follows its own light or dark mode, and a guest or a remote admin can pick light or dark for that browser only. **System** in the gear menu clears it. |

### jukebox

| Settings page | `settings.json` key | Environment variable | Default | Effect |
|---|---|---|---|---|
| none (the **Guests** dialog's **Song limit**) | `jukebox.guestQueueLimit` | `JUKEBOX_GUEST_QUEUE_LIMIT` | `3` | How many songs each jukebox guest can have waiting, from 1 to 20. |
| none (the **Jukebox** dialog) | `jukebox.shareLink` | none | `lan` | Which link the jukebox code holds, `lan` or `internet`. The **Local network** and **Internet** buttons set it. |

### advanced

| Settings page | `settings.json` key | Environment variable | Default | Effect |
|---|---|---|---|---|
| **Verbose debug logging** | `advanced.debug` | `DEBUG` | `false` | `true` turns on verbose logs. |
| none | `advanced.tokenExpiry` | `TOKEN_EXPIRY` | `86400` | The lifetime in seconds of a Navidrome login token that carries no expiry. The server renews any other token 60 seconds before the expiry the token carries. |

## Editing settings.json by Hand

The server log and the settings page show a notice for each problem in a hand edit, with the key and the fix. When the file stops the MCP server from starting, setup mode's reason lists the notices too.

- A key this version does not know stays in the file, and the notice names the nearest known key, such as `webui.prot is not a setting this version knows. Did you mean webui.port?`
- A `webui.auth.adminPassword` key is never read, since it would hold the password as plain text. Set the password on the settings page, then delete the key.

The server reads past these slips with a notice. The `webui.auth` keys get no such pass.

- A number in quotes, such as `"port": "8808"`, is read as the number.
- `"true"` or `"false"` in quotes is read as the boolean.
- A number in `playback.transcodeBitrate`, such as `192`, is read as the text `"192"`.

Any other wrong value makes the server ignore the entire file, and the log and the settings page name the key and what is wrong. The settings page then shows each value of the file it can accept, so a Save keeps them.

When `webui.host` binds another address than `webui.expose` asks for, the server logs a warning at startup that names both keys. `webui.host` wins. `transport.host` and `transport.expose` get the same check.

A Save writes only keys that hold a value. It drops `null`, `""`, `[]`, and empty objects. It keeps every unknown key and every value equal to its default.

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
