#pragma once
#include <windows.h>
#include "context.h"
#include "radar_surface.h"
#include <functional>

namespace saaman {
// An owned top-level window on the host STA; it never creates a relay/WebView.
class CoordinationPopup {
    HINSTANCE module;
    HWND hwnd=nullptr,button=nullptr;
    HFONT messageFont=nullptr,headingFont=nullptr,bodyFont=nullptr;
    int dpi=96,baseDpi=96;
    double zoom=1.0;
    bool test=false,enabled=false,busy=false,hostUiAllowed=true,sdk=false,dragging=false,pressed=false;
    POINT dragOrigin{},dragWindow{};
    Json current;
    std::wstring message,sender,sent,status;
    std::function<void(const std::string&)> acknowledge;
    int Px(int value)const{return MulDiv(value,dpi,96);}
    void Fonts();
    void Layout();
    void Paint(HDC dc);
    void Acknowledge();
    static LRESULT CALLBACK Procedure(HWND,UINT,WPARAM,LPARAM);
public:
    CoordinationPopup(HINSTANCE image,bool testing,bool radarSurface=false):module(image),test(testing),sdk(radarSurface){}
    ~CoordinationPopup();
    void Update(HWND owner,const Json& data,std::function<void(const std::string&)> callback);
    void Hide();
    void SetZoom(double factor);
    void AllowHostUi(bool allowed);
    bool Route(MSG& msg)const{return hwnd&&IsWindowVisible(hwnd)&&(msg.hwnd==hwnd||IsChild(hwnd,msg.hwnd))&&IsDialogMessageW(hwnd,&msg);}
    Json Inspect(bool click=false);
    void Capture(const std::filesystem::path& file);
    RadarSurface Surface(HWND parent);
    void Pointer(HWND parent,POINT point,const std::string& type);
};
}
