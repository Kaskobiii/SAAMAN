<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import axios from 'axios'
import {APPLICATION_BUILD} from '@/build'
import MaestroInformation from './MaestroInformation.vue'
import {gainDragEdits,dragTargetTime,swapFlightEdits,insertRelative,maximumDelayEdits,manualTransferSeconds,instructionColor,zulu,COORDINATION_MESSAGES} from '@/maestro-operations'
import {nativeRequest} from '@/native-rpc'
import {useFloatingSurface} from '@/floating-surface'
import {runwaySelections} from '@/maestro-runway-sync'
import {configureRelayAuth,leaveSharedRoom,suspendSharedRoom} from '@/native-transport'
import {sharedSettings} from '@/maestro-settings'
import {feederCoverage,type ControllerPresence} from '@/maestro-feeder-coverage'
import {saveConnectionSettings} from '@/maestro-connection'
import {isTowerCallsign} from '@/callsign-identity'

import {STAR_PROFILES,STAR_SOURCE} from '@/maestro-star-prediction'
import { useAuthStore, backendBaseUrl } from '@/stores/auth'
import { DEFAULT_CONFIG, RUNWAYS, STATE_NAMES, STATE_COLORS, delayLabel, runEngine, toJuhaSequence, effectiveConfig, rateDistanceNm, validateLockedEdits, windConfig, reorderEdits, retimeEdits, dragChangesTime, euroscopeInstruction,
    reconcileRunwayAssignments, type EngineConfig, type EngineSnapshot, type EngineFlight, type FlightEdit, type Telemetry } from '@/maestro-engine'
const auth = useAuthStore()
const nativeInfo=(window as any).__SAAMAN_HOST__
const connectionDraft=reactive({shared:nativeInfo.shared!==false,authProvider:nativeInfo.authProvider||'vatiris-callsign',backendBaseUrl:nativeInfo.backendBaseUrl||'https://backend.vatiris.se',controllerKey:'',controllerCid:nativeInfo.controllerCid?String(nativeInfo.controllerCid):'',network:nativeInfo.relay?.network||'live',session:nativeInfo.relay?.session||'essa-test-01',channel:nativeInfo.relay?.channel||'saaman'})
const connectionSaving=ref(false)
async function saveConnection(){if(connectionSaving.value)return;connectionSaving.value=true;try{
    for(const value of [connectionDraft.session,connectionDraft.channel])if(!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(value))throw new Error('Use letters, numbers, hyphens or underscores for the exercise and room')
    const url=new URL(connectionDraft.backendBaseUrl.trim())
    if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))throw new Error('Use an HTTPS server address without a path, query or credentials')
    const backend=url.origin,key=connectionDraft.authProvider==='keys'?connectionDraft.controllerKey.trim():''
    const cid=connectionDraft.controllerCid.trim()?Number(connectionDraft.controllerCid):0
    if(!Number.isSafeInteger(cid)||(cid!==0&&(cid<1000||cid>9999999999)))throw new Error('Enter a valid VATSIM CID')
    if(connectionDraft.shared&&connectionDraft.authProvider==='keys'){
        const stored=backend===nativeInfo.backendBaseUrl&&nativeInfo.authProvider==='keys'?await nativeRequest('key:read'):{key:''}
        const candidate=key||stored.key
        if(!/^saaman_[A-Za-z0-9_-]{43}$/.test(candidate))throw new Error('Enter your controller key')
        await axios.get(backend+'/auth/me',{headers:{Authorization:`Bearer ${candidate}`},timeout:5000})
    }
    const next={shared:connectionDraft.shared,backendBaseUrl:backend,authProvider:connectionDraft.authProvider,controllerCid:cid,relay:{network:connectionDraft.network,session:connectionDraft.session,channel:connectionDraft.channel}}
    await saveConnectionSettings(nativeInfo,next,key,{persist:()=>nativeRequest('mode:set',{...next,controllerKey:key}),leave:leaveSharedRoom,reload:()=>location.reload()})
    connectionDraft.controllerKey='';dialog.value='';error.value=''
}catch(e:any){error.value=e.response?.data?.error||e.message}finally{connectionSaving.value=false}}
configureRelayAuth(()=>({token:auth.token.access_token||'',cid:Number(auth.user?.cid)||null,callsign:auth.user?.callsign||'',supervisor:auth.isSupervisor,ready:auth.ready,headers:auth.requestHeaders,error:auth.loginError,compactPublication:auth.user?.compactPublication===true,gzipPublication:auth.user?.gzipPublication===true}))
const applicationBuild=APPLICATION_BUILD
const engineMismatch=ref(false)
const localPreview = (window as any).__SAAMAN_LOCAL__ === true
const apiBase = localPreview ? location.origin : backendBaseUrl
const config = ref<EngineConfig>(structuredClone(DEFAULT_CONFIG))
const edits = ref<Record<string, FlightEdit>>({})
const sequence = ref<EngineSnapshot | null>(null)

const now = ref(Date.now())
const demo = ref(false)
const view = ref('Runway')
const revision = ref(-1)
const masterCid = ref<number | null>(null)
const sharedRole=ref('disconnected')
let relayEpoch=''
const busy = ref(false)
const polling = ref(false)
const error = ref('')
const menu = ref('')
const selected = ref('')
const placementSelection=ref('')
type PlacementPreview={kind:'insert'|'swap';callsign:string;other?:string;time:number;top:number;group:string;right:boolean}
const placementPreview=ref<PlacementPreview|null>(null)
const recomputeSelection=ref<string[]>([])
const selectionDrag=ref<{startX:number;startY:number;x:number;y:number;left:number;right:number;top:number;bottom:number;moved:boolean}|null>(null)
const selectionBox=computed(()=>{
    const a=selectionDrag.value,root=rootElement.value?.getBoundingClientRect();if(!a?.moved||!root)return null
    return {left:`${a.left-root.left}px`,top:`${Math.min(a.startY,a.y)-root.top}px`,width:`${a.right-a.left}px`,height:`${Math.abs(a.y-a.startY)}px`}
})
const arrivalProfileDraft=ref('')
const dialog = ref('')
const dialogPosition=ref<{x:number;y:number}|null>(null)
const dialogDrag=ref<{startX:number;startY:number;x:number;y:number;width:number;height:number}|null>(null)
const movableDialog=computed(()=>!!dialog.value)
const pointerPosition=reactive({x:20,y:80})
function rememberPointer(event:MouseEvent|PointerEvent){const root=rootElement.value?.getBoundingClientRect();if(root){pointerPosition.x=event.clientX-root.left;pointerPosition.y=event.clientY-root.top}}
function fitDialog(){if(dialogTarget.value)return;const root=rootElement.value?.getBoundingClientRect(),panel=rootElement.value?.querySelector<HTMLElement>('.native-dialog');if(!root||!panel||!dialogPosition.value)return;const rect=panel.getBoundingClientRect();dialogPosition.value={x:Math.max(4,Math.min(dialogPosition.value.x,root.width-rect.width-4)),y:Math.max(4,Math.min(dialogPosition.value.y,root.height-rect.height-4))}}
const popupDrag=ref<{startX:number;startY:number;x:number;y:number;width:number;height:number}|null>(null)
function startPopupDrag(event:PointerEvent){if(menuSurface.startDrag(event))return;if(event.button!==0||(event.target as HTMLElement).closest('button'))return;const panel=(event.currentTarget as HTMLElement).parentElement!,rect=panel.getBoundingClientRect();event.preventDefault();event.stopPropagation();try{(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)}catch{};popupDrag.value={startX:event.clientX,startY:event.clientY,x:popupPosition.x,y:popupPosition.y,width:rect.width,height:rect.height}}
const dialogStyle=computed(()=>movableDialog.value&&dialogPosition.value?{position:'absolute' as const,left:`${dialogPosition.value.x}px`,top:`${dialogPosition.value.y}px`}:{})
function startDialogDrag(event:PointerEvent){
    if(dialogSurface.startDrag(event))return
    if(!movableDialog.value||event.button!==0||(event.target as HTMLElement).closest('button'))return
    const panel=(event.currentTarget as HTMLElement).parentElement!,rect=panel.getBoundingClientRect(),root=rootElement.value!.getBoundingClientRect()
    event.preventDefault();event.stopPropagation()
    try{(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)}catch{ /* Synthetic pointers have no capture. */ }
    dialogPosition.value={x:rect.left-root.left,y:rect.top-root.top}
    dialogDrag.value={startX:event.clientX,startY:event.clientY,...dialogPosition.value,width:rect.width,height:rect.height}
}

// One minute is approximately one rendered callsign row. Resizing reveals
// more or fewer minutes rather than stretching the timeline scale.
const timelineMinutePixels = 23
const plotHeight = ref(470)
const visiblePastMinutes = 1.25
const visibleSpanMinutes = computed(()=>plotHeight.value/timelineMinutePixels)
const visibleFutureMinutes = computed(()=>visibleSpanMinutes.value-visiblePastMinutes)
const clockOffset = ref(0)
const scrollingTime=ref(false)
let scrollAnimationTimer:ReturnType<typeof setTimeout>
watch(clockOffset,()=>{scrollingTime.value=true;clearTimeout(scrollAnimationTimer);scrollAnimationTimer=setTimeout(()=>scrollingTime.value=false,300)},{flush:'sync'})
const timeScroll=ref<{startY:number;offset:number;minutesPerPixel:number}|null>(null)
const overviewFlights=computed(()=>visibleFlights.value.filter(f=>!f.lost&&groups.value.some(g=>g.id===groupOf(f))&&overviewPercent(displayedTime(f))>=0&&overviewPercent(displayedTime(f))<=100))
const overviewWindow=computed(()=>({top:`${overviewPercent(referenceTime.value+visibleFutureMinutes.value*60000)}%`,height:`${visibleSpanMinutes.value/242*100}%`}))
function overviewPercent(time:number){return (now.value+180*60000-time)/(242*60000)*100}
function startTimeScroll(event:PointerEvent){
    if(event.button!==0)return
    event.preventDefault()
    const element=event.currentTarget as HTMLElement,rect=element.getBoundingClientRect()
    if((event.target as HTMLElement).classList.contains('overview-window')===false){
        clockOffset.value=Math.max(-60,Math.min(120,Math.round(180-(event.clientY-rect.top)/rect.height*242-(visibleFutureMinutes.value-visiblePastMinutes)/2)))
    }
    try{element.setPointerCapture(event.pointerId)}catch{ /* Synthetic pointer events have no capture. */ }
    timeScroll.value={startY:event.clientY,offset:clockOffset.value,minutesPerPixel:242/Math.max(1,rect.height)}
}
function scrollTimeKey(event:KeyboardEvent){
    const offsets:Record<string,number>={ArrowUp:1,ArrowDown:-1,PageUp:60,PageDown:-60}
    if(event.key in offsets){event.preventDefault();clockOffset.value=Math.max(-60,Math.min(120,clockOffset.value+offsets[event.key]))}
    else if(event.key==='Home'){event.preventDefault();clockOffset.value=0}
    else if(event.key==='End'){event.preventDefault();clockOffset.value=120}
}
const displayElement = ref<HTMLElement>()
const rootElement = ref<HTMLElement>()
const floatingError=(e:Error)=>{error.value=e.message}
const dialogSurface=useFloatingSurface('dialog',dialog,rootElement,'.native-dialog',()=>dialog.value='',floatingError)
const menuSurface=useFloatingSurface('menu',computed(()=>menu.value==='maestro'?'':menu.value),rootElement,'.popup:not(.global-menu)',()=>menu.value='',floatingError)
const globalSurface=useFloatingSurface('global',computed(()=>menu.value==='maestro'?'maestro':''),rootElement,'.global-menu',()=>menu.value='',floatingError)
const dialogTarget=dialogSurface.target,menuTarget=menuSurface.target,globalTarget=globalSurface.target
const scrollElement = ref<HTMLElement>()
const plotWidth = ref(740)
const horizontalPosition = ref(0)
const horizontalByView=reactive<Record<string,number>>({Runway:0,ACC:0,FLOW:0})
let horizontalViewTransition=0
let changingView=false
const popupPosition = reactive({ x: 10, y: 80 })
const popupElement = ref<HTMLElement>()
const popupAnchor = reactive<{x:number;y:number;labelLeft:number|null}>({x:10,y:80,labelLeft:null})
const applyMinutes=ref(0)
const applyBaseTime=ref(Math.floor(Date.now()/60000)*60000)
const applyAt=computed(()=>applyBaseTime.value+applyMinutes.value*60000)
const draftRateSeconds=ref(115)
const draftApplyRate=ref(false)
const rateRunway=computed(()=>dialog.value==='configuration'?draftArrival.value:(effectiveConfig(config.value,applyMinutes.value>0?applyAt.value:now.value).active.find(r=>r.startsWith('ESSA/'))||'ESSA/19R'))
const nextConfiguration=computed(()=>config.value.pending&&config.value.pending.at>now.value?config.value.pending:null)
const nextRate=computed(()=>{
    const currentRunway=currentConfig.value.active.find(r=>r.startsWith('ESSA/'))||'ESSA/19R'
    for(const at of [config.value.pending?.at,config.value.pendingRate?.at].filter((t):t is number=>t!==undefined&&t>now.value).sort((a,b)=>a-b)){
        const planned=effectiveConfig(config.value,at),runway=planned.active.find(r=>r.startsWith('ESSA/'))||currentRunway
        if(runway!==currentRunway||planned.rates[runway]!==currentConfig.value.rates[currentRunway]||at===config.value.pendingRate?.at)return {at,runway,seconds:planned.rates[runway]}
    }
    return null
})
const changeMarkers=computed(()=>{
    const markers:{kind:string;at:number;runway:string;preview?:boolean}[]=[]
    if(dialog.value!=='configuration'&&config.value.pending&&config.value.pending.at>now.value)markers.push({kind:'configuration',at:config.value.pending.at,runway:config.value.pending.active.find(r=>r.startsWith('ESSA/'))||'ESSA/19R'})
    if(dialog.value!=='rates'&&config.value.pendingRate&&config.value.pendingRate.at>now.value)markers.push({kind:'rate',at:config.value.pendingRate.at,runway:effectiveConfig(config.value,config.value.pendingRate.at).active.find(r=>r.startsWith('ESSA/'))||'ESSA/19R'})
    if(['rates','configuration'].includes(dialog.value)&&applyMinutes.value>0)markers.push({kind:dialog.value==='rates'?'rate':'configuration',at:applyAt.value,runway:rateRunway.value,preview:true})
    return markers
})

