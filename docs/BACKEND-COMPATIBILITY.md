# vatIRIS backend compatibility

SAAMAN's shared mode requires a running vatIRIS AMAN backend using the existing
callsign API. The usual endpoint is `https://backend.vatiris.se`. A local controller
does not need the vatIRIS frontend or a separate vatIRIS login. Local EuroScope
mode remains independent of the backend. This test suite does not deploy a server
or establish which source version is deployed at the public endpoint.

## Tested dependency

`source/backend-compatibility.json` records the upstream repository, exact commit,
router path, SHA-256 and Express version from the upstream lockfile. The current pin is
`minsulander/vatiris@f9af707c4d9c2f1d88d8ed7f2d61a37087c90b37`, using
`backend/src/routes/aman.ts`. The pinned source checksum is checked before it runs.

The runner downloads and bundles that real router, starts a server bound to
`127.0.0.1` on a temporary port, and exercises SAAMAN's actual SharedRelay and
LegacyRelay over HTTP. It does not replace the room/command implementation with
a fake server. Only the external VATSIM controller feed is supplied by a controlled
fixture. There is no database, production traffic or public AMAN write.

Checks cover shared publications, aircraft edits, coordination sender/time and
acknowledgements, supervision settings, sequencer release/expiry and takeover,
network separation, read-only observation, lost-response retries, live controller
validation, unavailable/stale feed rejection and an optional training key.

## Running locally

```powershell
cd source/ui
npm ci --no-audit --no-fund
npm run test:backend
npm run test:backend:upstream
```

The upstream command resolves `main` to an exact commit before downloading source
and prints both the commit and checksum. A failure there indicates a compatibility
problem or a download failure that should be inspected before updating the pin.
The pinned command is reproducible and uses its recorded checksum.

GitHub Actions runs both targets on pull requests, main pushes or a manual run.
It also runs the existing model/adapter tests and checks that guide exports are current.
No recurring schedule is configured.

For a local negative-control check, `node tests/run-backend-compatibility.mjs --router <file>`
can test a deliberately changed router. It reports LOCAL-UNPINNED and is not used
by the normal compatibility jobs. Removing the publication route should fail the
sequence/edits tests; this checks that the test actually depends on the real API.

To update the pin, review the upstream AMAN changes, record the new commit and raw
file checksum, align Express with its lockfile when needed, run both targets and
the model tests, and review the repository change before adopting it.
