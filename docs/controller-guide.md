# SAAMAN controller guide

## Start

Load the current DLL in every instance, with SAAMAN above TopSky. Select ESSA ARR/DEP, press **Sync EuroScope**, and check **LIVE**.

## ACC: gain and lose time

![ELTOK vector with a white boxed TopSky-style label showing L03, on a map with the Stockholm TMA boundary](images/acc-read-label.png)

**L03:** lose three minutes before the feeder. **G:** time to gain.

**In AMAN:** yellow number = **250 kt** entry; red = **230 kt** entry. Both are IAS. Radar line 0 stays white.

## ACC: vectors

![A curved vector before ELTOK: SAS123 shows L03 outbound and L00 when turning towards the feeder](images/acc-l03-example.png)

At **L00**, turn towards the feeder; the turn absorbs the last seconds.

**The final sequence is your decision.** Click two aircraft on your feeder to swap them; their assigned times and lose/gain instructions update.

## ACC: holding

![SAS456 holding at ELTOK with L05 in a white boxed radar label](images/acc-holding-example.png)

Set **TopSky HOLD** at the feeder. Monitor the instruction, leave towards TMA at **L00**, and clear HOLD. Keep the assigned slot; do not repeatedly Recompute during the hold.

## APP: landing sequence

![Runway 19L sequence: SAS123 at 1500 feet followed by RYR782 at 2500 feet, with white boxed radar labels](images/app-sequence-example.png)

Use **Runway** to build the landing order. **Click two aircraft to swap**, or **drag** one to the insertion arrow. Inside TMA, use sequence times; ACC lose/gain instructions are hidden.

## Advanced

**Views**

**ACC** shows your covered feeders; **ARR-W** shows ELTOK for ESSA_W_APP. **Runway** and **FLOW** show all traffic. The red line is **NOW**; later times are above it.

**Runway configuration**

Click the arrival/departure runway box in the header. **Sync EuroScope** immediately shares your current ESSA ARR/DEP selections. For a manual change, select both runways and press **Apply**. Use the time slider to apply now or up to 60 minutes ahead. **Cancel planned changes** removes a pending change.

**Rate configuration**

Click the rate box in the header. Adjust the arrival-rate slider; the box shows aircraft per hour, seconds and NM. Choose the application time and press **Apply**. This changes the shared plan.

**Aircraft submenu — right-click a callsign**

| Button | Use |
|---|---|
| Information | Current and assigned times; **STA-FF** is the assigned feeder time. |
| Recompute | Accept a fresh estimate after a meaningful direct or approach change. |
| Refresh delay | Update the instruction while retaining the assigned plan. |
| Change Runway | Assign this aircraft another runway, including the departure runway. |
| Arrival route | Select the arrival profile and recompute. |
| Insert arrival | Place an aircraft before or after another. |
| Change ETA-FF | Enter a feeder estimate manually. |
| Maximum delay | Flag an instruction exceeding your selected limit. |
| De-sequence | Remove temporarily; return it through **Desequenced → Resume**. |
| Missed approach | Remove from the landing sequence for a go-around. |
| Mark landed / Remove | Correct landing status or remove the entry. |

**Other menus**

| Menu | Use |
|---|---|
| Empty timeline → Manually add flight | Add an aircraft without a flight plan. |
| Runway timeline → Insert gap / Insert closure | Reserve an interval. Drag the block or its edges to adjust it. |
| Missed Approach → aircraft → Reinsert on | Choose **TEB, BALVI, ERXEC or OBCIV** for reinsertion. |
| Coordinations | Send a listed message; **Acknowledge** closes incoming messages. |
| Errors | Read diagnostics and version warnings. |
| MAESTRO | Connection settings and ACC feeder coverage. |

ESSA_E_APP has sequencer priority, followed by ESSA_FMP. Shared updates continue with AMAN closed. Supervision and recording are available to authorised users through `.saaman supervisor`.

Illustrations use real ESSA geography and holding geometry, with example traffic and vectors. All times UTC.
