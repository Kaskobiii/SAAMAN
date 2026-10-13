# SAAMAN 1.3.5

Fresh settings start in shared vatIRIS callsign mode, with VATSIM live selected.
Local mode is the secondary option. Existing explicit mode/network choices are
preserved when loading saved settings.

The controller guide covers operation without calculation details. Markdown,
standalone HTML and a clean HTML body for the VATSIM Scandinavia wiki are included.
The README and guide explicitly explain the shared backend requirement.

Backend compatibility tests exercise the real vatIRIS AMAN router on a local
server, using a pinned commit/checksum and current upstream main. They cover
shared edits, coordination, acknowledgements, settings, handover, retry,
network separation and the existing backend's controller/training-key checks.
GitHub Actions runs these checks for pull requests and main updates.

Unload the previous DLL before replacing it with this version. The existing
flight timing and window movement behavior is retained.
