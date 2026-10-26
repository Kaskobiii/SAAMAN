# SAAMAN 1.3.39 — local test build

## Earlier estimates release unused capacity

Automatic Stable aircraft can now use a coherent earlier feeder/landing estimate when there is space in the existing sequence. This also brings following Stable aircraft forward, retaining the spacing they actually need.

Example: an aircraft previously kept L08 even though the aircraft ahead was many minutes away. It now loses that artificial delay; a genuinely constrained follower still keeps the required runway and feeder interval.

Manual times, controller order, personal intervals, HOLD, paused aircraft, runway gaps and closures remain protected. Planned rate changes use the rate applicable at the new landing time.

## Lose instructions count down as work is absorbed

A Superstable aircraft's accepted sequence times remain protected, but a credible later feeder estimate can reduce an existing lose instruction as it flies vectors or slows down.

Example: L03 can become L02 and then L00 without Recompute. A change in the timing model or near-feeder buffer alone does not create a new lose instruction. Real added spacing still applies.

## Missing feeder information

A placeholder ETA for an unidentified or unavailable feeder no longer creates a new ACC/line-0 instruction. Real runway demand and assigned sequence times are retained. Previously accepted feeder guidance can survive a temporary route-data interruption.

## Manually selected arrival routes

The aircraft menu's Arrival route selection now works in the default shared timing mode. An explicitly selected workbook route supplies feeder and landing predictions from fresh position and aircraft-performance data, including when that feeder is absent from the filed route or the raw destination estimate is unusable.

Example: selecting the appropriate VACRA arrival can put the aircraft into the Runway sequence without editing its EuroScope flightplan. Clearing the selection returns to automatic planning. Existing Removed, Desequenced and Missed approach states still require their normal controller action.

## Validation

All 611 client/model tests, UI type checks, guide export checks and the Windows Release build pass. Native context checks pass. Mounted interface checks verify the arrival-route menu, guidance visibility and existing highlight/Information/notice behavior.

## Load the test

Unload the old DLL, then load this test DLL in every connected EuroScope instance, including the sequencer and proxies. Keep SAAMAN above TopSky in the plugin list.

This build has not been published to GitHub. The reported live session had no recording, so these are fixes for reproduced defects rather than a claim that every delay in the screenshot was artificial. Runway demand above the configured rate still produces delay.
