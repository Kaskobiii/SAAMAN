#pragma once
#include <map>
#include <string>
#include <string_view>
#include <cstdint>
namespace saaman {
// Read-only TopSky wire data: annotation 6 contains h/POINT/h;
// network HOLD/XHOLD updates use the scratchpad. Never write either field.
inline bool HoldingPointName(std::string_view p){
    if(p.empty()||p.size()>12)return false;
    for(const char c:p)if(!(c>='A'&&c<='Z')&&!(c>='0'&&c<='9')&&c!='_'&&c!='-')return false;
    return true;
}
inline std::string TopSkyHoldingPoint(const char* annotation){
    const std::string_view s=annotation?annotation:"";
    const auto begin=s.find("h/");if(begin==s.npos)return {};
    const auto end=s.find("/h",begin+2);if(end==s.npos)return {};
    const auto point=s.substr(begin+2,end-begin-2);
    return HoldingPointName(point)?std::string(point):std::string();
}
class TopSkyHoldingCache {
    struct Entry{std::string point,scratch;bool commanded=false;int64_t seen=0;};
    std::map<std::string,Entry> entries;
public:
    void Command(const std::string& call,const char* scratch,int64_t now){
        auto& e=entries[call];e.scratch=scratch?scratch:"";e.seen=now;
        const std::string_view s=e.scratch;
        if(s.find("/XHOLD/")!=s.npos){e.point.clear();e.commanded=true;return;}
        const auto begin=s.find("/HOLD/");if(begin==s.npos)return;
        const auto end=s.find('/',begin+6);if(end==s.npos)return;
        const auto point=s.substr(begin+6,end-begin-6);
        if(HoldingPointName(point)){e.point=std::string(point);e.commanded=true;}
    }
    std::string Observe(const std::string& call,const char* scratch,const char* annotation,int64_t now){
        auto& e=entries[call];e.seen=now;
        if(e.scratch!=(scratch?scratch:""))Command(call,scratch,now);
        // A received network command wins over a missing or stale strip copy.
        if(!e.commanded)e.point=TopSkyHoldingPoint(annotation);
        for(auto it=entries.begin();it!=entries.end();)if(now-it->second.seen>300000)it=entries.erase(it);else ++it;
        return e.point;
    }
    void Clear(){entries.clear();}
    void Forget(const std::string& call){entries.erase(call);}
};
}
