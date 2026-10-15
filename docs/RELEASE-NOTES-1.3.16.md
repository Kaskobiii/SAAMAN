# SAAMAN 1.3.16 — selection, insertion previews and swaps

- Clicking an aircraft highlights its label. An arrow on its timeline previews the insertion point; click to confirm.
- Hovering over another available callsign shows a swap icon and highlights the destination. Click to exchange their slots, or drag and drop onto the callsign.
- Swaps use the same runway; ACC, ARR-W and FLOW also require the same feeder. Existing rate, wake spacing and closure constraints still apply.
- Manual entries without a flight plan can be dragged earlier or later and retain their new assigned time across updates. A matching live flight uses the existing live-aircraft drag policy.
- Escape cancels selection or a pending drag. Clear selection or use Shift when starting a group-selection box. Observer and TWR users can highlight labels but cannot change the sequence.

Validation: 341 model tests, strict UI type checking, x86 release build, native context tests and native UI smoke. The native checks exercise click insertion, click swapping, drag swapping, later manual drag persistence, actual highlight colours and visible arrow/swap screenshots. Existing floating submenu repaint and drag-trail checks remain enabled.

The landing predictor and performance database are unchanged. No backend update is needed. Unload the previous DLL before replacing it.
