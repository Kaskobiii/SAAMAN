# Browser editor

The browser follows the shared ESSA sequence and sends edits to its EuroScope sequencer. It does not calculate aircraft times, take the sequencer role or require another VATSIM connection.

Open the hosted editor, enter a callsign already connected in EuroScope, select the matching network and press **Connect**. For live traffic, the callsign must appear in the VATSIM ATC feed. Tower callsigns are read-only. **Disconnect** closes the browser session without disconnecting EuroScope.

Select an aircraft and press its callsign button to open its actions on a tablet. Recompute, runway/rate changes, swaps and timeline moves use the same shared commands as the DLL. Menus stay inside the browser. EuroScope-only controls, including **Sync EuroScope**, are not offered there.

The browser shows the publishing sequencer. Editing stops when the shared sequence or controller identity is unavailable. Keep a SAAMAN EuroScope sequencer running; opening a browser cannot start one.

## Hosting on vatIRIS

The hosting integration builds this repository at an exact pinned commit and copies the resulting static files under the vatIRIS website's `aman` directory. The intended address after deployment is `https://vatiris.se/aman/index.html`. Preparing the integration does not deploy that address.

Browser source and dependencies remain in SAAMAN. The vatIRIS repository only needs a small build hook and service-worker exclusions for `/aman`. Build failure must stop deployment before the existing S3 sync.

To build the static files separately:

```
cd source/ui
npm ci
npm run build:web
```

Upload the contents of `source/ui/dist-browser` to an HTTPS host. Assets use relative paths. Opening the files directly from disk is not a supported deployment.

The editor uses the backend's existing callsign policy and verifies the chosen live callsign against the VATSIM feed. Browser clients remain editors even when the chosen callsign is eligible to sequence ESSA.
