#include "auth_client.h"
#include <windows.h>
#include <winhttp.h>
namespace saaman {
namespace {
struct InternetHandle{HINTERNET value;explicit InternetHandle(HINTERNET handle):value(handle){if(!value)throw RequestError(502,"VATSIM connection failed");}~InternetHandle(){WinHttpCloseHandle(value);}InternetHandle(const InternetHandle&)=delete;};
}
Json ReadVatsimUser(const Json& request){
    const auto url=request.at("url").get<std::string>(),token=request.at("token").get<std::string>();
    if((url!="https://auth.vatsim.net/api/user"&&url!="https://auth-dev.vatsim.net/api/user")||token.empty()||token.size()>8192||token.find_first_of("\r\n")!=std::string::npos)throw RequestError(400,"Invalid VATSIM identity request");
    // This is a fixed HTTPS identity endpoint, not an arbitrary HTTP proxy.
    // TLS validation remains enabled. The EuroScope callback thread is not used.
    InternetHandle session(WinHttpOpen(L"SAAMAN/1.0",WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,WINHTTP_NO_PROXY_NAME,WINHTTP_NO_PROXY_BYPASS,0));
    WinHttpSetTimeouts(session.value,1500,2000,2000,3000);
    InternetHandle connection(WinHttpConnect(session.value,url.find("auth-dev")!=std::string::npos?L"auth-dev.vatsim.net":L"auth.vatsim.net",INTERNET_DEFAULT_HTTPS_PORT,0));
    InternetHandle call(WinHttpOpenRequest(connection.value,L"GET",L"/api/user",nullptr,WINHTTP_NO_REFERER,WINHTTP_DEFAULT_ACCEPT_TYPES,WINHTTP_FLAG_SECURE));
    DWORD redirects=WINHTTP_OPTION_REDIRECT_POLICY_NEVER;WinHttpSetOption(call.value,WINHTTP_OPTION_REDIRECT_POLICY,&redirects,sizeof(redirects));
    const std::wstring authorization=L"Authorization: Bearer "+std::wstring(token.begin(),token.end())+L"\r\nAccept: application/json\r\n";
    if(!WinHttpSendRequest(call.value,authorization.c_str(),static_cast<DWORD>(authorization.size()),WINHTTP_NO_REQUEST_DATA,0,0,0)||!WinHttpReceiveResponse(call.value,nullptr))throw RequestError(502,"VATSIM did not respond");
    DWORD status=0,size=sizeof(status);WinHttpQueryHeaders(call.value,WINHTTP_QUERY_STATUS_CODE|WINHTTP_QUERY_FLAG_NUMBER,WINHTTP_HEADER_NAME_BY_INDEX,&status,&size,WINHTTP_NO_HEADER_INDEX);
    if(status!=200)throw RequestError(static_cast<int>(status),"VATSIM account request was rejected");
    std::string body;DWORD available=0;
    while(WinHttpQueryDataAvailable(call.value,&available)&&available){if(body.size()+available>1024*1024)throw RequestError(502,"VATSIM response was too large");const auto begin=body.size();body.resize(begin+available);DWORD read=0;if(!WinHttpReadData(call.value,body.data()+begin,available,&read))throw RequestError(502,"VATSIM response was incomplete");body.resize(begin+read);if(!read)break;}
    return Json::parse(body);
}
}
