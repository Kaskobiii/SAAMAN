# SAAMAN 1.3.11

- Landing ETA uses the assigned runway threshold rather than the later airport route endpoint. Remaining route distance and expected slowing down replace the old speed-only landing buffer.
- Established short final uses position and current groundspeed without a fixed one-minute floor. An established airborne flight continues updating ETA below 350 ft until landing detection.
- Heading vectors retain a recent model-derived slowdown correction on the same runway instead of dropping it immediately. Retention expires after ten minutes and does not predict an unknown turn, holding release or runway change.
- Existing accepted STA, STA-FF, order, holding instructions and the 2-minute/1-minute feeder allowances remain protected. Initial capture, Recompute and confirmed runway changes capture new planning time. An upgrade alone does not revise existing assigned slots.
- Supervision shows the prediction source/reference and correction. Its former high-speed setting is now an extra landing correction limit, retaining the same backend key and default value of six minutes. The route correction ceiling is phase allowance plus this value, capped at fifteen minutes; it is not an automatic six-minute addition at 450 kt.

Replay of six completed arrivals in recordings 7-9 gives a one-minute-horizon mean absolute threshold error of 2.5 seconds, compared with 58.7 seconds for 1.3.10. Earlier predictions are mixed and some regress; unknown vectors, departure acceleration and future runway reassignment remain limitations. These recordings helped develop the model, so this is not independent validation. See the [complete results and limitations](LANDING-ETA-REPLAY-1.3.11.md).

Runway transition handling, accepted route retention, the twelve-mile line 0 cutoff and the drag-trail correction remain in place. The vatIRIS API is unchanged; no backend deployment is needed.

Unload the old DLL before replacing and loading this version. The active sequencer should run the new version to publish its predictions. Live EuroScope confirmation and additional recordings are needed after installation.
