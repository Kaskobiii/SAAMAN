<script setup lang="ts">
import {ref,watch,onUnmounted} from 'vue'
import axios from 'axios'
import {useAuthStore,backendBaseUrl,callsignMode} from '@/stores/auth'
import {configureRelayAuth} from '@/native-transport'
import {DEFAULT_CONFIG,type EngineConfig,type EngineSnapshot,type FlightEdit} from '@/maestro-engine'
import MaestroSupervision from '@/components/flight/MaestroSupervision.vue'
import MaestroSettings from '@/components/flight/MaestroSettings.vue'
const auth=useAuthStore()
configureRelayAuth(()=>({token:auth.token.access_token||'',cid:Number(auth.user?.cid)||null,callsign:auth.user?.callsign||'',supervisor:auth.isSupervisor,ready:auth.ready,headers:auth.requestHeaders,error:auth.loginError}))
const localPreview=(window as any).__SAAMAN_LOCAL__===true
const apiBase=localPreview?location.origin:backendBaseUrl
const authorized=ref(false),checked=ref(false),error=ref(''),busy=ref(false),polling=ref(false),now=ref(Date.now())
const snapshot=ref<EngineSnapshot|null>(null),config=ref<EngineConfig>(structuredClone(DEFAULT_CONFIG)),edits=ref<Record<string,FlightEdit>>({}),revision=ref(-1),masterCid=ref<number|null>(null)
const settings=ref<InstanceType<typeof MaestroSettings>>()
let relayEpoch=''
function headers(){return localPreview?{}:auth.requestHeaders}
function receive(data:any){if(data.epoch&&relayEpoch!==data.epoch){relayEpoch=data.epoch;revision.value=-1}if(data.revision<revision.value)return;config.value=data.config;edits.value=data.edits;snapshot.value=data.snapshot;revision.value=data.revision;masterCid.value=data.masterCid}
async function poll(){
    now.value=Date.now()
    if(polling.value||busy.value||(!localPreview&&!auth.ready))return
    polling.value=true
    const identity=JSON.stringify([auth.ready,auth.user?.cid,auth.user?.callsign,auth.requestHeaders])
    try{const data=(await axios.get(`${apiBase}/maestro/ESSA/supervision`,{headers:headers(),timeout:15000})).data;if(identity!==JSON.stringify([auth.ready,auth.user?.cid,auth.user?.callsign,auth.requestHeaders]))return;receive(data);authorized.value=true;checked.value=true;error.value=''}
    catch(e:any){const status=e.response?.status;if(status===401||status===403){authorized.value=false;snapshot.value=null;config.value=structuredClone(DEFAULT_CONFIG);edits.value={};revision.value=-1;checked.value=true}error.value=e.response?.data?.error||e.message||'Supervision unavailable'}
    finally{polling.value=false}
}
async function save(base:number,next:Record<string,unknown>){
    if(!authorized.value||busy.value)return
    busy.value=true
    try{receive((await axios.put(`${apiBase}/maestro/ESSA/settings`,{revision:base,settings:next},{headers:headers(),timeout:7000})).data);settings.value?.saved();error.value=''}
    catch(e:any){error.value=e.response?.data?.error||'Settings not saved'}
    finally{busy.value=false;void poll()}
}
watch(()=>JSON.stringify([auth.ready,auth.user?.cid,auth.user?.callsign,auth.requestHeaders]),()=>{authorized.value=false;checked.value=false;snapshot.value=null;void poll()},{immediate:true})
const timer=setInterval(()=>void poll(),3000),clock=setInterval(()=>now.value=Date.now(),1000)
function nativePulse(){void poll()}
window.addEventListener('saaman-pulse',nativePulse)
onUnmounted(()=>{window.removeEventListener('saaman-pulse',nativePulse);clearInterval(timer);clearInterval(clock)})
</script>
<template><main class="supervisor-page"><header><strong>ESSA · AMAN supervision</strong><span>Separate supervisory window</span><span v-if="localPreview">Local testing · this computer</span></header>
<template v-if="authorized"><MaestroSettings ref="settings" :config="config" :revision="revision" :busy="busy" @save="save"/><MaestroSupervision :snapshot="snapshot" :config="config" :edits="edits" :now="now" :revision="revision" :master-cid="masterCid" :error="error"/></template>
<section v-else class="access"><h2>{{checked?'Supervisor access required':'AMAN supervision'}}</h2><p>{{error||auth.loginError||'Checking controller identity…'}}</p><button v-if="!auth.ready&&!localPreview" @click="auth.login()">{{callsignMode?'Retry connection':'Connect'}}</button><button v-else @click="poll">Retry access check</button></section>
</main></template>
<style scoped>.supervisor-page{position:fixed;inset:0;overflow:auto;background:#495055;color:white}.supervisor-page>header{position:sticky;top:0;z-index:2;background:#293c48;display:flex;gap:24px;padding:14px;font:16px Arial,sans-serif;align-items:center;flex-wrap:wrap}.supervisor-page a{color:#cce8ff}.access{padding:24px;font:16px Arial,sans-serif}.access button{padding:8px;font:inherit}</style>