let resizeObserver: ResizeObserver
const labels = computed(()=>config.value.displayPreferences?.labels??{ type: false, feeder: false, totalDelay: false, currentDelay: true, runway: false })
const columnWidth = computed(() => Math.max(450+2*((labels.value.feeder?60:0)+(labels.value.runway?40:0)+(labels.value.totalDelay?50:0)),plotWidth.value / Math.max(1,groups.value.length)))
const panels = computed(()=>config.value.displayPreferences?.panels??{ winds: false, rates: false, tracks: true })
const draft = ref<EngineConfig>(structuredClone(DEFAULT_CONFIG))
const draftArrival = computed({get:()=>draft.value.active.find(r=>r.startsWith('ESSA/'))||'ESSA/19R',set:(r:string)=>draft.value.active=[...draft.value.active.filter(a=>!a.startsWith('ESSA/')),r]})
const runwaySyncError=ref(''),runwaySyncBusy=ref(false)
async function syncEuroScope(){
 if(!editable.value||runwaySyncBusy.value)return
 runwaySyncBusy.value=true;runwaySyncError.value=''
 try{
  const selections=runwaySelections(await nativeRequest('telemetry:get'),Date.now())
  const next=clone(effectiveConfig(config.value,now.value));next.active=selections.active;next.departureRunway=selections.departureRunway;next.pending=undefined
  if(await commit(edits.value,next)){draft.value=clone(next);applyMinutes.value=0;dialog.value=''}else runwaySyncError.value=error.value
 }catch(e:any){runwaySyncError.value=e.message}finally{runwaySyncBusy.value=false}
}
const listSelection = ref<string[]>([])
const slotDraft = reactive({ id: '', runway: 'ESSA/19R', start: '', duration: 8,kind:'closure' as 'closure'|'gap' })
const flightSlots = reactive({ before: 0, after: 0 })
const insertCallsign = ref('')
const manualAircraft=ref('UNKN')
const manualWake=ref('?')
const manualFeeder=ref('NILUG')
const bridge = ref(false)
const bridgeStatus = ref('')
const drag = ref<{ callsign: string; startX: number; startY: number; time: number; labelStart:number; scale: number; moved: boolean; pointerY:number } | null>(null)
const settling = ref<{callsign:string;top:number}|null>(null)
const gapDrag=ref<{id:string;part:'begin'|'end'|'move';startY:number;scale:number;originalBegin:number;originalEnd:number;begin:number;end:number;moved:boolean}|null>(null)
const gapSettling=ref<{id:string;begin:number;end:number}|null>(null)
const displayedGaps=computed(()=>config.value.slots.map(s=>{
    const preview=gapDrag.value?.id===s.id?gapDrag.value:gapSettling.value?.id===s.id?gapSettling.value:null
    return preview?{...s,begin:preview.begin,end:preview.end}:s
}))
let suppressGapClick=false
let suppressClick = false
let timer: ReturnType<typeof setInterval>
let pollingTimer: ReturnType<typeof setInterval>
let demoEpoch = Date.now()
const isMaster = computed(() => demo.value || (localPreview && masterCid.value === 0) || masterCid.value === Number(auth.user?.cid))
const stale = computed(() => !sequence.value || now.value - sequence.value.timestamp > 30000)
const towerController=computed(()=>isTowerCallsign(auth.user?.callsign||localCoverage.value.own.callsign||''))
const editable = computed(() => !towerController.value&&(demo.value||localPreview?isMaster.value:auth.ready&&['sequencer','editor'].includes(sharedRole.value)) && !busy.value && !stale.value)
const all = computed(() => (sequence.value?.flights || []).filter(f=>f.arrival==='ESSA'))
const diagnosticFlights=computed(()=>all.value.filter(f=>f.state!==4&&(f.issue||f.dataWarnings?.length||f.trajectory?.feasible===false||f.maximumDelayExceeded)))
const sequenced = computed(() => all.value.filter(f => f.mode === 'sequenced' && !f.issue && !f.lost && f.state !== 4))
const current = computed(() => all.value.find(f => f.callsign === selected.value))
const unsequenced = computed(() => all.value.filter(f => f.mode === 'desequenced' || f.mode === 'missed').sort((a,b)=>(edits.value[a.callsign]?.changedAt||0)-(edits.value[b.callsign]?.changedAt||0)))
const currentConfig = computed(() => windConfig(effectiveConfig(config.value,now.value),'ESSA',sequence.value?.winds,now.value))
const entryPoints=['NILUG','ELTOK','VACRA','XILAN']
const displayRunways=computed(()=>[...new Set([...currentConfig.value.active,currentConfig.value.departureRunway,...(nextConfiguration.value?.active??[]),nextConfiguration.value?.departureRunway,
    ...all.value.filter(f=>f.runwayTransition?.pending&&f.mode==='sequenced'&&f.state!==4&&!f.issue&&!f.lost).map(f=>`${f.arrival}/${f.runway}`)].filter((r):r is string=>!!r))])
const changeRunwayAvailable=computed(()=>new Set(displayRunways.value).size>1||!!nextConfiguration.value)
const feederSelection=ref<string[]>(entryPoints.slice())
const localCoverage=ref<{own:ControllerPresence;controllers:ControllerPresence[]}>({own:{callsign:''},controllers:[]})
const coverage=computed(()=>feederCoverage(localCoverage.value.own,localCoverage.value.controllers))
const feederOptions=computed(()=>coverage.value.detected?coverage.value.feeders:entryPoints)
let coveragePolling=false
async function refreshCoverage(){
    if(coveragePolling||demo.value)return
    coveragePolling=true
    try{const raw=await nativeRequest('telemetry:get');localCoverage.value={own:{callsign:raw.source||'',positionId:raw.controllerPositionId||''},controllers:Array.isArray(raw.controllers)?raw.controllers:[]}}
    catch{localCoverage.value={own:{callsign:''},controllers:[]}}
    finally{coveragePolling=false}
}
watch(()=>JSON.stringify([coverage.value.view,coverage.value.feeders]),()=>{
    feederSelection.value=[...feederOptions.value]
    if(coverage.value.view===null&&view.value==='ACC')void changeView('Runway')
    void nextTick(()=>{horizontalPosition.value=Math.min(horizontalPosition.value,horizontalMax.value);scrollHorizontal()})
},{immediate:true})
const etaFfDraft=ref('')
const maximumDelayDraft=ref<number|undefined>(undefined)
const relativeOperation=ref<'arrival'|'closure'|'gap'>('arrival')
const overshootFlights=computed(()=>all.value.filter(f=>f.mode!=='removed'&&(f.mode==='missed'||f.state===4&&(now.value-f.sta)<=300000)))
const plannedFlights=computed(()=>(sequence.value?.knownFlights??[]).filter(f=>!all.value.some(p=>p.callsign===f.callsign&&p.mode!=='removed')))
function chooseManualFlight(callsign:string){insertCallsign.value=callsign;const f=all.value.find(f=>f.callsign===callsign)??sequence.value?.knownFlights?.find(f=>f.callsign===callsign);if(f){manualAircraft.value=f.aircraft||'UNKN';manualWake.value=f.wake||'?';if('ff' in f&&typeof f.ff==='string')manualFeeder.value=f.ff;}}
const relativeSide=ref<'before'|'after'>('after')
const relativeAnchor=ref('')
const arrivalOptions=computed(()=>{const visible=all.value.filter(f=>f.state!==4&&!f.lost&&!f.issue&&f.callsign!==relativeAnchor.value);return [...visible,...(sequence.value?.knownFlights??[]).filter(f=>f.callsign!==relativeAnchor.value&&!all.value.some(p=>p.callsign===f.callsign))]})
const operatorId=String(nativeInfo.instanceId||auth.user?.cid||'local')
const coordinationBaseline=ref<Set<string>|null>(null)
const canCoordinate=computed(()=>!towerController.value&&!localPreview&&!demo.value&&auth.ready&&!busy.value&&!stale.value&&sharedRole.value!=='disconnected')
const pendingCoordination=computed(()=>towerController.value?undefined:config.value.coordinations?.find(m=>m.sender!==operatorId&&!coordinationBaseline.value?.has(m.id)&&!m.acknowledgedBy.includes(operatorId)))
const coordinationError=ref('')
const coordinationAcknowledging=ref(false)
// Only the existing AMAN worker owns the relay. The separate native popup
// forwards acknowledgements here rather than opening another room connection.
watch(()=>JSON.stringify({message:pendingCoordination.value??null,enabled:canCoordinate.value,busy:coordinationAcknowledging.value,status:coordinationError.value||(busy.value&&!coordinationAcknowledging.value?'Another change is being saved.':'')}),payload=>{
    if(!localPreview)void nativeRequest('host:coordination',JSON.parse(payload)).catch(e=>{error.value=e.message})
},{immediate:true})
watch(()=>pendingCoordination.value?.id,()=>{coordinationError.value=''})
function nativeCoordinationAck(event:Event){
    const id=(event as CustomEvent).detail?.id
    if(id===pendingCoordination.value?.id&&canCoordinate.value)void acknowledgeCoordination()
}
function closeCoordinationPopup(){if(!localPreview)void nativeRequest('host:coordination',{message:null}).catch(()=>{})}

const visibleFlights = computed(() => all.value.filter(f=>!f.issue&&!f.lost&&f.mode==='sequenced'&&(view.value!=='Runway'||displayRunways.value.includes(rwy(f)))&&(view.value!=='ACC'||feederSelection.value.includes(f.ff))))
function labelY(f:EngineFlight){
    const anchor=y(displayedTime(f));let position=anchor
    if(view.value==='Runway')for(const slot of displayedGaps.value.filter(s=>s.runway===rwy(f))){
        const top=y(slot.end),bottom=y(slot.begin),clearance=timelineMinutePixels/2+4
        if(anchor<=top&&anchor+clearance>=top)position=Math.min(position,top-clearance)
        else if(anchor>=bottom&&anchor-clearance<=bottom)position=Math.max(position,bottom+clearance)
    }
    return position
}
const referenceTime = computed(() => now.value + clockOffset.value * 60000)
const groups = computed<{id:string;name:string;runways:string[];fixes:string[]}[]>(() => view.value === 'Runway' ? [
    {id:'19',name:'19L / 19R',runways:['ESSA/19L','ESSA/19R'],fixes:[]},
    {id:'08-26',name:'26 / 08',runways:['ESSA/26','ESSA/08'],fixes:[]},
    {id:'01',name:'01L / 01R',runways:['ESSA/01L','ESSA/01R'],fixes:[]},
].filter(g=>g.runways.some(r=>displayRunways.value.includes(r))) : view.value === 'ACC' ? [
    {id:'NILUG-XILAN',name:'NILUG / XILAN',runways:[],fixes:['NILUG','XILAN']},
    {id:'ELTOK-VACRA',name:'ELTOK / VACRA',runways:[],fixes:['ELTOK','VACRA']},
].filter(g=>g.fixes.some(ff=>feederSelection.value.includes(ff))) : entryPoints.map(f=>({id:f,name:f,runways:[] as string[],fixes:[f]})))
const ticks = computed(()=>Array.from({length:Math.ceil(visibleSpanMinutes.value)+7},(_,i)=>i-Math.ceil(visiblePastMinutes)-2))
const pixelsPerMinute = computed(()=>timelineMinutePixels)
const nowBaseline = computed(()=>pixelsPerMinute.value * visibleFutureMinutes.value)
const horizontalMax = computed(()=>Math.max(0,groups.value.length*columnWidth.value-plotWidth.value))
const clone = <T,>(value:T):T => JSON.parse(JSON.stringify(value))
function rwy(f: EngineFlight) { return `${f.arrival}/${f.runway}` }
function groupOf(f: EngineFlight) { return view.value === 'Runway' ? groups.value.find(g=>g.runways.includes(rwy(f)))?.id : groups.value.find(g=>g.fixes.includes(f.ff))?.id || 'OTHER' }
function rightSide(f:EngineFlight) { const group=groups.value.find(g=>g.id===groupOf(f));return view.value==='Runway' ? group?.runways[1]===rwy(f) : view.value==='ACC' && group?.fixes[1]===f.ff }
function displayedTime(f: EngineFlight) { return f.state===4?f.sta:view.value === 'Runway' ? f.sta : f.staFf }
function movable(f:EngineFlight) { return editable.value && !f.lost && !f.issue && f.mode==='sequenced' && f.state!==4 }
function locked(f:EngineFlight) { return f.state===2 || f.state===3 }
function y(time: number) { return nowBaseline.value - (time - referenceTime.value) / 60000 * pixelsPerMinute.value }
function timeAt(element:HTMLElement,clientY:number) { return referenceTime.value+(nowBaseline.value-(clientY-element.getBoundingClientRect().top))/pixelsPerMinute.value*60000 }
function fitPopup(){
    if(menuTarget.value)return
    const root=rootElement.value?.getBoundingClientRect(),popup=popupElement.value;if(!root||!popup)return
    popup.style.maxHeight=`${Math.max(1,root.height-8)}px`
    popup.style.maxWidth=`${Math.max(1,root.width-8)}px`
    const bounds=popup.getBoundingClientRect()
    let x=popupAnchor.x
    if(x+bounds.width>root.width-4&&popupAnchor.labelLeft!==null)x=popupAnchor.labelLeft-bounds.width-5
    popupPosition.x=Math.max(4,Math.min(x,root.width-bounds.width-4))
    popupPosition.y=Math.max(4,Math.min(popupAnchor.y,root.height-bounds.height-4))
}
function positionPopup(event:MouseEvent|PointerEvent,atPointer=false) {
    const root=rootElement.value?.getBoundingClientRect();if(!root)return
    const target=atPointer?null:(event.currentTarget as HTMLElement).getBoundingClientRect()
    popupAnchor.x=target?target.right-root.left+5:event.clientX-root.left+4
    popupAnchor.y=event.clientY-root.top
    popupAnchor.labelLeft=target?target.left-root.left:null
    popupPosition.x=popupAnchor.x;popupPosition.y=popupAnchor.y
    void nextTick(fitPopup)
}
watch([menu,()=>current.value?.state],()=>{void nextTick(fitPopup)})

