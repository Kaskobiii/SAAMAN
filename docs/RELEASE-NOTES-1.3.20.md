# SAAMAN 1.3.20 — radar-layer windows and initial timing

- An allocation first captured while climbing can refresh once after its aircraft descent profile becomes usable and stays consistent for 15 seconds. This applies during Unstable/Stable only. Manual targets, sequence order, real spacing and closure work remain protected. Later speed changes continue to affect ETA without repeatedly resetting a Stable assignment.
- A direct clearance beyond the feeder no longer adds the fallback buffer to a crossing estimate. When the observed track still crosses the feeder, its position and groundspeed provide that estimate. For a genuine bypass, Information shows no current ETA-FF; assigned times and existing instructions remain. Feeder passage requires a fresh position observation.
- AMAN, supervision, submenus and coordination are painted through EuroScope's radar layer, with SDK screen-object input. Host menus paint afterwards and retain input priority. The hidden WebView remains the single interface/engine session. Native window-order and menu-detection guesses are bypassed.
- The bottom scrollbar is half-height with more travel at either end, and the pane can narrow to 260 pixels. Empty Missed Approach, Desequenced and Errors buttons stay hidden.
- Dialogs, information tables, menus and coordination notifications use less padding and smaller controls while retaining their information and shared zoom.
- First opening displays an opaque loading panel until the first UI frame is ready. A red LIVE above the top-right clock appears only with a fresh shared-backend connection.
- Dragging uses event positions rather than a delayed read of the current cursor. Pointer capture, form editing and range thumb offsets are preserved through SDK input.

Validation: 358 model/relay tests, including recorded SAS864/TOM888 transitions, shared checkpoint restoration, manual overrides, closure work and Superstable protection; strict UI type checking; x86 build; native context tests. SDK-renderer smoke covers cached nonblack frames, hidden overlays, later menu paint, buttons, popup editing, sliders, pointer capture/click coordinates, 260px layout, shared zoom and coordination. Live EuroScope test3 confirmed that overlapping host menus and controls work.

Recording 17 replay: SAS864's one-time profile handover occurs at 09:26:29 UTC with zero artificial holding work. TOM888's direct AGILI crossing estimate is 09:22:49, against the observed VACRA crossing around 09:22:54. This recording does not reproduce the separate startup transient with established traffic.

No backend update is needed. Unload the previous DLL before loading this build.
