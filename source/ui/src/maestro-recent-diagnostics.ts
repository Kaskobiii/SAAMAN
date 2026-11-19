import {controllerInstructionSeconds,euroscopeInstruction,type EngineConfig,type EngineFlight,type EngineSnapshot,type FlightEdit} from './maestro-engine'
import {recordingContextChanges,recordingSource,sanitizeRecordingContext,type RecordingContext} from './maestro-recording-context'

export interface DiagnosticObservation {
    at:number
    snapshot?:EngineSnapshot|null
    config?:EngineConfig
    edits?:Record<string,FlightEdit>
    context?:RecordingContext
    snapshotAgeMs?:number
    clockSynchronized?:boolean
    backendMinusLocalMs?:number
    error?:string
}

const SAMPLE_MS=5000
const JUMP_MS=60000
const RETENTION_MS=30*60000
const MAX_DIAGNOSTIC_TEXT=128
const clip=(value:string|undefined)=>value?.slice(0,MAX_DIAGNOSTIC_TEXT)
const code=(value:string|undefined)=>typeof value==='string'&&/^[A-Za-z0-9 _./-]{1,48}$/.test(value)?value:undefined

function errorKind(error:string|undefined){
    if(!error)return undefined
    if(/paused/i.test(error))return 'paused'
    if(/timed out|timeout/i.test(error))return 'timeout'
    if(/waiting for controller|waiting for a connected|not in the vatsim|identity/i.test(error))return 'identity'
    if(/clock|server time/i.test(error))return 'clock'
    if(/stale|fresh|recovery|checkpoint/i.test(error))return 'freshness'
    if(/runway/i.test(error))return 'runway'
    if(/connection|network|backend|https/i.test(error))return 'connection'
    if(/permission|authoriz/i.test(error))return 'authorization'
    return 'other'
}

function operatingPlan(config:EngineConfig|undefined){
    if(!config)return undefined
    return {active:config.active,departureRunway:config.departureRunway,rates:config.rates,
        pending:config.pending,pendingRate:config.pendingRate,slots:config.slots.slice(0,64),
        automaticTrafficModes:config.automaticTrafficModes,trafficHighDownwindNm:config.trafficHighDownwindNm,
        timingModel:config.timingModel,performanceModel:config.performanceModel}
}

function editEvidence(edit:FlightEdit|undefined){
    if(!edit)return undefined
    return {target:edit.target,targetKind:edit.targetKind,order:edit.order,orderExplicit:edit.orderExplicit,
        changedAt:edit.changedAt,recomputeAt:edit.recomputeAt,refreshDelayAt:edit.refreshDelayAt,
        runway:edit.runway,mode:edit.mode,etaFfOverride:edit.etaFfOverride,closurePosition:edit.closurePosition,
        slotBefore:edit.slotBefore,slotAfter:edit.slotAfter}
}

function retainRoute(flight:EngineFlight){
    const remaining=flight.route.filter(point=>point.seconds>=0)
    const feeder=remaining.find(point=>point.name===flight.ff)
    const destination=remaining.at(-1)
    const selected=[...new Set([...remaining.slice(0,6),feeder,destination])].filter(point=>point!==undefined)
    return {secondsToDestination:flight.landingSeconds,remainingPoints:remaining.length,
        points:selected.map(point=>[code(point.name),point.seconds,point.latitude,point.longitude])}
}

function retainFlight(flight:EngineFlight,edit:FlightEdit|undefined){
    const guidance=flight.mode==='sequenced'&&!flight.issue&&!flight.lost
    return {
        callsign:recordingSource(flight.callsign),aircraft:code(flight.aircraft),wake:code(flight.wake),
        runway:code(flight.runway),euroScopeRunway:code(flight.euroscopeRunway),feeder:code(flight.ff),
        passedFeeder:flight.passedFeeder,mode:flight.mode,state:flight.state,order:flight.order,lost:flight.lost,
        eta:Math.round(flight.eta),sta:Math.round(flight.sta),etaFf:Math.round(flight.etaFf),staFf:Math.round(flight.staFf),
        planningEta:flight.planningEta,delay:flight.delay,totalDelay:flight.totalDelay,
        timelineInstructionSeconds:controllerInstructionSeconds(flight),
        line0InstructionSeconds:guidance?euroscopeInstruction(flight):0,
        groundSpeed:flight.groundspeed,altitude:flight.altitude,verticalSpeed:flight.verticalSpeed,
        position:[flight.latitude,flight.longitude],heading:flight.heading,assignedSpeed:flight.assignedSpeed,
        assignedMach:flight.assignedMach,assignedHeading:flight.assignedHeading,
        positionAgeSeconds:flight.positionAgeSeconds,star:code(flight.star),direct:code(flight.direct),
        holdingFix:code(flight.topskyHoldingPoint),missedApproach:flight.topskyMissedApproach,
        prediction:flight.landingPrediction?.method??flight.predictionSource,trafficMode:flight.trafficProfile?.mode,
        predictionDistanceNm:flight.landingPrediction?.distanceNm,heldTiming:flight.motionTiming?.held,
        feederSource:clip(flight.feederObservationSource),quarantined:flight.routeTimingQuarantined,
        rawEta:flight.liveEuroscopeEta,rawEtaFf:flight.liveEuroscopeEtaFf,baseline:flight.euroscopeBaseline,
        separation:flight.separation,feederDelayMs:flight.feederDelayMs,closureDelayMs:flight.closureDelayMs,
        wakeDelayMs:flight.wakeDelayMs,rateDelayMs:flight.rateDelayMs,minimumArrival:flight.minimumArrival,
        constraints:flight.guidance?.constraints?.slice(0,8).map(clip),issue:clip(flight.issue),
        route:retainRoute(flight),edit:editEvidence(edit)
    }
}

