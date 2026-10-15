// Independent implementation of the documented MAESTRO data model.
// All absolute times are Unix milliseconds internally; route EET inputs are seconds.
import {aircraftType,performanceAt,PERFORMANCE_SOURCE} from './maestro-aircraft-performance'
import { finalPosition, headingDifference, bearingBetween, vectoringSeconds, vectoringDistance, type GeoPoint, type RunwayGeometry } from './maestro-geometry'
import {starPrediction,iasToTas,STAR_RUNWAYS,STAR_FEEDERS,distanceNm} from './maestro-star-prediction'
import {arrivalTrajectory,feederTrajectory,type TrajectoryResult} from './maestro-trajectory'
import {observedFeeder,arrivalRoute} from './maestro-arrival-route'
import {predictLanding,type LandingPrediction} from './maestro-landing-prediction'
import {validateCoordinations,type CoordinationMessage} from './maestro-coordination'
export const FEEDERS = [
    { name: 'NILUG', id: 'N', airport: 'ESSA', fixes: ['NILUG'] },
    { name: 'XILAN', id: 'X', airport: 'ESSA', fixes: ['XILAN'] },
    { name: 'ELTOK', id: 'E', airport: 'ESSA', fixes: ['ELTOK'] },
    { name: 'VACRA', id: 'V', airport: 'ESSA', fixes: ['VACRA'] },
    { name: 'TRS', id: 'T', airport: 'ESSB', fixes: ['TRS'] },
    { name: 'ALOLA TINKA XILAN', id: 'T', airport: 'ESSB', fixes: ['ALOLA', 'TINKA', 'XILAN'] },
    { name: 'ARS HMR', id: 'A', airport: 'ESSB', fixes: ['ARS', 'HMR'] },
] as const
export const RUNWAYS = ['ESSA/01L', 'ESSA/01R', 'ESSA/08', 'ESSA/19L', 'ESSA/19R', 'ESSA/26', 'ESSB/12', 'ESSB/30']
export const STATE_NAMES = ['UNSTABLE', 'STABLE', 'SUPERSTABLE', 'FROZEN', 'LANDED'] as const
export const STATE_COLORS = ['#16417c', '#96d796', '#ffffff', '#40e0d0', '#dc7daf']
export const STABLE_MINUTES=15
export const SUPERSTABLE_MINUTES=4
export interface EngineConfig {
    timingModel?:'euroscope-buffer'|'performance'
    euroscopeSuperstableBufferMinutes?:number
    euroscopeBufferMinutes?:number
    euroscopeHighSpeedBufferMinutes?:number
    coordinations?:CoordinationMessage[]
    performanceModel?:'euroscope'|'openap'
    displayPreferences?:{labels:{type:boolean;feeder:boolean;totalDelay:boolean;currentDelay:boolean;runway:boolean};panels:{winds:boolean;rates:boolean;tracks:boolean}}
    predictionMode?:'star'|'euroscope'
    starDistanceMethod?:'vectors'|'ese'|'shortest'
    starApproachSpeed?:number;starBaseSpeed?:number;starFinalNm?:number;starBaseNm?:number;starEntryAltitude?:number;starDescentRate?:number;starCruiseSpeed?:number;starClimbRate?:number
    active: string[]
    departureRunway?: string
    rates: Record<string, number>
    stableMinutes: number
    superStableMinutes: number
    frozenMinutes: number
    unstableSeconds: number
    minimumNewSeconds: number
    landingSpeedKnots: number
    surfaceWindDirection: number
    surfaceWindSpeed: number
    surfaceWindAuto?: boolean
    stableBufferMinutes?: number
    superStableBufferMinutes?: number
    defaultFeederMinutes?: number
    maxFinalNm?: number
    vectoringMode?: number
    finalLengths?: Record<string,number>
    delayPaths?: { airport:string; runways:string[]; feeders:string[]; points:string[] }[]
    slots: { id: string; runway: string; begin: number; end: number; kind?:'closure'|'gap' }[]
    pending?: { at: number; active: string[]; rates: Record<string, number>; departureRunway?:string; applyRate?:boolean }
    pendingRate?: {at:number;seconds:number}
    manualFlights?: { callsign:string; runway:string; aircraft:string; wake:string; feeder:string; eta:number;departure?:string;feederEta?:number }[]
}
export const DEFAULT_CONFIG: EngineConfig = {
    timingModel:'euroscope-buffer',euroscopeBufferMinutes:2,euroscopeSuperstableBufferMinutes:1,euroscopeHighSpeedBufferMinutes:6,
    performanceModel:'euroscope',
    predictionMode:'star',starDistanceMethod:'vectors',starApproachSpeed:250,starBaseSpeed:180,starFinalNm:10,starBaseNm:20,starEntryAltitude:18000,starDescentRate:1800,starCruiseSpeed:450,starClimbRate:1800,
    active: ['ESSA/19R'], departureRunway:'ESSA/26',
    rates: Object.fromEntries(RUNWAYS.map(r => [r, r.endsWith('/08') ? 166 : r.endsWith('/26') || r.startsWith('ESSB/') ? 142 : 115])),
    stableMinutes: STABLE_MINUTES, superStableMinutes: SUPERSTABLE_MINUTES, frozenMinutes: 3.5, unstableSeconds: 60,
    minimumNewSeconds: 600, slots: [],
    landingSpeedKnots: 140, surfaceWindDirection: 0, surfaceWindSpeed: 0,
    surfaceWindAuto:true, stableBufferMinutes:5, superStableBufferMinutes:5, defaultFeederMinutes:15, maxFinalNm:15, vectoringMode:1,
    finalLengths:Object.fromEntries(RUNWAYS.map(r=>[r,r==='ESSA/01R'?14:10])), delayPaths:[],
    manualFlights: [],
}
export interface RoutePrediction { name: string; seconds: number; latitude?:number; longitude?:number }
export interface TelemetryFlight {
    topskyMissedApproach?:boolean
    callsign: string; aircraft: string; wake: string; departure: string; arrival: string; runway: string
    route: RoutePrediction[]; landingSeconds: number; distanceNm: number; groundspeed: number; altitude: number
    speedDataValid?:boolean;dataWarnings?:string[]
    star?:string;routeText?:string;verticalSpeed?:number;assignedSpeed?:number;assignedMach?:number;arrivalProfile?:string;finalAltitude?:number;clearedAltitude?:number
    heading?: number; assignedHeading?: number; direct?: string; routeProblem?: string
    latitude?:number; longitude?:number; threshold?:RunwayGeometry
    positionAgeSeconds?:number; calculatedRouteIndex?:number
}
export interface Telemetry { source: string; timestamp: number; flights: TelemetryFlight[];terminatedCallsigns?:string[];knownFlights?:Pick<TelemetryFlight,'callsign'|'aircraft'|'wake'|'departure'|'arrival'|'runway'>[]; simulation?:boolean; winds?:Record<string,{direction:number;speed:number;timestamp:number}>; runways?:Record<string,RunwayGeometry>; activeRunways?:{arrivals:string[];departures:string[]} }
export interface FlightEdit {
    refreshDelayAt?:number
    etaFfOverride?:number
    maximumDelayMinutes?:number
    runwayAssignment?:string
    arrivalProfile?:string
    runway?: string; mode?: 'sequenced' | 'desequenced' | 'removed' | 'missed'
    slotBefore?: number; slotAfter?: number; order?: number; recomputeAt?: number; changedAt?: number
    closurePosition?:{id:string;side:'before'|'after'}
    target?: number
    targetKind?:'time'|'sequence'
    orderGroup?:string
    // A deliberate swap may hold a slot; ordinary reorder has no timestamp.
    swapAt?:number
    requeueAt?:number
    landedAt?:number
}
export interface EngineFlight extends TelemetryFlight {
    amanRoute?:RoutePrediction[];amanRoutePassed?:number;bufferedFeederVerified?:boolean
    runwayTransition?:{from:string;to:string;order:number;pending:boolean}
    euroscopeBaseline?:{at:number;runway?:string;eta:number;etaFf:number;rawEta:number;rawEtaFf?:number;feederBuffered?:boolean;bufferMinutes:number;feederBufferMinutes?:number;groundspeed?:number;landingReference?:LandingPrediction['reference'];landingMethod?:LandingPrediction['method']}
    liveEuroscopeEta?:number;liveBufferedEta?:number;liveEuroscopeEtaFf?:number;liveBufferedEtaFf?:number
    landingPrediction?:LandingPrediction
    secondaryRunwayAccepted?:boolean
    runwayAvailableFrom?:number
    sdkRunwayExplicit?:boolean
    initialSta?:number;initialStaFf?:number;originalAssignedSta?:number
    refreshedDelayAt?:number;maximumDelayExceeded?:boolean
    trajectory?:TrajectoryResult
    guidance?:{point:string;predicted:number;scheduled:number;reference:number;instructionSeconds:number;policy:string;constraints:string[];earliestPlanningTime:number;validUntil:number;absorption?:{mode:'none'|'gain'|'speed-or-vectors'|'holding';maxIas?:number}}
    closurePosition?:FlightEdit['closurePosition']
    firstSeen: number; lastSeen: number; initialEta: number; initialEtaFf?:number; eta: number; etaFf: number; sta: number; staFf: number
    feeder: string; feederId: string; ff: string; passedFeeder: boolean; state: number; mode: string
    delay: number; totalDelay: number; order: number; lost: boolean; issue: string; minimumArrival: number
    minimumArrivalSource?:'new'|'resume'
    tmaAssignment?:{at:number;sta:number;instruction:number}
    slotBefore: number; slotAfter: number; recomputedAt: number
    lastTrustedEta: number
    closureDelayMs?:number
    groundCandidateSince?:number
    landingRunway?:string
    landingDetection?:'manual'|'surface'|'simulator-removal'|'termination'
    missedRecovery?:boolean
    wakeDelayMs?:number
    rateDelayMs?:number
    feederDelayMs?:number
    feederDistanceNm?:number
    line0Suppressed?:boolean
    tmaTiming?:{delay:number;rateSeconds:number;instructionSource?:'manual'|'constraint'|'none';referenceSta?:number;referenceDelay?:number;referenceSource?:'manual'|'constraint'|'none'}
    separation?:{leader:string;wakeNm:number;wakeSeconds:number;rateSeconds:number;scheduledSeconds:number}
    spacingActive?:boolean
    planningDelaySeconds?:number
    committedSta?:number
    // Automatic scheduling follows sustained ETA changes, rather than the
    // absolute landing slot saved when the aircraft became Superstable.
    planningEta?:number
    planningEtaCandidate?:{eta:number;since:number}
    sequenceCorrectionCandidate?:{leader:string;since:number}
    editTracking?:boolean;appliedOrder?:number;appliedTarget?:number;appliedChangedAt?:number;appliedOrderGroup?:string
    aircraftPerformance?:{type:string;status:'matched'|'missing'|'ambiguous';nominalIas?:number;descentFpm?:number;blobSha:string;provider?:string;profileType?:string;match?:string;gainEligible?:boolean;vmo?:number;mmo?:number}
    gainCapacitySeconds?:number
    automaticGainSeconds?:number
    runwayDelay?:number
    reorderTiming?:{eta:number;scheduled:number;delay:number}
    spacingConflict?: boolean
    predictionSource?: 'route' | 'vectoring' | 'delaypath' | 'star-distance' | 'vector-profile' | 'final-position' | 'unavailable'
    distanceProfile?:{id:string;procedure:string;runway:string;method:string;fullNm:number;remainingNm:number;beforeFeederNm:number;sourceRange:string;shortcut:boolean;workbookSha256:string}
    euroscopeRunway?:string
    runwaySource?:'manual'|'filed'|'active'
    vectorCandidateSince?:number
    vectorDetection?:'final'|'heading'|'off-route'
    scheduledBeforeLanding?:number
    originalLandingSeconds?:number
    finalAlongNm?:number
    planKey?:string
}
export interface EngineSnapshot { timestamp: number; source: string; simulation?:boolean; flights: EngineFlight[];terminatedCallsigns?:string[];knownFlights?:Pick<TelemetryFlight,'callsign'|'aircraft'|'wake'|'departure'|'arrival'|'runway'>[]; diagnostics: string[]; slotsKey?: string; wind?:{direction:number;speed:number;auto:boolean}; winds?:Telemetry['winds']; landings?:{callsign:string;runway:string;time:number}[];grounded?:Record<string,number>;observedCallsigns?:string[];runways?:Telemetry['runways'];activeRunways?:Telemetry['activeRunways'];unlistedTelemetry?:TelemetryFlight[] }
const ms = (seconds: number) => seconds * 1000

