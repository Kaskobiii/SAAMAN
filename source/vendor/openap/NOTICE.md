# OpenAP data used by SAAMAN

Source: https://github.com/junzis/openap at commit a19a1cd559aa51c2ff385a71ee1884a53d866a33 (2.6.2).
Authors: Junzi Sun, Jacco M. Hoekstra and Joost Ellerbroek; upstream contributors.
The data-directory license is GNU GPL version 3, included at openap/data/LICENSE.
The upstream library license is included at LICENSE; the Python library is not embedded or required at runtime.

References: Sun, Hoekstra & Ellerbroek (2020), OpenAP: An Open-Source Aircraft Performance Model for Air Transportation Studies and Simulations, Aerospace 7(8), 104. Sun, Ellerbroek & Hoekstra (2019), WRAP: An open-source kinematic aircraft performance model, Transportation Research Part C 98, 118–138.

SAAMAN converts source data into deterministic JSON with scripts/import-openap.mjs. Numeric values are retained in their original units until the runtime adapter converts them. Local source files have normalized final newlines; SHA256 hashes of the vendored inputs are recorded in the generated JSON. Exact WRAP coverage and upstream synonyms are kept separate. Statistical ranges are not certified operating limits. Aircraft VMO/MMO/ceiling properties, where available, are separate from the statistical timing model. ATR-to-jet synonyms are deliberately excluded by SAAMAN.
