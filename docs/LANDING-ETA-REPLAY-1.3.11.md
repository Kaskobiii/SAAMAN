# Landing ETA replay review, SAAMAN 1.3.11

Recordings 7, 8 and 9 were replayed through the actual 1.3.10 engine and the new engine with independent histories, the same telemetry and the same recorded edits. FIN521 is excluded as requested. Six arrivals have observable threshold crossings; KLM740 in recording 9 has no completed arrival to score. Existing accepted captures are retained, so these are live ETA comparisons rather than rewritten STA accuracy claims.

Truth is interpolated runway-threshold crossing from consecutive aligned position samples, adjusted for position age. This is a proxy from recorded telemetry, not independently measured touchdown. Recorded landed status occurs later. Each horizon uses the last observation at or before the requested horizon, within 15 seconds. Positive error means late; negative means early.

| Recording / aircraft | Minutes before threshold | 1.3.10 error (s) | 1.3.11 error (s) | New source |
|---|---:|---:|---:|---|
| 7 / RYR5W | 15 | +132 | +89 | fallback |
| 7 / RYR5W | 10 | +60 | +28 | fallback |
| 7 / RYR5W | 5 | -1 | -47 | route-slowdown |
| 7 / RYR5W | 3 | -2 | -23 | route-slowdown |
| 7 / RYR5W | 1 | +58 | +2 | final-position |
| 7 / SAS1AB | 20 | +83 | -22 | route-slowdown |
| 7 / SAS1AB | 15 | +79 | -65 | route-slowdown |
| 7 / SAS1AB | 10 | -61 | +19 | retained-slowdown |
| 7 / SAS1AB | 5 | -61 | -76 | retained-slowdown |
| 7 / SAS1AB | 3 | -1 | -29 | route-slowdown |
| 7 / SAS1AB | 1 | +59 | +4 | final-position |
| 7 / FIN76I | 10 | -62 | -92 | fallback |
| 7 / FIN76I | 5 | -2 | -25 | route-slowdown |
| 7 / FIN76I | 3 | -2 | -2 | route-slowdown |
| 7 / FIN76I | 1 | +58 | +3 | final-position |
| 8 / LGL5781 | 20 | +601 | +441 | route-slowdown |
| 8 / LGL5781 | 15 | +561 | +440 | route-slowdown |
| 8 / LGL5781 | 10 | +502 | +527 | retained-slowdown |
| 8 / LGL5781 | 5 | +659 | +652 | route-slowdown |
| 8 / LGL5781 | 3 | +59 | -17 | route-slowdown |
| 8 / LGL5781 | 1 | +59 | +4 | final-position |
| 8 / BT222 | 20 | -115 | -215 | route-slowdown |
| 8 / BT222 | 15 | -180 | -210 | fallback |
| 8 / BT222 | 10 | -182 | -212 | fallback |
| 8 / BT222 | 5 | -61 | -53 | route-slowdown |
| 8 / BT222 | 3 | -1 | -3 | route-slowdown |
| 8 / BT222 | 1 | +59 | -1 | final-position |
| 9 / EWG89H | 10 | +116 | +28 | route-slowdown |
| 9 / EWG89H | 5 | -1 | -4 | route-slowdown |
| 9 / EWG89H | 3 | +59 | -15 | route-slowdown |
| 9 / EWG89H | 1 | +59 | -1 | final-position |

| Sample set | Observations | Old mean absolute error | New mean absolute error |
|---|---:|---:|---:|
| All listed horizons | 31 | 128.9 s | 108.0 s |
| 5, 3 and 1 minute horizons | 18 | 70.1 s | 53.4 s |
| 1 minute horizon | 6 | 58.7 s | 2.5 s |

## What this establishes

The old airport endpoint, minimum late-stage buffer and low-altitude ETA freeze caused avoidable errors. Removing them improves short-final accuracy in these six arrivals. Recording 9 EWG89H starts with a live forecast roughly 56 seconds late instead of 217 seconds late; the existing assigned STA is deliberately not recaptured. At 10/5/3/1 minutes before threshold, new errors are +28/-4/-15/-1 seconds.

## What remains unresolved

Earlier results are mixed. BT222 at 20 minutes is 215 seconds early versus 115 seconds early previously, and at first observed departure the new forecast is about 262 seconds late versus 38 seconds early. The nominal profile does not anticipate departure acceleration or future vectoring. FIN76I at 10 minutes remains 92 seconds early versus 62 seconds early; it had no usable prior route model to retain. SAS1AB improves at ten minutes through retained slowdown, but is still 76 seconds early at five minutes versus 61 seconds early previously. Continuity prevents a correction disappearing solely because a vector begins; it cannot establish the unknown return path.

LGL5781 retains the old runway approach before its recorded late runway reassignment, so several horizons have very large errors against the eventual arrival. The five-minute observation precedes that reassignment and is not evidence of accuracy on the subsequently cleared route. It remains in the aggregate to avoid hiding the limitation.

This is a small development sample used to inform the change, not independent validation. The speed profile is empirical and not aircraft-specific; no universal accuracy claim is justified. Fresh live recordings and separate arrivals are required to test generalisation. Better earlier predictions need expected path/holding release, aircraft-dependent speed evolution and weather information, plus validation against completed arrivals. Accepted STA/STA-FF, sequence and retained instructions remain protected while that work continues.
