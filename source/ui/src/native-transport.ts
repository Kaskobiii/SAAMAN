import axios from 'axios'
import {DEFAULT_CONFIG,runEngine,validateConfig,validateEdits,validateTelemetry,validateLockedEdits,toJuhaSequence,toTopSkySequence,reconcileRunwayAssignments,euroscopeInstruction,migrateSequenceEdits} from './maestro-engine'
import {mergeSharedSettings,settingsUnchanged} from './maestro-settings'
import {nativeRequest} from './native-rpc'
import {captureRecentDiagnostics} from './native-diagnostics'
import {APPLICATION_BUILD} from './build'
import {SharedRelay} from './shared-relay'
import {publicationBody} from './shared-http'
import {LegacyRelay} from './legacy-relay'
import {pruneRetiredLiveEdits} from './maestro-live-lifecycle'
import {elapsedNow,operationNow,publicationAge,SharedClock,setOperationClock,type PublicationTiming} from './shared-clock'
export const BUILD=APPLICATION_BUILD
let relay:SharedRelay|null=null
let relaySuspended=false
let relayAuth:()=>{token:string;cid:number|null;callsign?:string;supervisor?:(callsign:string,cid?:number)=>Promise<boolean>;ready?:boolean;headers?:Record<string,string>;error?:string;compactPublication?:boolean;gzipPublication?:boolean}=()=>({token:'',cid:null})
const authenticated=()=>relayAuth().ready??!!relayAuth().token
export function configureRelayAuth(provider:typeof relayAuth){relayAuth=provider}
export function relayState(){return relay?.view()}
export async function leaveSharedRoom(){if(relay)await relay.leave()}
export function suspendSharedRoom(value:boolean){relaySuspended=value;if(value&&authenticated())void relay?.setObserver(true).catch(()=>{})}
function announceRelay(clockSynchronized:boolean,error='',retryableTransport=false){
    if(!relay)return
    const plan=relay.view(),at=operationNow()
    if(!(window as any).__SAAMAN_HOST__?.browser)captureRecentDiagnostics({
        at,snapshot:plan.snapshot,config:plan.config,edits:plan.edits,context:plan.recordingContext,
        snapshotAgeMs:plan.snapshotAgeMs,clockSynchronized,backendMinusLocalMs:clockSynchronized?at-Date.now():undefined,error,
    })
    window.dispatchEvent(new CustomEvent('saaman-relay',{detail:{...plan,relayError:error,retryableTransport}}))
}
async function relayApi(method:string,path:string,body:any={}){
    if(!relay)throw new Error('Shared room is not configured')
    if(method==='GET'&&path==='/maestro/ESSA/supervision')return relay.supervision()
    if(method==='PUT'&&path==='/maestro/ESSA/settings')return relay.saveSettings(body.revision,body.settings)
    if(method==='POST'&&path==='/maestro/ESSA/master')return relay.setObserver(body.release===true)
    if(method==='POST'&&path==='/maestro/ESSA/coordination')return relay.coordinate(body.message,body.acknowledge)
    if(method==='PUT'&&path==='/maestro/ESSA')return relay.edit(body.revision,body.edits,body.config,body.takeSequencer===true)
    if(method==='GET'&&path==='/maestro/ESSA')return relay.tick()
    throw new Error('Unsupported shared plugin operation')
}
async function state(){const plan=await nativeRequest('plan:get');return {...plan,config:validateConfig({...DEFAULT_CONFIG,...plan.config??{}}),edits:migrateSequenceEdits(plan.edits||{},plan.snapshot),stale:!plan.snapshot||Date.now()-plan.snapshot.timestamp>30000}}
async function observeLocalPlan(){
    const plan=await state()
    if((window as any).__SAAMAN_HOST__?.view==='aman')captureRecentDiagnostics({
        at:operationNow(),snapshot:plan.snapshot,config:plan.config,edits:plan.edits,
        context:{room:'local/ESSA',role:'local',revision:plan.revision,stale:plan.stale},
    })
    return plan
}
async function localApi(method:string,path:string,body:any={}){
    if(path==='/aman-preview-health')return {applicationBuild:BUILD}
    if(method==='GET'&&['/maestro/ESSA','/maestro/ESSA/supervision'].includes(path))return state()
    if(method==='POST'&&path==='/maestro/ESSA/master'){await nativeRequest('plan:claim',body);return state()}
    const plan=await state()
    if(method==='POST'&&path==='/maestro/ESSA/telemetry'){
        const telemetry=validateTelemetry(body),edits=reconcileRunwayAssignments(telemetry,plan.edits,plan.snapshot),snapshot=runEngine(telemetry,plan.config,edits,plan.snapshot||undefined)
        await nativeRequest('plan:snapshot',{revision:plan.revision,snapshot,telemetry,edits:pruneRetiredLiveEdits(edits,snapshot)});return observeLocalPlan()
    }
    if(method==='PUT'&&['/maestro/ESSA','/maestro/ESSA/settings'].includes(path)){
        if(body.revision!==plan.revision)throw Object.assign(new Error('Shared plan changed; reload and retry'),{status:409})
        const settings=path.endsWith('/settings')
        const config=settings?mergeSharedSettings(plan.config,body.settings):validateConfig(body.config)
        const edits=settings?plan.edits:validateEdits(body.edits)
        if(!settings&&!settingsUnchanged(plan.config,config))throw Object.assign(new Error('Use the separate supervisory window'),{status:403})
        if(!settings)validateLockedEdits(plan.snapshot,plan.edits,edits,config)
        const previous=plan.snapshot?{...plan.snapshot,timestamp:plan.snapshot.timestamp-1}:undefined
        const snapshot=plan.telemetry?runEngine(plan.telemetry,config,edits,previous):null
        await nativeRequest(settings?'plan:settings':'plan:update',{revision:plan.revision,config,edits:snapshot?pruneRetiredLiveEdits(edits,snapshot):edits,snapshot});return observeLocalPlan()
    }
    if(method==='GET'&&path==='/maestro/MAESTRO_sequence_data_ESSA.json')return toJuhaSequence(plan.snapshot??{timestamp:Date.now(),source:'EMPTY',flights:[],diagnostics:[]},plan.config,plan.edits)
    throw new Error('Unsupported native API operation')
}
export async function installNativeTransport(){
    const info=await nativeRequest('host:info')
    ;(window as any).__SAAMAN_HOST__=info;(window as any).__SAAMAN_LOCAL__=!info.shared
    const defaultAdapter=axios.getAdapter(axios.defaults.adapter!)
    const sharedClock=info.shared?new SharedClock():undefined
    setOperationClock(sharedClock)
    if(info.shared){
        const send=async(method:string,path:string,body?:any,timing?:(value:PublicationTiming)=>void)=>{
                if(info.browser===true&&method==='PUT')throw Object.assign(new Error('Browser connections cannot publish sequence calculations'),{status:403})
                const auth=relayAuth();if(!authenticated())throw Object.assign(new Error(auth.error||'Waiting for controller identity'),{status:401})
                let result
                const operation=path.endsWith('/poll')?'poll':path.endsWith('/command')?'controller edit':path.endsWith('/settings')?'settings':method==='PUT'?'publication':'request'
                const encoded=body===undefined?{data:undefined,compressed:false}:await publicationBody(JSON.stringify(body),operation==='publication'&&info.authProvider==='keys'&&relayAuth().gzipPublication===true)
                const headers=axios.AxiosHeaders.from({...auth.headers??{Authorization:`Bearer ${auth.token}`},'Content-Type':'application/json'})
                if(encoded.compressed)headers.set('Content-Encoding','gzip')
                const timeout=info.authProvider==='vatiris-callsign'?12000:5000
                const sent=elapsedNow()
                try{result=await defaultAdapter({method,url:info.backendBaseUrl+path,headers,data:encoded.data,timeout,validateStatus:()=>true})}
                catch(e:any){
                    if(['ECONNABORTED','ETIMEDOUT'].includes(e.code))throw Object.assign(new Error(`Shared backend ${operation} timed out after ${timeout/1000} seconds; waiting for a fresh connection`),{status:504,retryableTransport:true})
                    if(e.code==='ERR_NETWORK')throw Object.assign(new Error(`Cannot reach shared backend for ${operation}; check its HTTPS address and connection`),{status:503,retryableTransport:true})
                    throw e
                }
                const received=elapsedNow()
                let data:any=result.data
                const responseHeader=(name:string)=>result.headers instanceof axios.AxiosHeaders?result.headers.get(name):result.headers[name]
                if(typeof data==='string'){
                    try{data=JSON.parse(data)}catch{
                        if(result.status<400&&!path.endsWith('/leave'))throw Object.assign(new Error('Invalid response from the shared backend'),{status:502})
                    }
                }
                const timestampHeader=responseHeader('x-saaman-server-time')
                const ageHeader=responseHeader('x-saaman-publication-age')
                const serverTimeMs=typeof data?.serverTimeMs==='number'?data.serverTimeMs:typeof timestampHeader==='string'?Number(timestampHeader):NaN
                const age=publicationAge(data?.publicationAgeMs)??(typeof ageHeader==='string'&&ageHeader!==''?publicationAge(Number(ageHeader)):undefined)
                sharedClock!.observe(serverTimeMs,sent,received)
                if(result.status>=400){
                    const message=typeof data==='string'&&data.length<400?data:data?.error
                    throw Object.assign(new Error(message||'Shared AMAN unavailable'),{status:result.status,response:{status:result.status,data},retryableTransport:[502,503,504].includes(result.status)})
                }
                timing?.({serverTimeMs,publicationAgeMs:age,freshRoomRead:method==='GET'&&/^\/aman\/(live|sweatbox[12])\/ESSA$/.test(path)})
                if(info.authProvider==='keys'&&data&&age!==undefined)return {...data,publicationAgeMs:age}
                return data
        }
        const now=()=>sharedClock!.now()
        const legacy=info.authProvider==='vatiris-callsign'?new LegacyRelay({network:info.relay.network,instanceId:info.instanceId,editorOnly:info.browser===true,send,now,elapsed:elapsedNow,callsign:()=>relayAuth().callsign||'',cid:()=>relayAuth().cid,supervisor:(callsign,cid)=>relayAuth().supervisor?.(callsign,cid)??Promise.resolve(false)}):null
        relay=new SharedRelay({...info.relay,instanceId:info.instanceId},{editorOnly:info.browser===true,cid:()=>relayAuth().cid,telemetry:()=>nativeRequest('telemetry:get'),now,wallNow:Date.now,elapsed:elapsedNow,serverClockReady:()=>sharedClock!.synchronized,compactPublication:()=>info.authProvider==='keys'&&relayAuth().compactPublication===true,send:(method,path,body)=>legacy?legacy.send(method,path,body):send(method,path,body)})
        if(info.view==='aman'){
            let running=false
            const refresh=async()=>{
                if(running)return
                if(!authenticated()||relaySuspended){
                    const error=relaySuspended?'Shared connection paused':relayAuth().error||'Waiting for controller identity'
                    if(!relaySuspended)window.dispatchEvent(new CustomEvent('saaman-relay',{detail:{relayError:error}}))
                    if(!info.browser){
                        captureRecentDiagnostics({at:operationNow(),error,clockSynchronized:sharedClock!.synchronized})
                        try{await nativeRequest('timing:set',{airport:'ESSA',generatedAt:Date.now(),nativeSequence:null,flights:[]})}catch{}
                    }
                    return
                }
                running=true
                try{await relay!.tick();announceRelay(sharedClock!.synchronized)}catch(e:any){announceRelay(sharedClock!.synchronized,e.message,e.retryableTransport===true)}finally{running=false}
                const plan=relay!.view(),snapshot=plan.snapshot
                if(!info.browser)try{await nativeRequest('timing:set',{airport:'ESSA',generatedAt:Date.now(),nativeSequence:snapshot?toTopSkySequence(snapshot,plan.config,plan.edits):null,flights:snapshot?snapshot.flights.filter(f=>f.arrival==='ESSA'&&f.mode==='sequenced'&&!f.issue&&!f.lost).map(f=>({callsign:f.callsign,deltaSeconds:euroscopeInstruction(f)})):[]})}catch{ /* Next fresh pulse retries local guidance. */ }
            }
            const clock=setInterval(()=>void refresh(),2000)
            window.addEventListener('saaman-pulse',()=>void refresh())
            window.addEventListener('beforeunload',()=>{clearInterval(clock);void relay?.leave().catch(()=>{})})
        }
    }
    axios.defaults.adapter=async config=>{
        const url=new URL(config.url!,config.baseURL||location.origin)
        const sharedPath=info.shared&&url.origin===new URL(info.backendBaseUrl).origin&&url.pathname.startsWith('/maestro/')
        if(!sharedPath&&(!(window as any).__SAAMAN_LOCAL__||url.origin!==location.origin))return defaultAdapter(config)
        try{return {data:await (sharedPath?relayApi:localApi)((config.method||'GET').toUpperCase(),url.pathname,typeof config.data==='string'?JSON.parse(config.data):config.data),status:200,statusText:'OK',headers:{},config}}
        catch(error:any){throw Object.assign(error,{response:{status:error.status||400,data:{error:error.message}}})}
    }
    const browserFetch=window.fetch.bind(window)
    window.fetch=async(input,init)=>{
        const request=new Request(input,init),url=new URL(request.url)
        if(url.origin==='http://127.0.0.1:17777'){
            try{const result=url.pathname==='/telemetry'?await nativeRequest('telemetry:get'):url.pathname==='/timing'&&request.method==='PUT'?await nativeRequest('timing:set',await request.json()):null
                return Response.json(result,{status:result===null?404:200})
            }catch(e:any){return Response.json({error:e.message},{status:500})}
        }
        if((window as any).__SAAMAN_LOCAL__&&url.origin===location.origin&&url.pathname==='/aman-preview-health')return Response.json({applicationBuild:BUILD})
        return browserFetch(input,init)
    }
    if(!info.shared){const plan=await state();await nativeRequest('plan:init',{config:plan.config})}
    return info
}
