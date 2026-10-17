# SAAMAN 1.3.23

Partial Recompute uses the remaining aircraft's scheduled allocations when finding a gap for the refreshed group. Previously, it could compare their forecast order but then retain much later assigned slots. Recomputing different groups repeatedly could rotate those groups and accumulate very large artificial delays, even with unchanged aircraft positions and estimates.

Untouched Stable, Superstable and Frozen arrivals form the scheduled anchors. Selected established Superstable/Frozen aircraft keep their protected relative order while refreshing their planning times. The selected movable group is inserted together into feasible scheduled gaps with runway rate, wake spacing, inserted intervals and closures applied. Unaffected manual time targets remain protected. The same handling works after checkpoint restoration.

Recording 18 reproduces the original failure and the corrected allocation. In the corrected replay LOT21A retains a 22:12:58 slot and 168-second instruction instead of being pushed to 23:12:25 with 3,735 seconds. No runway spacing conflicts occur. Dense SweatBox traffic can still receive genuine capacity/sequence delay; the fix prevents additional delay being manufactured by repeated equivalent Recompute commands.

Regression coverage includes the captured partial transitions, repeated and alternating groups with frozen inputs, intervening idle evaluations, full-group Recompute, manual targets, protected order, closures, inserted intervals, legacy checkpoints and distance-profile feeder spacing. Landing/feeder prediction buffers and the backend protocol are unchanged. No backend update is required.

Validation: 387 model/adapter tests, strict Vue/TypeScript checks, the x86 build, native context tests and a fresh SDK rendering/input smoke test passed. Live SweatBox testing confirmed repeated Recompute stays stable when alternating aircraft groups. The release uses the exact tested DLL.
