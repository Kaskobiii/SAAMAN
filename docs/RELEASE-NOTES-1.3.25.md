# SAAMAN 1.3.25

Aircraft retain their accepted sequence position when they become Stable or
Superstable. Ordinary telemetry updates no longer reinsert an existing aircraft
by comparing its forecast with other aircraft's later assigned landing times.
That comparison could move it forward while retaining its old slot and push
followers back repeatedly, leaving unused intervals in a dense sequence.

This fixes the phase-promotion jumps in the 18 October Peak recording, where
NOZ8124's assigned landing time moved from 10:37:03 to 10:48:15 without a new
controller action, arrival or closure. With the fix, it remains at 10:37:03
through those transitions. Congestion delay remains when traffic exceeds the
configured arrival rate.

Unstable traffic can still change provisional position within the existing
sequence rules. Newly arriving flights, explicit controller moves, manual times,
partial/full Recompute, closures and wake spacing continue to use their existing
allocation rules. A nonselected accepted flight also retains its position if it
changes phase while another aircraft is being recomputed.

Validation for this test build: four regression cases from the recording and
partial-Recompute variation, the complete model/adapter suite, strict TypeScript
checks, an x86 build and native context checks. The recording replay keeps all
24,075 tested planned spacing intervals at or above the rate/wake minimum.
The recording retains the original controller checkpoints; replay results do
not imply that SweatBox flies the assigned delays. Live EuroScope verification
is pending. No backend update is required.
