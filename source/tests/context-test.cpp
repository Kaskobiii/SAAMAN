#include "context.h"
#include "auth_client.h"
#include "topsky-status.h"
#include "topsky-holding.h"
#include "telemetry_fields.h"
#include "controller_key.h"
#include <iostream>
#define CHECK(expr) do {if(!(expr))throw std::runtime_error(#expr);}while(false)
int RunTests(int argc,wchar_t** argv){
    CHECK(saaman::AircraftLinkCallsign(""));CHECK(saaman::AircraftLinkCallsign("SAS123"));CHECK(saaman::AircraftLinkCallsign("N-TEST_1"));
    for(const auto* invalid:{"A","sas123","SAS 123","<script>","ABCDEFGHIJKLMNOPQ"})CHECK(!saaman::AircraftLinkCallsign(invalid));
    saaman::AircraftHover hover;CHECK(hover.Active(1000).empty());hover.Set("SAS123",1000);CHECK(hover.Active(1000)=="SAS123");CHECK(hover.Active(3500)=="SAS123");CHECK(hover.Active(3501).empty());CHECK(hover.Active(999).empty());
    hover.Set("SAS123",3000);CHECK(hover.Active(5000)=="SAS123");hover.Set("RYR456",5000);CHECK(hover.Active(5000)=="RYR456");hover.Clear();CHECK(hover.Active(5001).empty());hover.Set("",6000);CHECK(hover.Active(6000).empty());
    saaman::AircraftSelection selection;CHECK(selection.Active(1000).empty());
    CHECK(selection.Observe("SAS123",1000));CHECK(selection.Active(3999)=="SAS123");
    CHECK(!selection.Observe("SAS123",2000));CHECK(selection.Active(4000).empty());
    CHECK(selection.Observe("SAS123",4000));CHECK(selection.current.empty());
    CHECK(!selection.Observe("SAS123",5000));CHECK(selection.Active(5000).empty());
    CHECK(selection.Observe("SAS123",5001,true));CHECK(selection.Active(5001)=="SAS123");
    CHECK(!selection.Observe("SAS123",6000));CHECK(selection.Active(8001).empty());
    CHECK(selection.Observe("RYR456",8002));CHECK(selection.Active(8002)=="RYR456");
    CHECK(selection.Observe("",8003));CHECK(selection.current.empty());CHECK(selection.observed.empty());
    CHECK(!selection.Observe("",8004,true));selection.Clear();CHECK(selection.Active(8005).empty());
    const saaman::Json partial={{"aircraft",saaman::TelemetryText(nullptr,"UNKN")},{"departure",saaman::TelemetryText(nullptr,"----")},{"runway",saaman::TelemetryText(nullptr)},{"direct",saaman::TelemetryText(nullptr)},{"wake",saaman::TelemetryWake('\0')}};
    CHECK(partial["aircraft"]=="UNKN");CHECK(partial["departure"]=="----");CHECK(partial["runway"]=="");CHECK(partial["direct"]=="");CHECK(partial["wake"]=="?");
    CHECK(saaman::TelemetryAssignedSpeed(999)==0);CHECK(saaman::TelemetryTopSkyHighSpeed(999));
    for(const int speed:{0,100,140,230,250,300,400,600,-1,601,998,1000,(std::numeric_limits<int>::min)(),(std::numeric_limits<int>::max)()}){CHECK(saaman::TelemetryAssignedSpeed(speed)==speed);CHECK(!saaman::TelemetryTopSkyHighSpeed(speed));}
    saaman::Json highSpeedClearance={{"assignedSpeed",saaman::TelemetryAssignedSpeed(999)},{"assignedMach",780}};
    if(saaman::TelemetryTopSkyHighSpeed(999))highSpeedClearance["topskyHighSpeed"]=true;
    CHECK(highSpeedClearance["assignedSpeed"]==0);CHECK(highSpeedClearance["assignedMach"]==780);CHECK(highSpeedClearance["topskyHighSpeed"]==true);
    saaman::Json exactSpeedClearance={{"assignedSpeed",saaman::TelemetryAssignedSpeed(250)},{"assignedMach",780}};
    if(saaman::TelemetryTopSkyHighSpeed(250))exactSpeedClearance["topskyHighSpeed"]=true;
    CHECK(exactSpeedClearance["assignedSpeed"]==250);CHECK(exactSpeedClearance["assignedMach"]==780);CHECK(!exactSpeedClearance.contains("topskyHighSpeed"));
    const auto legacyApproach=std::string(32,'A')+"\xB7 RNP X 19R";
    const saaman::Json approachPacket={{"routeText",saaman::TelemetryText(legacyApproach.c_str())},{"route",saaman::Json::array({{{"name",saaman::TelemetryText("RNP\xB7X")},{"seconds",120}}})}};
    CHECK(saaman::Json::parse(approachPacket.dump())==approachPacket);
    CHECK(saaman::TelemetryUtf8("\xC5\xC4\xD6\xB7",1252)=="\xC3\x85\xC3\x84\xC3\x96\xC2\xB7");
    CHECK(saaman::TelemetryUtf8("RNP\xB7X",CP_UTF8)=="RNP\xC2\xB7X");
    const std::string utf8Approach="RNP \xC3\x85\xC2\xB7 X19R \xF0\x9F\x9B\xAC";
    CHECK(saaman::TelemetryText(utf8Approach.c_str())==utf8Approach);CHECK(saaman::TelemetryText("ELTOK 19R")=="ELTOK 19R");
    for(size_t limit=0;limit<=utf8Approach.size();limit++){
        const auto clipped=saaman::TelemetryText(utf8Approach.c_str(),"",limit);
        CHECK(clipped.size()<=limit);CHECK(utf8Approach.starts_with(clipped));
        CHECK(saaman::Json::parse(saaman::Json({{"routeText",clipped}}).dump())["routeText"]==clipped);
    }
    const auto boundedRoute=std::string(4095,'A')+"\xC2\xB7";
    CHECK(saaman::TelemetryText(boundedRoute.c_str(),"",4096)==std::string(4095,'A'));
    for(const auto* runway:{"01L","01R","08","19L","19R","26"})for(const auto* variant:{"X","Y","Z"}){
        const auto approach=std::string("RNP ")+variant+"\xB7 "+runway;
        const saaman::Json encoded={{"star",saaman::TelemetryText(approach.c_str(),"",100)},{"routeText",saaman::TelemetryText(approach.c_str(),"",4096)},{"route",saaman::Json::array({{{"name",saaman::TelemetryText(approach.c_str(),"",40)},{"seconds",120}}})}};
        CHECK(saaman::Json::parse(encoded.dump())==encoded);CHECK(encoded["star"].get<std::string>().ends_with(runway));
    }
    CHECK(saaman::TelemetryAirport(" ESSA  ")=="ESSA");CHECK(saaman::TelemetryAirport("essa Arlanda")=="ESSA");CHECK(saaman::TelemetryAirport(nullptr).empty());
    CHECK(saaman::TelemetryRunway(" 01r \t")=="01R");CHECK(saaman::TelemetryRunway("1L")=="01L");CHECK(saaman::TelemetryRunway("8")=="08");CHECK(saaman::TelemetryRunway("99").empty());CHECK(saaman::TelemetryRunway(nullptr).empty());
    CHECK(!saaman::TelemetrySupportedRunway("ESSA","07"));CHECK(!saaman::TelemetrySupportedRunway("ESSA","25"));CHECK(saaman::TelemetrySupportedRunway("ESSA","08"));CHECK(saaman::TelemetrySupportedRunway("ESSA","01R"));CHECK(saaman::TelemetrySupportedRunway("ESSB","12"));
    CHECK(saaman::TelemetryPositionValid(59.626397,17.950742));CHECK(!saaman::TelemetryPositionValid(100,17.9));CHECK(!saaman::TelemetryPositionValid(59.6,181));
    CHECK(!saaman::TopSkyMissedApproach(nullptr));CHECK(!saaman::TopSkyMissedApproach(""));
    CHECK(saaman::TopSkyMissedApproach("MISAP_"));CHECK(saaman::TopSkyMissedApproach("IRREG_MISAP_WX_"));
    CHECK(!saaman::TopSkyMissedApproach("MAPP"));CHECK(!saaman::TopSkyMissedApproach("IRREG_"));
    CHECK(saaman::TopSkyHoldingPoint("h/ELTOK/h")=="ELTOK");CHECK(saaman::TopSkyHoldingPoint("GRP/S/2 h/NILUG/h")=="NILUG");
    CHECK(saaman::TopSkyHoldingPoint(nullptr).empty());CHECK(saaman::TopSkyHoldingPoint("t/ELTOK/t").empty());
    CHECK(saaman::TopSkyHoldingPoint("h/ELTOK").empty());CHECK(saaman::TopSkyHoldingPoint("h/EL TOK/h").empty());
    saaman::TopSkyHoldingCache hold;
    CHECK(hold.Observe("SAS123","","h/ELTOK/h",1000)=="ELTOK");
    hold.Command("SAS123","/HOLD/NILUG/",2000);CHECK(hold.Observe("SAS123","/HOLD/NILUG/","h/ELTOK/h",3000)=="NILUG");
    CHECK(hold.Observe("SAS123","unrelated scratch","",4000)=="NILUG");
    hold.Command("SAS123","/XHOLD/NILUG/",5000);CHECK(hold.Observe("SAS123","/XHOLD/NILUG/","h/NILUG/h",6000).empty());
    hold.Command("SAS123","/HOLD/ELTOK/",7000);CHECK(hold.Observe("SAS123","/HOLD/ELTOK/","",8000)=="ELTOK");
    hold.Command("SAS123","/HOLD_EAT/1215/",9000);CHECK(hold.Observe("SAS123","/HOLD_EAT/1215/","",10000)=="ELTOK");
    hold.Command("SAS123","/XHOLD/",11000);CHECK(hold.Observe("SAS123","/XHOLD/","h/ELTOK/h",12000).empty());
    hold.Clear();CHECK(hold.Observe("SAS123","","",13000).empty());
    if(argc!=2)return 2;std::filesystem::create_directories(argv[1]);saaman::Context context(argv[1]);context.shared=false;context.plan={{"revision",0},{"config",nullptr},{"edits",saaman::Json::object()},{"snapshot",nullptr},{"masterCid",nullptr}};
    const auto planBeforeHover=context.plan;const auto telemetryBeforeHover=context.telemetry;
    CHECK(context.Request("host:aircraft-selection",saaman::Json::object(),false)["callsign"]=="");
    context.aircraftSelection.Observe("SAS123",saaman::AircraftLinkTick());CHECK(context.Request("host:aircraft-selection",saaman::Json::object(),false)["callsign"]=="SAS123");
    context.aircraftSelection.at=saaman::AircraftLinkTick()-3000;CHECK(context.Request("host:aircraft-selection",saaman::Json::object(),false)["callsign"]=="");
    context.aircraftSelection.Observe("SAS123",saaman::AircraftLinkTick(),true);CHECK(context.Request("host:aircraft-selection",saaman::Json::object(),false)["callsign"]=="SAS123");
    context.Request("host:aircraft-hover",{{"callsign","SAS123"}},false);CHECK(context.aircraftHover.callsign.empty());
    context.aircraftLinkConnected=true;context.Request("host:aircraft-hover",{{"callsign","SAS123"}},false);CHECK(context.aircraftHover.Active(saaman::AircraftLinkTick())=="SAS123");
    CHECK(context.Request("host:aircraft-hover",{{"callsign","SAS123"},{"renew",true}},false)==true);
    CHECK(context.Request("host:aircraft-hover",{{"callsign","RYR456"},{"renew",true}},false)==false);CHECK(context.aircraftHover.callsign=="SAS123");
    bool invalidHover=false;try{context.Request("host:aircraft-hover",{{"callsign","SAS 123"}},false);}catch(const saaman::RequestError& e){invalidHover=e.status==400;}CHECK(invalidHover);CHECK(context.aircraftHover.callsign=="SAS123");
    bool supervisorHover=false;try{context.Request("host:aircraft-hover",{{"callsign","RYR456"}},true);}catch(const saaman::RequestError& e){supervisorHover=e.status==403;}CHECK(supervisorHover);CHECK(context.aircraftHover.callsign=="SAS123");
    context.Request("host:aircraft-hover",{{"callsign",""}},false);CHECK(context.aircraftHover.callsign.empty());
    CHECK(context.Request("host:aircraft-hover",{{"callsign","SAS123"},{"renew",true}},false)==false);CHECK(context.aircraftHover.callsign.empty());
    context.aircraftHover.Set("SAS123",saaman::AircraftLinkTick()-3000);const auto expiredHoverAt=context.aircraftHover.at;
    CHECK(context.Request("host:aircraft-hover",{{"callsign","SAS123"},{"renew",true}},false)==false);CHECK(context.aircraftHover.at==expiredHoverAt);
    context.Request("host:aircraft-hover",{{"callsign","RYR456"}},false);context.aircraftLinkConnected=false;context.Request("host:aircraft-hover",{{"callsign","RYR456"}},false);CHECK(context.aircraftHover.callsign.empty());
    CHECK(context.Request("host:aircraft-hover",{{"callsign","RYR456"},{"renew",true}},false)==false);CHECK(context.aircraftHover.callsign.empty());
    context.aircraftLinkConnected=true;CHECK(context.Request("host:aircraft-hover",{{"callsign","RYR456"},{"renew",true}},false)==false);CHECK(context.aircraftHover.callsign.empty());context.aircraftLinkConnected=false;
    CHECK(context.plan==planBeforeHover);CHECK(context.telemetry==telemetryBeforeHover);context.aircraftSelection.Clear();
    context.captureError="Test incomplete SDK field";
    bool captureDiagnosed=false;try{context.Request("telemetry:get",saaman::Json::object(),false);}catch(const saaman::RequestError& e){captureDiagnosed=e.status==503&&std::string(e.what()).find("Test incomplete SDK field")!=std::string::npos;}CHECK(captureDiagnosed);
    context.captureError.clear();
    const saaman::Json config={{"performanceModel","euroscope"},{"surfaceWindSpeed",0},{"active",saaman::Json::array({"ESSA/19R"})}};
    context.Request("plan:init",{{"config",config}},false);context.Request("plan:claim",saaman::Json::object(),false);
    bool denied=false;try{context.Request("plan:settings",{{"revision",0}},false);}catch(const saaman::RequestError& e){denied=e.status==403;}CHECK(denied);
    CHECK(context.plan["config"]["stableMinutes"]==15);CHECK(context.plan["config"]["superStableMinutes"]==4);
    CHECK(context.plan["config"]["timingModel"]=="euroscope-buffer");CHECK(context.plan["config"]["euroscopeBufferMinutes"]==2);
    CHECK(context.plan["config"]["euroscopeHighSpeedBufferMinutes"]==6);
    auto changed=context.plan["config"];changed["surfaceWindSpeed"]=12;changed["euroscopeHighSpeedBufferMinutes"]=4;
    for(const double value:{-1.0,16.0}){auto invalidBuffer=changed;invalidBuffer["euroscopeHighSpeedBufferMinutes"]=value;
        denied=false;try{context.Request("plan:settings",{{"revision",0},{"config",invalidBuffer},{"edits",saaman::Json::object()},{"snapshot",nullptr}},true);}catch(const saaman::RequestError& e){denied=e.status==400;}CHECK(denied);}
    auto invalidRate=changed;invalidRate["rates"]={{"ESSA/19R",30}};
    denied=false;try{context.Request("plan:settings",{{"revision",0},{"config",invalidRate},{"edits",saaman::Json::object()},{"snapshot",nullptr}},true);}catch(const saaman::RequestError& e){denied=e.status==400;}CHECK(denied);
    context.Request("plan:settings",{{"revision",0},{"config",changed},{"edits",saaman::Json::object()},{"snapshot",nullptr}},true);
    CHECK(context.plan["masterCid"]==0);CHECK(context.plan["revision"]==1);CHECK(context.plan["config"]["surfaceWindSpeed"]==12);
    CHECK(context.plan["config"]["euroscopeHighSpeedBufferMinutes"]==4);
    auto forbidden=changed;forbidden["stableMinutes"]=20;
    denied=false;try{context.Request("plan:settings",{{"revision",1},{"config",forbidden},{"edits",saaman::Json::object()},{"snapshot",nullptr}},true);}catch(const saaman::RequestError& e){denied=e.status==400;}CHECK(denied);
    denied=false;try{context.Request("plan:update",{{"revision",1},{"config",config}},false);}catch(const saaman::RequestError& e){denied=e.status==403;}CHECK(denied);
    denied=false;try{context.Request("plan:snapshot",{{"revision",0}},false);}catch(const saaman::RequestError& e){denied=e.status==409;}CHECK(denied);
    context.Request("timing:set",{{"airport","ESSA"},{"generatedAt",saaman::Now()},{"flights",saaman::Json::array({{{"callsign","SAS1015"},{"deltaSeconds",0},{"sta",5000},{"eta",0}}})}},false);
    CHECK(context.timing["SAS1015"]==0);
    const auto reloadRoot=std::filesystem::path(argv[1])/(L"reload-regression-"+std::to_wstring(saaman::Now()));
    // Fresh settings start in shared vatIRIS/live mode. An explicit saved
    // local choice remains local on reload, including an older profile.
    const auto defaultsFolder=reloadRoot/L"startup-defaults";
    saaman::Context defaults(defaultsFolder);const auto defaultsInfo=defaults.Request("host:info",saaman::Json::object(),false);
    CHECK(defaultsInfo["shared"]==true);CHECK(defaultsInfo["authProvider"]=="vatiris-callsign");CHECK(defaultsInfo["backendBaseUrl"]=="https://backend.vatiris.se");CHECK(defaultsInfo["relay"]["network"]=="live");
    defaults.Request("mode:set",{{"shared",false}},false);
    saaman::Context explicitLocal(defaultsFolder);CHECK(!explicitLocal.shared);CHECK(explicitLocal.relay["network"]=="live");
    const auto partialFolder=reloadRoot/L"older-options";std::filesystem::create_directories(partialFolder);
    {std::ofstream file(partialFolder/L"SAAMAN.json");file<<saaman::Json({{"backendBaseUrl","https://backend.vatiris.se"}}).dump();}
    saaman::Context olderOptions(partialFolder);CHECK(olderOptions.shared);CHECK(olderOptions.relay["network"]=="live");
    const auto oldDLL=reloadRoot/L"releases"/L"old",newDLL=reloadRoot/L"releases"/L"new",sharedState=reloadRoot/L"state";
    std::filesystem::create_directories(oldDLL);std::filesystem::create_directories(newDLL);
    saaman::Context before(oldDLL);before.shared=false;before.plan=context.plan;
    before.Request("plan:claim",saaman::Json::object(),false);before.lastSavedAt=0;
    const auto snapshot=saaman::Json{{"timestamp",saaman::Now()},{"flights",saaman::Json::array({{{"callsign","NOZ812"},{"state",2},{"passedFeeder",true},{"firstSeen",saaman::Now()-120000},{"sta",saaman::Now()+120000},{"delay",0}}})}};
    before.Request("plan:snapshot",{{"revision",before.plan["revision"]},{"snapshot",snapshot},{"telemetry",{{"source","SAAMAN"},{"timestamp",saaman::Now()},{"flights",saaman::Json::array()}}}},false);
    CHECK(std::filesystem::exists(oldDLL/L"SAAMAN-plan.json"));
    saaman::Context migrated(newDLL,sharedState);CHECK(migrated.plan["snapshot"]==snapshot);CHECK(migrated.plan["masterCid"].is_null());
    denied=false;try{migrated.Request("telemetry:get",saaman::Json::object(),false);}catch(const saaman::RequestError& e){denied=e.status==503;}CHECK(denied);CHECK(migrated.plan["snapshot"]==snapshot);
    migrated.SavePlan();saaman::Context reloaded(newDLL,sharedState);CHECK(reloaded.plan["snapshot"]==snapshot);CHECK(reloaded.plan["snapshot"]["flights"][0]["state"]==2);
    // Loading a pre-1.0.17 config must not make a normal Resume look like an
    // unauthorized change to the newly introduced supervised setting.
    const auto resumeFolder=reloadRoot/L"legacy-resume";std::filesystem::create_directories(resumeFolder);
    saaman::Context legacyResume(resumeFolder);legacyResume.shared=false;legacyResume.plan=context.plan;
    legacyResume.plan["config"].erase("performanceModel");
    legacyResume.plan["snapshot"]={{"timestamp",saaman::Now()},{"flights",saaman::Json::array({{{"callsign","FIN1NX"},{"mode","missed"},{"state",2}}})}};
    legacyResume.plan["edits"]={{"FIN1NX",{{"mode","missed"}}}};legacyResume.SavePlan();
    saaman::Context restoredResume(resumeFolder);restoredResume.shared=false;CHECK(restoredResume.plan["config"]["performanceModel"]=="euroscope");
    CHECK(restoredResume.plan["edits"]["FIN1NX"]["mode"]=="missed");
    restoredResume.Request("plan:claim",saaman::Json::object(),false);
    auto resumedEdits=restoredResume.plan["edits"];resumedEdits["FIN1NX"]["mode"]="sequenced";
    restoredResume.Request("plan:update",{{"revision",restoredResume.plan["revision"]},{"config",restoredResume.plan["config"]},{"edits",resumedEdits},{"snapshot",restoredResume.plan["snapshot"]}},false);
    CHECK(restoredResume.plan["edits"]["FIN1NX"]["mode"]=="sequenced");
    auto unauthorizedModel=restoredResume.plan["config"];unauthorizedModel["performanceModel"]="openap";
    denied=false;try{restoredResume.Request("plan:update",{{"revision",restoredResume.plan["revision"]},{"config",unauthorizedModel}},false);}catch(const saaman::RequestError& e){denied=e.status==403;}CHECK(denied);
    // Consumption prunes only the matching reservation, persists immediately
    // and invalidates commands built against the old operational config.
    const auto manualFolder=reloadRoot/L"manual-lifecycle";
    saaman::Context manualContext(manualFolder);manualContext.shared=false;manualContext.plan=context.plan;
    manualContext.Request("plan:claim",saaman::Json::object(),false);
    const auto stamp=saaman::Now();
    const saaman::Json used={{"callsign","CCA911"},{"aircraft","UNKN"},{"wake","?"},{"runway","ESSA/19R"},{"feeder","ELTOK"},{"eta",stamp+1200000}};
    auto expired=used;expired["callsign"]="OLD900";expired["eta"]=stamp-60000;
    auto keep=used;keep["callsign"]="KEEP100";keep["eta"]=stamp+1800000;
    auto olderKeep=keep;olderKeep["eta"]=stamp+600000;
    manualContext.plan["config"]["manualFlights"]=saaman::Json::array({used,expired,keep});
    manualContext.plan["edits"]={{"CCA911",{{"target",stamp+1200000},{"changedAt",stamp-1000}}},{"OLD900",{{"target",stamp-60000},{"changedAt",stamp-1000}}}};
    const auto manualRevision=manualContext.plan["revision"];
    const auto retirement=saaman::Json{{"timestamp",stamp},{"flights",saaman::Json::array()},{"retiredManualFlights",{
        {"CCA911",{{"reservation",used},{"at",stamp},{"reason","live"}}},
        {"OLD900",{{"reservation",expired},{"at",stamp},{"reason","elapsed"}}},
        {"KEEP100",{{"reservation",olderKeep},{"at",stamp},{"reason","live"}}}}}};
    manualContext.lastSavedAt=stamp;
    manualContext.Request("plan:snapshot",{{"revision",manualRevision},{"snapshot",retirement},{"telemetry",{{"timestamp",stamp},{"flights",saaman::Json::array()}}}},false);
    CHECK(manualContext.plan["config"]["manualFlights"]==saaman::Json::array({keep}));
    CHECK(manualContext.plan["revision"]==manualRevision.get<int>()+1);
    CHECK(manualContext.plan["edits"].contains("CCA911"));CHECK(!manualContext.plan["edits"].contains("OLD900"));
    saaman::Context manualReloaded(manualFolder);CHECK(manualReloaded.plan["config"]["manualFlights"]==saaman::Json::array({keep}));
    denied=false;try{manualContext.Request("plan:update",{{"revision",manualRevision}},false);}catch(const saaman::RequestError& e){denied=e.status==409;}CHECK(denied);
    const auto seedFolder=reloadRoot/L"seed";std::filesystem::create_directories(seedFolder);
    saaman::Context seeded(seedFolder);seeded.shared=false;seeded.telemetry={{"source","SDK"},{"activeRunways",{{"arrivals",saaman::Json::array({"ESSA/01L"})},{"departures",saaman::Json::array({"ESSA/01R"})}}}};
    seeded.Request("plan:init",{{"config",config}},false);
    CHECK(seeded.plan["config"]["active"][0]=="ESSA/01L");CHECK(seeded.plan["config"]["departureRunway"]=="ESSA/01R");
    seeded.telemetry["activeRunways"]["arrivals"]=saaman::Json::array({"ESSA/26"});seeded.SeedRunwayConfig();CHECK(seeded.plan["config"]["active"][0]=="ESSA/01L");
    seeded.plan["snapshot"]=snapshot;seeded.SavePlan();
    saaman::Context seededAgain(seedFolder);seededAgain.shared=false;CHECK(!seededAgain.runwayConfigInitialized);CHECK(seededAgain.plan["config"]["active"][0]=="ESSA/01L");
    seededAgain.telemetry={{"source","SDK"},{"activeRunways",{{"arrivals",saaman::Json::array({"ESSA/26"})},{"departures",saaman::Json::array({"ESSA/19L"})}}}};seededAgain.SeedRunwayConfig();
    CHECK(seededAgain.plan["config"]["active"][0]=="ESSA/26");CHECK(seededAgain.plan["config"]["departureRunway"]=="ESSA/19L");CHECK(seededAgain.plan["snapshot"]==snapshot);
    denied=false;try{saaman::ReadVatsimUser({{"url","https://example.com/api/user"},{"token","test-token"}});}catch(const saaman::RequestError& e){denied=e.status==400;}CHECK(denied);
    context.shared=true;denied=false;try{context.Request("plan:claim",saaman::Json::object(),false);}catch(const saaman::RequestError& e){denied=e.status==403;}CHECK(denied);
    const auto relayFolder=reloadRoot/L"relay-options";saaman::Context relay(relayFolder);
    const auto room=saaman::Json{{"network","sweatbox2"},{"session","exercise-2"},{"channel","saaman"}};
    relay.Request("mode:set",{{"shared",true},{"authProvider","vatiris"},{"backendBaseUrl","https://backend.vatiris.se"},{"relay",room}},false);
    saaman::Context relayReload(relayFolder);const auto info=relayReload.Request("host:info",saaman::Json::object(),false);
    CHECK(info["shared"]==true);CHECK(info["relay"]==room);CHECK(info["instanceId"].is_string());CHECK(!info["instanceId"].get<std::string>().empty());
    CHECK(info["authProvider"]=="vatiris-callsign");
    relayReload.Request("mode:set",{{"shared",true},{"relay",room}},false);
    relayReload.Request("mode:set",{{"shared",true},{"controllerCid",1396125},{"relay",room}},false);
    saaman::Context trustedReload(relayFolder);CHECK(trustedReload.Request("host:info",saaman::Json::object(),false)["controllerCid"]==1396125);
    CHECK(trustedReload.Request("key:read",saaman::Json::object(),false)["key"]=="");
    CHECK(trustedReload.Request("host:info",saaman::Json::object(),false)["backendBaseUrl"]=="https://backend.vatiris.se");
    trustedReload.timing={{"TEST",42}};trustedReload.timingAt=saaman::Now();
    const auto unchangedMode=trustedReload.Request("mode:set",{{"shared",true},{"controllerCid",1396125},{"relay",room}},false);
    CHECK(unchangedMode["changed"]==false);CHECK(trustedReload.timing["TEST"]==42);CHECK(trustedReload.timingAt!=0);
    CHECK(saaman::ValidBackend("https://vatsim-backend.tailc72bdf.ts.net"));CHECK(saaman::ValidBackend("http://127.0.0.1:8787"));
    CHECK(!saaman::ValidBackend("https://example.com@evil.example"));CHECK(!saaman::ValidBackend("https://example.com/path"));CHECK(!saaman::ValidBackend("http://remote.example"));CHECK(!saaman::ValidBackend("https://example.com:99999"));
    const auto testKey="saaman_"+std::string(43,'A');const auto keyFolder=reloadRoot/L"key-storage";
    saaman::SaveControllerKey(keyFolder,"https://example.ts.net",testKey);
    CHECK(saaman::ReadControllerKey(keyFolder,"https://example.ts.net")==testKey);CHECK(saaman::ReadControllerKey(keyFolder,"https://different.ts.net").empty());
    std::ifstream protectedInput(keyFolder/L"SAAMAN-controller-key.bin",std::ios::binary);std::string protectedBytes((std::istreambuf_iterator<char>(protectedInput)),{});protectedInput.close();CHECK(protectedBytes.find(testKey)==std::string::npos);
    saaman::Context keyed(newDLL,keyFolder);keyed.Request("mode:set",{{"shared",true},{"authProvider","keys"},{"backendBaseUrl","https://example.ts.net"},{"relay",room},{"controllerKey",testKey}},false);
    saaman::Context keyReload(newDLL,keyFolder);CHECK(keyReload.Request("key:read",saaman::Json::object(),false)["key"]==testKey);
    CHECK(!keyReload.Request("host:info",saaman::Json::object(),false).contains("key"));
    denied=false;try{relayReload.Request("mode:set",{{"shared",true},{"relay",room}},true);}catch(const saaman::RequestError& e){denied=e.status==403;}CHECK(denied);
    denied=false;try{relayReload.Request("mode:set",{{"shared",true},{"relay",{{"network","live"},{"session","../wrong"},{"channel","saaman"}}}},false);}catch(const saaman::RequestError& e){denied=e.status==400;}CHECK(denied);
    std::cout<<"Native context: permission boundaries, revision guard, supervisor save, authoritative zero, shared-mode isolation, automatic history saving and cross-release superstable restoration passed\n";
    return 0;
}
int wmain(int argc,wchar_t** argv){try{return RunTests(argc,argv);}catch(const std::exception& e){std::cerr<<"Native context test failed: "<<e.what()<<"\n";return 1;}}
