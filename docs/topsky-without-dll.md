# TopSky guidance without the SAAMAN DLL

An active shared SAAMAN sequencer can provide ESSA guidance to other controllers who only load TopSky. The HTTP feed uses the documented MAESTRO format.

The vatIRIS feed projection change must be deployed first. Its public filename endpoint is:

```
https://backend.vatiris.se/aman/MAESTRO_sequence_data_ESSA.json
```

For an ESSA-only TopSky profile, the corresponding settings are:

```
AMAN_Airports=ESSA
AMAN_URL=https://backend.vatiris.se/aman
```

The shared Scandinavia settings also name ESSB and EKCH. Do not replace that shared URL until their feeds have been arranged too. No shared sectorfile settings are changed by this implementation.

The public feed omits aircraft whose feeder guidance has ended: passed feeder, direct bypass/suppression and landed. Genuine upstream L00, HOLD and Frozen guidance remain. The backend preserves the sequencer's assigned times and instructions; it does not calculate a new sequence. Internal recovery checkpoints and command receipts are excluded from the public filename response. The full room URL used by SAAMAN remains unchanged.

## Verify after deployment

Use a TopSky-only EuroScope instance alongside the sequencer. Check lose/gain, L00 and HOLD; then verify that feeder passage, a direct bypass and landing clear the old instruction. Stop publication for more than 30 seconds and verify that TopSky clears old guidance when the feed returns a non-cacheable 404. Actual TopSky cache behavior still requires this client test.
