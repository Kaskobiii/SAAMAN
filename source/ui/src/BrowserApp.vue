<script setup lang="ts">
import {computed,markRaw,onBeforeUnmount,onMounted,reactive,ref,type Component} from 'vue'
import {BROWSER_DEFAULT_CONNECTION,browserConnection,loadBrowserConnection,saveBrowserConnection,type BrowserConnection} from './browser-session'
import {installBrowserTransport,type BrowserCoordination} from './browser-transport'
import {APPLICATION_BUILD} from './build'

function savedConnection(){try{return loadBrowserConnection(localStorage)}catch{return {...BROWSER_DEFAULT_CONNECTION}}}
const draft=reactive<BrowserConnection>(savedConnection()),connecting=ref(false),connected=ref(false),error=ref(''),reloadRequired=ref(false),advanced=ref(false)
const maestro=ref<Component|null>(null),connection=ref<BrowserConnection|null>(null),status=ref('Waiting for shared sequence'),sequencer=ref(''),live=ref(false)
const coordination=ref<BrowserCoordination>({message:null}),acknowledged=ref('')
const coordinationMessage=computed(()=>coordination.value.message?.id===acknowledged.value?'':coordination.value.message?.message??'')
function receiveCoordination(value:BrowserCoordination){
 if(value.message?.id!==coordination.value.message?.id)acknowledged.value=''
 if(value.status&&value.message?.id===acknowledged.value)acknowledged.value=''
 coordination.value=value
}
async function connect(){
 if(connecting.value||connected.value)return
 connecting.value=true;error.value=''
 let transportReady=false
 try{
  if(window.isSecureContext===false)throw Error('Open AMAN over HTTPS to use the browser editor')
  const settings=browserConnection(draft)
  await installBrowserTransport(settings,receiveCoordination)
  transportReady=true
  try{saveBrowserConnection(localStorage,settings)}catch{}
  connection.value=settings
  // Auth and AMAN capture host information at module/store creation. Import
  // them only after the selected browser connection has been installed.
  const module=await import('./components/flight/MaestroJuha.vue')
  maestro.value=markRaw(module.default);connected.value=true
 }catch(e:any){error.value=e.message||'Could not connect';reloadRequired.value=transportReady||e.reloadRequired===true}
 finally{connecting.value=false}
}
async function disconnect(){
 if(connected.value){
  const {leaveSharedRoom}=await import('./native-transport')
  try{await leaveSharedRoom()}catch{}
 }
 location.reload()
}
function relayChanged(event:Event){
 const data=(event as CustomEvent).detail??{},context=data.recordingContext
 live.value=data.stale!==true&&!!data.snapshot&&!data.relayError
 sequencer.value=context?.publisher??''
 status.value=data.relayError||(!data.snapshot?'Waiting for shared sequence':data.stale?'Stale data':'Editor')
}
function acknowledge(){
 const message=coordination.value.message
 if(!message||!coordination.value.enabled||coordination.value.busy)return
 acknowledged.value=message.id
 window.dispatchEvent(new CustomEvent('saaman-coordination-ack',{detail:{id:message.id}}))
}
function zulu(at:number){const date=new Date(at);return Number.isFinite(date.getTime())?date.toISOString().slice(11,16)+' UTC':''}
onMounted(()=>window.addEventListener('saaman-relay',relayChanged))
onBeforeUnmount(()=>window.removeEventListener('saaman-relay',relayChanged))
</script>

<template>
 <main class="browser-app">
  <header class="browser-header">
   <strong>SAAMAN</strong><span class="browser-build">{{APPLICATION_BUILD.replace('SAAMAN ','')}}</span>
   <template v-if="connected"><span class="browser-position">{{connection?.callsign}} · {{connection?.network==='live'?'VATSIM live':connection?.network==='sweatbox1'?'SweatBox 1':'SweatBox 2'}}</span><span class="browser-state" :class="{live}">{{live?'LIVE':status}}</span><span v-if="sequencer" class="browser-source">Sequencer {{sequencer}}</span><button class="browser-disconnect" @click="disconnect">Disconnect</button></template>
   <span v-else class="browser-header-label">Browser editor</span>
  </header>
  <section v-if="!connected" class="browser-connect-area">
   <form class="browser-connect" @submit.prevent="connect">
    <h1>Connect to AMAN</h1>
    <label>EuroScope callsign<input v-model="draft.callsign" name="callsign" placeholder="ESSA_FMP" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20" :disabled="connecting||reloadRequired" required></label>
    <label>Network<select v-model="draft.network" :disabled="connecting||reloadRequired"><option value="live">VATSIM live</option><option value="sweatbox1">SweatBox 1</option><option value="sweatbox2">SweatBox 2</option></select></label>
    <p>Use a callsign already connected in EuroScope. The browser follows the shared sequence and sends your changes to its sequencer.</p>
    <button type="button" class="browser-advanced-toggle" @click="advanced=!advanced" :aria-expanded="advanced">Backend {{advanced?'−':'+'}}</button>
    <label v-if="advanced">Server<input v-model="draft.backendBaseUrl" type="url" name="backend" autocomplete="url" :disabled="connecting||reloadRequired" required></label>
    <p v-if="error" class="browser-error" role="alert">{{error}}</p>
    <button v-if="reloadRequired" type="button" class="browser-connect-submit" @click="disconnect">Reload</button><button v-else type="submit" class="browser-connect-submit" :disabled="connecting">{{connecting?'Connecting…':'Connect'}}</button>
   </form>
  </section>
  <section v-else class="browser-sequence"><component :is="maestro" v-if="maestro"/></section>
  <div v-if="coordinationMessage" class="browser-coordination-shade">
   <section class="browser-coordination" role="dialog" aria-modal="true" aria-labelledby="browser-coordination-title">
    <h2 id="browser-coordination-title">Coordination</h2>
    <p class="browser-coordination-sender">{{coordination.message?.senderCallsign||'Controller'}} · {{zulu(coordination.message?.at??0)}}</p>
    <p class="browser-coordination-text">{{coordinationMessage}}</p>
    <p v-if="coordination.status" class="browser-error">{{coordination.status}}</p>
    <button @click="acknowledge" :disabled="!coordination.enabled||coordination.busy">Acknowledge</button>
   </section>
  </div>
 </main>
