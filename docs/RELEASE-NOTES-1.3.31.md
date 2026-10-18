# SAAMAN 1.3.31 local test

Fixes a retained upstream sequence inversion illustrated by SAS1491 in
recording 7. The buffered model now participates in automatic reconciliation;
a Stable arrival can pass a persistently later Unstable forecast without
waiting for manual Recompute. It cannot automatically pass another accepted
Stable/Superstable arrival or a controller's explicit ordering/target.
Material inversion must persist for 45 seconds (15 for observed final geometry).
Existing separation, feeder flow, runway closure and inserted intervals remain.

Upstream automatic delay is recalculated against the remaining constraints
when an earlier feasible arrival becomes available. A lone pre-feeder arrival
no longer carries an obsolete automatic minute solely from its previous slot.
Landing/feeder timing is kept paired, avoiding an artificial gain instruction
when that delay is released. Manual targets and entered TMA assignments remain
protected. A partial controller Recompute keeps nonselected anchors intact;
ordinary subsequent telemetry can release upstream automatic slack.

In the supplied state SAS1491 can move ahead of BEL19R automatically. It may
still have genuine spacing delay behind the accepted SAS1582 sequence; this
fix does not promise zero delay irrespective of the other traffic.

449 model/adapter tests cover recorded inversion, transient inversion, a lone
upstream minute, manual/closure constraints, accepted TMA history and the
existing reconnect, go-around and partial-Recompute regressions. Strict
TypeScript/Vue, x86 build and native context/window checks validate the package.
Live verification and GitHub publication are pending. Load in all instances,
including sequencer and proxy. No backend update is required.