function scrollHorizontal() {
    if(scrollElement.value)scrollElement.value.scrollLeft=horizontalPosition.value
    if(!changingView)horizontalByView[view.value]=horizontalPosition.value
}
function syncHorizontal() {
    if(changingView)return
    horizontalPosition.value=scrollElement.value?.scrollLeft || 0
    horizontalByView[view.value]=horizontalPosition.value
}
async function changeView(next:string){
    menu.value=''
    if(next===view.value)return
    horizontalByView[view.value]=horizontalPosition.value
    const transition=++horizontalViewTransition;changingView=true;view.value=next
    await nextTick();if(transition!==horizontalViewTransition)return
    horizontalPosition.value=Math.max(0,Math.min(horizontalMax.value,horizontalByView[next]||0))
    scrollHorizontal()
    requestAnimationFrame(()=>{if(transition===horizontalViewTransition){changingView=false;syncHorizontal()}})
}
function utc(time: number, seconds = false) { return new Date(time).toISOString().slice(11, seconds ? 19 : 16) }
function minutes(time: number) { return new Date(time).getUTCMinutes().toString().padStart(2, '0') }
function delayColor(seconds:number){return instructionColor(seconds)}
function stateColor(f: EngineFlight) { return f.lost ? '#606060' : STATE_COLORS[f.state] }
function flightTooltip(f:EngineFlight){
    const target=edits.value[f.callsign]?.target
    return `${f.callsign} · ${STATE_NAMES[f.state]} · Live ETA ${utc(f.eta)} · Assigned ${f.state===0?'not stable':utc(f.sta)} · ${f.delay<0?'TTG':'TTL'} ${Math.abs(f.delay)}s`+
        (target!==undefined?` · Explicit time ${utc(target,true)} UTC; Recompute releases it`:'')+
        (f.state<4?' · Drag to gain time; restore up to the original allocation. Use Insert arrival for explicit before/after sequencing.':'')
}
function measuredRate(runway:string) {
    const landed=(sequence.value?.landings||[]).filter(l=>l.runway===runway&&now.value-l.time<=1800000).sort((a,b)=>a.time-b.time)
    return landed.length<2?null:Math.round((landed[landed.length-1].time-landed[0].time)/(landed.length-1)/1000)
}
function demoInput(timestamp: number): Telemetry {
    const elapsed = (timestamp - demoEpoch) / 1000
    const demoRunway=(effectiveConfig(config.value,timestamp).active.find(r=>r.startsWith('ESSA/'))||'ESSA/19R').split('/')[1]
    const sample = [
        ['SAS1015','A320','M',7,'ELTOK'], ['SAS205','A20N','M',9,'NILUG'],
        ['FIN6X','E190','M',20,'XILAN'], ['DLH2JT','A321','M',21.5,'ELTOK'],
        ['SAS904','A333','H',16,'NILUG'], ['NAX431','B738','M',21,'XILAN'],
        ['BAW778','A320','M',28,'ELTOK'], ['RYR8KV','B738','M',55,'NILUG'],
        ['SASLAN','A320','M',-1,'ELTOK'],
    ]
    return { source: 'DEMO', timestamp, flights: sample.map(([callsign, aircraft, wake, arrival, feeder]) => ({
        callsign: String(callsign), aircraft: String(aircraft), wake: String(wake), runway: demoRunway,
        departure: 'EKCH', arrival: 'ESSA', landingSeconds: Number(arrival) * 60 - elapsed,
        route: [{ name: String(feeder), seconds: Number(arrival) * 60 - 600 - elapsed }],
        distanceNm: Math.max(.1, Number(arrival) * 3 - elapsed / 20), groundspeed: Number(arrival)*60-elapsed<0?0:180, altitude: Number(arrival)*60-elapsed<0?100:7000,
    })) }
}
function refreshDemo(force = false) {
    const old = force && sequence.value ? { ...sequence.value, timestamp: now.value - 1 } : sequence.value || undefined
    sequence.value = runEngine(demoInput(now.value), config.value, edits.value, old)
}
function headers() { return localPreview ? {} : auth.requestHeaders }
function receive(data: any) {
    if(data.epoch&&relayEpoch!==data.epoch){relayEpoch=data.epoch;revision.value=-1;coordinationBaseline.value=null}
    if (data.revision < revision.value) return
    revision.value = data.revision; config.value = data.config; edits.value = data.edits
    if(coordinationBaseline.value===null)coordinationBaseline.value=new Set((data.config?.coordinations??[]).map((m:any)=>m.id))
    sequence.value = data.snapshot; masterCid.value = data.masterCid
    if(data.relayRole)sharedRole.value=data.relayRole
}
async function poll() {
    now.value = Date.now()
    if(engineMismatch.value&&!demo.value)return
    if(timeScroll.value||drag.value||settling.value||gapDrag.value||gapSettling.value||selectionDrag.value)return
    if (demo.value) { refreshDemo(); return }
    if (busy.value || polling.value || (!localPreview && !auth.ready)) return
    polling.value = true
    try {
        if (localPreview&&isMaster.value) {
            const local = await fetch('http://127.0.0.1:17777/telemetry', { signal: AbortSignal.timeout(2000) })
            const telemetry = await local.json()
            if (!local.ok) throw new Error(telemetry.error||'No fresh EuroScope data is available from SAAMAN yet.')
            if(!localPreview){
                const reconciled=reconcileRunwayAssignments(telemetry,edits.value,sequence.value)
                if(JSON.stringify(reconciled)!==JSON.stringify(edits.value)){await commit(reconciled);if(JSON.stringify(reconciled)!==JSON.stringify(edits.value))throw new Error('Could not apply the EuroScope runway assignment yet')}
            }
            receive((await axios.post(`${apiBase}/maestro/ESSA/telemetry`, telemetry, { headers: headers(), timeout: 7000 })).data)
        } else receive((await axios.get(`${apiBase}/maestro/ESSA`, { headers: headers(), timeout: 7000 })).data)
        error.value = ''
    } catch (e: any) { error.value = e.response?.data?.error || e.message || 'Shared AMAN unavailable' }
    finally { polling.value = false }
    if (bridge.value) await publishTiming()
}
async function commit(nextEdits = edits.value, nextConfig = config.value) {
    nextConfig={...nextConfig,...sharedSettings(config.value)}
    if (!editable.value) { error.value='Join as an editor to change a fresh sequence'; return false }
    try { validateLockedEdits(sequence.value,edits.value,nextEdits,nextConfig) } catch(e:any) {error.value=e.message;return false}
    if (demo.value) { edits.value = clone(nextEdits); config.value = clone(nextConfig); refreshDemo(true); error.value='';return true }
    busy.value = true
    try {
        receive((await axios.put(`${apiBase}/maestro/ESSA`, { revision: revision.value, config: nextConfig, edits: nextEdits },
            { headers: headers(), timeout: 7000 })).data)
        error.value = ''
        if(bridge.value)await publishTiming()
        return true
    } catch (e: any) { error.value = e.response?.data?.error || 'Change not saved';return false }
    finally { busy.value = false }
}
async function chooseMode(mode: string) {
    menu.value = ''
    if (mode === 'DEMO') {
        suspendSharedRoom(true)
        demo.value = true; engineMismatch.value=false;demoEpoch = Date.now(); now.value = demoEpoch
        error.value=''
        edits.value = {}; config.value = structuredClone(DEFAULT_CONFIG)
        const seed = runEngine(demoInput(demoEpoch - 120000), config.value, {})
        sequence.value = runEngine(demoInput(demoEpoch), config.value, {}, seed)
        dialog.value = ''; return
    }
    if (!localPreview && !auth.ready) { try{await auth.login();if(!auth.ready)error.value=auth.loginError}catch(e:any){error.value=e.response?.data?.error||e.message} if(!auth.ready)return }
    suspendSharedRoom(false)
    demo.value = false; revision.value = -1
    try {
        if(localPreview){
            const response=await fetch(`${apiBase}/aman-preview-health`,{signal:AbortSignal.timeout(2000)})
            const health=await response.json()
            if(!response.ok||health.applicationBuild!==applicationBuild){engineMismatch.value=true;masterCid.value=null;bridge.value=false;throw new Error('An older AMAN engine is running. Reload SAAMAN.dll and reopen the AMAN window.')}
            engineMismatch.value=false
        }
        if (mode === 'MASTER') receive((await axios.post(`${apiBase}/maestro/ESSA/master`, {}, { headers: headers() })).data)
        else {
            if (isMaster.value) await axios.post(`${apiBase}/maestro/ESSA/master`, { release: true }, { headers: headers() })
            masterCid.value = null
        }
        bridge.value = true; dialog.value = ''; await poll()
    } catch (e: any) { error.value = e.response?.data?.error || (engineMismatch.value?e.message:'Could not change operation mode') }
}
function relayChanged(event:Event){
    const data=(event as CustomEvent).detail
    if(data.relayError){sequence.value=null;error.value=data.relayError;return}
    if(!demo.value&&!drag.value&&!gapDrag.value&&!settling.value&&!gapSettling.value){receive(data);if(bridge.value)void publishTiming()}
}
function openDialog(name: string) {
    runwaySyncError.value=''
    menu.value = ''; draft.value = clone(currentConfig.value); dialog.value = name;dialogPosition.value={...pointerPosition};dialogDrag.value=null;void nextTick(fitDialog)
    applyMinutes.value=0;applyBaseTime.value=Math.floor(now.value/60000)*60000
    const pending=name==='configuration'?nextConfiguration.value:name==='rates'&&config.value.pendingRate&&config.value.pendingRate.at>now.value?config.value.pendingRate:null
    if(name==='configuration'&&nextConfiguration.value){draft.value.active=[...nextConfiguration.value.active];draft.value.departureRunway=nextConfiguration.value.departureRunway;draft.value.rates={...draft.value.rates,...nextConfiguration.value.rates}}
    if(pending)applyMinutes.value=Math.max(0,Math.min(60,Math.round((pending.at-applyBaseTime.value)/60000)))
    draftApplyRate.value=name==='configuration'&&!!nextConfiguration.value&&nextConfiguration.value.applyRate!==false
    draftRateSeconds.value=name==='rates'&&config.value.pendingRate&&config.value.pendingRate.at>now.value?config.value.pendingRate.seconds:draft.value.rates[draftArrival.value]
    if(name==='rates'||name==='configuration'){clockOffset.value=0;focusArrivalColumn(rateRunway.value)}
    if(name==='arrival-profile')arrivalProfileDraft.value=edits.value[selected.value]?.arrivalProfile??''
    if (name === 'flight-slots' && current.value) {
        flightSlots.before = current.value.slotBefore; flightSlots.after = current.value.slotAfter
    }
}
function focusArrivalColumn(runway:string){
    void changeView('Runway').then(()=>{
        const index=groups.value.findIndex(g=>g.runways.includes(runway))
        horizontalPosition.value=Math.max(0,Math.min(horizontalMax.value,index*columnWidth.value-(plotWidth.value-columnWidth.value)/2))
        horizontalByView.Runway=horizontalPosition.value
        void nextTick(scrollHorizontal)
    })
}

