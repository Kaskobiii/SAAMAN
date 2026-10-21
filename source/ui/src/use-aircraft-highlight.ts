import {onMounted,onUnmounted,ref} from 'vue'
import {nativeRequest} from './native-rpc'
import {createAircraftHighlight} from './maestro-aircraft-highlight'

export function useAircraftHighlight(){
 const selectedCallsign=ref(''),hoveredCallsign=ref('')
 const highlight=createAircraftHighlight((method,data)=>nativeRequest(method,data,1500),value=>selectedCallsign.value=value,value=>hoveredCallsign.value=value)
 const selection=(event:Event)=>highlight.receiveSelection((event as CustomEvent).detail?.callsign)
 const hidden=()=>{if(document.hidden)highlight.clear()}
 let timer:ReturnType<typeof setInterval>|undefined
 onMounted(()=>{
  window.addEventListener('saaman-aircraft-selection',selection)
  window.addEventListener('saaman-aircraft-hover-reset',highlight.clear)
  window.addEventListener('blur',highlight.clear)
  window.addEventListener('pagehide',highlight.clear)
  document.addEventListener('visibilitychange',hidden)
  void highlight.loadSelection()
  timer=setInterval(highlight.refresh,750)
 })
 onUnmounted(()=>{
  clearInterval(timer)
  window.removeEventListener('saaman-aircraft-selection',selection)
  window.removeEventListener('saaman-aircraft-hover-reset',highlight.clear)
  window.removeEventListener('blur',highlight.clear)
  window.removeEventListener('pagehide',highlight.clear)
  document.removeEventListener('visibilitychange',hidden)
  highlight.dispose()
 })
 return {...highlight,selectedCallsign,hoveredCallsign}
}
