# SAAMAN 1.3.34

Download **SAAMAN.dll** below. Unload the old plugin and update **every EuroScope instance**, including the sequencer and any proxy. Keep SAAMAN above TopSky in the plugin list.

## Shared sequencing

- **ESSA_E_APP has first priority, then ESSA_FMP.** For example, ESOS can start a shared session; when E APP joins, it becomes sequencer. Applying a runway change cannot override this priority.
- **Runway changes survive sequencer handovers.** A new sequencer continues with the confirmed shared runway plan. An older local EuroScope selection no longer replaces it. A fresh, empty session still starts from EuroScope's selected ARR and DEP.
- **Automatic connection is limited to ESOS/ESAA CTR, ESSA APP and ESSA_FMP.** ESMM, TWR and unrelated positions do not autoconnect. TWR remains view-only.
- **Sequencer version warnings** identify an older sequencer when a newer local or connected build is known. An unreported build is shown as unknown.

The matching vatIRIS backend update, [PR #193](https://github.com/minsulander/vatiris/pull/193), is merged and deployed. ESSA priority is enforced for all clients.

## ACC and APP

- **TopSky HOLD at a feeder keeps the aircraft in the feeder sequence.** Crossing ELTOK while holding no longer counts as delivery into TMA. Its assigned feeder slot stays protected and the lose instruction updates towards that slot. Clear TopSky HOLD when leaving.
- **Aircraft inside TMA show sequence times.** ACC gain/lose instructions clear after feeder passage or accepted TMA entry. Recompute, swaps and manual moves continue to respect runway spacing.
- **New illustrated controller guide:** ACC vectoring and holding, APP sequencing, phase colours, menu reference and actual AMAN delay-number examples: yellow means 250 kt IAS entry; red means 230 kt IAS entry. The standalone HTML includes the pictures.

## Validation

498 model/client tests, TypeScript/Vue checks, native context tests and the Windows DLL build passed. Compatibility checks passed against the pinned and current vatIRIS backend. Live controller-handover and TopSky HOLD/XHOLD checks remain to be completed.

Assets include the DLL directly, the illustrated controller guide, the full user guide, licence notices and SHA-256 checksums.