export function validateConfig(value: any): EngineConfig {
    if (!value || !Array.isArray(value.active) || !value.active.length || value.active.length > 8 ||
        value.active.some((r: string) => !RUNWAYS.includes(r)) || new Set(value.active).size !== value.active.length)
        throw new Error('Select at least one valid arrival runway')
    const essa=value.active.filter((r:string)=>r.startsWith('ESSA/'))
    const active=value.active.filter((r:string)=>!r.startsWith('ESSA/')||r===essa[0])
    const departureRunway=value.departureRunway??essa[1]??DEFAULT_CONFIG.departureRunway
    if(!RUNWAYS.includes(departureRunway)||!departureRunway.startsWith('ESSA/'))throw new Error('Select a valid departure runway')
    const rates: Record<string, number> = {}
    for (const r of RUNWAYS) {
        const rate = value.rates?.[r]
        if (!Number.isFinite(rate) || rate < 60 || rate > 600) throw new Error('Arrival rates must be 6–60 aircraft per hour (60–600 seconds)')
        rates[r] = rate
    }
    for (const key of ['stableMinutes', 'superStableMinutes', 'frozenMinutes', 'unstableSeconds', 'minimumNewSeconds'])
        if (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 3600) throw new Error('Invalid state threshold')
    if (value.superStableMinutes > value.stableMinutes) throw new Error('Superstable must be inside the stable horizon')
    if (!Array.isArray(value.slots) || value.slots.length > 100) throw new Error('Invalid slots')
    const slots = value.slots.map((s: any) => {
        if (!s || typeof s.id !== 'string' || s.id.length > 60 || !RUNWAYS.includes(s.runway) ||
            !Number.isFinite(s.begin) || !Number.isFinite(s.end) || s.end <= s.begin || s.end - s.begin > 86400000)
            throw new Error('Invalid runway slot')
        if(s.kind!==undefined&&!['closure','gap'].includes(s.kind))throw new Error('Invalid runway interval kind')
        return { id: s.id, runway: s.runway, begin: s.begin, end: s.end,kind:s.kind }
    })
    const landingSpeedKnots = value.landingSpeedKnots ?? 140
    const surfaceWindDirection = value.surfaceWindDirection ?? 0
    const surfaceWindSpeed = value.surfaceWindSpeed ?? 0
    if (!Number.isFinite(landingSpeedKnots) || landingSpeedKnots < 50 || landingSpeedKnots > 200 ||
        !Number.isFinite(surfaceWindDirection) || surfaceWindDirection < 0 || surfaceWindDirection > 360 ||
        !Number.isFinite(surfaceWindSpeed) || surfaceWindSpeed < 0 || surfaceWindSpeed > 100) throw new Error('Invalid wind or landing speed')
    let pending: EngineConfig['pending']
    if (value.pending) {
        if(value.pending.applyRate!==undefined&&typeof value.pending.applyRate!=='boolean')throw new Error('Invalid runway rate flag')
        if (!Number.isFinite(value.pending.at) || value.pending.at < 0) throw new Error('Invalid runway change time')
        const next = validateConfig({ ...value, pending: undefined, active: value.pending.active, rates: value.pending.rates, departureRunway:value.pending.departureRunway??departureRunway })
        pending = { at: value.pending.at, active: next.active, rates: next.rates, departureRunway:next.departureRunway,applyRate:value.pending.applyRate!==false }
    }
    let pendingRate:EngineConfig['pendingRate']
    if(value.pendingRate){
        if(!Number.isFinite(value.pendingRate.at)||value.pendingRate.at<0||!Number.isFinite(value.pendingRate.seconds)||value.pendingRate.seconds<60||value.pendingRate.seconds>600)throw new Error('Invalid rate change')
        pendingRate={at:value.pendingRate.at,seconds:value.pendingRate.seconds}
    }
    const arrivalRunway=active.find((r:string)=>r.startsWith('ESSA/'))??active[0]
    if(pending && !pendingRate && value.pending.applyRate===undefined && JSON.stringify(pending.active)===JSON.stringify(active) && pending.departureRunway===departureRunway && pending.rates[arrivalRunway]!==rates[arrivalRunway]){
        // Older clients stored a rate-only change in the runway plan slot.
        pendingRate={at:pending.at,seconds:pending.rates[arrivalRunway]}
        pending=undefined
    }
    const manualFlights=value.manualFlights || []
    if(!Array.isArray(manualFlights)||manualFlights.length>500||manualFlights.some((f:any)=>
        !f || !/^[A-Z0-9_-]{2,16}$/.test(f.callsign)||!RUNWAYS.includes(f.runway)||typeof f.aircraft!=='string'||f.aircraft.length>12||
        !['L','M','H','J','?'].includes(f.wake)||typeof f.feeder!=='string'||f.feeder.length>40||!Number.isFinite(f.eta)||f.eta<0||(f.feederEta!==undefined&&(!Number.isFinite(f.feederEta)||f.feederEta<0||f.feederEta>f.eta))||(f.departure!==undefined&&(typeof f.departure!=='string'||!/^[A-Z0-9-]{4}$/.test(f.departure)))))throw new Error('Invalid manual flight')
    const extras={timingModel:value.timingModel??'euroscope-buffer',euroscopeBufferMinutes:value.euroscopeBufferMinutes??2,euroscopeSuperstableBufferMinutes:value.euroscopeSuperstableBufferMinutes??1,euroscopeHighSpeedBufferMinutes:value.euroscopeHighSpeedBufferMinutes??6,performanceModel:value.performanceModel??'euroscope',predictionMode:value.predictionMode??'star',starDistanceMethod:value.starDistanceMethod??'vectors',starApproachSpeed:value.starApproachSpeed??250,starBaseSpeed:value.starBaseSpeed??180,starFinalNm:value.starFinalNm??10,starBaseNm:value.starBaseNm??20,starEntryAltitude:value.starEntryAltitude??18000,starDescentRate:value.starDescentRate??1800,starCruiseSpeed:value.starCruiseSpeed??450,starClimbRate:value.starClimbRate??1800,surfaceWindAuto:value.surfaceWindAuto!==false,stableBufferMinutes:value.stableBufferMinutes??5,superStableBufferMinutes:value.superStableBufferMinutes??5,
        defaultFeederMinutes:value.defaultFeederMinutes??15,maxFinalNm:value.maxFinalNm??15,vectoringMode:value.vectoringMode??1,finalLengths:value.finalLengths??DEFAULT_CONFIG.finalLengths!,delayPaths:value.delayPaths??[]}
    if(!['euroscope','openap'].includes(extras.performanceModel))throw new Error('Invalid performance model')
    if(!['euroscope-buffer','performance'].includes(extras.timingModel)||!Number.isFinite(extras.euroscopeBufferMinutes)||extras.euroscopeBufferMinutes<0||extras.euroscopeBufferMinutes>15)throw new Error('EuroScope ETA buffer must be between 0 and 15 minutes')
    if(!Number.isFinite(extras.euroscopeHighSpeedBufferMinutes)||extras.euroscopeHighSpeedBufferMinutes<0||extras.euroscopeHighSpeedBufferMinutes>15)throw new Error('High-speed ETA buffer must be between 0 and 15 minutes')
    if(!Number.isFinite(extras.euroscopeSuperstableBufferMinutes)||extras.euroscopeSuperstableBufferMinutes<0||extras.euroscopeSuperstableBufferMinutes>15)throw new Error('Superstable ETA buffer must be between 0 and 15 minutes')
    if(!['star','euroscope'].includes(extras.predictionMode)||!['vectors','ese','shortest'].includes(extras.starDistanceMethod))throw new Error('Invalid STAR model')
    for(const [key,min,max] of [['starApproachSpeed',100,350],['starBaseSpeed',80,250],['starFinalNm',1,20],['starBaseNm',2,40],['starEntryAltitude',3000,25000],['starDescentRate',500,5000],['starCruiseSpeed',250,600],['starClimbRate',500,5000]] as const)if(!Number.isFinite(extras[key])||extras[key]<min||extras[key]>max)throw new Error('Invalid STAR speed profile')
    if(extras.starBaseNm<=extras.starFinalNm)throw new Error('Base profile distance must exceed final distance')
    for(const key of ['stableBufferMinutes','superStableBufferMinutes','defaultFeederMinutes','maxFinalNm','vectoringMode'] as const)
        if(!Number.isFinite(extras[key])||extras[key]<0||extras[key]>(key==='vectoringMode'?2:600))throw new Error('Invalid prediction setting')
    if(!Number.isInteger(extras.vectoringMode)||RUNWAYS.some(r=>!Number.isFinite(extras.finalLengths[r])||extras.finalLengths[r]<1||extras.finalLengths[r]>100))throw new Error('Invalid final approach setting')
    if(!Array.isArray(extras.delayPaths)||extras.delayPaths.length>100||extras.delayPaths.some((p:any)=>!p||!['ESSA','ESSB'].includes(p.airport)||
        !Array.isArray(p.runways)||!Array.isArray(p.feeders)||!Array.isArray(p.points)||p.points.length<2||p.points.length>100||
        [...p.runways,...p.feeders,...p.points].some((v:any)=>typeof v!=='string'||v.length>40)))throw new Error('Invalid delay path')
    const requestedDisplay=value.displayPreferences??{labels:{type:true,feeder:false,totalDelay:false,currentDelay:true,runway:false},panels:{winds:false,rates:false,tracks:true}}
    const displayPreferences={...requestedDisplay,labels:{...requestedDisplay.labels,type:true,currentDelay:true},panels:{...requestedDisplay.panels}}
    for(const [group,keys] of [['labels',['type','feeder','totalDelay','currentDelay','runway']],['panels',['winds','rates','tracks']]] as const)
        if(!displayPreferences[group]||Object.keys(displayPreferences[group]).some(k=>!(keys as readonly string[]).includes(k))||keys.some(k=>typeof displayPreferences[group][k]!=='boolean'))throw new Error('Invalid display preferences')
    return { ...extras,coordinations:validateCoordinations(value.coordinations), displayPreferences, active, departureRunway, rates, slots, pending, pendingRate, manualFlights, landingSpeedKnots, surfaceWindDirection, surfaceWindSpeed, stableMinutes: STABLE_MINUTES,
        superStableMinutes: SUPERSTABLE_MINUTES, frozenMinutes: value.frozenMinutes,
        unstableSeconds: value.unstableSeconds, minimumNewSeconds: value.minimumNewSeconds }
}
export function validateTelemetry(value: any, now = Date.now()): Telemetry {
    const validRunwayGeometry=(g:any):g is RunwayGeometry=>!!g&&Number.isFinite(g.latitude)&&Math.abs(g.latitude)<=90&&Number.isFinite(g.longitude)&&Math.abs(g.longitude)<=180&&Number.isFinite(g.heading)
    if(value?.simulation!==undefined&&typeof value.simulation!=='boolean')throw new Error('Invalid simulator connection flag')
    if (!value || typeof value.source !== 'string' || value.source.length > 32 || !Number.isFinite(value.timestamp) ||
        Math.abs(now - value.timestamp) > 30000 || !Array.isArray(value.flights) || value.flights.length > 1000)
        throw new Error('Missing or stale EuroScope predictions')
    if(value.terminatedCallsigns!==undefined&&(!Array.isArray(value.terminatedCallsigns)||value.terminatedCallsigns.length>1000||value.terminatedCallsigns.some((cs:any)=>typeof cs!=='string'||!/^[A-Z0-9_-]{2,16}$/.test(cs))))throw new Error('Invalid termination inventory')
    if(value.knownFlights!==undefined&&(!Array.isArray(value.knownFlights)||value.knownFlights.length>1000||value.knownFlights.some((f:any)=>!f||typeof f.callsign!=='string'||!/^[A-Z0-9_-]{2,16}$/.test(f.callsign)||['aircraft','wake','departure','arrival','runway'].some(k=>typeof f[k]!=='string'||f[k].length>16))))throw new Error('Invalid known flight plans')
    const flights=value.flights.filter((p:any)=>p?.arrival!=='ESSB').map((raw:any)=>{
        if(!raw||typeof raw!=='object')return raw
        const p={...raw},warnings:string[]=Array.isArray(raw.dataWarnings)?raw.dataWarnings.filter((s:any)=>typeof s==='string').slice(0,5):[]
        if(p.assignedSpeed!==undefined&&(!Number.isFinite(p.assignedSpeed)||p.assignedSpeed<0||p.assignedSpeed>600)){warnings.push(`Assigned speed ${String(p.assignedSpeed).slice(0,30)} unavailable; speed-based gain disabled`);p.assignedSpeed=0;p.speedDataValid=false}
        // SDK documentation has both 2-digit units and a 750 => M0.75
        // example. Accept either representation at the input boundary.
        if(Number.isFinite(p.assignedMach)&&p.assignedMach>=200&&p.assignedMach<=990)p.assignedMach/=10
        for(const [key,max] of [['assignedMach',99],['clearedAltitude',65000],['finalAltitude',65000]] as const){
            if(p[key]!==undefined&&(!Number.isFinite(p[key])||p[key]<0||p[key]>max)){warnings.push(`${key} unavailable`);p[key]=0;p.speedDataValid=false}
        }
        if(p.star!==undefined&&typeof p.star!=='string'){warnings.push('STAR name unavailable');delete p.star}
        if(typeof p.star==='string')p.star=p.star.slice(0,100)
        if(p.routeText!==undefined&&typeof p.routeText!=='string')delete p.routeText
        if(typeof p.routeText==='string')p.routeText=p.routeText.slice(0,4096)
        p.dataWarnings=warnings;return p
    })
    const seen = new Set()
    for (const p of flights) {
        if(p?.topskyMissedApproach!==undefined&&typeof p.topskyMissedApproach!=='boolean')throw new Error('Invalid TopSky missed approach flag')
        if (!p || !/^[A-Z0-9_-]{2,16}$/.test(p.callsign) || seen.has(p.callsign) ||
            !['ESSA', 'ESSB'].includes(p.arrival) || !Number.isFinite(p.landingSeconds) ||
            !Number.isFinite(p.distanceNm) || !Number.isFinite(p.groundspeed) || !Number.isFinite(p.altitude) ||
            !Array.isArray(p.route) || p.route.length > 1000 || p.route.some((r: any) =>
                typeof r.name !== 'string' || r.name.length > 40 || !Number.isFinite(r.seconds)))
            throw new Error('Invalid EuroScope flight prediction')
        if(p.star!==undefined&&(typeof p.star!=='string'||p.star.length>100)||p.routeText!==undefined&&(typeof p.routeText!=='string'||p.routeText.length>4096)||p.assignedSpeed!==undefined&&(!Number.isFinite(p.assignedSpeed)||p.assignedSpeed<0||p.assignedSpeed>600))throw new Error('Invalid STAR or speed data')
        seen.add(p.callsign)
        for(const key of ['latitude','longitude','heading','assignedHeading','positionAgeSeconds','calculatedRouteIndex','verticalSpeed'] as const)
            if(p[key]!==undefined&&!Number.isFinite(p[key]))throw new Error('Invalid aircraft geometry')
        if(p.latitude!==undefined&&Math.abs(p.latitude)>90||p.longitude!==undefined&&Math.abs(p.longitude)>180)throw new Error('Invalid aircraft position')
        if(p.threshold!==undefined&&!validRunwayGeometry(p.threshold)){delete p.threshold;p.dataWarnings=[...(p.dataWarnings||[]),'SDK runway threshold unavailable; using published geometry']}
    }
    for(const w of Object.values(value.winds||{}) as any[])if(!w||!Number.isFinite(w.direction)||w.direction<0||w.direction>360||!Number.isFinite(w.speed)||w.speed<0||w.speed>100||!Number.isFinite(w.timestamp))throw new Error('Invalid surface wind')
    // Optional sector geometry can include inactive/extra runway pairs. It must
    // not invalidate fresh flight predictions or independently read ARR/DEP flags.
    const runways=Object.fromEntries(Object.entries(value.runways||{}).filter(([key,g])=>RUNWAYS.includes(key)&&validRunwayGeometry(g)))
    return {...value,flights,runways}
}
// A conservative acceleration allowance on the existing pre-feeder model.
// Unknown types, TMA/final traffic and missing geometry get no gain capacity.
export function gainCapacitySeconds(p:TelemetryFlight,config:EngineConfig,profile?:EngineFlight['distanceProfile']){
    const before=profile?.beforeFeederNm??0
    const performance=performanceAt(p.aircraft,p.altitude,'descent',config.performanceModel)
    if(!performance||!performance.gainEligible||p.altitude>performance.ceilingFeet)return 0
    if(p.speedDataValid===false||config.predictionMode==='euroscope'||!profile||before<=40||p.groundspeed<100||p.altitude<3000||
        (p.positionAgeSeconds??Infinity)>15||!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude)||(p.verticalSpeed??0)>300)return 0
    const phaseIas=Math.min(performance.nominalIas,p.wake==='L'?180:config.starApproachSpeed??250)
    const capIas=Math.min(phaseIas,p.assignedSpeed&&p.assignedSpeed>0?p.assignedSpeed:Infinity)
    // Use a conservative adverse wind allowance where en-route wind is absent.
    const capGs=Math.min(performance.nominalTas,config.starCruiseSpeed??450,iasToTas(capIas,Math.min(p.altitude,config.starEntryAltitude??18000))-config.surfaceWindSpeed)
    const faster=Math.min(p.groundspeed+40,capGs)
    if(faster<=p.groundspeed)return 0
    const baseline=feederTrajectory(before,p,config),fast=feederTrajectory(before,p,config,faster)
    // Both candidates start from the same observed state and include the
    // response/acceleration phase; the fast candidate must also reach a
    // feasible downstream arrival without introducing extra track.
    const runway=STAR_RUNWAYS[p.runway],fix=STAR_FEEDERS[profile.id.split(':')[0]]??STAR_FEEDERS[profile.procedure.match(/^(ELTOK|NILUG|XILAN|VACRA)/)?.[1]??'']
    const heading=runway&&fix?bearingBetween(fix,runway):runway?.heading??p.heading??0
    const trajectory=(f:typeof baseline)=>arrivalTrajectory({distanceNm:profile.remainingNm,altitudeFeet:f.altitudeFeet,heading,aircraft:p.aircraft,wake:p.wake,assignedSpeed:p.assignedSpeed,initialGroundspeed:f.groundspeedKnots},config)
    const a=trajectory(baseline),b=trajectory(fast)
    if(!baseline.complete||!fast.complete||!a.feasible||!b.feasible||b.requiredExtensionNm>a.requiredExtensionNm+.1)return 0
    return Math.max(0,Math.floor(baseline.seconds+a.seconds-fast.seconds-b.seconds-15))
}
export function reconcileRunwayAssignments(input:Telemetry,edits:Record<string,FlightEdit>,previous?:EngineSnapshot|null){
    const next=reconcileMissedApproaches(input,edits,previous)
    for(const p of input.flights){
        const edit=edits[p.callsign],old=previous?.flights.find(f=>f.callsign===p.callsign)
        const assigned=edit?.runwayAssignment??old?.euroscopeRunway??(old?.runwaySource==='filed'?old.runway:undefined)
        if(!edit?.runway||assigned===undefined||assigned===p.runway)continue
        const cleared={...edit}
        delete cleared.runway;delete cleared.runwayAssignment;delete cleared.target;delete cleared.swapAt;delete cleared.arrivalProfile;delete cleared.closurePosition
        next[p.callsign]=cleared
    }
    return next
}
// Capture the flag's rising edge. Clearing it does not automatically reinsert
// the flight; an explicit Resume may reinsert it while the flag is still set.
export function reconcileMissedApproaches(input:Telemetry,edits:Record<string,FlightEdit>,previous?:EngineSnapshot|null){
    const next={...edits}
    for(const p of input.flights){
        if(p.arrival!=='ESSA'||!p.topskyMissedApproach||(p.positionAgeSeconds??0)>15)continue
        const old=previous?.flights.find(f=>f.callsign===p.callsign),e=next[p.callsign]||{}
        if(old?.topskyMissedApproach&&!old.lost||e.mode==='removed')continue
        next[p.callsign]={...e,mode:'missed',changedAt:input.timestamp,order:undefined,target:undefined,swapAt:undefined,requeueAt:undefined,landedAt:undefined,closurePosition:undefined}
    }
    return next
}
export function validateEdits(value: any): Record<string, FlightEdit> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 1000) throw new Error('Invalid flight edits')
    const result: Record<string, FlightEdit> = {}
    for (const [callsign, raw] of Object.entries(value)) {
        const e = raw as FlightEdit
        if (!/^[A-Z0-9_-]{2,16}$/.test(callsign) || !e || typeof e !== 'object' ||
            (e.runway !== undefined && !RUNWAYS.includes(e.runway)) ||
            (e.runwayAssignment!==undefined&&(typeof e.runwayAssignment!=='string'||e.runwayAssignment!==''&&!RUNWAYS.includes(`ESSA/${e.runwayAssignment}`))) ||
            (e.mode !== undefined && !['sequenced', 'desequenced', 'removed', 'missed'].includes(e.mode))) throw new Error('Invalid flight edit')
        for (const key of ['slotBefore', 'slotAfter', 'order', 'recomputeAt', 'changedAt', 'target','swapAt','requeueAt','landedAt','refreshDelayAt','etaFfOverride'] as const)
            if (e[key] !== undefined && (!Number.isFinite(e[key]) || e[key]! < 0)) throw new Error('Invalid flight edit')
        if ((e.slotBefore || 0) > 999 || (e.slotAfter || 0) > 999) throw new Error('Flight slot too large')
        if(e.maximumDelayMinutes!==undefined&&![0,3,5,10,15].includes(e.maximumDelayMinutes))throw new Error('Select a maximum delay of 0, 3, 5, 10 or 15 minutes')
        if(e.closurePosition&&(!e.closurePosition.id||typeof e.closurePosition.id!=='string'||!['before','after'].includes(e.closurePosition.side)))throw new Error('Invalid closure position')
        if(e.arrivalProfile!==undefined&&(typeof e.arrivalProfile!=='string'||e.arrivalProfile.length>100))throw new Error('Invalid arrival profile')
        if(e.targetKind!==undefined&&!['time','sequence'].includes(e.targetKind))throw new Error('Invalid target purpose')
        if(e.orderGroup!==undefined&&(typeof e.orderGroup!=='string'||!/^[a-z0-9-]{1,64}$/.test(e.orderGroup)))throw new Error('Invalid sequence edit group')
        result[callsign] = { ...e }
    }
    return result
}
export function effectiveConfig(config: EngineConfig, time: number): EngineConfig {
    const current={...config,active:[...config.active],rates:{...config.rates}}
    const events=[...(config.pending?[{kind:'configuration',at:config.pending.at}]:[]),...(config.pendingRate?[{kind:'rate',at:config.pendingRate.at}]:[])].sort((a,b)=>a.at-b.at||(a.kind==='configuration'?-1:1))
    for(const event of events){
        if(event.at>time)continue
        if(event.kind==='configuration'){
            current.active=[...config.pending!.active]
            current.departureRunway=config.pending!.departureRunway??current.departureRunway
            // A runway configuration owns its selected arrival rate, not a
            // stale snapshot of all other runways' rates.
            if(config.pending!.applyRate!==false)for(const runway of current.active)current.rates[runway]=config.pending!.rates[runway]
        }else{
            const runway=current.active.find(r=>r.startsWith('ESSA/'))??current.active[0]
            current.rates[runway]=config.pendingRate!.seconds
        }
    }
    const essa=current.active.filter(r=>r.startsWith('ESSA/'))
    return {...current,active:current.active.filter(r=>!r.startsWith('ESSA/')||r===essa[0]),departureRunway:current.departureRunway??essa[1]??DEFAULT_CONFIG.departureRunway}
}
export function rateDistanceNm(seconds: number, runway: string, config: EngineConfig) {
    const heading = ({'01L':10,'01R':10.4,'08':75.9,'19L':190.4,'19R':190,'26':255.9,'12':120,'30':300} as Record<string,number>)[runway.split('/')[1]] || 0
    const headwind = config.surfaceWindDirection===0?0:config.surfaceWindSpeed * Math.cos((config.surfaceWindDirection-heading)*Math.PI/180)
    return seconds / 3600 * Math.max(50,config.landingSpeedKnots-headwind)
}
export function validateLockedEdits(snapshot:EngineSnapshot|null,previous:Record<string,FlightEdit>,next:Record<string,FlightEdit>,config?:EngineConfig){
    // Phase locks constrain automatic scheduling, not an operator's explicit action.
    // Transport boundaries validate edits and operator permissions separately.
}
function chooseState(old: EngineFlight | undefined, ffSeconds: number, landingSeconds: number, age: number, config: EngineConfig) {
    if (old && old.state>=1 && old.state<=3) {
        if(landingSeconds<=config.frozenMinutes*60)return 3
        if(ffSeconds<=config.superStableMinutes*60)return Math.max(2,old.state)
        return old.state
    }
    if (age < config.unstableSeconds) return 0
    if (landingSeconds <= config.frozenMinutes * 60) return 3
    if (ffSeconds <= config.superStableMinutes * 60 || ((old?.state || 0)>=2 && ffSeconds <= (config.superStableMinutes + (config.superStableBufferMinutes??5)) * 60)) return 2
    if (ffSeconds <= config.stableMinutes * 60 || ((old?.state || 0) >= 1 && ffSeconds <= (config.stableMinutes + (config.stableBufferMinutes??5)) * 60)) return 1
    return 0
}
function afterSlots(time: number, runway: string, config: EngineConfig): number {
    for (const s of [...config.slots].filter(s => s.runway === runway).sort((a, b) => a.begin - b.begin))
        if (time >= s.begin && time < s.end) time = s.end
    return time
}
export function wakeDistanceNm(leader:string,follower:string) {
    return leader === 'J' ? ({ H: 6, M: 7, L: 8 }[follower] || 3) : leader === 'H' ? ({ H: 4, M: 5, L: 6 }[follower] || 3) : leader === 'M' && follower === 'L' ? 5 : 3
}
export function wakeInterval(leader: string, follower: string, runway: string, config: EngineConfig) {
    // ICAO distance planning matrix; not RECAT. Source: EUROCONTROL RECAT-EU ed.2, table 1.
    const nm = wakeDistanceNm(leader,follower)
    const heading = ({ '01L': 10, '01R': 10.4, '08': 75.9, '19L': 190.4, '19R': 190, '26': 255.9, '12': 120, '30': 300 } as Record<string, number>)[runway.split('/')[1]] || 0
    const headwind = config.surfaceWindDirection===0?0:config.surfaceWindSpeed * Math.cos((config.surfaceWindDirection - heading) * Math.PI / 180)
    return nm / Math.max(50, config.landingSpeedKnots - headwind) * 3600
}
export function windConfig(config:EngineConfig,airport:string,winds:Telemetry['winds'],now:number):EngineConfig {
    const wind=winds?.[airport]
    return config.surfaceWindAuto!==false && wind && now-wind.timestamp<3600000 && now>=wind.timestamp-30000 ?
        {...config,surfaceWindDirection:wind.direction,surfaceWindSpeed:wind.speed}:config
}
export function routeRunwayGeometry(p:TelemetryFlight):RunwayGeometry|undefined {
    if(p.arrival!=='ESSA')return undefined
    const threshold=p.route.find(r=>r.name===`SA${p.runway}`),final=p.route.find(r=>r.name===`FI${p.runway}`)
    if(!threshold||!final||![threshold.latitude,threshold.longitude,final.latitude,final.longitude].every(Number.isFinite))return undefined
    const a={latitude:final.latitude!,longitude:final.longitude!},b={latitude:threshold.latitude!,longitude:threshold.longitude!},heading=bearingBetween(a,b)
    const relative=finalPosition(a,{...b,heading}),distance=Math.hypot(relative.along,relative.cross)
    const nominal=Number(p.runway.slice(0,2))*10%360
    if(distance<1||distance>25||headingDifference(heading,nominal)>20)return undefined
    return {...b,heading}
}
export function euroscopeFeederBufferMinutes(p:TelemetryFlight,config:EngineConfig,old?:EngineFlight){
    const feeder=p.route.find(point=>FEEDERS.some(g=>g.airport===p.arrival&&(g.fixes as readonly string[]).includes(point.name)))
    const near=!!old&&old.state>=2&&old.state<=3||!!feeder&&feeder.seconds+Math.min(config.euroscopeBufferMinutes??2,config.euroscopeSuperstableBufferMinutes??1)*60<=SUPERSTABLE_MINUTES*60||p.landingSeconds>0&&p.landingSeconds<=config.frozenMinutes*60
    const normal=config.euroscopeBufferMinutes??2
    return near?Math.min(normal,config.euroscopeSuperstableBufferMinutes??1):normal
}
export function euroscopeBufferMinutes(p:TelemetryFlight,config:EngineConfig,old?:EngineFlight){
    const base=euroscopeFeederBufferMinutes(p,config,old)
    return predictLanding(p,config,base,old?.landingPrediction,old?.lastSeen??0).correctionSeconds/60
}
export function correctedPrediction(p:TelemetryFlight,config:EngineConfig,old?:EngineFlight,timestamp=Date.now()) {
    if(config.timingModel==='euroscope-buffer')return {seconds:predictLanding(p,config,euroscopeFeederBufferMinutes(p,config,old),old?.landingPrediction,timestamp).seconds,source:'route' as const,trajectory:undefined,vectorDetection:undefined,vectorCandidateSince:undefined,distanceProfile:undefined,feederSeconds:undefined,feeder:undefined,passedFeeder:undefined,error:undefined}
    const distance=config.predictionMode!=='euroscope'?starPrediction(p,config,old):undefined
    let trajectory=distance?.trajectory
    let seconds=distance?.seconds??p.landingSeconds, source:EngineFlight['predictionSource']=distance?(distance.error?'unavailable':'star-distance'):'route'
    const group=FEEDERS.find(g=>g.airport===p.arrival && p.route.some(r=>g.fixes.some(f=>f===r.name)))
    for(const path of distance?[]:config.delayPaths||[]) {
        if(path.airport!==p.arrival||!path.runways.some(r=>r==='*'||r===p.runway)||!path.feeders.some(f=>f==='*'||f===group?.name))continue
        const start=p.route.findIndex((r,i)=>r.name===path.points[0]&&path.points.every((name,j)=>p.route[i+j]?.name===name))
        if(start<0)continue
        const end=start+path.points.length-1
        const calculated=p.calculatedRouteIndex??-1
        const next=calculated>=start?calculated+1:start
        if(next>=end)continue
        const a=p.route[next],b=p.route[end]
        // A shortcut replaces the remaining arc between its endpoints. Their
        // coordinates are required: removing all elapsed time would teleport.
        if([a.latitude,a.longitude,b.latitude,b.longitude].every(v=>Number.isFinite(v))) {
            const pos=finalPosition({latitude:a.latitude!,longitude:a.longitude!},{latitude:b.latitude!,longitude:b.longitude!,heading:0})
            const direct=Math.hypot(pos.along,pos.cross)/Math.max(100,p.groundspeed)*3600
            seconds-=Math.max(0,b.seconds-a.seconds-direct);source='delaypath'
        }
    }
    const passed=distance?.passedFeeder??(old?.passedFeeder||!!group&&!p.route.some(r=>group.fixes.some(f=>f===r.name)&&r.seconds>=0))
    const mode=config.vectoringMode??1,threshold=p.threshold??routeRunwayGeometry(p)??(distance?STAR_RUNWAYS[p.runway]:undefined)
    const eligible=(old?.state||0)>=2 || (distance?.feederSeconds!==undefined?distance.feederSeconds<=config.superStableMinutes*60:p.route.some(r=>group?.fixes.some(f=>f===r.name)&&r.seconds<=config.superStableMinutes*60))
    let vectorDetection:EngineFlight['vectorDetection'],vectorCandidateSince:number|undefined
    const fresh=(p.positionAgeSeconds??0)<=15
    if(mode>0&&eligible&&(mode===2||passed)&&fresh&&threshold&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Number.isFinite(p.heading)&&p.groundspeed>=60){
        const point=p as GeoPoint,final=finalPosition(point,threshold)
        const onFinal=final.along>=0&&final.along<=(config.maxFinalNm??15)&&Math.abs(final.cross)<=.35&&headingDifference(p.heading!,threshold.heading)<=15
        const explicit=(p.assignedHeading??0)>0&&(p.assignedHeading??0)<=360
        const index=p.calculatedRouteIndex??-1,a=p.route[index],b=p.route[index+1]
        let offRoute=false
        if(a&&b&&[a.latitude,a.longitude,b.latitude,b.longitude].every(Number.isFinite)){
            const heading=bearingBetween(a as GeoPoint,b as GeoPoint),relative=finalPosition(point,{latitude:b.latitude!,longitude:b.longitude!,heading})
            offRoute=Math.abs(relative.cross)>2.5||(Math.abs(relative.cross)>1&&headingDifference(p.heading!,heading)>40)
        }
        const direct=p.direct&&p.route.find(r=>r.name===p.direct&&Number.isFinite(r.latitude)&&Number.isFinite(r.longitude))
        if(direct&&headingDifference(p.heading!,bearingBetween(point,direct as GeoPoint))<=25)offRoute=false
        vectorCandidateSince=offRoute?old?.vectorCandidateSince??timestamp:undefined
        if(onFinal)vectorDetection='final'
        else if(explicit)vectorDetection='heading'
        else if(offRoute&&timestamp-vectorCandidateSince!>=6000)vectorDetection='off-route'
        if(vectorDetection){
            const headwind=config.surfaceWindDirection===0?0:config.surfaceWindSpeed*Math.cos((config.surfaceWindDirection-threshold.heading)*Math.PI/180)
            seconds=vectoringSeconds(point,p.heading!,threshold,config.finalLengths?.[`${p.arrival}/${p.runway}`]??10,p.groundspeed,vectorDetection==='final'?p.groundspeed:config.landingSpeedKnots-headwind)
            if(distance){
                const path=vectoringDistance(point,p.heading!,threshold,config.finalLengths?.[`${p.arrival}/${p.runway}`]??10,p.groundspeed)
                trajectory=arrivalTrajectory({distanceNm:path.turnNm+path.finalNm,altitudeFeet:p.altitude,heading:threshold.heading,aircraft:p.aircraft,wake:p.wake,assignedSpeed:p.assignedSpeed,initialGroundspeed:p.groundspeed,observedFinal:vectorDetection==='final'},config)
                seconds=trajectory.seconds;source=vectorDetection==='final'?'final-position':'vector-profile'

                if(distance.distanceProfile)distance.distanceProfile.remainingNm=path.turnNm+path.finalNm
            }else source='vectoring'
        }
    }
    return {seconds:Math.max(0,seconds),trajectory,source,vectorDetection,vectorCandidateSince,distanceProfile:distance?.distanceProfile,feederSeconds:distance?.feederSeconds,feeder:distance?.feeder,passedFeeder:distance?.passedFeeder,error:source==='unavailable'?distance?.error:undefined}

}
export function migrateSequenceEdits(edits:Record<string,FlightEdit>,snapshot?:EngineSnapshot):Record<string,FlightEdit>{
    const old=new Map(snapshot?.flights.map(f=>[f.callsign,f])??[])
    return Object.fromEntries(Object.entries(edits).map(([name,e])=>{
        const f=old.get(name)
        const legacySlot=e.targetKind===undefined&&e.target!==undefined&&e.order!==undefined&&!!f?.trajectory&&f.state>=2&&f.state<=3&&f.tmaTiming?.instructionSource!=='manual'&&!e.closurePosition&&!e.requeueAt
        return [name,e.targetKind==='sequence'||legacySlot?{...e,target:undefined,targetKind:'sequence' as const}:e]
    }))
}
export function reorderEdits(snapshot:EngineSnapshot,edits:Record<string,FlightEdit>,callsign:string,displayTime:number,view='Runway',config?:EngineConfig,closurePosition?:FlightEdit['closurePosition']) {
    const flight=snapshot.flights.find(f=>f.callsign===callsign)
    if(!flight||flight.lost||flight.issue||flight.mode!=='sequenced')throw new Error('Only available aircraft can be reordered')
    const runway=edits[callsign]?.runway||`${flight.arrival}/${flight.runway}`
    const original=snapshot.flights.filter(f=>!f.lost&&!f.issue&&f.mode==='sequenced'&&f.state!==4&&
        (edits[f.callsign]?.runway||`${f.arrival}/${f.runway}`)===runway).sort((a,b)=>a.order-b.order)
    const queue=original.filter(f=>f.callsign!==callsign)
    // The original confirms a move before the first strictly later slot.
    // Equality must cross the neighbouring slot instead of undoing the drag.
    const position=queue.findIndex(f=>(view==='ACC'?f.staFf:f.sta)>displayTime)
    queue.splice(position<0?queue.length:position,0,flight)
    const changes:Record<string,FlightEdit>=JSON.parse(JSON.stringify(migrateSequenceEdits(edits,snapshot)))
    const orderGroup=`${snapshot.timestamp}-${Math.random().toString(36).slice(2,10)}`
    // The pointer chooses sequence position. An order change does not issue
    // an absolute landing time to every aircraft whose position changes.
    queue.forEach((f,i)=>{
        if(f.callsign===original[i]?.callsign)return
        const slot=original[i]
        const explicitTime=changes[f.callsign]?.target!==undefined&&(changes[f.callsign]?.targetKind==='time'||f.state===1&&changes[f.callsign]?.targetKind!=='sequence'||f.tmaTiming?.instructionSource==='manual')
        const reinsert=f.callsign===callsign&&flight.state===4
        changes[f.callsign]={...changes[f.callsign],order:slot?.order??(original.at(-1)?.order??-1)+1,
            target:reinsert?slot?.sta??Math.max(snapshot.timestamp,displayTime):explicitTime?changes[f.callsign].target:undefined,targetKind:explicitTime||reinsert?'time':'sequence',orderGroup,swapAt:undefined,changedAt:snapshot.timestamp,
            ...(f.callsign===callsign&&flight.state===4?{requeueAt:snapshot.timestamp,recomputeAt:snapshot.timestamp,landedAt:undefined}: {})}
    })
    // Preserve ordinary slot insertion; only a deliberate closure-side drop
    // changes which side of the blocked interval this flight occupies.
    changes[callsign]={...changes[callsign],closurePosition}
    if(closurePosition&&config?.slots.some(s=>s.id===closurePosition.id&&s.runway===runway)){
        changes[callsign]={...changes[callsign],order:queue.findIndex(f=>f.callsign===callsign),changedAt:snapshot.timestamp}
    }
    validateLockedEdits(snapshot,edits,changes,config)
    return changes
}
// One-way dependency: raw route ETA -> runway schedule -> feeder schedule -> delay.
function sequenceCandidates(flights:EngineFlight[]){
    const lanes=new Map<string,EngineFlight[]>()
    for(const flight of flights){
        // A flight which already crossed a feeder must not be overtaken by
        // its upstream follower just because its approach is predicted longer.
        const key=flight.distanceProfile?`feeder:${flight.ff}`:`flight:${flight.callsign}`
        const lane=lanes.get(key)||[];lane.push(flight);lanes.set(key,lane)
    }
    for(const lane of lanes.values())lane.sort((a,b)=>a.etaFf-b.etaFf||a.eta-b.eta||a.callsign.localeCompare(b.callsign))
    const result:EngineFlight[]=[]
    while(lanes.size){
        const head=[...lanes.entries()].sort((a,b)=>a[1][0].eta-b[1][0].eta||a[1][0].callsign.localeCompare(b[1][0].callsign))[0]
        result.push(head[1].shift()!);if(!head[1].length)lanes.delete(head[0])
    }
    return result
}
function preserveEnteredOrder(queue:EngineFlight[],old:Map<string,EngineFlight>,edits:Record<string,FlightEdit>,fresh:(name:string)=>boolean){
    const edges=new Map(queue.map(f=>[f.callsign,new Set<string>()])),degree=new Map(queue.map(f=>[f.callsign,0]))
    for(let i=0;i<queue.length;i++)for(let j=i+1;j<queue.length;j++){
        const a=queue[i],b=queue[j],pa=old.get(a.callsign),pb=old.get(b.callsign),ea=edits[a.callsign]??{},eb=edits[b.callsign]??{}
        // Ranks written by the same controller edit retain their relative
        // meaning after preceding aircraft land and queue indices shrink.
        const sameGroup=ea.orderGroup&&eb.orderGroup?ea.orderGroup===eb.orderGroup:!ea.orderGroup&&!eb.orderGroup&&ea.changedAt!==undefined&&ea.changedAt===eb.changedAt
        const sharedEdit=ea.order!==undefined&&eb.order!==undefined&&sameGroup&&ea.order!==eb.order
        let before:string|undefined,after:string|undefined
        if(sharedEdit){[before,after]=ea.order!<eb.order!?[a.callsign,b.callsign]:[b.callsign,a.callsign]}
        else if(pa&&pb&&pa.editTracking&&pb.editTracking&&pa.mode==='sequenced'&&pb.mode==='sequenced'&&pa.runway===a.runway&&pb.runway===b.runway&&
            (pa.state>=2||a.state>=2)&&(pb.state>=2||b.state>=2)&&
            !(fresh(a.callsign)&&ea.order!==undefined&&ea.order!==pa.order)&&!(fresh(b.callsign)&&eb.order!==undefined&&eb.order!==pb.order)){
            [before,after]=pa.order<pb.order?[a.callsign,b.callsign]:[b.callsign,a.callsign]
        }
        if(before&&after&&!edges.get(before)!.has(after)){edges.get(before)!.add(after);degree.set(after,degree.get(after)!+1)}
    }
    const remaining=[...queue],result:EngineFlight[]=[]
    while(remaining.length){
        const index=remaining.findIndex(f=>degree.get(f.callsign)===0)
        // Contradictory legacy ranks cannot justify automatic reshuffling.
        if(index<0)return [...queue].sort((a,b)=>(old.get(a.callsign)?.order??a.order)-(old.get(b.callsign)?.order??b.order))
        const f=remaining.splice(index,1)[0];result.push(f)
        for(const next of edges.get(f.callsign)!)degree.set(next,degree.get(next)!-1)
    }
    return result
}
function surfacePosition(p:TelemetryFlight,runways:Record<string,RunwayGeometry>,maxAlong=-.1){
    if(!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude)||!Number.isFinite(p.heading))return undefined
    const geometry={...runways,...(p.threshold?{[`${p.arrival}/${(p as EngineFlight).euroscopeRunway??p.runway}`]:p.threshold}:{})}
    return Object.entries(geometry).filter(([key])=>key.startsWith('ESSA/')).map(([runway,threshold])=>({runway,...finalPosition(p as GeoPoint,threshold),heading:threshold.heading}))
        .filter(pos=>pos.along<=maxAlong&&pos.along>=-2&&Math.abs(pos.cross)<.12&&headingDifference(p.heading!,pos.heading)<20)
        .sort((a,b)=>Math.abs(a.cross)-Math.abs(b.cross))[0]
}
export function dragChangesTime(state:number,previousPosition:number,nextPosition:number,forceTime=false){
    return state===1&&(forceTime||previousPosition===nextPosition)
}
export function retimeEdits(snapshot:EngineSnapshot,edits:Record<string,FlightEdit>,callsign:string,displayTime:number,view='Runway',config?:EngineConfig){
    const flight=snapshot.flights.find(f=>f.callsign===callsign)
    if(!flight||flight.state!==1)throw new Error('Only Stable aircraft can receive a manual time by dragging')
    const target=view==='ACC'?flight.sta+(displayTime-flight.staFf):displayTime
    if(!Number.isFinite(target)||target<=snapshot.timestamp)throw new Error('Choose a future time')
    const changes=reorderEdits(snapshot,edits,callsign,displayTime,view,config)
    // Changing a Stable time does not exchange the other flights' time slots.
    changes[callsign]={...changes[callsign],order:changes[callsign]?.order??flight.order,target,targetKind:'time',changedAt:snapshot.timestamp,closurePosition:undefined,swapAt:undefined}
    validateLockedEdits(snapshot,edits,changes,config)
    return changes
}
// Scheduled times and old delays are NEVER fed back into the input ETA.
export function runEngine(input: Telemetry, config: EngineConfig, edits: Record<string, FlightEdit>, previous?: EngineSnapshot): EngineSnapshot {
    if (previous && input.timestamp <= previous.timestamp) return previous
    const now = input.timestamp
    const previousEtas=new Map(previous?.flights.map(f=>[f.callsign,f.eta])||[])
    // Public ETA is a live forecast. Schedule against the accepted capture,
    // including when loading an older checkpoint, without mutating that checkpoint.
    if(config.timingModel==='euroscope-buffer'&&input.source!=='DEMO'&&previous)
        previous={...previous,flights:previous.flights.map(f=>f.euroscopeBaseline?{...f,eta:f.euroscopeBaseline.eta}:f)}
    const originalEdits=edits
    edits=migrateSequenceEdits(edits,previous)
    const retiredTargets=new Set(Object.keys(originalEdits).filter(name=>originalEdits[name].target!==undefined&&edits[name]?.target===undefined))
    const currentConfig = effectiveConfig(config, now)
    const slotsKey = JSON.stringify(config.slots)
    const closuresChanged = !!previous && previous.slotsKey !== slotsKey
    const oldByCallsign = new Map(previous?.flights.map(f => [f.callsign, f]) || [])
    const freshEdit=(callsign:string)=>{
        const old=oldByCallsign.get(callsign),e=edits[callsign]||{}
        return old?.editTracking ? old.appliedOrder!==e.order||old.appliedTarget!==e.target||old.appliedChangedAt!==e.changedAt||old.appliedOrderGroup!==e.orderGroup :
            (e.changedAt??0)>=(previous?.timestamp??Infinity)
    }
    const winds=input.winds??previous?.winds
    const landingGeometry={...Object.fromEntries(Object.entries(STAR_RUNWAYS).map(([key,value])=>[`ESSA/${key}`,value])),...input.runways}
    const traffic=input.flights.filter(f=>f.arrival==='ESSA')
    const present = new Set(traffic.map(f => f.callsign))
    const grounded:Record<string,number>={}
    const manual=(config.manualFlights || []).filter(f=>f.runway.startsWith('ESSA/')&&!present.has(f.callsign))
    const manualCalls=new Set(manual.map(f=>f.callsign))
    const predictions:TelemetryFlight[]=[...traffic,...manual.map(f=>({callsign:f.callsign,aircraft:f.aircraft,wake:f.wake,departure:f.departure??'----',arrival:f.runway.split('/')[0],runway:f.runway.split('/')[1],
        route:f.feeder==='OTHER'?[]:[{name:f.feeder,seconds:f.feederEta!==undefined?(f.feederEta-now)/1000:(f.eta-now)/1000-(config.defaultFeederMinutes??15)*60}],landingSeconds:(f.eta-now)/1000,distanceNm:100,groundspeed:140,altitude:10000}))]
    manual.forEach(f=>present.add(f.callsign))
    const flights: EngineFlight[] = []
    const diagnostics: string[] = []
    for (const p of predictions) {
        const old = oldByCallsign.get(p.callsign)
        const e = edits[p.callsign] || {}
        const bufferMode=config.timingModel==='euroscope-buffer'&&input.source!=='DEMO'&&!manualCalls.has(p.callsign)
        const modelRebase=bufferMode?!!old&&!old.euroscopeBaseline&&!old.issue:config.predictionMode!=='euroscope'&&old&&old.state<=1&&e.target===undefined&&!['star-distance','vector-profile','final-position'].includes(old.predictionSource??'')&&input.source!=='DEMO'&&!manualCalls.has(p.callsign)
        let recompute = !!modelRebase || (e.recomputeAt || 0) > (old?.recomputedAt || 0)
        const resumed=!!old && old.mode!=='sequenced' && (e.mode||'sequenced')==='sequenced'
        const firstSeen = old?.firstSeen ?? now
        const editedOrder=e.order!==undefined&&(!old||freshEdit(p.callsign))?e.order:old?.order
        let runway = e.runway || (p.runway?`${p.arrival}/${p.runway}`:currentConfig.active.find(r=>r.startsWith('ESSA/'))||`${p.arrival}/`)
        // The SDK assignment and shared runway plan can arrive in either order.
        // Keep the accepted queue intact until both confirm the new runway.
        const acceptedRunway=old?`${old.arrival}/${old.runway}`:undefined
        const capturedRunway=old?.euroscopeBaseline?.runway??acceptedRunway
        const transitionEligible=bufferMode&&!!old?.euroscopeBaseline&&old.mode==='sequenced'&&old.state!==4&&!old.issue&&e.runway===undefined
        const establishedAirborne=!!old?.euroscopeBaseline&&old.state!==4&&old.mode==='sequenced'&&now-old.lastSeen<=15000
        const usableEuroScope=p.groundspeed>=60&&(p.altitude>=350||establishedAirborne&&p.altitude>=-100)&&(p.positionAgeSeconds??0)<=15&&Number.isFinite(p.landingSeconds)&&p.landingSeconds>=0&&p.route.length>0
        const confirmedRunwayChange=transitionEligible&&runway!==capturedRunway&&currentConfig.active.includes(runway)&&usableEuroScope&&p.landingSeconds>0
        const obsoleteApproach=transitionEligible&&usableEuroScope&&currentConfig.active.includes(runway)&&
            runway===`${p.arrival}/${p.runway}`&&p.route.some(point=>point.name===`SA${p.runway}`)&&
            old.amanRoute?.some(point=>/^SA(01L|01R|08|19L|19R|26)$/.test(point.name)&&point.name!==`SA${p.runway}`)
        const waitingRunwayChange=transitionEligible&&!confirmedRunwayChange&&
            (runway!==acceptedRunway||!currentConfig.active.includes(acceptedRunway!))
        const priorTransition=old?.runwayTransition
        const cohortPending=priorTransition&&previous?.flights.some(f=>f.runwayTransition?.pending&&f.runwayTransition.from===priorTransition.from&&f.runwayTransition.to===priorTransition.to)
        const runwayTransition=waitingRunwayChange||confirmedRunwayChange?{
            from:priorTransition?.pending?priorTransition.from:acceptedRunway!,to:runway!==acceptedRunway?runway:currentConfig.active[0],
            order:e.order!==undefined&&freshEdit(p.callsign)?e.order:priorTransition?.pending?priorTransition.order:old!.order,pending:waitingRunwayChange
        }:!priorTransition?.pending&&cohortPending&&!freshEdit(p.callsign)?priorTransition:undefined
        if(waitingRunwayChange){runway=acceptedRunway!;recompute=false}
        const predictionConfig=windConfig({...currentConfig,timingModel:bufferMode?'euroscope-buffer':'performance',predictionMode:bufferMode?'euroscope':input.source==='DEMO'||manualCalls.has(p.callsign)?'euroscope':currentConfig.predictionMode??'star'},p.arrival,winds,now)
        const geometry=()=>input.runways?.[runway]??(runway===`${p.arrival}/${p.runway}`?p.threshold:undefined)??routeRunwayGeometry({...p,runway:runway.split('/')[1]})??(predictionConfig.predictionMode==='star'?STAR_RUNWAYS[runway.split('/')[1]]:undefined)
        let threshold=geometry()
        const requeued=!!e.requeueAt && (e.target??old?.sta??0)>now && (e.recomputeAt||0)<=e.requeueAt
        let prediction=correctedPrediction({...p,arrivalProfile:e.arrivalProfile??p.arrivalProfile,runway:runway.split('/')[1],threshold},predictionConfig,old,now)
        const assignedRunwayChanged=old?.euroscopeRunway!==undefined&&old.euroscopeRunway!==p.runway
        const sdkRunwayExplicit=assignedRunwayChanged||old?.sdkRunwayExplicit===true&&old.euroscopeRunway===p.runway
        let automaticFuture=false
        if(e.runway===undefined&&!sdkRunwayExplicit&&!old?.secondaryRunwayAccepted&&!waitingRunwayChange){
            const basis=e.target??(!recompute&&old?.mode==='sequenced'&&old.state>=1?old.sta:now+ms(prediction.seconds))
            const desired=effectiveConfig(config,Math.max(now,basis)).active.find(r=>r.startsWith('ESSA/'))
            const plannedChange=!!config.pending&&config.active.includes(`${p.arrival}/${p.runway}`)
            const immediateChange=!!old&&!old.issue&&old.runway===p.runway&&old.euroscopeRunway===p.runway&&!currentConfig.active.includes(runway)
            const existingAutomatic=old?.runwaySource==='active'&&!old.issue&&old.euroscopeRunway===p.runway
            if(desired&&desired!==runway&&(plannedChange||immediateChange||existingAutomatic)){
                runway=desired;threshold=geometry();automaticFuture=!!config.pending&&config.pending.at>now&&config.pending.active.includes(runway)
                prediction=correctedPrediction({...p,arrivalProfile:e.arrivalProfile??p.arrivalProfile,runway:runway.split('/')[1],threshold},predictionConfig,old,now)
            }
        }
        const feederObservation=bufferMode?observedFeeder(p,resumed||requeued?undefined:old,now,config):undefined
        if(feederObservation)prediction={...prediction,feeder:feederObservation.feeder,feederSeconds:feederObservation.seconds,passedFeeder:feederObservation.passed}
        const modelFeederSeconds=prediction.feederSeconds??p.route.find(r=>r.seconds>=0&&FEEDERS.some(g=>g.airport===p.arrival&&(g.fixes as readonly string[]).includes(r.name)))?.seconds??prediction.seconds-(config.defaultFeederMinutes??15)*60
        const manualFeederShift=e.etaFfOverride!==undefined&&!prediction.passedFeeder&&!old?.passedFeeder?e.etaFfOverride-(now+ms(modelFeederSeconds)):0
        const bufferFlight={...p,...(feederObservation?{route:feederObservation.feeder?[{name:feederObservation.feeder,seconds:feederObservation.seconds}]:[]}: {})}
        const feederBufferMinutes=euroscopeFeederBufferMinutes(bufferFlight,config,resumed||requeued?undefined:old)
        const landingPrediction=bufferMode?predictLanding(p,config,feederBufferMinutes,resumed||requeued||old?.state===4?undefined:old?.landingPrediction,now):undefined
        const selectedBufferMinutes=(landingPrediction?.correctionSeconds??0)/60
        const liveEuroscopeEta=bufferMode&&usableEuroScope?now+ms(landingPrediction!.rawSeconds):undefined
        const captureBaseline=bufferMode&&usableEuroScope&&(landingPrediction!.rawSeconds>0||landingPrediction!.establishedFinal&&landingPrediction!.seconds>0)&&(!old?.euroscopeBaseline||recompute||resumed||confirmedRunwayChange)
        const liveEuroscopeEtaFf=bufferMode?e.etaFfOverride??now+ms(modelFeederSeconds):undefined
        // Physical passage and explicit controller overrides take precedence.
        // Profile timing already includes the descent/slowdown; do not add a
        // second fixed buffer or feed the assigned instruction back into ETA.
        const profileFeeder=landingPrediction?.routeTiming?.feeder
        const useProfileFeeder=profileFeeder&&!feederObservation?.passed&&profileFeeder.name===feederObservation?.feeder&&e.etaFfOverride===undefined
        const liveBufferedEtaFf=liveEuroscopeEtaFf===undefined?undefined:useProfileFeeder?now+ms(profileFeeder.seconds):liveEuroscopeEtaFf+ms(feederBufferMinutes*60)
        const liveBufferedEta=liveEuroscopeEta===undefined?undefined:now+ms(landingPrediction!.seconds)
        const euroscopeBaseline=bufferMode?(captureBaseline?{at:now,runway:p.runway?`${p.arrival}/${p.runway}`:runway,eta:liveBufferedEta!+manualFeederShift,rawEta:liveEuroscopeEta!,etaFf:liveBufferedEtaFf!,rawEtaFf:liveEuroscopeEtaFf,feederBuffered:true,bufferMinutes:selectedBufferMinutes,feederBufferMinutes:useProfileFeeder?(liveBufferedEtaFf!-liveEuroscopeEtaFf!)/60000:feederBufferMinutes,groundspeed:p.groundspeed,landingReference:landingPrediction!.reference,landingMethod:landingPrediction!.method}:old?.euroscopeBaseline&&!old.euroscopeBaseline.feederBuffered?{...old.euroscopeBaseline,etaFf:old.euroscopeBaseline.etaFf+ms((old.euroscopeBaseline.feederBufferMinutes??old.euroscopeBaseline.bufferMinutes)*60),rawEtaFf:old.euroscopeBaseline.etaFf,feederBuffered:true}:old?.euroscopeBaseline):undefined
        const eta = euroscopeBaseline?.eta??now + ms(prediction.seconds)+manualFeederShift
        const resumedMissed=resumed&&old?.mode==='missed'
        const airborneAgain=previous?.grounded?.[p.callsign]!==undefined&&e.landedAt===undefined&&p.altitude>=500&&p.groundspeed>=60&&(p.verticalSpeed??0)>300&&(p.positionAgeSeconds??0)<=15
        const freshNewApproach=prediction.seconds>(config.frozenMinutes*60+60)&&p.groundspeed>=60&&p.altitude>=350&&(p.positionAgeSeconds??0)<=15
        const missedRecovery=!!resumedMissed||airborneAgain||!!old?.missedRecovery&&!freshNewApproach
        const group = prediction.feeder?FEEDERS.find(g=>g.airport===p.arrival&&g.name===prediction.feeder):(!recompute && !resumed && old?.passedFeeder ? FEEDERS.find(g=>g.airport===p.arrival&&g.id===old.feederId) : undefined) ?? FEEDERS.find(g => g.airport === p.arrival && p.route.some(r => g.fixes.some(f => f === r.name)))
        const feederPoint = prediction.feederSeconds!==undefined?(prediction.passedFeeder?undefined:{name:prediction.feeder!,seconds:prediction.feederSeconds}):group && p.route.find(r => group.fixes.some(f => f === r.name) && r.seconds >= 0)
        const retainedEntry=!!old?.passedFeeder&&(!bufferMode||old.bufferedFeederVerified)&&!requeued&&!resumed&&(prediction.feeder?old.ff===prediction.feeder:old.feederId===group?.id)
        const passed = retainedEntry||(prediction.passedFeeder??(!!group&&!feederPoint))
        const ffSeconds = passed?-1:prediction.feederSeconds??feederPoint?.seconds??prediction.seconds-(config.defaultFeederMinutes??15)*60
        const etaFf = passed && old ? old.etaFf : bufferMode?liveBufferedEtaFf!:e.etaFfOverride??now + ms(ffSeconds)
        const phaseFeederSeconds=bufferMode&&!passed?(etaFf-now)/1000:ffSeconds
        const protectedTma=!!old && passed && !recompute && !requeued && old.mode==='sequenced'
        const futureChoice=config.pending&&config.pending.at>now&&(config.pending.active.includes(runway)||config.pending.departureRunway===runway)&&!currentConfig.active.includes(runway)&&(currentConfig.departureRunway!==runway||automaticFuture||old?.runwayAvailableFrom===config.pending.at&&old.runway===runway.split('/')[1])
        const runwayAvailableFrom=futureChoice&&(automaticFuture||e.runway===runway||sdkRunwayExplicit||old?.runwayAvailableFrom===config.pending!.at&&old.runway===runway.split('/')[1])?config.pending!.at:undefined
        const runwayPlan=effectiveConfig(config,Math.max(e.target??eta,runwayAvailableFrom??0))
        const secondaryRunwayAccepted=runwayPlan.departureRunway===runway&&(e.runway===runway||sdkRunwayExplicit||old?.secondaryRunwayAccepted===true&&old.runway===runway.split('/')[1])
        const independent=predictionConfig.predictionMode==='star'
        let issue = bufferMode&&!euroscopeBaseline?'Awaiting usable airborne EuroScope ETA':prediction.error || (bufferMode||independent||protectedTma||prediction.source==='vectoring'?'':p.routeProblem||'')
        if (!RUNWAYS.includes(runway)) issue = 'No valid assigned arrival runway'
        else if (!runwayPlan.active.includes(runway)&&!secondaryRunwayAccepted&&!waitingRunwayChange) issue = 'Assigned runway is not active at its planned arrival time'
        else if (!independent && ((!missedRecovery && !requeued && !protectedTma && p.landingSeconds < 0) || (!protectedTma && p.landingSeconds > 14400))) issue = 'Invalid destination route prediction'
        else if (!independent && !missedRecovery && !requeued && !protectedTma && feederPoint && feederPoint.seconds > p.landingSeconds) issue = 'Feeder prediction is after destination'
        else if (old && !missedRecovery && !recompute && !protectedTma && prediction.source==='route' && eta - (old.lastTrustedEta ?? old.eta) > 600000) issue = 'Route ETA jumped by more than 10 minutes; review route and Recompute'
        const final=threshold&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)?finalPosition(p as GeoPoint,threshold):undefined
        const heightStable=!!old&&now-old.lastSeen<=15000&&Math.abs(p.altitude-old.altitude)<10
        const surfaceVertical=(p.verticalSpeed??0)<300&&(Math.abs(p.verticalSpeed??0)<300||heightStable)
        const surface=surfacePosition(p,landingGeometry)
        const runwayRoll=!!surface&&p.altitude>=-100&&p.altitude<200&&p.groundspeed>=0&&p.groundspeed<180&&surfaceVertical
        const groundCandidate=(runwayRoll||p.distanceNm>=0 && p.distanceNm<1 && p.groundspeed>=0 && p.groundspeed<60 && p.altitude>=-100 && p.altitude<(p.arrival==='ESSA'?350:250)) && (p.positionAgeSeconds??0)<=15
        const groundCandidateSince=groundCandidate ? old?.landingRunway===surface?.runway?old?.groundCandidateSince??now:now : undefined
        const priorGround=previous?.grounded?.[p.callsign]
        const rememberedGround=priorGround!==undefined&&p.altitude<350&&(p.positionAgeSeconds??0)<=15&&(e.recomputeAt||0)<=priorGround&&(e.requeueAt||0)<=priorGround
        const physicalLanded=rememberedGround||groundCandidate && (now-groundCandidateSince!>=5000 || (!old && p.groundspeed<5))
        const terminated=input.terminatedCallsigns?.includes(p.callsign)===true
        const landed=terminated||!requeued && (e.mode||'sequenced')!=='missed' && (!!e.landedAt || (!missedRecovery&&physicalLanded) || (old?.state===4 && !airborneAgain && !recompute && !resumed))
        if (landed) issue = ''
        const assignedSeconds=Math.max(e.target!==undefined?(e.target-now)/1000:!recompute&&old?.mode==='sequenced'?(old.sta-now)/1000:prediction.seconds,((runwayAvailableFrom??now)-now)/1000)
        const phaseSeconds=e.target!==undefined?assignedSeconds:Math.max(prediction.seconds,assignedSeconds)
        const trustedPhaseOld=bufferMode&&old&&old.passedFeeder&&!old.bufferedFeederVerified&&!passed&&e.target===undefined?{...old,state:0,passedFeeder:false}:old
        const phaseOld=trustedPhaseOld?.state===3&&assignedSeconds>(config.frozenMinutes+(freshEdit(p.callsign)?0:1))*60?{...trustedPhaseOld,state:2}:trustedPhaseOld
        const state = issue ? 0 : landed ? 4 : missedRecovery ? 2 : (waitingRunwayChange||confirmedRunwayChange)&&!resumed&&!requeued ? old!.state : e.target!==undefined&&old?.state===0 ? Math.max(1,chooseState(undefined,phaseFeederSeconds,phaseSeconds,config.unstableSeconds,config)) : requeued ? 1 : manualCalls.has(p.callsign)?Math.max(1,chooseState(phaseOld,phaseFeederSeconds,phaseSeconds,config.unstableSeconds,config)):chooseState(recompute&&phaseOld?.state!==3?undefined:phaseOld, phaseFeederSeconds, phaseSeconds, (now - firstSeen) / 1000, config)
        const onFinal=!!final && final.along>=0 && final.along<=(config.maxFinalNm??15) && Math.abs(final.cross)<=.4 &&
            Number.isFinite(p.heading)&&headingDifference(p.heading!,threshold!.heading)<=20
        // A bootstrap list is not a stream of newly inserted aircraft. Do not
        // invent ten minutes of delay for final traffic when MASTER starts.
        const established=previous?.flights.some(f=>present.has(f.callsign)&&f.mode==='sequenced'&&!f.lost&&f.state!==4&&
            (edits[f.callsign]?.runway||`${f.arrival}/${f.runway}`)===runway)
        const resumeMinimum=resumed&&old?.mode==='missed'&&e.order===undefined
        const legacyResumeMinimum=old?.minimumArrivalSource===undefined&&!!e.recomputeAt&&!!old&&e.recomputeAt>old.firstSeen&&old.minimumArrival>e.recomputeAt+1000
        const minimumArrivalSource=resumeMinimum?'resume':recompute?undefined:old?.minimumArrivalSource??(legacyResumeMinimum?'resume':'new')
        const releaseEntryMinimum=passed&&!missedRecovery&&minimumArrivalSource!=='resume'
        const minimumArrival = Math.max(runwayAvailableFrom??0,bufferMode&&!resumeMinimum?now:resumeMinimum ? now+ms(config.minimumNewSeconds) :
            recompute||releaseEntryMinimum ? now : old?.minimumArrival ?? now + ms(established&&!onFinal&&!passed?config.minimumNewSeconds:0))
        const landingStamp=old?.state===4?old.sta:rememberedGround?priorGround!:e.landedAt??(physicalLanded?previous?.landings?.filter(l=>l.callsign===p.callsign).at(-1)?.time:undefined)??now
        const retainEntryOrder=passed&&old?.mode==='sequenced'&&!resumed&&!requeued&&old.runway===runway.split('/')[1]
        if(landed)grounded[p.callsign]=landingStamp
        flights.push({ ...p, runway:runway.split('/')[1],euroscopeRunway:p.runway,sdkRunwayExplicit,runwaySource:e.runway?'manual':runway!==`${p.arrival}/${p.runway}`?'active':p.runway?'filed':'active',firstSeen, lastSeen: now, initialEta: captureBaseline&&!old?.euroscopeBaseline||old?.issue==='Awaiting usable airborne groundspeed'?eta:old?.initialEta ?? eta, initialEtaFf:captureBaseline&&!old?.euroscopeBaseline?euroscopeBaseline!.etaFf:old?.initialEtaFf??etaFf, eta, etaFf,
            euroscopeBaseline,liveEuroscopeEta,liveBufferedEta,liveEuroscopeEtaFf,liveBufferedEtaFf,landingPrediction,bufferedFeederVerified:bufferMode,
            secondaryRunwayAccepted,runwayTransition,
            runwayAvailableFrom,
            sta: landed ? landingStamp : eta, staFf: landed ? old?.staFf ?? etaFf : etaFf, feeder: group?.name || 'OTHER', feederId: group?.id || '-', ff: feederPoint?.name || (group?.airport==='ESSA'?group.fixes[0]:old?.ff) || p.route.find(r=>group?.fixes.some(f=>f===r.name))?.name || '-',
            passedFeeder: passed, groundCandidateSince,landingRunway:surface?.runway??old?.landingRunway,landingDetection:terminated?'termination':landed?e.landedAt?'manual':old?.landingDetection??'surface':undefined, missedRecovery, state, mode: e.mode==='removed'?'removed':terminated?'sequenced':e.mode || 'sequenced', delay: 0, totalDelay: 0,
            // Recompute changes timing, not an established Superstable order.
            // Otherwise the committed merge can put a Stable follower ahead
            // simply because the recomputed leader was given the sentinel rank.
            order: issue==='Awaiting usable airborne groundspeed'?Number.MAX_SAFE_INTEGER:recompute && !modelRebase && !resumed && (old?.state===3||bufferMode&&old?.state===2||retainEntryOrder) ? old!.order : (recompute&&!modelRebase) || resumed ? (requeued ? e.order ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER) : editedOrder ?? Number.MAX_SAFE_INTEGER,
            tmaAssignment:!resumed&&!requeued&&old?.runway===runway.split('/')[1]?old?.tmaAssignment:undefined,
            lost: state!==4 && (p.positionAgeSeconds??0)>15, issue, minimumArrival,minimumArrivalSource, slotBefore: e.slotBefore || 0, slotAfter: e.slotAfter || 0,
            recomputedAt: waitingRunwayChange?old!.recomputedAt:e.recomputeAt || old?.recomputedAt || 0, lastTrustedEta: issue ? old?.lastTrustedEta ?? old?.eta ?? eta : eta,
            trajectory:prediction.trajectory,distanceProfile:prediction.distanceProfile,scheduledBeforeLanding:landed?old?.scheduledBeforeLanding??(old?.state!==4?old?.sta:undefined):undefined,vectorDetection:prediction.vectorDetection,vectorCandidateSince:prediction.vectorCandidateSince,predictionSource:prediction.source,originalLandingSeconds:p.landingSeconds,finalAlongNm:onFinal?final?.along:undefined })
        const emitted=flights.at(-1)!,fix=STAR_FEEDERS[emitted.ff]
        if(bufferMode){const route=arrivalRoute(p,old,passed,confirmedRunwayChange||!!obsoleteApproach);emitted.amanRoute=route.points;emitted.amanRoutePassed=route.index}
        if(runwayTransition?.pending)diagnostics.push(`${p.callsign}: Waiting for EuroScope assignment and active runway plan to agree (${runwayTransition.from} → ${runwayTransition.to})`)
        const perf=bufferMode?undefined:performanceAt(p.aircraft,p.altitude,'descent',config.performanceModel)
        emitted.aircraftPerformance={type:perf?.type??(aircraftType(p.aircraft)||p.aircraft),status:perf?'matched':PERFORMANCE_SOURCE.ambiguousTypes.includes(aircraftType(p.aircraft))?'ambiguous':'missing',nominalIas:perf?.nominalIas,descentFpm:perf?.descentFpm,blobSha:perf?.blobSha??PERFORMANCE_SOURCE.blobSha,provider:perf?.provider??'generic',profileType:perf?.profileType,match:perf?.match,gainEligible:perf?.gainEligible??false,vmo:perf?.vmo,mmo:perf?.mmo}
        emitted.editTracking=true;emitted.appliedOrder=e.order;emitted.appliedTarget=e.target;emitted.appliedChangedAt=e.changedAt;emitted.appliedOrderGroup=e.orderGroup
        emitted.gainCapacitySeconds=bufferMode||passed?0:gainCapacitySeconds(p,predictionConfig,prediction.distanceProfile)
        if(fix&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&(p.positionAgeSeconds??0)<=15)
            emitted.feederDistanceNm=distanceNm(p as GeoPoint,fix)
        emitted.spacingActive=true
        emitted.line0Suppressed=landed || !!passed && ((emitted.feederDistanceNm??0)>=12 || !!old?.line0Suppressed&&old.ff===emitted.ff&&!resumed&&!requeued)
        if (issue) diagnostics.push(`${p.callsign}: ${issue}`)
    }
    // Confirmed landings remain as pink history for five minutes, even when
    // EuroScope removes their track. Missing airborne aircraft still disappear.
    for(const old of previous?.flights||[]){
        const edit=edits[old.callsign]||{}
        if(input.terminatedCallsigns?.includes(old.callsign)&&!present.has(old.callsign)&&edit.mode!=='removed'){
            const stamp=old.state===4?old.sta:now
            if(now-stamp<300000)flights.push({...old,state:4,mode:'sequenced',sta:stamp,delay:0,totalDelay:0,lost:false,issue:'',landingDetection:'termination'})
            grounded[old.callsign]=stamp;continue
        }
        if(input.simulation===true&&previous?.simulation===true&&input.source===previous.source&&!present.has(old.callsign)&&
            old.state!==4&&old.mode==='sequenced'&&!old.missedRecovery&&!old.topskyMissedApproach&&(!edit.mode||edit.mode==='sequenced')&&
            !old.lost&&old.altitude>=-100&&old.altitude<200&&old.groundspeed>=40&&old.groundspeed<180&&(old.verticalSpeed??0)<=300){
            const elapsed=now-old.lastSeen+ms(old.positionAgeSeconds??0)
            const surface=surfacePosition(old,{...landingGeometry,...previous.runways},.12)
            if(elapsed>=0&&elapsed<=8000&&surface&&Math.abs(surface.cross)<.08&&headingDifference(old.heading!,surface.heading)<15&&
                surface.along-old.groundspeed*elapsed/3600000<=0){
                flights.push({...old,state:4,sta:now,delay:0,totalDelay:0,runwayDelay:0,planningDelaySeconds:0,lost:false,issue:'',line0Suppressed:true,
                    scheduledBeforeLanding:old.sta,landingRunway:surface.runway,landingDetection:'simulator-removal'})
                grounded[old.callsign]=now
                continue
            }
        }
        if(old.arrival==='ESSA'&&!present.has(old.callsign)&&old.state===4&&now-old.sta<300000&&old.mode==='sequenced'&&
            (!edit.mode||edit.mode==='sequenced')&&(edit.recomputeAt||0)<=old.recomputedAt&&!(edit.requeueAt&&edit.requeueAt>=old.sta))
            {flights.push({...old,lost:false,issue:''});grounded[old.callsign]=old.sta}
    }
    // Each telemetry packet is the complete current inventory. Aircraft absent
    // from it are removed immediately rather than retained as grey history.
    for (const runway of [...new Set([...currentConfig.active,...(config.pending?.active || []),...flights.filter(f=>f.secondaryRunwayAccepted||f.runwayTransition?.pending).map(f=>`${f.arrival}/${f.runway}`)])]) {
        const queue = flights.filter(f => !f.lost && !f.issue && f.mode === 'sequenced' && f.state !== 4 &&
            (edits[f.callsign]?.runway || `${f.arrival}/${f.runway}`) === runway)
        const fixed = queue.filter(f => (f.state >= 1 || f.runwayTransition || edits[f.callsign]?.order!==undefined || oldByCallsign.get(f.callsign)?.mode==='sequenced'&&(oldByCallsign.get(f.callsign)?.state??0)>=1) && f.order !== Number.MAX_SAFE_INTEGER).sort((a, b) => a.order - b.order)
        // Some aircraft confirm before their peers. Preserve the cohort's
        // relative order even if a partial queue has already renumbered them.
        const cohorts=new Map<string,number[]>()
        fixed.forEach((f,i)=>{const t=f.runwayTransition;if(t&&!freshEdit(f.callsign)){const key=`${t.from}:${t.to}`;cohorts.set(key,[...cohorts.get(key)??[],i])}})
        for(const indices of cohorts.values()){
            const members=indices.map(i=>fixed[i]).sort((a,b)=>a.runwayTransition!.order-b.runwayTransition!.order)
            indices.forEach((index,i)=>{fixed[index]=members[i]})
        }
        const moving = sequenceCandidates(queue.filter(f => !fixed.includes(f)))
        for (const f of moving) {
            // Ordinary newly captured flights cannot displace an established superstable/frozen group.
            let index = fixed.findIndex(p => (edits[p.callsign]?.target??p.eta) > f.eta)
            if (index < 0) index = fixed.length
            if(f.distanceProfile&&!f.passedFeeder){
                const preceding=fixed.reduce((boundary,p,i)=>p.ff===f.ff&&!p.passedFeeder&&edits[p.callsign]?.requeueAt===undefined&&p.etaFf<=f.etaFf?i+1:boundary,0)
                index=Math.max(index,preceding)
            }
            const old=oldByCallsign.get(f.callsign)
            const explicit=old?.mode==='sequenced' && (edits[f.callsign]?.recomputeAt||0)>(old?.recomputedAt||0)
            const missed=old?.mode==='missed'
            if(old?.state===0 && !explicit && old.mode==='sequenced'){
                // A known unstable prediction may move among unstable peers,
                // but cannot reshuffle an already committed Stable sequence.
                const preceding=fixed.reduce((boundary,p,i)=>p.state>=1&&(oldByCallsign.get(p.callsign)?.order??Infinity)<old.order?i+1:boundary,0)
                const following=fixed.findIndex(p=>p.state>=1&&(oldByCallsign.get(p.callsign)?.order??-1)>old.order)
                index=Math.max(preceding,Math.min(index,following<0?fixed.length:following))
            }
            const protectedEnd = fixed.reduce((last, p, i) => p.state >= (missed?3:2) ? i + 1 : last, 0)
            if ((!old||old.state===0||old.mode!=='sequenced')&&!explicit) index = Math.max(index, protectedEnd)
            fixed.splice(index, 0, f)
        }
        for(const f of fixed){
            const old=oldByCallsign.get(f.callsign)
            const reset=!old||!!f.euroscopeBaseline&&f.euroscopeBaseline.at!==old.euroscopeBaseline?.at||old.runway!==f.runway||old.mode!=='sequenced'||!f.runwayTransition?.pending&&(edits[f.callsign]?.recomputeAt||0)>old.recomputedAt||!!f.trajectory&&old.trajectory?.model!==f.trajectory.model
            f.planningEta=reset?f.eta:old.planningEta??old.eta
            if(!reset&&Math.abs(f.eta-f.planningEta)>30000){
                const candidate=old.planningEtaCandidate
                const sameTrend=candidate&&Math.sign(candidate.eta-f.planningEta)===Math.sign(f.eta-f.planningEta)&&Math.abs(candidate.eta-f.eta)<=30000
                // Compare successive estimates, not every update with the
                // first sample. A steady correction must not restart its
                // timer forever merely because it totals more than 30 sec.
                f.planningEtaCandidate={eta:f.eta,since:sameTrend?candidate.since:now}
                if(now-f.planningEtaCandidate.since>=15000){f.planningEta=f.eta;f.planningEtaCandidate=undefined}
            }else f.planningEtaCandidate=undefined
        }
        const freshOrderEdit=fixed.some(f=>edits[f.callsign]?.order!==undefined&&freshEdit(f.callsign))
        const committed=fixed.filter(f=>f.state>=2&&(oldByCallsign.get(f.callsign)?.state??0)>=2&&oldByCallsign.get(f.callsign)?.mode==='sequenced')
        const accepted=(f:EngineFlight)=>edits[f.callsign]?.target??(f.passedFeeder&&oldByCallsign.get(f.callsign)?.mode==='sequenced'&&(edits[f.callsign]?.recomputeAt??0)<=oldByCallsign.get(f.callsign)!.recomputedAt?oldByCallsign.get(f.callsign)?.tmaAssignment?.sta??oldByCallsign.get(f.callsign)?.sta:undefined)??(f.state<3?f.planningEta:undefined)??oldByCallsign.get(f.callsign)?.committedSta??oldByCallsign.get(f.callsign)?.tmaTiming?.referenceSta??
            (oldByCallsign.get(f.callsign)?oldByCallsign.get(f.callsign)!.sta-(oldByCallsign.get(f.callsign)!.closureDelayMs||0)-(oldByCallsign.get(f.callsign)!.rateDelayMs||0)-(oldByCallsign.get(f.callsign)!.wakeDelayMs||0):f.eta)
        if(committed.length&&!freshOrderEdit){
            const provisional=fixed.filter(f=>!committed.includes(f))
            const legacyOrder=committed.some(f=>!oldByCallsign.get(f.callsign)?.editTracking)
            const merged=[...committed].sort((a,b)=>legacyOrder?accepted(a)-accepted(b)||a.order-b.order:a.order-b.order)
            let preceding:EngineFlight|undefined,precedingTime=-Infinity
            for(const f of provisional){
                const old=oldByCallsign.get(f.callsign)
                if(old?.mode==='sequenced'&&old.state===1&&f.state===1&&(edits[f.callsign]?.recomputeAt??0)<=old.recomputedAt){
                    // An established Stable arrival keeps its place between
                    // automatic Superstable peers; their old absolute slots
                    // must not force it to the back of the sequence.
                    const index=merged.findIndex(p=>p.order>f.order)
                    merged.splice(index<0?merged.length:index,0,f)
                    preceding=f;precedingTime=Math.max(f.planningEta!,f.minimumArrival)
                    continue
                }
                const candidate=edits[f.callsign]?.target??Math.max(f.planningEta!,f.minimumArrival)
                const rate=windConfig(effectiveConfig(config,candidate),f.arrival,winds,now)
                const newcomerFloor=!old?Math.max(...committed.map(p=>accepted(p)+ms(Math.max(rate.rates[runway],wakeInterval(p.wake,f.wake,runway,rate))))):-Infinity
                const earliest=Math.max(candidate,newcomerFloor,preceding?precedingTime+ms(Math.max(rate.rates[runway],wakeInterval(preceding.wake,f.wake,runway,rate))):-Infinity)
                let start=earliest,index=merged.length
                for(let j=0;j<merged.length;j++){
                    const prior=merged[j-1],next=merged[j]
                    const priorTime=prior===preceding?precedingTime:prior?accepted(prior):-Infinity
                    start=Math.max(earliest,prior?priorTime+ms(Math.max(rate.rates[runway],wakeInterval(prior.wake,f.wake,runway,rate))):-Infinity)
                    start=afterSlots(start,runway,config)
                    if(start+ms(Math.max(rate.rates[runway],wakeInterval(f.wake,next.wake,runway,rate)))<=accepted(next)){index=j;break;}
                }
                if(index===merged.length&&merged.length){const prior=merged.at(-1)!;start=Math.max(earliest,accepted(prior)+ms(Math.max(rate.rates[runway],wakeInterval(prior.wake,f.wake,runway,rate))))}
                merged.splice(index,0,f);preceding=f;precedingTime=start
            }
            fixed.splice(0,fixed.length,...merged)
        }
        // Automatic forecast order is not a controller commitment. Reconcile
        // only a material, sustained inversion; retain explicit slots, gaps
        // and same-entry upstream order. A transient ETA never swaps a pair.
        const automatic=(f:EngineFlight)=>f.state===0&&!!f.trajectory&&!f.passedFeeder&&!oldByCallsign.get(f.callsign)?.passedFeeder&&edits[f.callsign]?.target===undefined&&edits[f.callsign]?.order===undefined&&
            !f.slotBefore&&!f.slotAfter&&!f.closurePosition&&!f.missedRecovery
        const corrected=new Set<string>()
        for(let i=1;i<fixed.length;i++){
            const follower=fixed[i]
            if(!automatic(follower))continue
            let destination=i,allFinal=true
            for(let j=i-1;j>=0;j--){
                const leader=fixed[j]
                const upstream=follower.ff===leader.ff&&(!follower.passedFeeder||!leader.passedFeeder)
                const observedFinal=follower.finalAlongNm!==undefined&&leader.finalAlongNm!==undefined&&follower.finalAlongNm<leader.finalAlongNm
                const inversion=upstream ? follower.passedFeeder&&!leader.passedFeeder || !leader.passedFeeder&&!follower.passedFeeder&&leader.etaFf-follower.etaFf>60000 :
                    (leader.planningEta!-follower.planningEta!)>(observedFinal?30000:60000)
                if(!automatic(leader)||!inversion)break
                destination=j;allFinal=allFinal&&observedFinal
            }
            if(destination===i)continue
            const leader=fixed[destination]
            const candidate=oldByCallsign.get(follower.callsign)?.sequenceCorrectionCandidate
            follower.sequenceCorrectionCandidate=candidate?.leader===leader.callsign?candidate:{leader:leader.callsign,since:now}
            if(now-follower.sequenceCorrectionCandidate.since<(allFinal?15000:45000))continue
            // Reinsert once across the confirmed automatic block instead of
            // imposing another full timer for every individual queue place.
            for(const crossed of fixed.slice(destination,i+1))corrected.add(crossed.callsign)
            fixed.splice(i,1);fixed.splice(destination,0,follower)
            follower.sequenceCorrectionCandidate=undefined
        }
        fixed.splice(0,fixed.length,...preserveEnteredOrder(fixed,oldByCallsign,edits,freshEdit))
        // Unentered forecasts can lose a provisional slot; they must not
        // push an accepted TMA time back when their own ETA gets later.
        let projected:{flight:EngineFlight;time:number}|undefined
        const projectedFeeders=new Map<string,number>()
        for(let i=0;i<fixed.length;i++){
            const f=fixed[i],e=edits[f.callsign]??{}
            const rate=windConfig(effectiveConfig(config,f.eta),f.arrival,winds,now)
            const gap=ms(Math.max(rate.rates[runway],projected?wakeInterval(projected.flight.wake,f.wake,runway,rate):0))+ms(((projected?.flight.slotAfter??0)+f.slotBefore)*60)
            const transfer=Math.max(0,f.euroscopeBaseline?f.euroscopeBaseline.eta-f.euroscopeBaseline.etaFf:f.eta-f.etaFf),feederLeader=f.distanceProfile&&!f.passedFeeder?projectedFeeders.get(f.ff):undefined
            const feederFloor=feederLeader===undefined?-Infinity:feederLeader+ms(rate.rates[runway])+ms((f.slotBefore+(projected?.flight.slotAfter??0))*60)+transfer
            const start=afterSlots(Math.max(e.target??Math.max(f.planningEta??f.eta,f.eta),f.passedFeeder?-Infinity:f.minimumArrival,projected?projected.time+gap:-Infinity,feederFloor),runway,config)
            if(!f.passedFeeder&&e.order===undefined&&e.target===undefined&&!f.slotBefore&&!f.slotAfter&&!e.closurePosition&&!f.missedRecovery){
                const nextIndex=fixed.findIndex((p,j)=>j>i&&p.passedFeeder&&oldByCallsign.get(p.callsign)?.mode==='sequenced'&&(oldByCallsign.get(p.callsign)?.state??0)>=1)
                if(nextIndex>=0){
                    const next=fixed[nextIndex],followingGap=ms(Math.max(rate.rates[runway],wakeInterval(f.wake,next.wake,runway,rate)))+ms((f.slotAfter+next.slotBefore)*60)
                    if(start+followingGap>afterSlots(accepted(next),runway,config)){
                        fixed.splice(i,1);fixed.splice(nextIndex,0,f);i--;continue
                    }
                }
            }
            projected={flight:f,time:f.passedFeeder?Math.max(accepted(f),projected?projected.time+gap:-Infinity):start}
            if(f.distanceProfile&&!f.passedFeeder)projectedFeeders.set(f.ff,projected.time-transfer)
        }
        let last: EngineFlight | undefined
        const feederLeaders=new Map<string,EngineFlight>()
        for (let i = 0; i < fixed.length; i++) {
            const f = fixed[i]
            const old = oldByCallsign.get(f.callsign)
            const recomputed=!!old && !f.runwayTransition?.pending && ((edits[f.callsign]?.recomputeAt || 0)>old.recomputedAt||!!f.euroscopeBaseline&&f.euroscopeBaseline.at!==old.euroscopeBaseline?.at)
            const arrivalConfig = windConfig(effectiveConfig(config, Math.max(edits[f.callsign]?.target ?? old?.sta ?? f.eta,f.minimumArrival)),f.arrival,winds,now)
            const planKey=JSON.stringify([runway,arrivalConfig.rates[runway],config.slots,f.slotBefore,f.slotAfter])
            const planChanged=!!old && old.planKey!==planKey
            const preserveTarget = !recomputed && f.state >= 1 && old && old.state>=1 && old.sta > now &&
                (edits[f.callsign]?.recomputeAt || 0) <= old.recomputedAt && old.order === f.order && !planChanged
            const reference = edits[f.callsign]?.target ?? (preserveTarget ? Math.min(f.eta, old.sta) : f.eta)
            const closurePosition=edits[f.callsign]?.closurePosition
            const selectedClosure=config.slots.find(s=>s.id===closurePosition?.id&&s.runway===runway)
            const closureMoved=!!old&&JSON.stringify(edits[f.callsign]?.closurePosition)!==JSON.stringify(old.closurePosition)
            const explicitlyReordered=!!old && freshEdit(f.callsign) && ((edits[f.callsign]?.order!==undefined&&edits[f.callsign]?.order!==old.order)||(closureMoved&&(edits[f.callsign]?.changedAt||0)>previous!.timestamp-1))
            const finalReordered=!!old && f.state===3 && old.order!==i && f.finalAlongNm!==undefined
            const predecessorChanged=!!old && previous?.flights.find(p=>p.mode==='sequenced'&&p.order===old.order-1&&(edits[p.callsign]?.runway||`${p.arrival}/${p.runway}`)===runway)?.callsign!==last?.callsign
            const oldPlan=old?.planKey?JSON.parse(old.planKey):undefined
            const nonClosurePlanChanged=!!oldPlan && (oldPlan[0]!==runway || oldPlan[1]!==arrivalConfig.rates[runway] || oldPlan[3]!==f.slotBefore || oldPlan[4]!==f.slotAfter)
            const protectedBase=old && old.state>=1 && f.state>=1 && !recomputed && (!nonClosurePlanChanged || f.passedFeeder)
            const tmaProtected=(f.passedFeeder||f.state>=2) && !!old && old.state>=1 && !recomputed && old.mode==='sequenced'
            const currentAutomaticRate=!!f.trajectory&&edits[f.callsign]?.target===undefined&&!f.missedRecovery
            const acceptedRate=f.passedFeeder && tmaProtected && !explicitlyReordered&&!currentAutomaticRate ? old.tmaTiming?.rateSeconds??oldPlan?.[1]??arrivalConfig.rates[runway] : arrivalConfig.rates[runway]
            const gap=ms(Math.max(acceptedRate,last?wakeInterval(last.wake,f.wake,runway,arrivalConfig):0))+ms(((last?.slotAfter||0)+f.slotBefore)*60)
            // Recover spacing by advancing only the first, unprotected arrival.
            // It must have a model-supported margin and no closure to cross.
            if(i===1&&last&&last.spacingActive&&last.state<=1&&!last.passedFeeder&&!last.missedRecovery&&
                edits[last.callsign]?.target===undefined&&!last.slotBefore&&!last.slotAfter&&!last.closureDelayMs&&last.delay===0&&
                !config.slots.some(s=>s.runway===runway&&s.end>now&&s.begin<last!.sta)){
                const needed=Math.max(0,last.sta+gap-f.eta)
                const capacity=Math.min(ms(last.gainCapacitySeconds??0),last.sta-Math.max(now,last.minimumArrival))
                const advance=Math.floor(Math.min(needed,capacity)/1000)*1000
                if(advance>=30000){
                    last.sta-=advance;last.staFf-=advance;last.automaticGainSeconds=advance/1000
                    last.delay=Math.round((last.sta-last.eta)/1000);last.runwayDelay=last.delay;last.planningDelaySeconds=last.delay;last.totalDelay=Math.round((last.staFf-last.etaFf)/1000)
                    if(last.distanceProfile&&!last.passedFeeder)feederLeaders.set(last.ff,last)
                }
            }
            const beforeClosure=old ? (old.automaticGainSeconds&&f.state<=1&&!f.passedFeeder?f.eta:old.sta)-(old.closureDelayMs||0)-(tmaProtected ? (old.wakeDelayMs||0)+(old.rateDelayMs||0) : 0) : f.eta
            const oldLeader=previous?.flights.find(p=>p.mode==='sequenced'&&p.order===(old?.order??0)-1&&`${p.arrival}/${p.runway}`===runway)
            const leaderReplanned=!!last&&oldLeader?.callsign===last.callsign&&last.tmaAssignment?.at===now&&Math.abs(last.sta-oldLeader.sta)>1000
            const inconsistentHistory=!!old?.guidance&&Math.abs(old.guidance.scheduled-(old.passedFeeder?old.sta:old.staFf))>1000
            const targetRemoved=retiredTargets.has(f.callsign)||old?.appliedTarget!==undefined&&edits[f.callsign]?.target===undefined
            const holdTma=f.state>=1&&!!old&&old.mode==='sequenced'&&old.state>=1&&old.runway===f.runway&&!f.missedRecovery&&!old.missedRecovery&&!recomputed&&!explicitlyReordered&&!planChanged&&!closureMoved&&!leaderReplanned&&!targetRemoved&&!inconsistentHistory
            const protectedFollower=!!old&&old.state>=1&&f.state===1&&fixed.slice(i+1).some(p=>p.state>=2&&(oldByCallsign.get(p.callsign)?.state??0)>=2)&&!recomputed&&!planChanged&&!explicitlyReordered&&(edits[fixed[i+1].callsign]?.changedAt||0)<(previous?.timestamp??0)
            let anchor=edits[f.callsign]?.target ?? (tmaProtected&&!explicitlyReordered||protectedBase?beforeClosure:reference)
            const modelTiming=['star-distance','vector-profile','final-position'].includes(f.predictionSource??'')
            // A frozen automatic slot carries spacing constraints, not the
            // old delay as an independent demand. Keep manual targets fixed;
            // update the automatic baseline using the filtered trajectory.
            const repairFrozen=f.state===3&&!!f.trajectory&&edits[f.callsign]?.target===undefined&&!f.missedRecovery
            const automaticTiming=!holdTma&&f.state>=1&&(f.state<3||repairFrozen)&&(f.state>=2||modelTiming)&&!f.missedRecovery&&edits[f.callsign]?.target===undefined&&!selectedClosure&&
                (old?.tmaTiming?.instructionSource!=='manual'||edits[f.callsign]?.targetKind==='sequence')
            if(automaticTiming)anchor=f.state>=2?f.planningEta!:f.eta
            if((explicitlyReordered||finalReordered||(predecessorChanged&&f.state===0))&&edits[f.callsign]?.target===undefined)anchor=automaticTiming?f.planningEta!:f.eta
            if(['star-distance','vector-profile','final-position'].includes(f.predictionSource??'')&&f.state===1&&edits[f.callsign]?.target===undefined&&!protectedFollower)anchor=f.eta
            if(holdTma)anchor=edits[f.callsign]?.target??old.tmaAssignment?.sta??old.sta
            if(selectedClosure&&closurePosition?.side==='before')anchor=Math.min(anchor,selectedClosure.begin-1)
            const rateGap=ms(acceptedRate)+ms(((last?.slotAfter||0)+f.slotBefore)*60)
            const transfer = Math.max(0,holdTma&&old&&!f.passedFeeder?old.sta-old.staFf:f.euroscopeBaseline?f.euroscopeBaseline.eta-f.euroscopeBaseline.etaFf:f.eta-f.etaFf)
            const feederLeader=f.distanceProfile&&!f.passedFeeder?feederLeaders.get(f.ff):undefined
            const feederMinimum=feederLeader?feederLeader.staFf+rateGap+transfer:-Infinity
            const minimumForPlan=holdTma&&f.minimumArrivalSource!=='resume'?f.runwayAvailableFrom??-Infinity:f.minimumArrival
            const unconstrainedBase=Math.max(anchor,minimumForPlan,last?last.sta-(last.closureDelayMs||0)-(tmaProtected?last.wakeDelayMs||0:0)+(tmaProtected?rateGap:gap):-Infinity)
            const baseSta=Math.max(unconstrainedBase,feederMinimum)
            f.feederDelayMs=Math.max(0,feederMinimum-unconstrainedBase)
            const wakeSta=Math.max(baseSta,last?last.sta-(last.closureDelayMs||0)+gap:-Infinity)
            f.wakeDelayMs=tmaProtected?wakeSta-baseSta:0
            f.rateDelayMs=tmaProtected?Math.max(0,baseSta-Math.max(anchor,f.minimumArrival)):0
            f.sta=afterSlots(Math.max(wakeSta,last?last.sta+gap:-Infinity,selectedClosure&&closurePosition?.side==='after'?selectedClosure.end:-Infinity),runway,config)
            f.closurePosition=selectedClosure?closurePosition:undefined
            f.closureDelayMs=f.sta-wakeSta
            f.spacingConflict=!!last && f.sta<last.sta+gap-1
            f.staFf = f.passedFeeder ? old?.staFf ?? f.etaFf : f.distanceProfile ? f.sta-transfer : old && old.state>=1 && f.state>=1 && !recomputed && !nonClosurePlanChanged ? old.staFf+(f.sta-old.sta) : f.sta - transfer
            if(holdTma&&old&&!f.passedFeeder)f.staFf=old.staFf+(f.sta-old.sta)+(!old.euroscopeBaseline?.feederBuffered&&f.euroscopeBaseline?.feederBuffered?ms((f.euroscopeBaseline.feederBufferMinutes??f.euroscopeBaseline.bufferMinutes)*60):0)
            if(f.distanceProfile&&!f.passedFeeder)feederLeaders.set(f.ff,f)
            if(old?.automaticGainSeconds&&f.sta<f.eta&&f.state<=1&&!f.passedFeeder)f.automaticGainSeconds=(f.eta-f.sta)/1000
            f.runwayDelay = Math.round((f.sta - f.eta) / 1000)
            // A controller's protected sequence change carries existing work
            // into the new slot. Only subsequent prediction/spacing changes
            // become additional gain/loss, rather than the slot exchange itself.
            f.reorderTiming = !recomputed && old?.runway===f.runway ? old.reorderTiming : undefined
            if(f.state>=2 && old && explicitlyReordered && edits[f.callsign]?.target!==undefined)
                f.reorderTiming={eta:f.eta,scheduled:edits[f.callsign].target!,delay:old.delay}
            f.delay = f.reorderTiming ? Math.round(f.reorderTiming.delay + (f.sta-f.reorderTiming.scheduled-f.eta+f.reorderTiming.eta)/1000) : f.runwayDelay
            // Once the feeder has been crossed, route/vector ETA updates are
            // observation only. Preserve the accepted instruction through a
            // sequence edit; publish only closure and extra wake constraints.
            if(tmaProtected){
                const priorBase=old.delay-Math.round(((old.closureDelayMs||0)+(old.wakeDelayMs||0)+(old.rateDelayMs||0))/1000)
                const manual=edits[f.callsign]?.target!==undefined
                const binding=old.minimumArrival>old.eta||!!old.feederDelayMs||!!old.separation&&old.separation.scheduledSeconds<=Math.max(old.separation.rateSeconds,old.separation.wakeSeconds)+1
                let source=old.tmaTiming?.instructionSource??(priorBase>0&&binding&&explicitlyReordered?'constraint':manual?'manual':priorBase>0&&binding?'constraint':'none')
                let baseline=old.tmaTiming?.instructionSource?old.tmaTiming.delay:manual?priorBase:priorBase>0&&binding?priorBase:0
                // An earlier TMA slot can satisfy an existing lose instruction.
                // Moving later within committed slots does not invent new work;
                // actual closure/wake/rate constraints are calculated separately.
                let slotInstruction=false
                if(explicitlyReordered&&edits[f.callsign]?.target!==undefined&&!selectedClosure&&(source!=='manual'||baseline===0)){
                    const slot=previous?.flights.find(p=>p.mode==='sequenced'&&p.state>=2&&p.order===i&&`${p.arrival}/${p.runway}`===runway)
                    if(slot){
                        const work=slot.delay-Math.round((slot.closureDelayMs||0)/1000)
                        const bindingSlot=slot.minimumArrival>slot.eta||!!slot.feederDelayMs||!!slot.separation&&slot.separation.scheduledSeconds<=Math.max(slot.separation.rateSeconds,slot.separation.wakeSeconds)+1
                        const storedSource=slot.tmaTiming?.instructionSource??(work>0&&bindingSlot?'constraint':'none')
                        const slotSource=storedSource==='none'&&((slot.rateDelayMs||0)+(slot.wakeDelayMs||0)>0)?'constraint':storedSource
                        if(slotSource==='constraint'||source==='constraint'||(old.rateDelayMs||0)+(old.wakeDelayMs||0)>0){
                            baseline=slotSource==='constraint'?Math.max(0,work):0
                            source=baseline>0?'constraint':'none';slotInstruction=true
                        }
                    }
                }
                const referenceSta=old.tmaTiming?.referenceSta??beforeClosure
                const referenceDelay=old.tmaTiming?.referenceDelay??baseline
                if(!slotInstruction&&f.passedFeeder&&explicitlyReordered&&edits[f.callsign]?.target!==undefined&&!selectedClosure&&referenceDelay>0)
                    baseline=Math.max(0,referenceDelay+Math.min(0,Math.round((edits[f.callsign].target!-referenceSta)/1000)))
                const referenceSource=old.tmaTiming?.referenceSource??source
                f.tmaTiming={delay:baseline,rateSeconds:acceptedRate,instructionSource:baseline===0?'none':source==='none'?referenceSource:source,referenceSta,referenceDelay,referenceSource}
                f.delay=f.tmaTiming.delay+Math.round(((f.closureDelayMs||0)+(f.wakeDelayMs||0)+(f.rateDelayMs||0))/1000)
                if(old.tmaTiming&&Math.abs(f.sta-old.sta)<1000&&!planChanged&&!explicitlyReordered&&!predecessorChanged&&(!last||(edits[last.callsign]?.changedAt||0)<previous!.timestamp))f.delay=old.delay
            }
            if(automaticTiming&&f.state>=2&&!recomputed){
                // Recompute automatic work from today's constraints. Never
                // recycle a previous constraint as a new independent anchor.
                f.delay=Math.max(0,Math.round((f.sta-f.planningEta!)/1000))
                const independentWork=Math.max(0,f.delay-Math.round(((f.closureDelayMs||0)+(f.rateDelayMs||0)+(f.wakeDelayMs||0))/1000))
                f.tmaTiming={delay:independentWork,rateSeconds:acceptedRate,instructionSource:f.delay>0?'constraint':'none',referenceSta:f.sta,referenceDelay:f.delay,referenceSource:f.delay>0?'constraint':'none'}
                f.reorderTiming=undefined
            }
            if(f.trajectory&&f.state===2&&edits[f.callsign]?.target!==undefined){
                // A live trajectory makes the remaining work observable.
                // Preserve the manual slot, not an instruction already flown.
                f.delay=Math.round((f.sta-f.planningEta!)/1000)
            }
            if(f.trajectory&&f.state===3&&!f.missedRecovery){
                // Frozen holds the target. Current spacing work is not added
                // a second time to the instruction inherited at promotion.
                const remainingWork=Math.round((f.sta-f.planningEta!)/1000)
                f.delay=edits[f.callsign]?.target!==undefined?remainingWork:Math.max(0,remainingWork)
            }
            if(holdTma&&edits[f.callsign]?.target===undefined){
                const assigned=old.tmaAssignment?.sta??old.sta
                const remaining=Math.max(0,Math.round((assigned-(f.planningEta??f.eta))/1000))
                const extra=Math.max(0,Math.round((f.sta-assigned)/1000))
                // Observations can show absorbed work; they do not issue a
                // new TMA delay or silently move the controller's target.
                f.delay=Math.min(Math.max(0,old.delay),remaining)+extra
                f.reorderTiming=undefined
            }
            const unsupportedGain=!!f.trajectory&&f.delay<0&&-f.delay>(f.gainCapacitySeconds??0)
            if(unsupportedGain&&edits[f.callsign]?.target===undefined)f.delay=0
            // EuroScope route EET is minute-resolution. A sub-minute first-slot
            // difference without a constraint is uncertainty, not a holding instruction.
            if(!tmaProtected && !last && !f.closureDelayMs && pMinuteResolution(f) && Math.abs(f.delay)<60 && edits[f.callsign]?.target===undefined &&
                f.minimumArrival<=f.eta && !f.slotBefore && !config.slots.some(s=>s.runway===runway&&s.end>f.eta&&s.begin<=f.sta)) f.delay=0
            // A held Stable estimate is not a controller-issued lose
            // instruction when no current constraint requires the difference.
            if(!tmaProtected&&f.state>=1&&f.delay>0&&edits[f.callsign]?.target===undefined&&!f.closureDelayMs&&!f.feederDelayMs&&!f.slotBefore&&
                f.minimumArrival<=f.eta&&(!last||last.sta+gap<=f.eta))f.delay=0
            if(f.missedRecovery)f.delay=Math.round(((f.closureDelayMs||0)+(f.wakeDelayMs||0)+(f.rateDelayMs||0))/1000)
            const refresh=(edits[f.callsign]?.refreshDelayAt??0)>(old?.refreshedDelayAt??0)
            if(refresh)f.delay=Math.round(((f.passedFeeder?f.sta:f.staFf)-(f.passedFeeder?f.liveBufferedEta??f.eta:f.etaFf))/1000)
            else if(holdTma&&old&&f.state>=2&&old.state>=1)f.delay=old.delay+Math.max(0,Math.round((f.sta-old.sta)/1000))
            const manualTimeChanged=!!f.euroscopeBaseline&&!!old&&edits[f.callsign]?.target!==undefined&&edits[f.callsign]?.targetKind!=='sequence'&&freshEdit(f.callsign)&&(old.appliedTarget!==edits[f.callsign]?.target||old.appliedChangedAt!==edits[f.callsign]?.changedAt)
            if(manualTimeChanged)f.delay=Math.round(((f.passedFeeder?f.sta:f.staFf)-(f.passedFeeder?f.liveBufferedEta??f.eta:f.etaFf))/1000)
            f.refreshedDelayAt=edits[f.callsign]?.refreshDelayAt??old?.refreshedDelayAt??0
            // Older histories did not store initial allocations. Leave them
            // unavailable rather than relabelling the current slot as initial.
            f.initialSta=old?.initialSta??(!old||old.issue?f.sta:undefined);f.initialStaFf=old?.initialStaFf??(!old||old.issue?f.staFf:undefined)
            f.originalAssignedSta=recomputed||old?.runway!==f.runway?f.sta:old?.originalAssignedSta??old?.sta??f.sta
            if(!f.passedFeeder&&f.state<=1){const feederWork=Math.round((f.staFf-f.etaFf)/1000);f.delay=feederWork}
            f.maximumDelayExceeded=edits[f.callsign]?.maximumDelayMinutes!==undefined&&f.delay>edits[f.callsign].maximumDelayMinutes!*60
            f.planningDelaySeconds=f.delay
            if(!f.spacingActive&&edits[f.callsign]?.target===undefined)f.delay=0
            f.separation=last?{leader:last.callsign,wakeNm:wakeDistanceNm(last.wake,f.wake),wakeSeconds:wakeInterval(last.wake,f.wake,runway,arrivalConfig),rateSeconds:acceptedRate,scheduledSeconds:(f.sta-last.sta)/1000}:undefined
            const constraints:string[]=[]
            if(edits[f.callsign]?.order!==undefined)constraints.push('controller sequence order')
            if(holdTma)constraints.push('accepted TMA assignment; Recompute refreshes time')
            if(corrected.has(f.callsign))constraints.push('automatic order reconciled after sustained trajectory inversion')
            if(unsupportedGain)constraints.push('requested gain exceeds current capability estimate; controller review required')
            if(edits[f.callsign]?.target!==undefined)constraints.push('manual time / slot')
            if((f.runwayAvailableFrom??0)>f.eta)constraints.push('planned runway availability')
            else if(f.minimumArrival>f.eta)constraints.push('new / resumed flight minimum')
            if(f.slotBefore||last?.slotAfter)constraints.push('controller inserted interval')
            if(f.feederDelayMs)constraints.push('entry flow spacing')
            if(f.closureDelayMs)constraints.push('runway closure')
            if(last&&f.sta>=last.sta+gap-1&&Math.abs(f.sta-last.sta-gap)<1000)constraints.push(gap>rateGap?'wake separation':'runway arrival rate')
            if(f.automaticGainSeconds)constraints.push('feasible gain to relieve following aircraft')
            const guidanceReference=f.state>=2&&f.trajectory?f.planningEta!:f.eta
            if(f.state===3&&f.sta<guidanceReference-30000)constraints.push('frozen target earlier than current prediction; controller review required')
            f.guidance={point:f.passedFeeder?'runway threshold':f.ff,predicted:f.passedFeeder?f.liveBufferedEta??f.eta:f.etaFf,scheduled:f.passedFeeder?f.sta:f.staFf,reference:holdTma&&edits[f.callsign]?.target===undefined?(f.passedFeeder?f.sta:f.staFf)-ms(f.delay):f.passedFeeder?guidanceReference:guidanceReference-(f.eta-f.etaFf),instructionSeconds:f.delay,policy:holdTma?'accepted allocation; live prediction observational':f.state>=2&&f.trajectory?'filtered trajectory reference':tmaProtected?'accepted instruction policy':'current trajectory',constraints,earliestPlanningTime:f.eta-ms(f.gainCapacitySeconds??0),validUntil:now+15000,absorption:f.delay<0?{mode:'gain'}:f.delay===0?{mode:'none'}:f.delay<=150?{mode:'speed-or-vectors',maxIas:250}:{mode:'holding',maxIas:230}}
            f.totalDelay = Math.round((f.staFf - f.etaFf) / 1000)
            f.order = i
            f.planKey=planKey
            if(f.state===3&&f.sta-now>ms((config.frozenMinutes+(old?.state===3?1:0))*60))f.state=2
            if(f.passedFeeder)f.tmaAssignment=holdTma&&old.tmaAssignment&&Math.abs(f.sta-old.tmaAssignment.sta)<1?old.tmaAssignment:{at:now,sta:f.sta,instruction:f.delay}
            else f.tmaAssignment=undefined
            if(f.state>=2)f.committedSta=!automaticTiming&&old?.committedSta!==undefined&&!planChanged&&!explicitlyReordered&&!recomputed?old.committedSta:f.sta
            last = f
        }
    }
    const landings=(previous?.landings||[]).filter(l=>l.runway.startsWith('ESSA/')&&now-l.time<=1800000)
    for(const f of flights)if(f.state===4&&oldByCallsign.get(f.callsign)?.state!==4 && !landings.some(l=>l.callsign===f.callsign&&(now-l.time<600000||l.time===Math.min(now,f.sta))))
        landings.push({callsign:f.callsign,runway:f.landingRunway??edits[f.callsign]?.runway??`${f.arrival}/${f.runway}`,time:Math.min(now,f.sta)})
    const wind=windConfig(currentConfig,'ESSA',winds,now)
    const visibleFlights=flights.filter(f=>f.state!==4||now-f.sta<300000),visibleCalls=new Set(visibleFlights.map(f=>f.callsign))
    // Expose the latest valid estimate only after allocation. STA, STA-FF,
    // captured history and accepted instructions retain their scheduling anchors.
    if(config.timingModel==='euroscope-buffer'&&input.source!=='DEMO')for(const f of visibleFlights)
        if(f.euroscopeBaseline&&!manualCalls.has(f.callsign)){
            f.eta=f.state!==4&&f.liveBufferedEta!==undefined?f.liveBufferedEta:previousEtas.get(f.callsign)??f.eta
            if(f.state!==4)f.runwayDelay=Math.round((f.sta-f.eta)/1000)
        }
    const unlisted=input.flights.filter(f=>!visibleCalls.has(f.callsign))
    return { timestamp: now, source: input.source,simulation:input.simulation, flights:visibleFlights,terminatedCallsigns:input.terminatedCallsigns,knownFlights:input.knownFlights, diagnostics, slotsKey, winds,grounded,observedCallsigns:input.flights.map(f=>f.callsign),runways:input.runways,activeRunways:input.activeRunways,unlistedTelemetry:unlisted.length?unlisted:undefined,
        wind:{direction:wind.surfaceWindDirection,speed:wind.surfaceWindSpeed,auto:config.surfaceWindAuto!==false},landings }
}

