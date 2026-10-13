#include "coordination_popup.h"
#include <algorithm>
#include <cmath>
#include <ctime>
#include <fstream>
#include <vector>

namespace saaman {
namespace {
const wchar_t* PopupClass=L"SAAMANCoordinationPopup";
std::wstring Text(const std::string& value){const int count=MultiByteToWideChar(CP_UTF8,0,value.data(),static_cast<int>(value.size()),nullptr,0);std::wstring result(count,L'\0');MultiByteToWideChar(CP_UTF8,0,value.data(),static_cast<int>(value.size()),result.data(),count);return result;}
std::string Utf8(const std::wstring& value){const int count=WideCharToMultiByte(CP_UTF8,0,value.data(),static_cast<int>(value.size()),nullptr,0,nullptr,nullptr);std::string result(count,'\0');WideCharToMultiByte(CP_UTF8,0,value.data(),static_cast<int>(value.size()),result.data(),count,nullptr,nullptr);return result;}
void Fill(HDC dc,RECT rect,COLORREF color){const auto brush=CreateSolidBrush(color);FillRect(dc,&rect,brush);DeleteObject(brush);}
void Label(HDC dc,HFONT font,COLORREF color,RECT rect,const std::wstring& text,UINT flags=DT_LEFT|DT_WORDBREAK){const auto previous=SelectObject(dc,font);SetTextColor(dc,color);SetBkMode(dc,TRANSPARENT);DrawTextW(dc,text.c_str(),-1,&rect,flags|DT_NOPREFIX);SelectObject(dc,previous);}
}
CoordinationPopup::~CoordinationPopup(){if(hwnd)DestroyWindow(hwnd);if(messageFont)DeleteObject(messageFont);if(headingFont)DeleteObject(headingFont);if(bodyFont)DeleteObject(bodyFont);UnregisterClassW(PopupClass,module);}
void CoordinationPopup::Hide(){current=Json();enabled=false;busy=false;if(hwnd)ShowWindow(hwnd,SW_HIDE);}
void CoordinationPopup::Update(HWND owner,const Json& data,std::function<void(const std::string&)> callback){
    const auto incoming=data.value("message",Json());if(incoming.is_null()){Hide();return;}
    const auto id=incoming.at("id").get<std::string>(),text=incoming.at("message").get<std::string>();
    const auto callsign=incoming.value("senderCallsign",std::string());const double milliseconds=incoming.at("at").get<double>();
    const auto detail=data.value("status",std::string());
    if(id.empty()||id.size()>100||text.empty()||text.size()>200||callsign.size()>32||detail.size()>2000||!std::isfinite(milliseconds)||milliseconds<0||milliseconds>253402300799000.0)throw RequestError(400,"Invalid coordination popup");
    const bool changed=current.is_null()||current.value("id",std::string())!=id;
    message=Text(text);sender=callsign.empty()?L"Sender unavailable (older version)":Text(callsign);
    const time_t seconds=static_cast<time_t>(milliseconds/1000);tm utc{};wchar_t clock[80]{};
    if(gmtime_s(&utc,&seconds)==0){wcsftime(clock,80,L"Sent %H:%M:%S UTC  \u00b7  %d %b %Y",&utc);sent=clock;}else sent=L"Send time unavailable";
    enabled=data.value("enabled",false);busy=data.value("busy",false);status=Text(detail);
    if(status.empty())status=busy?L"Waiting for confirmation\u2026":enabled?L"":L"Waiting for a fresh shared connection\u2026";
    current=incoming;acknowledge=std::move(callback);
    if(!hwnd){
        WNDCLASSW type{};type.hInstance=module;type.lpfnWndProc=Procedure;type.lpszClassName=PopupClass;type.hCursor=LoadCursorW(nullptr,IDC_ARROW);RegisterClassW(&type);
        dpi=owner?static_cast<int>(GetDpiForWindow(owner)):96;if(!dpi)dpi=96;
        const auto font=[&](int size,int weight){return CreateFontW(-Px(size),0,0,0,weight,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Segoe UI");};
        messageFont=font(23,FW_SEMIBOLD);headingFont=font(16,FW_SEMIBOLD);bodyFont=font(14,FW_NORMAL);
        RECT rect{0,0,Px(540),Px(340)};AdjustWindowRectEx(&rect,WS_POPUP|WS_CAPTION,FALSE,WS_EX_CONTROLPARENT);
        hwnd=CreateWindowExW(WS_EX_CONTROLPARENT,PopupClass,L"AMAN coordination",WS_POPUP|WS_CAPTION|WS_CLIPCHILDREN,0,0,rect.right-rect.left,rect.bottom-rect.top,owner,nullptr,module,this);
        if(!hwnd)throw RequestError(500,"Could not open coordination window");
        button=CreateWindowExW(0,L"BUTTON",L"Acknowledge",WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW,Px(190),Px(240),Px(160),Px(40),hwnd,reinterpret_cast<HMENU>(1),module,nullptr);
    }
    if(owner&&GetWindow(hwnd,GW_OWNER)!=owner)SetWindowLongPtrW(hwnd,GWLP_HWNDPARENT,reinterpret_cast<LONG_PTR>(owner));
    SetWindowTextW(button,busy?L"Acknowledging\u2026":L"Acknowledge");EnableWindow(button,enabled&&!busy);InvalidateRect(hwnd,nullptr,FALSE);InvalidateRect(button,nullptr,FALSE);
    if(changed){
        RECT area{},rect{};if(!owner||!GetWindowRect(owner,&area)){SystemParametersInfoW(SPI_GETWORKAREA,0,&area,0);}GetWindowRect(hwnd,&rect);
        MONITORINFO monitor{sizeof(MONITORINFO)};GetMonitorInfoW(MonitorFromRect(&area,MONITOR_DEFAULTTONEAREST),&monitor);
        const int width=rect.right-rect.left,height=rect.bottom-rect.top;
        const int x=std::max(static_cast<int>(monitor.rcWork.left),std::min(static_cast<int>((area.left+area.right-width)/2),static_cast<int>(monitor.rcWork.right)-width));
        const int y=std::max(static_cast<int>(monitor.rcWork.top),std::min(static_cast<int>((area.top+area.bottom-height)/2),static_cast<int>(monitor.rcWork.bottom)-height));
        SetWindowPos(hwnd,HWND_TOP,x,y,0,0,SWP_NOSIZE|SWP_NOACTIVATE);
        if(!test){ShowWindow(hwnd,SW_SHOWNORMAL);SetForegroundWindow(hwnd);SetFocus(button);FlashWindow(hwnd,TRUE);}
    }
}
void CoordinationPopup::Acknowledge(){
    if(!enabled||busy||current.is_null())return;
    const auto id=current.at("id").get<std::string>();busy=true;EnableWindow(button,FALSE);SetWindowTextW(button,L"Acknowledging\u2026");status=L"Waiting for confirmation\u2026";InvalidateRect(hwnd,nullptr,FALSE);
    if(acknowledge)acknowledge(id);
}
void CoordinationPopup::Paint(HDC dc){
    RECT client{};GetClientRect(hwnd,&client);Fill(dc,client,RGB(45,56,64));
    Fill(dc,{0,0,client.right,Px(5)},RGB(125,177,196));
    Label(dc,headingFont,RGB(170,205,219),{Px(24),Px(20),Px(516),Px(44)},L"ESSA  /  COORDINATION");
    Label(dc,headingFont,RGB(242,248,251),{Px(24),Px(56),Px(516),Px(80)},sender);
    Label(dc,bodyFont,RGB(169,185,197),{Px(24),Px(83),Px(516),Px(106)},sent);
    Fill(dc,{Px(24),Px(124),Px(516),Px(220)},RGB(61,76,86));
    Label(dc,messageFont,RGB(249,250,251),{Px(40),Px(137),Px(500),Px(207)},message);
    Label(dc,bodyFont,RGB(192,207,217),{Px(24),Px(291),Px(516),Px(332)},status,DT_CENTER|DT_WORDBREAK);
}
LRESULT CALLBACK CoordinationPopup::Procedure(HWND window,UINT msg,WPARAM w,LPARAM l){
    auto* self=reinterpret_cast<CoordinationPopup*>(GetWindowLongPtrW(window,GWLP_USERDATA));
    if(msg==WM_NCCREATE){self=static_cast<CoordinationPopup*>(reinterpret_cast<CREATESTRUCTW*>(l)->lpCreateParams);self->hwnd=window;SetWindowLongPtrW(window,GWLP_USERDATA,reinterpret_cast<LONG_PTR>(self));}
    if(!self)return DefWindowProcW(window,msg,w,l);
    if(msg==WM_ERASEBKGND)return 1;
    if(msg==WM_PAINT){PAINTSTRUCT paint{};const auto dc=BeginPaint(window,&paint);self->Paint(dc);EndPaint(window,&paint);return 0;}
    if(msg==WM_PRINTCLIENT){self->Paint(reinterpret_cast<HDC>(w));return 0;}
    if(msg==WM_DRAWITEM){const auto draw=reinterpret_cast<DRAWITEMSTRUCT*>(l);const bool disabled=(draw->itemState&ODS_DISABLED)!=0;Fill(draw->hDC,draw->rcItem,disabled?RGB(76,94,105):(draw->itemState&ODS_SELECTED)?RGB(90,144,164):RGB(137,191,211));wchar_t text[64]{};GetWindowTextW(draw->hwndItem,text,64);Label(draw->hDC,self->headingFont,disabled?RGB(178,190,197):RGB(19,42,53),draw->rcItem,text,DT_CENTER|DT_VCENTER|DT_SINGLELINE);if(draw->itemState&ODS_FOCUS){RECT focus=draw->rcItem;InflateRect(&focus,-4,-4);DrawFocusRect(draw->hDC,&focus);}return TRUE;}
    if(msg==WM_COMMAND&&LOWORD(w)==1&&HIWORD(w)==BN_CLICKED){self->Acknowledge();return 0;}
    // Receipt requires an explicit acknowledgement, never an implicit close.
    if(msg==WM_CLOSE)return 0;
    if(msg==WM_NCDESTROY){self->hwnd=nullptr;self->button=nullptr;SetWindowLongPtrW(window,GWLP_USERDATA,0);}
    return DefWindowProcW(window,msg,w,l);
}
Json CoordinationPopup::Inspect(bool click){
    if(click&&button)SendMessageW(button,BM_CLICK,0,0);
    RECT rect{},area{},buttonRect{},client{};if(hwnd){GetWindowRect(hwnd,&rect);GetWindowRect(GetWindow(hwnd,GW_OWNER),&area);GetClientRect(hwnd,&client);}if(button){GetWindowRect(button,&buttonRect);MapWindowPoints(HWND_DESKTOP,hwnd,reinterpret_cast<POINT*>(&buttonRect),2);}
    return {{"message",current},{"sender",Utf8(sender)},{"sent",Utf8(sent)},{"status",Utf8(status)},{"buttonCenterX",(buttonRect.left+buttonRect.right)/2},{"clientCenterX",client.right/2},{"busy",busy},{"enabled",button&&IsWindowEnabled(button)},{"visible",hwnd&&IsWindowVisible(hwnd)},{"topLevel",hwnd&&(GetWindowLongPtrW(hwnd,GWL_STYLE)&WS_CHILD)==0},{"owned",hwnd&&GetWindow(hwnd,GW_OWNER)!=nullptr},{"x",rect.left},{"y",rect.top},{"width",rect.right-rect.left},{"height",rect.bottom-rect.top},{"ownerX",area.left},{"ownerY",area.top},{"ownerWidth",area.right-area.left},{"ownerHeight",area.bottom-area.top}};
}
void CoordinationPopup::Capture(const std::filesystem::path& file){
    if(!hwnd)return;RECT rect{};GetClientRect(hwnd,&rect);const int width=rect.right,height=rect.bottom;
    HDC dc=CreateCompatibleDC(nullptr);BITMAPINFO info{};info.bmiHeader.biSize=sizeof(BITMAPINFOHEADER);info.bmiHeader.biWidth=width;info.bmiHeader.biHeight=-height;info.bmiHeader.biPlanes=1;info.bmiHeader.biBitCount=32;
    void* pixels=nullptr;const auto bitmap=CreateDIBSection(dc,&info,DIB_RGB_COLORS,&pixels,nullptr,0);const auto old=SelectObject(dc,bitmap);Paint(dc);
    if(button){RECT location{};GetWindowRect(button,&location);MapWindowPoints(HWND_DESKTOP,hwnd,reinterpret_cast<POINT*>(&location),2);SetViewportOrgEx(dc,location.left,location.top,nullptr);DRAWITEMSTRUCT draw{ODT_BUTTON,1,0,ODA_DRAWENTIRE,enabled&&!busy?0u:ODS_DISABLED,button,dc,{0,0,location.right-location.left,location.bottom-location.top},0};SendMessageW(hwnd,WM_DRAWITEM,1,reinterpret_cast<LPARAM>(&draw));}
    BITMAPFILEHEADER header{};header.bfType=0x4D42;header.bfOffBits=sizeof(header)+sizeof(BITMAPINFOHEADER);header.bfSize=header.bfOffBits+width*height*4;std::ofstream output(file,std::ios::binary);output.write(reinterpret_cast<const char*>(&header),sizeof(header));output.write(reinterpret_cast<const char*>(&info.bmiHeader),sizeof(info.bmiHeader));output.write(static_cast<const char*>(pixels),width*height*4);
    SelectObject(dc,old);DeleteObject(bitmap);DeleteDC(dc);
}
}