</template>

<style>
html,body,#app{margin:0;width:100%;height:100%;overscroll-behavior:none}
.browser-app{height:100%;height:100dvh;min-height:320px;background:#495055;color:#e7eef3;display:flex;flex-direction:column;overflow:hidden;font:14px Arial,sans-serif}
.browser-header{flex:none;min-height:38px;display:flex;align-items:center;gap:12px;padding:5px 12px;background:#5e6165;border-bottom:1px solid #939da5;box-sizing:border-box;flex-wrap:wrap}
.browser-header strong{letter-spacing:.06em}.browser-build{color:#c6d2da;font-size:11px}.browser-header-label{margin-left:auto;color:#c6d2da}.browser-position{font-size:12px}.browser-state{font-size:11px;color:#e2cc9d}.browser-state.live{color:#ff6868;font-weight:bold}.browser-source{font-size:11px;color:#c6d2da}
.browser-header button,.browser-connect button,.browser-coordination button{font:inherit;cursor:pointer;border:1px solid #b5c4cd;border-radius:5px;background:#899eac;color:#122630;padding:7px 12px}.browser-header .browser-disconnect{margin-left:auto;font-size:12px;padding:5px 10px}.browser-app button:disabled{opacity:.5;cursor:default}.browser-app :focus-visible{outline:2px solid #c3eaff;outline-offset:2px}
.browser-connect-area{flex:1;display:grid;place-items:center;overflow:auto;padding:24px 16px}.browser-connect{width:min(100%,360px);box-sizing:border-box;background:#859aa7;border:1px solid #afbdc6;border-radius:7px;padding:22px;color:#102630;box-shadow:0 5px 24px #17202933}.browser-connect h1{font-size:20px;margin:0 0 20px}.browser-connect label{display:flex;flex-direction:column;gap:6px;margin:15px 0;font-weight:bold}.browser-connect input,.browser-connect select{font:16px Arial,sans-serif;min-width:0;padding:9px;background:#b1c0ca;color:#102630;border:1px solid #657b8a;border-radius:3px;box-sizing:border-box}.browser-connect input[name=callsign]{text-transform:uppercase}.browser-connect p{font-size:13px;line-height:1.5;margin:16px 0}.browser-connect .browser-connect-submit{width:100%;font-weight:bold;background:#a6c8da;min-height:42px}.browser-connect .browser-advanced-toggle{padding:0;background:none;border:0;border-radius:0;font-size:12px;text-decoration:underline}.browser-error{color:#7a1212!important;background:#f1d7c8;padding:9px!important;border-radius:3px;line-height:1.4;font-size:13px!important}
.browser-sequence{flex:1;min-height:0;overflow:hidden}.browser-sequence>.juha-aman{height:100%;min-height:0}.browser-coordination-shade{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:16px;background:#15232b66}.browser-coordination{width:min(100%,450px);background:#859aa7;border:1px solid #c1cbd2;border-radius:5px;box-shadow:0 8px 35px #10202977;text-align:center;color:#142630;padding:0 16px 16px;box-sizing:border-box}.browser-coordination h2{font-size:13px;line-height:30px;background:#5e6165;color:#e7eef3;margin:0 -16px 12px;border-radius:4px 4px 0 0}.browser-coordination-sender{font-size:12px;color:#263e4a}.browser-coordination-text{font-size:18px;line-height:1.5;margin:24px 0}.browser-coordination button{min-width:140px;background:#a6c8da}
@media(max-width:650px){.browser-header{gap:6px 10px;padding:5px 8px}.browser-source{order:6;width:100%;padding-bottom:2px}.browser-position{font-size:11px}.browser-header .browser-disconnect{font-size:11px}.browser-connect-area{padding:14px}.browser-connect{padding:18px}}
</style>
