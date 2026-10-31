# SAAMAN 1.3.42 - automatic traffic modes

## Landing estimates adapt to demand

Each runway now selects its own traffic mode:

- **LOW:** shortest feasible approach. Eligible automatic Stable times follow the live estimate until Superstable, reducing the need for Recompute in quiet traffic.
- **MED:** standard vectoring pattern.
- **HIGH:** longer downwind. The default adds 4 NM of downwind, about 8 NM of total track. Authorised users can adjust it in shared settings or disable automatic modes.

For example, busy 19L can use HIGH while an occasional arrival on 19R uses LOW. Explicit directs, RNP approaches, heading clearances and established final approach take priority over the assumed pattern.

Mode selection uses forecast arrivals and runway capacity, with confirmation time before switching. Delay numbers do not feed back into the mode, and the selected arrival rate stays unchanged. Manual targets, holding slots and Superstable/Frozen assignments remain protected. Runway, wake and feeder spacing still apply.

## Tracking recovery and supervision

- Brief unreliable groundspeed reports after tracking resumes are checked before they replace credible timing.
- Independent route protection continues through traffic-mode changes, including restored EuroScope routes and genuine route extensions.
- Supervision shows the runway mode, expected demand, assumed path and reasons behind the current slot.
- Recordings retain sequencer/source changes and slot decisions within their existing size limits. Export remains available through a supervision sign-in interruption.
- Updated user and controller guides explain the modes.

## Recording comparison

The landing-time results are **mixed**. In the selected mode-affected comparisons, 34 forecast errors improved, 25 worsened and two were essentially unchanged. High-mode forecasts were more often too late in this sample; the 4 NM extension remains a configurable starting assumption, not a validated accuracy improvement.

The comparison uses two complete quiet-session recordings plus preserved checkpoints and observed runway crossings from the busy sessions. Later directs and vectors affect the results, and clean early-flight evidence is limited. Full method and figures are in the attached **traffic-mode-validation.md**.

763 automated tests and nine backend compatibility checks passed. Retained replay/checkpoint checks found no runway/feeder spacing violations or new TMA phase regressions across 1,231 updates.

## Update

Unload the previous DLL and load **SAAMAN.dll** in every connected EuroScope instance, including the sequencer and proxies. Keep SAAMAN above TopSky in the plug-in list. The DLL is attached directly; no ZIP is required.
