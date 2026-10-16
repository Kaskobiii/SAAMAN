#pragma once
#include <windows.h>
#include <wincodec.h>
#include <wrl.h>
#include <vector>

namespace saaman {
struct RadarSurface {
    unsigned id=0;unsigned long long order=0;RECT bounds{};bool visible=false,supervisor=false;
    UINT width=0,height=0;std::vector<unsigned char> pixels;
};
inline bool DecodeRadarSurface(IStream* stream,RadarSurface& surface){
    using Microsoft::WRL::ComPtr;
    LARGE_INTEGER start{};if(FAILED(stream->Seek(start,STREAM_SEEK_SET,nullptr)))return false;
    ComPtr<IWICImagingFactory> factory;ComPtr<IWICBitmapDecoder> decoder;ComPtr<IWICBitmapFrameDecode> frame;ComPtr<IWICFormatConverter> converter;
    if(FAILED(CoCreateInstance(CLSID_WICImagingFactory,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&factory)))||FAILED(factory->CreateDecoderFromStream(stream,nullptr,WICDecodeMetadataCacheOnLoad,&decoder))||FAILED(decoder->GetFrame(0,&frame)))return false;
    UINT w=0,h=0;if(FAILED(frame->GetSize(&w,&h))||!w||!h||w>4096||h>4096)return false;
    if(FAILED(factory->CreateFormatConverter(&converter))||FAILED(converter->Initialize(frame.Get(),GUID_WICPixelFormat32bppBGRA,WICBitmapDitherTypeNone,nullptr,0,WICBitmapPaletteTypeCustom)))return false;
    std::vector<unsigned char> pixels(static_cast<size_t>(w)*h*4);
    if(FAILED(converter->CopyPixels(nullptr,w*4,static_cast<UINT>(pixels.size()),pixels.data())))return false;
    surface.width=w;surface.height=h;surface.pixels=std::move(pixels);return true;
}
inline void PaintRadarSurface(HDC dc,const RadarSurface& surface){
    if(!surface.visible)return;
    const auto& r=surface.bounds;const int saved=SaveDC(dc);IntersectClipRect(dc,r.left,r.top,r.right,r.bottom);
    if(!surface.pixels.empty()){
        BITMAPINFO info{};info.bmiHeader.biSize=sizeof(BITMAPINFOHEADER);info.bmiHeader.biWidth=surface.width;info.bmiHeader.biHeight=-static_cast<LONG>(surface.height);info.bmiHeader.biPlanes=1;info.bmiHeader.biBitCount=32;info.bmiHeader.biCompression=BI_RGB;
        StretchDIBits(dc,r.left,r.top,r.right-r.left,r.bottom-r.top,0,0,surface.width,surface.height,surface.pixels.data(),&info,DIB_RGB_COLORS,SRCCOPY);
    }else{
        const auto body=CreateSolidBrush(RGB(73,80,85)),bar=CreateSolidBrush(RGB(94,97,101));FillRect(dc,&r,body);
        RECT title{r.left,r.top,r.right,r.top+18};FillRect(dc,&title,bar);SetBkMode(dc,TRANSPARENT);SetTextColor(dc,RGB(220,230,241));
        DrawTextW(dc,surface.supervisor?L"SAAMAN SUPERVISION":L"AMAN",-1,&title,DT_CENTER|DT_VCENTER|DT_SINGLELINE);
        RECT text{r.left+12,r.top+35,r.right-12,r.bottom};DrawTextW(dc,L"Loading SAAMAN...",-1,&text,DT_LEFT|DT_TOP|DT_SINGLELINE);DeleteObject(body);DeleteObject(bar);
    }
    RestoreDC(dc,saved);
}
}
