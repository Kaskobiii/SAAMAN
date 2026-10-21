#pragma once
#include <chrono>
#include <cstdint>
#include <string>
#include <string_view>
namespace saaman {
inline int64_t AircraftLinkTick(){return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();}
inline bool AircraftLinkCallsign(std::string_view call){
    if(call.empty())return true;
    if(call.size()<2||call.size()>16)return false;
    for(const char c:call)if(!(c>='A'&&c<='Z')&&!(c>='0'&&c<='9')&&c!='_'&&c!='-')return false;
    return true;
}
// Local visual state only. A monotonic lease removes a marker even if the
// renderer misses pointerleave, closes unexpectedly, or the PC clock changes.
struct AircraftHover {
    std::string callsign;
    int64_t at=0;
    void Clear(){callsign.clear();at=0;}
    void Set(const std::string& call,int64_t tick){callsign=call;at=call.empty()?0:tick;}
    std::string Active(int64_t tick)const{return !callsign.empty()&&tick>=at&&tick-at<=2500?callsign:std::string();}
};
}
