# SAAMAN 1.3.30 local test

Removed the new sustained-alignment shortcut introduced in 1.3.29. Outside
short final, the aircraft's assigned route/direct remains the basis for
prediction. Simply aligning with the runway for ten seconds does not replace
that route. Existing position-based short-final detection within 4 NM remains.

Recompute's position-based TMA phase acceptance now applies to all ESSA
arrivals, independent of departure or feeder availability. The conservative
inner-area fallback requires a fresh position within 25 NM of the arrival
threshold, altitude 350-12000 ft, usable groundspeed and landing estimate.
Existing observed feeder-entry rules cover arrivals outside that inner area.
Unavailable forecasts and waiting go-arounds are not promoted. An accepted
TMA phase survives subsequent updates and shared checkpoint restoration.

Keeps the other 1.3.29 fixes: brief interruption history, ESSB local arrival
Recompute, recovery through final/rollout, distinct second-landing timestamps,
and immediate landing at 40 kt or less on a runway with prior approach history.

444 model/adapter tests, strict TypeScript/Vue checks and native context/window
checks validate the local package. Live testing and publication are pending.
Load in every EuroScope instance, including sequencer and proxy. No backend
update is required. Keep SAAMAN above TopSky.
