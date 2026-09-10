# Beta isolated Host experiment

Status: opt-in experiment; stable is unchanged.

English | [中文](2026-09-10-beta-isolated-host.zh.md)

## Boundary

`DSH_DESKTOP_ISOLATED_HOST=1` starts the Beta Cordis Host in an Electron utility process. The main process still owns windows, native menus, dialogs, update networking, and OS-protected certificate access. The existing Web server, authentication, HTTP/WebSocket transport, client-module composition, and Desktop client visuals remain in their existing layers. No chat requests or model streams are proxied through the new control channel.

AA Host services move with Cordis when enabled; the Python Connector remains its existing subprocess. This isolates the Electron event loop from Host CPU work. It does not fix slow Host tasks, AA compatibility, or plugin-inventory package resolution.

The private control channel transports native commands and snapshots. Functions stay in their owning process and are addressed by callback IDs. Environment layers retain their provenance. Host logs use the Beta user-data `logs/host` directory. Native update requests still use the original Electron adapter; cancellation crosses the channel. Interactive dialogs and downloads are not subject to the ordinary RPC deadline.

## Try locally

From this worktree, install locked dependencies and build the Beta package:

```sh
corepack yarn install --immutable
corepack yarn workspace dsh-plugin-desktop-beta build
corepack yarn workspace dsh-plugin-desktop-beta prepare:electron-native
corepack yarn workspace dsh-plugin-desktop-beta start:isolated
```

The Yarn script works on Windows as well as macOS. Close the running Beta first. Ordinary `start` without the environment variable uses the original in-process path. Do not use the same Profile simultaneously in two instances.

## Verification and promotion

Headless tests cover bidirectional native calls, cancellation, environment provenance, shell/tray callbacks, supervisor exit handling, and a real Node subprocess booting the DSH Web profile. The real-process fixture adapts Node IPC to the utility-process port API; it does not validate Electron utility-process behavior or OS packaging. It verifies distinct PIDs, authentication, a third-party client entry and its served bundle, and orderly Web-server shutdown.

Before enabling this by default or porting it to stable, validate Windows and macOS packaged utility processes, ASAR module paths and native addons; window materials and controls in each mode; settings, tray refresh and Profile changes; LAN certificates; Host crash/hang and application shutdown; AA startup and large-history sync; and actual client plugin activation/HMR in a browser. Verify no Connector/tool descendants survive shutdown. Do not claim a Windows responsiveness improvement without measuring it.

Unexpected Host exit is reported without automatic restart or replay. Shutdown first requests disposal, then terminates a nonresponsive child with a bounded exit wait. Recovery mutations remain unavailable if termination cannot be confirmed. Forced termination of arbitrary plugin descendants is not proven by the current headless fixture.

The isolated bootstrap currently mirrors the existing bootstrap while this experiment is opt-in. Consolidate the two implementations before default adoption to avoid lifecycle drift. The image-reported request-extension inventory failure needs its own packaged-layout regression and fix.
