# SAAMAN 1.3.20 — initial timing and feeder directs

- An allocation first captured while climbing can refresh once after its aircraft descent profile becomes usable and stays consistent for 15 seconds. This applies during Unstable/Stable only. Manual targets, sequence order, real spacing and closure work remain protected. Later speed changes continue to affect ETA without repeatedly resetting a Stable assignment.
- A direct clearance beyond the feeder no longer adds the fallback buffer to a crossing estimate. When the observed track still crosses the feeder, its position and groundspeed provide that estimate. For a genuine bypass, Information shows no current ETA-FF; assigned times and existing instructions remain. Feeder passage requires a fresh position observation.
- Native panels yield paint and input space to newly shown overlapping EuroScope controls, and temporarily hide during native host menus. Permanent radar containers and ordinary mouse capture do not hide AMAN or supervision. A late container covering a whole pane cannot erase it. Closing or moving a control restores the affected area. Coordination notifications retain their pending message while suspended.

Validation: 358 model/relay tests, including recorded SAS864/TOM888 transitions, shared checkpoint restoration, manual overrides, closure work and Superstable protection; strict UI type checking; x86 build; native context tests; native UI smoke with overlapping controls moving/closing, permanent inset radar controls, late containers enclosing AMAN/supervision, and ordinary mouse capture. The host menu change still needs confirmation against EuroScope's own settings menu before release.

Recording 17 replay: SAS864's one-time profile handover occurs at 09:26:29 UTC with zero artificial holding work. TOM888's direct AGILI crossing estimate is 09:22:49, against the observed VACRA crossing around 09:22:54. This recording does not reproduce the separate startup transient with established traffic.

No backend update is needed. Unload the previous DLL before loading this build.
