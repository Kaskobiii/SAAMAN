# SAAMAN 1.3.4

Embedded EuroScope AMAN using vatIRIS's existing callsign-based backend.
No AMAN login screen or backend update is required.

## Coordination notifications

Incoming messages now open in a separate, non-modal window centered over the
EuroScope frame, outside the AMAN pane. The layout shows the message, sender's
actual EuroScope login callsign, and original UTC send time/date. It also works
while the AMAN pane is hidden. Acknowledging uses the existing shared connection;
the window waits for confirmation and then displays the next pending message.
Failed acknowledgements can be retried. New notifications do not replay old room
history on joining. Messages sent by older DLLs show that the sender is unavailable
instead of displaying an internal instance identifier. No backend change is needed.

The user confirmed syncing between two controllers works on 13 October 2026.

## Install and connect

Unload the previous plugin before replacing/loading SAAMAN.dll. The UI and
calculation engine are embedded in the DLL. Microsoft Edge WebView2 runtime is
required. No EuroScope profile changes are needed.

In MAESTRO > Operation mode choose Shared backend / vatIRIS EuroScope callsign.
Use https://backend.vatiris.se and choose VATSIM live, SweatBox 1 or SweatBox 2.
Controllers on the same network share one ESSA sequence. There are no separate
exercise/channel rooms in this mode.

Connect EuroScope normally. The DLL uses your callsign; live callsigns are
matched to the VATSIM ATC feed. No VATSIM Connect login, controller key, account
database registration or CID entry is required for ordinary use.
For the supervisory window during SweatBox only, optionally save your CID.
A server-configured SweatBox key remains subject to the server's existing policy.

Use .saaman to open AMAN, .saaman supervisor for the separate supervisory pane,
and .saaman status for connection status. Local EuroScope mode remains available.
The old test VM endpoint migrates to vatIRIS on loading the new DLL. Local history,
network selection and encrypted key files are preserved. Custom standalone key
servers remain an optional connection mode.

## Sector runway geometry correction

The installed AIRAC 2610 sector file contains an extra ESSA 07/25 runway pair.
1.3.2 captured it, but the AMAN model only supports 01L/01R/08/19L/19R/26 for ESSA.
Its geometry validation rejected the entire telemetry update, which blanked the
shared display with Invalid runway geometry. This was reproduced using the
actual 1.3.2 release source and a fixture from the installed sector file.

The native reader now publishes geometry only for AMAN-supported runway names,
and validates endpoint coordinates before publishing them. The model also ignores
extra or malformed optional runway geometry while retaining fresh aircraft data
and independent ARR/DEP selections. Missing optional threshold data falls back
to the existing published geometry; malformed core aircraft positions still fail
validation. The backend, callsign authentication and flight timing model are unchanged.

270 tests and native window checks passed. The FMP regression now publishes 01R/01L
with the same extra 07/25 input, and the real renderer accepts that sector geometry.

## Save connection and SDK runway identifiers

Saving unchanged settings keeps the room, current pane and supervisory window
open. Changed settings are persisted before leaving the old room; a failed save
cannot stop the current relay. In-flight publication is drained before release.

The native reader immediately copies EuroScope's airport/runway strings, trims
padding, and normalizes case and one-digit runway names before checking activity.
Both ARR and DEP still come from EuroScope; missing flags do not invent a 19R/26
configuration. The waiting message identifies which selection was not detected.
Use .saaman runways to show active selections and bounded raw SDK diagnostics if
that message remains. This contains runway identifiers/flags, not flight details
or controller credentials. The exact live SDK values require a session check.

ESSA_FMP remains supported as an online planning controller. Handover callsigns
such as ESOS_1__CTR and ESSA_W__APP match their primary sector for feeder coverage,
while VATSIM checks and shared requests retain the full, actual callsign.

270 model/adapter tests, native context checks and the Win32 build passed.
FMP and handover renderer fixtures passed, including Save connection without
leaving/reloading the unchanged pane.

## Runways, interval labels and feeder views

A controller becoming sequencer reads the active arrival and departure runways
from their EuroScope selection, including when restoring an existing checkpoint.
Until both selections are available, it waits instead of publishing 19R/26.
The initial selection is read once per ownership; normal refreshes do not undo
manual AMAN runway changes. Expired restored runway changes cannot override it.

Aircraft labels at a gap/closure boundary sit outside the box; END/START captions
stay inside. Scheduled times and timeline anchor dots retain their true positions.
The earlier drag-trail fix was confirmed working by the user on 13 October 2026.

The feeder button is ARR-W for ESSA_W_APP and covers only ELTOK. Center positions
use ACC, with top-down ownership recalculated from EuroScope's connected controller
inventory as lower sectors join or leave. Receiver-only APP/DEP positions have
Runway and FLOW. Runway/FLOW remain unfiltered for all controllers.

Base mappings: S8 ELTOK; S2/S7 NILUG; S6 XILAN; S4 VACRA. S9 can cover NILUG/XILAN.
S1 or S3 alone covers all four; together S1 covers NILUG/XILAN and S3 ELTOK/VACRA.
Ownership follows the AIRAC 2610 v3 ESE priority chains, rather than subtracting
all APP positions. Receiving APP positions do not remove upstream feeders;
APP-W is the explicit ELTOK exception.
The public mapping reference is [ESAA TopSky settings](https://github.com/Vatsim-Scandinavia/ESAA-Sectorfile/blob/main/Plugins/TopSkySettings.txt).

## Existing shared connection

- Use the existing /aman/{network}/ESSA callsign API with no login popup.
- Share the SAAMAN checkpoint, settings and coordination with the MAESTRO sequence.
- Restore the accepted aircraft state when another controller becomes sequencer.
- Preserve command outcomes across retries and compensate for destructive result
  polling in the old API.
- Send supervisory settings through the elected sequencer.
- Use connection readiness for editor controls; drop readiness on disconnect,
  stale data, unmatched live callsign or failed feed checks.

Aircraft timing, accepted routes, Recompute behavior, 2/1-minute buffers and the
23-pixel minute scale retain their previous behavior. Window movement retains
the drag-trail fix already confirmed in live EuroScope.

Use SAAMAN on the participating controllers' computers. Juha/ESAA AMAN has a
different command/calculation protocol and should not compute the same shared
room concurrently. A different engine's publication produces a clear error.

## Verification

272 model/adapter tests passed. UI type check, production UI build, Win32 build,
native context and embedded window/render/operations checks passed. Renderer
fixtures verified ARR-W, ACC and receiver-only buttons, unfiltered Runway/FLOW,
and an aircraft label above the gap with the END caption inside.
A real HTTP test using vatIRIS's unchanged AMAN router passed without tokens or
database access: shared state, edits, coordination retry, settings and handover.
The public vatIRIS /aman status endpoint also returned HTTP 200.
The user confirmed two-controller syncing works on 13 October 2026.
The new notification window has native checks for ownership, centering, sender,
UTC timestamp, acknowledgement forwarding, retry and compatibility with older messages.

Editable source, tests and build scripts are included. BUILD.cmd rebuilds the
Windows DLL. See source/BACKEND-INTEGRATION.md for the adapter protocol.
