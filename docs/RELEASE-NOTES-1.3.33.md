# SAAMAN 1.3.33

## Update every connected instance

Unload the previous DLL and load this one in **every controller and proxy instance**, especially the sequencer. Keep SAAMAN above TopSky in EuroScope's plug-in list. **No vatIRIS backend update is needed.**

This release includes the fixes developed after the previous GitHub release, 1.3.24.

## More reliable estimates while being vectored

EuroScope can restore the original STAR/FLEG after a heading assignment. AMAN now uses a position- and heading-based approach estimate for fresh terminal traffic instead of suddenly counting that old route again. It also works without a recent direct clearance and does not expire ten minutes after the last direct. Recompute follows the same rule.

**Example:** five minutes before landing, BVX327's old estimate was about 5:29 late. Replaying the same sample with this fix reduces that to about 1:12. The estimate remains an estimate: it cannot know the controller's next vector. A heading estimate alone does not automatically resume a missed approach or declare a straight-in clearance.

## Recompute without phantom queue delays

- A selected aircraft becoming Frozen during Recompute no longer makes the planner reuse its old later slot for the aircraft behind it.
- Refreshed TMA traffic can fit ahead of later upstream automatic slots. Those followers move only as required for spacing.
- An aircraft reinserted after a missed approach can push automatic followers back instead of unnecessarily waiting behind the entire group. Manual targets and Frozen slots remain protected.
- Repeated group Recompute no longer accumulates the same spacing repeatedly.

Examples from the recorded checkpoints, replayed with unchanged inputs:

| Case | Before | With this release |
|---|---:|---:|
| NOZ842, bulk Recompute | 9:37 delay | about 3:09 |
| EWG4BW, partial Recompute | 5:36 delay | about 1:28 |
| SAS126, ERXEC reinsertion | 7:59 delay | about 1:15 |

Remaining delay can be real: runway rate, wake separation, feeder spacing, manual targets and closures still apply.

## Swaps and manual moves

Swapping exchanges **sequence positions**, then assigns feasible times. It no longer blindly exchanges the aircraft's old times. Untouched automatic aircraft are no longer marked as manually ordered by a drag elsewhere in the queue. Old swap-generated targets are repaired when shared history is restored.

**Example:** moving SN2297 used to give untouched SAS4CV nearly five minutes of delay; the same checkpoint now gives about four seconds. SAS126's unchanged manual target also keeps its G22 instruction instead of suddenly showing L04:41. Use Refresh delay or Recompute when you intend to refresh that aircraft.

Feeder crossing spacing is now enforced even when two aircraft use different landing runways. Genuine spacing can still require delay after a swap.

## Keep sequencing with local ESSA controllers

**ESOS/ESAA CTR, ESSA APP and ESSA_FMP** can become sequencer, including handover callsigns. ESMM and other positions can follow and edit but cannot become sequencer. Tower positions remain observers.

ESMM positions do not automatically join shared mode; they can join manually. Priming from ESMM to ESOS/ESAA/ESSA triggers automatic connection without reloading the DLL. With no eligible sequencer online, the shared sequence waits.

**Runway change:** set ARR and DEP correctly in the sequencer's EuroScope, then use Sync EuroScope in AMAN. This shares the AMAN plan; it does not change other controllers' EuroScope settings or existing aircraft runway/STAR assignments. Applying a configuration does not forcibly transfer sequencer ownership.

## Other fixes included since 1.3.24

- Better continuity across brief disconnects and reconnects, retaining an established phase and removing obsolete feeder guidance.
- Recompute inside the inner TMA can establish Superstable for any departure airport, including ESSB, when fresh usable data supports it.
- Missed Approach: select the aircraft, choose Reinsert on and an IAF. The selection reinserts immediately, with no checkbox.
- Landing detection checks the actual runway, including the departure/secondary runway, and recognises a verified rollout at 40 kt or less.
- Automatic Stable/Unstable order can correct a sustained forecast inversion without treating every transient ETA change as a manual resequence.
- The extended straight-in inference was removed; a real clearance or the existing short-final evidence is used.

## Validation

490 model and adapter tests pass, including eight new recording-based regressions that fail against the previous code. Both full evening recordings pass 81,435 feeder/runway spacing comparisons across 3,702 frames. Strict TypeScript/Vue checks, x86 DLL build and native context/window/input checks pass. GitHub backend compatibility checks are run before publication. The latest changes have replay and automated validation; live event confirmation remains pending.
