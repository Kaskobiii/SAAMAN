# SAAMAN 1.3.19 — shared window zoom

- Ctrl + mouse wheel uses one zoom level for AMAN, supervision and submenu windows. Changing zoom in a submenu also updates the other windows, and reopened submenus inherit the current level.
- Submenu frames resize in both dimensions to their zoomed contents, removing the unused gray area left at the original size.
- Header buttons, fonts and spacing become smaller automatically in narrow panes, keeping the rate readable and reducing button rows.
- Coordination notifications scale with AMAN while retaining the compact TopSky frame.

Validation: 349 model/relay tests, strict UI type checking, x86 release build, native context tests and native UI smoke. Native tests cover zooming in/out from AMAN and a submenu, reopening, frame/content size agreement and coordination scaling.

No backend update is needed. The ETA model is unchanged; the separate startup gain/delay transient still needs a first-minute reload recording for diagnosis.

Unload the previous DLL before replacing it.
