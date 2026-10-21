# SAAMAN 1.3.38

## Aircraft highlights

- Select an aircraft in EuroScope to put a cyan box around its callsign in AMAN for **three seconds**.
- Hover over an aircraft in AMAN to show a **cyan ring around its radar return**. Leaving the aircraft clears the ring. No extra callsign text is drawn on the radar.

## Unnecessary delay for lone aircraft

A lone automatic Stable arrival could receive lose minutes as its feeder and landing estimates improved, even when the sequence was empty. AMAN now uses a consistent earlier feeder/landing estimate when both slots are available.

For example, an arrival that previously accumulated L02 and then L04 without traffic ahead now stays delay-free. Actual spacing, runway gaps, manual times and controller sequence changes still apply.

## Automatic recovery

- **TopSky High Speed:** the HS flag no longer produces an “Assigned speed 999 unavailable” error or disables prediction as if 999 were a numeric speed restriction. Actual IAS and Mach assignments keep their normal handling.
- **Large route ETA jumps:** AMAN retains the last credible feeder/landing estimate while checking fresh position and performance data. A restored old, longer FLEG no longer removes an otherwise usable aircraft from the sequence. Confirmed runway and aircraft-profile changes can recover automatically.
- **Repair notices:** a short notice identifies the aircraft and what AMAN corrected. It disappears after seven seconds, remains in supervision history, and does not repeat on every update.

Manual slots, HOLD, pause protection and protected sequence order remain in force. If an older damaged checkpoint has no usable timing history, recovery needs credible position/performance data; missing history cannot be reconstructed.

## Update

Unload the previous plugin and load **SAAMAN.dll in every EuroScope instance, including the sequencer and proxy instances**. Keep SAAMAN above TopSky in EuroScope’s plugin list.

The DLL is attached directly to the release; no ZIP is needed.

## Validation

All **570 client/model tests** pass, along with the Windows Release build, UI type checks and native context checks. Mounted interface checks cover the three-second selection box, hover cleanup and the automatic notice lifecycle. The final highlight changes were also tested in EuroScope before publication.
