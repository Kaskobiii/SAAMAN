# SAAMAN controller guide

Use SAAMAN to agree an arrival sequence into Stockholm TMA and deliver aircraft to their feeder fixes in that sequence. APP uses the same plan to build the landing sequence. All times are UTC.

## Before the session

1. Load the same current SAAMAN DLL in every EuroScope instance. In OTHER SET → Plug-ins, place SAAMAN above TopSky so TopSky menus remain usable.
2. Select the correct ESSA ARR and DEP runways in EuroScope. Open AMAN and check the runway configuration. After a change, use **Sync EuroScope** and check the shared result. **Apply** confirms selections made in AMAN.
3. Shared mode connects automatically for ESOS/ESAA CTR, ESSA APP and ESSA_FMP. Other positions connect manually; TWR is view-only. A red **LIVE** above the clock means the shared connection is fresh.
4. With the backend priority update deployed, **ESSA_E_APP is sequencer whenever its SAAMAN is connected and responding**, then ESSA_FMP, then another eligible local position. Changing runways does not displace a higher-priority sequencer. Everyone can still submit permitted edits.

The sequencer supplies the shared traffic picture. A direct EuroScope connection supplies data; its proxy follows the plan. Keep both instances on the same DLL version. If a sequencer-version warning appears, have that controller update.

## Read the timeline

Time increases upwards. An aircraft above the red **NOW** line is scheduled for later; its position moves towards NOW as the assigned time approaches. The number beside its callsign is the minute of its assigned time, not minutes remaining.

| View | What the aircraft position means | Who uses it |
|---|---|---|
| ACC | Assigned feeder-crossing time, STA-FF | ACC: deliver aircraft to the feeder in this order |
| ARR-W | Assigned ELTOK crossing time | ESSA_W_APP: manage the ELTOK feeder |
| Runway | Assigned landing time, STA | APP: build the runway sequence |
| FLOW | Overview of the shared arrival flow | All controllers |

ACC coverage follows your callsign and the other online sectors. When a lower sector opens or closes, your covered feeders update. ESSA_W_APP has ARR-W with ELTOK. The other APP receiver positions do not own feeder fixes. Runway and FLOW remain available to everyone without that feeder filter.

**L / TTL** means time to lose before the feeder. **G / TTG** means time to gain. In the AMAN label, a positive delay number means lose; a negative number means gain. EuroScope line 0 uses L and G. The detailed assigned and estimated times are in **Information**.

| Delay-number colour | Entry-speed action |
|---|---|
| Yellow | Give entry speed **250 kt** |
| Red | Give entry speed **230 kt** |

These are entry speeds in knots IAS, not groundspeed. A red L03 therefore means both lose about three minutes and plan 230 kt at entry. Colour belongs to the delay number; the aircraft's own colour indicates its planning phase.

## ACC: deliver the feeder sequence

1. Select **ACC** and find the feeder you cover. Read the assigned crossing times and order.
2. Apply speed control, vectors or holding upstream to meet those times. Coordinate the intended entry order and speed with the receiving controller.
3. Monitor the instruction as the aircraft flies the delay. Do not keep pressing Recompute to count it down: Recompute accepts a fresh prediction and can change the assignment.
4. If another order works better, **click one aircraft and then the other to swap their places** in your feeder sequence. Check the resulting times and fly the agreed order.

SAAMAN reserves separate crossing times for aircraft at the same feeder, including aircraft assigned different landing runways. When two initially want the same crossing time, use the displayed order and the resulting lose instruction to separate them. Information shows the exact assigned crossing times, including seconds.

## ACC example: L03 before the feeder

SAS123 is assigned ELTOK at **12:10**, but would reach it around **12:07**. Line 0 shows **L03**.

1. Turn SAS123 before ELTOK to absorb time and keep it outside the feeder while required. With a red number, give **230 kt entry speed**.
2. Monitor the remaining lose time as the delay is flown.
3. When it reaches **L00**, turn towards ELTOK: the turn towards the feeder absorbs the remaining seconds. In AMAN itself, the zero-minute delay number is blank.
4. Deliver SAS123 in the agreed order, aiming for the assigned **12:10** feeder crossing. Complete the normal transfer to APP.

