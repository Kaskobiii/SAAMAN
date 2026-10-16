import type {TelemetryFlight,EngineConfig} from './maestro-engine'
import {distanceNm} from './maestro-star-prediction'
import {iasToTas,machToTas,performanceAt,aircraftType} from './maestro-aircraft-performance'
import {bundledPhaseReferences,type PhaseReferences} from './maestro-phase-references'
import phaseData from './data/eurocontrol-phase-profiles.json'

// Validated once at module load; no network, files or database queries in EuroScope.
export const PHASE_REFERENCES:PhaseReferences=bundledPhaseReferences(phaseData)
export interface RouteTiming {
 seconds:number;distanceNm:number;beforeFeederNm:number;afterFeederSeconds:number;entryGroundspeed:number
 feeder?:{name:string;seconds:number;distanceNm:number}
 profile:{type:string;source:string;observedSpeedRatio:number}
}
const positioned=(p:any)=>Number.isFinite(p?.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p?.longitude)&&Math.abs(p.longitude)<=180
const feeders=['ELTOK','NILUG','XILAN','VACRA']
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v))
export function remainingRoute(p:TelemetryFlight){
 if(!positioned(p)||!Array.isArray(p.route)||p.route.length>512||!Number.isFinite(p.positionAgeSeconds??0)||(p.positionAgeSeconds??0)>15)return undefined
 const end=p.route.findIndex(q=>q.name===`SA${p.runway}`)
 if(end<0||!Number.isFinite(p.route[end].seconds)||p.route[end].seconds<0)return undefined
 const direct=p.direct?p.route.findIndex(q=>q.name===p.direct&&q.seconds>=0):-1
 const points=p.route.slice(0,end+1).filter((q,i)=>Number.isFinite(q.seconds)&&q.seconds>=0&&(direct<0||i>=direct))
 if(!points.length||points.at(-1)!==p.route[end]||!points.every(positioned))return undefined
 let prior=p,distance=0,feeder:{name:string;distanceNm:number}|undefined
 for(const point of points){
  distance+=distanceNm(prior as any,point as any);prior=point as any
  if(!feeder&&feeders.includes(point.name))feeder={name:point.name,distanceNm:distance}
 }
 if(!Number.isFinite(distance)||distance<=0||distance>1500)return undefined
 return {distanceNm:distance,feeder}
}
export function predictRouteTiming(p:TelemetryFlight,config:EngineConfig,references:PhaseReferences=PHASE_REFERENCES,observedPath?:{distanceNm:number}):RouteTiming|undefined {
 if(p.arrival!=='ESSA'||p.assignedHeading&&p.assignedHeading>0||p.routeProblem||p.speedDataValid===false||
  !Number.isFinite(p.altitude)||p.altitude<350||p.altitude>60000||!Number.isFinite(p.groundspeed)||p.groundspeed<60||p.groundspeed>1200||!Number.isFinite(p.verticalSpeed??0)||(p.verticalSpeed??0)>300)return undefined
 const geometry:ReturnType<typeof remainingRoute>=observedPath&&positioned(p)&&(p.positionAgeSeconds??0)<=15&&Number.isFinite(observedPath.distanceNm)&&observedPath.distanceNm>0&&observedPath.distanceNm<=200?{distanceNm:observedPath.distanceNm,feeder:undefined}:observedPath?undefined:remainingRoute(p)
 if(!geometry)return undefined
 const type=aircraftType(p.aircraft),reference=references[type]
 const profile=performanceAt(type,p.altitude,'descent',config.performanceModel)
 if(!reference&&!profile)return undefined
 const distance=geometry.distanceNm,before=geometry.feeder?.distanceNm??0,after=distance-before
 const finalIas=reference?.landingIas??Math.min(config.landingSpeedKnots,p.wake==='L'?110:config.landingSpeedKnots)
 const approachIas=reference?.approachIas??performanceAt(type,3000,'descent',config.performanceModel)?.nominalIas
 if(!approachIas)return undefined
 const nominal=(altitude:number,remaining:number)=>{
  const actual=!reference||!reference.mach&&altitude>22000?performanceAt(type,altitude,'descent',config.performanceModel):undefined
  const approach=reference?.approachIas??approachIas,descent=reference?.descentIas??actual?.nominalIas??approach
  const descentBoundary=reference?.descentToFeet??10000,initialBoundary=reference?.initialDescentToFeet??24000
  const descentIas=reference?approach+(descent-approach)*clamp((altitude-(descentBoundary-2000))/4000,0,1):undefined
  const lower=descentIas===undefined?undefined:iasToTas(descentIas,altitude)
  const high=reference?.mach?machToTas(reference.mach,altitude):actual?.nominalTas??lower
  let tas=reference?lower!+(high!-lower!)*clamp((altitude-(initialBoundary-2000))/4000,0,1):actual?.nominalTas
  if(!tas)return undefined
  const terminalIas=remaining<=4?finalIas:remaining<=10?finalIas+(Math.min(180,approachIas)-finalIas)*(remaining-4)/6:
   remaining<=20?Math.min(180,approachIas)+(approachIas-Math.min(180,approachIas))*(remaining-10)/10:Infinity
  return Math.min(tas,iasToTas(terminalIas,altitude))
 }
 const initial=nominal(p.altitude,distance)
 if(!initial||!Number.isFinite(initial))return undefined
 // This is an observed speed offset, not a measured wind estimate. It also
 // includes simulator/pilot behaviour. Do not infer actual IAS from GS alone.
 const ratio=p.groundspeed/initial
 if(ratio<.65||ratio>1.4)return undefined
 const entryAltitude=geometry.feeder?Math.min(p.altitude,config.starEntryAltitude??18000,Math.max(3000,after*318.4+150)):p.altitude
 // Far from the feeder, do not assume descent begins immediately. Estimate
 // its nominal distance and keep the remaining upstream segment at capture
 // altitude/speed. This avoids spreading a descent over hundreds of miles.
 let descentDistance=0
 for(let altitude=p.altitude;altitude>entryAltitude;){
  const step=Math.min(500,altitude-entryAltitude),mid=altitude-step/2
  const fallbackRate=performanceAt(type,mid,'descent',config.performanceModel)?.descentFpm??config.starDescentRate??1800
  const rate=reference?((mid>24000?reference.highDescentFpm:mid>10000?reference.descentFpm:reference.approachFpm)??fallbackRate):fallbackRate
  descentDistance+=step/Math.max(100,rate)*Math.min(p.groundspeed,(nominal(mid,after+before/2)??p.groundspeed)*ratio)/60
  altitude-=step
 }
 const altitudeAt=(travelled:number)=>geometry.feeder&&travelled<=before?
  p.altitude+(entryAltitude-p.altitude)*clamp((travelled-Math.max(0,before-descentDistance))/Math.max(.01,Math.min(before,descentDistance)),0,1):
  150+(entryAltitude-150)*(distance-travelled)/Math.max(.01,geometry.feeder?after:distance)
 let total=0,feederTime=0
 // Split at the exact feeder distance so landing and feeder estimates share
 // the same integration and position-age correction, without a second buffer.
 for(const [start,end] of geometry.feeder?[[0,before],[before,distance]]:[[0,distance]]){
  const steps=Math.max(1,Math.ceil((end-start)/.25)),leg=(end-start)/steps
  for(let i=0;i<steps;i++){
   const travelled=start+(i+.5)*leg,altitude=altitudeAt(travelled),tas=nominal(altitude,distance-travelled)
   if(!tas||!Number.isFinite(tas))return undefined
   const assigned=p.assignedSpeed&&p.assignedSpeed>0?iasToTas(p.assignedSpeed,altitude):Infinity
   const mach=p.assignedMach&&p.assignedMach>0?machToTas(p.assignedMach/100,altitude):Infinity
   // The observed offset anchors entry timing. Its unknown wind/behaviour
   // components cannot be assumed unchanged through the terminal slowdown.
   const remainingFraction=travelled<=before?1:(distance-travelled)/Math.max(.01,after)
   const speedRatio=1+(ratio-1)*clamp(remainingFraction,0,1)
   const speed=Math.min(p.groundspeed,tas*speedRatio,assigned*speedRatio,mach*speedRatio)
   total+=leg/Math.max(60,speed)*3600
  }
  if(end===before)feederTime=total
 }
 const age=Math.max(0,p.positionAgeSeconds??0),seconds=Math.max(0,total-age)
 if(!Number.isFinite(seconds)||seconds>14400||!Number.isFinite(feederTime))return undefined
 const feeder=geometry.feeder?{...geometry.feeder,seconds:Math.max(0,feederTime-age)}:undefined
 return {seconds,distanceNm:distance,beforeFeederNm:before,afterFeederSeconds:seconds-(feeder?.seconds??0),feeder,
  entryGroundspeed:Math.min(p.groundspeed,(nominal(entryAltitude,after)??p.groundspeed)*ratio),
  profile:{type,source:reference?.source??profile!.source,observedSpeedRatio:ratio}}
}
