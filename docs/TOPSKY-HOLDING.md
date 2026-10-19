# TopSky feeder-hold integration

SAAMAN reads TopSky's en-route hold from flight-strip annotation 6 (`h/POINT/h`) and its network scratchpad messages (`/HOLD/POINT/`, `/XHOLD/POINT/` or `/XHOLD/`). The durable slot can be absent on a remote controller, so received commands are retained per callsign. A cancellation wins over an older strip copy. Other scratchpad traffic, including HOLD_EAT, does not create or cancel a hold. No TopSky field is written.

Protocol references: [vatIRIS scratchpad examples](https://github.com/minsulander/vatiris/blob/75c635dd508a1e2641c6c45f642e4114eb134c0c/euroscope-plugin/src/plugin.cpp) and [FlightStrips' TopSky integration](https://github.com/flightstrips/FlightStrips/blob/ee3ea855bc1e8264a7b5bc62541411c1e3e66c70/euroscope-plugin/src/plugin/flightplan/TopSkyHold.h). The parser here is independently implemented for SAAMAN's read-only use.

Only a fresh, moving aircraft with HOLD set at one of ESSA's feeder fixes, within 12 NM of that fix, gets the exception. Geometric fix crossings while it is holding do not mean entry into TMA. Its protected feeder slot remains reserved; ETA-FF uses the current trip back to the fix, and the remaining lose time counts down rather than retaining the original L05 indefinitely. The current feeder prediction does not add the normal capture buffer during that hold.

Removing HOLD restores normal passage detection. Once it enters TMA, line 0 clears under the sequence-only policy. HOLD at an internal approach point, a TSA area, an unrelated fix, stale telemetry or a remote flag far from the feeder does not keep feeder instructions alive. Landed aircraft still clear normally.

Load the new DLL in the sequencer as well as direct/proxy followers. A hold that predates plugin loading can only be recovered if its strip annotation is available; a remote instance without that annotation needs to receive the HOLD update. Live verification should cover assigning HOLD, crossing the feeder in the hold, countdown, XHOLD and inbound exit with both direct and proxy clients.
