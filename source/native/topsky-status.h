#pragma once
#include <string_view>
namespace saaman {
// TopSky manual alerts are embedded in EuroScope's scratchpad. Read only:
// MISAP_ is the wire marker, while MAPP is the displayed label text.
inline bool TopSkyMissedApproach(const char* scratchpad) {
    return scratchpad && std::string_view(scratchpad).find("MISAP_") != std::string_view::npos;
}
}