watch(draftArrival,r=>{if(dialog.value==='configuration'){draftRateSeconds.value=draft.value.rates[r];draftApplyRate.value=false;focusArrivalColumn(r)}},{flush:'sync'})
watch(rateRunway,r=>{if(dialog.value==='rates')focusArrivalColumn(r)})
function editFlight(patch: FlightEdit) {
    if (!current.value) return
    const callsign = current.value.callsign
    if(patch.runway!==undefined)patch={...patch,runwayAssignment:current.value.euroscopeRunway??''}
    void commit({ ...edits.value, [callsign]: { ...edits.value[callsign], ...patch, changedAt: now.value } })
    menu.value = ''
}
function samePlacementLane(a:EngineFlight,b:EngineFlight){return movable(a)&&movable(b)&&a.callsign!==b.callsign&&rwy(a)===rwy(b)&&groupOf(a)===groupOf(b)&&(view.value==='Runway'||a.ff===b.ff)}
function selectFlight(f:EngineFlight){
    if(suppressClick){suppressClick=false;return}
    const source=all.value.find(p=>p.callsign===placementSelection.value)
    if(source&&samePlacementLane(source,f)){
        void applyPlacement({kind:'swap',callsign:source.callsign,other:f.callsign,time:f.sta,top:labelY(f),group:groupOf(f)!,right:rightSide(f)});return
    }
    selected.value=f.callsign;menu.value='';placementPreview.value=null
    placementSelection.value=placementSelection.value===f.callsign||!movable(f)?'':f.callsign
}
function updatePlacement(event:PointerEvent|MouseEvent){
    placementPreview.value=null
    if(!editable.value||menu.value||dialog.value)return
    const callsign=drag.value?.moved?drag.value.callsign:placementSelection.value
    const source=all.value.find(f=>f.callsign===callsign)
    if(!source||!movable(source)||drag.value&&!drag.value.moved)return
    const under=document.elementsFromPoint(event.clientX,event.clientY).filter(el=>rootElement.value?.contains(el))
    if(!drag.value&&under.some(el=>(el as HTMLElement).closest<HTMLElement>('.flight')?.dataset.callsign===callsign))return
    const area=under.map(el=>el.closest<HTMLElement>('.time-area')).find(Boolean)
    const group=area?.closest<HTMLElement>('.timeline-column')?.dataset.column
    if(!area||!group||group!==groupOf(source))return
    const hit=under.map(el=>el.closest<HTMLElement>('.flight')).find(el=>el&&el.dataset.callsign!==callsign)
    if(hit){
        const other=all.value.find(f=>f.callsign===hit.dataset.callsign)
        if(other&&samePlacementLane(source,other))placementPreview.value={kind:'swap',callsign,other:other.callsign,time:displayedTime(other),top:labelY(other),group,right:rightSide(other)}
        return
    }
    if(under.some(el=>el.closest('.closure-gap')))return
    const pointerTop=event.clientY-area.getBoundingClientRect().top
    if(pointerTop<0||pointerTop>nowBaseline.value)return
    const requested=drag.value?drag.value.time-(event.clientY-drag.value.startY)/drag.value.scale*60000:timeAt(area,event.clientY)
    const target=dragTargetTime(sequence.value!,callsign,requested,view.value,config.value)
    const time=view.value==='Runway'?target:source.staFf+target-source.sta
    if(view.value==='Runway'&&displayedGaps.value.some(slot=>slot.runway===rwy(source)&&time>=slot.begin&&time<slot.end))return
    const top=y(time);if(top<0||top>nowBaseline.value)return
    placementPreview.value={kind:'insert',callsign,time,top,group,right:rightSide(source)}
}
async function applyPlacement(preview:PlacementPreview){
    if(!sequence.value||!editable.value)return
    const source=all.value.find(f=>f.callsign===preview.callsign);if(!source||!movable(source))return
    placementSelection.value='';placementPreview.value=null;selected.value=source.callsign
    try{
        const next=preview.kind==='swap'?swapFlightEdits(sequence.value,edits.value,source.callsign,preview.other!,view.value):gainDragEdits(sequence.value,edits.value,source.callsign,preview.time,view.value,config.value)
        if(preview.kind==='insert')settling.value={callsign:source.callsign,top:preview.top}
        await commit(next)
    }catch(e:any){error.value=e.message}finally{settling.value=null}
}
function placeOnTimeline(event:MouseEvent){
    if(suppressClick||!placementSelection.value||(event.target as HTMLElement).closest('button,input,.closure-gap'))return
    updatePlacement(event);if(placementPreview.value)void applyPlacement(placementPreview.value)
}
function cancelPlacement(event:KeyboardEvent){if(event.key==='Escape'){drag.value=null;placementSelection.value='';placementPreview.value=null;selected.value=''}}
watch(view,()=>{placementSelection.value='';placementPreview.value=null})
watch([menu,dialog],([m,d])=>{if(m||d){placementSelection.value='';placementPreview.value=null}})
watch(editable,allowed=>{if(!allowed)placementPreview.value=null})
function flightClick(f: EngineFlight,event:MouseEvent) {
    if(suppressClick){suppressClick=false;return}
    placementSelection.value='';placementPreview.value=null
    selected.value = f.callsign;positionPopup(event); menu.value = 'flight'
}
function leaveDialogMenu(){}
function closeFieldMenu(){menu.value='';recomputeSelection.value=[]}
function startSelection(event:PointerEvent){
    if(event.button!==0||!editable.value||(event.target as HTMLElement).closest('button,input,.closure-gap,.popup'))return
    if(placementSelection.value&&!event.shiftKey)return
    event.preventDefault();closeFieldMenu();selected.value='';placementSelection.value='';placementPreview.value=null;error.value=''
    try{(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)}catch{ /* Synthetic events have no capture. */ }
    const strip=event.currentTarget as HTMLElement,timeline=strip.getBoundingClientRect(),viewport=strip.parentElement!.getBoundingClientRect(),plot=strip.querySelector<HTMLElement>('.time-area')?.getBoundingClientRect()
    if(!plot||event.clientY<plot.top||event.clientY>plot.bottom)return
    const width=columnWidth.value,total=groups.value.length*width,lane=Math.floor((event.clientX-timeline.left-width/2)/width)
    const left=Math.max(viewport.left,timeline.left+Math.max(0,width/2+lane*width)),right=Math.min(viewport.right,timeline.left+Math.min(total,width/2+(lane+1)*width))
    if(left>=right)return
    const x=Math.max(left,Math.min(right,event.clientX)),y=Math.max(plot.top,Math.min(plot.bottom,event.clientY))
    selectionDrag.value={startX:x,startY:y,x,y,left,right,top:plot.top,bottom:plot.bottom,moved:false}
}
function updateSelection(event:PointerEvent){
    const area=selectionDrag.value;if(!area)return
    area.x=Math.max(area.left,Math.min(area.right,event.clientX));area.y=Math.max(area.top,Math.min(area.bottom,event.clientY))
    if(Math.hypot(area.x-area.startX,area.y-area.startY)>4)area.moved=true
    if(!area.moved)return
    const left=area.left,right=area.right,top=Math.min(area.startY,area.y),bottom=Math.max(area.startY,area.y)
    recomputeSelection.value=Array.from(rootElement.value?.querySelectorAll<HTMLElement>('.flight[data-callsign]')||[]).filter(el=>{
        const rect=el.getBoundingClientRect(),f=all.value.find(f=>f.callsign===el.dataset.callsign)
        return f&&!f.lost&&rect.right>=left&&rect.left<=right&&rect.bottom>=top&&rect.top<=bottom
    }).map(el=>el.dataset.callsign!)
}
function finishSelection(event:PointerEvent){
    updateSelection(event)
    const moved=selectionDrag.value?.moved;selectionDrag.value=null
    if(!moved||!recomputeSelection.value.length){closeFieldMenu();return}
    positionPopup(event,true)
    menu.value='recompute'
}
async function recomputeFlights(callsigns:string[]){
    if(!editable.value)return
    const changes=clone(edits.value)
    for(const callsign of callsigns){
        if(!all.value.some(f=>f.callsign===callsign&&!f.lost))continue
        const stamp=Math.max(now.value,(sequence.value?.timestamp||0)+1,(changes[callsign]?.recomputeAt||0)+1)
        changes[callsign]={...changes[callsign],mode:'sequenced',recomputeAt:stamp,changedAt:stamp,order:all.value.find(f=>f.callsign===callsign)?.state===3?all.value.find(f=>f.callsign===callsign)!.order:undefined,target:undefined,swapAt:undefined,requeueAt:undefined,landedAt:undefined,closurePosition:undefined,etaFfOverride:undefined}
    }
    closeFieldMenu();await commit(changes)
}
function startDrag(f: EngineFlight,event:PointerEvent) {
    if(event.button!==0)return
    if(placementSelection.value&&placementSelection.value!==f.callsign)return
    if(!editable.value)return
    if(!movable(f)){
        error.value=busy.value?'Waiting for the previous change to finish':stale.value?'Waiting for fresh aircraft data':
            !localPreview&&!demo.value&&!['sequencer','editor'].includes(sharedRole.value)?'Join the shared room as an editor to change the sequence':
            localPreview&&!isMaster.value?'Select Live · EuroScope to change the sequence':f.state===4?'This aircraft is marked landed; restore it through Manual add flight → Overshoot':
            f.lost?'Waiting for fresh data for this aircraft':f.issue||'This aircraft is not in the active sequence'
        return
    }
    event.preventDefault()
    try{(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)}catch{ /* Synthetic pointer events have no capture. */ }
    drag.value={callsign:f.callsign,startX:event.clientX,startY:event.clientY,time:displayedTime(f),labelStart:labelY(f),scale:pixelsPerMinute.value,moved:false,pointerY:event.clientY}
    selected.value=f.callsign;error.value=''
    menu.value=''
}
function startGapDrag(id:string,part:'begin'|'end'|'move',event:PointerEvent) {
    if(event.button!==0 || !editable.value || gapSettling.value)return
    const slot=config.value.slots.find(s=>s.id===id);if(!slot)return
    event.preventDefault();menu.value='';error.value=''
    try{(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)}catch{ /* Test pointers have no native capture. */ }
    gapDrag.value={id,part,startY:event.clientY,scale:pixelsPerMinute.value,originalBegin:slot.begin,originalEnd:slot.end,begin:slot.begin,end:slot.end,moved:false}
}
function updateGapDrag(event:PointerEvent) {
    const moving=gapDrag.value;if(!moving)return
    const pixels=event.clientY-moving.startY
    if(Math.abs(pixels)>3)moving.moved=true
    const delta=Math.round(-pixels/moving.scale*60000/15000)*15000
    if(moving.part==='move'){
        const shift=Math.max(-moving.originalBegin,delta)
        moving.begin=moving.originalBegin+shift;moving.end=moving.originalEnd+shift
    }else if(moving.part==='begin')moving.begin=Math.max(0,Math.min(moving.originalEnd-30000,Math.max(moving.originalEnd-86400000,moving.originalBegin+delta)))
    else moving.end=Math.max(moving.originalBegin+30000,Math.min(moving.originalBegin+86400000,moving.originalEnd+delta))
}
function gapStyle(slot:EngineConfig['slots'][number]) {
    const top=Math.max(0,y(slot.end)),bottom=Math.min(plotHeight.value,y(slot.begin))
    return {top:`${top}px`,height:`${Math.max(1,bottom-top)}px`,'--end-caption-top':'5px','--begin-caption-bottom':'5px'}
}
function gapClick(id:string){if(suppressGapClick){suppressGapClick=false;return}openGap(id)}
function finishGapDrag(event:PointerEvent) {
    updateGapDrag(event)
    const moving=gapDrag.value;gapDrag.value=null
    if(!moving?.moved)return
    suppressGapClick=true;setTimeout(()=>suppressGapClick=false,100)
    const next=clone(config.value)
    next.slots=next.slots.map(s=>s.id===moving.id?{...s,begin:moving.begin,end:moving.end}:s)
    gapSettling.value={id:moving.id,begin:moving.begin,end:moving.end}
    void commit(edits.value,next).finally(()=>gapSettling.value=null)
}
function pointerMove(event:PointerEvent) {
    if(popupDrag.value){const moving=popupDrag.value,root=rootElement.value!.getBoundingClientRect();popupPosition.x=Math.max(4,Math.min(root.width-moving.width-4,moving.x+event.clientX-moving.startX));popupPosition.y=Math.max(4,Math.min(root.height-moving.height-4,moving.y+event.clientY-moving.startY));return}
    if(dialogDrag.value){
        const moving=dialogDrag.value,root=rootElement.value!.getBoundingClientRect()
        dialogPosition.value={x:Math.max(0,Math.min(Math.max(0,root.width-moving.width),moving.x+event.clientX-moving.startX)),y:Math.max(0,Math.min(Math.max(0,root.height-moving.height),moving.y+event.clientY-moving.startY))};return
    }
    if(timeScroll.value){clockOffset.value=Math.max(-60,Math.min(120,timeScroll.value.offset-(event.clientY-timeScroll.value.startY)*timeScroll.value.minutesPerPixel));return}
    if(selectionDrag.value){updateSelection(event);return}
    if(gapDrag.value){updateGapDrag(event);return}
    if(!drag.value){updatePlacement(event);return}
    if(Math.hypot(event.clientX-drag.value.startX,event.clientY-drag.value.startY)>4)drag.value.moved=true
    if(drag.value.moved){
        drag.value.pointerY=event.clientY
        updatePlacement(event)
    }
}
function dragPosition(f:EngineFlight) {
    if(settling.value?.callsign===f.callsign)return settling.value.top
    return drag.value?.callsign===f.callsign && drag.value.moved ? drag.value.labelStart+drag.value.pointerY-drag.value.startY : labelY(f)
}
function pointerCancel(){popupDrag.value=null;dialogDrag.value=null;timeScroll.value=null;drag.value=null;placementSelection.value='';placementPreview.value=null;gapDrag.value=null;selectionDrag.value=null;recomputeSelection.value=[]}
function pointerUp(event:PointerEvent) {
    if(popupDrag.value){pointerMove(event);popupDrag.value=null;return}
    if(dialogDrag.value){pointerMove(event);dialogDrag.value=null;return}
    if(timeScroll.value){timeScroll.value=null;return}
    if(selectionDrag.value){finishSelection(event);return}
    if(gapDrag.value){finishGapDrag(event);return}
    const moving=drag.value
    if(!moving||(!moving.moved&&Math.hypot(event.clientX-moving.startX,event.clientY-moving.startY)<=4)){drag.value=null;return}
    moving.moved=true;updatePlacement(event)
    const preview=placementPreview.value;drag.value=null;placementPreview.value=null
    suppressClick=true;setTimeout(()=>suppressClick=false,100)
    if(!preview){error.value='Choose an available callsign or a future position outside a closure';return}
    void applyPlacement(preview)
}
function newSlot(group:string,event:MouseEvent) {
    if(!editable.value)return
    const g=groups.value.find(g=>g.id===group);if(!g)return
    const rect=(event.currentTarget as HTMLElement).getBoundingClientRect()
    slotDraft.id='';slotDraft.runway=view.value==='Runway'?(g.runways.filter(r=>displayRunways.value.includes(r))[event.clientX-rect.left>=columnWidth.value/2?1:0]??g.runways.find(r=>displayRunways.value.includes(r))??currentConfig.value.active[0]):currentConfig.value.active[0]
    slotDraft.start=utc(timeAt(event.currentTarget as HTMLElement,event.clientY));slotDraft.duration=8
    manualFeeder.value=g.fixes[event.clientX-rect.left>=columnWidth.value/2?1:0] || g.fixes[0] || 'NILUG';positionPopup(event,true);menu.value='timeline'
}
function openFlightGap() {
    if(!current.value)return
    slotDraft.id='';slotDraft.runway=rwy(current.value);slotDraft.start=utc(current.value.sta-60000);slotDraft.duration=8
    openDialog('slot')
}
function openGap(id:string) {
    const gap=config.value.slots.find(s=>s.id===id);if(!gap)return
    slotDraft.id=gap.id;slotDraft.runway=gap.runway;slotDraft.start=utc(gap.begin);slotDraft.duration=(gap.end-gap.begin)/60000;slotDraft.kind=gap.kind??'closure'
    openDialog('slot')
}
function insertFlight() {
    const callsign = insertCallsign.value.trim().toUpperCase()
    const flight = all.value.find(f => f.callsign === callsign)
    if(!/^[A-Z0-9_-]{2,16}$/.test(callsign)){error.value='Enter a valid callsign';return}
    const match = slotDraft.start.match(/^(\d{2}):(\d{2})$/)
    if (!match) return
    const date = new Date(now.value); date.setUTCHours(Number(match[1]), Number(match[2]), 0, 0)
    if (date.getTime() < now.value - 43200000) date.setUTCDate(date.getUTCDate() + 1)
    const known=sequence.value?.knownFlights?.find(f=>f.callsign===callsign)
    const transfer=flight?Math.max(0,flight.sta-flight.staFf)/1000:manualTransferSeconds(currentConfig.value,slotDraft.runway,manualFeeder.value,known?.wake||manualWake.value,known?.aircraft||manualAircraft.value)
    const requested=date.getTime(),landingTime=view.value==='Runway'?requested:requested+transfer*1000
    const queue = sequenced.value.filter(f => rwy(f) === slotDraft.runway && f.callsign !== callsign).sort((a,b)=>a.order-b.order)
    let index = queue.findIndex(f => f.sta >= landingTime); if (index < 0) index = queue.length
    const c=clone(config.value)
    if(!flight||flight.state===4) {
        const wake=known?.wake||manualWake.value
        c.manualFlights=[...(c.manualFlights || []).filter(f=>f.callsign!==callsign),{callsign,runway:slotDraft.runway,aircraft:known?.aircraft||manualAircraft.value||'UNKN',wake:['L','M','H','J','?'].includes(wake)?wake:'?',departure:known?.departure||'----',feeder:manualFeeder.value,eta:landingTime,feederEta:view.value==='Runway'?undefined:requested}]
    }
    const anchor=queue[index]??queue.at(-1)
    const changes=flight&&sequence.value&&anchor?insertRelative(sequence.value,edits.value,callsign,anchor.callsign,index>=queue.length?'after':'before'):{...edits.value}
    changes[callsign]={...changes[callsign],mode:'sequenced',runway:slotDraft.runway,swapAt:undefined,changedAt:now.value,landedAt:undefined,requeueAt:now.value+1,recomputeAt:now.value+1,target:landingTime,targetKind:'time'}
    void commit(changes,c)
    dialog.value=''
}
function saveSlot() {
    const match = slotDraft.start.match(/^(\d{2}):(\d{2})$/)
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || slotDraft.duration <= 0) { error.value = 'Enter a valid UTC start and duration'; return }
    const date = new Date(now.value); date.setUTCHours(Number(match[1]), Number(match[2]), 0, 0)
    if (date.getTime() < now.value - 12 * 3600000) date.setUTCDate(date.getUTCDate() + 1)
    const id = slotDraft.id || `slot-${Date.now()}`
    const c = clone(config.value)
    c.slots = c.slots.filter(s => s.id !== id)
    c.slots.push({ id, runway: slotDraft.runway, begin: date.getTime(), end: date.getTime() + slotDraft.duration * 60000,kind:slotDraft.kind })
    void commit(edits.value, c); dialog.value = ''
}
async function cancelPlannedChange(){
    const next=clone(config.value)
    if(dialog.value==='configuration')next.pending=undefined
    else next.pendingRate=undefined
    await commit(edits.value,next);if(!error.value)dialog.value=''
}
async function saveRates() {
    try {
        const next=clone(effectiveConfig(config.value,now.value))
        if(next.pending&&next.pending.at<=now.value)next.pending=undefined
        if(next.pendingRate&&next.pendingRate.at<=now.value)next.pendingRate=undefined
        const at=applyAt.value
        if(applyMinutes.value>0&&at<=now.value)throw new Error('Choose a future time with the slider')
        if(dialog.value==='rates'){
            if(applyMinutes.value>0)next.pendingRate={at,seconds:draftRateSeconds.value}
            else{next.pendingRate=undefined;next.rates[rateRunway.value]=draftRateSeconds.value}
        }else{
            const rates={...next.rates,...(draftApplyRate.value?{[draftArrival.value]:draftRateSeconds.value}:{})}
            if(applyMinutes.value>0)next.pending={at,active:[...draft.value.active],rates,departureRunway:draft.value.departureRunway,applyRate:draftApplyRate.value}
            else{next.pending=undefined;next.active=[...draft.value.active];next.departureRunway=draft.value.departureRunway;next.rates=rates}
        }
        await commit(edits.value,next);if(!error.value)dialog.value=''
    }catch(e:any){error.value=e.message}
}
async function resumeList(remove = false) {
    const changes = { ...edits.value }
    const selected=[...listSelection.value]
    for (const call of selected) {
        const stamp=Math.max(now.value,(sequence.value?.timestamp||0)+1,(changes[call]?.recomputeAt||0)+1,(changes[call]?.changedAt||0)+1)
        changes[call] = { ...changes[call], mode: remove ? 'removed' : 'sequenced', recomputeAt: stamp,changedAt:stamp,order:undefined,target:undefined,swapAt:undefined,requeueAt:undefined,landedAt:undefined,closurePosition:undefined }
    }
    if(await commit(changes))listSelection.value=listSelection.value.filter(call=>!selected.includes(call))
}
async function publishTiming() {
    if (!bridge.value) return
    try {
        const response = await fetch('http://127.0.0.1:17777/timing', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(2000), body: JSON.stringify({ airport: 'ESSA', generatedAt: Date.now(),
                nativeSequence: !demo.value && !stale.value && sequence.value ? toJuhaSequence(sequence.value, config.value, edits.value) : null,
                flights: demo.value || stale.value ? [] : sequenced.value.filter(f => f.arrival === 'ESSA').map(f => ({
                    callsign: f.callsign, runway: rwy(f).split('/')[1], eta: f.eta, sta: f.sta, deltaSeconds: euroscopeInstruction(f) })) }) })
        if (!response.ok) throw new Error('Bridge error')
        bridgeStatus.value = demo.value ? 'DEMO excluded from EuroScope' : 'EuroScope timing sent'
    } catch { bridgeStatus.value = 'EuroScope connection unavailable' }
}
onMounted(() => {
    window.addEventListener('saaman-coordination-ack',nativeCoordinationAck)
    window.addEventListener('beforeunload',closeCoordinationPopup)
    window.addEventListener('saaman-pulse',nativePulse)
    window.addEventListener('saaman-relay',relayChanged)
    void refreshCoverage();void chooseMode('MASTER')
    timer = setInterval(() => now.value = Date.now(), 1000)
    pollingTimer = setInterval(()=>{void refreshCoverage();void poll()}, 3000)
    resizeObserver = new ResizeObserver(entries => {plotHeight.value=Math.max(200,entries[0].contentRect.height-28);plotWidth.value=Math.max(200,scrollElement.value?.clientWidth??entries[0].contentRect.width-19);void nextTick(()=>{fitPopup();fitDialog()})})
    if (displayElement.value) resizeObserver.observe(displayElement.value)
    window.addEventListener('keydown',cancelPlacement);window.addEventListener('pointermove',pointerMove,true);window.addEventListener('pointerup',pointerUp,true);window.addEventListener('pointercancel',pointerCancel,true)
})
function nativePulse(){void refreshCoverage();void poll()}
onUnmounted(() => { window.removeEventListener('saaman-coordination-ack',nativeCoordinationAck);window.removeEventListener('beforeunload',closeCoordinationPopup);closeCoordinationPopup();window.removeEventListener('saaman-relay',relayChanged);window.removeEventListener('saaman-pulse',nativePulse);clearTimeout(scrollAnimationTimer);clearInterval(timer); clearInterval(pollingTimer); resizeObserver?.disconnect();window.removeEventListener('keydown',cancelPlacement);window.removeEventListener('pointermove',pointerMove,true);window.removeEventListener('pointerup',pointerUp,true);window.removeEventListener('pointercancel',pointerCancel,true) })

