# SAAMAN 1.3.46

## Approach speed applied near landing

Aircraft no longer use their approach speed simply because they are below 8,000 ft. The performance forecast keeps the aircraft's descent/terminal speed until the final part of the remaining route.

The slowdown starts 12 NM from landing, reaches the approach target at 8 NM and the landing target at 4 NM. This applies to every aircraft type. Each type retains its own speed references, the existing 180 kt approach cap and any lower assigned speed. Aircraft already flying slowly are not predicted to accelerate.

For example, a HondaJet still 40–50 route miles from landing is no longer forecast to fly all that distance at its 160 kt approach reference. This also reduces unnecessary delay assigned to aircraft following it.

Existing protected sequence times remain protected. When testing an existing sequence, Recompute the affected aircraft together to refresh their accepted times using the revised forecast.
