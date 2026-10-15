# SAAMAN 1.3.15 — submenu repaint test build

This prerelease addresses a native repaint problem in the shared submenu-window path. Floating windows can now repaint normally when first sized to their contents; browser contents are invalidated after their new viewport is applied. Moving windows still uses the existing handling that prevents drag trails.

Native checks cover submenu resizing, dragging, reopening, closing, Information layout, runway sync and supervision. The Information screenshot is now captured before the test changes to another dialog.

The exact blank-panel symptom reported in live EuroScope was not reproduced by the isolated host test. Please check Information and other submenus after loading this build, including moving them outside AMAN. This is a prerelease pending that confirmation.

The timing model, 398-aircraft performance database, shared sequencing and backend API are unchanged. No backend or settings changes are needed. Unload the previous DLL before replacing it.
