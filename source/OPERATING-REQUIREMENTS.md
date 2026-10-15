> 1.3.13: the full 398-type phase database now drives live route timing when usable. Initial capture/Recompute accept the modeled feeder and threshold times without another fixed buffer. Existing accepted baselines, STA/STA-FF, order and instructions remain protected. Final-position timing and the previous predictor remain fallbacks. No backend API or installation/configuration changes are required.

> Current release 1.3.11: landing ETA refers to the assigned runway threshold, with remaining-distance slowdown compensation and geometry/current-GS timing on established short final. Established airborne updates continue below 350 ft. Recent model corrections survive vector fallback on the same runway for at most ten minutes. Existing accepted times, order, feeder allowances and holding instructions remain protected. The former high-speed setting is now an extra correction limit. Generic speed profiles do not predict unknown future clearances; see the release replay report for mixed earlier results.

> Historical release 1.3.10: a confirmed runway change refreshes accepted timing and approach once, preserving phase and relative order. A temporary disagreement between SDK assignment and the shared active runway plan retains the previous accepted slot. Information keeps accepted route names but shows unavailable crossing times as a dash for vectors, skipped/obsolete points or estimates beyond the airport ETA. Landing and feeder buffer defaults are unchanged.

> Current release 1.3.9: Sync EuroScope applies fresh supported ESSA ARR/DEP selections. Submenus and dialogs use separate radar-owned windows; supervisor chrome remains accessible. Information route-point times follow current GS along the retained route, independently of the unchanged landing buffer and assigned slots.

> Current release 1.3.8: ETA follows current EuroScope landing EET and groundspeed on every valid update. Accepted STA/STA-FF and captured history remain separate and are preserved until Recompute or a sequence edit. Stale observations retain the last valid ETA. Timeline labels use assigned times.

> Current release 1.3.7: landing buffers add configurable speed compensation above 300 kt (normal 2 minutes at/below 300 kt, 6 at 450 kt; extrapolated and capped at 15). Near-fix base remains 1 minute for Superstable/Frozen. The speed component affects landing only, using groundspeed captured initially or at Recompute. Feeder estimates retain their normal/near-fix base. Existing baselines and accepted STAs are preserved on upgrade and ordinary speed/route changes.

> Current release 1.1.9: ordinary live ETA uses a captured EuroScope estimate plus a shared phase buffer: normal 2 minutes, Superstable/Frozen 1 minute, both adjustable 0â€“15. Phase changes alone do not revise accepted time. Performance/vector trajectory timing described below is retained historical implementation, bypassed in this mode. Direct clearances do not update accepted time; Recompute does.

> Current release 1.1.8: ordinary live ETA uses a captured EuroScope estimate plus a shared phase buffer: normal 2 minutes, Superstable/Frozen 1 minute, both adjustable 0â€“15. Phase changes alone do not revise accepted time. Performance/vector trajectory timing described below is retained historical implementation, bypassed in this mode. Direct clearances do not update accepted time; Recompute does.

> Current release 1.1.7: ordinary live ETA uses a captured EuroScope estimate plus a shared phase buffer: normal 2 minutes, Superstable/Frozen 1 minute, both adjustable 0â€“15. Phase changes alone do not revise accepted time. Performance/vector trajectory timing described below is retained historical implementation, bypassed in this mode. Direct clearances do not update accepted time; Recompute does.

> Current release 1.1.6: ordinary live ETA uses a captured EuroScope estimate plus a shared phase buffer: normal 2 minutes, Superstable/Frozen 1 minute, both adjustable 0â€“15. Phase changes alone do not revise accepted time. Performance/vector trajectory timing described below is retained historical implementation, bypassed in this mode. Direct clearances do not update accepted time; Recompute does.

> Current release 1.1.5: ordinary live ETA uses a captured EuroScope estimate plus a shared phase buffer: normal 2 minutes, Superstable/Frozen 1 minute, both adjustable 0â€“15. Phase changes alone do not revise accepted time. Performance/vector trajectory timing described below is retained historical implementation, bypassed in this mode. Direct clearances do not update accepted time; Recompute does.

> Current release 1.1.4: ordinary live ETA uses a captured EuroScope estimate plus a shared phase buffer: normal 2 minutes, Superstable/Frozen 1 minute, both adjustable 0â€“15. Phase changes alone do not revise accepted time. Performance/vector trajectory timing described below is retained historical implementation, bypassed in this mode. Direct clearances do not update accepted time; Recompute does.

> Current release 1.1.3: ordinary live ETA uses a captured EuroScope estimate plus a shared phase buffer: normal 2 minutes, Superstable/Frozen 1 minute, both adjustable 0â€“15. Phase changes alone do not revise accepted time. Performance/vector trajectory timing described below is retained historical implementation, bypassed in this mode. Direct clearances do not update accepted time; Recompute does.

> Current release 1.1.2: ordinary live ETA uses a captured EuroScope estimate plus a shared 0â€“15 minute buffer (default 2). Performance/vector trajectory timing described below is retained historical implementation, bypassed in this mode. Direct clearances do not update accepted time; Recompute does.

