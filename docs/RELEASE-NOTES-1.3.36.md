# SAAMAN 1.3.36 — silent pause protection

Download **SAAMAN.dll** directly from the release assets. Unload the previous DLL before loading this version. Update every EuroScope instance, including the sequencer and proxies, and keep SAAMAN above TopSky in the plugin list.

## Silent timing protection

- Ignore implausible airborne speed drops and sustained stationary radar reports when an accepted timing history exists. Preserve the last credible prediction, assigned sequence and outstanding work, with no new controller indication.
- Confirm resumed movement before accepting timing samples again. Moving holds and genuinely slow aircraft remain valid; stale radar data and landing rollout retain their existing handling.
- Replace a poor initial low-speed capture once sustained movement and a consistent aircraft-profile estimate are available. Manual times, explicit sequence edits, closures and required spacing remain constraints. Established Superstable/Frozen assignments are not automatically recaptured.
- Recompute during a pause uses the retained credible timing; it cannot capture the paused speed. Manual time changes remain usable.
- Preserve the TopSky HOLD flag in recordings so feeder-hold behaviour can be replayed accurately.

For example, a poor initial speed sample could retain an arrival slot several minutes later than the aircraft's credible estimate. The plugin now repairs that initial capture automatically once normal movement is confirmed, preserving the sequence position and required spacing.

## Validation

Windows Release build, Vue/TypeScript checks, all 508 client/model tests and native context checks passed. The regression tests cover recorded initial-capture behaviour, pause/recovery, manual targets, runway closures, moving holds and slow aircraft. Live pause/resume testing in EuroScope has not yet been confirmed.

The LIVE/STALE clock investigation is separate; this release does not change clock handling or freshness thresholds.
