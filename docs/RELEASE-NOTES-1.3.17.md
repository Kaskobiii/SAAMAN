# SAAMAN 1.3.17 — retire replaced manual placeholders

Fixes an old manual entry returning after its live flight disappeared or the plugin reloaded, producing an Invalid destination route prediction error such as CCA911.

- A live flight consumes its matching manual placeholder, and the saved/shared plan removes that exact reservation.
- An unused reservation expires once its original time, explicit target and prior assigned time have all passed. Its obsolete manual edits are cleared so a later flight cannot inherit an expired slot.
- Later manual assignments and closure-delayed slots remain valid. Deliberately adding the same callsign again creates a new reservation.
- Recovery from older checkpoints and local saved state is covered. Existing shared API endpoints remain compatible; no backend update is needed.

Validation: 349 tests, strict UI type checking, x86 release build, native context tests and native UI smoke. New tests reproduce manual-to-live replacement, disappearance, checkpoint restoration, shared sequencer reload and durable local cleanup with revision protection.

The separate report of roughly 30 seconds of large startup gain/delay instructions has not been reproduced from the available steady-state recording. This release does not claim to fix that startup transient; a recording of the first minute after reload is needed to establish its cause. The ETA model and phase protections are unchanged.

Unload the previous DLL before replacing it.
