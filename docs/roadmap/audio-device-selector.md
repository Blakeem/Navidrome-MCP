# Audio-Device Selector

**Status (2026-10-17):** Release 1. The decisions in [README.md](README.md#audio-device-selector) override this file where they differ: match a saved device by ID only, and pause when the device disappears.

## Verdict

BUILD. mpv already lists every output the OS exposes and switches between them at runtime over JSON-IPC, so the feature is a thin layer over two documented mpv properties [DIRECT: mpv `input.rst`, `audio-device` and `audio-device-list`]. A Bluetooth speaker becomes selectable once the OS has it connected as an active output, which is the user's driving case [DERIVED from mpv and OS audio source per backend, see Feasibility. No Bluetooth speaker was available to observe]. The design work sits in two edges. One is matching a saved choice after the OS renames a device. The other is what the player does when the speaker turns off. MVP effort is 3 to 5 days and the full roadmap is 7 to 11 days [INFERRED from the size of the comparable `webui.visualizer` setting, which touches the same store, engine, tool and web layers].

## Scope

IN SCOPE:
- Listing the outputs that mpv can open.
- Switching the shared mpv to one of them at runtime.
- Saving the choice in the settings store and applying it at each mpv spawn.
- Reacting when the chosen output disappears or comes back.
- Two MCP tools, a device picker in the web remote, a device field in the config app, and an env var for headless runs.

OUT OF SCOPE:
- Bluetooth pairing and connecting. The OS owns the Bluetooth stack. Of the studied players only moOde pairs, and moOde ships as its own OS image (see Releases, rejected ideas).
- Output to two devices at once. One mpv opens one audio output, and a second mpv conflicts with the one-player design in `docs/PLAYBACK-SPEC.md` ("Multiple simultaneous playback engines" is out of scope there).
- Changing the OS default output or the system mixer. `docs/PLAYBACK-SPEC.md` keeps volume inside mpv for the same reason.
- Network renderers such as Cast, AirPlay and Sonos. The Music Assistant Bridge item owns those.
- An mpv-enabled Docker image. The Remote Player Agent item owns it.
- Per-device volume memory. No user has asked for it.

BOUNDARY CASES:
- A virtual output that the OS creates, such as a PipeWire combine-sink or a macOS Multi-Output Device, is IN. Rule: anything mpv lists is selectable, and this feature never creates an output that mpv does not list.
- Connecting an already paired speaker with `bluetoothctl connect` is OUT for every planned release. Rule: an action that needs OS privileges or a per-OS Bluetooth API belongs to the OS or to an appliance distribution, not to the player.

## Feasibility

Each statement below must hold for the feature to work.

1. **mpv exposes the device list.** Holds. The `audio-device-list` property returns an array of `{name, description}` maps with `auto` first [DIRECT: mpv `DOCS/man/input.rst`, master `01e2533f`, 2026-10-17]. The command line prints the same list in the fixed format `'<name>' (<description>)` [DIRECT: `audio/out/ao.c:600-611`]. On this machine (Windows 11 Pro 10.0.26200, mpv v0.41.0-244-gaf9c81fa1 built 2026-03-02) the output is:
   ```
   List of detected audio devices:
     'auto' (Autoselect device)
     'wasapi/{2d948da5-7f24-4c77-8553-5c67cb36d700}' (Speakers (Sound BlasterX Katana))
     'wasapi/{d5ce34f8-c4b7-47c0-8009-5922029a8ccb}' (Gigabyte M32U (NVIDIA High Definition Audio))
     'wasapi/{eaab5d22-d8be-4da8-a5dc-fb590928bd85}' (Speakers (Realtek(R) Audio))
     'openal' (Default (openal))
   ```
   [DIRECT: `mpv --audio-device=help`, run 2026-10-17]. The list merges every audio output driver that mpv was built with, so `openal` appears beside `wasapi` [DIRECT: `audio/out/ao.c` `ao_hotplug_get_device_list`].

2. **mpv switches output at runtime without a restart.** Holds. A write to `audio-device` means "the audio output will be scheduled for reloading" [DIRECT: `input.rst`]. In source, the option carries `UPDATE_AUDIO` (`audio/out/ao.c:148`), and an `UPDATE_AUDIO` change calls `reload_audio_output` (`player/command.c:8426-8427`). mpv's own select menu switches devices the same way, with `mp.set_property("audio-device", name)` (`player/lua/select.lua:401-431`) [DIRECT].

3. **The current track keeps playing at its position.** Holds in source, gap length untested. `reload_audio_output` closes the output, rebuilds the filter chain and resets audio sync (`player/audio.c:765-798`). It seeks back to the current position when 0.2 s or more of buffer is dropped (`player/audio.c:120-123`). The new output opens with the player's pause state (`player/audio.c:497-498`). The expected result is a silence and a skip of a fraction of a second, and a paused player stays paused [DERIVED, untested because the brief forbids driving playback].

4. **A repeat write of the same device does nothing.** Holds. mpv applies an option change only when the value differs (`options/m_config_core.c:802-804`, `options/m_config_frontend.c:639-640`) [DIRECT]. Re-opening the same device after it returns therefore needs a value change, not a repeat write.

5. **A paired Bluetooth speaker shows up as an mpv device.** Holds only while the OS has it connected. On Windows, mpv lists active endpoints only. The registry on this machine holds endpoints for a Plantronics headset and an HTC Vive in state `0x4` (not present), and mpv's list omits them [DIRECT: `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render`, read 2026-10-17]. This machine has a Bluetooth adapter but no paired Bluetooth audio device, so the Bluetooth case itself is not observed here [ABSENT]. mpv's Windows driver enumerates with `DEVICE_STATE_ACTIVE` only (`audio/out/ao_wasapi_utils.c:858-859`) [DIRECT]. The other backends follow the same rule in their source:
   - PipeWire creates a Bluetooth sink node only while a profile is connected (PipeWire `spa/plugins/bluez5/bluez5-device.c:1340-1390`) [DIRECT].
   - PulseAudio loads the Bluetooth sink module when a transport connects, and the module unloads itself on disconnect (`module-bluez5-discover.c:69-111`) [DIRECT].
   - CoreAudio lists "all the devices currently available to the system" (`AudioHardware.h:471-473`), so a disconnected speaker is absent [INFERRED].
   - ALSA lists a Bluetooth speaker only through bluez-alsa with a hand-added name hint, since `defaults.namehint.extended` is off by default (alsa-lib `alsa.conf:103`) [DIRECT]. That hint is static, so it shows even while the speaker is off [INFERRED].

   Windows 11 creates one output endpoint per Bluetooth device. Windows 10 created separate "Stereo" and "Hands-Free" endpoints, so a Windows 10 list shows the same speaker twice [DIRECT: Microsoft Learn, Bluetooth Classic Audio, updated 2025-07-18].

6. **The device name is stable enough to save.** Holds with a fallback.
   - mpv's Windows name is `wasapi/` plus the GUID of the endpoint ID `{0.0.0.00000000}.{GUID}` (`ao_wasapi_utils.c:810-830`), and the three listed GUIDs match the three active registry endpoints [DIRECT]. One Gigabyte M32U monitor owns 9 GUIDs on this machine under one friendly name, with one active [DIRECT]. Microsoft gives the rule. The ID "remains unchanged across system restarts" and "changes if the user upgrades the device driver, or if the user uninstalls the device, and installs it again" [DIRECT: Microsoft Learn, Endpoint ID Strings, updated 2026-08-27]. So a GPU driver update renames an HDMI output, and re-pairing a Bluetooth speaker most likely renames it too [INFERRED]. mpv does not read the Windows 11 24H2 `PKEY_AudioEndpoint_StableId` [DIRECT].
   - PipeWire with WirePlumber 0.4.12 or later names a Bluetooth sink `bluez_output.<MAC>.1`, from the speaker's address and a fixed id, so the name survives reconnects, reboots and re-pairing [DERIVED: WirePlumber `monitor-utils.lua:168-172`, PipeWire `bluez5-device.c:46`].
   - WirePlumber 0.4.11 and earlier put the profile in the name (`bluez_output.<MAC>.a2dp-sink`), so an upgrade across 0.4.12 renamed every Bluetooth sink [DIRECT: WirePlumber NEWS 0.4.12, 2022-10-04].
   - Real PulseAudio names the sink `bluez_sink.<MAC>.a2dp_sink`, and a switch to the headset profile renames it (`module-bluez5-device.c:1279`) [DIRECT].
   - CoreAudio names use the device UID, which Apple calls "persistent across boots" (`AudioHardwareBase.h:623-629`) [DIRECT]. Re-pair behavior on macOS is not documented [ABSENT].

   The description survives every one of these renames, since it is the device's display name [DERIVED].

7. **mpv does not fall back when the named device is missing.** Holds for `wasapi`, real PulseAudio and `alsa`. PipeWire behaves differently (statement 8). When `audio-device` names a driver and a device, mpv tries only that driver (`audio/out/ao.c:309-315`) and logs "Try unsetting it." (`audio/out/ao.c:356-357`). The open fails with "Could not open/initialize audio device -> no sound." (`player/audio.c:482-484`), and an audio-only file then ends with an error (`player/misc.c:257-276`) [DIRECT]. Every later entry fails the same way, so the queue runs to idle with no message to the AI [DERIVED]. `docs/DOCKER.md` reports the same symptom for a container with no device.

8. **mpv reports device changes as observable properties.** Holds. `audio-device-list` is re-read and notified on a hotplug event (`player/command.c:8252-8259`). `current-ao` and `audio-out-params` are notified on every audio reconfigure (`player/command.c:4916-4919`). With `--audio-fallback-to-null=yes`, a failed open selects the null output instead of failing, so a client can "check the `current-ao` and `audio-device-list` properties to make high-level decisions" [DIRECT: `options.rst`, `--audio-fallback-to-null`]. The fallback flag applies to every open, including a reload (`player/audio.c:422-423`) [DIRECT]. Each driver reports a loss differently:
   - `wasapi`, `pipewire`, `pulse` and `coreaudio` update `audio-device-list` while mpv runs. `alsa` has no hotplug, so its list is read once per mpv process [DIRECT: grep of `audio/out` at `01e2533f`, `ao_alsa.c:1164`].
   - `wasapi` requests a reload when its endpoint leaves the active state or is removed (`ao_wasapi_changenotify.c:65-75`, `:108-112`). `pulse` and `alsa` request one when the stream fails or the PCM disconnects (`ao_pulse.c:105-108`, `ao_alsa.c:987-997`) [DIRECT]. The reload fails, which opens the null output under the fallback flag [DERIVED].
   - `pipewire` sets the device as the stream's target and leaves linking to WirePlumber (`ao_pipewire.c:580`). WirePlumber links a stream whose target is gone to the default sink unless the client sets `node.dont-fallback`, and mpv does not set it (WirePlumber `find-defined-target.lua:116-126`) [DIRECT for the code, runtime INFERRED]. So on PipeWire the music most likely moves to the default sink while `current-ao` stays `pipewire`.
   - `coreaudio` never requests a reload, and its behavior on a lost device is untested [ABSENT].

   A loss therefore shows as the null output on some drivers and as a list change on every hotplug driver. The device watcher needs both signals.

9. **The choice can live in the settings store and reach every process.** Holds. The engine already reads one saved setting, the visualizer flag, at each spawn through `readSavedWebuiSettings()` (`src/bootstrap.ts:39-42`, `src/config.ts:106-115`). mpv starts with `--no-config` (`src/services/playback/mpv-process.ts:102`), so a device set in the user's own `mpv.conf` never leaks in [DIRECT].

10. **Headless machines, Docker and Raspberry Pi have devices to list.** Holds, with limits.
   - Raspberry Pi OS lists `sysdefault:CARD=Headphones` for the 3.5 mm jack (Pi 4 and earlier) and `sysdefault:CARD=vc4hdmi0` style names for HDMI, and sends audio to HDMI by default [DIRECT: raspberrypi.com OS documentation, fetched 2026-10-17].
   - Raspberry Pi OS has used PipeWire since Bookworm (2023-10-10) and removed PulseAudio from the image on 2025-11-24, so a Bluetooth speaker on a Pi appears as `pipewire/bluez_output.<MAC>.1` [DIRECT: Raspberry Pi OS release notes].
   - PipeWire and WirePlumber run as per-user services, so a headless player needs a user session or lingering for its user [INFERRED]. Without them only ALSA remains, which lists no Bluetooth device and has no hotplug [DERIVED].
   - A Docker container sees what its audio path gives it. A mounted PulseAudio or PipeWire socket lists every host sink by its host name, with hotplug. `--device /dev/snd` lists ALSA hardware only [DERIVED: x11docker wiki "Container sound", revised 2025-12-15]. Docker Desktop on Windows and macOS has no audio device (`docs/DOCKER.md`). The current image has no mpv, so it lists nothing.

Starting-list claims:
- "Add `list_audio_devices` and `set_audio_device` tools" holds.
- "Once the OS pairs a Bluetooth speaker, it shows up as an mpv device" is refuted as worded. Pairing is not enough. The speaker appears while it is connected and active, and disappears when it turns off (statement 5).
- "(days)" holds for the MVP.

## Current system

Every part this feature touches, with the direction data flows.

```
settings store (settings.json)            src/config/store.ts
  │ read once at process start             src/config.ts:61-77
  │ webui.visualizer re-read at spawn      src/bootstrap.ts:39-42
  ├───────────────────────────┐
  ▼                           ▼
MCP server process            web player process (one per user)     src/web/main.ts
(one per AI client)           ├─ web remote HTTP server              src/webui/server.ts
src/index.ts                  │   ├─ control routes  (no loopback gate) routes/controls.ts
├─ playback tool handlers     │   ├─ player settings routes (loopback) routes/player.ts:53-125
│  src/tools/handlers/        │   └─ lease route POST /api/mcp-lease   routes/player.ts:127-149
│  playback-handlers.ts       ├─ snapshot broadcaster (SSE)          src/webui/broadcaster.ts
│        │                    │        │ reads playbackStatus() on each change
│        ▼                    │        ▼
├─ playback tool functions ◄──┴─ same module, called by the control routes
│  src/tools/playback.ts
│        │
│        ▼
└─ playback engine (one singleton per process)        src/services/playback/playback-engine.ts
   ├─ mpv spawner: lazy, on the first control call    src/services/playback/mpv-process.ts:97-143
   ├─ IPC client: attach to a running mpv first       src/services/playback/mpv-ipc.ts
   └─ observed-property cache                          playback-engine.ts:45-58
         │ JSON-IPC, per-user pipe or socket
         ▼
shared mpv process (one per OS user, detached, --no-config, --idle=yes)
         │ audio output driver (AO): wasapi | pipewire | pulse | alsa | coreaudio | null
         ▼
OS audio device (speakers, HDMI, USB DAC, connected Bluetooth speaker)

config app (navidrome-config, or hosted by either process)   src/config-app/
  form FIELDS table, public/app.js:7-39 ──► POST /api/settings ──► settings store
  (the save merges the posted FIELDS keys onto the stored file and keeps every other key, routes.ts:63-132)

browser web remote page   src/webui/public/
  receives snapshots over SSE, posts to control routes, volume.js reads status.volume
```

Facts about these parts that shape the design:
- The playback engine in each process is a separate singleton. Every engine attaches to the one shared mpv, so mpv's own properties are the only live state the processes share [DIRECT: `playback-engine.ts:739-760`].
- Either process can spawn mpv. The MCP server process spawns it on a play tool. The web player process spawns it when the web remote starts a play through `playLibrarySource` (`src/tools/playback.ts:519-543`) [DIRECT].
- Read tools never spawn mpv. `playback_status`, `now_playing` and `get_play_queue` attach only (`playback-handlers.ts:100`, `:269`, `:278`) [DIRECT].
- mpv quits when the last MCP lease closes, unless `webui.persistAfterMcpExit` is on (`src/web/main.ts:115-134`, `src/web/player-runtime.ts:42-49`). A choice held only inside mpv dies with it [DIRECT].
- The control routes accept any LAN viewer when `webui.expose` is on. Only the settings, shutdown and lease routes check for a loopback peer (`src/webui/server.ts:146-174`, `routes/player.ts:54`) [DIRECT].

## Integration point

The current system with the new parts, marked `+`.

```
settings store
  + playback.audioDevice = { name, description } | null
  ▲ write on set            │ read at each spawn (same pattern as webui.visualizer)
  │                         ▼
+ audio device module                       src/services/playback/audio-devices.ts
    parses the help text, filters the list to one driver,
    applies the match rule, runs the one-shot probe
  ▲                         ▲
playback engine (each process)
  + device apply step     after IPC connect, before the first load,
                          beside the visualizer sync (playback-engine.ts:820-822)
  + device watcher        observes audio-device, audio-device-list, current-ao
                          (added to OBSERVED_PROPERTIES, playback-engine.ts:45-58)
  + status fields         getStatus() gains audioDevice, audioOutput, audioOutputLost
  ▲
playback tool functions                     src/tools/playback.ts
  + listAudioDevices()   + setAudioDevice()
  ▲                                   ▲
MCP server process                    web player process
  playback tool handlers                web remote HTTP server
  + list_audio_devices                  + GET  /api/audio-devices
  + set_audio_device                    + POST /api/controls/audio-device
                                          ▲
                                        browser web remote page
                                        + device picker beside the volume control

mpv spawner      + --audio-fallback-to-null=yes      mpv-process.ts:97-117
env fallback     + PLAYBACK_AUDIO_DEVICE             src/config/env-settings.ts:116-120
config schema    + playback.audioDevice              src/config/store.ts:55-59, schema.ts, map-config.ts
config app       + device field in FIELDS            src/config-app/public/app.js:7-39
                 + GET /api/settings/audio-devices   src/config-app/routes.ts
```

Why each new part sits where it does:
- **Audio device module** in `src/services/playback/`. It holds pure functions (parse, filter, match) beside the engine that uses them, so unit tests need no mpv. The one-shot probe reuses the runner pattern of `runMpv` in `visualizer-filter.ts:146-166`, which should move into this module or a shared helper so two copies do not exist.
- **Device apply step** in the engine's spawn path. The engine is the only part that knows when a new mpv is connected and has not opened an audio output yet. Applying there means the first track opens the right device, with no reload.
- **Device watcher** in the engine's observer setup. Every attached process already receives every property change (`playback-engine.ts:877-882`), so each engine can react without cross-process coordination. Its one action, pause, is idempotent.
- **Status fields** in `getStatus()`. The snapshot broadcaster sends every web remote only the status fields that `snapshotStatus` picks (`broadcaster.ts:231-233`). Adding the current device to `snapshotStatus` gives the web remote the device with no new event type.
- **Tool functions** in `src/tools/playback.ts`. The control routes already call these functions (`routes/controls.ts`), so the MCP tools and the web remote share one implementation.
- **Store key** under `playback`. The device is a playback setting, like `mpvPath` and `transcodeFormat`, and the store is the only state that outlives mpv and is shared by every process.

## Options

### Criteria

These weights apply to every matrix below. Scores run from 1 (poor) to 5 (best).

| Criterion | Weight | What a 5 means |
|---|---|---|
| Maintainability | 3 | Uses documented mpv behavior only, few code paths, unit-testable without mpv |
| Match with comparable tools | 3 | Matches how the studied players and controllers solve the same decision |
| User outcome | 2 | Does what the user expects, with the least surprise |
| Fit with this architecture | 2 | Works with lazy spawn, attach, leases, several processes and env fallback |
| Effort | 1 | Small change |

### Comparable tools

Each matrix cites these projects. Versions are the commits read on 2026-10-17.

| Project (version) | Identifies a device by | Persists the choice in | Applies a change | When the device is missing |
|---|---|---|---|---|
| mpv `select.lua` (master `01e2533f`) | mpv `name`, shows `name (description)` | nothing | live `audio-device` write | mpv core: the track errors |
| Jellyfin MPV Shim 3.2.0 | mpv `name`, shows `description` | `conf.json` `audio_device` | live write, once per mpv and on each change | no handling |
| IINA (develop `5c15f815`) | mpv `name` and `description` | UserDefaults | live write after a presence check | falls back to `auto` at start and on a list change |
| mpv.net 7.1.2.0 | mpv `name`, shows `description` | `settings.xml`, on by default | live write, restored at start | no handling |
| SMPlayer 26.8.29 | driver, ID and description in one string | `smplayer.ini` | `--audio-device` at mpv launch, list from `mpv --audio-device=help` | none found |
| MPD 0.25 (dev `88c4c4b3`) | output name, since the numeric `outputid` "May change between executions" | state file, enabled flag per output name | live `enableoutput` and `disableoutput` | reopens a failed output after 10 s |
| Mopidy 4.0.5 | GStreamer sink string | `mopidy.conf` | restart | startup error |
| librespot 0.8.0 | backend device name | command-line flag | restart | pauses when the sink fails at runtime |
| Strawberry (master `4ccb487d`) | API value (WASAPI endpoint ID, Pulse sink name), shows description | QSettings | next pipeline [INFERRED] | stops with an error [INFERRED] |
| Volumio 3 backend (`4bdfbfc6`) | ALSA card number and card name, the name wins at boot | plugin config | MPD restart | warning only |
| moOde r1036 | ALSA card number and name, Bluetooth by MAC | SQLite | MPD restart, volume set to 0, no resume | switches to HDMI after a 60 s retry, at startup only |
| Music Assistant 2.10.6 | the player entity is the device | per client | live player choice | marks the player unavailable and reconnects |
| Home Assistant (core dev `795ab030`) | human-readable `source` name | the vendor's side | live `select_source` action | Spotify ignores an unknown name [INFERRED] |

[DIRECT for every row unless marked: comparable-tools research, file references in Sources.]

### Where the choice lives

Options: the runtime-only choice (mpv's `audio-device` property, lost when mpv quits), the store-backed choice (`playback.audioDevice`, written on every set and read at every spawn), and the per-call persist choice (store-backed, with a `persist` flag the AI can turn off for a temporary switch).

| Criterion (weight) | runtime-only choice | store-backed choice | per-call persist choice |
|---|---|---|---|
| Maintainability (3) | 5 | 4 | 3 |
| Match with comparable tools (3) | 2 | 5 | 3 |
| User outcome (2) | 2 | 4 | 4 |
| Fit with this architecture (2) | 3 | 5 | 4 |
| Effort (1) | 5 | 3 | 3 |
| Weighted total | 36 | 48 | 37 |

Flip check: the store-backed choice scores at or above the per-call persist choice on every criterion, so no single weight change flips that pair. Against the runtime-only choice, the smallest change is Effort weight 1 to 8. ROBUST.

Comparable tools: Jellyfin MPV Shim, IINA, mpv.net, SMPlayer, Strawberry and MPD all persist the choice. mpv.net makes remembering a global setting (`remember-audio-device`, default yes), not a per-call flag. Only mpv's built-in `select.lua` keeps the choice runtime-only. The store is also the only state that outlives mpv and reaches every process here (Current system).

### How a saved choice is matched again

Options: the ID-only match (the saved `name` must be in the list), the description-only match (the saved `description` must match one entry), and the ID-then-description match (the `name` first, else the one entry of the same driver whose description equals the saved one, else no match).

| Criterion (weight) | ID-only match | description-only match | ID-then-description match |
|---|---|---|---|
| Maintainability (3) | 5 | 4 | 4 |
| Match with comparable tools (3) | 4 | 2 | 4 |
| User outcome (2) | 2 | 2 | 5 |
| Fit with this architecture (2) | 5 | 4 | 5 |
| Effort (1) | 5 | 5 | 4 |
| Weighted total | 46 | 35 | 48 |

Flip check: the smallest change that flips the winner is User outcome weight 2 to 1, which makes the ID-only match win (44 to 43). FRAGILE, since that change is smaller than the uncertainty in the User outcome scores, which rest on how often names change on the user's machines.

The User outcome scores rest on Feasibility statement 6. Windows renames on a driver update or reinstall, and WirePlumber renamed every Bluetooth sink at 0.4.12.

Comparable tools: Jellyfin MPV Shim, mpv.net and Strawberry store the ID only. IINA and SMPlayer store the ID and the description. Volumio and moOde re-resolve a volatile ALSA card number from a stored card name at boot, and MPD persists by output name. mpv's Windows driver itself accepts the friendly name as a device string (`ao_wasapi_utils.c:997-1004`).

### How the saved device reaches a new mpv

Options: the spawn-flag apply (`--audio-device=<name>` on the mpv command line), the post-connect apply (after the IPC connects, read `audio-device-list`, and `set_property audio-device` only when the match rule finds the device), and the probed spawn-flag apply (run the one-shot probe, then pass the flag only when the device is present).

| Criterion (weight) | spawn-flag apply | post-connect apply | probed spawn-flag apply |
|---|---|---|---|
| Maintainability (3) | 4 | 4 | 3 |
| Match with comparable tools (3) | 3 | 5 | 3 |
| User outcome (2) | 2 | 5 | 4 |
| Fit with this architecture (2) | 4 | 5 | 4 |
| Effort (1) | 5 | 4 | 3 |
| Weighted total | 38 | 51 | 37 |

Flip check: the spawn-flag apply beats the post-connect apply only on Effort, and no Effort weight below 15 flips the winner. ROBUST.

The spawn-flag apply fails the first track with no sound when the device is gone (Feasibility statement 7). The post-connect apply checks the same mpv's list, and no audio output is open yet, so the write causes no reload. It mirrors how the visualizer filter is applied after connect and before the first load (`playback-engine.ts:820-822`).

Comparable tools: Jellyfin MPV Shim applies the device "once per mpv instance and again whenever the settings change" (`player_audio.py:279-282`). IINA checks the saved device against the list at startup and writes it live (`PlayerCore.swift:668-672`, `:1949-1950`). SMPlayer alone passes `--audio-device` at launch.

### What happens when the chosen device disappears

Options: the no-handling option (mpv defaults: the track errors and the queue runs to idle), the default-fallback option (switch mpv to `auto`, keep playing on the OS default output, keep the saved choice), and the pause-on-loss option (pause, keep the position and the saved choice, and report the missing device). Both handling options need `--audio-fallback-to-null=yes`, since without it the track ends before the engine can act (Feasibility statement 7).

| Criterion (weight) | no-handling option | default-fallback option | pause-on-loss option |
|---|---|---|---|
| Maintainability (3) | 5 | 3 | 3 |
| Match with comparable tools (3) | 2 | 4 | 4 |
| User outcome (2) | 1 | 3 | 5 |
| Fit with this architecture (2) | 3 | 4 | 4 |
| Effort (1) | 5 | 3 | 3 |
| Weighted total | 34 | 38 | 42 |

Flip check: the pause-on-loss option scores at or above the default-fallback option on every criterion, so no weight change flips that pair. Against the no-handling option, the smallest change is Effort weight 1 to 6. ROBUST on weights. The User outcome scores are the uncertain input, since they encode a preference. If the user values continuity (5 for the default-fallback option, 3 for the pause-on-loss option), the totals become 42 and 38 and the default-fallback option wins. FRAGILE on that input, so this decision is listed under Open decisions.

Comparable practice: Android's media guide says users "usually expect apps that include a music player with onscreen playback controls to pause playback" when a Bluetooth device disconnects [DIRECT: developer.android.com, updated 2025-04-07]. Apple says apps should "automatically pause playback when users disconnect their headphones" [DIRECT: developer.apple.com, 2026]. Both are mobile headphone cases, but the "noisy surprise" of a reroute applies to a home speaker too. librespot pauses when its sink fails at runtime (`playback/src/player.rs:1624-1636`). IINA switches mpv to `auto` when the selected device leaves the list (`PlayerCore.swift:2303-2310`). MPD retries a failed output every 10 s, and Strawberry and mpv core stop with an error. mpv ships `TOOLS/lua/ao-null-reload.lua`, which pairs `audio-fallback-to-null` with a reload on a list change, so the null-output signal is an upstream pattern [DIRECT].

### How the list is read when no mpv runs

Options: the spawn-to-list option (start mpv, then read `audio-device-list`), the one-shot probe (run `<mpvPath> --audio-device=help` and parse the fixed format), and the attach-only list (report no devices until a play starts mpv).

| Criterion (weight) | spawn-to-list option | one-shot probe | attach-only list |
|---|---|---|---|
| Maintainability (3) | 4 | 3 | 5 |
| Match with comparable tools (3) | 3 | 5 | 2 |
| User outcome (2) | 3 | 5 | 2 |
| Fit with this architecture (2) | 2 | 5 | 4 |
| Effort (1) | 5 | 3 | 5 |
| Weighted total | 36 | 47 | 38 |

Flip check: the smallest change is Effort weight 1 to 6, which makes the attach-only list win. ROBUST.

The spawn-to-list option breaks the rule that read tools never start mpv. The attach-only list blocks the main use case, "play this on the Bluetooth speaker" said before anything plays. The one-shot probe runs the same enumeration code as the live property (`audio/out/ao.c:600-611`), and its fixed `printf` format keeps the parser small. SMPlayer parses the same output (`src/deviceinfo.cpp:343-375`), and librespot, Snapcast and Sendspin offer one-shot listing commands [DIRECT].

### MCP tool surface

Options: the two-tool surface (`list_audio_devices` and `set_audio_device`), the status-folded surface (the list inside `playback_status`, plus `set_audio_device`), and the single combined tool (`audio_device` that reads with no argument and sets with one).

| Criterion (weight) | two-tool surface | status-folded surface | single combined tool |
|---|---|---|---|
| Maintainability (3) | 5 | 4 | 3 |
| Match with comparable tools (3) | 5 | 4 | 2 |
| User outcome (2) | 4 | 3 | 3 |
| Fit with this architecture (2) | 5 | 3 | 3 |
| Effort (1) | 4 | 4 | 5 |
| Weighted total | 52 | 40 | 32 |

Flip check: no single weight change of 5 or less flips the winner. ROBUST.

The status-folded surface would put the list into every `playback_status` result. The web snapshot carries only the status fields that `snapshotStatus` picks (`broadcaster.ts:231-233`), so the list reaches the web remote only if that function adds it. MPD splits `outputs` from `enableoutput`, and Home Assistant splits `source_list` from `select_source`, which matches the two-tool surface.

### Web remote placement

Options: the transport-area picker (a device button beside the volume control, for every viewer that can already change volume) and the settings-dialog picker (inside the gear dialog, which only a loopback browser sees).

| Criterion (weight) | transport-area picker | settings-dialog picker |
|---|---|---|
| Maintainability (3) | 4 | 4 |
| Match with comparable tools (3) | 4 | 2 |
| User outcome (2) | 5 | 2 |
| Fit with this architecture (2) | 3 | 5 |
| Effort (1) | 3 | 4 |
| Weighted total | 43 | 36 |

Flip check: the smallest change is Fit weight 2 to 6, which makes the settings-dialog picker win. ROBUST.

The phone on the LAN is the usual remote, and the gear dialog is hidden from it (`local-controls.js:25-27`, `routes/player.ts:53-57`). A device switch has the same reach as a volume change, and the volume route is already open to LAN viewers. Home Assistant's media card and Spotify Connect put the output picker beside the playback controls [ANALOGICAL, not read in source]. Jellyfin MPV Shim puts its picker in a settings page, which suits a client that runs on the machine it controls.

## Recommendation

**Where the choice lives.** Use the store-backed choice. `set_audio_device` writes `playback.audioDevice = { name, description }` with a read, merge and atomic write, the same way the player settings route writes `webui` keys (`routes/player.ts:93-117`). When no usable store exists (env fallback), the set applies to mpv only and the result says `persisted: false`, which mirrors the player settings route. `PLAYBACK_AUDIO_DEVICE` seeds the choice in env-fallback mode.

**How a saved choice is matched again.** Use the ID-then-description match, pending the open decision below. The description fallback accepts only one candidate of the same driver, so two identical speakers never get swapped. When the fallback matches, the engine writes the new name back to the store.

**How the saved device reaches a new mpv.** Use the post-connect apply. A saved device that is missing at spawn leaves mpv on `auto` for that moment, and the next play tool fails fast with a message that names the device, under the pause-on-loss rule below.

**What happens when the chosen device disappears.** Use the pause-on-loss option, pending the open decision below. Add `--audio-fallback-to-null=yes` to the spawn flags. The device watcher in each attached engine pauses a current file when either loss signal arrives. The first signal is `current-ao` reading the null driver, the string `"null"`, which only the fallback selects, since the spawn flags pass no `--ao`. The second signal is the selected name leaving `audio-device-list`, which covers PipeWire, where WirePlumber most likely moves the stream to the default sink instead of failing it. `resume` and the play tools check the device first. If it is back, they re-open it with a value change (`auto`, then the name) and continue. If it is still missing, they fail with a message that names the device and points to `set_audio_device`. Nothing resumes on its own when the device returns.

**How the list is read when no mpv runs.** Use the live `audio-device-list` when an mpv is attached, and the one-shot probe otherwise. Both go through one normalizer.

**MCP tool surface.** Use the two-tool surface, in the compact style of the existing tools:
```
list_audio_devices  {}  →
  { selected: { name, description, present },        // name "auto" when no device is chosen
    output?: string,                                  // mpv's current-ao driver, absent when none is open
    devices: [{ name, description }],                 // one driver only, "auto" first
    source: "player" | "probe" }

set_audio_device  { device: string }  →                // a name from list_audio_devices, or "auto"
  { success: true, device: { name, description },
    applied: "now" | "next-start",                    // next-start when no mpv runs
    persisted: boolean }
```
`playback_status` gains `audioDevice: { name, description, present }`, `audioOutput?` (the `current-ao` driver) and `audioOutputLost?: true` (set while mpv plays to its null output). An unknown `device` fails with an error that lists the valid names, so the AI recovers in one more call. `set_audio_device` never spawns mpv, following the attach-only rule of the transport tools. The device list shows one driver, the one mpv is using, or the first driver in mpv's priority order when none is open. A `verbose: true` flag returns every driver's entries for debugging.

**Web remote placement.** Use the transport-area picker, with the same reach as the volume control. Add role gating when the Web UI Auth + Roles item lands.

## Open decisions

1. **Behavior when the chosen device disappears.** Options: the pause-on-loss option and the default-fallback option. The pause-on-loss option avoids music jumping to the PC speakers when someone turns the Bluetooth speaker off. The default-fallback option keeps a party playing when a speaker drops out. What tips it: whether the user treats the saved device as a hard choice or a preference. The same answer decides whether a play fails with the device's name or plays on the default output when the saved device is off before anything plays. Question: when the chosen speaker turns off mid-song, should the music pause or move to the computer's default output?

2. **How a saved choice is matched again.** Options: the ID-only match and the ID-then-description match. The ID-then-description match recovers when Windows assigns a new endpoint GUID to the same device. The ID-only match never moves playback to a different device that shares the old description, such as a second speaker of the same model. What tips it: how often names change on the user's machines. On Windows, a GPU driver update renames HDMI outputs, and removing and re-pairing a Bluetooth speaker most likely renames it. On PipeWire, names change only across the WirePlumber 0.4.12 boundary. Question: should a saved speaker be found again by its name when its system ID changes?

## Plan overview

Build steps in dependency order. Each names the parts it adds or changes.

1. **Audio device module.** Add `src/services/playback/audio-devices.ts` with the help-text parser, the list normalizer (one driver, `auto` first, `verbose` keeps all), the match rule, and the one-shot probe. Move `runMpv` out of `visualizer-filter.ts` so both callers share it. Unit tests use recorded help output from Windows, PipeWire, PulseAudio, ALSA and CoreAudio.
2. **Store key and config projection.** Add `playback.audioDevice` to `SettingsFileSchema` (`src/config/store.ts:55-59`), `ConfigSchema`, `mapStoreToConfig`, `settings.example.json`, and `PLAYBACK_AUDIO_DEVICE` to `buildEnvRuntimeSettings`. Add a `readSavedAudioDevice()` beside `readSavedWebuiSettings()` (`src/config.ts:106-115`).
3. **Config app preservation.** No code change. The config app save merges the posted form onto the unstripped stored file, so a stored `playback.audioDevice` survives a save (`src/config-app/routes.ts:63-132`). Add a unit test that pins it. A later release turns it into a form field.
4. **Engine: spawn flag, apply step and status.** Add `--audio-fallback-to-null=yes` to `buildMpvArgs`. Add the device apply step to `spawnAndConnect` after `installObservers`. Add `audio-device`, `audio-device-list` and `current-ao` to the observed properties. Extend `PlaybackStatus` and `getStatus()`.
5. **Engine: device watcher and resume check.** Pause on loss. Add the re-open sequence and the missing-device error to `resume` and to `enqueue`, `enqueueRadio` and `jumpToQueueEntry`.
6. **Tool functions and MCP tools.** Add `listAudioDevices()` and `setAudioDevice()` to `src/tools/playback.ts`, their schemas to `src/schemas/validation.ts`, and the two tool entries to `playback-handlers.ts`. Update `docs/PLAYBACK-SPEC.md` (flags, observed properties, tool table) and the README tool table.
7. **Web routes and picker.** Add `GET /api/audio-devices` and `POST /api/controls/audio-device` to `src/webui/server.ts`, and the picker beside the volume control in `src/webui/public/`.
8. **Config app field.** Add a device select to the config app, filled from a probe route in `src/config-app/routes.ts`.

Steps 1 to 6 form the MVP. Steps 7 and 8 are later releases.

## Edge cases

| Edge case | Part it hits | Intended behavior |
|---|---|---|
| The saved device is off when mpv spawns | device apply step | mpv stays on `auto`. The play tool fails fast with the message "The selected audio device '<description>' is not connected. Turn it on, or call set_audio_device." |
| The device turns off mid-track (`wasapi`, PulseAudio, `alsa`) | device watcher | mpv falls to the null output, and every attached engine sends pause. The position is kept. `playback_status` shows `audioOutputLost: true` and the device with `present: false`. |
| The device turns off mid-track (PipeWire) | device watcher | WirePlumber most likely moves the stream to the default sink, and the list change triggers the pause. A short burst may play on the default output before the pause lands. Untested. |
| The device turns off mid-track (CoreAudio) | device watcher | The list change triggers the pause. What mpv's output does in the meantime is untested. |
| The device returns while paused | device watcher | Nothing plays. The next `resume` re-opens the device (`auto`, then the name) and unpauses. |
| `set_audio_device` with a name not in the list | `setAudioDevice()` | Rejected before any mpv write, since a write of a missing name fails the current track (Feasibility statement 7). The error lists the valid names. |
| `set_audio_device` while nothing runs | `setAudioDevice()` | The store is written, mpv is not spawned, and the result says `applied: "next-start"`. The name is checked against the one-shot probe. |
| Two identical speakers with equal descriptions | match rule | The description fallback finds two candidates, so it matches nothing and reports the device as missing. |
| Several MCP servers attached | device watcher | Each engine sees the same `audio-device` change and the same loss. Pause is idempotent, so N pauses equal one. |
| An MCP server and the web remote set different devices at once | store write, mpv property | Last write wins in both mpv and the store. The broadcaster sends the final `audio-device` to every remote. |
| The config app saves while a device is stored | config app save | The saved device is kept (plan step 3). |
| Env-fallback mode, no store | `setAudioDevice()` | mpv switches, the result says `persisted: false`, and `PLAYBACK_AUDIO_DEVICE` is the only persistent channel. |
| A different mpv binary attached (another build) | list read | The live `audio-device-list` wins over the probe, since the probe runs the configured binary. |
| No audio device at all (Docker without passthrough, headless Pi with no output) | device watcher | The fallback opens the null output. The engine pauses and reports `audioOutputLost: true`, which replaces today's silent run to idle described in `docs/DOCKER.md`. |
| The user changes the OS default output while mpv is on `auto` | mpv AO | The selector does not act. On `wasapi` with `auto`, mpv follows a default-device change. With a chosen device it logs "staying on specified device" and stays (`ao_wasapi_changenotify.c:133-140`). |
| The same speaker listed by several drivers (`pipewire`, `pulse` and `alsa` on Linux, `coreaudio` and `avfoundation` on macOS) | list normalizer | Only the active driver, or the first-priority driver when none is open, is shown, so the AI sees one entry per device. |
| Windows 10 lists a Bluetooth speaker twice ("Stereo" and "Hands-Free") | list normalizer | Both entries show, since both are real endpoints. The "Hands-Free" entry plays in call quality. The tool description tells the AI to prefer "Stereo". Windows 11 shows one. |
| An ALSA-only machine | device watcher | `alsa` has no hotplug, so the list is frozen per mpv process and only the null-output signal detects a loss. |
| The device switch during gapless prefetch | mpv AO reload | The reload resets the audio chain, and the prefetched next file is untouched. Untested. |
| The visualizer filter during a switch | mpv filter chain | The reload rebuilds the chain from the same `af` list (`player/audio.c:88-105`), so the filter stays. The level timeline may show a short gap. Untested. |
| Scrobbling while on the null output | scrobble tracker | The pause lands within one IPC round trip, far below the half-duration threshold, so no unheard play is submitted. |

## Releases

### MVP: AI-selectable output

- **Capability.** The AI lists the outputs and moves playback to one, such as a connected Bluetooth speaker. The choice survives an mpv restart. When the speaker turns off, playback pauses and the AI is told why.
- **Parts.** Audio device module, store key, config app preservation, engine apply step and watcher, the two MCP tools, `playback_status` fields, spawn flag.
- **Acceptance check.** With the speaker connected, `list_audio_devices` shows it. `set_audio_device` moves the playing track to it with no restart and the position kept within a second. After all MCP clients exit and restart, the next play opens the speaker. Turning the speaker off pauses playback, and `resume` then fails with the device's name. `pnpm check:all`, `pnpm test:run` and `pnpm build` pass, and the user runs `pnpm test:playback`.
- **Effort.** 3 to 5 days [INFERRED].

### Release 2: web remote picker

- **Capability.** A phone or browser viewing the web remote sees the current output and switches it.
- **Parts.** `GET /api/audio-devices`, `POST /api/controls/audio-device`, the picker beside the volume control, the device in the snapshot.
- **Acceptance check.** A switch from the phone moves playback, and every open remote shows the new device within one snapshot.
- **Effort.** 1 to 2 days [INFERRED].

### Release 3: config app field

- **Capability.** The settings form shows a device select filled from the probe, with a "System default" entry.
- **Parts.** Probe route in the config app, a FIELDS row, a select in `index.html`.
- **Acceptance check.** Saving the form keeps or changes the device. A saved device that is absent shows as "(not connected)" instead of vanishing from the select.
- **Effort.** 1 day [INFERRED].

### Release 4: recovery polish

- **Capability.** Clear status in every surface when the output is lost, and an optional auto-resume when the same device returns within a short window (for a Bluetooth dropout, not a speaker turned off).
- **Parts.** A banner in the web remote driven by the MVP's `audioOutputLost` and `present` fields, and an opt-in `playback.resumeOnDeviceReturn` setting with a window in seconds.
- **Acceptance check.** A 5-second Bluetooth dropout resumes on its own when the setting is on. A speaker off for longer than the window stays paused.
- **Effort.** 1 to 2 days [INFERRED].

Rejected ideas:
- **Bluetooth pairing or connecting from a tool.** Each OS needs its own path. Linux needs BlueZ `Device1.Pair` and `Connect` over the system D-Bus [DIRECT: BlueZ `doc/org.bluez.Device.rst`]. Windows desktop apps cannot call the basic WinRT `PairAsync`, and "a system dialog will always be shown to the user when pairing is going to happen" [DIRECT: Microsoft Learn, 2026-08-19 and 2026-07-22]. Node has no maintained WinRT binding [DIRECT: NodeRT last published 2022]. Of the studied tools, only moOde pairs, through an `expect` wrapper around `bluetoothctl` on its own Raspberry Pi image (`www/util/blu-control.sh:181-219`) [DIRECT]. Volumio's core says "Volumio has a Bluetooth playback input function, not output" [DIRECT]. The rest leave pairing to the OS [ABSENT: no pairing code found].
- **Output to two devices at once.** mpv opens one audio output. MPD fans out from one shared pipe (`MultipleOutputs.cxx:154-171`) and Mopidy with a GStreamer `tee`, which mpv cannot do [DIRECT]. PipeWire `module-combine-stream`, PulseAudio `module-combine-sink` and the macOS Multi-Output Device each make a virtual device that this selector already lists [DIRECT]. Windows has no documented equivalent [ABSENT]. Bluetooth adds latency that wired outputs lack, so the two outputs drift [INFERRED]. A README recipe covers this idea with no code.
- **A second mpv per extra device.** Conflicts with the one-player rule in `docs/PLAYBACK-SPEC.md` and doubles scrobble claims.
- **Matching by description only.** Descriptions collide for identical devices and change with the OS language.
- **`ao-reload` for the re-open.** mpv's own `TOOLS/lua/ao-null-reload.lua` uses it, but the manual lists it as "Undocumented commands: `ao-reload` (experimental/internal)" [DIRECT: `input.rst:1830`]. The documented `auto`-then-name write does the same job. If that write sequence proves unreliable in `pnpm test:playback`, `ao-reload` is the fallback.

## Dependencies

On other roadmap items:
- **Web UI Auth + Roles.** Needs a role check on `POST /api/controls/audio-device` that matches the check on `POST /api/controls/volume`, so a guest role cannot move the output. The Release 2 picker can ship before it, with the same reach as today's volume control.
- **Remote Player Agent.** The agent API must forward `list_audio_devices` and `set_audio_device` to the named agent, so "play in the garage on the Bluetooth speaker" resolves on the right machine. The agent's container needs an audio path for mpv to list any real device. The exact need: mount the host's PulseAudio socket (with `PULSE_SERVER`) or PipeWire socket (with `PIPEWIRE_RUNTIME_DIR` and `PIPEWIRE_REMOTE`) into the container, so mpv lists the host's sinks, including a connected Bluetooth speaker, with hotplug. `--device /dev/snd` alone gives ALSA hardware only and no Bluetooth.
- **Music Assistant Bridge.** None. Its players are network renderers, outside this feature.

On external services: none. Every step runs against the local mpv.

On npm packages: none. The feature uses `node:child_process` and the existing JSON-IPC client.

On mpv: `--audio-device` replaced the per-driver device options in mpv 0.21.0, and `--audio-fallback-to-null` was added in mpv 0.12.0 [DIRECT: `DOCS/interface-changes.rst`]. The project states no minimum mpv version. This feature needs mpv 0.21.0 or later.

## Risks

Pre-mortem: assume the feature shipped and failed.

| Failure mode | Assumption it violated |
|---|---|
| The saved Bluetooth speaker is "missing" after every reconnect, so users re-pick it daily | The device name is stable across reconnects on the user's OS |
| A switch causes a long gap or restarts the track | The reload keeps the position with a sub-second gap (untested here) |
| Turning the speaker off makes mpv run through the queue anyway | The driver reports the loss as an open failure or a list change that the watcher sees |
| The device watcher pauses during a normal switch | `current-ao` reads the string `"null"` only after a fallback, and reads as unavailable during a normal reload |
| The speaker stays "missing" on Linux after an OS upgrade | The PipeWire node name does not change across WirePlumber versions (it did at 0.4.12) |
| A config app save wipes the device | Every store writer keeps keys it does not own |
| The AI picks the wrong device among similar names | The AI reads descriptions well enough to choose |
| The probe hangs on a broken audio stack | `mpv --audio-device=help` always returns fast. The shared `runMpv` timeout guards it |
| Unheard tracks get scrobbled while mpv plays to its null output | The device watcher pauses every file that plays to the null output, in every attached process |

Cheapest to guard against now: the config app save, which already keeps stored keys the form lacks, so one unit test pins it for the device. The next cheapest is the watcher's `null` check, which a unit test with recorded `current-ao` sequences covers.

## Sources

### Official docs

- mpv manual `input.rst` and `options.rst`, master `01e2533f` (2026-10-17), https://github.com/mpv-player/mpv/tree/01e2533f3143b8940857ca419b0b367f583e05ca/DOCS/man. The `audio-device`, `audio-device-list`, `current-ao` and `--audio-fallback-to-null` contracts, and the `ao-reload` status. For the engine's observe list, spawn flags and re-open step.
- mpv `DOCS/interface-changes.rst`, same commit. The 0.12.0 and 0.21.0 entries. For the minimum mpv version.
- Microsoft Learn, Endpoint ID Strings (updated 2026-08-27), https://learn.microsoft.com/en-us/windows/win32/coreaudio/endpoint-id-strings, and PKEY_AudioEndpoint_StableId (2026-08-26), https://learn.microsoft.com/en-us/windows/win32/coreaudio/pkey-audioendpoint-stableid. When a Windows device name changes. For the match rule and its tests.
- Microsoft Learn, Bluetooth Classic Audio (updated 2025-07-18), https://learn.microsoft.com/en-us/windows-hardware/drivers/bluetooth/bluetooth-classic-audio, and Bluetooth LE Audio (updated 2025-08-27), https://learn.microsoft.com/en-us/windows-hardware/drivers/bluetooth/bluetooth-low-energy-audio. Endpoints per Bluetooth device on Windows 10 and 11. For the list normalizer and the tool description.
- Microsoft Learn, Pair devices (updated 2026-08-19), https://learn.microsoft.com/en-us/windows/apps/develop/devices-sensors/pair-devices, and WinRT APIs not supported in desktop apps (2026-07-22), https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/winrt-api-desktop-app-support. Why pairing stays out of scope.
- Android media output guide, "Don't be noisy" (updated 2025-04-07), https://developer.android.com/media/platform/output, and Apple, Responding to audio route changes (2026), https://developer.apple.com/documentation/avfaudio/responding-to-audio-route-changes. The pause-on-disconnect convention. For the open decision.
- PipeWire module-combine-stream (PipeWire 1.6.9 docs), https://docs.pipewire.org/page_module_combine_stream.html, and the Apple Audio MIDI Setup multi-output guide (macOS 27), https://support.apple.com/guide/audio-midi-setup/play-audio-through-multiple-devices-at-once-ams7c093f372/mac. For the two-device README recipe.
- Raspberry Pi OS documentation (fetched 2026-10-17), https://www.raspberrypi.com/documentation/computers/os.html, and release notes (latest entry 2026-10-06), https://downloads.raspberrypi.com/raspios_arm64/release_notes.txt. Pi device names and the move to PipeWire. For Pi test fixtures.

### Comparable projects' source code

- mpv, master `01e2533f`, https://github.com/mpv-player/mpv/tree/01e2533f3143b8940857ca419b0b367f583e05ca. `player/audio.c:88-125, 395-512, 765-798` (open, fallback, reload), `player/command.c:1902-1949, 4916-4919, 8252-8259` (properties, notifications), `audio/out/ao.c:291-358, 470-611` (device list, forced device, help format), `player/misc.c:257-276` (track error), `audio/out/ao_wasapi_utils.c:810-1017` and `ao_wasapi_changenotify.c:53-156` (Windows names and loss), `ao_pipewire.c`, `ao_pulse.c`, `ao_alsa.c`, `ao_coreaudio_utils.c`, `player/lua/select.lua:397-440` (mpv's own picker), `TOOLS/lua/ao-null-reload.lua` (upstream recovery pattern). The reference for every engine step.
- Jellyfin MPV Shim 3.2.0, `9fa9c9e1`, https://github.com/jellyfin/jellyfin-mpv-shim. `jellyfin_mpv_shim/player_audio.py:232-282` (apply per mpv instance and on change), `mpvtk_browser/gateway/playback.py:81-130` (picker from `audio-device-list`, 5 s cache). The closest design to this feature.
- IINA, develop `5c15f815`, https://github.com/iina/iina. `iina/PlayerCore.swift:668-672, 1949-1950, 2293-2310` (presence check at start, fallback on a list change). The default-fallback precedent and the name-plus-description store.
- mpv.net 7.1.2.0, `ef45baec`, https://github.com/mpvnet-player/mpv.net. `src/MpvNet.Windows/WinForms/MainForm.cs:459-472`, `src/MpvNet/App.cs:30, 97-98`. A Windows frontend that remembers the device by default.
- SMPlayer 26.8.29, `cbca1020`, https://github.com/smplayer-dev/smplayer. `src/deviceinfo.cpp:343-375, 420-422`. The precedent for parsing `mpv --audio-device=help`.
- MPD 0.25 dev, `88c4c4b3`, https://github.com/MusicPlayerDaemon/MPD. `src/output/State.cxx:32-65` (persist by name), `src/output/Control.cxx:15-17` (10 s reopen), `src/output/MultipleOutputs.cxx:154-227` (fan-out).
- librespot 0.8.0, `19959512`, https://github.com/librespot-org/librespot. `src/main.rs:904-909` (`--device ?`), `playback/src/player.rs:1624-1636, 1871-1874` (pause on sink failure).
- Strawberry, master `4ccb487d`, https://github.com/strawberrymusicplayer/strawberry. `src/settings/backendsettingspage.cpp:299-433`, `src/engine/mmaudiodevicelister.cpp:78-84`. Stores the WASAPI endpoint ID and shows the description.
- moOde r1036, `2fe73261`, https://github.com/moode-player/moode. `www/util/blu-control.sh:181-219` (pairing wrapper), `www/daemon/worker.php:683-733, 2985-3010` (startup fallback, no resume).
- Volumio 3 backend, `4bdfbfc6`, https://github.com/volumio/volumio3-backend. `app/plugins/audio_interface/alsa_controller/index.js:43-87` (card number re-resolved from the name).
- Mopidy v4.0.5, `53b21a4c`, https://github.com/mopidy/mopidy. `src/mopidy/audio/_gst/pipeline.py:43-73` (restart-only output, `tee`).
- Music Assistant 2.10.6, `1dfa0929`, https://github.com/music-assistant/server. `music_assistant/models/player.py:424, 528-531` (a device is a player).
- Home Assistant core, dev `795ab030`, https://github.com/home-assistant/core. `homeassistant/components/spotify/media_player.py:274-289, 394-402` (`source` as the output device).
- WirePlumber, master `fcc8d79b`, https://gitlab.freedesktop.org/pipewire/wireplumber. `src/scripts/linking/find-defined-target.lua:116-126` (fallback when a target is missing), `src/scripts/lib/monitor-utils.lua:168-172` (node names), NEWS 0.4.12 (2022-10-04). For the PipeWire loss tests.
- PipeWire, master `e86cffd0`, https://gitlab.freedesktop.org/pipewire/pipewire, `spa/plugins/bluez5/bluez5-device.c`, and PulseAudio, master `77d25a1e`, https://gitlab.freedesktop.org/pulseaudio/pulseaudio, `src/modules/bluetooth/module-bluez5-device.c:1279`. Bluetooth sink names and lifetimes.

### Specs and standards

- MPD protocol, output commands (latest, fetched 2026-10-17), https://mpd.readthedocs.io/en/latest/protocol.html. The `outputs` and `enableoutput` split behind the two-tool surface.
- Home Assistant media player entity (developers docs `50b51889`), https://developers.home-assistant.io/docs/core/entity/media-player. The `source_list` and `select_source` model.
- Microsoft Learn, DEVICE_STATE_XXX constants (updated 2021-01-06), https://learn.microsoft.com/en-us/windows/win32/coreaudio/device-state-xxx-constants. The endpoint states behind the registry read.
- Apple CoreAudio `AudioHardwareBase.h` (MacOSX 11.3 SDK mirror), https://raw.githubusercontent.com/phracker/MacOSX-SDKs/master/MacOSX11.3.sdk/System/Library/Frameworks/CoreAudio.framework/Versions/A/Headers/AudioHardwareBase.h. The UID is "persistent across boots".
- BlueZ `org.bluez.Device` D-Bus API, master `fa6ba550`, https://raw.githubusercontent.com/bluez/bluez/master/doc/org.bluez.Device.rst. For the rejected pairing idea.

### Other

- Observations on this machine (2026-10-17). `mpv --audio-device=help` with mpv v0.41.0-244-gaf9c81fa1, and a read of `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render`. Real Windows names and descriptions for test fixtures.
- x11docker wiki, Container sound (revised 2025-12-15), https://github.com/mviereck/x11docker/wiki/Container-sound:-ALSA-or-Pulseaudio. Socket mounts for PulseAudio and PipeWire. For the Remote Player Agent item.
- WirePlumber issue 335 (closed 2022-12-01), https://gitlab.freedesktop.org/pipewire/wireplumber/-/issues/335. Older WirePlumber restore-stream overriding an explicit mpv device.
- Volumio help article 131 (undated), https://help.volumio.com/en/articles/131-is-it-possible-to-stream-audio-from-volumio-to-wireless-bluetooth-speakers, and the community Wireless Output Manager thread (2026-08-11), https://community.volumio.com/t/experimental-plugin-wireless-bluetooth-airplay-output-manager-for-volumio-4/77180. How an appliance distribution treats Bluetooth output.
