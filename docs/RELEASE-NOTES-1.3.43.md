# SAAMAN 1.3.43

Fixes delay jumps found in the busy live-session recordings.

- **Stops false delay waves.** An aircraft's original captured estimate could replace its newer accepted timing and add eight or nine minutes to the following queue. Allocation now keeps the accepted planning reference; the original capture remains available as history.
- **Keeps automatic sequence order consistent.** Several Unstable aircraft joining the same queue could be inserted in reverse order. A substantially later accepted forecast could also retain its old place temporarily. Both are corrected before assigning times. A pending correction cannot become frozen into an aircraft's sequence when it becomes Superstable.
- **Marking HOLD preserves the release reference.** Setting TopSky HOLD could add roughly two minutes to an aircraft and its followers without any change in the route or traffic. The flag now preserves the expected transfer and the assigned feeder slot. A deliberate Recompute can still change a slot when the queue or route has changed.
- **Limits the High downwind allowance to the configured distance.** The previous calculation could replace a usable route with a much longer generic pattern and then add the extension. MED now uses the current route. HIGH adds the configured extension to that route: 4 NM of downwind means about 8 NM extra track. Once past the feeder, current approach geometry takes priority.
- **Protects handovers and reconnects.** Missing STAR/runway fields from a new sequencer retain the accepted clearance. Stale observations preserve their previous assigned times and phase while waiting for fresh data. Brief same-flight reconnects retain controller edits.
- **Handles an incomplete approach on first discovery.** If EuroScope supplies the feeder but not the approach, AMAN uses the published feeder-to-runway distance with the aircraft performance model. This prevents a temporary eleven-minute shortcut estimate from becoming twenty-one minutes when the full STAR arrives. Headings, directs beyond the feeder and explicit approach clearances keep priority.
- **Retires obsolete callsign edits.** A later flight cannot inherit a days-old target, missed-approach mode or capture history from an earlier flight using that callsign. A past target is discarded independently of newer edits.
- **Avoids false go-arounds from one altitude spike.** An inbound climb needs corroboration; explicit missed-approach indications and a clearly departing missed-approach trajectory still take priority.
- **Improves insertion of newly discovered TMA traffic.** It can take a feasible gap near its current approach time instead of automatically joining the end of the protected arrival bank.

Busy arrival banks, wake spacing, actual vectors and changed routes can still require substantial delay. Those constraints remain enforced.

Use the same DLL in every connected instance, including the sequencer and proxies.
