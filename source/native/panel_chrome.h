#pragma once
#include <windows.h>
namespace saaman {
// Draw only into the pane's own client/print surface. Never call this on
// EuroScope's SDK HDC: it may be a persistent radar backbuffer.
inline void DrawPanelChrome(HDC dc,RECT client,bool supervisor){
    const int saved=SaveDC(dc);
    HBRUSH background=CreateSolidBrush(RGB(73,80,85)),bar=CreateSolidBrush(RGB(94,97,101));
    RECT title{client.left,client.top,client.right,client.top+18};FillRect(dc,&title,bar);
    RECT left{client.left,client.top+18,client.left+2,client.bottom};FillRect(dc,&left,background);
    RECT right{client.right-7,client.top+18,client.right,client.bottom};FillRect(dc,&right,background);
    RECT bottom{client.left,client.bottom-7,client.right,client.bottom};FillRect(dc,&bottom,background);
    SetBkMode(dc,TRANSPARENT);SetTextColor(dc,RGB(220,230,241));
    HFONT font=CreateFontW(-12,0,0,0,FW_NORMAL,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Arial");SelectObject(dc,font);
    DrawTextW(dc,supervisor?L"SAAMAN SUPERVISION":L"AMAN",-1,&title,DT_CENTER|DT_VCENTER|DT_SINGLELINE);
    RECT close{client.right-13,client.top+5,client.right-6,client.top+12};FillRect(dc,&close,static_cast<HBRUSH>(GetStockObject(LTGRAY_BRUSH)));
    HPEN pen=CreatePen(PS_SOLID,1,RGB(168,177,186));SelectObject(dc,pen);
    for(int offset=2;offset<9;offset+=3){MoveToEx(dc,client.right-offset-5,client.bottom-2,nullptr);LineTo(dc,client.right-2,client.bottom-offset-5);}
    RestoreDC(dc,saved);DeleteObject(pen);DeleteObject(font);DeleteObject(background);DeleteObject(bar);
}
}
