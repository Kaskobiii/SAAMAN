# SAAMAN 1.3.47 test

- Added a standalone browser editor for the vatIRIS website. Use a callsign already connected in EuroScope; the browser edits its shared sequence without needing a second VATSIM connection.
- Browser clients cannot publish aircraft calculations, take the sequencer role or release the desktop controller's lease. Runway changes from the browser keep the existing sequencer.
- Added a callsign action button for tablet use, inline menus and browser coordination acknowledgement. EuroScope-only functions are hidden.
- Browser edits recheck shared freshness and reject a sequence reset before sending an old placement. Tower callsigns remain read-only.
- Prepared a separate vatIRIS TopSky feed projection so controllers without the DLL receive the same feeder-row suppression as native clients. The backend change must be deployed before switching the feed.

This test build also includes the approach-distance correction from 1.3.46: terminal descent speed is retained farther out, with approach slowdown in the final 12–8 NM. Existing protected times remain protected; Recompute affected aircraft together to refresh an existing sequence.

The browser hosting and TopSky backend changes are separate, focused vatIRIS changes. They do not copy the browser UI or its dependencies into vatIRIS. No live deployment is performed by building this package.
