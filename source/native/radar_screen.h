#pragma once
#include "EuroScopePlugIn.h"
#include "host.h"
#include <functional>
namespace saaman {
class RadarScreen final:public EuroScopePlugIn::CRadarScreen {
    Host* host;
    std::function<void(RadarScreen*)> closed;
    RECT launcher{0,0,60,70};
    bool positioned=false;
    POINT dragOffset{};
    bool moving=false;
    HWND parent=nullptr;
    void Bind(HDC dc);
public:
    RadarScreen(Host& windows,std::function<void(RadarScreen*)> onClose):host(&windows),closed(std::move(onClose)){}
    void Deactivate(){host=nullptr;closed={};}
    void OnRefresh(HDC dc,int phase) override;
    void OnButtonDownScreenObject(int type,const char* id,POINT point,RECT area,int button) override;
    void OnClickScreenObject(int type,const char* id,POINT point,RECT area,int button) override;
    void OnMoveScreenObject(int type,const char* id,POINT point,RECT area,bool released) override;
    void OnAsrContentLoaded(bool loaded) override;
    void OnAsrContentToBeSaved() override;
    void OnAsrContentToBeClosed() override;
};
}
