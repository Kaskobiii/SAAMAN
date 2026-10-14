# SAAMAN 1.3.10

- Runway changes preserve the aircraft's phase and relative sequence position while the EuroScope assignment and shared runway plan arrive at different times. The previous accepted slot remains in place during the mismatch, with a waiting diagnostic.
- Once the new runway is confirmed with usable EuroScope data, AMAN captures fresh timing and replaces the approach once. Aircraft confirming in separate updates retain their relative order. Normal spacing and explicit controller targets still apply; an already-crossed feeder retains its STA-FF.
- Information keeps accepted route names but displays **—** for unavailable crossing times during heading vectors, for skipped or obsolete points, and when a route-point prediction exceeds the airport ETA. It no longer predicts a return through old STAR points.
- Older checkpoints containing an approach for the previous runway are repaired when the new assigned runway is confirmed.
- Landing and feeder buffer values are unchanged. Ordinary direct clearances still do not replace the accepted route or recapture assigned times. The twelve-mile line 0 cutoff is unchanged.

Validated against the runway transition from recording 8, including its existing competing slot. FIN521 is excluded from landing-accuracy conclusions. Regression checks cover both update orders, staggered aircraft confirmation, checkpoint handover, stale observations and cancelled assignments.

Unload the old DLL before replacing it and loading this version. Live EuroScope confirmation is still needed after installation.
