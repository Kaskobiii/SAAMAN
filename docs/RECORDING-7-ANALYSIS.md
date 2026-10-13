# Recording 7: SAS1AB and RYR5W

The recording contains 780 frames from 20:38:40 to 21:04:59 UTC, using SAAMAN 1.3.6. At the last group Recompute around 20:39:08, SAS1AB was at 499 kt and approximately FL349, while RYR5W was at 324 kt and approximately FL171.

| SAS1AB time | Recorded 1.3.6 estimate | 1.3.7 counterfactual ETA | Recorded passage/detection |
| --- | --- | --- | --- |
| ELTOK | 20:51:08 | 20:51:08 | approximately 20:51:14 |
| Landing | 20:59:08 | 21:04:26 | 21:03:53 |

EuroScope's raw landing estimate at Recompute was 20:57:08. The original fixed two-minute buffer left the landing estimate 4:45 early. With the chosen speed rule, 499 kt gives 7:18 of landing buffer, putting ETA 33 seconds after the recorded landing detection. The feeder retains its two-minute buffer; applying the whole high-speed buffer there would have made that estimate about five minutes too late.

The original assigned landing times were RYR5W 21:01:08 and SAS1AB 21:02:44, a 1:36 gap. Their recorded landing detections were 20:58:15 and 21:03:53, a 5:38 gap. Replaying the edited plans with the new speed rule produces a larger assigned gap, about 3:12: RYR5W 21:01:46 and SAS1AB 21:04:58. Assigned STA also includes existing sequence constraints, so it should not be confused with ETA. The buffer improves SAS1AB's prediction; it does not explain all of RYR5W's earlier arrival or guarantee the observed gap. Accepted route/time retention is still deliberate: direct clearances do not recapture an estimate.

SAS1AB's line 0 instruction remains 102 seconds until the existing feeder cutoff. Replay detects feeder passage around 20:51:14 and clears line 0 around 20:53:51, at approximately 12.35 NM after ELTOK. The exported MAESTRO instruction is zero from that cutoff, while the information delay remains 102 seconds. The user subsequently confirmed that this disappearance probably occurred. No cutoff change is included.

These are recorded proximity/surface detections, not independent measurements of exact fix crossing or touchdown. This single recording is a useful calibration example; other speed, wind, route and descent cases still need operational testing. The two focused regression fixtures omit coordination messages and unrelated aircraft. Full counterfactual replay reapplies recorded edits rather than replacing new predictions with old-version control checkpoints.
