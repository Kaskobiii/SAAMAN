#include "telemetry.h"
#include "topsky-status.h"
#include "telemetry_fields.h"
#include <cmath>
#include <cstring>
namespace saaman {
Json CaptureTelemetry(EuroScopePlugIn::CPlugIn& plugin,const Json& winds){
        nlohmann::json data = { {"source", plugin.ControllerMyself().IsValid() ? TelemetryText(plugin.ControllerMyself().GetCallsign(),"OFFLINE") : "OFFLINE"},
            {"timestamp", Now()}, {"flights", nlohmann::json::array()}, {"winds", winds}, {"terminatedCallsigns",nlohmann::json::array()}, {"knownFlights",nlohmann::json::array()}, {"captureErrors",nlohmann::json::array()} };
        data["controllerPositionId"]=plugin.ControllerMyself().IsValid()?TelemetryText(plugin.ControllerMyself().GetPositionId()):"";
        data["controllers"]=Json::array();
        for(auto controller=plugin.ControllerSelectFirst();controller.IsValid()&&data["controllers"].size()<500;controller=plugin.ControllerSelectNext(controller)){
            if(controller.GetFacility()<5||!controller.IsController())continue;
            const auto callsign=TelemetryText(controller.GetCallsign());if(callsign.empty()||callsign.size()>32)continue;
            data["controllers"].push_back({{"callsign",callsign},{"positionId",TelemetryText(controller.GetPositionId())},{"facility",controller.GetFacility()},{"controller",true}});
        }
        nlohmann::json runwayGeometry = nlohmann::json::object();
        Json arrivalRunways=Json::array(),departureRunways=Json::array();
        Json runwayStatus={{"sectorRunways",0},{"essaRunways",0},{"airportSamples",Json::array()},{"sdk",Json::array()},{"ignoredGeometry",Json::array()}};
        for (auto runway = plugin.SectorFileElementSelectFirst(EuroScopePlugIn::SECTOR_ELEMENT_RUNWAY); runway.IsValid();
            runway = plugin.SectorFileElementSelectNext(runway, EuroScopePlugIn::SECTOR_ELEMENT_RUNWAY)) {
            runwayStatus["sectorRunways"]=runwayStatus["sectorRunways"].get<int>()+1;
            const auto airport = TelemetryAirport(runway.GetAirportName());
            const auto element=TelemetryText(runway.GetName());
            if(runwayStatus["airportSamples"].size()<8||element.find("ESSA")!=std::string::npos)runwayStatus["airportSamples"].push_back({{"airport",TelemetryText(runway.GetAirportName()).substr(0,24)},{"element",element.substr(0,48)}});
            if(airport=="ESSA")runwayStatus["essaRunways"]=runwayStatus["essaRunways"].get<int>()+1;
            if (airport != "ESSA" && airport != "ESSB") continue;
            for (int end = 0; end < 2; end++) {
                EuroScopePlugIn::CPosition threshold, opposite;
                const auto name = TelemetryRunway(runway.GetRunwayName(end));
                const bool supported=TelemetrySupportedRunway(airport,name);
                if(airport=="ESSA"){
                    const bool arrival=runway.IsElementActive(false,end),departure=runway.IsElementActive(true,end);
                    runwayStatus["sdk"].push_back({{"airport",TelemetryText(runway.GetAirportName()).substr(0,24)},{"runway",TelemetryText(runway.GetRunwayName(end)).substr(0,12)},{"arr",arrival},{"dep",departure}});
                    if(supported){if(arrival)arrivalRunways.push_back(airport+"/"+name);if(departure)departureRunways.push_back(airport+"/"+name);}
                }
                if(!supported){if(!name.empty())runwayStatus["ignoredGeometry"].push_back({{"runway",airport+"/"+name},{"reason","outside AMAN runway configuration"}});continue;}
                if (name.empty() || !runway.GetPosition(&threshold, end) || !runway.GetPosition(&opposite, 1-end)) continue;
                if(!TelemetryPositionValid(threshold.m_Latitude,threshold.m_Longitude)||!TelemetryPositionValid(opposite.m_Latitude,opposite.m_Longitude)||std::abs(threshold.m_Latitude-opposite.m_Latitude)+std::abs(threshold.m_Longitude-opposite.m_Longitude)<1e-7){
                    runwayStatus["ignoredGeometry"].push_back({{"runway",airport+"/"+name},{"reason","invalid runway endpoints"}});continue;
                }
                const double pi = 3.141592653589793, a = threshold.m_Latitude*pi/180, b = opposite.m_Latitude*pi/180;
                const double delta = (opposite.m_Longitude-threshold.m_Longitude)*pi/180;
                const double bearing = std::fmod(std::atan2(std::sin(delta)*std::cos(b), std::cos(a)*std::sin(b)-std::sin(a)*std::cos(b)*std::cos(delta))*180/pi+360,360);
                if(!std::isfinite(bearing))continue;
                runwayGeometry[airport+"/"+name] = { {"latitude",threshold.m_Latitude}, {"longitude",threshold.m_Longitude}, {"heading",bearing} };
            }
        }
        const auto connection=plugin.GetConnectionType();
        data["connected"]=connection!=EuroScopePlugIn::CONNECTION_TYPE_NO;
        data["connectionType"]=connection;
        data["simulation"] = connection==EuroScopePlugIn::CONNECTION_TYPE_SIMULATOR_SERVER ||
            connection==EuroScopePlugIn::CONNECTION_TYPE_SIMULATOR_CLIENT || connection==EuroScopePlugIn::CONNECTION_TYPE_SWEATBOX;
        data["runways"] = runwayGeometry;
        data["activeRunways"]={{"arrivals",arrivalRunways},{"departures",departureRunways}};
        data["runwayStatus"]=std::move(runwayStatus);
        if (plugin.GetConnectionType() != EuroScopePlugIn::CONNECTION_TYPE_NO) {
            int count = 0;
            for (auto fp = plugin.FlightPlanSelectFirst(); fp.IsValid() && count < 1000; fp = plugin.FlightPlanSelectNext(fp)) {
                const auto before=data["flights"].size();
                try{
                const auto fpd = fp.GetFlightPlanData();
                if (!fpd.IsReceived() || !fpd.GetDestination()) continue;
                const std::string arrival = fpd.GetDestination();
                if (arrival != "ESSA") continue;
                // Explicit SDK termination is distinct from tracking release or target loss.
                if(fp.GetFPState()==EuroScopePlugIn::FLIGHT_PLAN_STATE_TERMINATED){
                    const auto name=fp.GetCallsign();
                    if(name&&strlen(name)>=2&&strlen(name)<=16)data["terminatedCallsigns"].push_back(name);
                }
                const auto knownName=fp.GetCallsign();
                if(fp.GetFPState()!=EuroScopePlugIn::FLIGHT_PLAN_STATE_TERMINATED&&knownName&&strlen(knownName)>=2&&strlen(knownName)<=16&&data["knownFlights"].size()<1000)
                    data["knownFlights"].push_back({{"callsign",knownName},{"aircraft",TelemetryText(fpd.GetAircraftFPType(),"UNKN")},{"wake",TelemetryWake(fpd.GetAircraftWtc())},{"departure",TelemetryText(fpd.GetOrigin(),"----")},{"arrival",arrival},{"runway",TelemetryText(fpd.GetArrivalRwy())}});
                const auto target = fp.GetCorrelatedRadarTarget();
                if (!target.IsValid()) continue;
                const auto position = target.GetPosition();
                if (position.GetReceivedTime() > 30) continue;
                const auto route = fp.GetExtractedRoute();
                const int points = route.GetPointsNumber();
                // Missed approaches may temporarily have no extracted route.
                if (points < 0 || points > 1000) continue;
                nlohmann::json prediction = nlohmann::json::array();
                for (int i = 0; i < points; i++) {
                    const char *name = route.GetPointName(i);
                    if (!name || strlen(name) > 40) continue;
                    const auto point = route.GetPointPosition(i);
                    Json routePoint={{"name",name},{"seconds",route.GetPointDistanceInMinutes(i)*60}};
                    if(std::isfinite(point.m_Latitude)&&std::isfinite(point.m_Longitude)){routePoint["latitude"]=point.m_Latitude;routePoint["longitude"]=point.m_Longitude;}
                    prediction.push_back(std::move(routePoint));
                }
                const auto ctr = fp.GetControllerAssignedData();
                const int assigned = route.GetPointsAssignedIndex();
                const int calculated = route.GetPointsCalculatedIndex();
                const std::string problem = assigned >= 0 && calculated >= 0 && assigned < calculated ?
                    "Assigned direct-to is behind the current route position" : "";
                const auto callsign = fp.GetCallsign();
                if (!callsign || strlen(callsign)<2 || strlen(callsign) > 16) continue;
                const auto coordinates = position.GetPosition();
                data["flights"].push_back({ {"callsign", callsign}, {"aircraft", TelemetryText(fpd.GetAircraftFPType(),"UNKN")},
                    {"wake", TelemetryWake(fpd.GetAircraftWtc())}, {"departure", TelemetryText(fpd.GetOrigin(),"----")}, {"arrival", arrival},
                    {"runway", TelemetryText(fpd.GetArrivalRwy())}, {"route", prediction},
                    {"star",fpd.GetStarName()?fpd.GetStarName():""}, {"routeText",std::string(fpd.GetRoute()?fpd.GetRoute():"").substr(0,4096)},
                    {"assignedSpeed",ctr.GetAssignedSpeed()}, {"verticalSpeed",target.GetVerticalSpeed()},
                    {"clearedAltitude",ctr.GetClearedAltitude()}, {"finalAltitude",ctr.GetFinalAltitude()>0?ctr.GetFinalAltitude():fpd.GetFinalAltitude()},
                    {"assignedMach",ctr.GetAssignedMach()},
                    {"topskyMissedApproach",TopSkyMissedApproach(ctr.GetScratchPadString())},
                    {"landingSeconds", points > 0 ? route.GetPointDistanceInMinutes(points - 1) * 60 : 0},
                    {"distanceNm", fp.GetDistanceToDestination()}, {"groundspeed", target.GetGS()},
                    {"altitude", position.GetPressureAltitude()}, {"heading", position.GetReportedHeadingTrueNorth()},
                    {"assignedHeading", ctr.GetAssignedHeading()}, {"direct", TelemetryText(ctr.GetDirectToPointName())}, {"routeProblem", problem},
                    {"latitude",coordinates.m_Latitude}, {"longitude",coordinates.m_Longitude},
                    {"positionAgeSeconds",position.GetReceivedTime()}, {"calculatedRouteIndex",calculated} });
                const std::string runwayKey=arrival+"/"+TelemetryText(fpd.GetArrivalRwy());
                if (runwayGeometry.contains(runwayKey)) data["flights"].back()["threshold"]=runwayGeometry[runwayKey];
                const auto& captured=data["flights"].back();
                for(const auto* key:{"latitude","longitude","altitude","groundspeed","heading","distanceNm"})if(!std::isfinite(captured[key].get<double>()))throw std::runtime_error("Non-finite radar position or motion");
                count++;
                }catch(const std::exception& error){
                    while(data["flights"].size()>before)data["flights"].erase(data["flights"].end()-1);
                    if(data["captureErrors"].size()<20)data["captureErrors"].push_back({{"callsign",TelemetryText(fp.GetCallsign(),"UNKNOWN")},{"error",std::string(error.what()).substr(0,160)}});
                }
            }
        }

 return data;
}
}
