#pragma once
#include "context.h"
#include <windows.h>
#include <wincrypt.h>
#include <fstream>
#include <regex>
#include <vector>
namespace saaman {
inline bool ValidBackend(const std::string& value){
    if(value.size()>300||!std::regex_match(value,std::regex("(https://[A-Za-z0-9.-]+(:[0-9]{1,5})?|http://(localhost|127\\.0\\.0\\.1)(:[0-9]{1,5})?)")))return false;
    const auto port=value.find(':',value.find("://")+3);if(port!=std::string::npos){const auto n=std::stoi(value.substr(port+1));if(n<1||n>65535)return false;}return true;
}
inline bool ValidControllerKey(const std::string& key){return std::regex_match(key,std::regex("saaman_[A-Za-z0-9_-]{43}"));}
inline std::string ReadControllerKey(const std::filesystem::path& storage,const std::string& backend){
    std::ifstream in(storage/L"SAAMAN-controller-key.bin",std::ios::binary|std::ios::ate);if(!in||in.tellg()<=0||in.tellg()>8192)return {};
    std::vector<BYTE> bytes(static_cast<size_t>(in.tellg()));in.seekg(0);in.read(reinterpret_cast<char*>(bytes.data()),bytes.size());if(!in)return {};
    DATA_BLOB input{static_cast<DWORD>(bytes.size()),bytes.data()},entropy{static_cast<DWORD>(backend.size()),reinterpret_cast<BYTE*>(const_cast<char*>(backend.data()))},plain{};
    if(!CryptUnprotectData(&input,nullptr,&entropy,nullptr,nullptr,CRYPTPROTECT_UI_FORBIDDEN,&plain))return {};
    std::string key(reinterpret_cast<char*>(plain.pbData),plain.cbData);SecureZeroMemory(plain.pbData,plain.cbData);LocalFree(plain.pbData);return ValidControllerKey(key)?key:std::string{};
}
inline void SaveControllerKey(const std::filesystem::path& storage,const std::string& backend,const std::string& key){
    if(!ValidControllerKey(key))throw RequestError(400,"Invalid controller key format");
    DATA_BLOB input{static_cast<DWORD>(key.size()),reinterpret_cast<BYTE*>(const_cast<char*>(key.data()))},entropy{static_cast<DWORD>(backend.size()),reinterpret_cast<BYTE*>(const_cast<char*>(backend.data()))},encrypted{};
    if(!CryptProtectData(&input,L"SAAMAN controller key",&entropy,nullptr,nullptr,CRYPTPROTECT_UI_FORBIDDEN,&encrypted))throw RequestError(500,"Cannot protect controller key");
    std::filesystem::create_directories(storage);const auto target=storage/L"SAAMAN-controller-key.bin",temp=storage/L"SAAMAN-controller-key.bin.tmp";
    bool written=false;{std::ofstream out(temp,std::ios::binary|std::ios::trunc);if(out){out.write(reinterpret_cast<char*>(encrypted.pbData),encrypted.cbData);written=bool(out);}}
    LocalFree(encrypted.pbData);if(!written||!MoveFileExW(temp.c_str(),target.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH))throw RequestError(500,"Cannot save protected controller key");
}
}
