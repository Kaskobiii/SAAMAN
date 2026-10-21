#pragma once
#include "context.h"
#include <windows.h>
#include <memory>
#include <thread>
#include <vector>
namespace saaman {
class Host {
    struct Impl;
    std::unique_ptr<Impl> impl;
public:
    Host(HINSTANCE module,std::shared_ptr<Context> context);
    ~Host();
    void Show(bool supervisor=false);
    void Hide();
    void Pulse();
    void RefreshHostUi();
    void Attach(HWND parent,RECT radar);
    void Toggle(bool supervisor=false);
    bool IsVisible(bool supervisor=false) const;
    HWND PanelHandle(bool supervisor=false) const;
    void DrawChrome(HDC radarDC) const;
    bool ConsumeRadarRefresh();
    void SetRadarRefreshTarget(HWND target,UINT message);
    struct Pane {unsigned id;RECT bounds;};
    std::vector<Pane> PaintRadar(HDC dc) const;
    void Pointer(unsigned id,POINT point,POINT screen,const char* type,int button=0,int delta=0,unsigned modifiers=0);
    Json TakeEditor();
    void FinishEditor(const Json& editor,const std::string& value);
    HCURSOR InputCursor(unsigned id=0,POINT point={})const;
    void SetAircraftSelection(const std::string& callsign,bool connected,bool selectedAgain=false);
    std::string HoveredAircraft()const;
};
}
