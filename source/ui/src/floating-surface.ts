import {nextTick,onUnmounted,shallowRef,watch,type Ref} from 'vue'
import {nativeRequest} from './native-rpc'

// The same Vue component renders into an owned WebView window. There is no
// second controller session, copied form state or event-forwarding renderer.
export function useFloatingSurface(key:string,open:Ref<string>,source:Ref<HTMLElement|undefined>,selector:string,onClose:()=>void,onError:(error:Error)=>void){
 const target=shallowRef<HTMLElement|null>(null)
 let popup:Window|null=null,initializedDocument:Document|undefined,generation=0,pointer:number|undefined,observer:ResizeObserver|undefined,baseWidth=180,fitFrame=0
 const request=(method:string,data:Record<string,unknown>={})=>nativeRequest(method,{key,...data})
 const move=(e:PointerEvent)=>{if(e.pointerId===pointer)void request('host:floating-move',{x:e.screenX,y:e.screenY}).catch(()=>{})}
 const end=(e:PointerEvent)=>{if(e.pointerId===pointer){pointer=undefined;void request('host:floating-end',{x:e.screenX,y:e.screenY}).catch(()=>{})}}
 const fit=()=>{
  if(!popup||popup.closed||!target.value)return
  if(fitFrame)popup.cancelAnimationFrame(fitFrame)
  fitFrame=popup.requestAnimationFrame(()=>{fitFrame=popup!.requestAnimationFrame(()=>{
   fitFrame=0
   const panel=target.value?.querySelector<HTMLElement>('.native-dialog,.popup')
   const table=panel?.querySelector<HTMLElement>('.information-table'),content=panel?.querySelector<HTMLElement>('.information-scroll')
   if(panel&&table&&content){
    const style=popup!.getComputedStyle(panel),padding=parseFloat(style.paddingLeft)+parseFloat(style.paddingRight),border=parseFloat(style.borderLeftWidth)+parseFloat(style.borderRightWidth)
    baseWidth=Math.min(10000,Math.ceil(table.scrollWidth+padding+border))
    target.value!.style.width=`${Math.min(baseWidth,popup!.innerWidth)}px`
    content.style.setProperty('zoom',String(Math.min(1,Math.max(1,panel.clientWidth-padding)/Math.max(1,table.scrollWidth))))
    popup!.document.body.style.overflowX='hidden'
   }else if(target.value){target.value.style.width=`${baseWidth}px`;popup!.document.body.style.overflowX='auto'}
   if(panel)void request('host:floating-size',{width:baseWidth,height:Math.ceil(panel.getBoundingClientRect().height),scale:popup!.devicePixelRatio}).catch(()=>{})
  })})
 }
 const closeEvent=(e:Event)=>{if((e as CustomEvent).detail.key===key)onClose()}
 window.addEventListener('saaman-floating-close',closeEvent)
 function startDrag(e:PointerEvent){
  if(!target.value||e.button!==0||(e.target as HTMLElement).closest('button'))return false
  e.preventDefault();e.stopPropagation();pointer=e.pointerId
  try{(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)}catch{}
  void request('host:floating-start',{x:e.screenX,y:e.screenY}).catch(()=>{pointer=undefined})
  return true
 }
 watch(open,async(value)=>{
  const current=++generation
  if(!value){observer?.disconnect();if(fitFrame&&popup){popup.cancelAnimationFrame(fitFrame);fitFrame=0}target.value=null;void request('host:floating-hide').catch(()=>{});return}
  try{
   await nextTick()
   const preservePosition=!!target.value,origin=source.value,element=origin?.querySelector<HTMLElement>(selector)??target.value?.querySelector<HTMLElement>(selector),rect=element?.getBoundingClientRect()
   if(!origin||!element||!rect)return
   const table=element.querySelector<HTMLElement>('.information-table')
   const width=Math.max(180,table?Math.min(10000,Math.ceil(table.scrollWidth+12)):Math.min(1100,Math.ceil(rect.width))),height=Math.max(60,Math.min(850,Math.ceil(rect.height)))
   baseWidth=width
   const position={x:Math.round(rect.left),y:Math.round(rect.top),width,height,scale:window.devicePixelRatio,preservePosition}
   if(!popup||popup.closed){
    popup=window.open(`https://saaman.local/floating.html?key=${encodeURIComponent(key)}`,`saaman-${key}`)
    if(!popup)throw Error('Could not open the AMAN submenu window')
    initializedDocument=undefined
   }
   if(!initializedDocument){
    let root:HTMLElement|null=null
    for(let attempt=0;attempt<200;attempt++){
     if(generation!==current)return
     try{if(popup.location.pathname==='/floating.html')root=popup.document.getElementById('floating-root')}catch{}
     if(root)break
     await new Promise(resolve=>setTimeout(resolve,50))
    }
    if(!root)throw Error('The AMAN submenu window did not finish loading')
    for(const style of Array.from(document.querySelectorAll('link[rel=stylesheet],style')))popup.document.head.appendChild(style.cloneNode(true))
    const overrides=popup.document.createElement('style')
    overrides.textContent=`html,body{margin:0;width:100%;height:100%;overflow:auto;background:#859aa7}#floating-root{height:auto;min-height:0;display:block;overflow:visible;position:relative;padding:0;border:0;max-width:100%}.floating-content .popup,.floating-content .native-dialog{position:relative!important;left:0!important;top:0!important;margin:0!important;max-width:none!important;max-height:none!important;width:100%!important;box-shadow:none}.floating-content .dialog-shade{position:static!important;display:block!important;padding:0!important;background:none!important}.floating-content .dialog-title,.floating-content .menu-title{cursor:move;touch-action:none;user-select:none;background:#5e6165;color:#dce6f1}.floating-content .global-menu{min-width:180px}`
    popup.document.head.appendChild(overrides)
    root.className='juha-aman floating-content'
    for(const attribute of Array.from(origin.attributes))if(attribute.name.startsWith('data-v-'))root.setAttribute(attribute.name,attribute.value)
    popup.addEventListener('pointermove',move,true);popup.addEventListener('pointerup',end,true);popup.addEventListener('pointercancel',end,true);popup.addEventListener('resize',fit);popup.addEventListener('saaman-zoom',fit)
    initializedDocument=popup.document
   }
   if(generation!==current)return
   const root=popup.document.getElementById('floating-root')!
   if((window as any).__SAAMAN_HOST__?.test){const documents=(window as any).__SAAMAN_FLOATING_DOCUMENTS__??=new Map();documents.set(key,popup.document)}
   root.style.width=`${baseWidth}px`
   target.value=root
   await nextTick()
   if(generation!==current)return
   await request('host:floating-show',position)
   observer?.disconnect()
   observer=new ResizeObserver(fit)
   const panel=root.querySelector<HTMLElement>('.native-dialog,.popup');if(panel){observer.observe(panel);const table=panel.querySelector<HTMLElement>('.information-table');if(table)observer.observe(table)}
   fit()
  }catch(error){if(generation===current){target.value=null;onError(error as Error)}}
 },{flush:'post'})
 onUnmounted(()=>{generation++;observer?.disconnect();window.removeEventListener('saaman-floating-close',closeEvent);if(popup&&!popup.closed){popup.removeEventListener('pointermove',move,true);popup.removeEventListener('pointerup',end,true);popup.removeEventListener('pointercancel',end,true);popup.removeEventListener('resize',fit);popup.removeEventListener('saaman-zoom',fit);if(fitFrame)popup.cancelAnimationFrame(fitFrame)}void request('host:floating-hide').catch(()=>{})})
 return {target,startDrag}
}
