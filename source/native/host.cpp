#include "host.h"
#include "panel_chrome.h"
#include "host_ui_occlusion.h"
#include "coordination_popup.h"
#include <unknwn.h>
#include <objbase.h>
#include "WebView2.h"
#include "WebView2EnvironmentOptions.h"
#include "embedded_assets.h"
#include "auth_client.h"
#include <wrl.h>
#include <shlwapi.h>
#include <shellapi.h>
#include <vector>
#include <fstream>
#include <algorithm>
#include <atomic>
#include <map>
#include <cmath>
using Microsoft::WRL::ComPtr;
using Microsoft::WRL::Callback;
namespace saaman {
namespace {
constexpr UINT ShowMessage=WM_APP+41,StopMessage=WM_APP+42,CloseAuth=WM_APP+43,HideMessage=WM_APP+44,PulseMessage=WM_APP+45,AttachMessage=WM_APP+46,ToggleMessage=WM_APP+47;
struct Attachment {HWND parent;RECT radar;};
const wchar_t* WindowClass=L"SAAMANNativeWindow";
std::wstring Wide(const std::string& text){const int size=MultiByteToWideChar(CP_UTF8,0,text.data(),static_cast<int>(text.size()),nullptr,0);std::wstring result(size,L'\0');MultiByteToWideChar(CP_UTF8,0,text.data(),static_cast<int>(text.size()),result.data(),size);return result;}
std::string Narrow(const wchar_t* text){if(!text)return {};const int size=WideCharToMultiByte(CP_UTF8,0,text,-1,nullptr,0,nullptr,nullptr);std::string result(size,'\0');WideCharToMultiByte(CP_UTF8,0,text,-1,result.data(),size,nullptr,nullptr);if(!result.empty())result.pop_back();return result;}
std::string Decode(std::string text){std::string result;for(size_t i=0;i<text.size();++i){if(text[i]=='%'&&i+2<text.size()){const auto hex=text.substr(i+1,2);char* end=nullptr;const long value=strtol(hex.c_str(),&end,16);if(end&&*end==0){result+=static_cast<char>(value);i+=2;continue;}}result+=text[i]=='+'?' ':text[i];}return result;}
std::string Parameter(const std::string& url,const std::string& name){const auto start=url.find('?');if(start==std::string::npos)return {};size_t pos=start+1;while(pos<url.size()){const auto end=url.find('&',pos);const auto part=url.substr(pos,end==std::string::npos?end:end-pos);const auto equal=part.find('=');if(Decode(part.substr(0,equal))==name)return equal==std::string::npos?"":Decode(part.substr(equal+1));if(end==std::string::npos)break;pos=end+1;}return {};}
bool Trusted(const std::wstring& url){return url.rfind(L"https://saaman.local/",0)==0;}
}
struct Host::Impl {
    struct Window:std::enable_shared_from_this<Window>{
        Impl& host;bool supervisor=false,auth=false,floating=false,floatingVisible=false,completed=false,destroying=false,smokeStarted=false,zoomReady=false;
        HostUiOcclusion hostOcclusion;
        std::string floatingKey;std::weak_ptr<Window> floatingOwner;
        ComPtr<ICoreWebView2NewWindowRequestedEventArgs> openArgs;ComPtr<ICoreWebView2Deferral> openDeferral;
        HWND hwnd=nullptr;ComPtr<ICoreWebView2Controller> controller;ComPtr<ICoreWebView2> browser;ComPtr<ICoreWebView2Environment> environment;
        bool dragging=false,resizing=false;POINT dragStart{};RECT dragRect{},previousBounds{};bool havePreviousBounds=false;
        std::weak_ptr<Window> authOwner;int authRequest=0;std::string authUrl,redirect,state;
        explicit Window(Impl& owner,bool admin):host(owner),supervisor(admin){}
        void Reply(int id,const Json& result,bool ok=true,int status=200,const std::string& error=""){
            if(!browser)return;const auto message=Wide(Json({{"id",id},{"ok",ok},{"result",result},{"status",status},{"error",error}}).dump());browser->PostWebMessageAsJson(message.c_str());
        }
        void Create(bool show=true){
            if(!auth){
                if(!IsWindow(host.parent)){destroying=true;return;}
                hostOcclusion.Bind(host.parent);
                const auto area=host.radar;const int width=std::min(supervisor?1050:780,static_cast<int>(area.right-area.left-90)),height=std::min(760,static_cast<int>(area.bottom-area.top-30));
                const int panelWidth=std::min(std::max(360,width),static_cast<int>(area.right-area.left)),panelHeight=std::min(std::max(380,height),static_cast<int>(area.bottom-area.top));
                const int x=area.left+std::min(85,std::max(0,static_cast<int>(area.right-area.left)-panelWidth)),y=area.top+std::min(25,std::max(0,static_cast<int>(area.bottom-area.top)-panelHeight));
                hwnd=CreateWindowExW(WS_EX_NOPARENTNOTIFY,WindowClass,supervisor?L"SAAMAN SUPERVISION":L"AMAN",WS_CHILD|WS_CLIPCHILDREN|WS_CLIPSIBLINGS,x,y,panelWidth,panelHeight,host.parent,nullptr,host.module,this);
                if(!floating){host.panels[supervisor?1:0].store(hwnd);host.visible[supervisor?1:0].store(hwnd!=nullptr&&show);}
            }else{
            HWND owner=GetForegroundWindow();DWORD pid=0;GetWindowThreadProcessId(owner,&pid);if(pid!=GetCurrentProcessId())owner=nullptr;
            else owner=GetAncestor(owner,GA_ROOTOWNER);
            hwnd=CreateWindowExW(0,WindowClass,auth?L"SAAMAN · VATSIM sign in":supervisor?L"SAAMAN · ESSA supervision":L"SAAMAN · ESSA arrivals",WS_OVERLAPPEDWINDOW,CW_USEDEFAULT,CW_USEDEFAULT,supervisor?1100:820,auth?780:820,owner,nullptr,host.module,this);
            }
            if(!hwnd)return;
            ShowWindow(hwnd,host.context->test||!show?SW_HIDE:SW_SHOW);
            if(floating){InitializeController();return;}
            std::weak_ptr<Window> weak=shared_from_this();
            auto options=Microsoft::WRL::Make<CoreWebView2EnvironmentOptions>();
            options->put_AdditionalBrowserArguments(L"--disable-gpu --disable-gpu-compositing");
            const HRESULT started=CreateCoreWebView2EnvironmentWithOptions(nullptr,host.context->profile.c_str(),options.Get(),Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>([weak](HRESULT error,ICoreWebView2Environment* env)->HRESULT{
                auto self=weak.lock();if(!self||self->destroying)return S_OK;
                if(FAILED(error)||!env){self->Fail(L"Microsoft WebView2 Runtime is required. Install it from Microsoft's WebView2 download page, then reopen SAAMAN.");return S_OK;}
                self->environment=env;self->InitializeController();return S_OK;
            }).Get());
            if(FAILED(started))Fail(L"WebView2 could not initialize. Check the Microsoft WebView2 Runtime installation.");
        }
        void InitializeController(){
            std::weak_ptr<Window> weak=shared_from_this();
            environment->CreateCoreWebView2Controller(hwnd,Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>([weak](HRESULT code,ICoreWebView2Controller* control)->HRESULT{
                    auto window=weak.lock();if(!window||window->destroying)return S_OK;
                    if(FAILED(code)||!control){window->Fail(L"The embedded AMAN window could not be created.");return S_OK;}
                    window->controller=control;ComPtr<ICoreWebView2Controller2> opaque;if(SUCCEEDED(control->QueryInterface(IID_PPV_ARGS(&opaque))))opaque->put_DefaultBackgroundColor({255,73,80,85});control->get_CoreWebView2(&window->browser);window->Setup();window->Present(window->floating?false:window->auth||window->host.visible[window->supervisor?1:0].load());
                    if(window->floating){window->openArgs->put_NewWindow(window->browser.Get());window->openArgs->put_Handled(TRUE);window->openDeferral->Complete();window->openArgs.Reset();window->openDeferral.Reset();}
                    return S_OK;
                }).Get());
        }
        void Fail(const wchar_t* message){if(openDeferral){openArgs->put_Handled(TRUE);openDeferral->Complete();openDeferral.Reset();openArgs.Reset();}SetWindowTextW(hwnd,message);if(host.context->test){std::ofstream(host.context->directory/L"host-test-failure.txt")<<Narrow(message);SetEvent(host.testDone);}else MessageBoxW(hwnd,message,L"SAAMAN",MB_ICONERROR|MB_OK);}
        void ApplyZoom(double zoom){
            if(auth||!controller)return;
            double prior=1;controller->get_ZoomFactor(&prior);if(std::abs(prior-zoom)>0.000001)controller->put_ZoomFactor(zoom);
            if(browser)browser->ExecuteScript(L"window.dispatchEvent(new Event('saaman-zoom'))",nullptr);
        }
        int FloatingPixels(const Json& data,const char* field,double fallback){
            const double scale=data.value("scale",1.0),value=data.value(field,fallback);
            if(!std::isfinite(scale)||scale<0.1||scale>10||!std::isfinite(value)||std::abs(value)>20000)throw RequestError(400,"Invalid submenu dimensions");
            return static_cast<int>(std::ceil(value*scale));
        }
        void Bounds(){if(controller&&hwnd){RECT rect;GetClientRect(hwnd,&rect);controller->put_Bounds(rect);}}
        void Present(bool show){
            if(!hwnd)return;
            if(floating)floatingVisible=show;
            if(!show&&!auth&&!floating)for(const auto& child:host.windows)if(child->floating&&child->floatingOwner.lock().get()==this&&!child->destroying){child->Present(false);if(browser){const auto event=Wide(Json({{"event","floating-close"},{"key",child->floatingKey}}).dump());browser->PostWebMessageAsJson(event.c_str());}}
            if(controller){Bounds();controller->put_IsVisible(show&&!host.hostUiBusy?TRUE:FALSE);controller->NotifyParentWindowPositionChanged();}
            const bool wasVisible=IsWindowVisible(hwnd)!=FALSE;
            ShowWindow(hwnd,show&&!host.hostUiBusy&&!host.context->test?SW_SHOW:SW_HIDE);
            if(!auth&&wasVisible!=show)host.MarkRadarDirty();
            if(show){SetWindowPos(hwnd,HWND_TOP,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE|SWP_FRAMECHANGED);RedrawWindow(hwnd,nullptr,nullptr,RDW_INVALIDATE|RDW_ALLCHILDREN|RDW_UPDATENOW);}
        }
        void Paint(){
            PAINTSTRUCT paint{};const HDC dc=BeginPaint(hwnd,&paint);RECT client;GetClientRect(hwnd,&client);
            DrawPanelChrome(dc,client,supervisor);EndPaint(hwnd,&paint);
        }
        void Setup(){
            Bounds();ComPtr<ICoreWebView2Settings> settings;browser->get_Settings(&settings);settings->put_IsStatusBarEnabled(FALSE);settings->put_AreDevToolsEnabled(FALSE);settings->put_AreDefaultContextMenusEnabled(FALSE);
            std::weak_ptr<Window> weak=shared_from_this();EventRegistrationToken token{};
            if(!auth){
                if(host.zoomInitialized)ApplyZoom(host.uiZoom);
                controller->add_ZoomFactorChanged(Callback<ICoreWebView2ZoomFactorChangedEventHandler>([weak](ICoreWebView2Controller* control,IUnknown*)->HRESULT{
                    if(auto self=weak.lock())if(!self->destroying&&self->zoomReady){double zoom=1;control->get_ZoomFactor(&zoom);self->host.ShareZoom(zoom);}return S_OK;
                }).Get(),&token);
            }
            if(!auth){
                browser->AddWebResourceRequestedFilter(L"https://saaman.local/*",COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
                browser->add_WebResourceRequested(Callback<ICoreWebView2WebResourceRequestedEventHandler>([weak](ICoreWebView2*,ICoreWebView2WebResourceRequestedEventArgs* args)->HRESULT{
                    auto self=weak.lock();if(!self||self->destroying)return S_OK;
                    ComPtr<ICoreWebView2WebResourceRequest> request;args->get_Request(&request);LPWSTR uri=nullptr;request->get_Uri(&uri);std::wstring url=uri?uri:L"";CoTaskMemFree(uri);
                    if(!Trusted(url))return S_OK;std::string path=Narrow(url.c_str()+std::wstring(L"https://saaman.local").size());const auto query=path.find_first_of("?#");if(query!=std::string::npos)path.resize(query);if(path=="/")path="/index.html";
                    const EmbeddedAsset* asset=nullptr;for(const auto& entry:EmbeddedAssets)if(path==entry.path){asset=&entry;break;}
                    ComPtr<IStream> stream;std::wstring headers=L"Cache-Control: no-store\r\n";
                    if(asset){const HRSRC resource=FindResourceW(self->host.module,MAKEINTRESOURCEW(asset->id),RT_RCDATA);const HGLOBAL loaded=LoadResource(self->host.module,resource);const DWORD size=SizeofResource(self->host.module,resource);stream.Attach(SHCreateMemStream(static_cast<const BYTE*>(LockResource(loaded)),size));headers+=L"Content-Type: "+Wide(asset->mime)+L"\r\n";}
                    else{const std::string missing="Resource not found";stream.Attach(SHCreateMemStream(reinterpret_cast<const BYTE*>(missing.data()),static_cast<UINT>(missing.size())));headers+=L"Content-Type: text/plain\r\n";}
                    ComPtr<ICoreWebView2WebResourceResponse> response;self->environment->CreateWebResourceResponse(stream.Get(),asset?200:404,asset?L"OK":L"Not Found",headers.c_str(),&response);args->put_Response(response.Get());return S_OK;
                }).Get(),&token);
                browser->add_WebMessageReceived(Callback<ICoreWebView2WebMessageReceivedEventHandler>([weak](ICoreWebView2*,ICoreWebView2WebMessageReceivedEventArgs* args)->HRESULT{
                    auto self=weak.lock();if(!self||self->destroying)return S_OK;LPWSTR origin=nullptr;args->get_Source(&origin);const bool trusted=origin&&Trusted(origin);CoTaskMemFree(origin);if(!trusted)return S_OK;
                    LPWSTR raw=nullptr;args->get_WebMessageAsJson(&raw);const std::string message=Narrow(raw);CoTaskMemFree(raw);if(message.size()>8*1024*1024)return S_OK;
                    int id=0;
                    try{const Json request=Json::parse(message);id=request.at("id").get<int>();const auto method=request.at("method").get<std::string>();const Json data=request.value("data",Json::object());
                        if(method=="auth:open"){self->OpenAuth(id,data);return S_OK;}
                        if(method=="auth:user"){self->Reply(id,ReadVatsimUser(data));return S_OK;}
                        if(!self->auth&&!self->floating&&method.rfind("host:floating-",0)==0){
                            const auto key=data.at("key").get<std::string>();std::shared_ptr<Window> child;
                            for(const auto& candidate:self->host.windows)if(candidate->floating&&candidate->floatingKey==key&&candidate->floatingOwner.lock()==self&&!candidate->destroying){child=candidate;break;}
                            if(!child){if(method=="host:floating-hide"){self->Reply(id,true);return S_OK;}throw RequestError(400,"The submenu window is not ready");}
                            if(method=="host:floating-show"){
                                RECT origin{};GetWindowRect(self->hwnd,&origin);MapWindowPoints(HWND_DESKTOP,self->host.parent,reinterpret_cast<POINT*>(&origin),2);
                                const auto area=self->host.radar;const int width=std::clamp(self->FloatingPixels(data,"width",300),1,static_cast<int>(area.right-area.left)),height=std::clamp(self->FloatingPixels(data,"height",200),1,static_cast<int>(area.bottom-area.top));
                                RECT prior{};GetWindowRect(child->hwnd,&prior);MapWindowPoints(HWND_DESKTOP,self->host.parent,reinterpret_cast<POINT*>(&prior),2);
                                const bool preserve=data.value("preservePosition",false);
                                const int x=std::clamp(preserve?prior.left:origin.left+self->FloatingPixels(data,"x",20),area.left,area.right-width),y=std::clamp(preserve?prior.top:origin.top+self->FloatingPixels(data,"y",50),area.top,area.bottom-height);
                                SetWindowPos(child->hwnd,HWND_TOP,x,y,width,height,SWP_NOACTIVATE|SWP_NOCOPYBITS);child->Present(true);
                            }else if(method=="host:floating-size"){
                                RECT client{};GetClientRect(child->hwnd,&client);const auto area=self->host.radar;
                                const int width=std::clamp(self->FloatingPixels(data,"width",300),1,static_cast<int>(area.right-area.left)),height=std::clamp(self->FloatingPixels(data,"height",200),1,static_cast<int>(area.bottom-area.top));
                                if(width!=client.right||height!=client.bottom){RECT bounds{};GetWindowRect(child->hwnd,&bounds);MapWindowPoints(HWND_DESKTOP,self->host.parent,reinterpret_cast<POINT*>(&bounds),2);const int x=std::clamp(bounds.left,area.left,area.right-width),y=std::clamp(bounds.top,area.top,area.bottom-height);SetWindowPos(child->hwnd,HWND_TOP,x,y,width,height,SWP_NOACTIVATE|SWP_NOCOPYBITS);}
                            }else if(method=="host:floating-hide")child->Present(false);
                            else if(method=="host:floating-start"){
                                child->dragging=true;child->dragStart={data.at("x").get<LONG>(),data.at("y").get<LONG>()};if(!self->host.context->test)GetCursorPos(&child->dragStart);GetWindowRect(child->hwnd,&child->dragRect);MapWindowPoints(HWND_DESKTOP,self->host.parent,reinterpret_cast<POINT*>(&child->dragRect),2);
                            }else if(method=="host:floating-move"||method=="host:floating-end"){
                                if(child->dragging){POINT cursor{data.at("x").get<LONG>(),data.at("y").get<LONG>()};if(!self->host.context->test)GetCursorPos(&cursor);const auto area=self->host.radar;const int width=child->dragRect.right-child->dragRect.left,height=child->dragRect.bottom-child->dragRect.top;
                                    const int x=std::clamp(child->dragRect.left+cursor.x-child->dragStart.x,area.left,area.right-width),y=std::clamp(child->dragRect.top+cursor.y-child->dragStart.y,area.top,area.bottom-height);SetWindowPos(child->hwnd,HWND_TOP,x,y,width,height,SWP_NOACTIVATE|SWP_NOCOPYBITS);}
                                if(method=="host:floating-end")child->dragging=false;
                            }else throw RequestError(400,"Unknown submenu operation");
                            self->Reply(id,true);return S_OK;
                        }
                        if(method=="host:test-zoom"&&self->host.context->test){
                            const auto key=data.value("key",std::string());auto target=self;
                            if(!key.empty())for(const auto& candidate:self->host.windows)if(candidate->floating&&candidate->floatingKey==key&&candidate->floatingOwner.lock()==self&&!candidate->destroying)target=candidate;
                            if(data.contains("factor")){const double factor=data.at("factor").get<double>();target->controller->put_ZoomFactor(factor);self->host.ShareZoom(factor);}
                            auto factors=Json::array();for(const auto& window:self->host.windows)if(!window->auth&&!window->destroying&&window->controller){double zoom=1;window->controller->get_ZoomFactor(&zoom);factors.push_back({{"window",window->floating?window->floatingKey:window->supervisor?"supervisor":"aman"},{"factor",zoom}});}
                            self->Reply(id,{{"factors",factors},{"zoom",self->host.uiZoom}});return S_OK;
                        }
                        if(method=="host:test-floating"&&self->host.context->test){
                            const auto key=data.at("key").get<std::string>();for(const auto& candidate:self->host.windows)if(candidate->floating&&candidate->floatingKey==key&&candidate->floatingOwner.lock()==self){
                                if(data.value("probeSizing",false)){
                                    RECT bounds{};GetWindowRect(candidate->hwnd,&bounds);
                                    WINDOWPOS resize{candidate->hwnd,HWND_TOP,0,0,bounds.right-bounds.left+20,bounds.bottom-bounds.top+20,SWP_NOMOVE|SWP_NOACTIVATE};
                                    SendMessageW(candidate->hwnd,WM_WINDOWPOSCHANGING,0,reinterpret_cast<LPARAM>(&resize));
                                    WINDOWPOS move{candidate->hwnd,HWND_TOP,10,10,bounds.right-bounds.left,bounds.bottom-bounds.top,SWP_NOACTIVATE};
                                    SendMessageW(candidate->hwnd,WM_WINDOWPOSCHANGING,0,reinterpret_cast<LPARAM>(&move));
                                    candidate->havePreviousBounds=false;
                                    self->Reply(id,{{"resizeRedrawAllowed",(resize.flags&SWP_NOREDRAW)==0},{"resizeDiscardsOldPixels",(resize.flags&SWP_NOCOPYBITS)!=0},{"moveDefersRedraw",(move.flags&SWP_NOREDRAW)!=0},{"moveDiscardsOldPixels",(move.flags&SWP_NOCOPYBITS)!=0}});return S_OK;
                                }
                                if(data.value("capture",false)){ComPtr<IStream> stream;const auto file=self->host.context->directory/Wide("floating-"+key+".png");if(SUCCEEDED(SHCreateStreamOnFileEx(file.c_str(),STGM_CREATE|STGM_WRITE,FILE_ATTRIBUTE_NORMAL,TRUE,nullptr,&stream))){candidate->browser->CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,stream.Get(),Callback<ICoreWebView2CapturePreviewCompletedHandler>([stream,weak,id](HRESULT error)->HRESULT{if(auto owner=weak.lock())owner->Reply(id,SUCCEEDED(error));return S_OK;}).Get());return S_OK;}}
                                if(data.value("close",false))SendMessageW(candidate->hwnd,WM_CLOSE,0,0);
                                double zoom=1;candidate->controller->get_ZoomFactor(&zoom);RECT r{};GetWindowRect(candidate->hwnd,&r);MapWindowPoints(HWND_DESKTOP,self->host.parent,reinterpret_cast<POINT*>(&r),2);self->Reply(id,{{"zoom",zoom},{"x",r.left},{"y",r.top},{"width",r.right-r.left},{"height",r.bottom-r.top},{"visible",candidate->floatingVisible},{"parentIsRadar",GetParent(candidate->hwnd)==self->host.parent},{"dragging",candidate->dragging}});return S_OK;
                            }throw RequestError(400,"No submenu window");
                        }
                        if(self->floating)throw RequestError(403,"Submenus use their owning AMAN session");
                        if(method=="host:coordination"){
                            if(self->auth||self->supervisor)throw RequestError(403,"Coordination belongs to the AMAN worker");
                            if(!self->host.coordination)self->host.coordination=std::make_unique<CoordinationPopup>(self->host.module,self->host.context->test);
                            std::weak_ptr<Window> owner=self;
                            self->host.coordination->SetZoom(self->host.uiZoom);self->host.coordination->Update(GetAncestor(self->host.parent,GA_ROOT),data,[owner](const std::string& messageId){
                                if(auto window=owner.lock())if(window->browser&&!window->destroying){const auto event=Wide(Json({{"event","coordination-ack"},{"messageId",messageId}}).dump());window->browser->PostWebMessageAsJson(event.c_str());}
                            });self->Reply(id,true);return S_OK;
                        }
                        if(method=="host:test-coordination"&&self->host.context->test){
                            if(!self->host.coordination)throw RequestError(400,"No coordination popup");
                            if(data.contains("hostUiAllowed"))self->host.coordination->AllowHostUi(data.at("hostUiAllowed").get<bool>());
                            if(data.value("capture",false))self->host.coordination->Capture(self->host.context->directory/L"coordination-preview.bmp");
                            self->Reply(id,self->host.coordination->Inspect(data.value("click",false)));return S_OK;
                        }
                        if(!self->auth&&method=="host:frame-close"){self->host.visible[self->supervisor?1:0].store(false);self->Present(false);self->Reply(id,true);return S_OK;}
                        if(!self->auth&&method=="host:frame-start"){
                            self->dragging=!data.value("resize",false);self->resizing=!self->dragging;
                            self->dragStart={data.at("x").get<LONG>(),data.at("y").get<LONG>()};if(!self->host.context->test)GetCursorPos(&self->dragStart);GetWindowRect(self->hwnd,&self->dragRect);MapWindowPoints(HWND_DESKTOP,GetParent(self->hwnd),reinterpret_cast<POINT*>(&self->dragRect),2);self->Reply(id,true);return S_OK;
                        }
                        if(!self->auth&&(method=="host:frame-move"||method=="host:frame-end")){
                            if(self->dragging||self->resizing){
                                POINT cursor{data.at("x").get<LONG>(),data.at("y").get<LONG>()};if(!self->host.context->test)GetCursorPos(&cursor);
                                const int dx=cursor.x-self->dragStart.x,dy=cursor.y-self->dragStart.y;const auto area=self->host.radar;
                                int width=self->dragRect.right-self->dragRect.left,height=self->dragRect.bottom-self->dragRect.top,x=self->dragRect.left,y=self->dragRect.top;
                                if(self->resizing){width=std::max(360,std::min(width+dx,static_cast<int>(area.right-x)));height=std::max(380,std::min(height+dy,static_cast<int>(area.bottom-y)));}
                                else{x=std::max(static_cast<int>(area.left),std::min(x+dx,static_cast<int>(area.right)-width));y=std::max(static_cast<int>(area.top),std::min(y+dy,static_cast<int>(area.bottom)-height));}
                                SetWindowPos(self->hwnd,HWND_TOP,x,y,width,height,SWP_NOACTIVATE|SWP_NOCOPYBITS);
                            }
                            if(method=="host:frame-end"){self->dragging=false;self->resizing=false;}
                            self->Reply(id,true);return S_OK;
                        }
                        if(method=="host:ready"){self->Present(self->host.visible[self->supervisor?1:0].load());self->Reply(id,true);if(self->host.context->test){BOOL shown=FALSE;self->controller->get_IsVisible(&shown);std::ofstream(self->host.context->directory/(self->supervisor?L"supervisor-first-open.txt":L"aman-first-open.txt"))<<shown;if(self->supervisor)self->TestSupervisor();}self->Smoke();return S_OK;}
                        if(method=="host:test-supervisor"&&self->host.context->test){std::ofstream(self->host.context->directory/L"supervisor-frame.json")<<data.dump();self->Reply(id,true);return S_OK;}
                        if(method=="host:test-runways"&&self->host.context->test){std::lock_guard lock(self->host.context->mutex);self->host.context->telemetry["activeRunways"]={{"arrivals",Json::array({"ESSA/01R"})},{"departures",Json::array({"ESSA/01L"})}};self->host.context->telemetry["timestamp"]=Now();self->Reply(id,true);return S_OK;}
                        if(method=="host:test-operations"&&self->host.context->test){std::ofstream(self->host.context->directory/L"operations-ui.json")<<data.dump(2);self->Reply(id,true);return S_OK;}
                        if(method=="host:test-frame"&&self->host.context->test){
                            if(data.contains("width")){RECT prior{};GetWindowRect(self->hwnd,&prior);MapWindowPoints(HWND_DESKTOP,self->host.parent,reinterpret_cast<POINT*>(&prior),2);SetWindowPos(self->hwnd,HWND_TOP,prior.left,prior.top,data.at("width").get<int>(),data.value("height",static_cast<int>(prior.bottom-prior.top)),SWP_NOACTIVATE|SWP_NOCOPYBITS);}

                            const auto capture=data.value("capture",std::string());
                            if(capture=="insert"||capture=="swap"||capture=="compact"){
                                ComPtr<IStream> stream;const auto file=self->host.context->directory/Wide("placement-"+capture+".png");
                                if(FAILED(SHCreateStreamOnFileEx(file.c_str(),STGM_CREATE|STGM_WRITE,FILE_ATTRIBUTE_NORMAL,TRUE,nullptr,&stream)))throw RequestError(500,"Could not create preview capture");
                                const auto started=self->browser->CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,stream.Get(),Callback<ICoreWebView2CapturePreviewCompletedHandler>([stream,weak,id](HRESULT error)->HRESULT{if(auto owner=weak.lock())owner->Reply(id,SUCCEEDED(error));return S_OK;}).Get());
                                if(FAILED(started))throw RequestError(500,"Could not capture preview");return S_OK;
                            }
                            RECT rectangle{},bounds{};GetWindowRect(self->hwnd,&rectangle);MapWindowPoints(HWND_DESKTOP,GetParent(self->hwnd),reinterpret_cast<POINT*>(&rectangle),2);self->controller->get_Bounds(&bounds);self->Reply(id,{{"x",rectangle.left},{"y",rectangle.top},{"width",rectangle.right-rectangle.left},{"height",rectangle.bottom-rectangle.top},{"browserLeft",bounds.left},{"browserTop",bounds.top},{"dragging",self->dragging},{"resizing",self->resizing},{"visible",self->host.visible[self->supervisor?1:0].load()}});return S_OK;}
                        const auto result=self->host.context->Request(method,data,self->supervisor);self->Reply(id,result);
                        if(method=="mode:set"&&result.value("changed",true)){if(self->host.coordination)self->host.coordination->Hide();for(const auto& other:self->host.windows)if(other.get()!=self.get()&&!other->auth&&other->browser)other->browser->Reload();}
                    }catch(const RequestError& error){self->Reply(id,Json(),false,error.status,error.what());}catch(const std::exception& error){self->Reply(id,Json(),false,400,error.what());}return S_OK;
                }).Get(),&token);
            }
            browser->add_NavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>([weak](ICoreWebView2*,ICoreWebView2NavigationStartingEventArgs* args)->HRESULT{
                auto self=weak.lock();if(!self)return S_OK;LPWSTR raw=nullptr;args->get_Uri(&raw);const std::wstring uri=raw?raw:L"";CoTaskMemFree(raw);
                if(!self->auth){self->zoomReady=false;if(!Trusted(uri)&&uri!=L"about:blank")args->put_Cancel(TRUE);else if(!self->floating)for(const auto& child:self->host.windows)if(child->floating&&child->floatingOwner.lock()==self&&child->hwnd)DestroyWindow(child->hwnd);return S_OK;}
                const std::string url=Narrow(uri.c_str());
                if(url.rfind(self->redirect+"?",0)==0){args->put_Cancel(TRUE);const auto received=Parameter(url,"state"),code=Parameter(url,"code");
                    if(auto owner=self->authOwner.lock()){if(received==self->state&&!code.empty())owner->Reply(self->authRequest,{{"code",code},{"state",received}});else owner->Reply(self->authRequest,Json(),false,401,"VATSIM sign-in failed or state did not match");}
                    self->completed=true;PostMessageW(self->hwnd,CloseAuth,0,0);return S_OK;}
                if(uri.rfind(L"https://auth.vatsim.net/",0)!=0&&uri.rfind(L"https://auth-dev.vatsim.net/",0)!=0&&uri!=L"about:blank")args->put_Cancel(TRUE);return S_OK;
            }).Get(),&token);
            browser->add_NewWindowRequested(Callback<ICoreWebView2NewWindowRequestedEventHandler>([weak](ICoreWebView2*,ICoreWebView2NewWindowRequestedEventArgs* args)->HRESULT{
                auto self=weak.lock();if(!self)return S_OK;args->put_Handled(TRUE);
                LPWSTR raw=nullptr;args->get_Uri(&raw);const std::string uri=Narrow(raw);CoTaskMemFree(raw);
                if(self->auth||self->floating||self->supervisor||uri.rfind("https://saaman.local/floating.html?key=",0)!=0)return S_OK;
                const auto key=Parameter(uri,"key");if(key!="dialog"&&key!="menu"&&key!="global")return S_OK;
                auto child=std::make_shared<Window>(self->host,false);child->floating=true;child->floatingKey=key;child->floatingOwner=self;child->environment=self->environment;child->openArgs=args;args->GetDeferral(&child->openDeferral);self->host.windows.push_back(child);child->Create(false);return S_OK;
            }).Get(),&token);
            browser->add_NavigationCompleted(Callback<ICoreWebView2NavigationCompletedEventHandler>([weak](ICoreWebView2*,ICoreWebView2NavigationCompletedEventArgs*)->HRESULT{
                if(auto self=weak.lock())if(!self->auth){if(!self->host.zoomInitialized){double zoom=1;self->controller->get_ZoomFactor(&zoom);self->host.ShareZoom(zoom);}else self->ApplyZoom(self->host.uiZoom);self->zoomReady=true;if(!self->floating)self->Present(self->host.visible[self->supervisor?1:0].load());}return S_OK;
            }).Get(),&token);
            browser->add_WindowCloseRequested(Callback<ICoreWebView2WindowCloseRequestedEventHandler>([weak](ICoreWebView2*,IUnknown*)->HRESULT{if(auto self=weak.lock())PostMessageW(self->hwnd,WM_CLOSE,0,0);return S_OK;}).Get(),&token);
            if(!floating)browser->Navigate(auth?Wide(authUrl).c_str():supervisor?L"https://saaman.local/index.html?view=supervisor":L"https://saaman.local/index.html?view=aman");
        }
        void OpenAuth(int request,const Json& data){
            const auto url=data.at("url").get<std::string>(),callback=data.at("redirect").get<std::string>(),nonce=data.at("state").get<std::string>();
            if((url.rfind("https://auth.vatsim.net/oauth/authorize?",0)!=0&&url.rfind("https://auth-dev.vatsim.net/oauth/authorize?",0)!=0)||
                (callback!="https://vatiris.se/"&&callback!="https://vatiris.se/login"&&callback!="http://localhost:5173/login")||nonce.size()<16||nonce.size()>128||Parameter(url,"state")!=nonce||Parameter(url,"redirect_uri")!=callback)throw RequestError(400,"Untrusted sign-in request");
            auto window=std::make_shared<Window>(host,false);window->auth=true;window->authOwner=shared_from_this();window->authRequest=request;window->authUrl=url;window->redirect=callback;window->state=nonce;host.windows.push_back(window);window->Create();
        }
        void TestSupervisor(){
            browser->ExecuteScript(LR"JS((async()=>{
                const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let id=960000;
                const rpc=(method,data={})=>new Promise(resolve=>{const serial=++id;const listener=e=>{if(e.data.id===serial){window.chrome.webview.removeEventListener('message',listener);resolve(e.data.result)}};window.chrome.webview.addEventListener('message',listener);window.chrome.webview.postMessage({id:serial,method,data})});
                const result={ok:false};try{
                    await wait(150);const title=document.querySelector('.frame-title'),rect=title.getBoundingClientRect();
                    result.uncovered=document.elementFromPoint(rect.left+20,rect.top+5)?.closest('.frame-title')===title;
                    if(!result.uncovered)throw Error('Supervisor content covers the frame');const before=await rpc('host:test-frame');
                    title.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:95,screenX:100,screenY:100}));window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:95,screenX:80,screenY:120}));window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:95,screenX:80,screenY:120}));await wait(80);const after=await rpc('host:test-frame');
                    result.moved=after.x===before.x-20&&after.y===before.y+20;if(!result.moved)throw Error('Supervisor frame did not move');
                    document.querySelector('.frame-close').click();await wait(80);result.closed=!(await rpc('host:test-frame')).visible;if(!result.closed)throw Error('Supervisor close button did not hide the pane');result.ok=true;
                }catch(error){result.error=String(error)}await rpc('host:test-supervisor',result);
            })())JS",nullptr);
        }
        void Smoke(){
            if(!host.context->test||smokeStarted||supervisor)return;smokeStarted=true;
            std::weak_ptr<Window> weak=shared_from_this();
            browser->ExecuteScript(LR"JS((async()=>{
                const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));const result={ok:false};
