# SAAMAN 1.3.32 local test

Feeder crossing slots now have their own spacing constraint in the buffer
model as well as the distance model. NILUG/ELTOK/XILAN/VACRA are shared entry
resources across runway banks. Landing order and feeder order may differ when
approach lengths differ; only overlapping entry slots are delayed. Closure
and controller-inserted intervals remain constraints. Deliberate fixed feeder
slots are booked before inserting automatic arrivals around them.

Click/drag swaps exchange sequence positions and refresh the selected pair's
feasible schedule; they no longer copy the other aircraft's historical STA.
A slower aircraft deliberately put first can still create genuine work for
its follower. Accepted phases are preserved during a sequence swap.
Independent explicit time targets remain attached to their own
aircraft. An inherited legacy swap time is retired once, with checkpoint
restoration preserving the repaired state.

Queue renumbering now distinguishes deliberate order changes from incidental
ranks on untouched aircraft. Moving one aircraft does not make the entire
Unstable queue permanently manual. Legacy broad drag groups are recognised
where an explicit time target identifies the selected aircraft. A target
migration alone does not disable another group's Recompute allocation.

Validation: 475 model/adapter tests, including recording 11's NILUG overlap,
SAS46R/SAS2091 swap-back, SAS3FF/RYR174C feasible swap, repeated swaps, all 16
recorded Recompute edit groups repeated with unchanged traffic, legacy target
repair, checkpoint restoration and secondary-runway feeder sharing. Older
partial-Recompute tests allow a one-time mandatory feeder-spacing repair;
repeated clicks still cannot ratchet the queue.

The complete recording 11 input/command replay checks 2,195 frames, 13,274
feeder neighbour pairs and 23,584 runway neighbour pairs: zero spacing
violations. This replay recalculates from inputs and recorded edits instead
of importing old-build control snapshots. It validates the resulting schedule,
not a promise of exact real-world landing forecasts or zero genuine delay.

Strict TypeScript/Vue checks, x86 build and native window/input tests validate
the test package. Live verification and GitHub publication are pending.
Load in all EuroScope instances, including sequencer and proxy. Keep SAAMAN
above TopSky. No backend update is required.
