# SAAMAN 1.3.15 — submenu repaint correction

Fixes blank Information and submenu windows immediately after opening them. Floating windows can now repaint normally when first sized to their contents; browser contents are invalidated after their new viewport is applied. Moving windows still uses the existing handling that prevents drag trails.

Native checks cover submenu resizing, dragging, reopening, closing, Information layout, runway sync and supervision. The Information screenshot is now captured before the test changes to another dialog.

The user verified the resulting DLL in EuroScope and confirmed that Information and the other submenus display correctly immediately. The isolated native host test validates the corrected repaint policy and visible Information layout; it did not reproduce the exact original live symptom.

The timing model, 398-aircraft performance database, shared sequencing and backend API are unchanged. No backend or settings changes are needed. Unload the previous DLL before replacing it.
