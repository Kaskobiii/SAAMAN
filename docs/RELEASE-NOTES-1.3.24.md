# SAAMAN 1.3.24

Recompute now retains an established Stable or Superstable phase when a direct bypasses the feeder fix. For example, XILAN → direct TEB still updates the landing estimate without resetting the aircraft to Unstable because XILAN no longer has a crossing estimate.

This also covers repeated Recompute and a subsequent heading that removes the bypassed feeder from the route. It does not count a bypass as observed feeder passage or promote distant Unstable traffic. Landing prediction and buffer settings are unchanged. No backend update is required.

Line 0 feeder guidance is now cleared when a confirmed bypass makes the feeder crossing estimate unavailable. That decision survives a subsequent heading or Recompute. A usable crossing estimate or an explicit feeder-time override can restore guidance; a temporary route-data outage alone does not mark the feeder bypassed.

The local TopSky feed now omits obsolete feeder entries instead of sending a numeric zero that TopSky can display as G00. This also clears guidance at the existing post-feeder cutoff and after landing. AMAN and the backend retain the complete aircraft sequence, assigned times and internal delay; other aircraft's guidance remains available.

Corrected SweatBox exercises are included for 01R, 26 and 19L, using the supplied example's initial positions, FL180-FL360 altitudes, 280/290 initial speed fields and simple descent/intercept routes. These replace the earlier ESSA_Realistic files. FL100 is the feeder target, not the spawn altitude. See scenarios/README.md and the separately downloadable v2 exercise pack.

Validation: 394 model and adapter tests, strict Vue/TypeScript checks, the x86 build, native context tests and a fresh SDK rendering/input smoke test passed. The release DLL is identical to 1.3.24-test2. Live confirmation of the two fixes is still pending; publication was requested before that test. The revised SweatBox files passed format/sector checks but have not yet been loaded in a live simulator. The transient NOZ4LP delay remains unexplained and is not claimed as fixed.
