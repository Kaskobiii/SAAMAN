<script setup lang="ts">
import {onMounted,onUnmounted} from 'vue'
import Maestro from './components/flight/MaestroJuha.vue'
import Supervisor from './views/MaestroSupervisor.vue'
const info=(window as any).__SAAMAN_HOST__
import {nativeRequest} from './native-rpc'
let pointer:number|undefined
function startFrame(event:PointerEvent,resize=false){
 if(event.button!==0)return
 event.preventDefault();pointer=event.pointerId
 try{(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)}catch{}
 void nativeRequest('host:frame-start',{x:event.screenX,y:event.screenY,resize}).catch(()=>{pointer=undefined})
}
function moveFrame(event:PointerEvent){if(pointer===event.pointerId)void nativeRequest('host:frame-move',{x:event.screenX,y:event.screenY}).catch(()=>{})}
function endFrame(event:PointerEvent){if(pointer===event.pointerId){pointer=undefined;void nativeRequest('host:frame-end',{x:event.screenX,y:event.screenY}).catch(()=>{})}}
function close(){void nativeRequest('host:frame-close').catch(()=>{})}
onMounted(()=>{window.addEventListener('pointermove',moveFrame);window.addEventListener('pointerup',endFrame);window.addEventListener('pointercancel',endFrame)})
onUnmounted(()=>{window.removeEventListener('pointermove',moveFrame);window.removeEventListener('pointerup',endFrame);window.removeEventListener('pointercancel',endFrame)})
</script>
<template><div class="native-app"><header class="frame-title" @pointerdown="startFrame($event)"><span>{{info.view==='supervisor'?'SAAMAN SUPERVISION':'AMAN'}}</span><button class="frame-close" aria-label="Close pane" @pointerdown.stop @click="close"></button></header><div class="native-body"><Supervisor v-if="info.view==='supervisor'"/><Maestro v-else/></div><div class="frame-resize" aria-label="Resize pane" @pointerdown="startFrame($event,true)"></div></div></template>
<style scoped>
.native-app{height:100%;box-sizing:border-box;display:flex;flex-direction:column;position:relative;background:#495055;padding:0 7px 7px 2px;border:1px solid #939da5;overflow:hidden}
.frame-title{flex:none;height:17px;margin:0 -7px 1px -2px;background:#5e6165;color:#dce6f1;display:flex;align-items:center;justify-content:center;font:11px Arial,sans-serif;cursor:move;touch-action:none;user-select:none;position:relative}
.frame-close{position:absolute;right:6px;top:5px;width:7px;height:7px;border:0;padding:0;background:#c0c0c0;cursor:pointer}
.native-body{flex:1;min-height:0;overflow:hidden;position:relative}
.frame-resize{position:absolute;bottom:1px;right:1px;width:9px;height:9px;cursor:nwse-resize;touch-action:none;background:repeating-linear-gradient(135deg,transparent 0 2px,#a8b1ba 2px 3px)}
</style>
