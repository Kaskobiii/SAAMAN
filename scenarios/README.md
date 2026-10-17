# ESSA SweatBox exercises - revision 2

Six exercises for SAAMAN: Steady and Peak for 01R, 26 and 19L.
These replace the earlier ESSA_Realistic files. Use the v2 files from this pack.

The initial traffic positions, altitudes, 280/290 initial speed fields and start
times follow the supplied ESSA_AMAN_scenarios example. Initial altitudes range
from FL180 to FL360; FL100 is a target at the feeder, not a starting altitude.
The first arrivals are already descending, with the rest spread farther out.
Most traffic is present immediately; later starts are retained from the example.
Filed cruise TAS remains separate from the initial simulator speed field.

| Arrival runway | Departure runway | Steady | Peak | Suggested initial AMAN rate |
|---|---|---|---|---|
| 01R | 01L | 18 aircraft | 30 aircraft | 31/h |
| 26 | 19R | 18 aircraft | 24 aircraft | 25/h |
| 19L | 19R | 18 aircraft | 30 aircraft | 31/h |

Select the .txt file for the wanted runway and traffic level. Set both arrival
and departure runways in EuroScope, then connect SAAMAN to the corresponding
SweatBox network. Use normal simulation speed and a clean shared sequence.
Default pseudo pilot: ESOS_1_CTR. Take simulation ownership or change
INITIALPSEUDOPILOT if using another callsign. No dummy controllers are started.
Each file uses different callsigns to avoid carrying allocations between games.

The simulation route uses the example's simple feeder/descent/intercept pattern,
without altitude requests at every upstream fix. It ends at AGILI/2500 for 19L,
EKDAS/2500 for 26, or FI01R/2500 for 01R, followed by its ILS definition.
The filed STAR and assigned runway use the installed AIRAC 2610 names.
FI01R avoids the duplicate CI01R name in other parts of the combined sector.
Altitude targets are training values, not published approach clearances.

EuroScope applies route altitude requests automatically except when pseudo pilot
and tracking controller are the same; in that case issue the descent commands.
Override speed, descent or vectors as needed. Record before starting, and keep
the recording through landings. Steady is the baseline; Peak deliberately needs
delay management. These are traffic demands, not promised landing rates.

Traffic-schedule.csv lists every initial altitude, position and start time.
Validation.json records file/sector checks. All scenario records, initial levels,
unique callsigns/squawks, STAR names, fix coordinates, descending target levels,
intercept altitudes and ZIP integrity were checked. The revised pack has not yet
been loaded in a live EuroScope simulator; file checks do not validate its runtime.

Reference: user-supplied ESSA_AMAN_scenarios.zip; its other-plugin briefing and
commands have not been copied into this SAAMAN guide.
Format: https://www.euroscope.hu/wp/scenario-file/
Editor: https://www.euroscope.hu/wp/scenario-editor/
