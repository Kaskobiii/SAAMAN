# SAAMAN 1.3.21 — controls, timeline position and proxy connections

- Runway and other select lists use AMAN-styled choices inside the plugin surface. Repeated opening, choosing and dismissal no longer relies on EuroScope popup lists. Choices remain within their pane at shared zoom levels.
- Opening or editing runway/rate configuration preserves the selected view, horizontal column position and time scroll.
- Main and supervision resize corners have a 22 × 22 pixel hit area while retaining the small visual grip. Hovering the corner sets the diagonal resize cursor immediately on the radar thread. The host menu paint/input precedence from 1.3.20 is retained.
- A second EuroScope proxy using the same callsign follows shared runways and aircraft times without claiming or releasing the direct instance's sequencer role. Edits still go to the sequencer, with acknowledgements recovered from shared receipts.

Validation: 363 model/relay tests, strict UI checking, injected-script syntax check, x86 build and native state tests. Native SDK rendering/input checks cover repeated ARR/DEP choices, dismissal, shared zoom, visible list bounds, dragging from the enlarged grip, and repeated configuration opening/editing/closing in Runway, FLOW and ACC/ARR-W with preserved horizontal/time positions. The user confirmed the styled dropdowns and enlarged resize controls work in live EuroScope. TopSky menus were also confirmed visible and clickable with SAAMAN placed above TopSky in the plug-in list.

Installation: in **OTHER SET → Plug-ins**, select **SAAMAN** and use **Up** to place it **above TopSky**; save the profile. Plug-in order determines drawing order.

No backend update is needed. Unload the previous plugin before loading this DLL.

Live confirmation: both EuroScope instances work normally with the same callsign on direct and proxy connections. The release uses the identical tested DLL.
