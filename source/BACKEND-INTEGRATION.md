# SAAMAN 1.3.13 existing vatIRIS API adapter

The default shared connection uses the existing callsign-based vatIRIS AMAN API.
Fresh settings select shared mode and VATSIM live. Saved explicit local or
training choices are respected. Shared operation requires the backend service;
local EuroScope mode does not.
No new backend endpoint, backend code change, account-database lookup, OAuth
application, controller key or AMAN login window is needed.

The DLL obtains its connected callsign from EuroScope. For live sessions it
matches that callsign to the public VATSIM ATC feed and obtains the CID for local
supervisor controls. The backend independently performs its existing callsign
check on every live write. Feed refresh is 15 seconds; the DLL drops connection
readiness on disconnection, stale telemetry, unmatched callsign or feed failure.
SweatBox does not require a public feed or CID for ordinary controllers.

## Existing server protocol

    POST /aman/{live|sweatbox1|sweatbox2}/ESSA/poll
    PUT  /aman/{live|sweatbox1|sweatbox2}/ESSA
    POST /aman/{live|sweatbox1|sweatbox2}/ESSA/command
    POST /aman/{live|sweatbox1|sweatbox2}/ESSA/leave
    GET  /aman/{live|sweatbox1|sweatbox2}/ESSA

There is one shared sequence per airport/network. Exercise/channel fields apply
only to the optional standalone key adapter. SAAMAN does not manufacture extra
ICAO identifiers or multiplex independent engines through this room.

Aircraft calculations remain in the elected EuroScope DLL. The server retains
its existing callsign sequencer election, eight-second lease, commands and MAESTRO
publication. The DLL uses immediate polling, not the server's 20-second long poll.
The sender uses JSON with callsign in the body and no Authorization header.

LegacyRelay translates the internal scoped model protocol to the API above.
The MAESTRO publication keeps its existing data/sequence fields and adds
saamanRelay recovery metadata, which the existing server stores opaquely.
It carries the full SAAMAN checkpoint, shared settings, ownership metadata,
epoch, publication ID and bounded command receipts. The model schema remains
saaman-1.1.9. Followers restore the same edits, aircraft baselines, coordination
and settings; a replacement sequencer resumes from that checkpoint.

Commands wrap an inner SAAMAN plan, coordination or settings change with a
request ID. The sequencer checks epochs and patch baselines, remembers outcomes,
and returns legacy results with the correct originating callsign. The adapter
retains destructively delivered results locally, acknowledges processed commands,
and recognizes uncertain publications through their persisted publication ID.
Retry and handover checks live in cooperating DLLs: the legacy server itself has
no scoped-room epochs, CAS, instance-bound lease fences or server retry-ID support.

Supervision reads the same shared state without claiming the sequencer role.
Settings are validated and sent through the sequencer, then confirmed in its
next publication. For live supervisor commands the receiving DLL matches the
sender's callsign to CID 1396125 in the feed. Training supervisors can save their
CID once in Operation mode. General training controllers need no CID.
This existing API has no private supervision endpoint; these supervisor checks
are enforced by the cooperating DLLs, not a new backend authorization layer.

Observation uses read-only GET requests and cannot accidentally become sequencer.
An incompatible publication from another AMAN engine is rejected, rather than
silently overwritten. This adapter supports shared SAAMAN controllers; Juha/ESAA
AMAN uses a different command/calculation protocol and should not compute this
same room concurrently. The backend's optional AMAN_SWEATBOX_KEY policy still
applies; this release does not bypass a configured server training key.

The former test VM address migrates to https://backend.vatiris.se when the DLL
loads saved connection settings. Local flight history and encrypted key files
are preserved. Custom standalone endpoints can still use Controller key mode.
No key or saved OAuth token is sent in vatIRIS callsign mode.

Validation: 272 model/adapter tests; strict UI check; Win32 build; native context
and embedded window checks. An additional real-HTTP integration test exercised
the unchanged vatIRIS legacy router without tokens or database access, covering
edits, coordination retries, supervision settings and owner handover.
The deployed public /aman status API returned HTTP 200. The user confirmed
syncing between two EuroScope controllers on 13 October 2026.

On becoming sequencer, the DLL initializes runways from that controller's active
EuroScope arrival/departure selections, even with a restored shared checkpoint.
This does not need a backend change. Controller inventory and feeder filtering
are local UI state; ACC/ARR-W coverage never filters shared publications or the
Runway/FLOW views. The user confirmed the existing drag-trail fix is working.

1.3.3 retains exact FMP/handover callsigns for the existing API. Feeder mapping
normalizes underscores only for local position matching. An unchanged connection
save sends no leave/reload; actual changes persist before leaving, and release
follows pending publication. SDK runway identifier normalization is native-only;
no backend change is required.

1.3.3 corrects telemetry rejection from extra sector-file runway geometry such
as ESSA 07/25. Native/model boundaries ignore unsupported optional geometry.
This does not change room protocol, authentication or require a server update.

1.3.4 adds optional senderCallsign display metadata to coordination messages.
SharedRelay captures the exact local login callsign; the existing instance sender
and acknowledgement identities remain unchanged. LegacyRelay carries the field
with the checkpoint and command through the unchanged API. Send time remains the
original at timestamp, retained across polling, retries and ownership handover.
The separate native notification window does not connect to the backend itself.

The automated compatibility suite downloads the real upstream AMAN router and
checks its recorded commit/checksum before testing SAAMAN over local HTTP. Six
checks cover sync/edit/acknowledgement/settings/ownership, retry, network isolation,
observation and existing backend authorization. The external controller feed is
controlled test data; no production backend write or database is involved.
See [compatibility testing](../docs/BACKEND-COMPATIBILITY.md).
