import type {EngineConfig,TelemetryFlight} from './maestro-engine'
import type {LandingPrediction} from './maestro-landing-prediction'
import {predictRouteTiming,PHASE_REFERENCES} from './maestro-route-timing'
import {aircraftType,performanceAt} from './maestro-aircraft-performance'
import {matchStarProfile,STAR_FEEDERS,STAR_RUNWAYS,distanceNm} from './maestro-star-prediction'
import {finalPosition,headingDifference} from './maestro-geometry'

export type TrafficProfileMode='low'|'medium'|'high'
export interface TrafficProfileAssumption {
 mode:TrafficProfileMode;profileId:string;profile:'shortest'|'standard'|'extended'
 basis:'shortest'|'vectors'|'extended-vectors'
 terminalDistanceNm:number;distanceNm:number;plannedDistanceNm:number;neutralDistanceNm:number
 extraTrackNm:number;distanceCorrectionNm:number;secondsCorrection:number;neutralSeconds:number;minimumDescentSeconds:number
}
export interface TrafficProfileOptions {passedFeeder?:boolean;feeder?:string;highDownwindNm?:number}
export interface TrafficProfileResult {prediction:LandingPrediction;neutralSeconds:number;assumption?:TrafficProfileAssumption}
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)
const positioned=(p:any)=>finite(p?.latitude)&&Math.abs(p.latitude)<=90&&finite(p?.longitude)&&Math.abs(p.longitude)<=180
function minimumDescentSeconds(p:TelemetryFlight,config:EngineConfig,toAltitude=150){
 const type=aircraftType(p.aircraft),reference=PHASE_REFERENCES[type]
 const highTo=reference?.initialDescentToFeet??24000,descentTo=reference?.descentToFeet??10000
 const target=Math.max(150,toAltitude)
 let seconds=0
 // Match the existing route integrator's threshold-altitude endpoint. This
 // feasibility floor does not add a second descent or slowdown allowance.
 for(let altitude=p.altitude;altitude>target;){
  const boundary=altitude>highTo?highTo:altitude>descentTo?descentTo:150
  const step=Math.min(500,altitude-Math.max(target,boundary)),mid=altitude-step/2
  if(step<=0)return Infinity
  const phase=mid>highTo?reference?.highDescentFpm:mid>descentTo?reference?.descentFpm:reference?.approachFpm
  const profile=performanceAt(type,mid,'descent',config.performanceModel)?.descentFpm
  const rates=[phase,profile].filter((rate):rate is number=>finite(rate)&&rate>0)
  // The configured descent rate is the same fallback used by route timing;
  // it must not replace available type-specific performance with a slower cap.
  const rate=rates.length?Math.min(...rates):config.starDescentRate??1800
  if(!finite(rate)||rate<=0)return Infinity
  seconds+=step/Math.max(100,rate)*60;altitude-=step
 }
 return Math.max(0,seconds-Math.max(0,p.positionAgeSeconds??0))
}
/** Planning distance only: observed clearances and final approach retain priority. */
export function trafficProfilePrediction(p:TelemetryFlight,config:EngineConfig,base:LandingPrediction,mode:TrafficProfileMode,options:TrafficProfileOptions={}):TrafficProfileResult {
 const unchanged:TrafficProfileResult={prediction:base,neutralSeconds:base.seconds}
 if(!['low','medium','high'].includes(mode)||p.arrival!=='ESSA'||!positioned(p)||(p.positionAgeSeconds??0)>15||
  base.establishedFinal||base.method!=='aircraft-profile'||!base.routeTiming||p.routeProblem||p.speedDataValid===false||
  p.topskyMissedApproach||(p.assignedHeading??0)>0)return unchanged
 const current=base.routeTiming,profile=matchStarProfile(p,options.feeder?{passedFeeder:options.passedFeeder,ff:options.feeder} as any:undefined)
 if(!profile||profile.kind!=='star'||(p.star??'').toUpperCase().includes('RNP')||!finite(profile.shortest)||!finite(profile.vectors)||profile.shortest<=0||profile.vectors<=0)return unchanged
 const threshold=p.threshold??STAR_RUNWAYS[p.runway]
 if(!positioned(threshold)||!finite(threshold.heading))return unchanged
 const relative=finalPosition(p as any,threshold)
 if(relative.along>=-1&&relative.along<=15&&Math.abs(relative.cross)<=.5&&p.altitude<=4500&&(p.verticalSpeed??0)<=300&&finite(p.heading)&&headingDifference(p.heading,threshold.heading)<=20)return unchanged
 const feederIndex=p.route.findIndex(q=>q.name===profile.feeder),directIndex=p.direct?p.route.findIndex(q=>q.name===p.direct):-1
 // A direct to the feeder or an upstream point leaves the terminal assumption
 // available. A direct beyond it supplies the controller's actual shorter path.
 if(p.direct&&p.direct!==profile.feeder&&(feederIndex<0||directIndex<0||directIndex>feederIndex))return unchanged
 const passed=options.passedFeeder===true||!current.feeder
 // The mode describes the terminal path expected before entry. Once an
 // aircraft enters TMA, its retained approach is stronger evidence than a
 // scaled copy of the complete workbook vector pattern. Scaling that full
 // pattern by route progress can restore miles which ATC has already cut.
 if(passed)return unchanged
 if(current.feeder?.name!==profile.feeder)return unchanged
 const before=current.beforeFeederNm,originalTerminal=current.distanceNm-before
 if(!finite(before)||before<0||!finite(originalTerminal)||originalTerminal<=0)return unchanged
 const downwind=options.highDownwindNm??4
 if(!finite(downwind)||downwind<0||downwind>20)return unchanged
 const origin=p.route.find(q=>q.name===profile.feeder&&positioned(q))??STAR_FEEDERS[profile.feeder]
 if(!positioned(origin))return unchanged
 const physicalFloor=distanceNm(origin as any,threshold)
 // A usable cleared STAR supplies the standard path. Workbook distances
 // identify the shortest-path option; they must not replace that path with
 // an unrelated longer vector pattern before adding the High extension.
 const standard=Math.max(physicalFloor,originalTerminal)
 const requested=mode==='low'?Math.min(originalTerminal,profile.shortest):originalTerminal+(mode==='high'?2*downwind:0)
 const terminal=Math.max(physicalFloor,requested)
 if(!finite(terminal)||terminal<=0||terminal>200)return unchanged
 // Integrate only the terminal segment. Keeping the original feeder time
 // avoids changing upstream instructions when the expected vector path changes.
 const entryAltitude=Math.min(p.altitude,config.starEntryAltitude??18000,Math.max(3000,originalTerminal*318.4+150))
 if(current.feeder&&minimumDescentSeconds(p,config,entryAltitude)>current.feeder.seconds+1e-6)return unchanged
 const virtual={...p,assignedHeading:0,altitude:entryAltitude,groundspeed:current.entryGroundspeed,positionAgeSeconds:0}
 const timing=predictRouteTiming(virtual,config,undefined,{distanceNm:terminal})
 const neutralTiming=predictRouteTiming(virtual,config,undefined,{distanceNm:originalTerminal})
 if(!timing||!neutralTiming)return unchanged
 const descent=minimumDescentSeconds(virtual,config)
 const afterFeederSeconds=current.afterFeederSeconds+timing.seconds-neutralTiming.seconds
 if(!finite(descent)||afterFeederSeconds+1e-6<descent)return unchanged
 const feeder=current.feeder
 const seconds=(feeder?.seconds??0)+afterFeederSeconds
 if(!finite(seconds)||seconds<=0||seconds>14400)return unchanged
 const distance=before+terminal
 const routeTiming={...current,seconds,distanceNm:distance,beforeFeederNm:before,afterFeederSeconds,feeder}
 const prediction:LandingPrediction={...base,seconds,correctionSeconds:seconds-base.rawSeconds,distanceNm:distance,routeTiming,
  continuity:base.continuity?{...base.continuity,seconds:Math.max(0,seconds-base.rawSeconds)}:undefined}
 return {prediction,neutralSeconds:base.seconds,assumption:{mode,profileId:profile.id,profile:mode==='low'?'shortest':mode==='medium'?'standard':'extended',basis:mode==='low'?'shortest':mode==='medium'?'vectors':'extended-vectors',
  terminalDistanceNm:terminal,distanceNm:distance,plannedDistanceNm:distance,neutralDistanceNm:current.distanceNm,
  extraTrackNm:mode==='high'?Math.max(0,terminal-standard):0,distanceCorrectionNm:distance-current.distanceNm,secondsCorrection:seconds-base.seconds,neutralSeconds:base.seconds,minimumDescentSeconds:descent}}
}
