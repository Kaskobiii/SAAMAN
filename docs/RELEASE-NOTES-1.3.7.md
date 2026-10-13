# SAAMAN 1.3.7

- Landing ETA uses a larger configurable buffer at higher groundspeed: normally 2 minutes up to 300 kt, 6 minutes at 450 kt and about 7:20 at 500 kt, capped at 15 minutes. The slow Superstable/Frozen base remains 1 minute.
- The extra speed compensation applies only to landing. Feeder ETA retains the normal 2-minute/near-fix 1-minute buffer.
- Groundspeed is captured on first usable observation or explicit Recompute. Direct clearances, live speed changes and upgrading do not change accepted STA. Existing baselines are preserved until Recompute.
- Supervision includes the high-speed buffer setting and the groundspeed used at capture.
- Recording 7 regression checks cover SAS1AB/RYR5W recomputation and the existing line 0 cutoff. Line 0 still clears 12 NM after the feeder; the information delay remains available.

Validation includes the recording replay, model/adapter tests, real vatIRIS router compatibility checks, UI checks, x86 build and native tests. This recording is a calibration example, not a guarantee of landing accuracy for every flight.

Unload the old DLL before replacing it and loading this version.
