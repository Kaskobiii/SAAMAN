# SAAMAN 1.3.26

Explicit direct clearances to a fix on the assigned runway's extended final
continue to use the aircraft performance model when EuroScope marks the old
STAR and runway point as passed. The remaining path follows the cleared fix
and the runway threshold. Unrelated, sideways, outbound, missing or stale
geometry does not create a straight-in route. This applies to all ESSA runways.

An explicit group Recompute can resequence selected Stable and Superstable
aircraft by their refreshed landing estimates. A selected Superstable slot no
longer forces an earlier selected aircraft behind it merely because the old
gap cannot contain the arrival-rate interval. Unselected accepted aircraft and
Frozen order remain protected; routine telemetry does not invoke this rule.

Swaps still exchange slots, but those slots are distinguished from independent
fixed-time assignments. Dragging an aircraft earlier releases removable delay
through the following sequence, stopping at a Frozen aircraft, an independent
fixed time or a flight with no remaining delay. Followers retain order and
cannot be advanced ahead of their current ETA. Rate, wake spacing, inserted
intervals and closures remain enforced. The release is applied once and
survives a shared checkpoint reload.

Includes the 1.3.25 correction that prevents phase promotions from adding
repeated automatic delay.

Validation: 415 model/adapter tests, including recorded SAS66P/SAS77A straight-in
inputs, selected-group Recompute, repeated commands, slot-release boundaries,
all-runway geometry rejection, closures and inserted intervals. Strict
TypeScript checks and x86 native build/context/render checks also passed.

This is a local test build. Live EuroScope verification and GitHub publication
are pending. Load it in all connected instances, including the sequencer and
proxy. No backend update is required. Old swap targets from earlier versions
cannot reliably be distinguished from deliberate fixed times: Recompute the
affected group before testing a new swap and earlier drag.
