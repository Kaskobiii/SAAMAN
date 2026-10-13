#pragma once
#include <string>
#include <algorithm>
#include <cctype>
#include <cmath>
namespace saaman {
inline std::string TelemetryText(const char* value,const char* fallback=""){return value&&*value?value:fallback;}
inline std::string TelemetryWake(char value){return value=='L'||value=='M'||value=='H'||value=='J'?std::string(1,value):"?";}
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
