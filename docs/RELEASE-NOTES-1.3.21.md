# SAAMAN 1.3.21 — dropdown and resize controls

- Runway and other select lists use AMAN-styled choices inside the plugin surface. Repeated opening, choosing and dismissal no longer relies on EuroScope popup lists. Choices remain within their pane at shared zoom levels.
- Opening or editing runway/rate configuration preserves the selected view, horizontal column position and time scroll.
- Main and supervision resize corners have a 22 × 22 pixel hit area while retaining the small visual grip. Hovering the corner sets the diagonal resize cursor immediately on the radar thread. The host menu paint/input precedence from 1.3.20 is retained.

Validation: 358 model/relay tests, strict UI checking, injected-script syntax check, x86 build and native state tests. Native SDK rendering/input checks cover repeated ARR/DEP choices, dismissal, shared zoom, visible list bounds dragging from the enlarged grip, and repeated configuration opening/editing/closing in Runway, FLOW and ACC/ARR-W with preserved horizontal/time positions. The user confirmed the styled dropdowns and enlarged resize controls work in live EuroScope.

No backend update is needed. Unload the previous plugin before loading this DLL.
