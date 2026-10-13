#include "host.h"
#include "panel_chrome.h"
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
        Impl& host;bool supervisor=false,auth=false,completed=false,destroying=false,smokeStarted=false;
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
                const auto area=host.radar;const int width=std::min(supervisor?1050:780,static_cast<int>(area.right-area.left-90)),height=std::min(760,static_cast<int>(area.bottom-area.top-30));
                const int panelWidth=std::min(std::max(360,width),static_cast<int>(area.right-area.left)),panelHeight=std::min(std::max(380,height),static_cast<int>(area.bottom-area.top));
                const int x=area.left+std::min(85,std::max(0,static_cast<int>(area.right-area.left)-panelWidth)),y=area.top+std::min(25,std::max(0,static_cast<int>(area.bottom-area.top)-panelHeight));
                hwnd=CreateWindowExW(WS_EX_NOPARENTNOTIFY,WindowClass,supervisor?L"SAAMAN SUPERVISION":L"AMAN",WS_CHILD|WS_CLIPCHILDREN|WS_CLIPSIBLINGS,x,y,panelWidth,panelHeight,host.parent,nullptr,host.module,this);
                host.panels[supervisor?1:0].store(hwnd);host.visible[supervisor?1:0].store(hwnd!=nullptr&&show);
            }else{
            HWND owner=GetForegroundWindow();DWORD pid=0;GetWindowThreadProcessId(owner,&pid);if(pid!=GetCurrentProcessId())owner=nullptr;
            else owner=GetAncestor(owner,GA_ROOTOWNER);
            hwnd=CreateWindowExW(0,WindowClass,auth?L"SAAMAN · VATSIM sign in":supervisor?L"SAAMAN · ESSA supervision":L"SAAMAN · ESSA arrivals",WS_OVERLAPPEDWINDOW,CW_USEDEFAULT,CW_USEDEFAULT,supervisor?1100:820,auth?780:820,owner,nullptr,host.module,this);
            }
            if(!hwnd)return;
            ShowWindow(hwnd,host.context->test||!show?SW_HIDE:SW_SHOW);
            std::weak_ptr<Window> weak=shared_from_this();
            auto options=Microsoft::WRL::Make<CoreWebView2EnvironmentOptions>();
            options->put_AdditionalBrowserArguments(L"--disable-gpu --disable-gpu-compositing");
            const HRESULT started=CreateCoreWebView2EnvironmentWithOptions(nullptr,host.context->profile.c_str(),options.Get(),Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>([weak](HRESULT error,ICoreWebView2Environment* env)->HRESULT{
                auto self=weak.lock();if(!self||self->destroying)return S_OK;
                if(FAILED(error)||!env){self->Fail(L"Microsoft WebView2 Runtime is required. Install it from Microsoft's WebView2 download page, then reopen SAAMAN.");return S_OK;}
                self->environment=env;
                env->CreateCoreWebView2Controller(self->hwnd,Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>([weak](HRESULT code,ICoreWebView2Controller* control)->HRESULT{
                    auto window=weak.lock();if(!window||window->destroying)return S_OK;
                    if(FAILED(code)||!control){window->Fail(L"The embedded AMAN window could not be created.");return S_OK;}
                    window->controller=control;ComPtr<ICoreWebView2Controller2> opaque;if(SUCCEEDED(control->QueryInterface(IID_PPV_ARGS(&opaque))))opaque->put_DefaultBackgroundColor({255,73,80,85});control->get_CoreWebView2(&window->browser);window->Setup();window->Present(window->auth||window->host.visible[window->supervisor?1:0].load());return S_OK;
                }).Get());return S_OK;
            }).Get());
            if(FAILED(started))Fail(L"WebView2 could not initialize. Check the Microsoft WebView2 Runtime installation.");
        }
        void Fail(const wchar_t* message){SetWindowTextW(hwnd,message);if(host.context->test){std::ofstream(host.context->directory/L"host-test-failure.txt")<<Narrow(message);SetEvent(host.testDone);}else MessageBoxW(hwnd,message,L"SAAMAN",MB_ICONERROR|MB_OK);}
        void Bounds(){if(controller&&hwnd){RECT rect;GetClientRect(hwnd,&rect);controller->put_Bounds(rect);}}
        void Present(bool show){
            if(!hwnd)return;
            if(controller){Bounds();controller->put_IsVisible(show?TRUE:FALSE);controller->NotifyParentWindowPositionChanged();}
            const bool wasVisible=IsWindowVisible(hwnd)!=FALSE;
            ShowWindow(hwnd,show&&!host.context->test?SW_SHOW:SW_HIDE);
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
                        if(method=="host:coordination"){
                            if(self->auth||self->supervisor)throw RequestError(403,"Coordination belongs to the AMAN worker");
                            if(!self->host.coordination)self->host.coordination=std::make_unique<CoordinationPopup>(self->host.module,self->host.context->test);
                            std::weak_ptr<Window> owner=self;
                            self->host.coordination->Update(GetAncestor(self->host.parent,GA_ROOT),data,[owner](const std::string& messageId){
                                if(auto window=owner.lock())if(window->browser&&!window->destroying){const auto event=Wide(Json({{"event","coordination-ack"},{"messageId",messageId}}).dump());window->browser->PostWebMessageAsJson(event.c_str());}
                            });self->Reply(id,true);return S_OK;
                        }
                        if(method=="host:test-coordination"&&self->host.context->test){
                            if(!self->host.coordination)throw RequestError(400,"No coordination popup");
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
                        if(method=="host:ready"){self->Present(self->host.visible[self->supervisor?1:0].load());self->Reply(id,true);if(self->host.context->test){BOOL shown=FALSE;self->controller->get_IsVisible(&shown);std::ofstream(self->host.context->directory/(self->supervisor?L"supervisor-first-open.txt":L"aman-first-open.txt"))<<shown;}self->Smoke();return S_OK;}
                        if(method=="host:test-operations"&&self->host.context->test){std::ofstream(self->host.context->directory/L"operations-ui.json")<<data.dump(2);self->Reply(id,true);return S_OK;}
                        if(method=="host:test-frame"&&self->host.context->test){RECT rectangle{},bounds{};GetWindowRect(self->hwnd,&rectangle);MapWindowPoints(HWND_DESKTOP,GetParent(self->hwnd),reinterpret_cast<POINT*>(&rectangle),2);self->controller->get_Bounds(&bounds);self->Reply(id,{{"x",rectangle.left},{"y",rectangle.top},{"width",rectangle.right-rectangle.left},{"height",rectangle.bottom-rectangle.top},{"browserLeft",bounds.left},{"browserTop",bounds.top},{"dragging",self->dragging},{"resizing",self->resizing}});return S_OK;}
                        const auto result=self->host.context->Request(method,data,self->supervisor);self->Reply(id,result);
                        if(method=="mode:set"&&result.value("changed",true)){if(self->host.coordination)self->host.coordination->Hide();for(const auto& other:self->host.windows)if(other.get()!=self.get()&&!other->auth&&other->browser)other->browser->Reload();}
                    }catch(const RequestError& error){self->Reply(id,Json(),false,error.status,error.what());}catch(const std::exception& error){self->Reply(id,Json(),false,400,error.what());}return S_OK;
                }).Get(),&token);
            }
            browser->add_NavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>([weak](ICoreWebView2*,ICoreWebView2NavigationStartingEventArgs* args)->HRESULT{
                auto self=weak.lock();if(!self)return S_OK;LPWSTR raw=nullptr;args->get_Uri(&raw);const std::wstring uri=raw?raw:L"";CoTaskMemFree(raw);
                if(!self->auth){if(!Trusted(uri)&&uri!=L"about:blank")args->put_Cancel(TRUE);return S_OK;}
                const std::string url=Narrow(uri.c_str());
                if(url.rfind(self->redirect+"?",0)==0){args->put_Cancel(TRUE);const auto received=Parameter(url,"state"),code=Parameter(url,"code");
                    if(auto owner=self->authOwner.lock()){if(received==self->state&&!code.empty())owner->Reply(self->authRequest,{{"code",code},{"state",received}});else owner->Reply(self->authRequest,Json(),false,401,"VATSIM sign-in failed or state did not match");}
                    self->completed=true;PostMessageW(self->hwnd,CloseAuth,0,0);return S_OK;}
                if(uri.rfind(L"https://auth.vatsim.net/",0)!=0&&uri.rfind(L"https://auth-dev.vatsim.net/",0)!=0&&uri!=L"about:blank")args->put_Cancel(TRUE);return S_OK;
            }).Get(),&token);
            browser->add_NewWindowRequested(Callback<ICoreWebView2NewWindowRequestedEventHandler>([weak](ICoreWebView2*,ICoreWebView2NewWindowRequestedEventArgs* args)->HRESULT{
                auto self=weak.lock();if(!self)return S_OK;args->put_Handled(TRUE);return S_OK;
            }).Get(),&token);
            browser->add_NavigationCompleted(Callback<ICoreWebView2NavigationCompletedEventHandler>([weak](ICoreWebView2*,ICoreWebView2NavigationCompletedEventArgs*)->HRESULT{
                if(auto self=weak.lock())if(!self->auth)self->Present(self->host.visible[self->supervisor?1:0].load());return S_OK;
            }).Get(),&token);
            browser->Navigate(auth?Wide(authUrl).c_str():supervisor?L"https://saaman.local/index.html?view=supervisor":L"https://saaman.local/index.html?view=aman");
        }
        void OpenAuth(int request,const Json& data){
            const auto url=data.at("url").get<std::string>(),callback=data.at("redirect").get<std::string>(),nonce=data.at("state").get<std::string>();
            if((url.rfind("https://auth.vatsim.net/oauth/authorize?",0)!=0&&url.rfind("https://auth-dev.vatsim.net/oauth/authorize?",0)!=0)||
                (callback!="https://vatiris.se/"&&callback!="https://vatiris.se/login"&&callback!="http://localhost:5173/login")||nonce.size()<16||nonce.size()>128||Parameter(url,"state")!=nonce||Parameter(url,"redirect_uri")!=callback)throw RequestError(400,"Untrusted sign-in request");
            auto window=std::make_shared<Window>(host,false);window->auth=true;window->authOwner=shared_from_this();window->authRequest=request;window->authUrl=url;window->redirect=callback;window->state=nonce;host.windows.push_back(window);window->Create();
        }
        void Smoke(){
            if(!host.context->test||smokeStarted||supervisor)return;smokeStarted=true;
            std::weak_ptr<Window> weak=shared_from_this();
            browser->ExecuteScript(LR"JS((async()=>{
                const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));const result={ok:false};
                try{
                    await wait(200);
                    const frameTitle=document.querySelector('.frame-title');result.embeddedBorder=frameTitle?.innerText==='AMAN'&&frameTitle.getBoundingClientRect().height>=17&&document.querySelector('.frame-resize')!==null;if(!result.embeddedBorder)throw Error('Embedded TopSky frame missing');
                    const inspectFrame=()=>new Promise(resolve=>{const listener=event=>{if(event.data.id===999998){window.chrome.webview.removeEventListener('message',listener);resolve(event.data.result)}};window.chrome.webview.addEventListener('message',listener);window.chrome.webview.postMessage({id:999998,method:'host:test-frame',data:{}})});const frameBefore=await inspectFrame();

                    frameTitle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:91,screenX:100,screenY:100}));window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:91,screenX:130,screenY:120}));window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:91,screenX:130,screenY:120}));await wait(80);
                    const grip=document.querySelector('.frame-resize');grip.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:92,screenX:800,screenY:800}));window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:92,screenX:820,screenY:820}));window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:92,screenX:820,screenY:820}));await wait(80);const frameAfter=await inspectFrame();result.frameInput=frameAfter.x===frameBefore.x+30&&frameAfter.y===frameBefore.y+20&&frameAfter.width===frameBefore.width+20&&frameAfter.height===frameBefore.height+20&&!frameAfter.dragging&&!frameAfter.resizing&&frameAfter.browserLeft===0&&frameAfter.browserTop===0;if(!result.frameInput)throw Error('Native move/resize or browser bounds did not follow the embedded frame');
                    const overview=document.querySelector('.time-overview');for(let step=0;step<8;step++)overview.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));await wait(60);
                    const ticks=[...document.querySelectorAll('.timeline-column .tick')],area=document.querySelector('.time-area');result.minuteSpacingCallsign=Math.abs(Math.abs(parseFloat(ticks[1].style.top)-parseFloat(ticks[0].style.top))-23)<0.1;if(!result.minuteSpacingCallsign)throw Error('Minute spacing must be 23 pixels, approximately one callsign row');result.noDiagonalConnectors=!document.querySelector('.time-anchors line');if(!result.noDiagonalConnectors)throw Error('Diagonal label connectors must be absent');
                    const controllerData=await new Promise(resolve=>{const listener=event=>{if(event.data.id===999997){window.chrome.webview.removeEventListener('message',listener);resolve(event.data.result)}};window.chrome.webview.addEventListener('message',listener);window.chrome.webview.postMessage({id:999997,method:'telemetry:get',data:{}})});
                    const views=[...document.querySelectorAll('.view-buttons button')].map(b=>b.innerText);
                    result.controllerViews=views.includes('Runway')&&views.includes('FLOW')&&(controllerData.source==='ESSA_W_APP'?views.includes('ARR-W')&&!views.includes('ACC'):controllerData.source==='ESSA_E_APP'?!views.includes('ACC')&&!views.includes('ARR-W'):views.includes('ACC'));
                    if(!result.controllerViews)throw Error('Controller-specific feeder button or unfiltered Runway/FLOW views incorrect');
                    if(typeof CompressionStream!=='undefined'&&typeof DecompressionStream!=='undefined'){
                        const raw=JSON.stringify({checkpoint:'native-codec-check '.repeat(2000)});
                        const encoded=await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
                        const decoded=await new Response(new Blob([encoded]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
                        result.publicationCompression=decoded===raw&&encoded.byteLength<raw.length/5;if(!result.publicationCompression)throw Error('Native browser publication compression failed');
                    }else result.publicationCompression='uncompressed-fallback';
                    const flight=document.querySelector('.flight[data-callsign]');if(!flight)throw Error('No mock arrival');
                    const boundaryGap=document.querySelector('[data-gap="layout-boundary"]');if(boundaryGap){
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
                    dragged=document.querySelector('.flight[data-callsign]');result.reactiveDrag=!!dragged&&dragged.dataset.state!=='UNSTABLE';if(!result.reactiveDrag)throw Error('Reactive aircraft drag was not accepted');
                    }else result.reactiveDrag='separate-default-fixture';
                    const rect=dragged.getBoundingClientRect();dragged.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2,clientX:rect.left+5,clientY:rect.top+5}));await wait(80);
                    const popup=document.querySelector('.flight-menu');if(!popup)throw Error('Right-click menu missing');
                    const text=popup.innerText;for(const action of ['Refresh delay','Change ETA-FF','Maximum delay','Insert arrival','Insert closure','Insert gap'])if(!text.includes(action))throw Error('Missing action '+action);
                    result.removedMenus=!popup.querySelector('[data-menu=slot]')&&!text.includes('Extra flight');if(!result.removedMenus)throw Error('Removed callsign actions still present');
                    popup.querySelector('[data-menu=information]').click();await wait(80);
                    const info=document.querySelector('.native-dialog');result.pointerDialog=info.getBoundingClientRect().left>0&&getComputedStyle(info).position==='absolute';if(!result.pointerDialog)throw Error('Dialog must open at the pointer');
                    const infoRect=info.getBoundingClientRect(),title=info.querySelector('.dialog-title');title.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:82,clientX:infoRect.left+20,clientY:infoRect.top+8}));window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,buttons:1,pointerId:82,clientX:infoRect.left-20,clientY:infoRect.top+28}));window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerId:82,clientX:infoRect.left-20,clientY:infoRect.top+28}));await wait(40);result.draggableDialog=Math.abs(info.getBoundingClientRect().top-infoRect.top)>1||Math.abs(info.getBoundingClientRect().left-infoRect.left)>1;if(!result.draggableDialog)throw Error('Dialog header drag failed');
                    result.informationRows=document.querySelectorAll('.information-table tr').length;if(result.informationRows!==3)throw Error('Information layout must have three rows');
                    document.querySelector('.dialog-title button').click();await wait(40);
                    flight.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2,clientX:rect.left+5,clientY:rect.top+5}));await wait(40);
                    [...document.querySelectorAll('.flight-menu button')].find(b=>b.innerText.includes('Maximum delay')).click();await wait(40);
                    result.maximumDelayChoices=document.querySelectorAll('[data-dialog=maximum-delay] .submenu-choice').length;if(result.maximumDelayChoices!==6||document.querySelector('[data-dialog=maximum-delay] select'))throw Error('Maximum delay must be direct choices');document.querySelector('.dialog-title button').click();await wait(40);
                    flight.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2,clientX:rect.left+5,clientY:rect.top+5}));await wait(40);[...document.querySelectorAll('.flight-menu button')].find(b=>b.innerText.includes('Insert gap')).click();await wait(40);
                    result.beforeAfterChoices=document.querySelectorAll('[data-dialog=relative-side] .submenu-choice').length;if(result.beforeAfterChoices!==2)throw Error('Before/after submenu missing');document.querySelector('.dialog-title button').click();await wait(40);
                    document.querySelector('.time-area').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2,clientX:rect.left+5,clientY:rect.top+5}));await wait(40);document.querySelector('[data-menu=add-flight]').click();await wait(40);
                    result.manualLists=document.querySelectorAll('.manual-flight-lists [role=listbox]').length;if(result.manualLists!==2)throw Error('Overshoot/Planned lists missing');document.querySelector('.dialog-title button').click();await wait(40);
                    document.querySelector('[data-action=coordinations]').click();await wait(40);
                    result.coordinationChoices=document.querySelectorAll('.coordination-menu>button').length;if(result.coordinationChoices!==10)throw Error('Coordination menu mismatch');
                    document.querySelector('[data-action=coordinations]').click();
                    // The coordination popup is owned by the radar frame,
                    // not constrained by the AMAN child pane or a second relay.
                    let rpcId=980000;
                    const rpc=(method,data={})=>new Promise((resolve,reject)=>{const id=++rpcId;const listener=event=>{if(event.data.id===id){window.chrome.webview.removeEventListener('message',listener);event.data.ok?resolve(event.data.result):reject(Error(event.data.error))}};window.chrome.webview.addEventListener('message',listener);window.chrome.webview.postMessage({id,method,data})});
                    const notification={id:'popup-test',message:'Speed 230 kts for all arrivals to ESSA',sender:'other-instance',senderCallsign:'ESOS_1__CTR',at:Date.UTC(2026,9,13,12,34,56),acknowledgedBy:['other-instance']};
                    const receivedAcks=[],onAck=event=>receivedAcks.push(event.detail.id);window.addEventListener('saaman-coordination-ack',onAck);
                    await rpc('host:coordination',{message:notification,enabled:true,busy:false});
                    const separate=await rpc('host:test-coordination',{capture:true});
                    result.coordinationExternal=separate.topLevel&&separate.owned&&Math.abs(separate.x+separate.width/2-(separate.ownerX+separate.ownerWidth/2))<=1&&Math.abs(separate.y+separate.height/2-(separate.ownerY+separate.ownerHeight/2))<=1;
                    result.coordinationMetadata=separate.sender==='ESOS_1__CTR'&&separate.sent.includes('12:34:56 UTC')&&separate.message.at===notification.at;
                    if(!result.coordinationExternal||!result.coordinationMetadata)throw Error('Coordination popup position or sender/time incorrect');
                    result.coordinationLayout=separate.status===''&&Math.abs(separate.buttonCenterX-separate.clientCenterX)<=1;
                    if(!result.coordinationLayout)throw Error('Coordination button must be centered without receipt instructions');
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
                    document.querySelector('[data-action=rates]').click();await wait(60);
                    const rateSlider=document.querySelector('[data-input=arrival-rate-slider]');result.rateBounds=rateSlider?.min==='60'&&rateSlider?.max==='600';if(!result.rateBounds)throw Error('Arrival rate must allow only 6–60 per hour');
                    const slider=document.querySelector('[data-input=apply-time-slider]');slider.value='10';slider.dispatchEvent(new Event('input',{bubbles:true}));await wait(80);
                    const line=document.querySelector('.change-time-marker.preview');if(!line||getComputedStyle(line).borderTopStyle!=='solid')throw Error('Draft time marker must be solid');
                    result.solidTimeMarker=true;document.querySelector('.dialog-title button').click();
                    // Saving an unchanged connection must not leave/reload the current pane.
                    [...document.querySelectorAll('.view-buttons button')].find(b=>b.innerText.includes('MAESTRO')).click();await wait(40);
                    [...document.querySelectorAll('.global-menu button')].find(b=>b.innerText.includes('Operation mode')).click();await wait(40);
                    window.__saamanSaveCheck='same-document';
                    [...document.querySelectorAll('[data-dialog=setup] button')].find(b=>b.innerText==='Save connection').click();await wait(300);
                    result.saveConnectionKeepsPane=window.__saamanSaveCheck==='same-document'&&!document.querySelector('[data-dialog=setup]')&&!!document.querySelector('.flight[data-callsign]');
                    if(!result.saveConnectionKeepsPane)throw Error('Save connection left/reloaded the unchanged session');
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
                    // Windows must not copy the old pane pixels or erase the
                    // exposed parent itself. Schedule both surfaces below.
                    position->flags|=SWP_NOCOPYBITS|SWP_NOREDRAW;
                    if(GetWindowRect(hwnd,&previousBounds)){MapWindowPoints(HWND_DESKTOP,GetParent(hwnd),reinterpret_cast<POINT*>(&previousBounds),2);havePreviousBounds=true;}
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
            if(message==WM_SIZE){Bounds();InvalidateRect(hwnd,nullptr,FALSE);return 0;}
            if(message==WM_SETFOCUS&&controller){controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);return 0;}
            if(message==WM_CLOSE&&!auth&&!host.stopping){host.visible[supervisor?1:0].store(false);Present(false);return 0;}
            if(message==WM_CLOSE||message==CloseAuth){DestroyWindow(hwnd);return 0;}
            if(message==WM_DESTROY){destroying=true;if(!auth){host.visible[supervisor?1:0].store(false);host.panels[supervisor?1:0].store(nullptr);}if(auth&&!completed)if(auto owner=authOwner.lock())owner->Reply(authRequest,Json(),false,401,"Sign-in cancelled");if(controller)controller->Close();browser.Reset();controller.Reset();environment.Reset();return 0;}
            if(message==WM_NCDESTROY){const auto closing=hwnd;SetWindowLongPtrW(closing,GWLP_USERDATA,0);hwnd=nullptr;return DefWindowProcW(closing,message,w,l);}
            return DefWindowProcW(hwnd,message,w,l);
        }
    };
    HINSTANCE module;HMODULE retained=nullptr;std::shared_ptr<Context> context;HANDLE thread=nullptr,ready=nullptr,testDone=nullptr;DWORD threadId=0;bool stopping=false;std::vector<std::shared_ptr<Window>> windows;
    std::unique_ptr<CoordinationPopup> coordination;
    HWND parent=nullptr,testParent=nullptr,requestedParent=nullptr;RECT radar{},requestedRadar{};std::mutex binding;std::atomic<bool> visible[2]{};std::atomic<HWND> panels[2]{};std::atomic<bool> radarDirty{false};std::atomic<HWND> redrawTarget{nullptr};std::atomic<UINT> redrawMessage{0};
    void MarkRadarDirty(){const bool pending=radarDirty.exchange(true);const auto target=redrawTarget.load();if(target&&!pending)PostMessageW(target,redrawMessage.load(),0,0);}
    void EnsureBackground(){
        if(!IsWindow(parent)||stopping)return;
        for(const auto& window:windows)if(!window->auth&&!window->supervisor&&!window->destroying)return;
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

        MSG msg{};PeekMessageW(&msg,nullptr,WM_USER,WM_USER,PM_NOREMOVE);SetEvent(self.ready);
        while(GetMessageW(&msg,nullptr,0,0)>0){
            if(!msg.hwnd&&msg.message==AttachMessage){std::unique_ptr<Attachment> data(reinterpret_cast<Attachment*>(msg.lParam));self.parent=data->parent;self.radar=data->radar;for(const auto& window:self.windows)if(!window->auth&&window->hwnd&&GetParent(window->hwnd)!=self.parent)SetParent(window->hwnd,self.parent);self.EnsureBackground();}
            else if(!msg.hwnd&&(msg.message==ShowMessage||msg.message==ToggleMessage)){const bool supervisor=msg.wParam!=0;std::shared_ptr<Window> existing;
                for(const auto& window:self.windows)if(!window->auth&&window->supervisor==supervisor&&!window->destroying){existing=window;break;}
                if(existing){const bool show=msg.message!=ToggleMessage||!self.visible[supervisor?1:0].load();self.visible[supervisor?1:0].store(show);if(show&&existing->supervisor&&existing->browser)existing->browser->Reload();existing->Present(show);}
                else{auto window=std::make_shared<Window>(self,supervisor);self.windows.push_back(window);window->Create();}
            }else if(!msg.hwnd&&msg.message==PulseMessage){self.EnsureBackground();for(const auto& window:self.windows)if(!window->auth&&window->browser)window->browser->PostWebMessageAsJson(L"{\"event\":\"pulse\"}");}
            else if(!msg.hwnd&&msg.message==HideMessage){for(const auto& window:self.windows)if(!window->auth&&window->hwnd){self.visible[window->supervisor?1:0].store(false);window->Present(false);}}
            else if(!msg.hwnd&&msg.message==StopMessage){self.stopping=true;self.coordination.reset();for(const auto& window:self.windows)if(window->hwnd)DestroyWindow(window->hwnd);self.windows.clear();break;}
            else{if(self.coordination&&self.coordination->Route(msg))continue;TranslateMessage(&msg);DispatchMessageW(&msg);}
        }
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
void Host::SetRadarRefreshTarget(HWND target,UINT message){impl->redrawMessage.store(message);impl->redrawTarget.store(target);}
bool Host::ConsumeRadarRefresh(){return impl->radarDirty.exchange(false);}
void Host::DrawChrome(HDC)const{
    // Chrome is in the child browser surface. A radar refresh must neither
    // write pane pixels to the SDK cache nor invalidate every browser child.
}

}
