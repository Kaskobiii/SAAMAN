# SAAMAN 1.3.9

- Runway configuration includes **Sync EuroScope**, which applies the current supported ESSA ARR/DEP selections immediately through the existing shared plan. It retains arrival rates and rejects missing or stale selections.
- Submenus and dialogs open as separate windows on the EuroScope radar. Drag their title bars beyond AMAN; controls still use the original AMAN session and shared state. Closing AMAN also closes its submenus.
- The supervisory page no longer covers its TopSky title bar, move control or close button.
- Information shows just the runway identifier, such as **19L**.
- Information route-point ETAs use current groundspeed along the remaining accepted route. They no longer spread the buffered landing ETA over nearby STAR points. The landing buffer, assigned slots, feeder buffer and accepted route-passage rules remain unchanged.

Route-point times assume the observed groundspeed continues along the retained route; they are forecasts, not guaranteed crossing times. Missing coordinates use the live EuroScope point estimate when available. Stale or unavailable route-point data displays a dash.

Unload the old DLL before replacing it and loading this version.
