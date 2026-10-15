# SAAMAN 1.3.13 — live aircraft performance timing

Live feeder and landing forecasts now use the full bundled 398-aircraft phase database. This replaces the two-aircraft comparison-only preview as the active route predictor when route geometry and current telemetry are usable.

- Initial descent, descent, approach and landing speeds remain distinct IAS/Mach references, anchored to current observed groundspeed. The source's published phase endpoint altitudes are retained; missing data and eight implausible values are rejected.
- Initial capture and Recompute use the modeled feeder and landing times from one route calculation, without an additional fixed buffer. Live forecasts update continuously while existing STA, STA-FF, sequence and instructions retain their accepted values.
- Missing/unsupported profiles or unusable routes fall back to the previous predictor. Short final retains distance/GS timing. Calculations have explicit input and iteration limits, and profiles are embedded: no runtime database download or additional native dependency is needed.
- Supervision identifies the active aircraft profile. Exact capture recording remains available for further live timing checks. No vatIRIS backend deployment or settings changes are needed.

The full-database historical replay improved feeder mean absolute error from 63.1 to 51.7 seconds (27 matched observations); landing changed from 123.9 to 127.5 seconds (30 matched observations). The owner accepted that tradeoff. These samples include later control changes and do not independently validate initial capture accuracy. The model cannot know future vectors or pilot actions.

Unload the old DLL before replacing it. For a timing test, start recording before a new aircraft first appears, then continue through feeder passage and landing. The unchanged 1.3.11 release remains available for rollback.
