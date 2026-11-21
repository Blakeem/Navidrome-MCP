# Troubleshooting

Each section names a symptom and gives the fix for each platform it affects.

## The MCP Client Cannot Start the Server

- **Invalid JSON.** Check the MCP client config file. A trailing comma or a single quote breaks it.
- **Windows.** Claude Code and other clients that start the server without a shell need `"command": "cmd"` and `"args": ["/c", "npx", "navidrome-mcp"]`. `navidrome-mcp connect` writes this form on Windows.
- **macOS.** A client started from the Dock or Finder may not have Homebrew on its `PATH`, so it can't find `npx` or `node`. The Claude Desktop log then shows `spawn npx ENOENT` or `spawn node ENOENT`. Run `navidrome-mcp connect --absolute`, which writes the full paths of `node` and the installed server. Run it again after you update, move, or reinstall navidrome-mcp.

Run `node --version` to check the version. The server needs Node.js 24.19 or later.

## The Server Is in Setup Mode

The MCP client shows only the `open_settings` and `test_connection` tools. Both return the settings page URL and what went wrong.

- The server starts in setup mode when nothing is configured yet, or when the saved settings fail at startup.
- If the settings were rejected, the settings page opens so you can fix them. Save them, then restart the MCP client.
- If Navidrome was unreachable, the page stays closed, since the settings may be fine. Restart the MCP client once Navidrome is back up.
- The server also logs the settings page URL, which helps where a browser can't open, such as over SSH.

An HTTP server has no setup mode. With `MCP_TRANSPORT=http` it logs the reason and exits with code 1, as [Configuration](CONFIGURATION.md#without-a-settings-page) describes.

## Navidrome Is Unreachable

- Check that Navidrome is running and reachable from this computer.
- Check that the **Server URL** in the settings page starts with `http://` or `https://`.
- Click **Test connection** in the settings page before you save. A browser or a `curl` call to the same URL also tests it.

## mpv Is Not Found

The server looks for mpv when it starts, and it registers the playback tools only when it finds mpv. Run `mpv --version` in a new terminal. If it fails, set **mpv binary path** in the settings page to the full mpv path, then restart the MCP client.

- **macOS.** A client started from the Dock or Finder may not find Homebrew's mpv. Set **mpv binary path** to `/opt/homebrew/bin/mpv` on Apple Silicon or `/usr/local/bin/mpv` on Intel.
- **Windows.** The `shinchiro.mpv` package installs to `C:\Program Files\MPV Player\` and does not add itself to `PATH`. Add that folder to `PATH`, or set **mpv binary path** to `C:\Program Files\MPV Player\mpv.exe`. Scoop, Chocolatey, and a manual zip use other folders.

## The Shortcut Opens Nothing

The Jukebox Remote writes its log to `jukebox-remote.log` beside `settings.json`. Run `navidrome-mcp help` to print both paths. Read the end of the log, fix the settings with `navidrome-mcp settings`, and launch the shortcut again.

Run `navidrome-mcp shortcut` again after you move or reinstall navidrome-mcp, since the shortcut stores the paths to `node` and the installed package. On GNOME, right-click the desktop icon and choose **Allow Launching** the first time.

## Locked Out of the Jukebox Remote

The player asks for an admin password that nobody knows.

1. In `settings.json`, set `webui.auth.adminPasswordHash` to `null`. A running player reads the change within about 10 seconds. Another way is to turn off **Ask for the admin password on this computer** with `navidrome-mcp settings`, which applies the next time a player page loads.
2. Open the Jukebox Remote from the desktop shortcut on the host computer, or ask the AI to open it. It opens as admin with no login.
3. Set a new password in **All settings** in the gear menu.

## Logs and Debug Mode

- **MCP server log.** The MCP client keeps it. Claude Desktop on macOS writes it to `~/Library/Logs/Claude/mcp*.log`.
- **Jukebox Remote log.** `navidrome-mcp help` prints its path.
- **Debug mode.** Turn on **Verbose debug logging** (`advanced.debug`) in the settings page, then restart the MCP client. The server then logs extra detail.

To watch the server start, run `navidrome-mcp serve` in a terminal. It prints its log and stops with Ctrl+C.

[Report an issue](https://github.com/Blakeem/Navidrome-MCP/issues) with your operating system, your Node.js version, the error from the log, and your MCP client config with the passwords removed.
