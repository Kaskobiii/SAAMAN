# SAAMAN 1.3.42 traffic-mode accuracy check

This comparison isolates automatic traffic modes ON versus OFF in the same 1.3.42 engine. It measures fresh, available, unallocated landing forecasts against later observed runway-threshold passages. Assigned slots and old captured ETAs are not used as forecast values. Positive timing error means the forecast was later than the crossing.

## Evidence

Two retained complete live recordings from 25 October provide three threshold passages from a quiet session. Retained raw-coordinate review rows from the busy 18 October sessions provide another 34 passages, all independently re-derived and matching the older scorecard timestamps. The busy comparison uses 43 unique preserved telemetry/config/edit/state checkpoints, not a continuous replay of the missing original busy recording files.

There are 2,428 eligible matched forecast pairs before sampling. To avoid weighting repeatedly recomputed aircraft more heavily, summaries use the earliest eligible observation for each aircraft and actual remaining-time band: 0-5, 5-15, 15-30 or 30+ minutes. Forecasts that are unavailable, retained through a timing quarantine/motion hold, missed/removed/lost, or assigned a different runway from the crossing are excluded. Historical controller edits and previous state are identical between each pair. Same-timestamp independent cases move only the previous snapshot header back 1 ms.

## Results are mixed

Across the 61 selected mode-affected observations from 32 aircraft, 34 absolute errors improved, 25 worsened and two stayed within one second of their earlier error. The median paired change was a five-second improvement; mean absolute error changed from 180.8 to 183.4 seconds. The cohort median absolute error changed from 175.1 to 190.8 seconds. These different measures do not establish an overall accuracy improvement.

| Applied assumption | Selected observations / aircraft | Median absolute error OFF / ON | Median paired absolute-error change |
| --- | --- | --- | --- |
| Low | 27 / 16 | 192.4 / 83.3 seconds | 14.4 seconds better |
| Medium | 32 / 23 | 229.5 / 200.6 seconds | 5.0 seconds better |
| High | 24 / 17 | 155.1 / 204.1 seconds | 89.8 seconds worse |

The mode-specific rows are sampled independently; an aircraft can occur in different modes or remaining-time bands, so the rows must not be added together as independent flights. The High assumption is not validated as more accurate by this sample.

Among 27 matched busy-session observations 15-30 minutes before crossing, cohort median absolute error changed from 227.6 to 191.0 seconds; median paired improvement was 5.8 seconds and mean paired improvement was 28.7 seconds. This is a conditional checkpoint result, not a measure of initial-capture accuracy.

## Limits

The observed endpoint is a geometric runway-threshold crossing, not independently confirmed touchdown. Later direct routing, vectors, runway changes and tracking changes are flagged rather than silently described as clean performance calibration. Busy cached tracks do not retain TopSky HOLD flags, so later holding cannot be fully identified. Only seven earliest busy checkpoint observations avoid the tracked later-clearance, tracking and manual-target confounds, and all are inside five minutes. Consequently these sessions do not provide a clean early-flight calibration cohort for all three modes.

The comparison assumes pilots repeat their recorded tracks even when the calculated assignments differ. It does not show how controllers would react to new timings, and it cannot prove every traffic mode improves forecasts. The 4 NM High downwind extension remains the agreed configurable starting assumption; constants were not retuned from these confounded outcomes.

## Other validation

763 automated client/model tests, nine local vatIRIS compatibility tests, UI type checks, mounted interface checks, guide exports and Windows Release/native context checks passed. The retained replay/checkpoint invariant audit covers 1,231 updates, 2,703 runway interval checks and 639 feeder interval checks, with no detected spacing violations or new TMA phase regressions.
