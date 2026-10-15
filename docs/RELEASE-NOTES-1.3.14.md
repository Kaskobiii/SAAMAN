# SAAMAN 1.3.14 — provisional Unstable times

Unstable aircraft no longer acquire artificial delay simply because their forecast improves after capture. Automatic STA and STA-FF now follow the current landing/feeder forecast pair until a later phase protects the assignment.

- New aircraft with earlier predicted landings can still insert ahead. Required arrival-rate/wake spacing, runway closures, controller intervals and manual targets remain enforced.
- The last provisional update is accepted when entering Stable. Existing Stable, Superstable and Frozen protection remains unchanged.
- Stale/unusable telemetry retains the last valid provisional times. Original capture history is preserved without an automatic Recompute.
- The 398-aircraft performance database and landing/feeder predictor are unchanged. No backend update or settings change is required.

Recording 10 reproduced NSZ4052's false eight-minute instruction. At the final sample, the old assigned VACRA time was 18:05:41 against an updated prediction of 17:57:34, displaying 488 seconds to lose with nobody ahead. The corrected replay assigns the current 17:57:34 feeder estimate and shows zero delay. New-arrival regression cases show zero delay with sufficient room and exactly 15 seconds when separation requires it.

Unload the previous DLL before replacing it. The full database remains bundled inside the plugin.
