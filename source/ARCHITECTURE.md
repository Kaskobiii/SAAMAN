# SAAMAN native plugin, 1.3.10

SAAMAN.dll is an x86 EuroScope plugin with Win32 child panels hosting the AMAN UI
through Microsoft WebView2. The calculation engine is editable TypeScript.
Vite builds the UI; scripts/embed-assets.mjs embeds it as Windows resources;
CMake builds the DLL. Its renderer serves assets at an internal HTTPS origin,
with no AMAN HTTP listener, Node process or external browser.

native/plugin.cpp owns SDK initialization, timer/METAR callbacks, commands and
optional tag items. native/telemetry.cpp captures route geometry, positions,
clearances and active runways. All EuroScope SDK calls remain on its callbacks.
native/radar_screen.cpp manages the COTS launcher and radar redraw notification.
native/host.cpp owns the STA/WebView thread and embedded TopSky-style panes.
native/context.cpp shares telemetry, plan, revision and guidance behind a mutex.

ui/src/native-rpc.ts correlates privileged messages from the embedded origin.
native-transport.ts maps UI operations to the local context or SharedRelay.
SharedRelay owns calculation, checkpoint acceptance, operational patches and
coordination. LegacyRelay translates its internal protocol to the existing
vatIRIS callsign API. It preserves recovery data as an extra MAESTRO sequence
field and confirms settings through sequencer commands. BACKEND-INTEGRATION.md
documents the transport, retry behavior and legacy server limits.

Callsign mode is the default shared adapter and has no AMAN login screen.
The SDK exposes callsign, not CID. CallsignIdentity checks fresh connected SDK
telemetry, matches live callsign/CID in the VATSIM ATC feed, and clears identity
after disconnect or failed checks. vatIRIS independently checks live writers.
Training controllers need no CID; a training supervisor may save one locally.
One sequence is shared per airport/network. Only SAAMAN instances should compute
that room, since other AMAN engines use different state and command formats.

Supervision is a separate read-only consumer of the same state. Its settings
changes go through the sequencer, with supervisor checks in cooperating DLLs.
The unchanged legacy server has no private supervisory API. An optional custom
standalone key adapter still uses scoped rooms and server authorization.
Its controller keys remain DPAPI encrypted for the Windows user/server origin;
callsign mode sends no key or OAuth token. Legacy OAuth support remains internal
for compatibility and is absent from the connection menu/default flow.

The timing model, STAR workbook data and labels run in the embedded engine.
Live aircraft use a captured EuroScope estimate with the configured 2/1-minute
normal/near base on feeder and runway times. Higher captured groundspeed adds
compensation to the landing estimate only. Direct clearances do not recapture
the accepted time; Recompute does. A confirmed runway change captures fresh
timing and replaces the accepted approach once. While SDK assignment and shared
runway plan disagree, the accepted runway, phase and relative order stay intact.
Transition cohort ranks survive checkpoint handover and staggered confirmation;
a withdrawn assignment cancels the wait. An already-crossed feeder keeps STA-FF.
State schema remains saaman-1.1.9.
Hidden AMAN panels continue calculating/sharing on native pulses.

Guidance goes directly from the UI to the DLL, then to TopSky using MAESTRO
WM_COPYDATA. Authoritative zero stays zero; stale guidance and unload clear
output. There is no telemetry/timing-file bridge. Local plans/settings persist
under %LOCALAPPDATA%/SAAMAN/State across releases. Snapshots save at most once per
five seconds; unload flushes the plan. Startup telemetry returns 503 until a real
SDK capture replaces the placeholder. Runtime history, profiles and key files
must not be shipped in source releases.

scripts/build.ps1 checks UI types, runs model/adapter tests, builds/embeds the UI,
compiles the x86 DLL and runs native context checks. saaman_host_test.exe with
an isolated folder tests the real WebView, synthetic telemetry, operations and
rendering without loading the EuroScope SDK or modifying the installed plugin.
The user confirmed the earlier live drag-trail fix on 13 October 2026.
The user confirmed two-controller syncing on 13 October 2026. New runway/coverage
behavior has model and native-renderer validation. version.json is the single
version source for DLL and UI.

Native source is GPLv3-derived from vatIRIS. WebView2 SDK acquisition is pinned
by version and SHA-256. No Juha binary or reconstructed proprietary source is
included. No server calculation bundle is shipped.

