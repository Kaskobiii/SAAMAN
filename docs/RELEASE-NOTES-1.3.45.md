# SAAMAN 1.3.45

- Selecting an arrival/departure pair preselects a suggested rate: 38/h for separate runways; 6.5 NM for a single runway, or 8.3 NM for 08/08. Exceptions: 26/19R and 08/19L use 4.3 NM, 01R/08 uses 4.0 NM, and 26/01L uses 5.0 NM. The slider remains adjustable.
- **Sync EuroScope** now fills the runway menu for review. Press **Apply** to share both the selected runway configuration and rate.
- Planned rate changes appear beside the runway they apply to. For example, a change from arrivals 01R to 01L with a new rate of 30/h shows that future rate on 01L.
- Repeated calculations no longer interpret an unchanged EuroScope runway assignment as a change back from a planned runway. This prevents a false gain instruction during the transition.
- Passed waypoints with stale positive route times no longer send the landing forecast back through the old STAR. The repair requires fresh position, route progress and forward-track evidence, and preserves actual return directs, HOLD and RNP routes.
- A confirmed explicit shortcut refreshes an automatic Stable allocation. Aircraft no longer keep delay from the longer route simply because the feeder estimate disappeared. Manual targets and protected later phases remain in force.
- Superstable feeder guidance corrects a stale gain instruction when the current feeder times require lose, without moving the assigned crossing slot.
- Incidental sequence renumbering and automatic runway confirmation no longer cancel the first climb-to-cruise forecast handover. An upstream aircraft with an unconfirmed initial climb forecast remains Unstable until a reliable profile is confirmed; manual Recompute still accepts the current estimate.
- An airborne aircraft climbing or flying away from final cannot use a zero threshold estimate as its landing time. AMAN uses its bounded vector-path estimate without declaring a missed approach or inventing a direct clearance.

Install the same DLL in every connected instance, including the sequencer and proxy. Existing manual slots, runway closures, feeder spacing and wake separation still apply; genuinely busy traffic can still receive delay.
