#include "radar_screen.h"
#include <cstdio>
#include <algorithm>
namespace saaman {
namespace {constexpr int CotsMove=88001,CotsOpen=88002;}
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
}
void RadarScreen::OnClickScreenObject(int type,const char*,POINT,RECT,int button){
    if(host&&type==CotsOpen&&button==EuroScopePlugIn::BUTTON_LEFT){host->Toggle(false);RequestRefresh();}
}
void RadarScreen::OnButtonDownScreenObject(int type,const char*,POINT point,RECT,int button){if(type==CotsMove&&button==EuroScopePlugIn::BUTTON_LEFT){dragOffset={point.x-launcher.left,point.y-launcher.top};moving=true;}}
void RadarScreen::OnMoveScreenObject(int type,const char*,POINT point,RECT area,bool released){
    if(type!=CotsMove)return;if(!moving){dragOffset={point.x-area.left,point.y-area.top};moving=true;}const auto radar=GetRadarArea();const int x=std::max(radar.left,std::min(point.x-dragOffset.x,radar.right-60)),y=std::max(radar.top,std::min(point.y-dragOffset.y,radar.bottom-70));launcher={x,y,x+60,y+70};if(released)moving=false;RequestRefresh();
}
void RadarScreen::OnAsrContentLoaded(bool){
    const char* value=GetDataFromAsr("SAAMAN_COTS");int x=0,y=0;
    if(value&&sscanf_s(value,"%d,%d",&x,&y)==2){launcher={x,y,x+60,y+70};positioned=true;}
}
void RadarScreen::OnAsrContentToBeSaved(){char value[64]{};sprintf_s(value,"%ld,%ld",launcher.left,launcher.top);SaveDataToAsr("SAAMAN_COTS","SAAMAN launcher position",value);}
void RadarScreen::OnAsrContentToBeClosed(){if(host)host->Hide();if(closed)closed(this);delete this;}
}
