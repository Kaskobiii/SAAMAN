#include "radar_screen.h"
#include <cstdio>
#include <algorithm>
namespace saaman {
namespace {
constexpr int CotsMove=88001,CotsOpen=88002,SurfaceObject=88003;
thread_local HHOOK wheelHook=nullptr,cursorHook=nullptr;thread_local RadarScreen* wheelScreen=nullptr;
LRESULT CALLBACK CursorHook(int code,WPARAM w,LPARAM l){
    const auto result=CallNextHookEx(cursorHook,code,w,l);
    if(code==HC_ACTION&&wheelScreen){const auto* message=reinterpret_cast<CWPRETSTRUCT*>(l);if(message->message==WM_SETCURSOR&&LOWORD(message->lParam)==HTCLIENT)SetCursor(wheelScreen->Cursor());}
    return result;
}
LRESULT CALLBACK WheelHook(int code,WPARAM message,LPARAM data){
    if(code==HC_ACTION&&wheelScreen){
        if(message==WM_MOUSEWHEEL){const auto* mouse=reinterpret_cast<MOUSEHOOKSTRUCTEX*>(data);wheelScreen->Wheel(mouse->pt,-static_cast<short>(HIWORD(mouse->mouseData)));return 1;}
        if(message==WM_MOUSEMOVE){auto* prior=wheelScreen;wheelScreen=nullptr;prior->Leave();}
        if(message==WM_LBUTTONDOWN||message==WM_RBUTTONDOWN)wheelScreen=nullptr;
    }
    return CallNextHookEx(wheelHook,code,message,data);
}
}
void RadarScreen::Deactivate(){if(wheelScreen==this)wheelScreen=nullptr;if(wheelHook){UnhookWindowsHookEx(wheelHook);wheelHook=nullptr;}if(cursorHook){UnhookWindowsHookEx(cursorHook);cursorHook=nullptr;}host=nullptr;closed={};}
void RadarScreen::ReleaseInput(){wheelScreen=nullptr;}
void RadarScreen::Leave(){if(host&&hoverPane){POINT screen{};GetCursorPos(&screen);POINT point=screen;ScreenToClient(parent,&point);host->Pointer(hoverPane,point,screen,"leave");hoverPane=0;}}
void RadarScreen::Input(const char* id,POINT point,const char* type,int button){
    if(!host||!id)return;unsigned pane=0;try{pane=static_cast<unsigned>(std::stoul(id));}catch(...){return;}
    POINT screen=point;if(parent)ClientToScreen(parent,&screen);const unsigned modifiers=(GetKeyState(VK_CONTROL)<0?1:0)|(GetKeyState(VK_SHIFT)<0?2:0)|(GetKeyState(VK_MENU)<0?4:0);
    if(hoverPane&&hoverPane!=pane)host->Pointer(hoverPane,point,screen,"leave");
    host->Pointer(pane,point,screen,type,button,0,modifiers);hoverPane=pane;hoverPoint=point;SetCursor(Cursor());
    if(!wheelHook)wheelHook=SetWindowsHookExW(WH_MOUSE,WheelHook,nullptr,GetCurrentThreadId());if(!cursorHook)cursorHook=SetWindowsHookExW(WH_CALLWNDPROCRET,CursorHook,nullptr,GetCurrentThreadId());wheelScreen=this;
}
void RadarScreen::Wheel(POINT screen,int delta){if(!host||!hoverPane||!parent)return;POINT point=screen;ScreenToClient(parent,&point);host->Pointer(hoverPane,point,screen,"wheel",0,delta,(GetKeyState(VK_CONTROL)<0?1:0)|(GetKeyState(VK_SHIFT)<0?2:0));}
void RadarScreen::Bind(HDC dc){
    HWND candidate=WindowFromDC(dc);
    if(!candidate){candidate=GetForegroundWindow();if(candidate)candidate=GetAncestor(candidate,GA_ROOTOWNER);}
    DWORD pid=0;if(candidate)GetWindowThreadProcessId(candidate,&pid);
    if(candidate&&pid==GetCurrentProcessId()&&host){parent=candidate;host->Attach(parent,GetRadarArea());}
}
void RadarScreen::OnRefresh(HDC dc,int phase){
    if(!host||phase!=EuroScopePlugIn::REFRESH_PHASE_AFTER_LISTS)return;
    Bind(dc);const auto radar=GetRadarArea();if(!positioned){launcher={radar.left+16,radar.top+185,radar.left+76,radar.top+255};positioned=true;}
    const int saved=SaveDC(dc);
    HBRUSH body=CreateSolidBrush(RGB(91,96,100)),title=CreateSolidBrush(RGB(104,108,112));
    FillRect(dc,&launcher,body);RECT heading{launcher.left,launcher.top,launcher.right,launcher.top+15};FillRect(dc,&heading,title);
    HFONT font=CreateFontW(-12,0,0,0,FW_NORMAL,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Arial");SelectObject(dc,font);SetBkMode(dc,TRANSPARENT);SetTextColor(dc,RGB(204,215,226));
    DrawTextA(dc,"COTS",-1,&heading,DT_CENTER|DT_VCENTER|DT_SINGLELINE);
    RECT icon{launcher.left+18,launcher.top+24,launcher.left+42,launcher.top+48};FrameRect(dc,&icon,static_cast<HBRUSH>(GetStockObject(LTGRAY_BRUSH)));InflateRect(&icon,-3,-3);
    HBRUSH checkbox=CreateSolidBrush(host->IsVisible(false)?RGB(126,166,187):RGB(175,182,187));FillRect(dc,&icon,checkbox);
    RECT caption{launcher.left,launcher.top+50,launcher.right,launcher.bottom};DrawTextA(dc,"AMAN",-1,&caption,DT_CENTER|DT_VCENTER|DT_SINGLELINE);
    RECT button{launcher.left,launcher.top+16,launcher.right,launcher.bottom};
    AddScreenObject(CotsMove,"SAAMAN COTS",heading,true,"Move SAAMAN launcher");
    AddScreenObject(CotsOpen,"SAAMAN AMAN",button,false,"Show/hide ESSA AMAN");
    RestoreDC(dc,saved);DeleteObject(font);DeleteObject(body);DeleteObject(title);DeleteObject(checkbox);
    host->DrawChrome(dc);
    for(const auto& pane:host->PaintRadar(dc)){auto& name=surfaceNames[pane.id];if(name.empty())name=std::to_string(pane.id);AddScreenObject(SurfaceObject,name.c_str(),pane.bounds,true,"");}
}
void RadarScreen::OnClickScreenObject(int type,const char* id,POINT point,RECT,int button){
    if(host&&type==CotsOpen&&button==EuroScopePlugIn::BUTTON_LEFT){host->Toggle(false);RequestRefresh();}
    if(type==SurfaceObject)Input(id,point,"up",button==EuroScopePlugIn::BUTTON_RIGHT?2:button==EuroScopePlugIn::BUTTON_MIDDLE?1:0);
}
void RadarScreen::OnButtonDownScreenObject(int type,const char* id,POINT point,RECT,int button){if(type==SurfaceObject){Input(id,point,"down",button==EuroScopePlugIn::BUTTON_RIGHT?2:button==EuroScopePlugIn::BUTTON_MIDDLE?1:0);dragPane=hoverPane;return;}if(type==CotsMove&&button==EuroScopePlugIn::BUTTON_LEFT){dragOffset={point.x-launcher.left,point.y-launcher.top};moving=true;}}
void RadarScreen::OnButtonUpScreenObject(int,const char*,POINT,RECT,int){}
void RadarScreen::OnOverScreenObject(int type,const char* id,POINT point,RECT){if(type==SurfaceObject)Input(id,point,"move");else{Leave();if(wheelScreen==this)wheelScreen=nullptr;}}
void RadarScreen::OnDoubleClickScreenObject(int type,const char* id,POINT point,RECT,int button){if(type==SurfaceObject)Input(id,point,"double",button==EuroScopePlugIn::BUTTON_RIGHT?2:0);}
void RadarScreen::OnMoveScreenObject(int type,const char* id,POINT point,RECT area,bool released){
    if(type==SurfaceObject){Input(id,point,released?"up":"move");if(released)dragPane=0;return;}
    if(type!=CotsMove)return;if(!moving){dragOffset={point.x-area.left,point.y-area.top};moving=true;}const auto radar=GetRadarArea();const int x=std::max(radar.left,std::min(point.x-dragOffset.x,radar.right-60)),y=std::max(radar.top,std::min(point.y-dragOffset.y,radar.bottom-70));launcher={x,y,x+60,y+70};if(released)moving=false;RequestRefresh();
}
void RadarScreen::OnAsrContentLoaded(bool){
    const char* value=GetDataFromAsr("SAAMAN_COTS");int x=0,y=0;
    if(value&&sscanf_s(value,"%d,%d",&x,&y)==2){launcher={x,y,x+60,y+70};positioned=true;}
}
void RadarScreen::OnAsrContentToBeSaved(){char value[64]{};sprintf_s(value,"%ld,%ld",launcher.left,launcher.top);SaveDataToAsr("SAAMAN_COTS","SAAMAN launcher position",value);}
void RadarScreen::OnAsrContentToBeClosed(){if(host)host->Hide();if(closed)closed(this);Deactivate();delete this;}
}
