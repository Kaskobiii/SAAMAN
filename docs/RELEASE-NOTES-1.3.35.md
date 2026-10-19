# SAAMAN 1.3.35

Download **SAAMAN.dll** directly from the release assets. Unload the old plugin before loading the new DLL. Update every EuroScope instance, including the sequencer and any proxy, and keep SAAMAN above TopSky in the plugin list.

## Display changes

- **Simpler ACC labels:** aircraft type and wake turbulence category are omitted in ACC view. Runway, Flow and ARR-W retain those details. For example, an ACC label no longer includes `A320 M`; its callsign, scheduled minute and delay/gain instruction remain visible.
- **Removed the empty Labels menu.** Clicking the clock beneath a timeline no longer opens a blank window. The clock remains visible.
- **Cleaner current-time line:** the red line remains, with its time and `NOW` text removed.

The user guide has been updated to match. Sequencing, predictions, backend freshness checks and clock handling are unchanged.

## Validation

Windows Release build, Vue/TypeScript checks, all 498 client/model tests and the native context checks passed.
