# SAAMAN 1.3.12 preview — initial timing comparison

This preview prepares a controlled test of initial feeder and landing predictions. **Active timing remains the 1.3.11 predictor.** The new candidate has not passed the landing-accuracy promotion check.

- A separate route-profile candidate calculates aircraft-to-feeder and feeder-to-threshold time. It uses observed groundspeed, altitude, assigned speed and aircraft performance, with distinct descent, approach and landing phases. The A20N and HondaJet references supplied by the user are included as selected numerical reference values alongside the existing EuroScope profiles.
- Supervision shows the candidate explicitly as not scheduled. It cannot change ETA, STA, STA-FF, sequence or gain/lose instructions and is not sent to the backend.
- Recordings index exact initial, Recompute and other capture events to their original telemetry frame and shared plan. Captures made before recording are marked unavailable. The recording remains opt-in and bounded; older format-1 recordings remain readable.
- A replay command compares exact captures separately from first available inputs, with feeder/threshold crossing proxies and recorded intervention flags.

On historical matched inputs, feeder mean absolute error improves from 65.9 to 47.2 seconds (24 pairs), while landing error worsens from 126.3 to 139.0 seconds (27 pairs). These are development samples and include later control changes. There are no pairs with the new exact initial-capture markers yet. See [complete results and the controlled test](INITIAL-TIMING-REVIEW-1.3.12.md).

Stable release 1.3.11 remains the default recommendation. Use this preview when recording the next timing test. Unload the old DLL before loading it. No backend deployment or controller configuration changes are needed.
