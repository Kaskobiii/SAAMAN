# SAAMAN 1.3.34 — prepared for backend deployment

- **E APP leads the shared sequence.** With the companion vatIRIS update deployed, The server enforces ESSA_E_APP first, then ESSA_FMP, for every client. No policy switch or older client can opt out. For example, an ESOS controller can start the session; E APP takes over when it joins. Applying a runway change cannot displace a higher-priority sequencer.
- **Runway changes survive handover.** The backend confirms the new plan and selects its owner together. A new owner continues with that shared plan instead of replacing it with older local runway selections. The first controller in an empty room still initializes ARR and DEP from EuroScope.
- **TMA shows sequence times only.** After feeder passage or accepted TMA entry, aircraft retain landing slots without ACC-style delay/gain labels. Recompute and swaps still respect spacing. TopSky HOLD at the feeder keeps the aircraft upstream and retains line 0 through holding crossings, with the lose time counting down to its reserved feeder slot. Clear HOLD when leaving.
- **Only local positions connect automatically.** ESOS/ESAA CTR, ESSA APP and ESSA_FMP autoconnect. TWR, ESMM and unrelated positions do not; manual connections remain available and TWR is view-only.
- **Sequencer-version warning.** A known newer connected/local build flags an older sequencer; unreported builds show version unknown. This does not anonymously check the private GitHub release page.
- **Illustrated controller guide.** ACC and APP workflows, L03 → L00 vectoring, yellow 250 kt/red 230 kt entry speeds, and holding examples. Standalone HTML embeds four labelled radar-style examples; a wiki fragment is included.

The backend priority and runway-handover changes require the maintainer to merge and deploy the companion vatIRIS PR. They are not active on an unchanged backend. This build is prepared for testing; no public release is published by this change alone.
