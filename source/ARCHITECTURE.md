# SAAMAN native plugin, 1.3.12 preview

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

## Live landing ETA and accepted planning times

`maestro-landing-prediction.ts` predicts crossing of `SA<assigned runway>`, not the later airport route endpoint. If threshold EET is unavailable it explicitly falls back to the airport estimate. Fresh route coordinates supply remaining distance; a heading clearance makes that path uncertain unless current position and track establish alignment with final. No hypothetical turn back to a STAR is invented.

The generic expected groundspeed profile uses 140 kt within 4 NM, 180 at 10, 240 at 20, 300 at 40 and 450 at 100 NM, interpolated between points. It starts from observed groundspeed and sheds excess speed progressively over remaining distance. Traffic already slower than the profile is not accelerated. This is an empirical nominal profile, not an aircraft-specific performance or wind model; it can mispredict both departure acceleration and future vectoring. Integrating the profile gives an expected travel time. Only the difference missing from EuroScope's threshold EET is added, to avoid counting existing slowdown twice.

Whole-minute EET samples receive a 30-second midpoint estimate of quantization uncertainty when not superseded by final geometry; the SDK's exact rounding rule has not been established. Established short final (within 4 NM, cross-track <=0.25 NM, heading within 15 degrees, altitude <=4500 ft, vertical speed <=300 ft/min) uses along-final distance/current GS, adjusted for position age. There is no minimum one-minute floor and a correction can be negative. An established fresh airborne flight continues receiving live ETA below 350 ft until independently detected as landed; initial ground capture remains guarded.

The existing backend configuration keys are retained. `euroscopeBufferMinutes` (default 2) and `euroscopeSuperstableBufferMinutes` (default 1) remain feeder allowances and fallback bases. `euroscopeHighSpeedBufferMinutes` (default 6) is now an **extra landing correction limit**, not six minutes at 450 kt: the route correction is capped at phase base plus this value, with an overall 15-minute maximum. Unsupported path geometry uses a capped fraction of remaining EET plus the phase fallback allowance, with no speed-only addition. A vector can retain the last model-derived correction on the same assigned runway for up to ten minutes from its original observation. Stale positions cannot apply that correction; fallback does not renew its age; new final geometry supersedes it. The source, reference, distance and correction are visible in supervision. This retention avoids an artificial drop on entry into vectoring; it does not predict future clearances.

`landingPrediction.continuity` travels in checkpoints so sequencer handover preserves recent model information. It contains only a model correction, runway and observation timestamp. STA, assigned delay and retained holding instructions never feed back into live prediction. Resuming/requeueing an aircraft resets this history; runway changes cannot reuse a correction from the previous runway.

Initial capture, explicit Recompute and confirmed runway changes store accepted ETA, raw estimate, reference, groundspeed and correction in `euroscopeBaseline`. Scheduling uses that accepted baseline, while public `eta` / `liveBufferedEta` follows live observations. Existing baselines survive upgrade, ordinary speed changes, route edits and phase changes. `runEngine` does not mutate its caller's checkpoint. Timeline labels retain STA/STA-FF; `runwayDelay` shows STA minus live ETA, independently of accepted instruction policy. Stale/invalid observations retain the last valid public ETA.

`feederBufferMinutes` records the separate phase allowance. Landing slowdown correction does not lengthen feeder ETA or get added to feeder timing twice. Accepted routes advance on observed passage, not ordinary reroutes. Existing five-minute holding instructions remain intact until the existing controller refresh/recompute policy changes them.

## Floating submenus and runway sync

Vue Teleport renders menus and dialogs into same-origin WebView2 child windows owned by the radar rather than the AMAN pane. `NewWindowRequested` supplies an unnavigated controller from the opener's environment and completes its deferral after setup. Only the embedded floating document and predefined surface names are accepted. Forms keep the owning Vue component and its existing controller session; floating documents do not load the AMAN worker. Title drags use native sibling-window positioning with the existing no-copy/no-erase radar invalidation path. Closing an owner hides its surfaces; reloading it destroys obsolete surfaces. Supervisor content remains inside the framed native body.

Sync EuroScope validates fresh telemetry and supported ESSA ARR/DEP selections, then applies them through the ordinary revision-checked plan edit. It preserves arrival rates and clears a pending runway configuration. Observer/TWR permissions and edit freshness guards remain in force.

In buffer mode, Information route-point observations use cumulative distance along the remaining accepted route divided by current groundspeed, anchored to the position sample time. They are independent of landing and feeder buffers. Live point EET is a fallback when coordinates are missing; unavailable/stale points are blank. The final airport column retains the buffered landing ETA. Performance/demo mode retains its existing display calculation.

## Route-profile comparison (1.3.12 preview)

`maestro-route-timing.ts` integrates aircraft-to-feeder and feeder-to-threshold travel along the extracted known route. The sections share one position-age adjustment. IAS/Mach reference speeds are converted through the ISA conversion functions; the initial speed ratio is anchored to observed GS and explicitly includes unknown wind and pilot/simulator behaviour. It is not a wind measurement. The offset is retained before the feeder and tapered during terminal deceleration, with no acceleration above observed GS. A nominal descent distance keeps distant traffic at capture altitude before the descent section instead of spreading descent over the entire inbound route. Feeder entry altitude and the subsequent altitude path remain planning assumptions, not known clearances. Assigned speeds constrain the profile. Unknown aircraft, climbing traffic, stale/invalid inputs, heading vectors, incomplete route geometry or implausible speed ratios produce no candidate.

The 430-type MIT-licensed EuroScope profiles remain the broad data source. Selected numeric phase references for HDJT and A20N were cross-checked against the EUROCONTROL Training Institute pages supplied by the user (15 October 2026); their source URLs are retained beside the values. Approach IAS, minimum clean speed and landing IAS are separate quantities. The database describes indicative performance, not aircraft operating limits. No charts, photos or bulk database are bundled.

The candidate is intentionally absent from `runEngine`, the worker, shared publication and scheduling. Supervision computes a comparison for the selected flight, and `SessionRecording` computes it once per captured baseline. No candidate can change a target or controller instruction. The 1.3.11 predictor remains authoritative. Promotion requires further validation; the current candidate regresses aggregate landing error.

Recordings add optional `timingCaptures` and `unavailableCaptures` arrays without changing `saaman-recording-1`. Each exact capture indexes a frame and plan, records the accepted baseline and candidate, and distinguishes initial capture from Recompute/recapture. Full telemetry remains stored once in the ordinary frame. Capture arrays count toward the existing recording byte budget. The recorder is still opt-in, clears its capture history on a new session and preserves the existing frame/source limits. These arrays never enter the shared backend checkpoint.

`npm run replay:timing -- <recording.json> [...] [--ignore FIN521]` compares exact initial captures separately from first available inputs. Older recordings do not provide the new capture markers and are never labelled exact initial evidence. The report uses observed threshold-plane crossings below 1000 ft and interpolated passes within 0.3 NM of a feeder, rejects stale or widely spaced position pairs, and reports recorded heading/runway interventions. An observed landing after a clearance change is not counterfactual no-delay truth. No automatic subtraction of assigned TTL is made.

The optional `--profiles <local-extraction.json>` input reads the speed-only `saaman-descent-performance-1` dataset through `maestro-phase-references.ts`. It requires reported values with matching IAS/Mach units, rejects implausible values even if labelled reported, and converts explicit FL endpoints to feet. Missing approach/landing altitudes stay unspecified. This allows replay against all 398 extracted aircraft without adding that complete external database to the public source or DLL. The publisher's permission notice remains attached to the local extraction. No external data is fetched during ordinary plugin operation or replay.
