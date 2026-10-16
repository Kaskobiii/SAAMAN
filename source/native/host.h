#pragma once
#include "context.h"
#include <windows.h>
#include <memory>
#include <thread>
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
};
}
