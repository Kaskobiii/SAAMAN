#pragma once
#include "json.hpp"
#include "aircraft_highlight.h"
#include <filesystem>
#include <mutex>
#include <chrono>
#include <string>
namespace saaman {
using Json=nlohmann::json;
inline long long Now(){return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();}
struct Context {
    std::mutex mutex;
    std::filesystem::path directory,profile,storage;
    Json telemetry={{"timestamp",Now()},{"source","Waiting for EuroScope"},{"flights",Json::array()}};
    Json plan={{"revision",0},{"config",nullptr},{"edits",Json::object()},{"snapshot",nullptr},{"masterCid",nullptr}};
    Json timing=Json::object(),sequence=Json::object();
    long long timingAt=0,lastSavedAt=0;
    long long captureAttemptAt=0,captureSuccessAt=0;
    std::string captureError;
    unsigned receivers=0;
    bool shared=true,test=false,runwayConfigInitialized=false,sdkSurfaces=true;
    std::string backend="https://backend.vatiris.se",authProvider="vatiris-callsign";
    long long controllerCid=0;
    Json relay={{"network","live"},{"session","essa-test-01"},{"channel","saaman"}};
    std::string instanceId;
    AircraftSelection aircraftSelection;
    AircraftHover aircraftHover;
    bool aircraftLinkConnected=false;
    explicit Context(std::filesystem::path folder,std::filesystem::path stateFolder={});
    Json Request(const std::string& method,const Json& data,bool supervisor);
    void SavePlan();
    void SeedRunwayConfig();
};
struct RequestError:std::runtime_error{int status;RequestError(int code,const std::string& text):std::runtime_error(text),status(code){}};
}
