import type {EngineSnapshot,EngineConfig,FlightEdit,Telemetry,TelemetryFlight} from './maestro-engine'
import {APPLICATION_BUILD} from './build'
import {predictRouteTiming,type RouteTiming} from './maestro-route-timing'
const fields=['callsign','aircraft','wake','departure','arrival','runway','landingSeconds','distanceNm','groundspeed','altitude','speedDataValid','dataWarnings','star','routeText','verticalSpeed','assignedSpeed','assignedMach','finalAltitude','clearedAltitude','arrivalProfile','heading','assignedHeading','direct','routeProblem','latitude','longitude','threshold','positionAgeSeconds','calculatedRouteIndex','topskyMissedApproach','topskyHoldingPoint'] as const
export function recordedTelemetry(snapshot:EngineSnapshot):Telemetry {
    if(!snapshot.observedCallsigns)throw Error('This snapshot lacks the recording metadata; use SAAMAN 1.0.20 or newer')
    const present=new Set(snapshot.observedCallsigns)
    const entries=snapshot.flights.filter(f=>present.has(f.callsign)).map(f=>{
        const p=Object.fromEntries(fields.filter(k=>f[k]!==undefined).map(k=>[k,f[k]])) as unknown as TelemetryFlight
        p.runway=f.euroscopeRunway??f.runway;p.landingSeconds=f.originalLandingSeconds??f.landingSeconds;p.route=f.route
        return p
    })
    const byCallsign=new Map([...entries,...snapshot.unlistedTelemetry??[]].map(p=>[p.callsign,p]))
    const flights=snapshot.observedCallsigns.map(name=>{const p=byCallsign.get(name);if(!p)throw Error('Incomplete telemetry recording');return p})
    return {source:snapshot.source,timestamp:snapshot.timestamp,simulation:snapshot.simulation,terminatedCallsigns:snapshot.terminatedCallsigns,knownFlights:snapshot.knownFlights,winds:snapshot.winds,runways:snapshot.runways,activeRunways:snapshot.activeRunways,flights}
}
type RecordedFrame={input:any;plan:number;controlCheckpoint?:EngineSnapshot;results:{callsign:string;mode:string;state:number;order:number;eta:number;sta:number;delay:number}[]}
export interface TimingCapture {
 callsign:string;at:number;frame:number;plan:number;kind:'initial'|'recompute'|'recapture'
 baseline:NonNullable<EngineSnapshot['flights'][number]['euroscopeBaseline']>;candidate?:RouteTiming
}
export class SessionRecording {
    private routes:any[]=[];private plans:any[]=[];private routeIds=new Map<string,number>();private planIds=new Map<string,number>()
    private inventories:any[][]=[];private inventoryIds=new Map<string,number>()
    private frames:RecordedFrame[]=[];private bytes=0;private initial:EngineSnapshot|null=null
    private timingCaptures:TimingCapture[]=[];private captureKeys=new Set<string>()
    private unavailableCaptures:{callsign:string;at:number;reason:'before-recording'}[]=[]
    active=false;status='';get count(){return this.frames.length}
    constructor(private maxBytes=64*1024*1024,private maxFrames=18000){}
    start(snapshot:EngineSnapshot,config:EngineConfig,edits:Record<string,FlightEdit>){
        recordedTelemetry(snapshot)
        this.timingCaptures=[];this.captureKeys.clear()
        this.unavailableCaptures=snapshot.flights.filter(f=>f.euroscopeBaseline&&f.euroscopeBaseline.at<snapshot.timestamp).map(f=>({callsign:f.callsign,at:f.euroscopeBaseline!.at,reason:'before-recording'}))
        this.routes=[];this.plans=[];this.inventories=[];this.routeIds.clear();this.planIds.clear();this.inventoryIds.clear();this.frames=[];this.bytes=0;this.initial=JSON.parse(JSON.stringify(snapshot));this.active=true;this.status='Recording';this.capture(snapshot,config,edits)
    }
    stop(){this.active=false;this.status='Stopped'}
    capture(snapshot:EngineSnapshot,config:EngineConfig,edits:Record<string,FlightEdit>){
        const last=this.frames.at(-1)
        if(!this.active||last&&last.input.timestamp>snapshot.timestamp)return
        if(snapshot.source!==this.initial?.source){this.active=false;this.status='Source changed; export this session before starting another';return}
        const input=recordedTelemetry(snapshot),planKey=JSON.stringify({config,edits})
        const results=snapshot.flights.map(f=>({callsign:f.callsign,mode:f.mode,state:f.state,order:f.order,eta:f.eta,sta:f.sta,delay:f.delay}))
        if(last?.input.timestamp===snapshot.timestamp&&JSON.stringify(this.plans[last.plan])===planKey&&JSON.stringify(last.results)===JSON.stringify(results))return
        let plan=this.planIds.get(planKey)
        if(plan===undefined){plan=this.plans.length;this.plans.push(JSON.parse(planKey));this.planIds.set(planKey,plan);this.bytes+=planKey.length*2}
        const flights=input.flights.map(p=>{
            const geometry=p.route.map(({seconds,...point})=>point),key=JSON.stringify(geometry)
            let route=this.routeIds.get(key)
            if(route===undefined){route=this.routes.length;this.routes.push(JSON.parse(key));this.routeIds.set(key,route);this.bytes+=key.length*2}
            const {route:_,...values}=p
            return {...values,route,times:p.route.map(r=>r.seconds)}
        })
        // Commands can revise a plan without a new telemetry timestamp.
        // Preserve that control checkpoint rather than silently omitting it.
        let knownInventory:number|undefined
        if(input.knownFlights){
            const key=JSON.stringify([...input.knownFlights].sort((a,b)=>a.callsign.localeCompare(b.callsign)))
            knownInventory=this.inventoryIds.get(key)
            if(knownInventory===undefined){knownInventory=this.inventories.length;this.inventories.push(JSON.parse(key));this.inventoryIds.set(key,knownInventory);this.bytes+=key.length*2}
        }
        const frame={input:{...input,knownFlights:undefined,knownInventory,flights},plan,controlCheckpoint:last?.input.timestamp===snapshot.timestamp?snapshot:undefined,results}
        const captures:TimingCapture[]=[]
        for(const f of snapshot.flights){
            const baseline=f.euroscopeBaseline,key=baseline?JSON.stringify([snapshot.source,f.callsign,baseline]):''
            if(!baseline||this.captureKeys.has(key))continue
            const p=input.flights.find(p=>p.callsign===f.callsign)
            if(baseline.at!==snapshot.timestamp||!p)continue
            captures.push({callsign:f.callsign,at:baseline.at,frame:this.frames.length,plan,baseline,
                kind:(edits[f.callsign]?.recomputeAt??0)>=baseline.at?'recompute':f.firstSeen===baseline.at?'initial':'recapture',candidate:predictRouteTiming(p,config)})
        }
        const serialized=JSON.stringify(frame)
        this.bytes+=(serialized.length+JSON.stringify(captures).length)*2
        if(this.bytes>this.maxBytes||this.frames.length>=this.maxFrames){this.active=false;this.status='Recording limit reached; export the captured session';return}
        // Vue snapshots contain reactive proxies, which structuredClone
        // cannot copy. The same JSON boundary used by exports removes them.
        this.frames.push(JSON.parse(serialized))
        for(const capture of captures){
            this.captureKeys.add(JSON.stringify([snapshot.source,capture.callsign,capture.baseline]));this.timingCaptures.push(JSON.parse(JSON.stringify(capture)))
        }
    }
    export(){return structuredClone({format:'saaman-recording-1',engine:APPLICATION_BUILD.replace(/^SAAMAN /,''),initial:this.initial,routes:this.routes,plans:this.plans,inventories:this.inventories,frames:this.frames,timingCaptures:this.timingCaptures,unavailableCaptures:this.unavailableCaptures})}
}
export function decodeRecording(recording:ReturnType<SessionRecording['export']>){
    if(recording.format!=='saaman-recording-1'||!recording.initial)throw Error('Invalid AMAN recording')
    return recording.frames.map(frame=>{
        const {knownInventory,...input}=frame.input
        const knownFlights=knownInventory===undefined?input.knownFlights:recording.inventories?.[knownInventory]
        if(knownInventory!==undefined&&(!Number.isInteger(knownInventory)||!Array.isArray(knownFlights)))throw Error('Invalid recorded known-flight inventory')
        return {input:{...input,knownFlights,flights:frame.input.flights.map((p:any)=>{
        const {route,times,...values}=p,points=recording.routes[route]
        if(!Array.isArray(points)||points.length!==times.length)throw Error('Invalid recorded route')
        return {...values,route:points.map((point:any,i:number)=>({...point,seconds:times[i]}))}
    })} as Telemetry,...recording.plans[frame.plan],controlCheckpoint:frame.controlCheckpoint}})
}
