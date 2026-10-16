# SAAMAN 1.3.22

An individual arrival can use any supported runway, including a departure-only or inactive runway. This works when the aircraft first appears, when EuroScope reassigns it, after a reload and through AMAN's Change runway menu. The required timeline column appears without changing the shared arrival/departure configuration. Previously a first-seen inactive-runway arrival could be rejected, and a reassignment could remain in the old column waiting for the main runway plan to change.

The change refreshes the accepted landing estimate and retained approach once usable telemetry arrives, keeps an already-crossed feeder time, and survives checkpoint restoration. Unsupported runway identifiers and stale observations retain their checks. A bank configuration that changes before the aircraft's SDK assignment still preserves its accepted queue until usable data arrives; a fresh individual assignment does not need the bank to follow it.

Using AMAN's Change runway also preserves the aircraft's established phase while recalculating its slot, rather than demoting a Stable or Superstable aircraft to Unstable when the new feeder estimate is farther away.

Recompute resolves the current phase immediately after a reconnect. A usable post-feeder aircraft no longer waits for the new-flight settling timer before becoming Superstable/Frozen. Distant traffic still uses the normal phase boundaries.

Feeder identity and the line-0 cutoff are remembered for up to five minutes across a disconnect. This preserves ELTOK cutoff handling when the reconnected route contains only approach points. The memory contains no assigned times or delay values, expires, and is scoped to the same flight. MAESTRO reports a physically passed feeder with a negative remaining time and sends the same whole-minute instruction shown by AMAN; full seconds remain in the engine and Information window.

Information sizes itself to the full table independently of the AMAN pane. If the table exceeds the available radar width, its content fits within that width without a horizontal scrollbar. Zoom and reopening retain the fitted frame.

Coordination notifications appear in the direct EuroScope instance rather than its proxy duplicate. Acknowledge hides the popup immediately while confirmation is pending; failed acknowledgements remain retryable.

After a recent direct clearance followed by an assigned heading, landing prediction uses the aircraft's fresh position, actual heading and a turn/intercept path to the configured final. It does not recompute along STAR points restored by EuroScope. The path uses the aircraft performance profile when available and remains an estimate of the approach geometry, not a prediction of future controller vectors. Ordinary heading fallbacks, stale positions and expired clearance evidence retain their checks.

EuroScope route, approach and sector text is converted from its Windows encoding to UTF-8 before it enters AMAN's data messages. Existing UTF-8 is preserved, and length limits no longer split a multibyte character. This addresses the invalid-UTF-8 error reported after selecting the RNP X 19R approach; a single non-ASCII SDK string could previously block telemetry delivery.

Validation: 377 model/adapter tests pass, including inactive runway assignments, post-feeder reconnect/Recompute, cutoff recovery, display rounding and a direct-ERXEC/heading/restored-STAR scenario. Native tests cover encoding conversion, supported runway choices/column visibility, Information fitting, coordination acknowledgement and proxy suppression. RNP text is checked across all six supported ESSA runway directions. Live testing in the sequencer and proxy instances confirmed all reported fixes, including direct ERXEC → heading → Recompute. No backend update is required.