function showEtaFf(){if(!current.value)return;etaFfDraft.value=zulu(current.value.etaFf);openDialog('eta-ff')}
function saveEtaFf(){
 const time=parseUtc(etaFfDraft.value);if(time===null)return
 editFlight({etaFfOverride:time,recomputeAt:now.value+1});dialog.value=''
}
function parseUtc(value:string){
 const m=value.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/)
 if(!m||+m[1]>23||+m[2]>59||+(m[3]||0)>59){error.value='Enter a UTC time as HH:MM:SS';return null}
 const date=new Date(now.value);date.setUTCHours(+m[1],+m[2],+(m[3]||0),0)
 if(date.getTime()<now.value-43200000)date.setUTCDate(date.getUTCDate()+1)
 return date.getTime()
}
function showMaximumDelay(){maximumDelayDraft.value=edits.value[selected.value]?.maximumDelayMinutes;openDialog('maximum-delay')}
function chooseMaximumDelay(minutes:number|undefined){maximumDelayDraft.value=minutes;void saveMaximumDelay()}
function showRelativeMenu(kind:'arrival'|'closure'|'gap'){relativeOperation.value=kind;openDialog('relative-side')}
function chooseRelativeSide(side:'before'|'after'){if(relativeOperation.value==='arrival')showRelativeInsert(side);else{void insertInterval(relativeOperation.value,side);dialog.value=''}}
async function saveMaximumDelay(){if(sequence.value){try{await commit(maximumDelayEdits(sequence.value,config.value,edits.value,selected.value,maximumDelayDraft.value));dialog.value=''}catch(e:any){error.value=e.message}}}
async function refreshDelay(callsigns:string[]){
 const changes=clone(edits.value),stamp=Math.max(now.value,(sequence.value?.timestamp??0)+1)
 for(const callsign of callsigns)changes[callsign]={...changes[callsign],refreshDelayAt:stamp,changedAt:stamp}
 closeFieldMenu();await commit(changes)
}
function showRelativeInsert(side:'before'|'after'){
 if(!current.value)return;relativeAnchor.value=current.value.callsign;relativeSide.value=side;insertCallsign.value='';openDialog('relative-insert')
}
async function saveRelativeInsert(){
 if(!sequence.value)return
 try{
  let snapshot=sequence.value;const c=clone(config.value)
  if(!snapshot.flights.some(f=>f.callsign===insertCallsign.value)){
   const known=snapshot.knownFlights?.find(f=>f.callsign===insertCallsign.value),anchor=snapshot.flights.find(f=>f.callsign===relativeAnchor.value)
   if(!known||!anchor)throw Error('The selected arrival is no longer available')
   const eta=anchor.sta+(relativeSide.value==='before'?-1:1)*(currentConfig.value.rates[rwy(anchor)]??115)*1000
   const wake=['L','M','H','J','?'].includes(known.wake)?known.wake:'?'
   c.manualFlights=[...(c.manualFlights??[]).filter(f=>f.callsign!==known.callsign),{callsign:known.callsign,runway:rwy(anchor),aircraft:known.aircraft||'UNKN',wake,departure:known.departure||'----',feeder:anchor.ff,eta}]
   // Only the callsign/rank is used by the insertion helper. The commit
   // creates a manual slot; it never copies this aircraft's radar position.
   snapshot={...snapshot,flights:[...snapshot.flights,{...anchor,...known,runway:anchor.runway,state:1,mode:'sequenced',order:Number.MAX_SAFE_INTEGER}]}
  }
  await commit(insertRelative(snapshot,edits.value,insertCallsign.value,relativeAnchor.value,relativeSide.value),c);dialog.value=''
 }catch(e:any){error.value=e.message}
}
async function insertInterval(kind:'closure'|'gap',side?:'before'|'after'){
 if(view.value!=='Runway'){error.value='Closures and gaps can be inserted only in Runway view';return}
 const duration=(kind==='closure'?8:5)*60000,f=current.value
 const begin=side&&f?(side==='before'?f.sta-duration:f.sta+1):parseUtc(slotDraft.start)
 if(begin===null)return
 const c=clone(config.value);c.slots.push({id:`${kind}-${crypto.randomUUID()}`,runway:side&&f?rwy(f):slotDraft.runway,begin,end:begin+duration,kind})
 await commit(edits.value,c);menu.value=''
}
async function coordinationRequest(body:{message?:string;acknowledge?:string}){
 if(!canCoordinate.value)return
 busy.value=true
 coordinationAcknowledging.value=!!body.acknowledge
 coordinationError.value=''
 try{receive((await axios.post(`${apiBase}/maestro/ESSA/coordination`,body,{headers:headers(),timeout:7000})).data);error.value='';menu.value=''}catch(e:any){error.value=e.response?.data?.error||e.message||'Coordination not saved';if(body.acknowledge)coordinationError.value=error.value;if(e.response?.status===202)menu.value=''}finally{coordinationAcknowledging.value=false;busy.value=false}
}
async function sendCoordination(message:string){await coordinationRequest({message})}
async function acknowledgeCoordination(){const m=pendingCoordination.value;if(m)await coordinationRequest({acknowledge:m.id})}

</script>

