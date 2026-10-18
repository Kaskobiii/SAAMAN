# SAAMAN 1.3.28

Missed Approach now lists aircraft as buttons. Click an aircraft to open
Reinsert on, then click its IAF to apply immediately. There are no checkboxes
or second confirmation. TEB, BALVI, ERXEC and OBCIV are shown; only fixes with
a bundled approach profile for the assigned runway are enabled.

The selected fix provides an explicit planning route when EuroScope reports
only ESSA after a go-around. Landing ETA combines current distance/groundspeed
to the fix with the runway-specific standard approach distance and existing
aircraft approach/landing performance model. This does not add a second speed
buffer. Crossing the fix starts the approach leg once; later updates do not
send the aircraft back to the fix. A positively observed new approach or final
replaces the planning route. The selection is shared and survives a checkpoint
reload; Recompute does not add another approach leg.

Automatic recovery no longer accepts a short path to the airport or to the
runway threshold from the wrong side as a complete approach. In recording 5,
ICE306 incorrectly rejoined Frozen at 12:27:38 UTC with an ETA of 12:30:02 while
approaching from north/east of runway 01R on a southerly track. It now waits for
a valid inbound approach or the controller's IAF selection.

The route is a planning assumption selected by the controller. It does not
issue a direct clearance or control the pilot. Longer vectors, holding and
pilot deviations can still change the actual landing time.

Validation: 437 model/adapter tests, including ICE306's false re-entry,
IAF selection, runway-specific availability, fix passage and repeated Recompute
after checkpoint restoration. Strict TypeScript/Vue checks and x86/native
window/input tests are also run for the local test package. The native test
checks aircraft selection, absence of checkboxes and immediate IAF insertion.

Includes the 1.3.25–1.3.27 fixes. Live verification and GitHub publication are
pending. Load in every instance, including the sequencer and proxy. No backend
update is required.
