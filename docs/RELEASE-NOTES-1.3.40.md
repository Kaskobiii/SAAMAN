# SAAMAN 1.3.40 - Timing and shared-sequence fixes

## Less unnecessary delay
- Earlier credible estimates can release unused automatic slots and bring following aircraft forward while keeping the required runway and feeder spacing.
- Accepted improvements survive phase, rate and closure changes instead of reverting to the original capture.
- Historical spacing work is no longer counted twice while a new prediction is being confirmed.

Example: an aircraft with no remaining traffic constraint no longer keeps an old L08 simply because its original estimate was later. Actual traffic, wake spacing, configured rates, holds and controller-assigned times still apply.

## Recompute stays consistent
Recomputing part of a busy sequence now resolves its effect on surrounding aircraft in the same update. Repeating the same command with unchanged traffic no longer adds another runway slot to following aircraft. Future rate changes, feeder reservations, runway gaps and Frozen aircraft are included.

## Shared history and TMA phases
Fresh accepted history, controller edits, runway plans and pending rate changes can recover after an empty backend response or restarted counter. A newer publication is checked before older local data can replace it.

Aircraft with verified feeder passage immediately regain the appropriate Superstable or Frozen phase after startup or history recovery, instead of turning Unstable for another minute. Upstream, climbing, holding and missed-approach aircraft keep their normal checks.

## Feeder instructions and arrival routes
- Credible later feeder estimates reduce existing lose instructions as delay is absorbed by vectors or speed control, without requiring Recompute.
- Missing feeder data no longer produces new placeholder delay/gain instructions.
- Manually selecting an arrival route now supplies the timing profile in shared mode, including when the feeder is missing from the filed route. For example, selecting a VACRA arrival can put an otherwise eligible aircraft into the sequence.

## Recording improvements
New recordings retain a compact summary of the original prediction inputs, even when recording starts later. One original landing forecast error could not be verified as fixed because its capture inputs were unavailable; this release does not claim every prediction error is resolved.

## Validation
673 automated client/model tests and 9 local vatIRIS-router compatibility checks passed, together with interface checks and the Windows Release build. Reviewed 17 recording files, including busy traffic with up to 30 aircraft.

## Installation
Download **SAAMAN.dll** below. Unload the previous DLL and load this version in every connected EuroScope instance, including the sequencer and proxies. Keep SAAMAN above TopSky in the plugin list.
