#include "context.h"
#include "maestro_timing.h"
#include "controller_key.h"
#include <fstream>
#include <set>
#include <vector>
#include <algorithm>
#include <windows.h>
namespace saaman {
namespace {
void MigrateConfig(Json& config){
    // Adding a release default is not a controller changing shared settings.
    if(config.is_object()&&!config.contains("performanceModel"))config["performanceModel"]="euroscope";
    if(config.is_object()){
        if(!config.contains("timingModel"))config["timingModel"]="euroscope-buffer";
        if(!config.contains("euroscopeBufferMinutes"))config["euroscopeBufferMinutes"]=2;
        if(!config.contains("euroscopeSuperstableBufferMinutes"))config["euroscopeSuperstableBufferMinutes"]=1;
        if(!config.contains("euroscopeHighSpeedBufferMinutes"))config["euroscopeHighSpeedBufferMinutes"]=6;
        const auto clampRates=[](Json& rates){if(rates.is_object())for(auto& value:rates)if(value.is_number())value=std::clamp(value.get<double>(),60.0,600.0);};
        if(config.contains("rates"))clampRates(config["rates"]);
        if(config.contains("pending")&&config["pending"].is_object()&&config["pending"].contains("rates"))clampRates(config["pending"]["rates"]);
        if(config.contains("pendingRate")&&config["pendingRate"].is_object()&&config["pendingRate"].contains("seconds")&&config["pendingRate"]["seconds"].is_number())config["pendingRate"]["seconds"]=std::clamp(config["pendingRate"]["seconds"].get<double>(),60.0,600.0);
        config["stableMinutes"]=15;config["superStableMinutes"]=4;
        if(!config.contains("coordinations"))config["coordinations"]=Json::array();
        if(config.contains("displayPreferences")&&config["displayPreferences"].is_object()&&config["displayPreferences"].contains("labels")&&config["displayPreferences"]["labels"].is_object()){
            config["displayPreferences"]["labels"]["type"]=true;config["displayPreferences"]["labels"]["currentDelay"]=true;
        }
    }
}
std::vector<std::filesystem::path> LegacyFolders(const std::filesystem::path& folder){
    std::vector<std::filesystem::path> result{folder};
    const auto root=folder.parent_path().filename()==L"releases"?folder.parent_path().parent_path():folder;
    if(root!=folder)result.push_back(root);
    std::error_code error;const auto releases=root/L"releases";
    for(std::filesystem::directory_iterator it(releases,error),end;!error&&it!=end;it.increment(error))if(it->is_directory(error)&&it->path()!=folder)result.push_back(it->path());
    return result;
}
Json ReadSaved(const std::filesystem::path& file){
    std::ifstream input(file,std::ios::binary|std::ios::ate);if(!input||input.tellg()>4*1024*1024)return Json();
    input.seekg(0);try{Json saved;input>>saved;return saved.is_object()?saved:Json();}catch(...){return Json();}
}
Json LoadSaved(const std::filesystem::path& storage,const std::vector<std::filesystem::path>& legacy,const wchar_t* name){
    const auto current=ReadSaved(storage/name);if(current.is_object())return current;
    Json newest;std::filesystem::file_time_type latest=std::filesystem::file_time_type::min();
    for(const auto& folder:legacy){std::error_code error;const auto file=folder/name;const auto modified=std::filesystem::last_write_time(file,error);if(error||modified<=latest)continue;
        auto saved=ReadSaved(file);if(saved.is_object()){newest=std::move(saved);latest=modified;}}
    return newest;
}
}
Context::Context(std::filesystem::path folder,std::filesystem::path stateFolder):directory(std::move(folder)),storage(stateFolder.empty()?directory:std::move(stateFolder)){
    instanceId="saaman-"+std::to_string(GetCurrentProcessId())+"-"+std::to_string(Now());
    wchar_t local[MAX_PATH]{};GetEnvironmentVariableW(L"LOCALAPPDATA",local,MAX_PATH);
    // Separate browser process/profile so a just-unloaded GPU-backed WebView
    // cannot be reused with incompatible software-rendering arguments.
    profile=std::filesystem::path(local)/L"SAAMAN"/L"WebViewProfile-software";
    const auto legacy=LegacyFolders(directory);
    try{
        const auto options=LoadSaved(storage,legacy,L"SAAMAN.json");if(options.is_object()){shared=options.value("shared",shared);backend=options.value("backendBaseUrl",backend);authProvider=options.value("authProvider",backend=="https://backend.vatiris.se"?std::string("vatiris-callsign"):std::string("keys"));
            if(options.contains("relay")&&options["relay"].is_object())relay=options["relay"];
            if(!ValidBackend(backend))backend="https://backend.vatiris.se";
            if(authProvider!="keys"&&authProvider!="vatiris"&&authProvider!="registered-cid"&&authProvider!="vatiris-callsign")authProvider="vatiris-callsign";
            if(options.contains("controllerCid")&&options["controllerCid"].is_number_integer())controllerCid=options["controllerCid"].get<long long>();
            if(controllerCid<1000||controllerCid>9999999999LL)controllerCid=0;
            // This deployment has moved from the test VM to the vatIRIS relay.
            if(backend=="https://vatsim-backend.tailc72bdf.ts.net"&&authProvider=="keys"){backend="https://backend.vatiris.se";authProvider="vatiris-callsign";}
            if(authProvider=="registered-cid"||(backend=="https://backend.vatiris.se"&&authProvider=="vatiris"))authProvider="vatiris-callsign";
        }
    }catch(...){}
    try{const auto saved=LoadSaved(storage,legacy,L"SAAMAN-plan.json");
        if(saved.is_object()&&saved.contains("config")){plan["config"]=saved["config"];
            const auto age=saved.contains("snapshot")&&saved["snapshot"].is_object()?Now()-saved["snapshot"].value("timestamp",0LL):600001;
            if(age>=-30000&&age<600000){plan["snapshot"]=saved["snapshot"];plan["edits"]=saved.value("edits",Json::object());plan["revision"]=saved.value("revision",0);if(saved.contains("telemetry"))plan["telemetry"]=saved["telemetry"];}}
    }catch(...){}
    MigrateConfig(plan["config"]);
}
void Context::SavePlan(){
    std::filesystem::create_directories(storage);
    const auto target=storage/L"SAAMAN-plan.json",temp=storage/L"SAAMAN-plan.json.tmp";
    {std::ofstream output(temp,std::ios::binary|std::ios::trunc);if(!output)throw RequestError(500,"Cannot save SAAMAN flight history");output<<plan.dump();if(!output)throw RequestError(500,"Plan write failed");}
    if(!MoveFileExW(temp.c_str(),target.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH))throw RequestError(500,"Cannot replace saved SAAMAN plan");
    lastSavedAt=Now();
}
void Context::SeedRunwayConfig(){
    if(shared||runwayConfigInitialized||!plan["config"].is_object())return;
    const auto active=telemetry.value("activeRunways",Json::object());
    const auto arrivals=active.value("arrivals",Json::array()),departures=active.value("departures",Json::array());
    static const std::set<std::string> allowed={"ESSA/01L","ESSA/01R","ESSA/08","ESSA/19L","ESSA/19R","ESSA/26"};
    for(const auto& runway:arrivals)if(runway.is_string()&&allowed.contains(runway.get<std::string>())){
        plan["config"]["active"]=Json::array({runway});
        for(const auto& departure:departures)if(departure.is_string()&&allowed.contains(departure.get<std::string>())){plan["config"]["departureRunway"]=departure;break;}
        if(plan["config"].contains("pending")&&plan["config"]["pending"].is_object()&&plan["config"]["pending"].value("at",0LL)<=Now())plan["config"].erase("pending");
        runwayConfigInitialized=true;plan["revision"]=plan["revision"].get<int>()+1;SavePlan();break;
    }
}
Json Context::Request(const std::string& method,const Json& data,bool supervisor){
    std::lock_guard lock(mutex);
    if(method=="host:info")return {{"shared",shared},{"backendBaseUrl",backend},{"authProvider",authProvider},{"controllerCid",controllerCid},{"relay",relay},{"instanceId",instanceId},{"view",supervisor?"supervisor":"aman"},{"test",test}};
    if(method=="key:read")return {{"key",authProvider=="keys"?ReadControllerKey(storage,backend):std::string{}}};
    if(method=="mode:set"){
        if(supervisor)throw RequestError(403,"Change connection mode in the normal AMAN");
        const auto nextBackend=data.value("backendBaseUrl",backend),nextProvider=data.value("authProvider",authProvider);
        if(!ValidBackend(nextBackend))throw RequestError(400,"Use an HTTPS server origin without a path, query or credentials");
        if(nextProvider!="keys"&&nextProvider!="vatiris"&&nextProvider!="vatiris-callsign")throw RequestError(400,"Invalid server authentication provider");
        const auto nextCid=data.value("controllerCid",controllerCid);
        if(nextCid!=0&&(nextCid<1000||nextCid>9999999999LL))throw RequestError(400,"Invalid controller CID");
        const auto key=data.value("controllerKey",std::string{});
        if(nextProvider=="keys"&&data.at("shared").get<bool>()&&key.empty()&&ReadControllerKey(storage,nextBackend).empty())throw RequestError(400,"Enter your controller key to join this backend");
        if(!key.empty()&&!ValidControllerKey(key))throw RequestError(400,"Invalid controller key format");
        Json nextRelay=relay;
        if(data.contains("relay")){
            const auto candidate=data.at("relay");const auto network=candidate.at("network").get<std::string>();
            if(network!="live"&&network!="sweatbox1"&&network!="sweatbox2")throw RequestError(400,"Invalid relay network");
            for(const auto name:{"session","channel"}){const auto value=candidate.at(name).get<std::string>();if(value.empty()||value.size()>48||std::string("abcdefghijklmnopqrstuvwxyz0123456789").find(value[0])==std::string::npos||value.find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789_-")!=std::string::npos)throw RequestError(400,"Invalid relay room");}
            nextRelay={{"network",network},{"session",candidate["session"]},{"channel",candidate["channel"]}};
        }
        const auto nextShared=data.at("shared").get<bool>();
        if(nextShared==shared&&nextBackend==backend&&nextProvider==authProvider&&nextCid==controllerCid&&nextRelay==relay&&(key.empty()||ReadControllerKey(storage,nextBackend)==key))return {{"shared",shared},{"changed",false}};
        if(!key.empty())SaveControllerKey(storage,nextBackend,key);
        std::filesystem::create_directories(storage);const auto settings=storage/L"SAAMAN.json",temp=storage/L"SAAMAN.json.tmp";
        {std::ofstream options(temp);if(!options)throw RequestError(500,"Cannot save connection settings");options<<Json({{"shared",data.at("shared")},{"backendBaseUrl",nextBackend},{"authProvider",nextProvider},{"controllerCid",nextCid},{"relay",nextRelay}}).dump(2);if(!options)throw RequestError(500,"Connection settings write failed");}
        if(!MoveFileExW(temp.c_str(),settings.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH))throw RequestError(500,"Cannot replace connection settings");
        backend=nextBackend;authProvider=nextProvider;controllerCid=nextCid;relay=nextRelay;shared=nextShared;timing.clear();if(sequence.is_object()&&!sequence.empty()){sequence["sequence"]=Json::array();sequence["data"]["source"]="MODE CHANGE";sequence["data"]["timestamp"]=Now()/1000;}timingAt=0;return {{"shared",shared},{"changed",true}};
    }
    if(method=="telemetry:get"){if(telemetry.value("source","")=="Waiting for EuroScope"||captureSuccessAt&&Now()-captureSuccessAt>10000)throw RequestError(503,captureError.empty()?"Waiting for a fresh EuroScope telemetry update":"EuroScope telemetry capture failed: "+captureError);return telemetry;}
    if(method=="plan:get")return plan;
    if(method=="plan:init"){if(plan["config"].is_null())plan["config"]=data.at("config");MigrateConfig(plan["config"]);SeedRunwayConfig();return true;}
    if(method=="timing:set"){
        const auto generated=data.at("generatedAt").get<long long>();
        if(data.at("airport")!="ESSA"||std::abs(Now()-generated)>15000||!data.at("flights").is_array()||data.at("flights").size()>500)throw RequestError(400,"Invalid or stale guidance");
        Json next=Json::object();
        for(const auto& flight:data.at("flights")){const auto call=flight.at("callsign").get<std::string>();const auto value=MaestroInstructionSeconds(flight);if(call.empty()||call.size()>16||!value)throw RequestError(400,"Invalid instruction");next[call]=*value;}
        Json native=data.value("nativeSequence",Json());
        if(native.is_object()&&(native.at("data").at("icao")!="ESSA"||!native.at("sequence").is_array()||native.at("sequence").size()>500))throw RequestError(400,"Invalid native sequence");
        timing=std::move(next);
        if(native.is_object())sequence=std::move(native);
        else if(sequence.is_object()&&!sequence.empty()){sequence["sequence"]=Json::array();sequence["data"]["source"]="EMPTY";sequence["data"]["timestamp"]=Now()/1000;}
        timingAt=generated;return true;
    }
    if(shared&&method.rfind("plan:",0)==0)throw RequestError(403,"Shared plans must be saved through the authenticated backend");
    if(method=="plan:claim"){if(supervisor)throw RequestError(403,"Supervision cannot take MASTER");plan["masterCid"]=data.value("release",false)?Json():Json(0);return true;}
    if(method=="plan:snapshot"){
        if(supervisor||plan["masterCid"]!=0)throw RequestError(403,"Only the normal local MASTER processes telemetry");
        if(data.at("revision")!=plan["revision"])throw RequestError(409,"Shared settings changed; retry with the current plan");
        plan["snapshot"]=data.at("snapshot");plan["telemetry"]=data.at("telemetry");if(data.contains("edits"))plan["edits"]=data["edits"];
        bool retiredManual=false;
        const auto& snapshot=plan["snapshot"];
        if(snapshot.is_object()&&snapshot.contains("retiredManualFlights")&&snapshot["retiredManualFlights"].is_object()&&plan["config"].contains("manualFlights")&&plan["config"]["manualFlights"].is_array()){
            auto remaining=Json::array();
            for(const auto& entry:plan["config"]["manualFlights"]){
                const auto name=entry.value("callsign",std::string());const auto marker=snapshot["retiredManualFlights"].find(name);
                const bool consumed=marker!=snapshot["retiredManualFlights"].end()&&marker->is_object()&&marker->contains("reservation")&&(*marker)["reservation"]==entry&&
                    (marker->value("reason",std::string())=="live"||marker->value("reason",std::string())=="elapsed")&&marker->contains("at")&&(*marker)["at"].is_number()&&(*marker)["at"]<=snapshot.value("timestamp",0LL);
                if(consumed){
                    retiredManual=true;
                    if(marker->value("reason",std::string())=="elapsed"&&plan["edits"].contains(name)&&plan["edits"][name].value("changedAt",0LL)<=marker->value("at",0LL))plan["edits"].erase(name);
                }else remaining.push_back(entry);
            }
            if(retiredManual){plan["config"]["manualFlights"]=std::move(remaining);plan["revision"]=plan["revision"].get<int>()+1;}
        }
        if(retiredManual||Now()-lastSavedAt>=5000)SavePlan();return true;
    }
    if(method=="plan:update"||method=="plan:settings"){
        const bool settings=method=="plan:settings";
        if(settings!=supervisor)throw RequestError(403,settings?"Use the supervisory window":"Supervision cannot edit aircraft or runway operations");
        if(!settings&&plan["masterCid"]!=0)throw RequestError(403,"Acquire local MASTER first");
        if(data.at("revision")!=plan["revision"])throw RequestError(409,"Shared plan changed; reload and retry");
        static const std::set<std::string> operational={"active","departureRunway","rates","slots","pending","pendingRate","manualFlights","coordinations"};
        const auto& config=data.at("config");if(!config.is_object())throw RequestError(400,"Invalid settings");
        const auto validRates=[](const Json& rates){if(!rates.is_object())return false;for(const auto& value:rates)if(!value.is_number()||value.get<double>()<60||value.get<double>()>600)return false;return true;};
        if(config.contains("rates")&&!validRates(config["rates"]))throw RequestError(400,"Arrival rates must be 6–60 aircraft per hour");
        if(config.contains("pending")&&config["pending"].is_object()&&config["pending"].contains("rates")&&!validRates(config["pending"]["rates"]))throw RequestError(400,"Planned arrival rates must be 6–60 aircraft per hour");
        if(config.contains("pendingRate")&&config["pendingRate"].is_object()&&config["pendingRate"].contains("seconds")){const auto& seconds=config["pendingRate"]["seconds"];if(!seconds.is_number()||seconds.get<double>()<60||seconds.get<double>()>600)throw RequestError(400,"Planned arrival rate must be 6–60 aircraft per hour");}
        if(config.value("timingModel",std::string("euroscope-buffer"))!="euroscope-buffer"||(settings&&!config.contains("euroscopeBufferMinutes"))||(config.contains("euroscopeBufferMinutes")&&(!config["euroscopeBufferMinutes"].is_number()||config["euroscopeBufferMinutes"].get<double>()<0||config["euroscopeBufferMinutes"].get<double>()>15)))throw RequestError(400,"EuroScope ETA buffer must be between 0 and 15 minutes");
        if((settings&&!config.contains("euroscopeSuperstableBufferMinutes"))||(config.contains("euroscopeSuperstableBufferMinutes")&&(!config["euroscopeSuperstableBufferMinutes"].is_number()||config["euroscopeSuperstableBufferMinutes"].get<double>()<0||config["euroscopeSuperstableBufferMinutes"].get<double>()>15)))throw RequestError(400,"Superstable ETA buffer must be between 0 and 15 minutes");
        if((settings&&!config.contains("euroscopeHighSpeedBufferMinutes"))||(config.contains("euroscopeHighSpeedBufferMinutes")&&(!config["euroscopeHighSpeedBufferMinutes"].is_number()||config["euroscopeHighSpeedBufferMinutes"].get<double>()<0||config["euroscopeHighSpeedBufferMinutes"].get<double>()>15)))throw RequestError(400,"High-speed ETA buffer must be between 0 and 15 minutes");
        if(config.value("stableMinutes",15)!=15||config.value("superStableMinutes",4)!=4)throw RequestError(400,"Stable and Superstable horizons are fixed at 15 and 4 minutes");
        if(config.contains("displayPreferences")&&config["displayPreferences"].contains("labels")&&(!config["displayPreferences"]["labels"].value("type",true)||!config["displayPreferences"]["labels"].value("currentDelay",true)))throw RequestError(400,"Aircraft type and current instructions are part of the fixed label layout");
        for(auto it=config.begin();it!=config.end();++it){const bool op=operational.contains(it.key());
            if((settings&&op)||(!settings&&!op))if(it.value()!=plan["config"].value(it.key(),Json()))throw RequestError(403,"Setting is controlled by the other window");}
        for(auto it=plan["config"].begin();it!=plan["config"].end();++it){const bool op=operational.contains(it.key());if((settings&&op)||(!settings&&!op))if(it.value()!=config.value(it.key(),Json()))throw RequestError(403,"Setting is controlled by the other window");}
        if(settings&&data.at("edits")!=plan["edits"])throw RequestError(403,"Supervisor settings cannot overwrite aircraft edits");
        const Json previous=plan;
        if(!settings)runwayConfigInitialized=true;
        plan["config"]=config;plan["edits"]=data.at("edits");plan["snapshot"]=data.at("snapshot");plan["revision"]=plan["revision"].get<int>()+1;
        try{SavePlan();}catch(...){plan=previous;throw;}return true;
    }
    throw RequestError(404,"Unknown native request");
}
}
