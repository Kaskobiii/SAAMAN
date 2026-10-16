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
        baseDpi=owner?static_cast<int>(GetDpiForWindow(owner)):96;if(!baseDpi)baseDpi=96;
        dpi=static_cast<int>(std::round(baseDpi*zoom));Fonts();
        RECT rect{0,0,Px(400),Px(180)};
        hwnd=CreateWindowExW(WS_EX_CONTROLPARENT,PopupClass,L"AMAN coordination",WS_POPUP|WS_CLIPCHILDREN,0,0,rect.right-rect.left,rect.bottom-rect.top,owner,nullptr,module,this);
        if(!hwnd)throw RequestError(500,"Could not open coordination window");
        button=CreateWindowExW(0,L"BUTTON",L"Acknowledge",WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW,0,0,Px(140),Px(28),hwnd,reinterpret_cast<HMENU>(1),module,nullptr);
    }
    if(owner&&GetWindow(hwnd,GW_OWNER)!=owner)SetWindowLongPtrW(hwnd,GWLP_HWNDPARENT,reinterpret_cast<LONG_PTR>(owner));
    Layout();SetWindowTextW(button,busy?L"Acknowledging\u2026":L"Acknowledge");EnableWindow(button,enabled&&!busy);InvalidateRect(hwnd,nullptr,FALSE);InvalidateRect(button,nullptr,FALSE);
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
    const auto id=current.at("id").get<std::string>();busy=true;EnableWindow(button,FALSE);SetWindowTextW(button,L"Acknowledging\u2026");status=L"Waiting for confirmation\u2026";Layout();InvalidateRect(hwnd,nullptr,FALSE);
    if(acknowledge)acknowledge(id);
}
void CoordinationPopup::Fonts(){
    if(messageFont)DeleteObject(messageFont);if(headingFont)DeleteObject(headingFont);if(bodyFont)DeleteObject(bodyFont);
    const auto font=[&](int size,int weight){return CreateFontW(-Px(size),0,0,0,weight,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Arial");};
    messageFont=font(16,FW_SEMIBOLD);headingFont=font(13,FW_SEMIBOLD);bodyFont=font(12,FW_NORMAL);
}
void CoordinationPopup::SetZoom(double factor){
    if(!std::isfinite(factor)||factor<0.25||factor>5)return;
    zoom=factor;if(!hwnd)return;
    const int scaled=static_cast<int>(std::round(baseDpi*zoom));if(scaled==dpi)return;
    dpi=scaled;Fonts();Layout();InvalidateRect(hwnd,nullptr,FALSE);InvalidateRect(button,nullptr,FALSE);
}
void CoordinationPopup::Layout(){
    const HDC dc=GetDC(hwnd);RECT text{0,0,Px(368),0};const auto old=SelectObject(dc,messageFont);
    DrawTextW(dc,message.c_str(),-1,&text,DT_CALCRECT|DT_WORDBREAK|DT_NOPREFIX);SelectObject(dc,old);ReleaseDC(hwnd,dc);
    const int messageHeight=std::max(Px(38),static_cast<int>(text.bottom)),buttonTop=Px(86)+messageHeight+Px(12);
    const int height=buttonTop+Px(28)+Px(12)+(status.empty()?0:Px(38));
    SetWindowPos(hwnd,nullptr,0,0,Px(400),height,SWP_NOMOVE|SWP_NOZORDER|SWP_NOACTIVATE);
    SetWindowPos(button,nullptr,Px(130),buttonTop,Px(140),Px(28),SWP_NOZORDER|SWP_NOACTIVATE);
}
void CoordinationPopup::Paint(HDC dc){
    RECT client{};GetClientRect(hwnd,&client);Fill(dc,client,RGB(133,154,167));
    Fill(dc,{0,0,client.right,Px(24)},RGB(94,97,101));
    const auto edge=CreateSolidBrush(RGB(173,190,200));FrameRect(dc,&client,edge);DeleteObject(edge);
    Label(dc,headingFont,RGB(220,230,241),{Px(8),0,client.right-Px(8),Px(24)},L"COORDINATION",DT_CENTER|DT_VCENTER|DT_SINGLELINE);
    Label(dc,headingFont,RGB(20,38,48),{Px(16),Px(34),Px(384),Px(54)},sender);
    Label(dc,bodyFont,RGB(20,38,48),{Px(16),Px(57),Px(384),Px(75)},sent);
    RECT location{};GetWindowRect(button,&location);MapWindowPoints(HWND_DESKTOP,hwnd,reinterpret_cast<POINT*>(&location),2);
    Label(dc,messageFont,RGB(20,38,48),{Px(16),Px(86),Px(384),location.top-Px(10)},message);
    Label(dc,bodyFont,RGB(20,38,48),{Px(16),location.bottom+Px(7),Px(384),client.bottom-Px(5)},status,DT_CENTER|DT_WORDBREAK);
}
LRESULT CALLBACK CoordinationPopup::Procedure(HWND window,UINT msg,WPARAM w,LPARAM l){
    auto* self=reinterpret_cast<CoordinationPopup*>(GetWindowLongPtrW(window,GWLP_USERDATA));
    if(msg==WM_NCCREATE){self=static_cast<CoordinationPopup*>(reinterpret_cast<CREATESTRUCTW*>(l)->lpCreateParams);self->hwnd=window;SetWindowLongPtrW(window,GWLP_USERDATA,reinterpret_cast<LONG_PTR>(self));}
    if(!self)return DefWindowProcW(window,msg,w,l);
    if(msg==WM_NCHITTEST){POINT point{static_cast<short>(LOWORD(l)),static_cast<short>(HIWORD(l))};ScreenToClient(window,&point);if(point.y>=0&&point.y<self->Px(24))return HTCAPTION;return HTCLIENT;}
    if(msg==WM_ERASEBKGND)return 1;
    if(msg==WM_PAINT){PAINTSTRUCT paint{};const auto dc=BeginPaint(window,&paint);self->Paint(dc);EndPaint(window,&paint);return 0;}
    if(msg==WM_PRINTCLIENT){self->Paint(reinterpret_cast<HDC>(w));return 0;}
    if(msg==WM_DRAWITEM){const auto draw=reinterpret_cast<DRAWITEMSTRUCT*>(l);const bool disabled=(draw->itemState&ODS_DISABLED)!=0;const auto fill=CreateSolidBrush(disabled?RGB(115,132,143):(draw->itemState&ODS_SELECTED)?RGB(120,160,184):RGB(154,168,179));const auto border=CreatePen(PS_SOLID,1,RGB(193,201,207));const auto oldBrush=SelectObject(draw->hDC,fill),oldPen=SelectObject(draw->hDC,border);RoundRect(draw->hDC,draw->rcItem.left,draw->rcItem.top,draw->rcItem.right,draw->rcItem.bottom,self->Px(8),self->Px(8));SelectObject(draw->hDC,oldBrush);SelectObject(draw->hDC,oldPen);DeleteObject(fill);DeleteObject(border);wchar_t text[64]{};GetWindowTextW(draw->hwndItem,text,64);Label(draw->hDC,self->headingFont,disabled?RGB(199,207,212):RGB(20,38,48),draw->rcItem,text,DT_CENTER|DT_VCENTER|DT_SINGLELINE);if(draw->itemState&ODS_FOCUS){RECT focus=draw->rcItem;InflateRect(&focus,-4,-4);DrawFocusRect(draw->hDC,&focus);}return TRUE;}
    if(msg==WM_COMMAND&&LOWORD(w)==1&&HIWORD(w)==BN_CLICKED){self->Acknowledge();return 0;}
    // Receipt requires an explicit acknowledgement, never an implicit close.
    if(msg==WM_CLOSE)return 0;
    if(msg==WM_NCDESTROY){self->hwnd=nullptr;self->button=nullptr;SetWindowLongPtrW(window,GWLP_USERDATA,0);}
    return DefWindowProcW(window,msg,w,l);
}
Json CoordinationPopup::Inspect(bool click){
    if(click&&button)SendMessageW(button,BM_CLICK,0,0);
    RECT rect{},area{},buttonRect{},client{};if(hwnd){GetWindowRect(hwnd,&rect);GetWindowRect(GetWindow(hwnd,GW_OWNER),&area);GetClientRect(hwnd,&client);}if(button){GetWindowRect(button,&buttonRect);MapWindowPoints(HWND_DESKTOP,hwnd,reinterpret_cast<POINT*>(&buttonRect),2);}
    POINT titlePoint{Px(12),Px(12)};if(hwnd)ClientToScreen(hwnd,&titlePoint);
    return {{"systemCaption",hwnd&&(GetWindowLongPtrW(hwnd,GWL_STYLE)&WS_CAPTION)!=0},{"titleDraggable",hwnd&&SendMessageW(hwnd,WM_NCHITTEST,0,MAKELPARAM(titlePoint.x,titlePoint.y))==HTCAPTION},{"dpi",dpi},{"buttonBottom",buttonRect.bottom},{"message",current},{"sender",Utf8(sender)},{"sent",Utf8(sent)},{"status",Utf8(status)},{"buttonCenterX",(buttonRect.left+buttonRect.right)/2},{"clientCenterX",client.right/2},{"busy",busy},{"enabled",button&&IsWindowEnabled(button)},{"visible",hwnd&&IsWindowVisible(hwnd)},{"topLevel",hwnd&&(GetWindowLongPtrW(hwnd,GWL_STYLE)&WS_CHILD)==0},{"owned",hwnd&&GetWindow(hwnd,GW_OWNER)!=nullptr},{"x",rect.left},{"y",rect.top},{"width",rect.right-rect.left},{"height",rect.bottom-rect.top},{"ownerX",area.left},{"ownerY",area.top},{"ownerWidth",area.right-area.left},{"ownerHeight",area.bottom-area.top}};
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
