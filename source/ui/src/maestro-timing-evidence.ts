import type {TelemetryFlight,EngineConfig} from './maestro-engine'
import type {LandingPrediction} from './maestro-landing-prediction'
import phaseData from './data/eurocontrol-phase-profiles.json'
import {APPLICATION_BUILD} from './build'

export const TIMING_EVIDENCE_MAX_BYTES=3072
export interface TimingEvidence {
 schema:'saaman-timing-summary-1';provenance:'capture-summary';at:number;engine:string
 input:Record<string,unknown>;model:Record<string,unknown>;config:Record<string,unknown>;accepted?:{eta:number;etaFf:number;rawEta?:number;rawEtaFf?:number}
 route:{points:unknown[][];totalPoints:number;remainingPoints:number;omittedPoints:number;fingerprint:string}
}
const inputFields=['callsign','aircraft','wake','departure','arrival','runway','landingSeconds','distanceNm','groundspeed','altitude','verticalSpeed','positionAgeSeconds','latitude','longitude','heading','assignedHeading','direct','assignedSpeed','assignedMach','clearedAltitude','finalAltitude','speedDataValid','routeProblem','star','arrivalProfile','calculatedRouteIndex','topskyHoldingPoint','topskyMissedApproach','threshold'] as const
const configFields=['automaticTrafficModes','trafficHighDownwindNm','timingModel','performanceModel','starEntryAltitude','starApproachSpeed','starBaseSpeed','landingSpeedKnots','surfaceWindDirection','surfaceWindSpeed','euroscopeBufferMinutes','euroscopeSuperstableBufferMinutes','euroscopeHighSpeedBufferMinutes'] as const
// A compact non-security fingerprint identifies the full input route without
// copying an enroute flight plan into every shared publication.
function fingerprint(value:unknown){let hash=2166136261;for(const c of JSON.stringify(value))hash=Math.imul(hash^c.charCodeAt(0),16777619);return `fnv1a32:${(hash>>>0).toString(16).padStart(8,'0')}`}
const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).length
export function timingEvidence(p:TelemetryFlight,config:EngineConfig,prediction:LandingPrediction,at:number,accepted?:{eta:number;etaFf:number;rawEta?:number;rawEtaFf?:number}):TimingEvidence|undefined {
 const selected=Object.fromEntries(inputFields.filter(key=>p[key]!==undefined).map(key=>[key,typeof p[key]==='string'?(p[key] as string).slice(0,128):p[key]]))
 const reference=(phaseData.profiles as Record<string,unknown>)[prediction.routeTiming?.profile.type??'']
 // Integrated route timing does not consume the fallback-buffer controls.
 const relevantConfig=prediction.routeTiming?configFields.filter(key=>!key.startsWith('euroscope')&&key!=='starApproachSpeed'&&key!=='starBaseSpeed'):configFields
 const remaining=p.route.filter(point=>Number.isFinite(point.seconds)&&point.seconds>=0)
 const points=remaining.slice(0,6).map(point=>[point.name.slice(0,40),point.latitude??null,point.longitude??null,point.seconds])
 const result:TimingEvidence={schema:'saaman-timing-summary-1',provenance:'capture-summary',at,engine:APPLICATION_BUILD,
  ...(accepted?{accepted:{eta:accepted.eta,etaFf:accepted.etaFf,rawEta:accepted.rawEta,rawEtaFf:accepted.rawEtaFf}}:{}),input:selected,model:{...(prediction.trafficProfile?{trafficProfile:prediction.trafficProfile}:{}),method:prediction.method,reference:prediction.reference,seconds:prediction.seconds,rawSeconds:prediction.rawSeconds,correctionSeconds:prediction.correctionSeconds,
   ...(prediction.routeTiming?{routeTiming:prediction.routeTiming}:{}),...(prediction.routeProgress?{routeProgress:prediction.routeProgress}:{}),...(prediction.rawClockRejected?{rawClockRejected:true}:{}),...(prediction.assumedApproach?{assumedApproach:prediction.assumedApproach}:{}),...(reference?{phaseReference:reference,phaseReferenceFingerprint:fingerprint(reference)}:{})},
  config:{...Object.fromEntries(relevantConfig.filter(key=>config[key]!==undefined).map(key=>[key,config[key]])),finalLength:config.finalLengths?.[`${p.arrival}/${p.runway}`]},
  route:{points,totalPoints:p.route.length,remainingPoints:remaining.length,omittedPoints:Math.max(0,remaining.length-points.length),fingerprint:fingerprint(p.route)}}
 // The summary is diagnostic evidence, not a claimed replay of an omitted
 // route. Keep a strict per-flight bound even for unusually long names.
 while(bytes(result)>TIMING_EVIDENCE_MAX_BYTES&&result.route.points.length){result.route.points.pop();result.route.omittedPoints++}
 return bytes(result)<=TIMING_EVIDENCE_MAX_BYTES?JSON.parse(JSON.stringify(result)):undefined
}
