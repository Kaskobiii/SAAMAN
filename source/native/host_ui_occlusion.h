#pragma once
#include <windows.h>
#include <vector>
#include <cwchar>
#include <set>

namespace saaman {
inline bool SaamanWindow(HWND window){
    for(auto item=window;item;item=GetParent(item)){
        wchar_t name[96]{};GetClassNameW(item,name,96);
        if(wcscmp(name,L"SAAMANNativeWindow")==0||wcscmp(name,L"SAAMANCoordinationPopup")==0)return true;
    }
    return false;
}
inline bool HostMenuState(const GUITHREADINFO& info){
    // Radar clients can keep mouse capture between clicks. Capture alone
    // does not mean a menu is open and must never suppress our windows.
    return (info.flags&(GUI_INMENUMODE|GUI_POPUPMENUMODE|GUI_SYSTEMMENUMODE))!=0;
}
inline bool HostMenuActive(HWND parent){
    GUITHREADINFO info{sizeof(GUITHREADINFO)};
    if(!GetGUIThreadInfo(GetWindowThreadProcessId(parent,nullptr),&info))return false;
    return HostMenuState(info);
}
// EuroScope controls can be sibling windows reused below our child pane in
// Z order. Remove their rectangles from our native hit/paint region, so they
// remain visible AND clickable. Browser layout and controller state stay put.
class HostUiOcclusion {
    std::vector<RECT> previous;
    SIZE priorSize{};
    bool clipped=false;
    HWND boundParent=nullptr;
    std::set<HWND> permanent;
public:
    void Bind(HWND parent){
        if(boundParent==parent)return;
        boundParent=parent;permanent.clear();previous.clear();priorSize={};
        // Snapshot the host's existing visible layout BEFORE creating panes.
        // Its radar/MDI containers are permanent background, even when inset
        // from the parent client area. Only subsequently shown controls yield
        // paint/input space; hidden reusable menus are absent from this set.
        EnumChildWindows(parent,[](HWND child,LPARAM data)->BOOL{
            auto& self=*reinterpret_cast<HostUiOcclusion*>(data);
            if(GetParent(child)==self.boundParent&&!SaamanWindow(child)&&(GetWindowLongPtrW(child,GWL_STYLE)&WS_VISIBLE))self.permanent.insert(child);
            return TRUE;
        },reinterpret_cast<LPARAM>(this));
    }
    bool Apply(HWND pane,HWND parent,bool headless=false){
        Bind(parent);
        RECT bounds{},client{},parentBounds{};if(!GetWindowRect(pane,&bounds)||!GetClientRect(pane,&client))return false;
        GetClientRect(parent,&parentBounds);MapWindowPoints(parent,HWND_DESKTOP,reinterpret_cast<POINT*>(&parentBounds),2);
        struct Scan {HWND parent;RECT pane,parentBounds;bool headless;const std::set<HWND>& permanent;std::vector<RECT> rectangles;};
        Scan scan{parent,bounds,parentBounds,headless,permanent,{}};
        EnumChildWindows(parent,[](HWND child,LPARAM data)->BOOL{
            auto& s=*reinterpret_cast<Scan*>(data);
            if(GetParent(child)!=s.parent||SaamanWindow(child)||s.permanent.contains(child)||!(GetWindowLongPtrW(child,GWL_STYLE)&WS_VISIBLE)||(!s.headless&&!IsWindowVisible(child)))return TRUE;
            RECT rect{},overlap{};GetWindowRect(child,&rect);
            // A full-client canvas is the radar itself, not an overlaid control.
            if(EqualRect(&rect,&s.parentBounds))return TRUE;
            // Late-created canvas containers must not erase the entire pane.
            RECT inside{};if(IntersectRect(&inside,&rect,&s.pane)&&EqualRect(&inside,&s.pane))return TRUE;
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
        // Multiple unrelated controls must not combine into an empty pane.
        RECT remaining{};if(GetRgnBox(region,&remaining)==NULLREGION){DeleteObject(region);clipped=false;SetWindowRgn(pane,nullptr,TRUE);return true;}
        clipped=true;if(!SetWindowRgn(pane,region,TRUE))DeleteObject(region);
        return true;
    }
};
}
