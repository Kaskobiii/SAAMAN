# SAAMAN 1.3.29 local test

Brief input interruptions preserve accepted phase and sequence position for up to
two minutes, without displaying or publishing the absent aircraft. Identity,
source and simulation changes do not inherit that hidden history.

ESSB-ESSA arrivals with no feeder fix use the selected arrival runway and a
position-based approach estimate. Recompute accepts their TMA phase immediately
and can insert them ahead of later arrivals when separation permits. It does
not invent feeder guidance or force distant traffic Superstable.

An observed straight-in track between 4 and 15 NM, aligned within 15 degrees
and 0.25 NM of the centreline, below 4500 ft and not climbing, can replace a
stale full-STAR estimate after ten seconds. Established short final remains
position-based. Longer vectors and unobserved clearances remain uncertain.

Recovery continues through low final and runway rollout. A new landing after
a go-around receives its own timestamp rather than reusing the first landing.
Continuous rollout no longer loses confirmation at each descending position
update. At 40 kt or less, a low runway-aligned aircraft with prior approach or
recovery history is marked landed immediately; this does not classify a slow
new departure as landed. A confirmed stopped landing cannot be undone by a
subsequent noisy climb sample.

443 model/adapter tests cover recording 6's SAS57F interruption, SAS123 local
arrival and second landing, stale STAR straight-in detection and the 40 kt
rule. Strict TypeScript/Vue and native context/window checks are included in
the package validation. Live testing and publication are pending.

Load in every EuroScope instance, including sequencer and proxy. No backend
update is required. Keep SAAMAN above TopSky.