const docs=()=>[document,...(window.__SAAMAN_FLOATING_DOCUMENTS__?.values()??[])];
                    const find=(selector)=>docs().map(d=>d.querySelector(selector)).find(Boolean);
                    const findAll=(selector)=>docs().flatMap(d=>[...d.querySelectorAll(selector)]);
                    let rpcId=980000;
                    const rpc=(method,data={})=>new Promise((resolve,reject)=>{const id=++rpcId;const listener=event=>{if(event.data.id===id){window.chrome.webview.removeEventListener('message',listener);event.data.ok?resolve(event.data.result):reject(Error(event.data.error))}};window.chrome.webview.addEventListener('message',listener);window.chrome.webview.postMessage({id,method,data})});
                    const floatingReady=async(key,selector)=>{for(let attempt=0;attempt<200;attempt++){if(window.__SAAMAN_FLOATING_DOCUMENTS__?.get(key)?.querySelector(selector)){await wait(100);return}await wait(50)}throw Error('Floating surface not ready: '+key)};
                                    try{
                    await wait(200);
                    const frameTitle=find('.frame-title');result.embeddedBorder=frameTitle?.innerText==='AMAN'&&frameTitle.getBoundingClientRect().height>=17&&find('.frame-resize')!==null;if(!result.embeddedBorder)throw Error('Embedded TopSky frame missing');
                    const inspectFrame=()=>new Promise(resolve=>{const listener=event=>{if(event.data.id===999998){window.chrome.webview.removeEventListener('message',listener);resolve(event.data.result)}};window.chrome.webview.addEventListener('message',listener);window.chrome.webview.postMessage({id:999998,method:'host:test-frame',data:{}})});const frameBefore=await inspectFrame();

                    frameTitle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:91,screenX:100,screenY:100}));window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:91,screenX:130,screenY:120}));window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:91,screenX:130,screenY:120}));await wait(80);
                    const grip=find('.frame-resize');grip.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:92,screenX:800,screenY:800}));window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:92,screenX:820,screenY:820}));window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:92,screenX:820,screenY:820}));await wait(80);const frameAfter=await inspectFrame();result.frameInput=frameAfter.x===frameBefore.x+30&&frameAfter.y===frameBefore.y+20&&frameAfter.width===frameBefore.width+20&&frameAfter.height===frameBefore.height+20&&!frameAfter.dragging&&!frameAfter.resizing&&frameAfter.browserLeft===0&&frameAfter.browserTop===0;if(!result.frameInput)throw Error('Native move/resize or browser bounds did not follow the embedded frame');
                    const overview=find('.time-overview');for(let step=0;step<8;step++)overview.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));await wait(60);
                    const ticks=[...findAll('.timeline-column .tick')],area=find('.time-area');result.minuteSpacingCallsign=Math.abs(Math.abs(parseFloat(ticks[1].style.top)-parseFloat(ticks[0].style.top))-23)<0.1;if(!result.minuteSpacingCallsign)throw Error('Minute spacing must be 23 pixels, approximately one callsign row');result.noDiagonalConnectors=!find('.time-anchors line');if(!result.noDiagonalConnectors)throw Error('Diagonal label connectors must be absent');
                    const controllerData=await new Promise(resolve=>{const listener=event=>{if(event.data.id===999997){window.chrome.webview.removeEventListener('message',listener);resolve(event.data.result)}};window.chrome.webview.addEventListener('message',listener);window.chrome.webview.postMessage({id:999997,method:'telemetry:get',data:{}})});
                    const views=[...findAll('.view-buttons button')].map(b=>b.innerText);
                    result.controllerViews=views.includes('Runway')&&views.includes('FLOW')&&(controllerData.source==='ESSA_W_APP'?views.includes('ARR-W')&&!views.includes('ACC'):controllerData.source==='ESSA_E_APP'?!views.includes('ACC')&&!views.includes('ARR-W'):views.includes('ACC'));
                    if(!result.controllerViews)throw Error('Controller-specific feeder button or unfiltered Runway/FLOW views incorrect');
                    if(typeof CompressionStream!=='undefined'&&typeof DecompressionStream!=='undefined'){
                        const raw=JSON.stringify({checkpoint:'native-codec-check '.repeat(2000)});
                        const encoded=await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
                        const decoded=await new Response(new Blob([encoded]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
                        result.publicationCompression=decoded===raw&&encoded.byteLength<raw.length/5;if(!result.publicationCompression)throw Error('Native browser publication compression failed');
                    }else result.publicationCompression='uncompressed-fallback';
                    const flight=find('.flight[data-callsign]');if(!flight)throw Error('No mock arrival');
                    const boundaryGap=find('[data-gap="layout-boundary"]');if(boundaryGap){
                        const box=boundaryGap.getBoundingClientRect(),label=flight.getBoundingClientRect(),caption=boundaryGap.querySelector('.gap-handle.end span').getBoundingClientRect();
                        result.boundaryLabelAboveGap=label.bottom<=box.top-2&&caption.top>=box.top;
                        if(!result.boundaryLabelAboveGap)throw Error('Boundary aircraft label must be above the box; END caption must be inside');
                    }
                    let dragged=flight;
                    if(!boundaryGap){
                    const dragRect=flight.getBoundingClientRect(),dragX=dragRect.left+10,dragY=dragRect.top+5;
                    flight.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:81,clientX:dragX,clientY:dragY}));
                    window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,buttons:1,pointerId:81,clientX:dragX,clientY:dragY+45}));
                    window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerId:81,clientX:dragX,clientY:dragY+45}));await wait(350);
                    dragged=find('.flight[data-callsign]');result.reactiveDrag=!!dragged&&dragged.dataset.state!=='UNSTABLE';if(!result.reactiveDrag)throw Error('Reactive aircraft drag was not accepted');
                    }else result.reactiveDrag='separate-default-fixture';
                    // Captured drags must stop at the visible plot in both directions.
                    const strip=find('.timeline-strip'),plot=find('.time-area').getBoundingClientRect(),viewport=find('.horizontal-scroll').getBoundingClientRect();
                    const boxX=Math.min(viewport.right-10,Math.max(viewport.left+10,plot.left+plot.width/2+35)),boxY=(plot.top+plot.bottom)/2;
                    result.selectionBounds=true;
                    for(const direction of [-1,1]){
                        strip.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:89,clientX:boxX,clientY:boxY}));
                        window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,buttons:1,pointerId:89,clientX:direction<0?viewport.left-500:viewport.right+500,clientY:direction<0?plot.top-500:plot.bottom+500}));await wait(20);
                        const box=find('.recompute-box')?.getBoundingClientRect();
                        result.selectionBounds&&=!!box&&box.left>=viewport.left-1&&box.right<=viewport.right+1&&box.top>=plot.top-1&&box.bottom<=plot.bottom+1;
                        window.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:89}));await wait(20);
                    }
                    if(!result.selectionBounds)throw Error('Selection box escaped the visible timeline');
                    const checkTitleClose=title=>{const a=title.getBoundingClientRect(),b=title.querySelector('button').getBoundingClientRect();return b.top>=a.top&&b.bottom<=a.bottom&&Math.abs((a.top+a.bottom-b.top-b.bottom)/2)<=1;};
                    const rect=dragged.getBoundingClientRect();dragged.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2,clientX:rect.left+5,clientY:rect.top+5}));await wait(0);find('.flight-menu .menu-title button')?.click();await wait(20);dragged.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2,clientX:rect.left+5,clientY:rect.top+5}));await wait(80);result.rapidSubmenuReopen=true;
                    await floatingReady('menu','.flight-menu');const popup=find('.flight-menu');if(!popup)throw Error('Right-click menu missing');
                    result.menuCloseAligned=checkTitleClose(popup.querySelector('.menu-title'));if(!result.menuCloseAligned)throw Error('Menu close button is outside title bar');
                    const menuWindow=popup.ownerDocument.defaultView;popup.querySelector('.menu-title').dispatchEvent(new menuWindow.PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:83,screenX:100,screenY:100}));menuWindow.dispatchEvent(new menuWindow.PointerEvent('pointermove',{bubbles:true,pointerId:83,screenX:-900,screenY:100}));menuWindow.dispatchEvent(new menuWindow.PointerEvent('pointerup',{bubbles:true,pointerId:83,screenX:-900,screenY:100}));await wait(80);const menuFrame=await rpc('host:test-floating',{key:'menu'});result.draggableMenu=menuFrame.parentIsRadar&&menuFrame.x===0&&!menuFrame.dragging;if(!result.draggableMenu)throw Error('Callsign menu cannot move outside AMAN');
                    const text=popup.innerText;for(const action of ['Refresh delay','Change ETA-FF','Maximum delay','Insert arrival','Insert closure','Insert gap'])if(!text.includes(action))throw Error('Missing action '+action);
                    result.removedMenus=!popup.querySelector('[data-menu=slot]')&&!text.includes('Extra flight');if(!result.removedMenus)throw Error('Removed callsign actions still present');
                    popup.querySelector('[data-menu=information]').click();await wait(80);
                    await floatingReady('dialog','[data-dialog=information]');
                    const info=find('[data-dialog=information]'),beforeDialog=await rpc('host:test-floating',{key:'dialog'});result.pointerDialog=beforeDialog.parentIsRadar&&beforeDialog.visible;if(!result.pointerDialog)throw Error('Information is not a separate radar-owned window');
                    result.floatingPaintPolicy=await rpc('host:test-floating',{key:'dialog',probeSizing:true});
                    if(!Object.values(result.floatingPaintPolicy).every(Boolean))throw Error('Submenu resize suppresses its first paint or move copies old pixels');
                    const title=info.querySelector('.dialog-title'),popWindow=info.ownerDocument.defaultView;
                    const boxOf=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scrollTop:e.scrollTop,scrollLeft:e.scrollLeft,scrollHeight:e.scrollHeight,display:e.ownerDocument.defaultView.getComputedStyle(e).display}};
                    result.informationLayout={viewport:[popWindow.innerWidth,popWindow.innerHeight],root:boxOf(info.ownerDocument.getElementById('floating-root')),panel:boxOf(info),title:boxOf(title),table:boxOf(info.querySelector('table')),body:boxOf(info.ownerDocument.body)};
                    result.dialogCloseAligned=checkTitleClose(title);if(!result.dialogCloseAligned)throw Error('Information close button is outside title bar');
                    const topOfTitle=title.getBoundingClientRect();if(topOfTitle.top<0||topOfTitle.bottom>popWindow.innerHeight||topOfTitle.width<100)throw Error('Information title is clipped');

                    title.dispatchEvent(new popWindow.PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:82,screenX:200,screenY:200}));popWindow.dispatchEvent(new popWindow.PointerEvent('pointermove',{bubbles:true,pointerId:82,screenX:-800,screenY:200}));popWindow.dispatchEvent(new popWindow.PointerEvent('pointerup',{bubbles:true,pointerId:82,screenX:-800,screenY:200}));await wait(100);
                    const afterDialog=await rpc('host:test-floating',{key:'dialog'});result.draggableDialog=afterDialog.x===0&&afterDialog.x<frameAfter.x&&!afterDialog.dragging;if(!result.draggableDialog)throw Error('Information cannot move outside AMAN');
                    result.shortRunwayHeader=[...info.querySelectorAll('th')].some(h=>/^(01[LR]|19[LR]|08|26)$/.test(h.innerText))&&![...info.querySelectorAll('th')].some(h=>/^Runway /.test(h.innerText));if(!result.shortRunwayHeader)throw Error('Information runway header was not shortened');
                    await rpc('host:test-floating',{key:'dialog',capture:true});
                    result.informationRows=findAll('.information-table tr').length;if(result.informationRows!==3)throw Error('Information layout must have three rows');
                    find('.dialog-title button').click();await wait(40);
                    flight.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2,clientX:rect.left+5,clientY:rect.top+5}));await wait(40);
                    [...findAll('.flight-menu button')].find(b=>b.innerText.includes('Maximum delay')).click();await floatingReady('dialog','[data-dialog=maximum-delay]');
                    result.maximumDelayChoices=findAll('[data-dialog=maximum-delay] .submenu-choice').length;if(result.maximumDelayChoices!==6||find('[data-dialog=maximum-delay] select'))throw Error('Maximum delay must be direct choices');find('.dialog-title button').click();await wait(40);
                    flight.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2,clientX:rect.left+5,clientY:rect.top+5}));await wait(40);[...findAll('.flight-menu button')].find(b=>b.innerText.includes('Insert gap')).click();await floatingReady('dialog','[data-dialog=relative-side]');
                    result.beforeAfterChoices=findAll('[data-dialog=relative-side] .submenu-choice').length;if(result.beforeAfterChoices!==2)throw Error('Before/after submenu missing');find('.dialog-title button').click();await wait(40);
                    find('.time-area').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2,clientX:rect.left+5,clientY:rect.top+5}));await wait(40);find('[data-menu=add-flight]').click();await floatingReady('dialog','[data-dialog=insert]');
                    result.manualLists=findAll('.manual-flight-lists [role=listbox]').length;if(result.manualLists!==2)throw Error('Overshoot/Planned lists missing');
                    if(!boundaryGap){
                        const enter=(element,value)=>{element.value=value;element.dispatchEvent(new element.ownerDocument.defaultView.Event('input',{bubbles:true}))};
                        enter(find('[data-input=manual-callsign]'),'RESERVE_TEST');
                        enter(find('[data-dialog=insert] input[type=time]'),new Date(Date.now()+18*60000).toISOString().slice(11,16));
                        find('[data-action=insert-flight]').click();await wait(250);
                        const planFlight=async name=>(await rpc('plan:get')).snapshot.flights.find(f=>f.callsign===name);
                        let manual=find('.flight[data-callsign=RESERVE_TEST]');if(!manual)throw Error('Manual reservation missing');
                        const originalManual=await planFlight('RESERVE_TEST'),manualRect=manual.getBoundingClientRect(),x=manualRect.left+15,y=manualRect.top+manualRect.height/2;
                        manual.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:85,clientX:x,clientY:y}));
                        window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,buttons:1,pointerId:85,clientX:x,clientY:y-46}));await wait(40);
                        const arrow=find('[data-placement=insert]');result.insertionArrow=arrow?.dataset.source==='RESERVE_TEST';if(!result.insertionArrow)throw Error('Insertion arrow missing');
                        await rpc('host:test-frame',{capture:'insert'});
                        window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerId:85,clientX:x,clientY:y-46}));await wait(250);
                        const laterManual=await planFlight('RESERVE_TEST');result.manualLaterDrag=laterManual.sta===originalManual.sta+120000;if(!result.manualLaterDrag)throw Error('Manual flight snapped back instead of accepting a later time');
                        await wait(250);if((await planFlight('RESERVE_TEST')).sta!==laterManual.sta)throw Error('Manual flight time did not persist');
                        manual=find('.flight[data-callsign=RESERVE_TEST]');manual.click();await wait(30);
                        result.selectionHighlight=manual.classList.contains('selected')&&manual.getAttribute('aria-pressed')==='true'&&getComputedStyle(manual).borderTopColor==='rgb(240, 248, 255)'&&getComputedStyle(manual).backgroundColor!=='rgba(0, 0, 0, 0)';if(!result.selectionHighlight)throw Error('Selected aircraft highlight missing');
                        const area=manual.closest('.time-area'),m=manual.getBoundingClientRect(),clickX=area.getBoundingClientRect().left+area.getBoundingClientRect().width/2-30,clickY=m.top+m.height/2+23;
                        window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:clickX,clientY:clickY}));await wait(30);
                        const clickPreview=find('[data-placement=insert]');if(!clickPreview)throw Error('Selected aircraft hover arrow missing');const previewTime=Number(clickPreview.dataset.time);
                        area.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:clickX,clientY:clickY}));await wait(250);
                        const inserted=await planFlight('RESERVE_TEST');result.insertionTimes={preview:previewTime,inserted:inserted.sta,previous:laterManual.sta};/* The live clock can tick between hover and click. */result.selectionInsertion=Math.abs(inserted.sta-previewTime)<3000&&Math.abs(inserted.sta-(laterManual.sta-60000))<5000;if(!result.selectionInsertion)throw Error('Selected aircraft insertion click did not set the proposed time');
                        manual=find('.flight[data-callsign=RESERVE_TEST]');manual.click();await wait(30);
                        const live=find('.flight[data-callsign=SAAMAN_TEST]'),liveRect=live.getBoundingClientRect(),liveBefore=await planFlight('SAAMAN_TEST');
                        window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:liveRect.left+15,clientY:liveRect.top+liveRect.height/2}));await wait(30);
                        const swap=find('[data-placement=swap]');result.swapPreview=swap?.dataset.target==='SAAMAN_TEST'&&live.classList.contains('swap-target')&&getComputedStyle(live).borderTopColor==='rgb(255, 229, 122)';if(!result.swapPreview)throw Error('Swap icon or destination highlight missing');
                        await rpc('host:test-frame',{capture:'swap'});live.click();await wait(250);
                        const swappedManual=await planFlight('RESERVE_TEST'),swappedLive=await planFlight('SAAMAN_TEST');result.selectionSwap=swappedManual.sta===liveBefore.sta&&swappedLive.sta===inserted.sta;if(!result.selectionSwap)throw Error('Clicking the swap destination did not exchange the two slots');
                        const dragManual=find('.flight[data-callsign=RESERVE_TEST]'),dragTarget=find('.flight[data-callsign=SAAMAN_TEST]'),from=dragManual.getBoundingClientRect(),to=dragTarget.getBoundingClientRect();
                        dragManual.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:86,clientX:from.left+15,clientY:from.top+from.height/2}));
                        window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,buttons:1,pointerId:86,clientX:to.left+15,clientY:to.top+to.height/2}));await wait(30);
                        if(!find('[data-placement=swap]'))throw Error('Drag swap preview missing');
                        window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerId:86,clientX:to.left+15,clientY:to.top+to.height/2}));await wait(250);
                        result.dragSwap=(await planFlight('RESERVE_TEST')).sta===inserted.sta&&(await planFlight('SAAMAN_TEST')).sta===liveBefore.sta;if(!result.dragSwap)throw Error('Dropping onto another callsign did not swap slots');
                        window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
                        if(find('[data-placement]'))throw Error('Escape did not clear the placement indicator');
                    }else{find('.dialog-title button').click();await wait(40)}
                    find('[data-action=coordinations]').click();await floatingReady('menu','.coordination-menu');
                    result.coordinationChoices=findAll('.coordination-menu>button').length;if(result.coordinationChoices!==10)throw Error('Coordination menu mismatch');
                    find('[data-action=coordinations]').click();
                    // The coordination popup is owned by the radar frame,
                    // not constrained by the AMAN child pane or a second relay.
                    const notification={id:'popup-test',message:'Speed 230 kts for all arrivals to ESSA',sender:'other-instance',senderCallsign:'ESOS_1__CTR',at:Date.UTC(2026,9,13,12,34,56),acknowledgedBy:['other-instance']};
                    const receivedAcks=[],onAck=event=>receivedAcks.push(event.detail.id);window.addEventListener('saaman-coordination-ack',onAck);
                    await rpc('host:coordination',{message:notification,enabled:true,busy:false});
                    const separate=await rpc('host:test-coordination',{capture:true});
                    result.coordinationExternal=separate.topLevel&&separate.owned&&Math.abs(separate.x+separate.width/2-(separate.ownerX+separate.ownerWidth/2))<=1&&Math.abs(separate.y+separate.height/2-(separate.ownerY+separate.ownerHeight/2))<=1;
                    result.coordinationMetadata=separate.sender==='ESOS_1__CTR'&&separate.sent.includes('12:34:56 UTC')&&separate.message.at===notification.at;
                    if(!result.coordinationExternal||!result.coordinationMetadata)throw Error('Coordination popup position or sender/time incorrect');
                    result.coordinationLayout=separate.status===''&&Math.abs(separate.buttonCenterX-separate.clientCenterX)<=1;
                    result.coordinationTopSky=!separate.systemCaption&&separate.titleDraggable&&separate.width<=400*separate.dpi/96+1&&separate.height<=200*separate.dpi/96+1&&separate.buttonBottom<separate.height;if(!result.coordinationTopSky)throw Error('Coordination must have a compact draggable TopSky frame without a system caption');
                    if(!result.coordinationLayout)throw Error('Coordination button must be centered without receipt instructions');
                    const occludedCoordination=await rpc('host:test-coordination',{hostUiAllowed:false});if(occludedCoordination.message.id!==notification.id||!occludedCoordination.enabled)throw Error('Yielding to EuroScope discarded coordination');await rpc('host:test-coordination',{hostUiAllowed:true});result.coordinationHostYield=true;
                    await rpc('host:test-coordination',{click:true});await wait(50);await rpc('host:test-coordination',{click:true});await wait(50);
                    const awaiting=await rpc('host:test-coordination');result.coordinationAck=receivedAcks.length===1&&receivedAcks[0]===notification.id&&!awaiting.enabled&&awaiting.busy;
                    if(!result.coordinationAck)throw Error('Coordination acknowledgement did not forward exactly once');
                    await rpc('host:coordination',{message:notification,enabled:true,busy:false,status:'Connection interrupted; retry acknowledgement.'});
                    if(!(await rpc('host:test-coordination')).enabled)throw Error('Failed acknowledgement cannot be retried');
                    await rpc('host:coordination',{message:{...notification,id:'legacy-popup',senderCallsign:undefined},enabled:false,busy:false});
                    const legacy=await rpc('host:test-coordination');result.coordinationLegacy=legacy.sender.includes('older version')&&!legacy.enabled;
                    if(!result.coordinationLegacy)throw Error('Legacy sender must be unavailable, not the internal instance ID');
                    await rpc('host:coordination',{message:null});window.removeEventListener('saaman-coordination-ack',onAck);
                    if((await rpc('host:test-coordination')).message!==null)throw Error('Acknowledged coordination popup was not cleared');
                    find('[data-action=rates]').click();await wait(60);
                    const rateSlider=find('[data-input=arrival-rate-slider]');result.rateBounds=rateSlider?.min==='60'&&rateSlider?.max==='600';if(!result.rateBounds)throw Error('Arrival rate must allow only 6–60 per hour');
                    const slider=find('[data-input=apply-time-slider]');slider.value='10';slider.dispatchEvent(new Event('input',{bubbles:true}));await wait(80);
                    const line=find('.change-time-marker.preview');if(!line||getComputedStyle(line).borderTopStyle!=='solid')throw Error('Draft time marker must be solid');
                    result.solidTimeMarker=true;find('.dialog-title button').click();
                    await rpc('host:test-runways');find('[data-action=configuration]').click();await floatingReady('dialog','[data-dialog=configuration]');
                    result.configurationCloseAligned=checkTitleClose(find('[data-dialog=configuration] .dialog-title'));if(!result.configurationCloseAligned)throw Error('Configuration close button is outside title bar');await rpc('host:test-floating',{key:'dialog',capture:true});
                    const sync=find('[data-action=sync-euroscope]');if(!sync||sync.disabled)throw Error('Sync EuroScope unavailable for the local sequencer');sync.click();await wait(500);
                    result.runwaySync=/01R\s*\/\s*01L/.test(find('[data-action=configuration]').innerText);if(!result.runwaySync)throw Error('Sync EuroScope did not apply ARR/DEP selections');
                    // Saving an unchanged connection must not leave/reload the current pane.
                    [...findAll('.view-buttons button')].find(b=>b.innerText.includes('MAESTRO')).click();await wait(40);
                    await floatingReady('global','.global-menu');
                    [...findAll('.global-menu button')].find(b=>b.innerText.includes('Operation mode')).click();await wait(40);
                    await floatingReady('dialog','[data-dialog=setup]');
                    window.__saamanSaveCheck='same-document';
                    [...findAll('[data-dialog=setup] button')].find(b=>b.innerText==='Save connection').click();await wait(300);
                    result.saveConnectionKeepsPane=window.__saamanSaveCheck==='same-document'&&!find('[data-dialog=setup]')&&!!find('.flight[data-callsign]');
                    if(!result.saveConnectionKeepsPane)throw Error('Save connection left/reloaded the unchanged session');
                    find('[data-action=rates]').click();await floatingReady('dialog','[data-dialog=rates]');
                    await rpc('host:test-floating',{key:'dialog',close:true});await wait(100);result.nativeSubmenuClose=!find('[data-dialog=rates]');if(!result.nativeSubmenuClose)throw Error('Native close did not clear submenu state');
                    // Native zoom changes must propagate in either direction and fit
                    // both physical dimensions to the CSS panel, leaving no old-size box.
                    find('[data-action=configuration]').click();await floatingReady('dialog','[data-dialog=configuration]');
                    const sizeAtZoom=async factor=>{
                        const frame=await rpc('host:test-floating',{key:'dialog'}),panel=find('[data-dialog=configuration]'),rect=panel.getBoundingClientRect(),scale=panel.ownerDocument.defaultView.devicePixelRatio;
                        return {factor,frame,width:rect.width*scale,height:rect.height*scale,scale};
                    };
                    const originalZoom=await rpc('host:test-zoom');result.zoomSizing=[];
                    for(const [factor,key] of [[1.25,''],[0.8,'dialog'],[1,'']]){
                        const zoom=await rpc('host:test-zoom',{factor,key});await wait(250);
                        if(!zoom.factors.every(w=>Math.abs(w.factor-factor)<0.000001))throw Error('Window zoom levels diverged');
                        const sizing=await sizeAtZoom(factor);result.zoomSizing.push(sizing);
                        if(Math.abs(sizing.frame.width-sizing.width)>2||Math.abs(sizing.frame.height-sizing.height)>2)throw Error('Zoom left unused frame space around submenu');
                        if(factor===1.25)await rpc('host:test-floating',{key:'dialog',capture:true});
                    }
                    result.sharedZoom=true;result.zoomFitsContents=true;
                    await rpc('host:test-zoom',{factor:1.25});find('.dialog-title button').click();await wait(50);
                    find('[data-action=coordinations]').click();await floatingReady('menu','.coordination-menu');await wait(200);
                    const zoomedMenu=await rpc('host:test-floating',{key:'menu'}),menuPanel=find('.coordination-menu'),menuRect=menuPanel.getBoundingClientRect(),menuScale=menuPanel.ownerDocument.defaultView.devicePixelRatio;
                    result.reopenedZoom=zoomedMenu.zoom===1.25&&Math.abs(zoomedMenu.width-menuRect.width*menuScale)<=2&&Math.abs(zoomedMenu.height-menuRect.height*menuScale)<=2;
                    if(!result.reopenedZoom)throw Error('Reopened submenu did not inherit current zoom');
                    find('.coordination-menu .menu-title button').click();await wait(50);
                    await rpc('host:coordination',{message:notification,enabled:true,busy:false});const zoomedCoordination=await rpc('host:test-coordination');
                    result.coordinationZoom=zoomedCoordination.width===Math.round(400*zoomedCoordination.dpi/96)&&zoomedCoordination.dpi>96;if(!result.coordinationZoom)throw Error('Native coordination popup did not follow AMAN zoom');
                    await rpc('host:coordination',{message:null});await rpc('host:test-zoom',{factor:originalZoom.zoom});
                    const wideFrame=await rpc('host:test-frame'),wideFont=parseFloat(getComputedStyle(find('.view-buttons button')).fontSize);
                    await rpc('host:test-frame',{width:360});await wait(200);
                    const toolbar=find('.toolbar'),nav=find('.view-buttons'),navButtons=[...nav.querySelectorAll('button')],smallFont=parseFloat(getComputedStyle(navButtons[0]).fontSize),rows=new Set(navButtons.map(b=>Math.round(b.getBoundingClientRect().top)));
                    result.compactHeader={font:smallFont,wideFont,rows:rows.size,height:toolbar.getBoundingClientRect().height,overflow:toolbar.scrollWidth-toolbar.clientWidth};
                    if(smallFont>=wideFont||rows.size>2||toolbar.getBoundingClientRect().height>70||toolbar.scrollWidth>toolbar.clientWidth+1||navButtons.some(b=>b.scrollWidth>b.clientWidth+1))throw Error('Narrow header did not compact without clipping controls');
                    await rpc('host:test-frame',{capture:'compact'});await rpc('host:test-frame',{width:wideFrame.width,height:wideFrame.height});await wait(150);
                    result.headerRestores=parseFloat(getComputedStyle(find('.view-buttons button')).fontSize)===wideFont;if(!result.headerRestores)throw Error('Header did not restore at wider size');

                    result.ok=true;
                }catch(error){result.error=String(error.message||error)}
                window.chrome.webview.postMessage({id:999999,method:'host:test-operations',data:result});
            })();true;)JS",nullptr);
            browser->ExecuteScript(L"document.body.innerText",Callback<ICoreWebView2ExecuteScriptCompletedHandler>([weak](HRESULT code,LPCWSTR value)->HRESULT{
                auto self=weak.lock();if(!self)return S_OK;std::ofstream output(self->host.context->directory/L"host-ui.txt");output<<Narrow(value);
                ComPtr<IStream> stream;const auto image=self->host.context->directory/L"SAAMAN-native-preview.png";
                if(SUCCEEDED(SHCreateStreamOnFileEx(image.c_str(),STGM_CREATE|STGM_WRITE,FILE_ATTRIBUTE_NORMAL,TRUE,nullptr,&stream))){
                    self->browser->CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,stream.Get(),Callback<ICoreWebView2CapturePreviewCompletedHandler>([weak,stream](HRESULT result)->HRESULT{
                        auto window=weak.lock();if(window){std::ofstream(window->host.context->directory/L"host-capture-status.txt")<<result;SetEvent(window->host.testDone);}return S_OK;
                    }).Get());
                }else SetEvent(self->host.testDone);return code;
            }).Get());
        }
        LRESULT Message(UINT message,WPARAM w,LPARAM l){
            // The opaque WebView paints the content. Do not erase it to a
            // class brush between successive software-composited drag frames.
            if(!auth&&message==WM_ERASEBKGND)return 1;
            if(!auth&&message==WM_PAINT){Paint();return 0;}
            if(!auth&&message==WM_PRINTCLIENT&&w){RECT client{};GetClientRect(hwnd,&client);DrawPanelChrome(reinterpret_cast<HDC>(w),client,supervisor);return 0;}
            if(!auth&&message==WM_LBUTTONDOWN){
                RECT client;GetClientRect(hwnd,&client);const int x=static_cast<short>(LOWORD(l)),y=static_cast<short>(HIWORD(l));
                if(y<18&&x>client.right-18){SendMessageW(hwnd,WM_CLOSE,0,0);return 0;}
                if(y<18||x>=client.right-7||y>=client.bottom-7){dragging=y<18;resizing=!dragging;GetCursorPos(&dragStart);GetWindowRect(hwnd,&dragRect);MapWindowPoints(HWND_DESKTOP,GetParent(hwnd),reinterpret_cast<POINT*>(&dragRect),2);SetCapture(hwnd);return 0;}
            }
            if(!auth&&message==WM_MOUSEMOVE&&(dragging||resizing)){
                POINT current;GetCursorPos(&current);const int dx=current.x-dragStart.x,dy=current.y-dragStart.y;const auto area=host.radar;
                int width=dragRect.right-dragRect.left,height=dragRect.bottom-dragRect.top,x=dragRect.left,y=dragRect.top;
                if(resizing){width=std::max(360,std::min(width+dx,static_cast<int>(area.right-x)));height=std::max(380,std::min(height+dy,static_cast<int>(area.bottom-y)));}
                else{x=std::max(static_cast<int>(area.left),std::min(x+dx,static_cast<int>(area.right)-width));y=std::max(static_cast<int>(area.top),std::min(y+dy,static_cast<int>(area.bottom)-height));}
                SetWindowPos(hwnd,HWND_TOP,x,y,width,height,SWP_NOACTIVATE);return 0;
            }
            if(message==WM_LBUTTONUP||message==WM_CAPTURECHANGED){dragging=false;resizing=false;if(message==WM_LBUTTONUP&&GetCapture()==hwnd)ReleaseCapture();}
            if(!auth&&message==WM_SETCURSOR){POINT point;GetCursorPos(&point);ScreenToClient(hwnd,&point);RECT client;GetClientRect(hwnd,&client);if(point.x>=client.right-7||point.y>=client.bottom-7){SetCursor(LoadCursorW(nullptr,IDC_SIZENWSE));return TRUE;}}
            if(!auth&&message==WM_WINDOWPOSCHANGING){
                auto* position=reinterpret_cast<WINDOWPOS*>(l);
                if(position&&(!(position->flags&SWP_NOMOVE)||!(position->flags&SWP_NOSIZE))){
                    // Keep the no-copy drag fix, but allow normal repainting
                    // when a newly opened submenu receives its content size.
                    // Deferring resize paint can leave the software WebView's
                    // old surface visible after its viewport has changed.
                    const bool knownBounds=GetWindowRect(hwnd,&previousBounds)!=FALSE;
                    const bool sizeChanged=!(position->flags&SWP_NOSIZE)&&(!knownBounds||position->cx!=previousBounds.right-previousBounds.left||position->cy!=previousBounds.bottom-previousBounds.top);
                    position->flags|=SWP_NOCOPYBITS;
                    if(!sizeChanged)position->flags|=SWP_NOREDRAW;
                    if(knownBounds){MapWindowPoints(HWND_DESKTOP,GetParent(hwnd),reinterpret_cast<POINT*>(&previousBounds),2);havePreviousBounds=true;}
                }
            }
            if(message==WM_WINDOWPOSCHANGED){
                if(controller)controller->NotifyParentWindowPositionChanged();
                if(!auth&&havePreviousBounds){
                    const HWND parent=GetParent(hwnd);RECT current{},damage{};GetWindowRect(hwnd,&current);MapWindowPoints(HWND_DESKTOP,parent,reinterpret_cast<POINT*>(&current),2);UnionRect(&damage,&previousBounds,&current);
                    // Moving a pane does not invalidate the sector-map cache.
                    // Let EuroScope service a normal SDK refresh, without a
                    // parent erase/forced WM_PAINT during the move callback.
                    RedrawWindow(parent,&damage,nullptr,RDW_INVALIDATE|RDW_NOERASE|RDW_NOCHILDREN);
                    RedrawWindow(hwnd,nullptr,nullptr,RDW_INVALIDATE|RDW_NOERASE|RDW_ALLCHILDREN);
                    host.MarkRadarDirty();havePreviousBounds=false;
                }
            }
            if(message==WM_SIZE){
                Bounds();
                // Invalidate the browser descendants after applying the new
                // viewport, rather than only painting the host's frame.
                RedrawWindow(hwnd,nullptr,nullptr,RDW_INVALIDATE|RDW_NOERASE|RDW_ALLCHILDREN);
                return 0;
            }
            if(message==WM_SETFOCUS&&controller){controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);return 0;}
            if(message==WM_CLOSE&&floating&&!host.stopping){Present(false);if(auto owner=floatingOwner.lock())if(owner->browser){const auto event=Wide(Json({{"event","floating-close"},{"key",floatingKey}}).dump());owner->browser->PostWebMessageAsJson(event.c_str());}return 0;}
            if(message==WM_CLOSE&&!auth&&!host.stopping){host.visible[supervisor?1:0].store(false);Present(false);return 0;}
            if(message==WM_CLOSE||message==CloseAuth){DestroyWindow(hwnd);return 0;}
            if(message==WM_DESTROY){destroying=true;if(!auth&&!floating){host.visible[supervisor?1:0].store(false);host.panels[supervisor?1:0].store(nullptr);}if(openDeferral){openDeferral->Complete();openDeferral.Reset();openArgs.Reset();}if(auth&&!completed)if(auto owner=authOwner.lock())owner->Reply(authRequest,Json(),false,401,"Sign-in cancelled");if(controller)controller->Close();browser.Reset();controller.Reset();environment.Reset();return 0;}
            if(message==WM_NCDESTROY){const auto closing=hwnd;SetWindowLongPtrW(closing,GWLP_USERDATA,0);hwnd=nullptr;return DefWindowProcW(closing,message,w,l);}
            return DefWindowProcW(hwnd,message,w,l);
        }
    };
    HINSTANCE module;HMODULE retained=nullptr;std::shared_ptr<Context> context;HANDLE thread=nullptr,ready=nullptr,testDone=nullptr;DWORD threadId=0;double uiZoom=1.0;bool zoomInitialized=false,stopping=false;std::vector<std::shared_ptr<Window>> windows;
    std::unique_ptr<CoordinationPopup> coordination;
    HWND parent=nullptr,testParent=nullptr,requestedParent=nullptr;RECT radar{},requestedRadar{};std::mutex binding;std::atomic<bool> visible[2]{};std::atomic<HWND> panels[2]{};std::atomic<bool> radarDirty{false};std::atomic<HWND> redrawTarget{nullptr};std::atomic<UINT> redrawMessage{0};
    HWND uiObserver=nullptr;bool hostUiBusy=false;
    void RefreshHostUi(){
        if(!IsWindow(parent))return;
        const bool busy=HostMenuActive(parent);
        if(busy!=hostUiBusy){
            hostUiBusy=busy;
            for(const auto& window:windows)if(!window->auth&&!window->destroying&&window->hwnd)window->Present(window->floating?window->floatingVisible:visible[window->supervisor?1:0].load());
            if(coordination)coordination->AllowHostUi(!busy);
            MarkRadarDirty();
        }
        bool changed=false;
        for(const auto& window:windows)if(!window->auth&&!window->destroying&&window->hwnd)changed=window->hostOcclusion.Apply(window->hwnd,parent,context->test)||changed;
        if(changed){RedrawWindow(parent,nullptr,nullptr,RDW_INVALIDATE|RDW_ALLCHILDREN);MarkRadarDirty();}
    }
    static LRESULT CALLBACK UiObserver(HWND hwnd,UINT message,WPARAM w,LPARAM l){
        if(message==WM_NCCREATE)SetWindowLongPtrW(hwnd,GWLP_USERDATA,reinterpret_cast<LONG_PTR>(reinterpret_cast<CREATESTRUCTW*>(l)->lpCreateParams));
        auto* self=reinterpret_cast<Impl*>(GetWindowLongPtrW(hwnd,GWLP_USERDATA));
        if(self&&(message==WM_TIMER||message==WM_APP+1)){try{self->RefreshHostUi();}catch(...){/* Do not unwind into the host message pump. */}return 0;}
        return DefWindowProcW(hwnd,message,w,l);
    }
    void ShareZoom(double zoom){
        if(!std::isfinite(zoom)||zoom<0.25||zoom>5)return;
        uiZoom=zoom;zoomInitialized=true;if(coordination)coordination->SetZoom(zoom);for(const auto& window:windows)if(!window->destroying)window->ApplyZoom(zoom);
    }
    void MarkRadarDirty(){const bool pending=radarDirty.exchange(true);const auto target=redrawTarget.load();if(target&&!pending)PostMessageW(target,redrawMessage.load(),0,0);}
    void EnsureBackground(){
        if(!IsWindow(parent)||stopping)return;
        for(const auto& window:windows)if(!window->auth&&!window->supervisor&&!window->floating&&!window->destroying)return;
        // One hidden main renderer owns the connection and calculation worker.
        // Its identity watcher joins when EuroScope logs in; Show reuses it.
        auto window=std::make_shared<Window>(*this,false);windows.push_back(window);window->Create(false);
    }
    Impl(HINSTANCE image,std::shared_ptr<Context> data):module(image),context(std::move(data)){
        ready=CreateEventW(nullptr,TRUE,FALSE,nullptr);testDone=CreateEventW(nullptr,TRUE,FALSE,nullptr);
        GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,reinterpret_cast<LPCWSTR>(&ThreadProc),&retained);
        thread=CreateThread(nullptr,0,ThreadProc,this,0,&threadId);if(!thread)throw std::runtime_error("Cannot start SAAMAN window thread");WaitForSingleObject(ready,10000);
    }
    ~Impl(){if(thread){PostThreadMessageW(threadId,StopMessage,0,0);WaitForSingleObject(thread,INFINITE);CloseHandle(thread);}CloseHandle(ready);CloseHandle(testDone);}
    static LRESULT CALLBACK Procedure(HWND hwnd,UINT msg,WPARAM w,LPARAM l){
        Window* window=reinterpret_cast<Window*>(GetWindowLongPtrW(hwnd,GWLP_USERDATA));
        if(msg==WM_NCCREATE){window=static_cast<Window*>(reinterpret_cast<CREATESTRUCTW*>(l)->lpCreateParams);window->hwnd=hwnd;SetWindowLongPtrW(hwnd,GWLP_USERDATA,reinterpret_cast<LONG_PTR>(window));}
        if(!window)return DefWindowProcW(hwnd,msg,w,l);return window->Message(msg,w,l);
    }
    static DWORD WINAPI ThreadProc(void* parameter){
        auto& self=*static_cast<Impl*>(parameter);const HMODULE retained=self.retained;
        CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);
        WNDCLASSW type{};type.hInstance=self.module;type.lpfnWndProc=Procedure;type.lpszClassName=WindowClass;type.hCursor=LoadCursorW(nullptr,IDC_ARROW);type.hbrBackground=static_cast<HBRUSH>(GetStockObject(DKGRAY_BRUSH));RegisterClassW(&type);
        if(self.context->test){WNDCLASSW mock{};mock.hInstance=self.module;mock.lpfnWndProc=DefWindowProcW;mock.lpszClassName=L"SAAMANTestRadar";RegisterClassW(&mock);self.parent=self.testParent=CreateWindowExW(0,mock.lpszClassName,L"Test radar",WS_OVERLAPPEDWINDOW,0,0,1200,1000,nullptr,nullptr,self.module,nullptr);GetClientRect(self.parent,&self.radar);}

        WNDCLASSW observer{};observer.hInstance=self.module;observer.lpfnWndProc=UiObserver;observer.lpszClassName=L"SAAMANHostUiObserver";RegisterClassW(&observer);
        self.uiObserver=CreateWindowExW(0,observer.lpszClassName,L"SAAMAN host UI observer",0,0,0,0,0,HWND_MESSAGE,nullptr,self.module,&self);SetTimer(self.uiObserver,1,100,nullptr);
        MSG msg{};PeekMessageW(&msg,nullptr,WM_USER,WM_USER,PM_NOREMOVE);SetEvent(self.ready);
        while(GetMessageW(&msg,nullptr,0,0)>0){
            if(!msg.hwnd&&msg.message==AttachMessage){std::unique_ptr<Attachment> data(reinterpret_cast<Attachment*>(msg.lParam));self.parent=data->parent;self.radar=data->radar;for(const auto& window:self.windows)if(!window->auth&&window->hwnd&&GetParent(window->hwnd)!=self.parent){window->hostOcclusion.Bind(self.parent);SetParent(window->hwnd,self.parent);}self.EnsureBackground();}
            else if(!msg.hwnd&&(msg.message==ShowMessage||msg.message==ToggleMessage)){const bool supervisor=msg.wParam!=0;std::shared_ptr<Window> existing;
                for(const auto& window:self.windows)if(!window->auth&&!window->floating&&window->supervisor==supervisor&&!window->destroying){existing=window;break;}
                if(existing){const bool show=msg.message!=ToggleMessage||!self.visible[supervisor?1:0].load();self.visible[supervisor?1:0].store(show);if(show&&existing->supervisor&&existing->browser)existing->browser->Reload();existing->Present(show);}
                else{auto window=std::make_shared<Window>(self,supervisor);self.windows.push_back(window);window->Create();}
            }else if(!msg.hwnd&&msg.message==PulseMessage){self.EnsureBackground();for(const auto& window:self.windows)if(!window->auth&&window->browser)window->browser->PostWebMessageAsJson(L"{\"event\":\"pulse\"}");}
            else if(!msg.hwnd&&msg.message==HideMessage){for(const auto& window:self.windows)if(!window->auth&&window->hwnd){self.visible[window->supervisor?1:0].store(false);window->Present(false);}}
            else if(!msg.hwnd&&msg.message==StopMessage){self.stopping=true;self.coordination.reset();for(const auto& window:self.windows)if(window->hwnd)DestroyWindow(window->hwnd);self.windows.clear();break;}
            else{if(self.coordination&&self.coordination->Route(msg))continue;TranslateMessage(&msg);DispatchMessageW(&msg);}
        }
        if(self.uiObserver){KillTimer(self.uiObserver,1);DestroyWindow(self.uiObserver);self.uiObserver=nullptr;}UnregisterClassW(L"SAAMANHostUiObserver",self.module);
        if(self.testParent){DestroyWindow(self.testParent);UnregisterClassW(L"SAAMANTestRadar",self.module);}UnregisterClassW(WindowClass,self.module);CoUninitialize();FreeLibraryAndExitThread(retained,0);
    }
};
Host::Host(HINSTANCE module,std::shared_ptr<Context> context):impl(std::make_unique<Impl>(module,std::move(context))){}
Host::~Host()=default;
void Host::Show(bool supervisor){PostThreadMessageW(impl->threadId,ShowMessage,supervisor?1:0,0);}
void Host::Hide(){PostThreadMessageW(impl->threadId,HideMessage,0,0);}
void Host::Pulse(){PostThreadMessageW(impl->threadId,PulseMessage,0,0);}
void Host::Attach(HWND parent,RECT radar){
    if(!IsWindow(parent)||radar.right<=radar.left||radar.bottom<=radar.top)return;
    std::lock_guard lock(impl->binding);if(impl->requestedParent==parent&&memcmp(&impl->requestedRadar,&radar,sizeof(radar))==0)return;
    impl->requestedParent=parent;impl->requestedRadar=radar;auto* data=new Attachment{parent,radar};if(!PostThreadMessageW(impl->threadId,AttachMessage,0,reinterpret_cast<LPARAM>(data)))delete data;
}
void Host::Toggle(bool supervisor){PostThreadMessageW(impl->threadId,ToggleMessage,supervisor?1:0,0);}
bool Host::IsVisible(bool supervisor)const{return impl->visible[supervisor?1:0].load();}
HWND Host::PanelHandle(bool supervisor)const{return impl->panels[supervisor?1:0].load();}
void Host::RefreshHostUi(){if(impl->uiObserver)SendMessageW(impl->uiObserver,WM_APP+1,0,0);}
void Host::SetRadarRefreshTarget(HWND target,UINT message){impl->redrawMessage.store(message);impl->redrawTarget.store(target);}
bool Host::ConsumeRadarRefresh(){return impl->radarDirty.exchange(false);}
void Host::DrawChrome(HDC)const{
    // Chrome is in the child browser surface. A radar refresh must neither
    // write pane pixels to the SDK cache nor invalidate every browser child.
}

}
