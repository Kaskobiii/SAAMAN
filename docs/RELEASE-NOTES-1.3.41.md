# SAAMAN 1.3.41 - local test build

## Tracking recovery
After a short tracking interruption, an inconsistent recovery speed is checked against fresh movement before it replaces credible timing. The latest credible landing and feeder forecasts are retained during this brief check. Raw reported speed stays available in supervision and recordings. Qualification is bounded to 20 seconds and can finish sooner when consistent movement is confirmed.

Example: a cruise aircraft briefly reporting 400 -> 150 -> 440 kt after tracking resumes no longer receives a seven-minute forecast change from the first recovery sample. Existing checks for normal traffic, slower aircraft, climb, short final and HOLD countdowns remain covered.

## Current slot evidence
Supervision shows the current runway rate/wake and predecessor, feeder spacing, runway gap/closure, manual time/order, or retained assignment behind a selected slot. Slot history includes that evidence. The fields describe current constraints and controller intent rather than an additive delay breakdown.

## Recording continuity
Recordings retain publisher/version, server-confirmed sequencer information where available, counter generations, stale/recovery transitions and meaningful slot changes. Routine polling and small drift are deduplicated; changes to a binding rate/wake interval remain visible.

A verified same-room handover can continue in one recording. Different rooms and unknown source changes still stop it. Supervision accepts recovered counters while rejecting ordinary stale replies. The recording buffer survives a temporary loss of supervision access, with Stop and Export still available. New bounded diagnostic data shares the existing recording limits.

## Live timing scorecards
`npm run review:live -- "C:/path/to/recording.json"` scores recorded forecasts against geometric feeder and runway-threshold passages. It separates initial captures, Recomputes and recaptures by feeder/runway/method/horizon, using one capture per aircraft per group. SweatBox, mixed simulation and duplicate files are excluded. Route changes and missing original inputs are flagged outside clean calibration.

## Validation
724 client/model tests and 9 local vatIRIS-router compatibility checks pass, together with UI type checks, mounted interface checks and the Windows Release build. Replaying 13 distinct live recordings covers 7,882 calculated updates, 62,809 runway interval checks and 34,141 feeder interval checks, with no spacing violations or new TMA phase regressions. Performance-model constants were not retuned from mixed-route observations.

## Load the test
Unload the previous DLL and load this version in all connected EuroScope instances, including the sequencer and proxies. Keep SAAMAN above TopSky.

This local test build has not been published to GitHub.
