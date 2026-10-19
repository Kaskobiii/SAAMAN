# SAAMAN 1.3.37 — closer sequences after runway gaps

Download **SAAMAN.dll** directly from the release assets. Unload the previous DLL before loading this version. Update every EuroScope instance, including the sequencer and proxies, and keep SAAMAN above TopSky in the plugin list.

## Compact runway sequences after a GAP

Aircraft delayed by a runway GAP or closure now receive a coordinated feeder-to-runway delivery plan. Compatible arrivals can follow each other at the configured runway spacing after reopening. The plan accounts for aircraft performance, assigned speeds, route length and wind.

For example, two compatible arrivals on the same route previously received approximately 3:18 between their landing slots after a GAP, even though their feeder slots were only 1:36 apart. The replay now assigns 1:36 at the runway and approximately 1:41 at NILUG, while respecting the configured rate and wake spacing.

Different routes, slower aircraft, assigned speeds, wake categories or manual constraints can still require more spacing. Manual sequence changes and explicit time targets remain authoritative. Removing or shortening the GAP releases its temporary delivery plan when it no longer blocks the arrivals.

GAP and closure boxes remain in Runway view. FLOW and ACC/ARR-W display the resulting aircraft sequence without projected closure boxes.

## Validation

Windows Release build, Vue/TypeScript checks, all 517 client/model tests and native context checks passed. Regression coverage includes recorded GAP compression, feeder and wake spacing, slow aircraft, assigned speeds, wind, route differences, manual targets, GAP removal and repeated checkpoint restoration. Live EuroScope validation of the new GAP delivery plan has not yet been confirmed.