<template>
<section class="juha-aman" ref="rootElement" @contextmenu.prevent @pointermove.capture="rememberPointer" @pointerdown.capture="rememberPointer" @click.capture="rememberPointer">
    <div class="toolbar">
        <button class="configuration-button" data-action="configuration" aria-label="Runway configuration" @click="openDialog('configuration')"><span v-if="!localPreview&&!demo&&!sequence" title="Waiting for the shared room configuration">— / —</span><span v-else>{{ currentConfig.active.find(r=>r.startsWith('ESSA/'))?.split('/')[1] }} / {{currentConfig.departureRunway?.split('/')[1]}}<template v-if="nextConfiguration"><em class="pill-arrow">→</em><strong class="pill-next">{{nextConfiguration.active.find(r=>r.startsWith('ESSA/'))?.split('/')[1]}} / {{nextConfiguration.departureRunway?.split('/')[1]}}</strong></template></span><small v-if="nextConfiguration" class="pill-change-time">{{utc(nextConfiguration.at)}} UTC</small></button>
        <button class="rate-button" data-action="rates" aria-label="Arrival rate" @click="openDialog('rates')"><span v-if="!localPreview&&!demo&&!sequence">Waiting for shared configuration</span><span v-for="r in (!localPreview&&!demo&&!sequence?[]:currentConfig.active)" :key="r">{{r.split('/')[1]}} : {{Math.round(3600/currentConfig.rates[r])}} / h<template v-if="nextRate&&r.startsWith('ESSA/')"><em class="pill-arrow">→</em><strong class="pill-next">{{Math.round(3600/nextRate.seconds)}} / h</strong><small class="pill-change-time">{{utc(nextRate.at)}} UTC</small></template><small>{{currentConfig.rates[r]}}s · {{rateDistanceNm(currentConfig.rates[r],r,currentConfig).toFixed(1)}} NM</small></span></button>
        <div v-if="panels.tracks" class="tracks">TMA {{ sequenced.filter(f=>f.passedFeeder).length }}<br>TOT {{sequenced.length}}</div><div v-if="panels.winds" class="tracks">SFC {{currentConfig.surfaceWindDirection}}°<br>{{currentConfig.surfaceWindSpeed}} kt</div><div v-if="panels.rates" class="tracks"><span v-for="r in currentConfig.active" :key="r">{{r.split('/')[1]}} {{measuredRate(r)===null?'—':`${measuredRate(r)}s (${measuredRate(r)!-currentConfig.rates[r]}s)`}}<br></span></div><span class="updated">{{sequence?utc(sequence.timestamp,true):'--:--:--'}}</span>
    </div>
    <nav class="view-buttons">
        <button @click="menu=menu==='maestro'?'':'maestro'">MAESTRO▼</button>
        <button v-for="v in ['ACC','Runway','FLOW'].filter(v=>v!=='ACC'||coverage.view!==null)" :key="v" :class="{active:view===v}" @click="changeView(v)">{{v==='ACC'?coverage.view:v}}</button>
        <button data-action="desequenced" @click="openDialog('desequenced')">Desequenced {{unsequenced.length}}</button><button @click="openDialog('missed')">Missed Approach {{all.filter(f=>f.mode==='missed').length}}</button>
        <button class="errors-button" data-action="errors" :disabled="!error&&!diagnosticFlights.length" @click="openDialog('diagnostics')">Errors {{diagnosticFlights.length+(error?1:0)}}</button>
        <button data-action="coordinations" @click="positionPopup($event,true);menu=menu==='coordination'?'':'coordination'">Coordinations</button>
    </nav>
    <Teleport :to="globalTarget||'body'" :disabled="!globalTarget">
    <div v-if="menu==='maestro'" class="popup global-menu" ><div class="menu-title" @pointerdown="globalSurface.startDrag">MAESTRO<button @click="menu=''">×</button></div><button @click="openDialog('setup')">ESSA · Operation mode</button><button @click="openDialog('feeders')">ACC feeders</button><small class="build-version">{{applicationBuild}}</small></div>
    </Teleport>
    <div class="display" ref="displayElement">
        <div class="time-overview" role="scrollbar" aria-label="Arrival overview — scroll timeline in time" aria-orientation="vertical" aria-controls="aman-timeline" :aria-valuemin="-60" :aria-valuemax="120" :aria-valuenow="clockOffset" :aria-valuetext="`${clockOffset} minutes from now`" tabindex="0" @pointerdown="startTimeScroll" @keydown="scrollTimeKey" @dblclick="clockOffset=0">
            <div class="overview-window" :style="overviewWindow" title="Visible time window — drag to scroll"></div>
            <span v-for="f in overviewFlights" :key="f.callsign" class="overview-flight" :data-overview-callsign="f.callsign" :style="{top:`${overviewPercent(displayedTime(f))}%`,background:stateColor(f)}"></span>
            <i class="overview-now" :style="{top:`${overviewPercent(now)}%`}"></i>
        </div>
        <div class="horizontal-scroll" ref="scrollElement" @scroll="syncHorizontal">
            <div id="aman-timeline" class="timeline-strip" :class="{'scrolling-time':scrollingTime}" @pointerdown="startSelection" @click="placeOnTimeline" @pointerleave="placementPreview=null" :style="{'--column-width':`${columnWidth}px`,'--axis-x':`${columnWidth/2}px`}">
                <div class="now-line" :style="{top:`${y(now)}px`}"><span>{{utc(now)}} NOW</span></div>
                <div v-for="g in groups" :key="g.id" class="timeline-column" :data-column="g.id">
                    <div class="time-area" @contextmenu.stop.prevent="newSlot(g.id,$event)">
                        <div class="axis"></div>
                        <span v-if="editable&&placementPreview?.group===g.id" class="placement-marker" :class="{right:placementPreview.right,swap:placementPreview.kind==='swap'}" :style="{top:`${placementPreview.top}px`,left:`calc(var(--axis-x) + ${placementPreview.right?12:-26}px)`}" :data-placement="placementPreview.kind" :data-source="placementPreview.callsign" :data-time="placementPreview.time" :data-target="placementPreview.other" role="img" :aria-label="placementPreview.kind==='swap'?`Swap ${placementPreview.callsign} with ${placementPreview.other}`:`Insert ${placementPreview.callsign} at ${utc(placementPreview.time,true)} UTC`">
                            <svg v-if="placementPreview.kind==='swap'" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h17m-5-5 5 5-5 5M21 17H4m5-5-5 5 5 5"/></svg>
                            <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M2 8h10V3l10 9-10 9v-5H2Z"/></svg>
                        </span>
                        <div v-for="i in ticks" :key="i" class="tick" :class="{major:Number(minutes(Math.floor(referenceTime/60000)*60000+i*60000))%5===0}" :style="{top:`${y(Math.floor(referenceTime/60000)*60000+i*60000)}px`}"><span v-if="Number(minutes(Math.floor(referenceTime/60000)*60000+i*60000))%5===0">{{minutes(Math.floor(referenceTime/60000)*60000+i*60000)}}</span></div>
                        <svg class="time-anchors" aria-hidden="true"><g v-for="f in visibleFlights.filter(f=>groupOf(f)===g.id&&y(displayedTime(f))>=0&&y(displayedTime(f))<=plotHeight)" :key="f.callsign" :stroke="stateColor(f)"><circle :cx="columnWidth/2+(rightSide(f)?20:-14)" :cy="y(displayedTime(f))" r="2" :fill="stateColor(f)"/></g></svg>
                        <i v-for="marker in changeMarkers.filter(m=>y(m.at)>=0&&y(m.at)<=plotHeight)" :key="marker.kind" class="change-time-marker" :class="[marker.kind,{preview:marker.preview}]" :data-kind="marker.kind" :data-preview="!!marker.preview" :data-time="marker.at" :style="{top:`${y(marker.at)}px`}" :title="`${marker.kind==='rate'?'Rate':'Runway configuration'} change at ${utc(marker.at)} UTC`"></i>
                        <div v-for="s in displayedGaps.filter(s=>view==='Runway'&&g.runways.includes(s.runway)&&y(s.begin)>=0&&y(s.end)<=plotHeight)" :key="s.id" class="closure-gap" :class="{right:s.runway===g.runways[1],adjusting:gapDrag?.id===s.id,hollow:s.kind==='gap'}" :data-gap="s.id" :style="gapStyle(s)" :title="`${s.runway.split('/')[1]} closed ${utc(s.begin,true)}–${utc(s.end,true)} UTC`">
                            <button v-if="y(s.end)>=0" class="gap-handle end" data-gap-handle="end" :disabled="!editable" :aria-label="`Drag closure end for ${s.runway.split('/')[1]}`" @pointerdown.stop="startGapDrag(s.id,'end',$event)" @click.stop><span>{{utc(s.end,true)}} END</span></button>
                            <button class="gap-body" data-gap-handle="move" :aria-label="`Move closure for ${s.runway.split('/')[1]}`" @pointerdown.stop="startGapDrag(s.id,'move',$event)" @click.stop="gapClick(s.id)"><span>{{s.kind==='gap'?'GAP':'CLOSED'}} <small>{{((s.end-s.begin)/60000).toFixed(1)}}m</small></span></button>
                            <button v-if="y(s.begin)<=plotHeight" class="gap-handle begin" data-gap-handle="begin" :disabled="!editable" :aria-label="`Drag closure start for ${s.runway.split('/')[1]}`" @pointerdown.stop="startGapDrag(s.id,'begin',$event)" @click.stop><span>{{utc(s.begin,true)}} START</span></button>
                        </div>
                        <button v-for="f in visibleFlights.filter(f=>groupOf(f)===g.id&&y(displayedTime(f))>=0&&y(displayedTime(f))<=plotHeight)" :key="f.callsign" class="flight" :class="{right:rightSide(f),boxed:selected===f.callsign||recomputeSelection.includes(f.callsign),selected:selected===f.callsign,'swap-target':placementPreview?.other===f.callsign,movable:movable(f),dragging:drag?.callsign===f.callsign&&drag.moved}" :data-callsign="f.callsign" :aria-pressed="selected===f.callsign" :data-state="STATE_NAMES[f.state]" :style="{top:`${dragPosition(f)}px`,color:stateColor(f)}" :title="flightTooltip(f)" @click.stop="selectFlight(f)" @contextmenu.prevent.stop="flightClick(f,$event)" @pointerdown.stop="startDrag(f,$event)">
                            <span v-if="labels.totalDelay">{{Math.round(f.totalDelay/60)}}</span><span v-if="labels.feeder">{{f.ff}}</span><span v-if="labels.runway">{{rwy(f).split('/')[1]}}</span><span class="type">{{f.aircraft||'UNKN'}}</span><span class="wake" :title="`Wake turbulence category: ${f.wake||'?'}`">{{f.wake||'?'}}</span><span v-if="delayLabel(f.delay)" class="delay" :style="{color:delayColor(f.delay)}">{{delayLabel(f.delay)}}</span><strong>{{f.callsign}}</strong><span class="ff-time" :title="`${view==='Runway'?'Scheduled landing':'Scheduled feeder crossing'} ${utc(view==='Runway'?f.sta:f.staFf,true)} UTC`">{{minutes(f.state===4||view==='Runway'?f.sta:f.staFf)}}</span><span v-if="f.spacingConflict" class="conflict" title="Check spacing after this sequence change">!</span>
                        </button>
                    </div>
                    <div class="timeline-foot"><span class="foot-left">{{view==='Runway'?displayRunways.includes(g.runways[0])?g.runways[0].split('/')[1]:'':feederSelection.includes(g.fixes[0])||view==='FLOW'?g.fixes[0] || g.name:''}}</span><button class="column-clock" @click="openDialog('labels')">{{utc(now,true)}}</button><span class="foot-right">{{view==='Runway'?displayRunways.includes(g.runways[1])?g.runways[1].split('/')[1]:'':feederSelection.includes(g.fixes[1])||view==='FLOW'?g.fixes[1] || '':''}}</span></div>
                </div>
            </div>
        </div>
    </div>
    <div class="horizontal-slider" :style="{'--horizontal-thumb-width':`${Math.max(14,plotWidth*Math.min(1,plotWidth/(groups.length*columnWidth)))}px`}"><input type="range" v-model.number="horizontalPosition" :max="horizontalMax" min="0" step="1" :disabled="horizontalMax===0" aria-label="Scroll between timeline columns" @input="scrollHorizontal"></div>


    <div v-if="selectionBox" class="recompute-box" :style="selectionBox" aria-hidden="true"></div>
    <Teleport :to="menuTarget||'body'" :disabled="!menuTarget">
    <div v-if="menu==='recompute'" class="popup recompute-menu" ref="popupElement"  :style="{left:`${popupPosition.x}px`,top:`${popupPosition.y}px`}">
        <div class="menu-title" @pointerdown="startPopupDrag">{{recomputeSelection.length}} aircraft selected<button @click="closeFieldMenu">×</button></div>
        <button :disabled="!editable" @click="refreshDelay(recomputeSelection)">Refresh delay</button><button data-action="recompute-selection" :disabled="!editable" @click="recomputeFlights(recomputeSelection)">Recompute</button>
    </div>
    <div v-if="menu==='flight'&&current" class="popup flight-menu" ref="popupElement"  :style="{left:`${popupPosition.x}px`,top:`${popupPosition.y}px`}">
        <div class="menu-title" @pointerdown="startPopupDrag">{{current.callsign}} · {{STATE_NAMES[current.state]}}<button @click="menu=''">×</button></div>
        <button data-menu="information" @click="openDialog('information')">Information</button><button data-menu="recompute" :disabled="!editable" @click="recomputeFlights([current.callsign])">Recompute</button><button data-menu="runway" v-if="changeRunwayAvailable" :disabled="!editable" @click="openDialog('runway')">Change Runway ▸</button><button data-menu="arrival-profile" :disabled="!editable" @click="openDialog('arrival-profile')">Arrival route ▸</button><button data-menu="desequence" :disabled="!editable" @click="editFlight({mode:'desequenced'})">De-sequence</button><button data-menu="missed" :disabled="!editable" @click="editFlight({mode:'missed'})">Missed approach</button><button v-if="current.state!==4" data-menu="landed" :disabled="!editable" @click="editFlight({landedAt:now})">Mark landed</button><button data-menu="remove" :disabled="!editable" @click="editFlight({mode:'removed'})">Remove</button>
        <button :disabled="!editable" @click="refreshDelay([current.callsign])">Refresh delay</button>
        <button :disabled="!editable" @click="showEtaFf">Change ETA-FF</button><button :disabled="!editable" @click="showMaximumDelay">Maximum delay ▸</button>
        <button :disabled="!editable" @click="showRelativeMenu('arrival')">Insert arrival ▸</button>
        <template v-if="view==='Runway'"><button :disabled="!editable" @click="showRelativeMenu('closure')">Insert closure ▸</button><button :disabled="!editable" @click="showRelativeMenu('gap')">Insert gap ▸</button></template>
    </div>
    <div v-if="menu==='timeline'" class="popup timeline-menu" ref="popupElement"  :style="{left:`${popupPosition.x}px`,top:`${popupPosition.y}px`}"><div class="menu-title" @pointerdown="startPopupDrag">{{slotDraft.runway}} · {{slotDraft.start}} UTC<button @click="menu=''">×</button></div><button data-menu="add-flight" @click="insertCallsign='';openDialog('insert')">Manually add flight</button><template v-if="view==='Runway'"><button data-menu="closure" @click="insertInterval('closure')">Insert closure</button><button data-menu="gap" @click="insertInterval('gap')">Insert gap</button></template></div>
    <div v-if="menu==='coordination'" class="popup coordination-menu" ref="popupElement" :style="{left:`${popupPosition.x}px`,top:`${popupPosition.y}px`}"><div class="menu-title" @pointerdown="startPopupDrag">Coordinations<button @click="menu=''">×</button></div><small v-if="localPreview||demo">Join a shared vatIRIS room to coordinate with other operators.</small><button v-for="message in COORDINATION_MESSAGES" :key="message" :disabled="!canCoordinate" @click="sendCoordination(message)">{{message}}</button></div>
    </Teleport>
    <Teleport :to="dialogTarget||'body'" :disabled="!dialogTarget">
    <div v-if="dialog" class="dialog-shade" :class="{'movable-dialog-shade':movableDialog}" @click.self="dialog=''">
        <div class="native-dialog" :class="{'movable-dialog':movableDialog}" :style="dialogStyle" @mouseleave="leaveDialogMenu" :data-dialog="dialog">
            <div class="dialog-title" @pointerdown="startDialogDrag">{{dialog==='configuration'?'RUNWAY CONFIGURATION':dialog==='information'?current?.callsign:dialog==='relative-side'?`INSERT ${relativeOperation.toUpperCase()}`:dialog==='insert'?'MANUALLY ADD FLIGHT':dialog.replaceAll('-',' ').toUpperCase()}}<button @click="dialog=''">×</button></div>
            <template v-if="dialog==='setup'">
                <p>Airport <strong>ESSA</strong></p>
                <label>Connection <select aria-label="Connection mode" v-model="connectionDraft.shared"><option :value="true">Shared backend</option><option :value="false">Local EuroScope</option></select></label>
                <template v-if="connectionDraft.shared">
                    <label>Server <select aria-label="Backend authentication" v-model="connectionDraft.authProvider"><option value="vatiris-callsign">vatIRIS · EuroScope callsign</option><option value="keys">Controller key</option></select></label>
                    <label>Backend address <input aria-label="Backend address" v-model="connectionDraft.backendBaseUrl" maxlength="300" spellcheck="false"></label>
                    <label v-if="connectionDraft.authProvider==='keys'">Controller key <input aria-label="Controller key" type="password" autocomplete="off" v-model="connectionDraft.controllerKey" maxlength="50" placeholder="Enter key, or leave blank to keep saved key"></label>
                    <p v-if="auth.loginError">{{auth.loginError}}</p>
                    <label>Network <select aria-label="Shared network" v-model="connectionDraft.network"><option value="live">VATSIM live</option><option value="sweatbox1">SweatBox 1</option><option value="sweatbox2">SweatBox 2</option></select></label>
                    <template v-if="connectionDraft.authProvider==='vatiris-callsign'"><label v-if="connectionDraft.network!=='live'">Supervisor CID (optional) <input aria-label="Controller CID" v-model="connectionDraft.controllerCid" inputmode="numeric" maxlength="10"></label></template>
                    <template v-else><label>Exercise <input aria-label="Shared exercise" v-model="connectionDraft.session" maxlength="48"></label><label>Room <input aria-label="AMAN room" v-model="connectionDraft.channel" maxlength="48"></label></template>
                </template>
                <button :disabled="connectionSaving" @click="saveConnection">Save connection</button><button @click="chooseMode('DEMO')">Demo</button><button :disabled="towerController" @click="chooseMode('MASTER')">{{localPreview?'Live · EuroScope':'Join shared room'}}</button><button v-if="!localPreview" @click="chooseMode('SLAVE')">Observe only</button>
                <p>{{localPreview?'Local sequence on this computer.':nativeInfo.authProvider==='vatiris-callsign'?`${sharedRole} · ${nativeInfo.relay.network} / ESSA`:`${sharedRole} · ${nativeInfo.relay.network} / ${nativeInfo.relay.session} / ${nativeInfo.relay.channel}`}}</p>
            </template>
            <template v-else-if="dialog==='configuration'||dialog==='rates'">
                <button v-if="dialog==='configuration'" data-action="sync-euroscope" :disabled="!editable||runwaySyncBusy" @click="syncEuroScope">Sync EuroScope</button><p v-if="runwaySyncError" role="alert">{{runwaySyncError}}</p>
                <template v-if="dialog==='configuration'"><label>Arrival runway <select data-input="arrival-runway" v-model="draftArrival"><option v-for="r in RUNWAYS.filter(r=>r.startsWith('ESSA/'))" :key="r" :value="r">{{r.split('/')[1]}}</option></select></label><label>Departure runway <select data-input="departure-runway" v-model="draft.departureRunway"><option v-for="r in RUNWAYS.filter(r=>r.startsWith('ESSA/'))" :key="r" :value="r">{{r.split('/')[1]}}</option></select></label></template>
                <div class="rate-row"><label>Arrival rate<br>{{rateRunway.split('/')[1]}}</label><input data-input="arrival-rate-slider" type="range" min="60" max="600" step="1" v-model.number="draftRateSeconds" @input="draftApplyRate=true" :aria-label="`${rateRunway} landing interval`"><output>{{Math.round(3600/draftRateSeconds)}} / h<br>{{draftRateSeconds}} s · {{rateDistanceNm(draftRateSeconds,rateRunway,draft).toFixed(1)}} NM</output></div>
                <div class="apply-row"><label for="aman-apply-slider">{{applyMinutes===0?'Apply now':`Apply at ${utc(applyAt)} UTC`}}</label><input id="aman-apply-slider" data-input="apply-time-slider" aria-label="Change application time" type="range" min="0" max="60" step="1" v-model.number="applyMinutes"><span class="apply-range"><span>Now</span><span>+60 min</span></span></div><button v-if="dialog==='configuration'?nextConfiguration:config.pendingRate&&config.pendingRate.at>now" data-action="cancel-planned-change" :disabled="!editable" @click="cancelPlannedChange">Cancel planned changes</button><button data-action="save-rates" :disabled="!editable" @click="saveRates">{{(dialog==='configuration'?nextConfiguration:config.pendingRate&&config.pendingRate.at>now)?'Update change':'Apply'}}</button><button @click="dialog=''">Close</button>
            </template>
            <template v-else-if="dialog==='arrival-profile'&&current"><label>Arrival route <select data-input="arrival-profile" v-model="arrivalProfileDraft"><option value="">Auto from filed STAR / feeder</option><option v-for="profile in STAR_PROFILES.filter(p=>p.runway===rwy(current!).split('/')[1])" :key="profile.id" :value="profile.id">{{profile.procedure}} · {{profile.feeder}}</option></select></label><button data-action="save-arrival-profile" @click="editFlight({arrivalProfile:arrivalProfileDraft||undefined,recomputeAt:now,target:undefined});dialog=''">Apply and recompute</button></template>
            <template v-else-if="dialog==='information'&&current"><MaestroInformation :flight="current" :now="now"/></template>
            <template v-else-if="dialog==='runway'&&current"><button v-for="r in displayRunways" :key="r" :disabled="!editable" @click="editFlight({runway:r,arrivalProfile:undefined,recomputeAt:now,target:undefined});dialog=''">{{r.split('/')[1]}}</button></template>
            <template v-else-if="dialog==='flight-slots'"><label>Before flight (min) <input v-model.number="flightSlots.before" type="number" min="0" max="999"></label><label>After flight (min) <input v-model.number="flightSlots.after" type="number" min="0" max="999"></label><button @click="editFlight({slotBefore:flightSlots.before,slotAfter:flightSlots.after});dialog=''">Apply</button><button @click="openFlightGap">Runway closure gap</button></template>
            <template v-else-if="dialog==='insert'"><div class="manual-flight-lists"><section><h3>Overshoot</h3><div class="flight-list" role="listbox" aria-label="Overshoot"><button v-for="f in overshootFlights" :key="f.callsign" role="option" :aria-selected="insertCallsign===f.callsign" :class="{chosen:insertCallsign===f.callsign}" @click="chooseManualFlight(f.callsign)">{{f.callsign}}</button><span v-if="!overshootFlights.length">No flights</span></div></section><section><h3>Planned</h3><div class="flight-list" role="listbox" aria-label="Planned"><button v-for="f in plannedFlights" :key="f.callsign" role="option" :aria-selected="insertCallsign===f.callsign" :class="{chosen:insertCallsign===f.callsign}" @click="chooseManualFlight(f.callsign)">{{f.callsign}}</button><span v-if="!plannedFlights.length">No flights</span></div></section></div><label>Callsign <input data-input="manual-callsign" v-model="insertCallsign" @keydown.enter="insertFlight" placeholder="SAS123"></label><label>Runway <select v-model="slotDraft.runway"><option v-for="r in RUNWAYS.filter(r=>r.startsWith('ESSA/'))" :key="r">{{r}}</option></select></label><label>{{view==='Runway'?'Arrival':'Feeder'}} UTC <input type="time" v-model="slotDraft.start"></label><label>Aircraft <input v-model="manualAircraft" placeholder="UNKN"></label><label>Wake <select v-model="manualWake"><option v-for="w in ['?','L','M','H','J']" :key="w">{{w}}</option></select></label><label>Entry point <select v-model="manualFeeder"><option v-for="fix in entryPoints" :key="fix">{{fix}}</option></select></label><button data-action="insert-flight" @click="insertFlight">Add flight</button><button @click="dialog=''">Cancel</button></template>
            <template v-else-if="dialog==='slot'"><label>Runway <select v-model="slotDraft.runway"><option v-for="r in RUNWAYS.filter(r=>r.startsWith('ESSA/'))" :key="r">{{r}}</option></select></label><label>Begin UTC <input data-input="gap-start" type="time" v-model="slotDraft.start"></label><label>Duration (min) <input data-input="gap-duration" v-model.number="slotDraft.duration" type="number" min="1" max="1440"></label><button data-action="save-gap" @click="saveSlot">Apply</button><button v-if="slotDraft.id" data-action="delete-gap" @click="commit(edits,{...config,slots:config.slots.filter(s=>s.id!==slotDraft.id)});dialog=''">Remove gap</button><button @click="dialog=''">Cancel</button></template>
            <template v-else-if="dialog==='desequenced'||dialog==='missed'"><label v-for="f in unsequenced.filter(f=>dialog==='desequenced'||f.mode==='missed')" :key="f.callsign"><input v-model="listSelection" type="checkbox" :value="f.callsign">{{f.callsign}}</label><p v-if="!unsequenced.length">No flights</p><button :disabled="!editable||!listSelection.length" @click="resumeList()">Resume</button><button :disabled="!editable||!listSelection.length" @click="resumeList(true)">Remove</button></template>
            <template v-else-if="dialog==='eta-ff'"><label>ETA-FF (UTC)<input v-model="etaFfDraft" placeholder="HH:MM:SS"></label><button :disabled="!editable" @click="saveEtaFf">Apply</button></template>
            <template v-else-if="dialog==='maximum-delay'"><button class="submenu-choice" v-for="n in [0,3,5,10,15]" :key="n" :disabled="!editable" @click="chooseMaximumDelay(n)">{{n}}</button><button class="submenu-choice" :disabled="!editable" @click="chooseMaximumDelay(undefined)">No limit</button></template>
            <template v-else-if="dialog==='relative-side'"><button class="submenu-choice" :disabled="!editable" @click="chooseRelativeSide('before')">Before</button><button class="submenu-choice" :disabled="!editable" @click="chooseRelativeSide('after')">After</button></template>
            <template v-else-if="dialog==='relative-insert'"><label>Insert arrival {{relativeSide}} {{relativeAnchor}}<select v-model="insertCallsign"><option value="">Select flight</option><option v-for="f in arrivalOptions" :key="f.callsign" :value="f.callsign">{{f.callsign}}</option></select></label><button :disabled="!editable||!insertCallsign" @click="saveRelativeInsert">Insert</button></template>
            <template v-else-if="dialog==='feeders'"><label v-for="ff in feederOptions" :key="ff"><input type="checkbox" v-model="feederSelection" :value="ff">{{ff}}</label><p v-if="coverage.detected&&!feederOptions.length">No feeder fixes covered by this position.</p><button @click="dialog=''">Close</button></template>
            <template v-else-if="dialog==='diagnostics'"><p v-if="error" role="alert">{{error}} <button @click="error=''">Dismiss</button></p><p v-for="f in diagnosticFlights" :key="f.callsign">{{f.callsign}} — {{f.issue}} <span v-for="warning in f.dataWarnings" :key="warning">{{warning}} </span><span v-if="f.maximumDelayExceeded">Required delay exceeds this aircraft’s maximum. Change the sequence or constraints.</span><span v-if="f.trajectory?.feasible===false">The model cannot meet the configured approach conditions on this path. Review the inputs in supervision.</span><button :disabled="!editable" @click="recomputeFlights([f.callsign])">Recompute</button></p></template>
        </div>
    </div>
    </Teleport>
