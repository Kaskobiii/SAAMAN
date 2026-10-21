#pragma once
#include <string>
#include <algorithm>
#include <cctype>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <windows.h>
namespace saaman {
inline std::string TelemetryUtf8(std::string text,UINT codePage=CP_ACP){
    if(text.empty())return text;
    if(text.size()>static_cast<size_t>((std::numeric_limits<int>::max)()))throw std::length_error("SDK text is too long");
    const int length=static_cast<int>(text.size());
    // SDK/sector strings may be Windows encoded. Preserve existing UTF-8;
    // otherwise decode the process ANSI page before putting text into JSON.
    if(std::all_of(text.begin(),text.end(),[](unsigned char c){return c<0x80;})||MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,text.data(),length,nullptr,0)>0)return text;
    if(codePage==CP_UTF8||codePage==CP_ACP&&GetACP()==CP_UTF8)codePage=1252;
    const int count=MultiByteToWideChar(codePage,0,text.data(),length,nullptr,0);
    if(count<=0)throw std::runtime_error("Cannot decode EuroScope SDK text");
    std::wstring wide(count,L'\0');
    if(MultiByteToWideChar(codePage,0,text.data(),length,wide.data(),count)!=count)throw std::runtime_error("Cannot decode EuroScope SDK text");
    const int bytes=WideCharToMultiByte(CP_UTF8,0,wide.data(),count,nullptr,0,nullptr,nullptr);
    if(bytes<=0)throw std::runtime_error("Cannot encode EuroScope SDK text");
    std::string result(bytes,'\0');
    if(WideCharToMultiByte(CP_UTF8,0,wide.data(),count,result.data(),bytes,nullptr,nullptr)!=bytes)throw std::runtime_error("Cannot encode EuroScope SDK text");
    return result;
}
inline std::string TelemetryText(const char* value,const char* fallback="",size_t maxBytes=(std::numeric_limits<size_t>::max)()){
    auto text=TelemetryUtf8(value&&*value?value:fallback);
    auto end=(std::min)(text.size(),maxBytes);
    while(end>0&&end<text.size()&&(static_cast<unsigned char>(text[end])&0xc0)==0x80)--end;
    text.resize(end);return text;
}
inline std::string TelemetryWake(char value){return value=='L'||value=='M'||value=='H'||value=='J'?std::string(1,value):"?";}
// TopSky General B, section 6.9: HS is exported as IAS 999. It is a
// high-speed flag, not an exact IAS limit. SDK zero means no assignment.
// Preserve all other values so normal speed validation still diagnoses them.
inline bool TelemetryTopSkyHighSpeed(int value){return value==999;}
inline int TelemetryAssignedSpeed(int value){return TelemetryTopSkyHighSpeed(value)?0:value;}
inline std::string TelemetryIdentifier(const char* value){
    std::string text=TelemetryText(value);const auto first=text.find_first_not_of(" \t\r\n");if(first==std::string::npos)return {};
    text=text.substr(first,text.find_last_not_of(" \t\r\n")-first+1);
    std::transform(text.begin(),text.end(),text.begin(),[](unsigned char c){return static_cast<char>(std::toupper(c));});return text;
}
inline std::string TelemetryAirport(const char* value){
    auto text=TelemetryIdentifier(value);if(text.size()>4&&std::isspace(static_cast<unsigned char>(text[4])))text.resize(4);return text;
}
inline std::string TelemetryRunway(const char* value){
    auto text=TelemetryIdentifier(value);
    if(text.size()==1&&std::isdigit(static_cast<unsigned char>(text[0]))||text.size()==2&&std::isdigit(static_cast<unsigned char>(text[0]))&&(text[1]=='L'||text[1]=='R'||text[1]=='C'))text.insert(0,"0");
    if((text.size()!=2&&text.size()!=3)||!std::isdigit(static_cast<unsigned char>(text[0]))||!std::isdigit(static_cast<unsigned char>(text[1])))return {};
    const int number=(text[0]-'0')*10+text[1]-'0';if(number<1||number>36||text.size()==3&&text[2]!='L'&&text[2]!='R'&&text[2]!='C')return {};
    return text;
}
inline bool TelemetrySupportedRunway(const std::string& airport,const std::string& runway){
    return airport=="ESSA"&&(runway=="01L"||runway=="01R"||runway=="08"||runway=="19L"||runway=="19R"||runway=="26")||airport=="ESSB"&&(runway=="12"||runway=="30");
}
inline bool TelemetryPositionValid(double latitude,double longitude){return std::isfinite(latitude)&&std::isfinite(longitude)&&std::abs(latitude)<=90&&std::abs(longitude)<=180;}
}
