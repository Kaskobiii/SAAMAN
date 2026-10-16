# SAAMAN native plugin, 1.3.17

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

## Live aircraft phase timing (1.3.13)

`maestro-route-timing.ts` integrates aircraft-to-feeder and feeder-to-threshold time over the known remaining route. `predictLanding` uses it when inputs are usable, after the existing established-final geometry shortcut. Both sections share one position-age adjustment and receive no second fixed buffer. Observed physical feeder passage and explicit ETA-FF overrides take precedence. Raw SDK ETAs remain visible separately. Corrections can be negative when the route profile predicts earlier than EuroScope. Already accepted baselines are not automatically recaptured on upgrade or new telemetry; initial capture, Recompute and the established explicit recapture paths retain their previous meaning.

The embedded `data/eurocontrol-phase-profiles.json` contains 398 aircraft with the requested initial-descent Mach, descent IAS, approach IAS, minimum clean IAS, landing Vat and published phase endpoint altitudes. It was extracted from the EUROCONTROL Training Institute Aircraft Performance Database on 15 October 2026. Each lookup has its official ICAO source URL. These are indicative training reference values, not operating limitations or direct groundspeeds. No climb values, charts, aircraft photographs or descriptive articles are included. Seven implausibly labelled Mach entries and C25A's 1500-kt minimum clean speed were excluded without guessing replacements. Missing speeds fall back to the existing EuroScope performance profiles. No universal approach or landing altitude was supplied by the source; the path model retains its explicit altitude assumptions.

The database is embedded in the existing UI/worker assets and validated once into an immutable lookup. It requires no runtime HTTP fetch, SQLite, external service or native memory allocation for profiles. Invalid profile fields are ignored. The calculation rejects stale/incomplete geometry, heading vectors, climbing traffic, implausible observed speed ratios, altitude above 60000 ft, GS outside 60–1200 kt and routes exceeding 512 points/1500 NM. Integration is bounded to at most 6000 distance samples plus 120 altitude steps; results outside four hours decline. The previous route-slowdown/SDK fallback and recent correction continuity remain available, while aligned short final uses actual distance/GS.

IAS/Mach use the existing ISA conversions. The current GS-to-nominal-speed ratio is an observed offset incorporating unknown wind and simulator/pilot behaviour, not a wind measurement. It anchors upstream timing and tapers during terminal deceleration; the model does not accelerate slower traffic above observed GS. Distant traffic retains capture altitude until nominal descent distance. Assigned speed constrains the profile. Future vectors, radio clearances and runway changes are not forecast. The historical full-database comparison had feeder MAE 63.1→51.7 seconds (27 matched pairs) and landing MAE 123.9→127.5 seconds (30 matched pairs); the owner accepted this tradeoff. Those are development samples with later interventions and no exact initial-capture markers, not a live accuracy guarantee.

Recordings preserve the optional exact `timingCaptures` and `unavailableCaptures` arrays introduced in the preview. Start recording before capture to retain exact initial inputs. These arrays remain opt-in, byte-bounded and absent from shared backend payloads. The offline replay tool can still take `--profiles <local-extraction.json>` for alternative data. Its current-model column now represents the active 1.3.13 predictor; the historical preview review remains archived in `docs/INITIAL-TIMING-REVIEW-1.3.12.md`.

## Provisional Unstable scheduling (1.3.14)

The buffer-mode scheduling path formerly restored every flight's captured ETA before allocation. For long-haul Unstable observations, a climbing aircraft's slow captured forecast could therefore remain an assigned time even after the public ETA improved substantially. Recording 10 reproduced a false 488-second instruction for NSZ4052 despite no remaining traffic ahead.

Automatic Unstable entries now allocate from their current usable landing/feeder pair, recorded in a local per-run set. Their transfer interval and planning ETA use the same pair, avoiding a current landing estimate combined with an obsolete captured feeder interval. This also applies to the last provisional update on leaving Unstable, so the newly protected phase starts from that assignment. The original `euroscopeBaseline`, initial capture fields, and exact recording capture events remain history; no implicit Recompute or model recapture is created. Manual absolute targets, entered traffic, pending runway transitions, missed recovery and flights already in a protected phase retain their existing policies. A stale/unusable provisional observation retains the prior public ETA, feeder ETA and assigned pair instead of restoring the original capture.

