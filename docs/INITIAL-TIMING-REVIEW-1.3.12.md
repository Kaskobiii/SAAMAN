# Initial timing review: 1.3.12 preview

**Promotion decision: keep the new route-profile model in comparison only. Active timing remains 1.3.11.**

Eight historical recordings (1, 2, 4, 5, 6, 7, 8, 9) were reviewed with FIN521 excluded as requested. The candidate was developed with these recordings; they are not independent validation. Comparisons use first available airborne input where exact capture evidence is absent. They must not be described as a validation of original initial capture accuracy.

| Matched observations | Count | Current mean absolute error | Candidate mean absolute error |
|---|---:|---:|---:|
| Feeder crossing | 24 | 65.9 s | 47.2 s |
| Threshold crossing | 27 | 126.3 s | 139.0 s |

Exact initial capture pairs with the new evidence markers: **0**. New recordings are needed for this primary check.

The locally extracted 398-aircraft EUROCONTROL speed/altitude dataset was also tested with `--profiles`. On its matched subset, feeder error is 51.7 seconds versus 63.1 seconds currently (27 pairs), and landing error is 127.5 seconds versus 123.9 seconds (30 pairs). Coverage differs from the built-in reference comparison above. This variant also fails the promotion check; it is not installed as the active predictor. Seven implausible initial-descent values labelled as Mach and one implausible minimum clean IAS are retained in the local dataset with no usable numeric value. The complete local extraction is separate from the source/release package; no redistribution permission is implied.

Feeder references interpolate position pairs passing within 0.3 NM of the fix. Threshold references interpolate aligned crossings of the threshold plane below 1000 ft. Position age is deducted. These are telemetry proxies, not independently measured crossing/touchdown times. Later vectors and runway changes remain in the results and are annotated in the JSON report; actual arrival times do not establish an uninterrupted-route prediction error. Missing candidate geometry/types are excluded from matched aggregates rather than silently replaced by the current predictor.

## Landing comparisons

All errors below are seconds; positive means late. “Unavailable” means the candidate declines to predict from the available input. These are development comparisons of available input, not proofs of original capture accuracy.

| Recording | Aircraft | Current error | Candidate error | Recorded heading samples | Runways |
|---|---|---:|---:|---:|---|
| 1 | SAS28 | +6 | -61 | 0 | 19L |
| 1 | NAX41G | +54 | +14 | 0 | 19L |
| 1 | LOT21A | -56 | -56 | 0 | 19L |
| 1 | SAS1412 | -84 | -133 | 0 | 19L |
| 1 | EZY21MB | -61 | -143 | 0 | 19L |
| 1 | NAX8GH | -20 | Unavailable | 0 | 19L |
| 1 | SAS001 | +73 | +3 | 0 | 19L |
| 1 | BTI8KM | -40 | +64 | 0 | 19L |
| 1 | SAS2472 | -5 | -64 | 0 | 19L |
| 1 | NAX26T | +8 | -69 | 0 | 19L |
| 1 | UAE143 | -176 | Unavailable | 0 | 19L |
| 1 | FIN1NX | -17 | -2 | 0 | 19L |
| 2 | DLH2WR | +155 | +189 | 76 | 01R |
| 2 | SAS1530 | +274 | +203 | 221 | 01R |
| 2 | DLH2GY | +191 | +158 | 116 | 01R |
| 2 | HUN79Z | +341 | +344 | 0 | 01R |
| 2 | WZZ12M | +377 | Unavailable | 0 | 01R |
| 2 | WZZ37KJ | -37 | Unavailable | 0 | 01R |
| 2 | EZY463 | +315 | +217 | 170 | 01R |
| 2 | ICE307 | -112 | Unavailable | 226 | 01R |
| 2 | IAM1KA | +328 | +268 | 52 | 01R |
| 2 | RYR4HR | -339 | Unavailable | 301 | 01R |
| 2 | GFM6Y | +21 | -12 | 203 | 01R |
| 2 | FIN5LA | -259 | Unavailable | 496 | 01R |
| 4 | DLH858 | +466 | Unavailable | 0 | 01R |
| 4 | SAS2616 | +126 | Unavailable | 82 | 01R |
| 5 | BAW776F | -50 | Unavailable | 44 | 01R |
| 5 | TKJ7FK | +180 | +85 | 1 | 01R |
| 5 | DLH1A | -6 | +75 | 0 | 01R |
| 6 | FIN928 | -108 | -166 | 0 | 01R |
| 6 | FIN5LA | -16 | -58 | 0 | 01R |
| 6 | DLH3PC | +232 | +262 | 0 | 01R |
| 6 | SAS1049 | -250 | -185 | 0 | 01R |
| 7 | RYR5W | +88 | +189 | 306 | 19R |
| 7 | SAS1AB | -30 | -142 | 395 | 19R |
| 7 | FIN76I | +308 | Unavailable | 211 | 19R |
| 8 | LGL5781 | +416 | +509 | 103 | 19L, 01R |
| 8 | BT222 | +262 | Unavailable | 520 | 19L, 01R |
| 9 | EWG89H | +56 | +78 | 0 | 19R |

## Next controlled test

1. Load the preview and open supervision. Start recording before a new arrival first appears in AMAN.
2. Keep recording through feeder passage and threshold crossing. Note any speed instructions, vectors, holding or runway changes; radio-only interventions cannot be inferred reliably from the recording.
3. Export the recording. Initial captures include their exact input frame/configuration; existing captures from before recording are explicitly unavailable. Recompute captures are indexed separately and are not passed off as initial captures.
4. Compare both predictions at the same capture input. Evaluate feeder and landing separately, retaining all results and intervention annotations. Use additional untouched arrivals for validation before promoting a new timing model.

The nominal profiles are still imperfect. The new two-part calculation and exact capture evidence make those errors measurable; this preview is not a claim that initial landing accuracy is solved.
