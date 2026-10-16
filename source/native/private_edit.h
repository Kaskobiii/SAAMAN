#pragma once
#include <windows.h>
#include <functional>
#include <string>
#include <vector>
namespace saaman {
// EuroScope's popup edit is unmasked. Keep secret entry in a password control
// rather than sending a controller key through the host's ordinary text edit.
class PrivateEdit {
    HWND hwnd=nullptr,input=nullptr;std::function<void(std::wstring)> apply;
    static INT_PTR CALLBACK Procedure(HWND window,UINT message,WPARAM w,LPARAM l){
        auto* self=reinterpret_cast<PrivateEdit*>(GetWindowLongPtrW(window,GWLP_USERDATA));
        if(message==WM_INITDIALOG){self=reinterpret_cast<PrivateEdit*>(l);self->hwnd=window;SetWindowLongPtrW(window,GWLP_USERDATA,reinterpret_cast<LONG_PTR>(self));
            SetWindowTextW(window,L"Controller key");self->input=CreateWindowExW(WS_EX_CLIENTEDGE,L"EDIT",L"",WS_CHILD|WS_VISIBLE|WS_TABSTOP|ES_PASSWORD|ES_AUTOHSCROLL,10,12,330,24,window,reinterpret_cast<HMENU>(100),nullptr,nullptr);SendMessageW(self->input,EM_SETLIMITTEXT,50,0);
            CreateWindowExW(0,L"BUTTON",L"Apply",WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_DEFPUSHBUTTON,172,48,80,25,window,reinterpret_cast<HMENU>(IDOK),nullptr,nullptr);CreateWindowExW(0,L"BUTTON",L"Cancel",WS_CHILD|WS_VISIBLE|WS_TABSTOP,260,48,80,25,window,reinterpret_cast<HMENU>(IDCANCEL),nullptr,nullptr);SendMessageW(window,DM_SETDEFID,IDOK,0);SetFocus(self->input);return FALSE;}
        if(!self)return FALSE;
        if(message==WM_COMMAND&&(LOWORD(w)==IDOK||LOWORD(w)==IDCANCEL)){if(LOWORD(w)==IDOK){wchar_t text[51]{};GetWindowTextW(self->input,text,51);if(self->apply)self->apply(text);SecureZeroMemory(text,sizeof(text));}DestroyWindow(window);return TRUE;}
        if(message==WM_CLOSE){DestroyWindow(window);return TRUE;}
        if(message==WM_NCDESTROY){self->hwnd=nullptr;self->input=nullptr;SetWindowLongPtrW(window,GWLP_USERDATA,0);}return FALSE;
    }
public:
    ~PrivateEdit(){if(hwnd)DestroyWindow(hwnd);}
    void Show(HINSTANCE module,HWND owner,std::function<void(std::wstring)> callback){
        if(hwnd)DestroyWindow(hwnd);apply=std::move(callback);std::vector<DWORD> bytes(32,0);auto* data=reinterpret_cast<DLGTEMPLATE*>(bytes.data());data->style=WS_POPUP|WS_CAPTION|WS_SYSMENU|DS_MODALFRAME;data->cx=240;data->cy=62;
        hwnd=CreateDialogIndirectParamW(module,data,owner,Procedure,reinterpret_cast<LPARAM>(this));if(!hwnd)return;RECT root{},rect{};GetWindowRect(owner,&root);GetWindowRect(hwnd,&rect);SetWindowPos(hwnd,HWND_TOP,(root.left+root.right-(rect.right-rect.left))/2,(root.top+root.bottom-(rect.bottom-rect.top))/2,360,115,SWP_SHOWWINDOW);SetFocus(input);
    }
    bool Route(MSG& message)const{return hwnd&&IsDialogMessageW(hwnd,&message);}
};
}
