# SAAMAN 1.3.18 — window details

- Close buttons are vertically centered within dialog and menu title bars, including Runway Configuration and Information.
- The click-and-drag aircraft selection rectangle stops at the visible timeline edges. Submenu windows can still move outside AMAN.
- Coordination notifications use a compact TopSky frame instead of the Windows title bar. The title remains draggable, with sender callsign, sent time and a centered Acknowledge button.

Validation: 349 model/relay tests, strict UI type checking, x86 release build, native context tests and native UI smoke, including selection limits, title alignment and coordination framing/acknowledgement.

The ETA model is unchanged. The separate startup gain/delay transient still needs a first-minute reload recording for diagnosis. No backend update is needed.

Unload the previous DLL before replacing it.