# AMAN operating requirements â€” 12 October 2026

This specification replaces earlier conflicting display and phase instructions. All interface text and conversation remain in English. The three-row Information layout follows `_Information_.xlsx`, Blad1 A1:O3. Existing nominal workbook Vectors distances remain the ordinary-arrival model.

## Confirmed decisions

- Stable begins 15 minutes before the feeder, Superstable 4 minutes. These thresholds are permanent and cannot be edited in supervision.
- Frozen defaults to approximately 3:30 before landing. The user explicitly permits dragging flights into and out of Frozen; the earlier Frozen drag prohibition is superseded.
- All operating AMAN users can manually reorder Superstable traffic and send coordination messages. Supervisory settings remain separately restricted.
- Unstable predictions and order are provisional. A newly known flight with an earlier predicted arrival can insert earlier. Stable order changes only for manual actions or a genuinely new earlier arrival. Superstable/Frozen order changes only through controller actions.
- Superstable instructions stay fixed until Recompute or Refresh delay. Recompute refreshes the selected calculation and sequence subject to the phase rules. Refresh delay changes the instruction without changing assigned time or order.
- Gain-only dragging may advance a flight from its original allocation; reversing a previous gain is permitted up to that original allocation. Unstable flights become Stable when manually advanced.
- A label reads outward from its column: time, callsign, delay, wake, aircraft type. This is mirrored by column side.
- Gain is green. Positive instructions through 150 seconds are yellow; from 151 seconds red. Positive label minutes show completed minutes: 89 seconds is yellow 1; 150 seconds yellow 2 and 151 seconds red 2. Information retains seconds.

## Controller menus and display

- Runway and rate dialogs show an application-time slider and upcoming changes, with Cancel planned changes. Pending/application-time lines are solid yellow under this replacement specification.
- Callsign menus open with right-click. Actions: Information, Recompute, Refresh delay, Change Runway when a second configuration runway or planned runway is available, Change ETA-FF, Maximum delay (0/3/5/10/15 minutes), Insert arrival before/after, Insert closure before/after, Insert gap before/after, Desequence, Remove.
- Background right-click offers insertion of known upcoming/non-terminated flights. Runway view additionally offers an immediate solid red eight-minute closure or hollow red five-minute gap, each with draggable start/end, removal and time editing.
- Information shows three rows: callsign/DEP DEST/type-wake; route points and modelled times; initial/current ETA-FF, STA-FF, ETA, STA; initial/current total and ACC delay in signed minutes and seconds. Passed route points disappear.
- ACC/ARR-W shows selected sector entry points and feeder times; FLOW shows all feeder points; runway view shows only active arrival/departure runways and runways belonging to future configuration changes. Closures/gaps are runway-only.

## Coordination

All operators can send these messages within their shared AMAN room. Every receiver sees an acknowledgement dialog: Update in progress for ESSA; Update finished; Snow removal ESSA; CAT I Conditions ESSA; CAT II Conditions ESSA; CAT III Conditions ESSA; New Approach Times; Speed 230 kts for all arrivals to ESSA; Speed 250 kts for all arrivals to ESSA; Normal speed for all arrivals to ESSA. Delivery and acknowledgement must survive sequencer handover without replaying an already acknowledged message. Local mode cannot deliver to remote controllers.

## Integration and correctness boundaries

An aircraft's absence/disconnection is not evidence of landing. Native capture now reads the explicit EuroScope flight-plan termination state independently of radar correlation. Controller tracking release is not termination. The installed TopSky 2.6 General manual, page 61, marks its Terminate command as not implemented. Existing physical/manual/simulator landing methods remain available while that integration limitation is clarified. Maximum-delay instructions must expose impossible constraints rather than hiding genuine required delay. Manual operations must continue to enforce real runway/wake/closure separation and never write AMAN runway selections back to EuroScope. Shared-room calculation commands remain distinct from supervisory settings.

## Delivery verification

The replacement policy includes mandatory aircraft type/current instruction fields, permanent native and engine configuration horizons, a mirrored label layout, all controller menu actions, an Information component, active/planned runway filtering, operator-selected ACC feeders, and FLOW feeder positioning. Explicit secondary-runway arrivals and future-bank availability are validated without modifying SDK assignments. Priority limits can allocate real work to lower-priority followers but never hide an impossible constraint. Extra flight and Insert Slot are removed from the current callsign menu. Recording deduplicates non-terminated flight-plan inventories.

Coordination uses a dedicated authenticated room command. Read-only observation remains a voluntary sequence-edit restriction; every connected member can send and acknowledge coordination. Concurrent acknowledgements, sequencer handover and uncertain-response retries are covered. Existing messages are not replayed to a newly opened room window. No deployed-server success is implied by the protocol fixture checks.

214 model/adapter checks, UI type checking and native context/embedded-window checks are required. The native UI check opens the actual right-click menu and Information dialog, counts ten coordination choices and checks the solid draft marker. The SAS9EJ recording is replayed separately to guard the previous Recompute fix.