maestro-feeder-coverage.ts applies the current ESE owner chains to the local
controller inventory captured by native/telemetry.cpp. Each UI reads its own
SDK telemetry for coverage, not the sequencer's source in the shared checkpoint.
Receiving APPs retain unfiltered Runway/FLOW; APP-W has ELTOK-only ARR-W.
SharedRelay initializes arrival/departure selection once on every acquired lease,
even with a restored snapshot. Missing selections postpone publication.
The interval label offset changes glyph placement only; drag time uses the
original scheduled-time anchor, not the displaced glyph.

maestro-connection.ts keeps unchanged sessions intact and persists changed
settings before releasing the prior relay. Native mode:set returns changed:false
without clearing timing or reloading supervision for unchanged options. Leaving
drains in-flight publication before releasing the lease. telemetry_fields.h copies
and normalizes SDK airport/runway names; .saaman runways exposes bounded raw data.
Feeder position matching collapses handover underscores; network identity does not.

TelemetrySupportedRunway restricts native geometry to the model's supported
airport/runway keys; unsupported sector entries remain in diagnostic SDK samples.
Endpoint coordinates are checked before serialization. validateTelemetry removes
unsupported/invalid optional geometry at the model boundary, independently of
active runway selection and strict core aircraft prediction/position validation.
The archived 1.3.2 error was reproduced with the installed sector's 07/25 entries;
the current adapter and native renderer accept the same geometry fixture.

CoordinationPopup is an owned top-level Win32 window on the existing host STA,
centered against the EuroScope root window. It does not create a WebView or relay
client. The AMAN worker watches its pending shared messages and updates it via
host:coordination. Clicking Acknowledge forwards a message-ID event to that same
worker, which verifies the current pending ID and uses the existing coordination
endpoint. Shared confirmation clears/advances the popup; errors restore retry.
Pane visibility does not affect the notification. DLL unload destroys it on the STA.
senderCallsign is optional, immutable display metadata captured from local SDK
source at send time. sender retains instance identity for self/ack filtering.
The existing at timestamp is rendered in UTC. Older messages have an explicit
unavailable sender rather than a guessed callsign. No room schema change is required.

Context defaults to shared vatIRIS callsign mode on VATSIM live. Loading options
without a shared field keeps that default; explicit saved local mode is retained.
Native context checks cover fresh defaults, older partial options and local reload.

## Live ETA and accepted landing buffer

The high-speed supervisory setting defaults to six minutes at 450 kt. Above 300 kt, the landing buffer adds `(groundspeed - 300) / 150 * max(0, highSpeedBuffer - normalBuffer)` to the current phase base, rounded to seconds and capped at 15 minutes. Every valid update uses current groundspeed and EuroScope landing EET for public `eta` / `liveBufferedEta`. Stale or invalid observations retain the last valid public ETA; a zero-minute airborne EET remains usable for the forecast.

Initial capture and explicit Recompute store the accepted ETA, raw estimate, groundspeed and buffers in `euroscopeBaseline`. Allocation uses that baseline rather than the public ETA: `runEngine` copies previous checkpoint flights with their accepted ETA for scheduling, then exposes the live ETA after allocation. The caller's checkpoint is never mutated. Upgrades preserve older accepted baselines. Normal timeline labels continue using STA or STA-FF. `runwayDelay` shows the live STA-minus-ETA comparison while accepted instruction policy remains unchanged.

`feederBufferMinutes` records the separate phase buffer, so speed compensation cannot lengthen feeder ETA or create an initial instruction by being added twice. Feeder ETA continues following observed feeder timing until passage. Accepted routes advance on observed passage rather than rerouting.

## Floating submenus and runway sync

Vue Teleport renders menus and dialogs into same-origin WebView2 child windows owned by the radar rather than the AMAN pane. `NewWindowRequested` supplies an unnavigated controller from the opener's environment and completes its deferral after setup. Only the embedded floating document and predefined surface names are accepted. Forms keep the owning Vue component and its existing controller session; floating documents do not load the AMAN worker. Title drags use native sibling-window positioning with the existing no-copy/no-erase radar invalidation path. Closing an owner hides its surfaces; reloading it destroys obsolete surfaces. Supervisor content remains inside the framed native body.

Sync EuroScope validates fresh telemetry and supported ESSA ARR/DEP selections, then applies them through the ordinary revision-checked plan edit. It preserves arrival rates and clears a pending runway configuration. Observer/TWR permissions and edit freshness guards remain in force.

In buffer mode, Information route-point observations use cumulative distance along the remaining accepted route divided by current groundspeed, anchored to the position sample time. They are independent of landing and feeder buffers. Live point EET is a fallback when coordinates are missing; unavailable/stale points are blank. The final airport column retains the buffered landing ETA. Performance/demo mode retains its existing display calculation.
