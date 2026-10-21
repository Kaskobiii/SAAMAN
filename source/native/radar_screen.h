#pragma once
#include "EuroScopePlugIn.h"
#include "host.h"
#include <functional>
#include <map>
namespace saaman {
class RadarScreen final:public EuroScopePlugIn::CRadarScreen {
    Host* host;
    std::function<void(RadarScreen*)> closed;
    RECT launcher{0,0,60,70};
    bool positioned=false;
    POINT dragOffset{};
    bool moving=false;
    HWND parent=nullptr;
    unsigned hoverPane=0,dragPane=0;POINT hoverPoint{};
    std::map<unsigned,std::string> surfaceNames;
    void Input(const char* id,POINT point,const char* type,int button=0);
    void Bind(HDC dc);
    void DrawAircraftHighlight(HDC dc);
public:
    RadarScreen(Host& windows,std::function<void(RadarScreen*)> onClose):host(&windows),closed(std::move(onClose)){}
    void Deactivate();
    void OnRefresh(HDC dc,int phase) override;
    void OnButtonDownScreenObject(int type,const char* id,POINT point,RECT area,int button) override;
    void OnButtonUpScreenObject(int type,const char* id,POINT point,RECT area,int button) override;
    void OnOverScreenObject(int type,const char* id,POINT point,RECT area) override;
    void OnDoubleClickScreenObject(int type,const char* id,POINT point,RECT area,int button) override;
    void OnClickScreenObject(int type,const char* id,POINT point,RECT area,int button) override;
    void OnMoveScreenObject(int type,const char* id,POINT point,RECT area,bool released) override;
    void OnAsrContentLoaded(bool loaded) override;
    void OnAsrContentToBeSaved() override;
    void OnAsrContentToBeClosed() override;
    void Wheel(POINT screen,int delta);
    HCURSOR Cursor()const{return host?host->InputCursor(hoverPane,hoverPoint):LoadCursorW(nullptr,IDC_ARROW);}
    static void ReleaseInput();
    void Leave();
};
}
