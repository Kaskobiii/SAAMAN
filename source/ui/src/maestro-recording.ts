import type {EngineSnapshot,EngineConfig,FlightEdit,Telemetry,TelemetryFlight} from './maestro-engine'
import {APPLICATION_BUILD} from './build'
import {predictRouteTiming,type RouteTiming} from './maestro-route-timing'
import {timingEvidence,type TimingEvidence} from './maestro-timing-evidence'
import {windConfig,effectiveConfig} from './maestro-engine'
import {sanitizeRecordingContext,recordingContextChanges,recordingSource,type RecordingContext} from './maestro-recording-context'
import {explainSlot,type SlotExplanation} from './maestro-slot-reasons'
export {sanitizeRecordingContext,type RecordingContext} from './maestro-recording-context'
const fields=['callsign','aircraft','wake','departure','arrival','runway','landingSeconds','distanceNm','groundspeed','altitude','speedDataValid','dataWarnings','star','routeText','verticalSpeed','assignedSpeed','assignedMach','finalAltitude','clearedAltitude','arrivalProfile','heading','assignedHeading','direct','routeProblem','latitude','longitude','threshold','positionAgeSeconds','calculatedRouteIndex','topskyMissedApproach','topskyHoldingPoint','topskyHighSpeed'] as const
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
 baseline:NonNullable<EngineSnapshot['flights'][number]['euroscopeBaseline']>;candidate?:RouteTiming;evidence?:TimingEvidence
}
export interface RecordingAuthorityEvent {
 observedAt:number;snapshotAt:number;frame:number;changes:string[];context?:RecordingContext
 source?:string;previousSource?:string;stopped?:'room-changed'|'source-unverified'
}
type SlotAssignment={sta:number;staFf:number;order:number;state:number}
export interface RecordingSlotChange {
 observedAt:number;snapshotAt:number;frame:number;callsign:string;changes:string[]
 from?:SlotAssignment;to:SlotAssignment;explanation:SlotExplanation
}
type SlotHistory={assignment:SlotAssignment;emitted:SlotAssignment;signature:string;recomputeAt:number}
export class SessionRecording {
    private routes:any[]=[];private plans:any[]=[];private routeIds=new Map<string,number>();private planIds=new Map<string,number>()
    private inventories:any[][]=[];private inventoryIds=new Map<string,number>()
    private frames:RecordedFrame[]=[];private bytes=0;private initial:EngineSnapshot|null=null
    private timingCaptures:TimingCapture[]=[];private captureKeys=new Set<string>()
    private originalTimingCaptures:{callsign:string;at:number;evidence:TimingEvidence}[]=[]
    private unavailableCaptures:{callsign:string;at:number;reason:'before-recording'}[]=[]
    private initialContext:RecordingContext|undefined;private currentContext:RecordingContext|undefined
    private authorityEvents:RecordingAuthorityEvent[]=[];private slotChanges:RecordingSlotChange[]=[]
    private slotHistory=new Map<string,SlotHistory>();private lastSource='';private snapshotAt=0
    private limit(){this.active=false;this.status='Recording limit reached; export the captured session'}
    private appendAuthority(event:RecordingAuthorityEvent){
        const serialized=JSON.stringify(event),size=serialized.length*2
        if(this.bytes+size>this.maxBytes){this.limit();return false}
        this.bytes+=size;this.authorityEvents.push(JSON.parse(serialized));return true
    }
    private context(value:RecordingContext|undefined,observedAt:number,snapshotAt:number,source:string){
        const next=sanitizeRecordingContext(value),changes=recordingContextChanges(this.currentContext,next)
        const changedSource=source!==this.lastSource
        if(changedSource)changes.push('source')
        const shared=(context:RecordingContext|undefined)=>!!context&&context.role!=='local'&&context.room.includes('/')&&!/^(unknown|local)\//i.test(context.room)
        const roomChanged=!!next&&(!!this.initialContext&&next.room!==this.initialContext.room||shared(this.currentContext)&&next.room!==this.currentContext!.room)
        const sameRoom=shared(this.initialContext)&&shared(next)&&next!.room===this.initialContext!.room
        const stopped=roomChanged?'room-changed':changedSource&&!sameRoom?'source-unverified':undefined
        if(changes.length&&!this.appendAuthority({observedAt:Number.isFinite(observedAt)?observedAt:Date.now(),snapshotAt,frame:Math.max(0,this.frames.length-1),changes,context:next,source:recordingSource(source),previousSource:changedSource?recordingSource(this.lastSource):undefined,stopped}))return false
        this.currentContext=next
        if(stopped){this.active=false;this.status=stopped==='room-changed'?'Shared room changed; export this session before starting another':'Source changed; export this session before starting another';return false}
        if(changedSource)this.lastSource=source
        return true
    }
    /** Observe authority even when no new telemetry packet or snapshot arrived. */
    observeContext(context:RecordingContext|undefined,observedAt=Date.now()){
        if(!this.active)return
        this.context(context,observedAt,this.snapshotAt,this.lastSource)
    }
    private changedSlots(snapshot:EngineSnapshot,edits:Record<string,FlightEdit>,observedAt:number){
        const events:RecordingSlotChange[]=[],history=new Map<string,SlotHistory>()
        for(const f of snapshot.flights){
            const explanation=explainSlot(f,snapshot,edits),assignment={sta:f.sta,staFf:f.staFf,order:f.order,state:f.state}
            const prior=this.slotHistory.get(f.callsign),recomputeAt=edits[f.callsign]?.recomputeAt??0
            const signature=JSON.stringify(explanation.reasons.map(({kind,binding,leader,target,seconds})=>({kind,binding,leader,target,...(binding&&['rate','wake','interval'].includes(kind)?{seconds}:{})})))
            const changes:string[]=[]
            if(!prior)changes.push('observed')
            else {
                if(Math.abs(assignment.sta-prior.emitted.sta)>=30000||Math.abs(assignment.staFf-prior.emitted.staFf)>=30000)changes.push('slot')
                if(prior.assignment.order!==assignment.order)changes.push('order')
                if(prior.assignment.state!==assignment.state)changes.push('phase')
                if(prior.signature!==signature)changes.push('constraint')
                if(recomputeAt>prior.recomputeAt)changes.push('recompute')
            }
            if(changes.length)events.push({observedAt,snapshotAt:snapshot.timestamp,frame:this.frames.length,callsign:f.callsign,changes,from:prior?.assignment,to:assignment,explanation})
            history.set(f.callsign,{assignment,emitted:changes.length?assignment:prior!.emitted,signature,recomputeAt})
        }
        return {events,history}
    }
    active=false;status='';get count(){return this.frames.length}
    constructor(private maxBytes=64*1024*1024,private maxFrames=18000){}
    start(snapshot:EngineSnapshot,config:EngineConfig,edits:Record<string,FlightEdit>,context?:RecordingContext){
        recordedTelemetry(snapshot)
        this.timingCaptures=[];this.captureKeys.clear()
        this.initialContext=sanitizeRecordingContext(context);this.currentContext=this.initialContext;this.authorityEvents=[];this.slotChanges=[];this.slotHistory.clear();this.lastSource=snapshot.source;this.snapshotAt=snapshot.timestamp
        this.originalTimingCaptures=snapshot.flights.filter(f=>f.initialTimingEvidence).map(f=>({callsign:f.callsign,at:f.initialTimingEvidence!.at,evidence:JSON.parse(JSON.stringify(f.initialTimingEvidence))}))
        this.unavailableCaptures=snapshot.flights.filter(f=>f.euroscopeBaseline&&f.euroscopeBaseline.at<snapshot.timestamp&&!f.initialTimingEvidence).map(f=>({callsign:f.callsign,at:f.euroscopeBaseline!.at,reason:'before-recording'}))
        this.routes=[];this.plans=[];this.inventories=[];this.routeIds.clear();this.planIds.clear();this.inventoryIds.clear();this.frames=[];this.initial=JSON.parse(JSON.stringify(snapshot));this.bytes=(JSON.stringify(this.initial).length+JSON.stringify(this.originalTimingCaptures).length+JSON.stringify(this.unavailableCaptures).length+JSON.stringify(this.initialContext??null).length)*2;this.active=true;this.status='Recording';this.capture(snapshot,config,edits,context)
    }
    stop(){this.active=false;this.status='Stopped'}
    capture(snapshot:EngineSnapshot,config:EngineConfig,edits:Record<string,FlightEdit>,context?:RecordingContext){
        const last=this.frames.at(-1)
        if(!this.active||last&&last.input.timestamp>snapshot.timestamp)return
        const observedAt=Date.now()
        if((context!==undefined||snapshot.source!==this.lastSource)&&!this.context(context,observedAt,snapshot.timestamp,snapshot.source))return
        const input=recordedTelemetry(snapshot),planKey=JSON.stringify({config,edits})
        const results=snapshot.flights.map(f=>({callsign:f.callsign,mode:f.mode,state:f.state,order:f.order,eta:f.eta,sta:f.sta,delay:f.delay}))
        if(last?.input.timestamp===snapshot.timestamp&&last.input.source===snapshot.source&&JSON.stringify(this.plans[last.plan])===planKey&&JSON.stringify(last.results)===JSON.stringify(results))return
        const existingPlan=this.planIds.get(planKey),plan=existingPlan??this.plans.length
        let dictionaryBytes=existingPlan===undefined?planKey.length*2:0
        const newRoutes:{key:string;route:number;geometry:any[]}[]=[],newRouteIds=new Map<string,number>()
        const flights=input.flights.map(p=>{
            const geometry=p.route.map(({seconds,...point})=>point),key=JSON.stringify(geometry)
            let route=this.routeIds.get(key)??newRouteIds.get(key)
            if(route===undefined){route=this.routes.length+newRoutes.length;newRoutes.push({key,route,geometry:JSON.parse(key)});newRouteIds.set(key,route);dictionaryBytes+=key.length*2}
            const {route:_,...values}=p
            return {...values,route,times:p.route.map(r=>r.seconds)}
        })
        // Commands can revise a plan without a new telemetry timestamp.
        // Preserve that control checkpoint rather than silently omitting it.
        let knownInventory:number|undefined,newInventory:{key:string;index:number;flights:any[]}|undefined
        if(input.knownFlights){
            const key=JSON.stringify([...input.knownFlights].sort((a,b)=>a.callsign.localeCompare(b.callsign)))
            knownInventory=this.inventoryIds.get(key)
            if(knownInventory===undefined){knownInventory=this.inventories.length;newInventory={key,index:knownInventory,flights:JSON.parse(key)};dictionaryBytes+=key.length*2}
        }
        const frame={input:{...input,knownFlights:undefined,knownInventory,flights},plan,controlCheckpoint:last?.input.timestamp===snapshot.timestamp?snapshot:undefined,results}
        const captures:TimingCapture[]=[]
        for(const f of snapshot.flights){
            const baseline=f.euroscopeBaseline,key=baseline?JSON.stringify([snapshot.source,f.callsign,baseline]):''
            if(!baseline||this.captureKeys.has(key))continue
            const p=input.flights.find(p=>p.callsign===f.callsign)
            if(baseline.at!==snapshot.timestamp||!p)continue
            captures.push({callsign:f.callsign,at:baseline.at,frame:this.frames.length,plan,baseline,
                kind:(edits[f.callsign]?.recomputeAt??0)>=baseline.at?'recompute':f.firstSeen===baseline.at?'initial':'recapture',candidate:predictRouteTiming(p,config),
                evidence:f.landingPrediction?timingEvidence(p,windConfig(effectiveConfig(config,snapshot.timestamp),p.arrival,snapshot.winds,snapshot.timestamp),f.landingPrediction,baseline.at,baseline):undefined})
        }
        const slotChanges=this.changedSlots(snapshot,edits,observedAt),serialized=JSON.stringify(frame)
        const size=(serialized.length+JSON.stringify(captures).length+JSON.stringify(slotChanges.events).length)*2
        if(this.bytes+dictionaryBytes+size>this.maxBytes||this.frames.length>=this.maxFrames){this.limit();return}
        this.bytes+=dictionaryBytes+size
        if(existingPlan===undefined){this.plans.push(JSON.parse(planKey));this.planIds.set(planKey,plan)}
        for(const added of newRoutes){this.routes.push(added.geometry);this.routeIds.set(added.key,added.route)}
        if(newInventory){this.inventories.push(newInventory.flights);this.inventoryIds.set(newInventory.key,newInventory.index)}
        // Vue snapshots contain reactive proxies, which structuredClone
        // cannot copy. The same JSON boundary used by exports removes them.
        this.frames.push(JSON.parse(serialized));this.snapshotAt=snapshot.timestamp
        this.slotChanges.push(...JSON.parse(JSON.stringify(slotChanges.events)));this.slotHistory=slotChanges.history
        for(const capture of captures){
            this.captureKeys.add(JSON.stringify([snapshot.source,capture.callsign,capture.baseline]));this.timingCaptures.push(JSON.parse(JSON.stringify(capture)))
        }
    }
    export(){return structuredClone({format:'saaman-recording-1',engine:APPLICATION_BUILD.replace(/^SAAMAN /,''),initial:this.initial,routes:this.routes,plans:this.plans,inventories:this.inventories,frames:this.frames,timingCaptures:this.timingCaptures,originalTimingCaptures:this.originalTimingCaptures,unavailableCaptures:this.unavailableCaptures,initialContext:this.initialContext,authorityEvents:this.authorityEvents,slotChanges:this.slotChanges})}
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
