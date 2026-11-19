# SAAMAN 1.3.48 — Shared clock and steadier feeder guidance

Download `SAAMAN.dll` directly and unload the previous DLL before loading this version. Update every connected EuroScope instance, including the sequencer and any proxy.

- **Shared time.** SAAMAN can use vatIRIS UTC and the age of the last accepted publication. For example, a PC clock that is 90 seconds fast can still follow a fresh sequence. Brief network interruptions keep the last fresh sequence visible until it expires.
- **Feeder guidance.** Sudden, unsupported jumps in the feeder or landing estimate retain the last credible timing. Automatic Stable reordering requires sustained agreement between the feeder and landing forecasts, and enough room around the pair. Controller edits, holding, runway rates, and wake spacing still apply.
- **Recent diagnostics.** Use **MAESTRO → Export recent diagnostics** to save up to 30 minutes of clock, connection, sequencer, and flight timing history. SAAMAN collects it while the plugin is loaded, including with the AMAN window closed. Export before unloading the plugin.

**Backend rollout.** The DLL works with the existing vatIRIS backend. Shared UTC and server-measured publication age become available when the vatIRIS clock update is deployed and the sequencer is updated.

**Validation.** The Windows build, native checks, 840 client tests, and 35 vatIRIS tests passed. Five older live recordings replayed without configured runway-rate or wake-spacing violations. They had the same number of 10-minute-or-longer delay readings as 1.3.47. The specific Sweden Live incident could not be replayed.
