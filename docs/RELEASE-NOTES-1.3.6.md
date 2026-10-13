# SAAMAN 1.3.6

- Shared vatIRIS mode connects automatically when the plugin is loaded on a radar screen and EuroScope has a connected controller callsign. Loading before login waits and retries; opening AMAN reuses the same background connection.
- Coordination notifications have a centered Acknowledge button. The routine receipt instruction is removed; connection failures and pending acknowledgements still show their status.
- Removed redundant menu and connection explanations and shortened supervision text. The recording export reminder appears only when a recording exists.
- TWR callsigns, including handover callsigns, are observers only: no sequencer ownership, aircraft edits, configuration changes or coordination writes.
- Includes the 1.3.5 shared/live startup defaults, real vatIRIS backend compatibility checks and short controller guide, with standalone and wiki HTML exports.

Explicitly saved local/training choices are preserved. The existing embedded pane and drag-trail fix are retained.

Unload the old DLL before replacing it and loading this version.
