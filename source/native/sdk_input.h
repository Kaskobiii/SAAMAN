#pragma once
namespace saaman {
// The hidden browser remains the single UI and calculation worker. EuroScope
// chooses the screen object first, so its own menus always win hit testing.
inline constexpr wchar_t SdkInputScript[]=LR"SDK((()=>{
 let down=null,hover=null,hoverControl=null,range=null,rangeOffset=0,capture=null,dispatching=false,serial=0,cursor='',selectMenu=null,selectOwner=null;const edits=new Map();let scheduled=false;
 const setCapture=Element.prototype.setPointerCapture,releaseCapture=Element.prototype.releasePointerCapture;
 Element.prototype.setPointerCapture=function(id){if(dispatching&&id===1){capture=this;return}return setCapture.call(this,id)};
 Element.prototype.releasePointerCapture=function(id){if(dispatching&&id===1){if(capture===this)capture=null;return}return releaseCapture.call(this,id)};
 const notify=()=>{if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;window.chrome?.webview?.postMessage({id:0,method:'host:surface-dirty',data:{}})},30)};
 const observe=()=>{const style=document.createElement('style');style.textContent='button[data-sdk-hover]:not(:disabled){filter:brightness(1.1)}.popup button[data-sdk-hover]:not(:disabled){background:#387da3}.saaman-sdk-select button[data-sdk-hover]:not(:disabled){background:#a6c4d5!important;border-color:#d4e4ed!important}';document.head.appendChild(style);new MutationObserver(notify).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true});document.addEventListener('scroll',notify,true);notify()};
 if(document.documentElement)observe();else document.addEventListener('DOMContentLoaded',observe,{once:true});
 const setValue=(el,value)=>{const prototype=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));notify()};
 // Native select popups are separate HWNDs and cannot appear in captured frames.
 // Keep their choices in this document so paint, styling and SDK hit testing agree.
 const closeSelect=()=>{selectOwner?.removeAttribute('aria-expanded');selectMenu?.remove();selectMenu=null;selectOwner=null;notify()};
 const openSelect=control=>{
  if(selectOwner===control){closeSelect();return}closeSelect();selectOwner=control;
  const rect=control.getBoundingClientRect(),style=getComputedStyle(control),menu=document.createElement('div');selectMenu=menu;
  menu.className='saaman-sdk-select';menu.setAttribute('role','listbox');menu.setAttribute('aria-label',control.getAttribute('aria-label')||control.closest('label')?.textContent?.trim()||'Choices');control.setAttribute('aria-expanded','true');
  menu.style.cssText='position:fixed;z-index:2147483647;box-sizing:border-box;overflow:auto;background:#899da9;color:#002c46;border:1px solid #bdcad2;border-radius:4px;padding:3px;box-shadow:0 2px 5px #0006;';
  menu.style.fontFamily=style.fontFamily;menu.style.fontSize=style.fontSize;menu.style.fontWeight=style.fontWeight;
  for(const option of control.options){
   const button=document.createElement('button');button.type='button';button.textContent=option.textContent;button.dataset.value=option.value;button.setAttribute('role','option');button.setAttribute('aria-selected',String(option.selected));button.disabled=option.disabled||!!option.closest('optgroup:disabled');
   button.style.cssText='display:block;box-sizing:border-box;width:100%;min-height:22px;margin:0;padding:3px 8px;text-align:left;border:1px solid transparent;border-radius:3px;cursor:pointer;font-family:inherit;font-size:inherit;white-space:nowrap;color:inherit;background:transparent;';
   if(option.selected){button.style.background='#a6c4d5';button.style.borderColor='#d4e4ed'}if(button.disabled)button.style.opacity='.5';
   button.addEventListener('click',event=>{event.stopPropagation();if(control.isConnected&&!control.disabled&&!button.disabled)setValue(control,option.value);closeSelect()});menu.appendChild(button);
  }
  document.body.appendChild(menu);const width=Math.min(innerWidth-8,Math.max(rect.width,menu.scrollWidth+8));menu.style.width=width+'px';
  const height=Math.min(menu.scrollHeight+2,Math.max(22,innerHeight-8)),below=rect.bottom+2;
  menu.style.maxHeight=height+'px';menu.style.left=Math.max(4,Math.min(rect.left,innerWidth-width-4))+'px';menu.style.top=Math.max(4,Math.min(below+height<=innerHeight-4?below:rect.top-height-2,innerHeight-height-4))+'px';
  menu.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'});notify();
 };
 window.addEventListener('resize',closeSelect);document.addEventListener('keydown',event=>{if(event.key==='Escape')closeSelect()});
 new MutationObserver(()=>{if(selectOwner&&!selectOwner.isConnected)closeSelect()}).observe(document,{subtree:true,childList:true});
 const thumbWidth=el=>Math.min(el.getBoundingClientRect().width-1,parseFloat(getComputedStyle(el).getPropertyValue('--horizontal-thumb-width'))||16);
 const rangeValue=(el,x)=>{const r=el.getBoundingClientRect(),thumb=thumbWidth(el),min=Number(el.min||0),max=Number(el.max||100),step=Number(el.step)||1;setValue(el,String(Math.max(min,Math.min(max,min+Math.round(((x-rangeOffset-r.left-thumb/2)/Math.max(1,r.width-thumb)*(max-min))/step)*step))))};
 window.__SAAMAN_SDK_EDIT__=(data)=>{const el=edits.get(data.token);edits.delete(data.token);if(el?.isConnected)setValue(el,data.value)};
 window.__SAAMAN_SDK_INPUT__=(data)=>{
  const scale=window.devicePixelRatio||1,x=data.x/scale,y=data.y/scale,el=document.elementFromPoint(x,y)||document.body;
  const options={bubbles:true,cancelable:true,pointerId:1,pointerType:'mouse',isPrimary:true,clientX:x,clientY:y,screenX:data.screenX,screenY:data.screenY,button:data.button??0,buttons:data.type==='down'||data.type==='move'&&down?1:0,ctrlKey:!!data.ctrl,shiftKey:!!data.shift,altKey:!!data.alt};
  const pointer=(target,type)=>{dispatching=true;try{return target?.dispatchEvent(new PointerEvent(type,options))}finally{dispatching=false}};
  if(data.type==='wheel'){const wheel=new WheelEvent('wheel',{...options,deltaY:data.delta,deltaMode:0});if(el.dispatchEvent(wheel)){for(let node=el;node&&node!==document.documentElement;node=node.parentElement){const style=getComputedStyle(node),axis=data.shift?'X':'Y';if((axis==='Y'?node.scrollHeight>node.clientHeight:node.scrollWidth>node.clientWidth)&&/auto|scroll/.test(axis==='Y'?style.overflowY:style.overflowX)){if(axis==='Y')node.scrollTop+=data.delta;else node.scrollLeft+=data.delta;break;}}}notify();return}
  if(data.type==='leave'){pointer(hover,'pointerleave');pointer(document.documentElement,'pointerleave');hoverControl?.removeAttribute('data-sdk-hover');hoverControl=null;hover=null;notify();return}
  if(data.type==='move'){
   let nextCursor=getComputedStyle(el).cursor;if(nextCursor==='auto'&&el.closest?.('input:not([type=range]),textarea'))nextCursor='text';if(nextCursor!==cursor){cursor=nextCursor;window.chrome.webview.postMessage({id:0,method:'host:surface-cursor',data:{cursor}})}
   const control=el.closest?.('button,input,select,a');if(control!==hoverControl){hoverControl?.removeAttribute('data-sdk-hover');control?.setAttribute('data-sdk-hover','');hoverControl=control}
   if(hover!==el){pointer(hover,'pointerleave');pointer(el,'pointerenter');hover=el}
   if(range)rangeValue(range,x);pointer(capture||el,'pointermove');notify();return;
  }
  if(data.type==='down'){
   if(selectMenu&&!selectMenu.contains(el)&&!selectOwner?.contains(el))closeSelect();
   if(el.closest?.(':disabled'))return;
   down={el,x,y};range=data.button===0?el.closest?.('input[type=range]'):null;if(range&&!range.disabled){const r=range.getBoundingClientRect(),thumb=thumbWidth(range),center=r.left+thumb/2+(r.width-thumb)*(Number(range.value)-Number(range.min||0))/Math.max(1,Number(range.max||100)-Number(range.min||0));rangeOffset=Math.abs(x-center)<=thumb/2?x-center:0;capture=range;rangeValue(range,x)}pointer(el,'pointerdown');notify();return;
  }
  if(data.type==='up'){
   const prior=down,upTarget=capture||el;pointer(upTarget,'pointerup');down=null;range=null;capture=null;
   if(!prior){notify();return}
   if(el.closest?.(':disabled')){notify();return}
   if(data.button===2){el.dispatchEvent(new MouseEvent('contextmenu',options));notify();return}
   if(data.button===1){el.dispatchEvent(new MouseEvent('auxclick',options));notify();return}
   const control=upTarget.closest?.('input,select,textarea');
   if(control?.tagName==='SELECT'&&!control.disabled){openSelect(control);return}
   if(control&&!control.disabled&&!control.readOnly&&!['checkbox','radio','range','button','submit'].includes(control.type)){
    const token=++serial;edits.clear();edits.set(token,control);const rect=control.getBoundingClientRect();
    window.chrome.webview.postMessage({id:0,method:'host:surface-edit',data:{token,kind:control.type==='password'?'password':'text',value:control.value,title:control.getAttribute('aria-label')||control.closest('label')?.innerText||'Value',rect:{left:rect.left*scale,top:rect.top*scale,right:rect.right*scale,bottom:rect.bottom*scale},options:control.options?[...control.options].map(o=>({text:o.textContent,value:o.value,disabled:o.disabled})):[]}});notify();return;
   }
   if(control?.type!=='range'){let target=upTarget;while(target&&!target.contains(prior.el))target=target.parentElement;(target||el).dispatchEvent(new MouseEvent('click',options))}notify();return;
  }
  if(data.type==='double')el.dispatchEvent(new MouseEvent('dblclick',options));notify();
 };
})();)SDK";
}
