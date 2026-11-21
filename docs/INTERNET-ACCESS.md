# Internet Access

This page covers a Jukebox Remote that other devices can reach, from the LAN or from the internet. The README's [Access Modes](../README.md#access-modes) section describes the three access modes.

## What Each Mode Exposes

In the Open mode, anyone who reaches the port gets these features. The two password modes give them to a logged in admin.

- **Control:** playback transport, volume, the audio output, queue jumps, shuffling, removing queue entries, clearing the queue, and starting any library source.
- **Read:** library search and browsing, recently played history, playlist names, starred counts, cover art, live now-playing and queue state, lyrics of queued songs, the names of the host's audio outputs, and the host's LAN addresses.

The settings page is never exposed. [Access Modes](../README.md#access-modes) lists the controls that work only on the host computer.

## Who Can Reach the Port

The bind address decides who can reach the port.

- With `webui.host=127.0.0.1` (the default), only the host computer reaches it.
- With **Expose on LAN** (`webui.expose=true`), anything on the LAN reaches it. The Open mode is fine on a trusted home network. Once exposed, `GET /healthz` returns `404` off the host, so the player does not leak a version fingerprint.

An internet address gets `403` unless the admin login is allowed from anywhere, or the jukebox is open. Neither applies to the Open mode.

The player treats an address as local when it is the host itself or on one of the host's own subnets. Private, link-local, and carrier-grade NAT addresses (`100.64.0.0/10`, which Tailscale uses) count as local too. Port forwarding in Docker, WSL, or a router can make an internet client look local. A reverse proxy or tunnel on the host, such as Tailscale Funnel or cloudflared, does the same. So use a mode with the admin password for any player the internet can reach.

## Admin Login

These rules cover the admin login.

- **Password:** set it in the settings page as **Admin password**, or with `WEBUI_ADMIN_PASSWORD` on a headless host. [When Changes Apply](CONFIGURATION.md#when-changes-apply) says when a new password applies.
- **This computer:** with no admin password set, or with **Ask for the admin password on this computer** off, the host computer opens the player as admin with no login. The **Ask for the admin password on this computer** row in [Configuration](CONFIGURATION.md#webui) says which addresses count. This works only when the desktop shortcut, `navidrome-mcp jukebox`, the AI or the settings page link shown when a Save starts the player opens the player. Each of them adds a launch key to the address. A tunnel or proxy on the host cannot send that key.
- **Where:** **Admin login allowed from** picks this computer only (the default), the local network, or anywhere. A browser outside that range sees no login page.
- **Sessions:** a login lasts 7 days without use, and 30 days at most. Changing the password signs out every admin session.
- **Wrong passwords:** each failure doubles the wait before the next attempt, from 1 second up to 1 hour. Each network also gets 10 attempts per 15 minutes. A login from this computer skips the doubling wait, so a guest can't lock you out.

Allow the admin login from anywhere only with HTTPS, since over HTTP the password crosses the internet in plain text.

## Internet Guests

1. Forward the player's port on your router to the host.
2. Set **Public URL** in the settings page to the address guests reach, such as `http://203.0.113.7:8808`. A DuckDNS name stays valid when your home IP address changes.
3. Shut down the player and start it again, as [When Changes Apply](CONFIGURATION.md#when-changes-apply) describes. Then open the jukebox and pick **Internet** to show the code for the public URL.

Internet guests reach the player only while the jukebox is open. Each internet address can join 10 times per hour, and each code admits at most 100 guests.

## HTTPS

Use HTTPS once guests connect from the internet. Over HTTP, anyone on the network path can read the jukebox code and a guest's session, which grants guest access only. Use a trusted certificate, since a self-signed one makes every guest's browser show a warning.

The player uses HTTPS when **HTTPS certificate file** and **HTTPS key file** are set, and it loads a renewed certificate within a minute. These steps get a free Let's Encrypt certificate for a DuckDNS name with [acme.sh](https://github.com/acmesh-official/acme.sh). Since acme.sh proves the name through DNS, port 80 can stay closed.

1. Create a subdomain at [duckdns.org](https://www.duckdns.org), such as `jukebox.duckdns.org`, and point it at your home IP address.
2. Install acme.sh. On Windows, run it in WSL.
3. Issue the certificate with your DuckDNS token.
   ```bash
   export DuckDNS_Token="your-token"
   acme.sh --issue --server letsencrypt --dns dns_duckdns -d jukebox.duckdns.org
   ```
4. Copy the files to a folder the player can read. acme.sh copies them again on each renewal.
   ```bash
   acme.sh --install-cert -d jukebox.duckdns.org \
     --fullchain-file /path/to/certs/fullchain.pem \
     --key-file /path/to/certs/privkey.pem
   ```
5. Set the two HTTPS files in the settings page, and set **Public URL** to `https://jukebox.duckdns.org:8808`. Then shut down the player and start it again.

The browser warns that the connection is not private on the 127.0.0.1 and LAN addresses, since the certificate names only the public host. This warning is expected for this player.
