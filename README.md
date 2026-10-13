# SAAMAN

An embedded EuroScope arrival manager for Stockholm Arlanda (ESSA), with shared
sequencing and controller coordination through the existing vatIRIS backend.
The working baseline is **1.3.4**. Syncing between two EuroScope controllers has
been confirmed in use.

## Download and install

Download the ZIP from [Releases](https://github.com/Kaskobiii/SAAMAN/releases).
Unload the previous plugin before replacing and loading `SAAMAN.dll`. Microsoft
Edge WebView2 Runtime is required. No EuroScope profile changes are needed.

Use `.saaman` to open AMAN and `.saaman supervisor` for supervision. Select
**MAESTRO > Operation mode > Shared backend > vatIRIS EuroScope callsign**,
use `https://backend.vatiris.se`, and choose VATSIM live, SweatBox 1 or SweatBox 2.
Controllers on the same network share one ESSA sequence. No separate AMAN login
or controller key is required in vatIRIS callsign mode.

## Features

- Shared sequence, edits and acknowledgements, with one elected sequencer and
  recovery when another controller takes over.
- Initial runway configuration from EuroScope's active ARR/DEP selections.
- Configurable EuroScope time buffers for landing and feeder estimates; accepted
  routes and times survive direct clearances until an explicit Recompute.
- Controller-specific ACC/ARR-W feeder coverage, with unfiltered Runway and FLOW views.
- Coordination notifications in a separate window centered over EuroScope,
  showing the sending login callsign and UTC send time.
- Local mode, session recording, supervision and TopSky guidance output.

![Coordination notification](docs/images/SAAMAN-coordination-preview.png)

## Development

Editable TypeScript/Vue UI and calculation code are in `source/ui`; the x86
Win32/WebView2 plugin is in `source/native`. Build scripts, model/adapter tests
and native test harnesses are included. See [BUILDING.md](BUILDING.md).

The 1.3.4 baseline passed 272 model/adapter tests, UI type checks, the Win32 build,
native state checks and real renderer/popup checks. The native fixtures cover
FMP, handover, receiver and APP-W views. The existing drag-trail correction has
also been confirmed in EuroScope.

See [architecture](source/ARCHITECTURE.md),
[backend integration](source/BACKEND-INTEGRATION.md),
[operating requirements](source/OPERATING-REQUIREMENTS.md) and
[1.3.4 release notes](docs/RELEASE-NOTES-1.3.4.md).

## License and credits

SAAMAN includes GPLv3-derived vatIRIS work and is distributed under the
[GNU GPL v3](LICENSE.txt). Dependency licenses and attribution are retained in
[THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) and the source tree.
