# SAAMAN 1.3.27

Go-arounds invalidate the previous approach's landing estimate. An obsolete
airport or threshold EET of zero/one minute no longer becomes a new landing
forecast while the aircraft climbs or flies away from the airport. A longer
fallback EET alone cannot clear missed-approach recovery either.

While waiting for a usable new approach, the aircraft is shown in Missed
Approach with “Waiting for approach”. It does not reserve runway capacity or
publish ETA-derived delay/gain instructions. Current landing ETA/STA and route
point forecasts are unavailable in Information. Historical capture values are
retained. Recompute and Refresh delay cannot create new slots or false TTL/TTG
from the old approach. Pre-go-around manual time/order edits are retired.
A controller can still explicitly reserve a new slot; its manual STA is shown
without manufacturing a landing ETA or delay/gain instruction.

A fresh, routed inbound approach or established final restores prediction and
normal sequencing, including genuine rate/wake/closure delay and Frozen status.
Climbing, stale telemetry, arbitrary fallback times or an outbound track do not
establish a new approach. A detected climb out of a known low final also enters
recovery without requiring a TopSky missed-approach flag.
Confirmed runway rollout can finish recovery even when the assigned runway is
still wrong. Physical detection checks the actual runway, including the
departure runway; it retains the existing low-altitude, alignment, vertical
motion and sustained-rollout requirements.

Includes the 1.3.25 phase-promotion correction and 1.3.26 straight-in,
selected-group Recompute and following-slot release changes.

Validation includes the full 34-frame live go-around recording, all three
Refresh spikes, repeated Recompute/Refresh through restored checkpoints, new
approach recovery, ordinary Refresh and genuine post-recovery spacing delay.
All 428 model/adapter tests, strict type checks, x86 build and native
context/window/input checks are run for the local test package.

Live EuroScope verification and GitHub publication are pending. Load the test
DLL in all instances, including the sequencer and proxy. No backend update is
required. If an old version has already forgotten a go-around, mark that
aircraft Missed approach and Resume when ready; a clean new go-around is the
best end-to-end test.
