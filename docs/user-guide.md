# SAAMAN user guide

For practical ACC and APP workflows, worked L03 and holding examples, and illustrations, read the new controller guide (`controller-guide.html` or `controller-guide.md`).

SAAMAN is the arrival manager for ESSA in EuroScope. Use it to view the shared arrival sequence, manage aircraft positions and coordinate with other controllers. All times shown are UTC.

## 1. Install and open

1. Obtain the approved SAAMAN package from VATSIM Scandinavia or your test coordinator. Keep the included instructions and licenses.
2. Unload the previous AMAN/MAESTRO plugin before loading `SAAMAN.dll` through **OTHER SET → Plug-ins → Load**. Microsoft Edge WebView2 Runtime must be installed.
3. Allow SAAMAN to draw on your radar screen in the plug-in settings if required by your profile. In the same plug-in list, select **SAAMAN** and use **Up** to place it **above TopSky**. This keeps TopSky menus visible and clickable over AMAN. Save your EuroScope profile after changing the order.
4. Click the **COTS / AMAN** launcher, or enter `.saaman` in EuroScope. Move the pane by dragging its title bar; resize it from the bottom-right corner. The top-right close button hides the pane. Use **Ctrl + mouse wheel** to zoom; AMAN and its windows share the same scale.

## 2. Connect for a session

Select the active ESSA runways in EuroScope for **both ARR and DEP**, then connect with your normal controller callsign.

In shared mode, SAAMAN connects automatically in the background when the plugin is loaded and EuroScope is connected as ESOS/ESAA CTR, ESSA APP or ESSA_FMP. Other positions can connect manually; priming to an eligible local position enables automatic connection. Opening the AMAN pane is not required. It waits for login if you load it while disconnected, and keeps syncing when the pane is hidden.

With two EuroScope windows using the same callsign, keep SAAMAN loaded in the directly connected window. The proxy window follows the shared sequence and can submit edits to the sequencer; it does not start a second sequencer or replace the shared runway configuration from its own selections.

A red **LIVE** above the top-right clock indicates a fresh shared-backend connection. It disappears when that connection is unavailable and is not shown in local mode.

To change connection settings, open **MAESTRO → Operation mode**. Choose **Shared backend**, select **vatIRIS · EuroScope callsign**, and use `https://backend.vatiris.se`. Select **VATSIM live**, **SweatBox 1** or **SweatBox 2**, matching your session, then press **Save connection**.

A fresh installation starts in shared vatIRIS mode with VATSIM live selected. A mode you explicitly save is remembered; choose a SweatBox network for training.

Shared operation requires the vatIRIS AMAN backend to be available. You do not need the vatIRIS desktop application, a separate vatIRIS login or an ordinary controller key. Controllers on the same network share one ESSA sequence; exercise/channel names do not create separate rooms in this mode.

The sequencer is selected automatically. Other connected controllers can edit the same sequence. **Observe only** receives the shared sequence without enabling aircraft edits. **Local EuroScope** is available for individual use and does not share changes or coordination messages.

TWR callsigns, including handover callsigns, automatically use observer mode. They can view the sequence but cannot edit it, change settings or send coordinations.

When joining a fresh shared session as sequencer, SAAMAN reads the selected EuroScope arrival and departure runways. Check the configuration shown at the top before using the sequence. Shared mode should show current data before you start editing.

## 3. Choose a view

| View | Use |
| --- | --- |
| Runway | Landing sequence, grouped by runway. Use this when managing the overall landing order, closures and gaps. |
| ACC | Aircraft at their feeder fixes, limited to the fixes your current sector covers. Coverage updates when other sectors connect or disconnect. |
| ARR-W | Shown for ESSA_W_APP, including handover callsigns. Displays ELTOK traffic. |
| FLOW | Overview of all inbound feeder flows. |

Other receiving APP positions use Runway and FLOW. Those two views remain unfiltered for everyone.

The red horizontal line marks **NOW**; later times appear above it. Use the left overview to scroll in time and the bottom scrollbar to move between columns. Click a clock beneath a timeline to change the label items.

## 4. Read aircraft labels

Labels show the scheduled minute and callsign, with delay information and optional aircraft details. **TTL / L** means time to lose; **TTG / G** means time to gain. The **Information** window shows the detailed times, including seconds, and the remaining route.

If an aircraft bypasses its feeder fix, the current feeder ETA is shown as **—**. The assigned feeder time and existing instruction remain until you change the sequence or Recompute.

| Callsign colour | State |
| --- | --- |
| Blue | Unstable |
| Green | Stable |
| White | Superstable |
| Turquoise | Frozen |
| Pink | Landed |

Submenus and dialogs can be moved outside AMAN by dragging their title bars.

The **Missed Approach**, **Desequenced** and **Errors** buttons appear when their lists contain something.

Click a label to highlight and select it. Right-click it to open its callsign menu. Press **Escape** to cancel a selection or drag.

## 5. Manage the sequence

Use **Runway** view when changing the overall landing order. Select an aircraft, then move the pointer onto its timeline: an arrow shows the proposed insertion point. Click to confirm. Hover over another callsign to show the swap icon, then click that callsign to exchange their sequence positions. Times are recalculated using the current estimates and required spacing. You can also drag to an arrow position or drop onto another callsign to swap. Frozen and Superstable aircraft can also be adjusted manually. Swaps use the same runway; feeder views also require the same feeder. Normal spacing and closures still apply.

The callsign menu provides the main actions:

- **Information:** inspect the aircraft's times and remaining route.
- **Insert arrival → Before / After:** place an aircraft relative to another arrival.
- **Change Runway:** assign the aircraft to any supported runway, including an inactive or departure-only runway. This adds its timeline column without changing the shared runway configuration.
- **De-sequence:** temporarily take an aircraft out of the sequence. Use **Desequenced** to select it and **Resume** when ready.
- **Missed approach:** mark a go-around. Use **Missed Approach** to manage the affected aircraft and place it back when appropriate.
- **Mark landed:** correct an aircraft that has landed but remains active in the sequence.
- **Recompute:** deliberately refresh the aircraft's accepted planning data. Coordinate its use when it could change the shared sequence.
- **Remove:** remove the aircraft from AMAN.

Drag across an empty timeline area to select several aircraft for the available group actions. Clear an individual selection with **Escape** first, or hold **Shift** while starting the selection box. Aircraft manually added without a flight plan can be moved both earlier and later; the new time is retained. A live flight replaces and retires its manual placeholder. An unused reservation expires after its latest assigned time has passed; add it again if needed. Use the shared sequence together with normal controller coordination.

## 6. Rates, runways and gaps

Click the runway configuration box to change arrival/departure configuration. **Sync EuroScope** applies EuroScope's current ESSA ARR and DEP selections immediately. Click the rate box to change an arrival rate, from **6 to 60 aircraft per hour**. Use **Apply now** or choose a future application time and press **Apply**. Check any planned change shown in the header.

In Runway view, right-click an empty timeline area and select **Insert closure** or **Insert gap**. You can also insert either before or after an aircraft from its callsign menu. Click the block to edit its start and duration or remove it; drag the body to move it, or an edge to adjust its length.

## 7. Send and acknowledge coordination

Click **Coordinations** and choose one of the listed messages. Incoming messages appear in a separate window centered over EuroScope, showing the sender's login callsign and UTC send time. With a direct and proxy connection, the popup appears only in the direct instance. Click **Acknowledge** to close it immediately. If several messages are waiting, acknowledge them in turn. These messages also appear while the AMAN pane is hidden.

## 8. If something looks wrong

- Open **Errors** to read the diagnostic message.
- If configuration is waiting, check that ESSA has both ARR and DEP selected. `.saaman runways` shows what the plugin detected.
- If shared data is stale or edits are unavailable, check your EuroScope connection, callsign, selected network and backend address. Avoid making repeated edits while an earlier change is awaiting confirmation.
- `.saaman status` shows connection information. When reporting a problem, include the plugin version, callsign, network, action taken and diagnostic text.

The supervisory pane is available with `.saaman supervisor` for authorised users. Its shared settings include feeder/fallback allowances and a landing correction limit. Landing ETA updates live; changing these settings leaves existing assigned slots in place until Recompute. Information shows the current ETA alongside the assigned STA. The aircraft performance profile used for the current forecast is shown in supervision. Blue Unstable aircraft have provisional scheduled times that update with the forecast and required spacing. Manual time targets remain fixed. Stable and later assignments retain their existing protection; use Recompute to accept a fresh estimate when needed. For an initial-timing test, start recording before the aircraft first appears in AMAN and continue through the feeder and landing. Captures made before recording started are marked as unavailable in the export. A confirmed runway change updates the approach and planning times while retaining sequence order. A dash at a route point means its crossing time is unavailable, for example during vectoring.

## Shared connection and sequencer

The sequencer supplies the EuroScope traffic and runway data for everyone. ESOS/ESAA CTR, ESSA APP and ESSA_FMP positions can be sequencer; handover callsigns are supported. Other positions may follow and edit but cannot take sequencing ownership. Tower positions remain observers. With the backend priority update deployed, ESSA_E_APP is preferred whenever its direct SAAMAN instance is connected, then ESSA_FMP, then another eligible local position. A runway Apply does not displace a higher-priority sequencer. Successful changes remain shared, and the new sequencer preserves that confirmed plan. Set both ARR and DEP correctly in EuroScope before Sync EuroScope. The first sequencer initializes the plan from EuroScope. Changing the shared configuration does not change another controller's EuroScope settings or flight-plan runway assignments.

Shared mode connects automatically after login only for ESOS/ESAA CTR, ESSA APP and ESSA_FMP. Other positions, including ESMM and TWR, may connect manually from Operation mode; TWR remains view-only. Priming from ESMM to ESOS, ESAA or ESSA enables automatic connection without reloading the plugin. With no eligible sequencer connected, the shared sequence waits. Local mode remains a separate secondary mode.

For a missed approach, open Missed Approach, select the aircraft and choose Reinsert on, then the initial approach fix. That selection immediately reinserts the aircraft. An estimate based on a heading alone is not treated as a new approach clearance.

## TMA instructions and version warnings

After recorded feeder passage or accepted TMA entry, the timeline and Information show assigned sequence times without ACC gain/lose instructions. TopSky line 0 clears for those aircraft. Internal spacing and landing estimates remain available to the sequencer; Recompute and order changes still respect runway spacing. TopSky HOLD at the feeder keeps it upstream in AMAN and retains its line 0 instruction through holding crossings. The lose time reduces towards the protected feeder slot. Clear HOLD when leaving towards TMA.

A sequencer-version warning compares the reported sequencer build with the local build and other reported connected builds. An older build is flagged; a DLL that cannot report its build is marked version unknown. It does not query private GitHub releases anonymously.
