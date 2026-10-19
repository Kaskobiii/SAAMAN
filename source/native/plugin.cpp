#include "EuroScopePlugIn.h"
#include "context.h"
#include "host.h"
#include "telemetry.h"
#include "radar_screen.h"
#include "maestro_broadcast.h"
#include <memory>
#include <regex>
#include <cmath>
namespace saaman {
extern "C" IMAGE_DOS_HEADER __ImageBase;
class Plugin final:public EuroScopePlugIn::CPlugIn {
    std::shared_ptr<Context> context;
    std::unique_ptr<Host> host;
    Json winds=Json::object();
    TopSkyHoldingCache holding;
    HWND redrawWindow=nullptr;
    static constexpr UINT RedrawMessage=WM_APP+77;
    Json activeEditor;
    static constexpr int EditFunction=88300,SelectFunction=88301;
    void DrainEditor(){
        const auto pending=host->TakeEditor();if(!pending.is_object())return;activeEditor=pending;RadarScreen::ReleaseInput();
        const auto& r=pending.at("rect");const auto& origin=pending.at("origin");RECT area{origin.at("x").get<int>()+r.at("left").get<int>(),origin.at("y").get<int>()+r.at("top").get<int>(),origin.at("x").get<int>()+r.at("right").get<int>(),origin.at("y").get<int>()+r.at("bottom").get<int>()};
        if(pending.value("kind",std::string())=="select"){
            OpenPopupList(area,pending.value("title",std::string("Value")).c_str(),1);int index=0;
            for(const auto& option:pending.at("options")){if(index>=200)break;AddPopupListElement(option.value("text",std::string()).c_str(),"",SelectFunction+index,option.value("value",std::string())==pending.value("value",std::string()),EuroScopePlugIn::POPUP_ELEMENT_NO_CHECKBOX,option.value("disabled",false));++index;}
        }else OpenPopupEdit(area,EditFunction,pending.value("value",std::string()).c_str());
    }
    void RefreshRadar(){if(host&&host->ConsumeRadarRefresh())for(auto* screen:screens)screen->RequestRefresh();}
    static LRESULT CALLBACK RedrawProcedure(HWND window,UINT message,WPARAM w,LPARAM l){
        if(message==WM_NCCREATE)SetWindowLongPtrW(window,GWLP_USERDATA,reinterpret_cast<LONG_PTR>(reinterpret_cast<CREATESTRUCTW*>(l)->lpCreateParams));
        auto* plugin=reinterpret_cast<Plugin*>(GetWindowLongPtrW(window,GWLP_USERDATA));
        if(message==RedrawMessage&&plugin){try{plugin->DrainEditor();plugin->RefreshRadar();}catch(...){/* Never unwind through the Windows message pump. */}return 0;}
        return DefWindowProcW(window,message,w,l);
    }
    std::vector<RadarScreen*> screens;
    void Report(const std::string& text){DisplayUserMessage("SAAMAN","SAAMAN",text.c_str(),true,true,false,false,false);}
public:
    void OnFunctionCall(int function,const char* text,POINT,RECT) override {
        if(!activeEditor.is_object())return;
        if(function==EditFunction){host->FinishEditor(activeEditor,text?text:"");activeEditor=nullptr;}
        else if(function>=SelectFunction&&function<SelectFunction+200){const auto index=static_cast<size_t>(function-SelectFunction);const auto& options=activeEditor.at("options");if(index<options.size())host->FinishEditor(activeEditor,options[index].value("value",std::string()));activeEditor=nullptr;}
    }
    Plugin():CPlugIn(EuroScopePlugIn::COMPATIBILITY_CODE,"SAAMAN",SAAMAN_VERSION,"SAAMAN contributors; vatIRIS attribution retained","GPLv3"){
        wchar_t path[MAX_PATH]{};GetModuleFileNameW(reinterpret_cast<HINSTANCE>(&__ImageBase),path,MAX_PATH);
        wchar_t local[MAX_PATH]{};GetEnvironmentVariableW(L"LOCALAPPDATA",local,MAX_PATH);
        context=std::make_shared<Context>(std::filesystem::path(path).parent_path(),std::filesystem::path(local)/L"SAAMAN"/L"State");
        RegisterTagItemType("SAAMAN Gain / Lose",71001);RegisterTagItemType("SAAMAN Time to gain",71002);RegisterTagItemType("SAAMAN Time to lose",71003);
        host=std::make_unique<Host>(reinterpret_cast<HINSTANCE>(&__ImageBase),context);
        WNDCLASSW relay{};relay.hInstance=reinterpret_cast<HINSTANCE>(&__ImageBase);relay.lpfnWndProc=RedrawProcedure;relay.lpszClassName=L"SAAMANRadarRefreshRelay";RegisterClassW(&relay);
        redrawWindow=CreateWindowExW(0,relay.lpszClassName,L"SAAMAN repaint relay",0,0,0,0,0,HWND_MESSAGE,nullptr,relay.hInstance,this);host->SetRadarRefreshTarget(redrawWindow,RedrawMessage);
        Report(std::string("Loaded ")+SAAMAN_VERSION+". .saaman · .saaman supervisor");
    }
    ~Plugin() override {
        for(auto* screen:screens)screen->Deactivate();
        host.reset();
        if(redrawWindow)DestroyWindow(redrawWindow);UnregisterClassW(L"SAAMANRadarRefreshRelay",reinterpret_cast<HINSTANCE>(&__ImageBase));
        try{std::lock_guard lock(context->mutex);if(!context->shared&&!context->plan["config"].is_null())context->SavePlan();}catch(...){}
        try{Json clear;{std::lock_guard lock(context->mutex);clear=context->sequence;}if(clear.is_object()&&!clear.empty()){clear["sequence"]=Json::array();clear["data"]["source"]="SAAMAN UNLOADED";clear["data"]["timestamp"]=Now()/1000;MaestroBroadcastSequence(clear.dump());}}catch(...){}
    }
    bool OnCompileCommand(const char* command) override {
        if(!command)return false;
        const std::string text(command);
        if(text==".saaman"||text==".saaman open"){host->Show();return true;}
        if(text==".saaman supervisor"||text==".saaman supervision"){host->Show(true);return true;}
        if(text==".saaman hide"){host->Hide();return true;}
        if(text==".saaman runways"){
            std::lock_guard lock(context->mutex);
            Report("Active ESSA runways "+context->telemetry.value("activeRunways",Json::object()).dump()+"; SDK "+context->telemetry.value("runwayStatus",Json::object()).dump());return true;
        }
        if(text==".saaman status"){
            std::lock_guard lock(context->mutex);Report(std::string(context->telemetry.value("connectionType",0)==EuroScopePlugIn::CONNECTION_TYPE_VIA_PROXY?"Proxy connection; guidance ":"Direct/local connection; guidance ")+(Now()-context->timingAt<=15000?"fresh":"missing/stale")+"; capture age "+(context->captureSuccessAt?std::to_string((Now()-context->captureSuccessAt)/1000)+"s":"no successful capture")+"; capture error "+context->captureError+"; TopSky receivers "+std::to_string(context->receivers)+"; "+(context->shared?"shared backend":"local EuroScope"));return true;
        }
        return false;
    }
    EuroScopePlugIn::CRadarScreen* OnRadarScreenCreated(const char*,bool,bool,bool,bool) override {
        auto* screen=new RadarScreen(*host,[this](RadarScreen* value){screens.erase(std::remove(screens.begin(),screens.end(),value),screens.end());});
        screens.push_back(screen);return screen;
    }
    void OnTimer(int counter) override {
        try{
            Json outgoing;
            bool captureDue=false;{std::lock_guard lock(context->mutex);captureDue=Now()-context->captureAttemptAt>=1500;}
            if(captureDue){
                {std::lock_guard lock(context->mutex);context->captureAttemptAt=Now();}
                try{if(GetConnectionType()==EuroScopePlugIn::CONNECTION_TYPE_NO)holding.Clear();auto data=CaptureTelemetry(*this,winds,holding);std::lock_guard lock(context->mutex);context->telemetry=std::move(data);context->captureSuccessAt=Now();context->captureError.clear();context->SeedRunwayConfig();}
                catch(const std::exception& error){std::lock_guard lock(context->mutex);context->captureError=std::string(error.what()).substr(0,240);}
                catch(...){std::lock_guard lock(context->mutex);context->captureError="Unknown SDK capture error";}
                host->Pulse();
            }
            {std::lock_guard lock(context->mutex);outgoing=context->sequence;
                if(outgoing.is_object()&&!outgoing.empty()&&Now()-context->timingAt>15000){outgoing["sequence"]=Json::array();outgoing["data"]["source"]="STALE";outgoing["data"]["timestamp"]=Now()/1000;}}
            const bool moved=host->ConsumeRadarRefresh();bool refresh=moved;
            if(outgoing.is_object()&&!outgoing.empty()){const auto count=MaestroBroadcastSequence(outgoing.dump());{std::lock_guard lock(context->mutex);context->receivers=count;}refresh=true;}
            if(refresh)for(auto* screen:screens)screen->RequestRefresh();
        }catch(...){/* SDK/data errors must not interrupt the radar thread. */}
    }
    void OnNewMetarReceived(const char* station,const char* metar) override {
        if(!station||!metar||std::string(station)!="ESSA")return;
        const std::string text(metar);std::smatch match;
        if(std::regex_search(text,match,std::regex(R"((\d{3}|VRB)(\d{2,3})(?:G\d{2,3})?(KT|MPS))"))){
            const bool variable=match[1]=="VRB";winds[station]={{"direction",variable?0:std::stoi(match[1])},{"speed",std::stod(match[2])*(match[3]=="MPS"?1.943844:1.0)},{"timestamp",Now()}};
        }
    }
    void OnFlightPlanControllerAssignedDataUpdate(EuroScopePlugIn::CFlightPlan flight,int type) override {
        if(type!=EuroScopePlugIn::CTR_DATA_TYPE_SCRATCH_PAD_STRING||!flight.IsValid())return;
        try{const auto fp=flight.GetFlightPlanData();const auto call=flight.GetCallsign();if(!call||!*call||!fp.IsReceived()||!fp.GetDestination()||strcmp(fp.GetDestination(),"ESSA"))return;holding.Command(call,flight.GetControllerAssignedData().GetScratchPadString(),Now());}catch(...){/* SDK callback must not unwind. */}
    }
    void OnGetTagItem(EuroScopePlugIn::CFlightPlan flight,EuroScopePlugIn::CRadarTarget,int item,int,char text[16],int* color,COLORREF* rgb,double*) override {
        if(item<71001||item>71003)return;text[0]='\0';if(color)*color=EuroScopePlugIn::TAG_COLOR_DEFAULT;
        if(!flight.IsValid())return;const auto fp=flight.GetFlightPlanData();if(!fp.IsReceived()||!fp.GetDestination()||strcmp(fp.GetDestination(),"ESSA"))return;
        std::lock_guard lock(context->mutex);if(Now()-context->timingAt>15000)return;const auto value=context->timing.find(flight.GetCallsign());if(value==context->timing.end())return;
        const int seconds=value->get<int>();if((item==71002&&seconds>=0)||(item==71003&&seconds<=0))return;const int minutes=static_cast<int>(seconds<0?std::ceil(std::abs(seconds)/60.0):std::floor(seconds/60.0));if(!minutes)return;
        sprintf_s(text,16,"%s%d",seconds<0?"-":"",minutes);if(color&&rgb){*color=EuroScopePlugIn::TAG_COLOR_RGB_DEFINED;*rgb=seconds<0?RGB(41,255,40):seconds<=150?RGB(240,225,41):RGB(225,25,25);}
    }
};
}
std::unique_ptr<EuroScopePlugIn::CPlugIn> SAAMANPlugin;
void __declspec(dllexport) EuroScopePlugInInit(EuroScopePlugIn::CPlugIn** result){*result=nullptr;try{SAAMANPlugin=std::make_unique<saaman::Plugin>();*result=SAAMANPlugin.get();}catch(const std::exception& error){MessageBoxA(nullptr,error.what(),"SAAMAN could not initialize",MB_OK|MB_ICONERROR);}}
void __declspec(dllexport) EuroScopePlugInExit(){SAAMANPlugin.reset();}