</section>
</template>

<style scoped>
.juha-aman{background:#495055;color:#c8c8c8;font:10px 'Lucida Console',Consolas,monospace;height:100%;min-height:360px;display:flex;flex-direction:column;position:relative;overflow:hidden}button,input,select{font:inherit}button{cursor:pointer}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible{outline:1px solid #ccefff}.toolbar{display:flex;gap:3px;padding:3px;background:#8b9aa4;color:#122129;min-height:49px;border:1px solid #a8b3bb}.toolbar>button{border:1px solid #a3afb5;background:transparent;color:inherit;padding:3px 6px;display:flex;flex-direction:column;gap:4px;text-align:left}.configuration-button{min-width:74px;max-width:135px}.rate-button{flex:1;font-size:10px}.rate-button span{display:inline-block}.tracks{padding:3px;line-height:1.8;white-space:nowrap}.updated{align-self:center;padding:3px;font-size:9px}.pending-change{padding:3px 6px;background:#687780;color:#fff;font-size:9px}.pending-change button{float:right}.view-buttons{display:flex;gap:3px;padding:4px 3px;flex-wrap:wrap}.view-buttons button{border:1px solid #8b9ca7;border-radius:8px;padding:0 6px;min-height:17px;font-size:9px;line-height:12px;background:#8a979e;color:#15252d;white-space:nowrap}.view-buttons button.active{background:#8bb4cf;color:#eef8ff}.display{flex:1;min-height:220px;display:flex;overflow:hidden}.time-overview{width:17px;position:relative;flex:none;border:1px solid #7e8a91;background:#68747b;text-align:center;font-size:8px;padding-top:4px}.time-overview i{position:absolute;left:0;right:0;border-top:2px solid #ff3030}.horizontal-scroll{overflow-x:auto;overflow-y:hidden;flex:1;position:relative;scrollbar-width:none}.horizontal-scroll::-webkit-scrollbar{display:none}.timeline-strip{display:flex;height:100%;position:relative;width:max-content;min-width:100%}.timeline-column{width:var(--column-width);min-width:var(--column-width);position:relative;height:100%;overflow:hidden}.column-heading{position:absolute;top:2px;left:0;right:0;display:flex;justify-content:space-around;font-size:9px;z-index:2;pointer-events:none}.column-heading .inactive{opacity:.35}.time-area{position:relative;height:calc(100% - 28px);overflow:hidden}.axis{position:absolute;width:7px;left:var(--axis-x);top:0;bottom:0;border-left:1px solid #a2abb0;border-right:1px solid #a2abb0;pointer-events:none}.tick{position:absolute;left:var(--axis-x);width:7px;height:0;border-top:1px solid #a2abb0;pointer-events:none}.tick.major{left:calc(var(--axis-x) - 5px);width:12px}.tick span{position:absolute;right:17px;top:-5px;font-size:8px;color:#aab3b9}.flight{position:absolute;right:calc(var(--column-width) / 2 + 3px);transform:translateY(-50%);display:flex;align-items:center;gap:4px;padding:1px 2px;border:1px solid transparent;background:#495055;color:#96d796;white-space:nowrap;font-size:9px;min-height:13px;max-width:calc(var(--column-width) / 2 - 5px);touch-action:none;user-select:none;z-index:3}.flight.right{left:calc(var(--axis-x) + 9px);right:auto}.flight.movable{cursor:grab}.flight.movable:active{cursor:grabbing}.flight strong{font-weight:normal;min-width:43px;text-align:right}.flight .type{font-size:8px;color:#b0b8bb}.flight .ff-time{width:14px;text-align:right}.flight .delay{font-size:8px;min-width:11px}.flight.boxed{border-color:#fffffe}.conflict{color:#ffd769}.timeline-foot{position:absolute;bottom:0;left:0;right:0;display:flex;justify-content:center;align-items:center;gap:5px;color:#aeb7b7;font-size:8px;white-space:nowrap;height:25px}.timeline-foot button{background:#75828a;border:1px solid #a0aab0;color:#d4dfd7;border-radius:4px;padding:3px;font-size:9px}.slot{position:absolute;left:calc(var(--axis-x) - 11px);width:12px;background:#a00000cc;color:#ffc0c0;border:0;padding:0;font-size:6px;z-index:4;cursor:pointer;min-height:5px}.slot.right{left:calc(var(--axis-x) + 8px)}.now-line{position:absolute;left:0;right:0;border-top:2px solid #ff3030;z-index:2;pointer-events:none}.now-line span{position:absolute;right:2px;top:2px;font-size:8px;color:#ff8d8d;background:#495055;padding:0 3px}.drag-guide{position:absolute;left:0;right:0;border-top:1px dashed #fff;z-index:5;pointer-events:none}.horizontal-slider{display:flex;align-items:center;gap:4px;height:18px;padding:0 5px;background:#59646b;border-top:1px solid #89969d;font-size:8px}.horizontal-slider input{width:100%;height:12px;accent-color:#a2b2be;cursor:ew-resize}.status-line{font-size:9px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:3px 5px;border-top:1px solid #69767d;color:#b4bfc4}.status-line button{background:none;color:inherit;border:0;font-size:9px;padding:0}.status-line label{margin-left:auto}.message,.diagnostics{background:#677078;color:#ffe692;padding:5px;text-align:left;font-size:10px;border:0}.message button{float:right}.popup{position:absolute;z-index:10;background:#667780;border:1px solid #a7b4bd;color:#e5eef4;box-shadow:2px 3px 5px #252c31;width:190px}.global-menu{top:76px;left:4px;width:165px}.popup button{display:block;width:100%;background:none;color:inherit;border:0;text-align:left;padding:5px}.popup button:hover:not(:disabled){background:#387da3}.menu-title{padding:4px;background:#8a9ba7;color:#122631;font-size:9px}.menu-title button{float:right;display:inline;width:auto;padding:0}.popup small{display:block;padding:5px;font-size:8px;opacity:.8}.dialog-shade{position:absolute;inset:0;background:#17202944;z-index:20;display:flex;align-items:flex-start;justify-content:center;padding:50px 7px 7px;overflow:auto}.native-dialog{background:#788792;border:2px solid #909ea9;box-shadow:3px 4px 9px #273138;color:#12242e;max-width:100%;min-width:265px;font-size:11px;padding:7px}.dialog-title{margin:-7px -7px 8px;padding:4px;text-align:center;background:#646469;color:#f5f5f5}.dialog-title button{float:right;padding:0 4px}.native-dialog button{background:#9aa8b3;color:#142630;border:1px solid #c1c9cf;border-radius:5px;padding:3px 8px;margin:3px}.native-dialog label{display:block;margin:5px 0}.native-dialog input:not([type=checkbox]):not([type=radio]):not([type=range]),.native-dialog select{background:#aab8c2;border:1px solid #6a7984;color:#122631;padding:2px;width:100px}.native-dialog p{margin:8px 0;line-height:1.5;max-width:370px}.native-dialog table{border-collapse:collapse;font-size:10px}.native-dialog td,.native-dialog th{border:1px solid #a7b5bf;padding:5px;text-align:left}.rate-row{display:flex;gap:8px;align-items:center;margin:8px 0}.rate-row label{width:60px;white-space:nowrap}.rate-row input[type=range]{width:135px;accent-color:#bed6e4}.rate-row output{width:115px;white-space:nowrap}.apply-row{margin-top:13px;border-top:1px solid #b6c3cb;padding-top:5px}.apply-row label{display:flex;align-items:center;gap:5px}
</style>

<style scoped>
.juha-aman{font-size:13px}
.flight{font-size:13px;min-height:18px;padding:1px 3px;gap:5px;line-height:15px}
.flight strong{min-width:62px}.flight .type,.flight .delay{font-size:11px}.flight .ff-time{width:20px}
.drag-guide span{position:absolute;right:5px;top:-17px;background:#495055;padding:1px 4px;font-size:12px;color:#fff}.flight{transition:top 240ms ease-out}.flight.dragging{transition:none;z-index:8;box-shadow:0 2px 5px #17202999;cursor:grabbing}.flight .wake{font-size:12px;font-weight:bold;min-width:10px}.flight.boxed{z-index:6}.flight strong,.flight span{pointer-events:none}
.rate-button,.view-buttons button,.status-line,.status-line button,.column-heading,.menu-title{font-size:12px}
.view-buttons button{min-height:23px;line-height:19px}.updated,.pending-change,.timeline-foot,.tick span,.now-line span,.popup small{font-size:11px}
.popup{width:235px;font-size:13px}.popup button{padding:7px 8px}
.native-dialog{font-size:13px}.native-dialog table{font-size:12px}
.time-overview input{position:absolute;left:1px;top:25px;height:calc(100% - 55px);width:13px;writing-mode:vertical-lr;direction:rtl;accent-color:#a2b2be;opacity:.75;cursor:ns-resize}.time-overview span,.time-overview i{pointer-events:none}
</style>

<style scoped>
/* Compact native AMAN styling, with ESSA's single arrival/departure row. */
.juha-aman{background:#50585e;color:#d5dcdf;border:1px solid #738088;border-radius:5px;font-family:Consolas,'Lucida Console',monospace}
.toolbar{background:#8797a2;border:0;border-bottom:1px solid #a2b0b8;padding:0;gap:0;min-height:52px;color:#182c37;box-shadow:inset 0 1px #b3bec5;border-radius:4px 4px 0 0}
.toolbar>button{border:0;border-right:1px solid #aebbc3;border-radius:0;padding:8px 12px;justify-content:center;gap:4px}
.toolbar>button:hover{background:#96a7b2}.toolbar>button b{font-size:10px;letter-spacing:1px;color:#314955}
.configuration-button{min-width:112px;max-width:150px}.configuration-button span{font-size:15px;font-weight:bold}
.rate-button{flex:1;font-size:14px}.rate-button span{display:flex;gap:14px;align-items:center;flex-wrap:wrap}.rate-button small{font-size:11px;color:#2d4858}
.toolbar .tracks{font-size:11px;border-right:1px solid #a9b6be;min-width:56px;padding:7px 9px;line-height:1.55}.updated{padding:8px;color:#334e5e;font-size:11px}
.view-buttons{background:#50585e;padding:5px 4px;gap:4px;border-top:1px solid #647078}
.view-buttons button{background:#84939d;border:1px solid #a4b0b8;border-radius:9px;font-size:11px;min-height:21px;line-height:17px;padding:0 9px;box-shadow:inset 0 1px #bbc5cb;color:#152b38}
.view-buttons button.active{background:#87a9bd;color:#eff8fc;border-color:#bad0dc}.view-buttons button:hover{filter:brightness(1.1)}
.time-area,.flight{background:#50585e}.axis{background:#64727b33;border-color:#a8b5bd}.tick{border-color:#a8b5bd}.tick span{color:#bbc6cb;font-size:10px}.column-heading{font-size:11px;color:#d0dbe1;letter-spacing:.4px}.column-heading .inactive{opacity:.45}
.time-overview{background:#5e6c76;border-color:#8799a4;border-radius:3px;width:19px}.timeline-foot{color:#c0cbd0;border-top:1px solid #68777f;font-size:10px}.timeline-foot button{background:#75858f;border-color:#9cabb4;border-radius:4px;color:#e4ecef;padding:3px 5px;font-size:11px}
.now-line{border-color:#f04f57}.now-line span{background:#50585e;color:#ffb1b6}.status-line{background:#48545c;font-size:10px;border-color:#6d7f89;padding:4px 6px}.horizontal-slider{background:#5b6973;border-color:#7e909b}
.popup{background:#697e8a;border-color:#a8bdc8;border-radius:3px;box-shadow:3px 5px 12px #17202970}.menu-title{background:#92a6b2;padding:6px;font-size:12px}.native-dialog{background:#859aa7;border-color:#adbec8;border-radius:4px}.dialog-title{background:#5d7482;color:#f1f6f8;padding:6px}
.closure-gap{position:absolute;left:calc(var(--axis-x) - 113px);width:104px;background:repeating-linear-gradient(135deg,#a8515140 0 5px,#d5797938 5px 10px);border-left:2px solid #db8b83;border-right:1px solid #b97470;border-radius:2px;z-index:7;touch-action:none;user-select:none}
.closure-gap.right{left:calc(var(--axis-x) + 12px)}.closure-gap.adjusting{box-shadow:0 0 0 1px #f4c3a8;z-index:9}
.gap-body{position:absolute;inset:0;width:100%;height:100%;background:transparent;border:0;color:#ffe1d5;padding:0;display:flex;align-items:center;justify-content:center;gap:6px;cursor:grab;touch-action:none;font-size:10px;font-weight:bold}
.gap-body>span{position:absolute;left:calc(100% + 5px);top:50%;transform:translateY(-50%);background:#654746;border:1px solid #c98b7d;border-radius:3px;padding:3px 5px;white-space:nowrap;box-shadow:1px 2px 4px #1a232744}.gap-body:active{cursor:grabbing}.gap-body small{font-size:9px;font-weight:normal}.gap-handle{position:absolute;left:-2px;width:calc(100% + 3px);height:9px;border:0;border-top:2px solid #efad96;background:transparent;cursor:ns-resize;touch-action:none;z-index:2;padding:0}
.gap-handle.end{top:-4px}.gap-handle.begin{bottom:-5px}.gap-handle span{position:absolute;right:0;white-space:nowrap;background:#50585eed;border-radius:2px;padding:1px 3px;color:#efc4b4;font-size:10px;pointer-events:none}.gap-handle.end span{bottom:9px}.gap-handle.begin span{top:5px}
.gap-handle:hover{border-color:#ffe5c9;background:#edb39766}.gap-body:hover{background:#b9666633}.gap-handle:disabled{cursor:default}
@media(max-width:600px){.toolbar>button{padding:7px 8px}.configuration-button{min-width:100px}.rate-button span{gap:4px}.toolbar .tracks{min-width:42px;padding:6px}.updated{display:none}}
</style>

<style scoped>
.time-anchors{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:2}.time-anchors line{stroke-width:1;opacity:.8}
</style>

<style scoped>
/* Rounded boxes; retain the existing blue-grey palette. */
.toolbar{padding:4px;gap:4px;border-radius:7px 7px 0 0}.toolbar>button{border:2px solid #aebbc3;border-radius:10px;padding:7px 10px;box-shadow:none}.toolbar .tracks{border:2px solid #a9b6be;border-radius:10px;min-width:56px;padding:6px 8px}.updated{border:2px solid #a9b6be;border-radius:10px;padding:12px 8px;align-self:stretch;display:flex;align-items:center}.view-buttons{gap:7px;padding:6px 4px}.view-buttons button{border-width:2px;border-radius:9px;min-height:28px;line-height:22px;padding:0 10px;font-size:13px}.flight{z-index:10}.flight.boxed{z-index:11}.flight.dragging{z-index:12}
</style>

<style scoped>
.timeline-strip{touch-action:none;user-select:none}
.recompute-box{position:absolute;z-index:13;border:1px dashed #e5eef4;background:#8797a233;pointer-events:none}
</style>

<style scoped>
.change-time-marker{position:absolute;left:calc(var(--axis-x) - 26px);width:32px;height:2px;background:#f0e129;z-index:6;pointer-events:none;transform:translateY(-50%)}
.rate-row output{width:auto;min-width:125px;line-height:1.5}
.apply-row input[type=range]{width:100%;accent-color:#f0e129;cursor:ew-resize}
.apply-range{display:flex;justify-content:space-between;font-size:11px}
</style>

<style scoped>
.time-overview{padding:0;border-radius:8px;overflow:hidden;touch-action:none;cursor:ns-resize;user-select:none}
.time-overview:focus-visible{outline:1px solid #ccefff;outline-offset:-2px}
.overview-window{position:absolute;left:0;right:0;border:1px solid #aebbc3;border-radius:5px;background:#a2b2be44;z-index:1;cursor:grab;min-height:14px}
.overview-window:active{cursor:grabbing}
.overview-flight{position:absolute;left:2px;right:2px;height:1px;z-index:2;transform:translateY(-50%);pointer-events:none}
.time-overview .overview-now{border-top:2px solid #ff3030;z-index:3;pointer-events:none}
</style>

<style scoped>
.configuration-button{max-width:none;min-width:140px}
.pill-arrow{font-style:normal;font-size:17px;margin:0 6px;color:#f0e129}
.pill-next{font-weight:normal;white-space:nowrap}
.pill-change-time{font-size:11px;white-space:nowrap;margin-left:6px}
.configuration-button .pill-change-time{margin-left:0}
.change-time-marker.rate{height:0;background:none;border-top:2px dashed #f0e129}
</style>

<style scoped>
/* Keep all closure captions within their own runway half-column. */
.gap-body>span{left:50%;top:50%;transform:translate(-50%,-50%);max-width:calc(100% - 8px);white-space:normal;text-align:center;box-sizing:border-box;font-size:10px;padding:3px}
.gap-handle span{right:2px;max-width:calc(100% - 4px);box-sizing:border-box;font-size:9px;padding:1px;white-space:nowrap}
.gap-handle.end span{bottom:auto;top:var(--end-caption-top)}.gap-handle.begin span{top:auto;bottom:var(--begin-caption-bottom)}
</style>

<style scoped>
/* Stronger aircraft lettering, matching the reference's compact bold labels. */
.flight.right{flex-direction:row-reverse}
.flight{font-family:Arial,Tahoma,sans-serif;font-size:14px;font-weight:600;line-height:17px;min-height:19px;padding:1px 3px;gap:5px}
.flight strong{font-size:14px;font-weight:700;min-width:65px;letter-spacing:.15px}
.flight .ff-time{font-size:14px;font-weight:700;width:21px;font-variant-numeric:tabular-nums}
.flight .wake{font-size:13px;font-weight:700}
.flight .delay,.flight .type{font-size:12px;font-weight:700}
</style>

<style scoped>
/* Use one readable type treatment throughout the AMAN, including controls. */
.juha-aman,.juha-aman :deep(*){font-family:Arial,Tahoma,sans-serif!important;font-size:14px!important;font-weight:700!important;line-height:1.25!important}
.toolbar .tracks{min-width:88px}.toolbar>button b{letter-spacing:.3px}
.tick span{top:-9px}.horizontal-slider{height:23px}.timeline-foot{height:28px}
.closure-gap{width:130px;left:calc(var(--axis-x) - 139px)}.closure-gap.right{left:calc(var(--axis-x) + 12px)}
.gap-body>span{padding:2px 3px}.gap-handle span{padding:1px 2px}
.rate-row label{width:80px}.rate-row output{min-width:145px}
.native-dialog{min-width:300px}.native-dialog table{max-width:100%}
</style>

<style scoped>
.axis{width:12px;left:calc(var(--axis-x) - 3px);background:#76838c33;border-color:#b3c0c8}
.tick{left:calc(var(--axis-x) - 3px);width:12px}.tick.major{left:calc(var(--axis-x) - 6px);width:18px}
.timeline-foot{justify-content:center;gap:7px;border-top:0}
.timeline-foot .column-clock{width:96px;min-height:25px;border:2px solid #aebbc3;border-radius:7px;background:#75858f;box-shadow:inset 0 1px #bec9cf;padding:1px 3px;font-variant-numeric:tabular-nums}
.foot-left,.foot-right{width:55px}.foot-left{text-align:right}.foot-right{text-align:left}
.movable-dialog-shade{background:transparent;pointer-events:none}.movable-dialog{pointer-events:auto}
.movable-dialog .dialog-title{cursor:move;touch-action:none;user-select:none}
</style>

<style scoped>
/* A readable ladder, with minute numbers inside its two rails. */
.axis{width:34px;left:calc(var(--axis-x) - 14px)}
.tick,.tick.major{left:calc(var(--axis-x) - 14px);width:34px}
.tick,.tick.major{border-top:0}.tick::before,.tick::after{content:'';position:absolute;top:0;width:5px;border-top:1px solid #b3c0c8}.tick::before{left:0}.tick::after{right:0}
.tick span{left:0;right:0;top:-9px;width:34px;text-align:center}
.flight{right:calc(var(--column-width) / 2 + 20px);max-width:calc(var(--column-width) / 2 - 25px)}
.flight.right{left:calc(var(--axis-x) + 27px);right:auto}
.flight,.flight:hover,.flight:focus,.flight.dragging{background:transparent!important;border-color:transparent!important;box-shadow:none!important}
.flight.boxed strong{text-decoration:underline;text-underline-offset:3px}
.scrolling-time .flight{transition:none!important}
.change-time-marker{left:calc(var(--axis-x) - 14px);width:34px}
.closure-gap{left:calc(var(--axis-x) - 151px)}.closure-gap.right{left:calc(var(--axis-x) + 27px)}
</style>

<style scoped>
.change-time-marker,.change-time-marker.rate{height:4px;background:#f0e129;border:0}
.change-time-marker.preview,.change-time-marker.rate.preview{height:0;background:none;border-top:4px dotted #f0e129}
.native-dialog select[data-input=arrival-profile]{width:100%;max-width:360px}.native-dialog td{overflow-wrap:anywhere}
</style>

<style scoped>
.flight-menu,.timeline-menu,.recompute-menu{box-sizing:border-box;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain}
</style>

<style scoped>
.view-buttons .errors-button{width:96px;min-width:96px;flex-shrink:0;font-variant-numeric:tabular-nums}
</style>

<style scoped>
.horizontal-slider{height:17px;min-height:17px;flex-shrink:0;box-sizing:border-box;padding:0;border:1px solid #7e8a91;border-radius:8px;background:#68747b;overflow:hidden}
.horizontal-slider input[type=range]{appearance:none;-webkit-appearance:none;margin:0;width:100%;height:100%;background:transparent;cursor:ew-resize}
.horizontal-slider input[type=range]:disabled{opacity:1;cursor:default}
.horizontal-slider input[type=range]::-webkit-slider-runnable-track{height:15px;background:transparent;border:0;border-radius:8px}
.horizontal-slider input[type=range]::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:var(--horizontal-thumb-width);height:15px;box-sizing:border-box;border:1px solid #aebbc3;border-radius:5px;background:#a2b2be44;box-shadow:none}
.horizontal-slider input[type=range]::-moz-range-track{height:15px;background:transparent;border:0;border-radius:8px}
.horizontal-slider input[type=range]::-moz-range-thumb{width:var(--horizontal-thumb-width);height:13px;box-sizing:border-box;border:1px solid #aebbc3;border-radius:5px;background:#a2b2be44;box-shadow:none}
</style>

<style scoped>
.change-time-marker.preview{border-top-style:solid!important}.closure-gap{background:#9d2020;border:2px solid #ef5555}.closure-gap.hollow{background:transparent}
.native-dialog[data-dialog=information]{width:calc(100% - 20px);min-width:0}.popup.flight-menu{max-height:calc(100% - 10px);overflow-y:auto}
.coordination-launch{position:absolute;left:25px;top:4px;z-index:9;background:#899da9;color:#142630;border:1px solid #b3c3cc;border-radius:4px;padding:3px 7px}
.coordination-menu{position:absolute;top:125px;left:25px;max-height:calc(100% - 130px);overflow:auto;z-index:25;width:285px}
</style>

<style scoped>.closure-gap.hollow .gap-body{background:transparent}.change-time-marker.preview,.change-time-marker.rate.preview{border-top:4px solid #f0e129!important}</style>

<style scoped>.display{position:relative}</style>

<style scoped>.flight>span{flex-shrink:0}.flight strong{min-width:40px;overflow:hidden;text-overflow:ellipsis;flex-shrink:1}</style>

<style scoped>
.native-dialog{max-height:calc(100% - 8px);overflow:auto;max-width:calc(100% - 8px)}
.submenu-choice{display:block;min-width:140px;text-align:left}
.menu-title{cursor:move;touch-action:none;user-select:none}
.coordination-menu{max-height:calc(100% - 8px)}
.manual-flight-lists{display:flex;gap:12px;min-width:310px;margin-bottom:12px}
.manual-flight-lists section{flex:1;min-width:0}.manual-flight-lists h3{font:inherit;margin:0 0 5px}
.flight-list{height:125px;overflow:auto;border:1px solid #b2c1ca;background:#6c818e}.flight-list button{display:block;width:100%;margin:0;border:0;border-radius:0;text-align:left;background:transparent}.flight-list button.chosen{background:#387da3;color:white}.flight-list span{display:block;padding:6px}
</style>

<style scoped>
.flight.selected{border-color:#f0f8ff!important;background:#819ba955!important;box-shadow:0 0 0 1px #192b35!important;z-index:14}
.flight.swap-target{border-color:#ffe57a!important;background:#91854444!important;box-shadow:0 0 0 1px #ffe57a!important}
.placement-marker{position:absolute;width:22px;height:22px;transform:translateY(-50%);color:#ffe57a;z-index:18;pointer-events:none;filter:drop-shadow(0 1px 1px #172029)}
.placement-marker.right:not(.swap){transform:translateY(-50%) scaleX(-1)}
.placement-marker svg{width:100%;height:100%;fill:currentColor}
.placement-marker.swap svg{fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
</style>

<style scoped>
/* Keep close controls in the title bar, independent of form-button spacing. */
.dialog-title,.menu-title{position:relative;box-sizing:border-box;min-height:30px;padding:6px 34px;line-height:18px;text-align:center}
.dialog-title>button,.menu-title>button{position:absolute;right:4px;top:50%;transform:translateY(-50%);float:none;display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:22px;height:22px;min-height:0;margin:0;padding:0;line-height:1;font-size:14px}
</style>
