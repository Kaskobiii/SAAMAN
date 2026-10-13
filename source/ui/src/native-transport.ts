import axios from 'axios'
import {DEFAULT_CONFIG,runEngine,validateConfig,validateEdits,validateTelemetry,validateLockedEdits,toJuhaSequence,reconcileRunwayAssignments,euroscopeInstruction,migrateSequenceEdits} from './maestro-engine'
import {mergeSharedSettings,settingsUnchanged} from './maestro-settings'
import {nativeRequest} from './native-rpc'
import {APPLICATION_BUILD} from './build'
import {SharedRelay} from './shared-relay'
import {publicationBody} from './shared-http'
import {LegacyRelay} from './legacy-relay'
export const BUILD=APPLICATION_BUILD
let relay:SharedRelay|null=null
let relaySuspended=false
let relayAuth:()=>{token:string;cid:number|null;callsign?:string;supervisor?:(callsign:string,cid?:number)=>Promise<boolean>;ready?:boolean;headers?:Record<string,string>;error?:string;compactPublication?:boolean;gzipPublication?:boolean}=()=>({token:'',cid:null})
const authenticated=()=>relayAuth().ready??!!relayAuth().token
export function configureRelayAuth(provider:typeof relayAuth){relayAuth=provider}
export function relayState(){return relay?.view()}
export async function leaveSharedRoom(){if(relay)await relay.leave()}
export function suspendSharedRoom(value:boolean){relaySuspended=value;if(value&&authenticated())void relay?.setObserver(true).catch(()=>{})}
function announceRelay(error=''){
    if(!relay)return
    window.dispatchEvent(new CustomEvent('saaman-relay',{detail:{...relay.view(),relayError:error}}))
}
async function relayApi(method:string,path:string,body:any={}){
    if(!relay)throw new Error('Shared room is not configured')
    if(method==='GET'&&path==='/maestro/ESSA/supervision')return relay.supervision()
    if(method==='PUT'&&path==='/maestro/ESSA/settings')return relay.saveSettings(body.revision,body.settings)
    if(method==='POST'&&path==='/maestro/ESSA/master')return relay.setObserver(body.release===true)
    if(method==='POST'&&path==='/maestro/ESSA/coordination')return relay.coordinate(body.message,body.acknowledge)
    if(method==='PUT'&&path==='/maestro/ESSA')return relay.edit(body.revision,body.edits,body.config)
    if(method==='GET'&&path==='/maestro/ESSA')return relay.tick()
    throw new Error('Unsupported shared plugin operation')
}
async function state(){const plan=await nativeRequest('plan:get');return {...plan,config:validateConfig(plan.config||DEFAULT_CONFIG),edits:migrateSequenceEdits(plan.edits||{},plan.snapshot),stale:!plan.snapshot||Date.now()-plan.snapshot.timestamp>30000}}
async function localApi(method:string,path:string,body:any={}){
    if(path==='/aman-preview-health')return {applicationBuild:BUILD}
    if(method==='GET'&&['/maestro/ESSA','/maestro/ESSA/supervision'].includes(path))return state()
    if(method==='POST'&&path==='/maestro/ESSA/master'){await nativeRequest('plan:claim',body);return state()}
    const plan=await state()
    if(method==='POST'&&path==='/maestro/ESSA/telemetry'){
        const telemetry=validateTelemetry(body),edits=reconcileRunwayAssignments(telemetry,plan.edits,plan.snapshot),snapshot=runEngine(telemetry,plan.config,edits,plan.snapshot||undefined)
        await nativeRequest('plan:snapshot',{revision:plan.revision,snapshot,telemetry,edits});return state()
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
        await nativeRequest(settings?'plan:settings':'plan:update',{revision:plan.revision,config,edits,snapshot});return state()
    }
    if(method==='GET'&&path==='/maestro/MAESTRO_sequence_data_ESSA.json')return toJuhaSequence(plan.snapshot??{timestamp:Date.now(),source:'EMPTY',flights:[],diagnostics:[]},plan.config,plan.edits)
    throw new Error('Unsupported native API operation')
}
export async function installNativeTransport(){
    const info=await nativeRequest('host:info')
    ;(window as any).__SAAMAN_HOST__=info;(window as any).__SAAMAN_LOCAL__=!info.shared
    const defaultAdapter=axios.getAdapter(axios.defaults.adapter!)
    if(info.shared){
        const send=async(method:string,path:string,body?:any)=>{
                const auth=relayAuth();if(!authenticated())throw Object.assign(new Error(auth.error||'Waiting for controller identity'),{status:401})
                let result
                const operation=path.endsWith('/poll')?'poll':path.endsWith('/command')?'controller edit':path.endsWith('/settings')?'settings':method==='PUT'?'publication':'request'
                const encoded=body===undefined?{data:undefined,compressed:false}:await publicationBody(JSON.stringify(body),operation==='publication'&&info.authProvider==='keys'&&relayAuth().gzipPublication===true)
                const headers=axios.AxiosHeaders.from({...auth.headers??{Authorization:`Bearer ${auth.token}`},'Content-Type':'application/json'})
                if(encoded.compressed)headers.set('Content-Encoding','gzip')
                const timeout=info.authProvider==='vatiris-callsign'?12000:5000
                try{result=await defaultAdapter({method,url:info.backendBaseUrl+path,headers,data:encoded.data,timeout,validateStatus:()=>true})}
                catch(e:any){
                    if(['ECONNABORTED','ETIMEDOUT'].includes(e.code))throw Object.assign(new Error(`Shared backend ${operation} timed out after ${timeout/1000} seconds; waiting for a fresh connection`),{status:504})
                    if(e.code==='ERR_NETWORK')throw Object.assign(new Error(`Cannot reach shared backend for ${operation}; check its HTTPS address and connection`),{status:503})
                    throw e
                }
                let data:any=result.data
                if(typeof data==='string'){try{data=JSON.parse(data)}catch{if(result.status>=400)throw Object.assign(new Error(data.length<400?data:'Shared AMAN unavailable'),{status:result.status});if(!path.endsWith('/leave'))throw Object.assign(new Error('Invalid response from the shared backend'),{status:502})}}
                if(result.status>=400)throw Object.assign(new Error(data?.error||'Shared AMAN unavailable'),{status:result.status,response:{status:result.status,data}})
                return data
        }
        const legacy=info.authProvider==='vatiris-callsign'?new LegacyRelay({network:info.relay.network,instanceId:info.instanceId,send,callsign:()=>relayAuth().callsign||'',cid:()=>relayAuth().cid,supervisor:(callsign,cid)=>relayAuth().supervisor?.(callsign,cid)??Promise.resolve(false)}):null
        relay=new SharedRelay({...info.relay,instanceId:info.instanceId},{cid:()=>relayAuth().cid,telemetry:()=>nativeRequest('telemetry:get'),compactPublication:()=>info.authProvider==='keys'&&relayAuth().compactPublication===true,send:(method,path,body)=>legacy?legacy.send(method,path,body):send(method,path,body)})
        if(info.view==='aman'){
            let running=false
            const refresh=async()=>{
                if(running)return
                if(!authenticated()||relaySuspended){if(!relaySuspended)window.dispatchEvent(new CustomEvent('saaman-relay',{detail:{relayError:relayAuth().error||'Waiting for controller identity'}}));try{await nativeRequest('timing:set',{airport:'ESSA',generatedAt:Date.now(),nativeSequence:null,flights:[]})}catch{};return}
                running=true
                try{await relay!.tick();announceRelay()}catch(e:any){announceRelay(e.message)}finally{running=false}
                const plan=relay!.view(),snapshot=plan.snapshot
                try{await nativeRequest('timing:set',{airport:'ESSA',generatedAt:Date.now(),nativeSequence:snapshot?toJuhaSequence(snapshot,plan.config,plan.edits):null,flights:snapshot?snapshot.flights.filter(f=>f.arrival==='ESSA'&&f.mode==='sequenced'&&!f.issue&&!f.lost).map(f=>({callsign:f.callsign,deltaSeconds:euroscopeInstruction(f)})):[]})}catch{ /* Next fresh pulse retries local guidance. */ }
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