Ordering still uses the existing insertion rules: an earlier newly discovered Unstable or Stable arrival can enter ahead of an Unstable aircraft, after which rate/wake spacing, closures, controller intervals and runway availability are enforced. A manual sequence order remains a constraint. No dependency from scheduled time or delay into the predictor is added. The performance database, predictor, native telemetry and vatIRIS backend API are unchanged.

Validation includes a minimal NSZ4052 recording-10 fixture spanning climb, acceleration and level flight, earlier-newcomer cases with free spacing or exactly 15 seconds of additional work, closure removal, manual target preservation, promotion to Stable, stale input and the existing later-phase protections. Full recording replay removes positive NSZ4052 delay after runway confirmation; the final STA-FF follows 17:57:33.868 UTC with zero delay instead of the recorded 18:05:41.405 target and 488 seconds to lose.

## Submenu repaint correction (1.3.15)

The shared native window-position handler previously added SWP_NOREDRAW for both moves and resizes, including the first content-sized resize of a floating submenu. It now retains SWP_NOCOPYBITS for both operations, and defers redraw only when the size actually stays the same. WM_SIZE updates the WebView bounds before invalidating the host and browser descendants. The no-copy drag handling and normal radar refresh notifications remain in place.

An isolated native regression checks the policy on a real floating submenu: resize redraw must be allowed, pure moves must still defer redraw, and neither may copy stale pixels. CapturePreview now completes before the test proceeds to another menu, so the Information image verifies the intended window. Layout checks require the Information title to be inside the viewport. The isolated hidden host harness did not reproduce the exact live blank-panel symptom, but caught the repaint-suppression policy. The user tested the resulting DLL in EuroScope and confirmed that Information and the other submenus display correctly immediately.

## Selection placement and manual reservations (1.3.16)

The selected label now overrides the transparent-label styling with an explicit border and background. A separate armed selection drives a pointer preview: empty space shows the accepted insertion target on the source lane; another available label in that lane shows a pair-swap icon and destination highlight. Clicks confirm the preview; dragging shares the same hit testing and operations. Hit testing uses the current document's elementsFromPoint stack rather than the captured pointer target, so dropping a dragged label onto another aircraft still finds the destination beneath it. Leaving the timeline, changing views or opening a menu clears previews; Escape also cancels a pending drag. Non-editors can highlight labels but cannot arm placements.

Pair swaps exchange the two allocated landing-time targets and order slots, preserving intervening aircraft and existing engine constraints. Feeder-view swaps additionally require the same feeder. No new backend fields or endpoints are required.

The gain-drag limit is retained for live telemetry. Only a configured manual reservation absent from observedCallsigns can move beyond its original time. Passing the active config to the operation makes this distinction explicit; a matching live flight automatically returns to the live policy. Tests cover both timing models, earlier/later moves, repeated updates and checkpoint restoration, feeder-view shifts, real-flight takeover, nonadjacent swaps and invalid destinations. Native UI smoke covers visible highlight colours, insertion arrows, preview-to-commit agreement, persisted later manual dragging, click swaps, drag swaps and Escape. Screenshots capture both preview states.

## Manual reservation lifecycle (1.3.17)

A configured manual flight formerly disappeared only while its callsign was present in real telemetry. After loss/removal of that real flight it was synthesized again, potentially with a negative destination EET and an Invalid destination route prediction diagnostic. A pure lifecycle helper now consumes reservations once real telemetry takes over, heals older checkpoints using observedCallsigns, and expires unused reservations once their original time, explicit target and prior assigned time have all passed. A future target or closure-delayed allocation preserves a reservation; deliberately re-adding the same callsign starts another reservation. Known-flight inventory alone does not consume a placeholder before correlated telemetry arrives.

Optional retiredManualFlights metadata identifies the exact reservation and retirement time/reason in the checkpoint. The engine filters those reservations without mutating config; shared publication prunes matching operational entries, and the local MASTER snapshot handler does the same before immediately saving. Local cleanup increments the plan revision, so commands based on the old manual inventory retry rather than restore it. Elapsed reservations also retire obsolete edits, while active real-flight assignments and newer controller edits stay intact. Snapshot metadata prevents a stale config from resurrecting a consumed entry during direct replay or recovery.

Regressions cover replacement by a B77W under CCA911, repeated disappearance/reload, older-checkpoint healing, elapsed entries, explicit later targets, new reservations with a reused callsign, unrelated traffic, stale-target removal, shared sequencer takeover and native config persistence/revision invalidation. Existing flight phases, ETA model and live sequencing protections are unchanged.