function pMinuteResolution(f:EngineFlight){return f.predictionSource==='route' && f.landingSeconds%60===0 && f.route.every(r=>r.seconds%60===0)}
export function euroscopeInstruction(f:EngineFlight){return f.line0Suppressed||f.state===4?0:f.delay}
export function delayLabel(seconds: number) {
    const minutes=seconds<0?Math.ceil(Math.abs(seconds)/60):Math.floor(seconds/60)
    return minutes===0?'':`${seconds<0?'-':''}${minutes}`
}
export function toJuhaSequence(snapshot: EngineSnapshot, config: EngineConfig, edits: Record<string, FlightEdit>) {
    config = windConfig(effectiveConfig(config,snapshot.timestamp),'ESSA',snapshot.winds,snapshot.timestamp)
    const sec = (time: number) => Math.round(time / 1000)
    return {
        data: { icao: 'ESSA', source: snapshot.source, timestamp: sec(snapshot.timestamp) },
        wind: { '10k_deg': -1, '10k_kts': -1, sfc_deg: config.surfaceWindDirection, sfc_kts: config.surfaceWindSpeed, sfc_auto: config.surfaceWindAuto!==false },
        airports: ['ESSA'].map(icao => ({ icao, color: '13158600' })),
        runways: RUNWAYS.filter(r=>r.startsWith('ESSA/')).map(r => ({ icao: r.split('/')[0], id: r.split('/')[1], active: config.active.includes(r),
            rate: config.rates[r], color: 13158600, slots: config.slots.filter(s => s.runway === r).map(s => ({ begin: sec(s.begin), end: sec(s.end) })) })),
        feeders: FEEDERS.filter(f=>f.airport==='ESSA').map(f => ({ icao: f.airport, name: f.name, id: f.id, fixes: [...f.fixes], color: 13158600 })),
        sequence: snapshot.flights.filter(f => f.arrival==='ESSA' && f.mode === 'sequenced' && !f.issue && !f.lost).map(f => ({
            callsign: f.callsign, atyp: f.aircraft, wtc: f.wake, adep: f.departure, ades: f.arrival,
            initial_eta: sec(f.initialEta), rwy: (edits[f.callsign]?.runway || `${f.arrival}/${f.runway}`).split('/')[1],
            rwy_seq: f.order, feeder_group: f.feeder, ff: f.ff, sta_ff: sec(f.staFf), ttlttg_ff: euroscopeInstruction(f),
            eet_ff: (f.etaFf - snapshot.timestamp) / 60000, eet_rwy: (f.sta - snapshot.timestamp) / 1000,
            eet_ff_to_rwy: Math.max(0, (f.eta - f.etaFf) / 1000), eet_ades: (f.eta - snapshot.timestamp) / 1000,
            state: f.state, delay_total: f.totalDelay, lost: f.lost, slot_before: f.slotBefore, slot_after: f.slotAfter,
        })),
    }
}

