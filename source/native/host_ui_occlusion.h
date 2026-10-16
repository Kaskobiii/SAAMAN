#pragma once
#include <windows.h>
#include <vector>
#include <cwchar>

namespace saaman {
inline bool SaamanWindow(HWND window){
    for(auto item=window;item;item=GetParent(item)){
        wchar_t name[96]{};GetClassNameW(item,name,96);
        if(wcscmp(name,L"SAAMANNativeWindow")==0||wcscmp(name,L"SAAMANCoordinationPopup")==0)return true;
    }
    return false;
}
inline bool HostMenuActive(HWND parent){
    GUITHREADINFO info{sizeof(GUITHREADINFO)};
    if(!GetGUIThreadInfo(GetWindowThreadProcessId(parent,nullptr),&info))return false;
    if(info.flags&(GUI_INMENUMODE|GUI_POPUPMENUMODE|GUI_SYSTEMMENUMODE))return true;
    return info.hwndCapture&&!SaamanWindow(info.hwndCapture)&&GetAncestor(info.hwndCapture,GA_ROOT)==GetAncestor(parent,GA_ROOT);
}
// EuroScope controls can be sibling windows reused below our child pane in
// Z order. Remove their rectangles from our native hit/paint region, so they
// remain visible AND clickable. Browser layout and controller state stay put.
class HostUiOcclusion {
    std::vector<RECT> previous;
    SIZE priorSize{};
    bool clipped=false;
public:
    bool Apply(HWND pane,HWND parent,bool headless=false){
        RECT bounds{},client{},parentBounds{};if(!GetWindowRect(pane,&bounds)||!GetClientRect(pane,&client))return false;
        GetClientRect(parent,&parentBounds);MapWindowPoints(parent,HWND_DESKTOP,reinterpret_cast<POINT*>(&parentBounds),2);
        struct Scan {HWND parent;RECT pane,parentBounds;bool headless;std::vector<RECT> rectangles;};
        Scan scan{parent,bounds,parentBounds,headless,{}};
        EnumChildWindows(parent,[](HWND child,LPARAM data)->BOOL{
            auto& s=*reinterpret_cast<Scan*>(data);
            if(GetParent(child)!=s.parent||SaamanWindow(child)||!(GetWindowLongPtrW(child,GWL_STYLE)&WS_VISIBLE)||(!s.headless&&!IsWindowVisible(child)))return TRUE;
            RECT rect{},overlap{};GetWindowRect(child,&rect);
            // A full-client canvas is the radar itself, not an overlaid control.
            if(EqualRect(&rect,&s.parentBounds))return TRUE;
            if(IntersectRect(&overlap,&rect,&s.pane)){OffsetRect(&overlap,-s.pane.left,-s.pane.top);s.rectangles.push_back(overlap);}
            return TRUE;
        },reinterpret_cast<LPARAM>(&scan));
        bool same=scan.rectangles.size()==previous.size()&&client.right==priorSize.cx&&client.bottom==priorSize.cy;
        for(size_t i=0;same&&i<previous.size();++i)same=EqualRect(&scan.rectangles[i],&previous[i])!=FALSE;
        if(same)return false;
        previous=scan.rectangles;priorSize={client.right,client.bottom};
        if(previous.empty()){if(!clipped)return false;clipped=false;SetWindowRgn(pane,nullptr,TRUE);return true;}
        HRGN region=CreateRectRgn(0,0,client.right,client.bottom);
        for(const auto& rect:previous){const auto cut=CreateRectRgn(rect.left,rect.top,rect.right,rect.bottom);CombineRgn(region,region,cut,RGN_DIFF);DeleteObject(cut);}
        clipped=true;if(!SetWindowRgn(pane,region,TRUE))DeleteObject(region);
        return true;
    }
};
}
