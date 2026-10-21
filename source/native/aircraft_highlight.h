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
// Keep polling identity separate from the temporary highlight. Repeated SDK
// reads do not renew it; a fresh selection click can reselect the same aircraft.
struct AircraftSelection {
    std::string observed,current;
    int64_t at=0;
    void Clear(){observed.clear();current.clear();at=0;}
    std::string Active(int64_t tick)const{return !current.empty()&&tick>=at&&tick-at<3000?current:std::string();}
    bool Observe(const std::string& call,int64_t tick,bool selectedAgain=false){
        if(observed!=call||selectedAgain&&!call.empty()){observed=call;current=call;at=call.empty()?0:tick;return true;}
        if(!current.empty()&&Active(tick).empty()){current.clear();at=0;return true;}
        return false;
    }
};
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