type FlightEvidence=ReturnType<typeof retainFlight>
function changed(prior:FlightEvidence|undefined,next:FlightEvidence){
    if(!prior)return true
    return Math.abs(next.eta-prior.eta)>=JUMP_MS||Math.abs(next.sta-prior.sta)>=JUMP_MS||
        Math.abs(next.etaFf-prior.etaFf)>=JUMP_MS||Math.abs(next.staFf-prior.staFf)>=JUMP_MS||
        Math.abs(next.delay-prior.delay)>=JUMP_MS/1000||
        Math.abs(next.line0InstructionSeconds-prior.line0InstructionSeconds)>=JUMP_MS/1000||
        next.order!==prior.order||next.mode!==prior.mode||next.state!==prior.state||next.runway!==prior.runway||
        next.direct!==prior.direct||next.assignedHeading!==prior.assignedHeading||next.holdingFix!==prior.holdingFix||
        next.passedFeeder!==prior.passedFeeder||next.lost!==prior.lost||next.quarantined!==prior.quarantined||next.issue!==prior.issue||
        JSON.stringify(next.edit)!==JSON.stringify(prior.edit)
}

export function createRecentDiagnostics(sink:(record:unknown)=>Promise<unknown>,elapsed=()=>performance.now()){
    let lastSample=-Infinity,lastSnapshotAt:number|undefined,lastSource:string|undefined,lastError:string|undefined,lastClock:boolean|undefined
    let lastFlightSample=-Infinity
    let previousContext:RecordingContext|undefined,flightContext:RecordingContext|undefined,previousPlan='',writing=false
    let previousFlights=new Map<string,FlightEvidence>()
    return (observation:DiagnosticObservation)=>{
        // Diagnostics cannot delay the sequencer or build an RPC backlog.
        if(writing)return
        try{
            const {at,snapshot,config,edits,snapshotAgeMs,clockSynchronized,backendMinusLocalMs}=observation
            const tick=elapsed(),context=sanitizeRecordingContext(observation.context),source=recordingSource(snapshot?.source)
            const error=errorKind(observation.error),plan=operatingPlan(config),planKey=JSON.stringify(plan)??''
            if(tick-lastFlightSample>=RETENTION_MS)previousFlights.clear()
            const sessionChanged=context?.room!==flightContext?.room||context?.epoch!==flightContext?.epoch
            const authorityChanges=recordingContextChanges(previousContext,context)
            const stateChanged=authorityChanges.length>0||error!==lastError||source!==lastSource||planKey!==previousPlan||clockSynchronized!==lastClock
            if(!stateChanged&&(!snapshot||(snapshot.timestamp===lastSnapshotAt&&context?.revision===previousContext?.revision)))return
            const flights=snapshot?.flights.filter(flight=>flight.arrival==='ESSA').slice(0,500)??[]
            const nextFlights=new Map(flights.map(flight=>[flight.callsign,retainFlight(flight,edits?.[flight.callsign])]))
            const moves=[...nextFlights].filter(([callsign,flight])=>sessionChanged||changed(previousFlights.get(callsign),flight))
            const removed=snapshot&&!sessionChanged?[...previousFlights.keys()].filter(callsign=>!nextFlights.has(callsign)):[]
            if(!stateChanged&&!moves.length&&!removed.length&&tick-lastSample<SAMPLE_MS)return
            const before=!sessionChanged&&snapshot?moves.filter(([callsign])=>previousFlights.has(callsign)).map(([callsign])=>previousFlights.get(callsign)):[]
            const frame={at,snapshotAt:snapshot?.timestamp,source,context,authorityChanges,error,snapshotAgeMs,clockSynchronized,backendMinusLocalMs,plan,wind:snapshot?.wind,
                trafficModes:snapshot?.trafficModes,flights:[...nextFlights.values()],before,
                removed:removed.map(recordingSource),corrections:snapshot?.automaticCorrections?.slice(-12).map(event=>({at:event.at,callsign:recordingSource(event.callsign),kind:event.kind}))}
            writing=true
            void Promise.resolve(sink(frame)).then(accepted=>{
                if(accepted===false)return
                lastSample=tick;lastSnapshotAt=snapshot?.timestamp;lastSource=source;lastError=error;lastClock=clockSynchronized
                previousContext=context;previousPlan=planKey
                if(snapshot){lastFlightSample=tick;flightContext=context;previousFlights=nextFlights}
            }).catch(()=>{}).finally(()=>{writing=false})
        }catch{writing=false}
    }
}
