# OpenAP in SAAMAN 1.0.17

Open the separate supervisory panel, edit shared settings, and select STAR timing model â†’ Aircraft performance â†’ OpenAP (experimental). Save. EuroScope profiles remain the default, including when an older saved config has no provider field. The setting is canonical in shared mode and ordinary controllers cannot change it.

## Data and reproducibility

OpenAP 2.6.2 source data is pinned to commit `a19a1cd559aa51c2ff385a71ee1884a53d866a33`. There are 17 exact WRAP timing models and 37 aircraft-property files. `vendor/openap` contains the original data and licenses; `scripts/import-openap.mjs` generates `ui/src/data/openap-profiles.json` deterministically without network access. The Python package is not required at runtime. Data is GPL-3.0 under its own upstream license; the plugin package includes editable source and notices.

WRAP speeds are converted from m/s to knots, crossover altitudes from km to feet, vertical rates from m/s to ft/min with descent sign normalized. Property ceiling is metres; VMO is knots CAS and MMO is Mach. A3xx/737 MAX/regional variants may have aircraft properties but use a different upstream WRAP model. The supervisor therefore shows provider, exact/proxy/fallback match, timing profile type and pinned source revision separately.

ATR-to-E190 aliases are blocked. Unsupported types retain an explicit EuroScope timing fallback, or generic timing when no usable profile exists. The importer excludes suspicious VMO values outside 100â€“400 kt rather than interpreting them as capability; B788/B789 source values of 515 are excluded and recorded in source metadata. No missing limit is invented.

## Scope and limits

The adapter feeds pre-feeder planning, STAR/vector path travel times, descent floors, profile metadata and gain-capacity checks. A phase-dependent nominal reference is selected from WRAP. Between the after-CAS crossover and 3,000 ft, nominal descent CAS is linearly interpolated to final-approach CAS; this interpolation is a SAAMAN planning assumption, not an upstream sampled trajectory.

WRAP means/ranges are statistical references, not operating limits. Explicit controller/configured approach/base/final speeds take precedence over WRAP nominal means. OpenAP property VMO/MMO values, when retained by sanity checks, bound those requested speeds. The legacy provider preserves its previous nominal-speed cap. Thus comparisons include both source data and the policy of respecting configured speeds; they do not isolate database accuracy alone.

Automatic gain planning requires an exact WRAP match, retained VMO/MMO properties, an aircraft within the property ceiling, and all the existing conservative geometry/speed/altitude checks. Proxies and fallbacks do not grant gain. Nominal speed remains a conservative gain reference. The existing response/acceleration allowances remain planning assumptions; thrust/drag, mass and wind-dependent dynamic reachability have not been implemented. This integration does not certify that any requested gain is achievable.

Switching provider preserves committed Superstable slots and instructions. It changes prediction inputs without replacing the sequence or clearing a controller's edits. Workbook distances, shortcut detection and final-position logic are otherwise unchanged.

## Shared backend compatibility

The opaque engine/checkpoint schema is now `saaman-1.0.17`, because older DLLs cannot apply the new canonical setting. Shared testers must use compatible 1.0.17 DLLs and a fresh channel, e.g. `saaman-openap`, if an existing room still has the older schema. This avoids changing or resetting another room. The relay needs no new backend code, but the existing room API must still be deployed. Current host tests do not verify real deployed authentication/multi-controller EuroScope operation.

## Recorded comparison

The supplied SweatBox recording provides five common 10 NM final crossings. The horizontal feeder-to-gate component's mean overestimate falls from about 262 s to 201 s with the new integration and unchanged workbook paths. With diagnostic measured-path substitution it falls from about 89 s to 41 s. These are isolated comparisons, not recovered historical DLL ETA/STA or validated landing times. The simulator remains at 3,000 ft near the runway, so final descent and touchdown cannot be validated from it.

See the delivered `OpenAP-comparison.md` and CSV. The default remains unchanged pending path-model corrections and broader verification.

## 1.0.20 predictor update
The earlier horizontal comparisons above describe the 1.0.17 experiment, not the current coupled predictor. Production now uses the energy-accounted kinematic solver documented in TRAJECTORY-MODEL.md. WRAP/property selection remains experimental and the default provider remains EuroScope. This release does not import a complete OpenAP force/thrust/mass model.
