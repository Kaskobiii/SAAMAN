# SAAMAN 1.3.8

- Current landing ETA follows the latest usable EuroScope estimate and current groundspeed. The configurable speed buffer scales continuously with groundspeed.
- Accepted STA, STA-FF and captured history remain independent of the live forecast. Direct clearances and speed changes update ETA without moving the assigned slot; Recompute adopts the latest estimate for allocation.
- Information, supervisor diagnostics and the hover tooltip show current ETA. Normal timeline positions and labels continue showing assigned times.
- Stale or invalid observations retain the last valid ETA. An airborne zero-minute landing estimate can still update the forecast.
- Feeder estimates retain the existing 2-minute/1-minute phase buffer; extra speed compensation remains landing-only. Shared mode, automatic connection and the drag-trail fix are retained.

Validation covers live updates across Unstable, Stable, Superstable and Frozen phases, shared checkpoint recovery, preserved allocation, invalid input and zero-minute estimates, plus the existing model/adapter, vatIRIS compatibility and native checks.

Unload the old DLL before replacing it and loading this version.
