#include "host.h"
#include <iostream>
#include <fstream>
int wmain(int argc,wchar_t** argv){
    if(argc!=2)return 2;
    const auto folder=std::filesystem::absolute(argv[1]);std::filesystem::create_directories(folder);
    const auto started=std::filesystem::file_time_type::clock::now();
    auto context=std::make_shared<saaman::Context>(folder);context->test=true;context->shared=false;context->profile=folder/L"webview-profile";
    const auto now=saaman::Now();context->telemetry={{"source","SAAMAN_NATIVE_TEST"},{"timestamp",now},{"flights",saaman::Json::array({{
        {"callsign","SAAMAN_TEST"},{"aircraft","A320"},{"wake","M"},{"departure","EKCH"},{"arrival","ESSA"},{"runway","19R"},
        {"route",saaman::Json::array({{{"name","ELTOK"},{"seconds",600},{"latitude",60.0},{"longitude",16.8}}})},
        {"landingSeconds",600},{"distanceNm",50},{"groundspeed",240},{"altitude",18000},{"latitude",60.1},{"longitude",16.3},{"heading",110},{"positionAgeSeconds",0}
    }})}};
    // Optional isolated fixtures for the real renderer's controller/interval UI.
    {std::ifstream fixtureFile(folder/L"host-test-fixture.json");if(fixtureFile){saaman::Json fixture;fixtureFile>>fixture;
        for(const auto field:{"source","controllerPositionId","controllers","runways"})if(fixture.contains(field))context->telemetry[field]=fixture[field];}}
    saaman::Host host(GetModuleHandleW(nullptr),context);host.Pulse();
    for(int i=0;i<60;i++){
        Sleep(500);
        if(std::filesystem::exists(folder/L"host-test-failure.txt")&&std::filesystem::last_write_time(folder/L"host-test-failure.txt")>=started){std::cerr<<"Native host initialization failed\n";return 1;}
        if(std::filesystem::exists(folder/L"host-capture-status.txt")&&std::filesystem::last_write_time(folder/L"host-capture-status.txt")>=started){
            std::ifstream textFile(folder/L"host-ui.txt");const std::string text((std::istreambuf_iterator<char>(textFile)),{});
            if(text.find("SAAMAN_TEST")==std::string::npos||text.find("SAAMAN") == std::string::npos){std::cerr<<"Native UI did not render telemetry\n"<<text;return 1;}
            std::ifstream ready(folder/L"aman-first-open.txt");int controllerVisible=-1;ready>>controllerVisible;if(controllerVisible!=0||host.IsVisible()){std::cerr<<"Background startup opened the AMAN pane\n";return 1;}
            const auto backgroundPanel=host.PanelHandle();
            {std::lock_guard lock(context->mutex);if(context->plan["snapshot"].is_null()){std::cerr<<"Background startup did not calculate before first open\n";return 1;}}
            // Repeated timer/attachment events must not create a second worker.
            RECT backgroundArea{};GetClientRect(GetParent(backgroundPanel),&backgroundArea);host.Attach(GetParent(backgroundPanel),backgroundArea);host.Pulse();host.Show();
            for(int wait=0;wait<20&&!host.IsVisible();wait++)Sleep(50);
            if(!host.IsVisible()||host.PanelHandle()!=backgroundPanel){std::cerr<<"Opening AMAN did not reuse its background connection\n";return 1;}
            saaman::Json operations;
            for(int wait=0;wait<250;wait++){std::ifstream file(folder/L"operations-ui.json");if(file){try{file>>operations;if(operations.contains("ok"))break;}catch(...){}}Sleep(100);}
            if(!operations.value("ok",false)){std::cerr<<"AMAN operations UI failed: "<<operations.dump()<<"\n";return 1;}
            host.Show(true);bool supervisorReady=false;for(int wait=0;wait<100;wait++){Sleep(100);std::ifstream supervisory(folder/L"supervisor-first-open.txt");int visible=0;if(supervisory>>visible&&visible==1){supervisorReady=true;break;}}if(!supervisorReady){std::cerr<<"Supervision was not visible on first open\n";return 1;}
            saaman::Json supervisorFrame;for(int wait=0;wait<100;wait++){std::ifstream frameFile(folder/L"supervisor-frame.json");if(frameFile){try{frameFile>>supervisorFrame;if(supervisorFrame.contains("ok"))break;}catch(...){}}Sleep(100);}if(!supervisorFrame.value("ok",false)){std::cerr<<"Supervisor move/close failed: "<<supervisorFrame.dump()<<"\n";return 1;}
            const HWND panel=host.PanelHandle();if(!panel||!GetParent(panel)||(GetWindowLongPtrW(panel,GWL_STYLE)&WS_CHILD)==0||(GetWindowLongPtrW(panel,GWL_STYLE)&(WS_POPUP|WS_CAPTION))!=0){std::cerr<<"AMAN is not an embedded child panel\n";return 1;}
            // Simulate fresh radar backbuffers, without resizing or WM_PAINT.
            // Each frame must include the chrome and leave the browser area alone.
            HDC frame=CreateCompatibleDC(nullptr);BITMAPINFO bitmap{};bitmap.bmiHeader.biSize=sizeof(BITMAPINFOHEADER);bitmap.bmiHeader.biWidth=1200;bitmap.bmiHeader.biHeight=-1000;bitmap.bmiHeader.biPlanes=1;bitmap.bmiHeader.biBitCount=32;void* pixels=nullptr;
            HBITMAP surface=CreateDIBSection(frame,&bitmap,DIB_RGB_COLORS,&pixels,nullptr,0);const auto previous=SelectObject(frame,surface);
            RECT panelRect{};GetWindowRect(panel,&panelRect);MapWindowPoints(HWND_DESKTOP,GetParent(panel),reinterpret_cast<POINT*>(&panelRect),2);
            bool chrome=true;for(int refresh=0;refresh<3;refresh++){
                RECT full{0,0,1200,1000};FillRect(frame,&full,static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH)));host.DrawChrome(frame);
                chrome=chrome&&GetPixel(frame,panelRect.left+3,panelRect.top+3)==RGB(0,0,0)&&GetPixel(frame,panelRect.left+1,panelRect.top+40)==RGB(0,0,0)&&GetPixel(frame,panelRect.left+20,panelRect.top+40)==RGB(0,0,0);
            }
            // The pane must not clear its client surface between software
            // WebView drag frames. The old class-brush erase overwrote this.
            SetPixel(frame,20,40,RGB(17,33,49));
            const auto opaque=SendMessageW(panel,WM_ERASEBKGND,reinterpret_cast<WPARAM>(frame),0);
            if(opaque!=1||GetPixel(frame,20,40)!=RGB(17,33,49)){std::cerr<<"Pane erased the content surface during background handling\n";return 1;}
            SetPixel(frame,20,40,RGB(0,0,0));
            SendMessageW(panel,WM_PRINTCLIENT,reinterpret_cast<WPARAM>(frame),PRF_CLIENT);
            chrome=chrome&&GetPixel(frame,3,3)==RGB(94,97,101)&&GetPixel(frame,1,40)==RGB(73,80,85)&&GetPixel(frame,20,40)==RGB(0,0,0);
            SelectObject(frame,previous);DeleteObject(surface);DeleteDC(frame);if(!chrome){std::cerr<<"Pane chrome leaked into radar cache or did not paint its own frame\n";return 1;}
            const UINT wakeMessage=WM_APP+77;const HWND redrawRelay=CreateWindowExW(0,L"STATIC",L"Owned redraw relay",0,0,0,0,0,HWND_MESSAGE,nullptr,GetModuleHandleW(nullptr),nullptr);
            if(!redrawRelay){std::cerr<<"Could not create redraw notification test window\n";return 1;}host.SetRadarRefreshTarget(redrawRelay,wakeMessage);
            for(const HWND moved:{panel,host.PanelHandle(true)}){
                RECT old{};GetWindowRect(moved,&old);MapWindowPoints(HWND_DESKTOP,GetParent(moved),reinterpret_cast<POINT*>(&old),2);
                WINDOWPOS position{moved,HWND_TOP,old.left+10,old.top+10,0,0,SWP_NOSIZE|SWP_NOACTIVATE};
                SendMessageW(moved,WM_WINDOWPOSCHANGING,0,reinterpret_cast<LPARAM>(&position));
                if(!(position.flags&SWP_NOCOPYBITS)){std::cerr<<"Moving pane copied stale browser pixels\n";return 1;}
                MSG pending{};while(PeekMessageW(&pending,redrawRelay,wakeMessage,wakeMessage,PM_REMOVE)){};
                host.ConsumeRadarRefresh();SetWindowPos(moved,HWND_TOP,old.left+10,old.top+10,0,0,SWP_NOSIZE|SWP_NOACTIVATE);
                if(!host.ConsumeRadarRefresh()){std::cerr<<"Pane move did not request exposed radar repaint\n";return 1;}
                if(!PeekMessageW(&pending,redrawRelay,wakeMessage,wakeMessage,PM_REMOVE)){std::cerr<<"Pane move waited for timer instead of notifying radar thread\n";return 1;}
            }
            host.SetRadarRefreshTarget(nullptr,0);DestroyWindow(redrawRelay);
            host.Toggle();for(int wait=0;wait<20&&host.IsVisible();wait++)Sleep(50);if(host.IsVisible()){std::cerr<<"Launcher toggle did not hide panel\n";return 1;}
            host.Toggle();for(int wait=0;wait<20&&!host.IsVisible();wait++)Sleep(50);if(!host.IsVisible()){std::cerr<<"Launcher toggle did not reopen panel\n";return 1;}
            SendMessageW(panel,WM_CLOSE,0,0);if(host.IsVisible()){std::cerr<<"Panel close box did not hide panel\n";return 1;}host.Show();
            long long before=0;{std::lock_guard lock(context->mutex);before=context->plan["snapshot"].value("timestamp",0LL);context->telemetry["timestamp"]=saaman::Now();}
            host.Hide();host.Pulse();bool advanced=false;
            for(int tick=0;tick<30;tick++){Sleep(100);std::lock_guard lock(context->mutex);if(context->plan["snapshot"].value("timestamp",0LL)>before){advanced=true;break;}}
            if(!advanced){std::cerr<<"Native pulse did not refresh the hidden calculation window\n";return 1;}
            std::cout<<"Embedded child panel, persistent radar-refresh chrome, assets, AMAN, telemetry IPC, screenshot and hidden updates passed\n";return 0;
        }
    }
    std::cerr<<"Native renderer did not become ready within 30 seconds\n";return 1;
}