![Illustrated ACC timeline: lose three minutes before ELTOK, then turn towards the feeder at L00](images/acc-l03-example.png)

This illustration shows the same assigned crossing time throughout. The changing instruction tells ACC how much work remains before entry.

## ACC example: five minutes or more — holding

If SAS456 has **L05** or more, holding may be more practical than prolonged vectoring. Coordinate the hold, level and release sequence with the receiving controller, and use the published holding procedure or the instructions you issue.

1. Note SAS456's **assigned feeder time** before holding it. For example, ELTOK **12:15**.
2. Hold it to absorb the excess time. Keep its assigned slot unless you intend to change the plan; routine Recompute during the hold can replace the timing reference you are working towards.
3. Plan the exit from the hold so the aircraft crosses the feeder inbound for TMA at its assigned time. Account for its position in the racetrack and the time needed to turn inbound.
4. Release it in sequence and apply the indicated entry speed. If it will miss its slot, coordinate and amend the sequence rather than rushing it to catch up.

**Stockholm's holds are at the feeder fixes.** Crossing the fix to enter the hold is not the operational release into TMA. Once AMAN has recorded that crossing, its L/G number can disappear under the TMA display policy. Continue using the assigned **STA-FF and NOW line** for the release: exit so the next inbound crossing matches the slot. Do not treat a disappearing label or each subsequent hold crossing as permission to release.

![Illustrated holding example: retain ELTOK 12:15 and time the inbound exit to meet that slot](images/acc-holding-example.png)

The timeline is the timing aid; AMAN does not clear the aircraft out of the hold or time the hold exit for you.

## APP: build the landing sequence

1. Select **Runway** to see the common landing sequence. Use **FLOW** for the overall picture and coordinate feeder delivery with ACC or ARR-W.
2. Accept the entry order, then use your normal speeds and vectors to build final approach spacing towards the assigned landing times.
3. **Inside TMA, aircraft show assigned sequence times without L/G instructions.** Changing their order or recomputing can change the landing slots; it does not issue a new ACC-style delay instruction. Required runway spacing still applies.
4. To swap aircraft, click one and then the other. To insert an aircraft elsewhere, select it and use the insertion arrow on the timeline. Check the resulting order and times after each edit.
5. Use **Recompute** after a meaningful route change, direct clearance or approach change when you want AMAN to accept a new estimate. For aircraft already inside TMA, Recompute recognises their TMA phase. **Refresh delay** refreshes the instruction reference; it is not a way to erase required spacing upstream.

If an aircraft goes around, open **Missed Approach**, select it and choose **Reinsert on**, then **TEB, BALVI, ERXEC or OBCIV** as appropriate to the new clearance. Selecting the fix reinserts it. Check its new slot and coordinate the resulting sequence. Do not repeatedly recompute an aircraft still flying away with no usable approach route.

## Common actions

| Situation | Action |
|---|---|
| No flight plan | MAESTRO → Insert flight; add the aircraft and place it in the sequence. A later live flight plan replaces the placeholder. |
| Temporary runway gap or closure | In Runway view, right-click the timeline and insert a gap or closure. Check the affected slots. |
| Runway change | Set EuroScope's ESSA ARR and DEP, Sync EuroScope, then check the shared header and aircraft assignments. Configuration changes do not rewrite flight-plan runway assignments. |
| Coordination message | Open Coordinations and choose the message. Recipients see sender and UTC time; Acknowledge closes the popup immediately. |
| Unexpected time or state | Open Information and Errors. Check route, assigned runway, shared connection and sequencer version before changing the sequence. |

Unstable times are provisional. Stable protects the accepted sequence, subject to an earlier new arrival or manual changes. Superstable and Frozen represent later planning phases; they do not remove the need to fly the required separation. Closing the AMAN pane does not stop background shared updates or eligible ACC tag instructions.
