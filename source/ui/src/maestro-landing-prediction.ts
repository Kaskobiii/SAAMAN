import type {TelemetryFlight,EngineConfig} from './maestro-engine'
import type {TrafficProfileAssumption} from './maestro-traffic-profile'
import {distanceNm,STAR_RUNWAYS} from './maestro-star-prediction'
import {finalPosition,headingDifference,vectoringDistance} from './maestro-geometry'
import {predictRouteTiming,predictAssumedApproachTiming,type RouteTiming,type AssumedApproach} from './maestro-route-timing'
import {planningRouteProgress} from './maestro-route-progress'

export interface LandingPrediction {
 trafficProfile?:TrafficProfileAssumption
 seconds:number;rawSeconds:number;correctionSeconds:number
 reference:'threshold'|'airport';method:'aircraft-profile'|'route-slowdown'|'retained-slowdown'|'final-position'|'vector-position'|'fallback'|'recovery-iaf'|'arrival-profile'
 arrivalProfile?:string
 routeTiming?:RouteTiming
 assumedApproach?:AssumedApproach
 distanceNm?:number;establishedFinal:boolean
 continuity?:{runway:string;seconds:number;at:number}
 directClearance?:{runway:string;point:string;at:number;returning?:boolean}
 vectoringOnly?:boolean
 routeProgress?:{index:number;consumedDirect:string}
 rawClockRejected?:boolean
}
const positioned=(p:any)=>Number.isFinite(p?.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p?.longitude)&&Math.abs(p.longitude)<=180
// Nominal groundspeeds along the remaining approach, not aircraft performance
// limits. Current slower traffic is never accelerated to meet this profile.
const speedProfile=[[0,140],[4,140],[10,180],[20,240],[40,300],[100,450]] as const
function nominalSpeed(distance:number){
 for(let i=1;i<speedProfile.length;i++){
  const [end,b]=speedProfile[i],[start,a]=speedProfile[i-1]
  if(distance<=end)return a+(b-a)*(distance-start)/(end-start)
 }
 return speedProfile.at(-1)![1]
}
export function routeSlowdownSeconds(distance:number,groundspeed:number){
 if(!Number.isFinite(distance)||distance<0||!Number.isFinite(groundspeed)||groundspeed<60)return undefined
 // A fast aircraft starts at its observed speed; its excess over the nominal
 // profile is shed progressively over the remaining distance.
 const excess=Math.max(0,groundspeed-nominalSpeed(distance)),steps=Math.max(1,Math.min(1000,Math.ceil(distance/.5))),leg=distance/steps
 let seconds=0
 for(let i=0;i<steps;i++){
  const remaining=distance-(i+.5)*leg
  const speed=Math.min(groundspeed,nominalSpeed(remaining)+excess*remaining/Math.max(.01,distance))
  seconds+=leg/Math.max(60,speed)*3600
 }
 return seconds
}
export function predictLanding(p:TelemetryFlight,config:EngineConfig,baseMinutes:number,previous?:LandingPrediction,timestamp=0):LandingPrediction {
 const priorDirect=previous?.directClearance
 const recentDirect=priorDirect&&priorDirect.runway===`${p.arrival}/${p.runway}`&&timestamp>=priorDirect.at&&timestamp-priorDirect.at<=10*60000?priorDirect:undefined
 const directIndex=p.direct?p.route.findIndex(point=>point.name===p.direct&&point.seconds>=0):-1
 const sameDirect=priorDirect?.runway===`${p.arrival}/${p.runway}`&&priorDirect.point===p.direct
 const observedDirect=!!p.direct&&!(p.assignedHeading??0)&&positioned(p)&&(p.positionAgeSeconds??0)<=15&&directIndex>=0
 const reached=observedDirect&&positioned(p.route[directIndex])&&distanceNm(p as any,p.route[directIndex] as any)<=1
 const directClearance=observedDirect?{runway:`${p.arrival}/${p.runway}`,point:p.direct!,at:sameDirect?priorDirect!.at:timestamp,
  returning:sameDirect?priorDirect!.returning&&!reached:((p.calculatedRouteIndex??-1)>directIndex&&!reached)}:recentDirect
 const progress=planningRouteProgress(p,{point:sameDirect?p.direct!:'',returning:directClearance?.returning})
 p=progress?.flight??p
 const result=(value:LandingPrediction):LandingPrediction=>({...value,directClearance, ...(progress?{routeProgress:{index:progress.index,consumedDirect:progress.consumedDirect}}:{})})
 const index=p.route.findIndex(point=>point.name===`SA${p.runway}`),point=p.route[index]
 const threshold=p.threshold??STAR_RUNWAYS[p.runway]
 const rawThreshold=point&&Number.isFinite(point.seconds)&&point.seconds>=0
 const rawSeconds=Math.max(0,rawThreshold?point.seconds:p.landingSeconds)
 const reference=rawThreshold?'threshold':'airport'
 const positionFresh=(p.positionAgeSeconds??0)<=15&&positioned(p)
 const relative=positionFresh&&positioned(threshold)?finalPosition(p as any,threshold!):undefined
 const alignedApproach=!!relative&&relative.along>=-1&&relative.along<=15&&Math.abs(relative.cross)<=.25&&
  Number.isFinite(p.heading)&&headingDifference(p.heading!,threshold!.heading)<=15&&p.altitude<=4500&&(p.verticalSpeed??0)<=300&&p.groundspeed>=60
 const establishedFinal=alignedApproach&&relative!.along<=4
 if(establishedFinal){
  const distance=Math.max(0,relative!.along),seconds=Math.max(0,distance/p.groundspeed*3600-Math.max(0,p.positionAgeSeconds??0))
  return result({seconds,rawSeconds,correctionSeconds:seconds-rawSeconds,reference:'threshold',method:'final-position',distanceNm:distance,establishedFinal})
 }
 // A zero destination clock while airborne and pointing/climbing away from
 // final is not a threshold crossing. Use the existing bounded vector path;
 // this neither declares a go-around nor invents a direct clearance.
 if(rawSeconds===0&&positionFresh&&positioned(threshold)&&p.arrival==='ESSA'&&p.altitude>=1000&&p.altitude<=18000&&
  p.groundspeed>=60&&p.speedDataValid!==false&&!p.topskyHoldingPoint&&!p.topskyMissedApproach&&Number.isFinite(p.heading)&&distanceNm(p as any,threshold!)<=50&&
  ((p.verticalSpeed??0)>300||relative!.along<0||headingDifference(p.heading!,threshold!.heading)>45)){
  const path=vectoringDistance(p as any,p.heading!,threshold!,config.finalLengths?.[`${p.arrival}/${p.runway}`]??10,p.groundspeed)
  const distance=path.turnNm+path.finalNm,travel=routeSlowdownSeconds(distance,p.groundspeed)
  const seconds=Math.max(travel??0,Math.max(0,p.altitude-150)/3000*60)
  if(travel!==undefined&&distance>0&&distance<=200&&Number.isFinite(seconds))
   return result({seconds,rawSeconds,correctionSeconds:seconds,reference:'threshold',method:'vector-position',distanceNm:distance,establishedFinal:false,vectoringOnly:true,rawClockRejected:true})
 }
 // Heading clearances restore the original FLEG even without a recent direct.
 // For fresh terminal traffic, estimate the current bounded-turn path to final
 // instead. Recompute and a ten-minute-old direct must not revive that FLEG.
 // This is an estimate of the vector path, not an inferred straight-in clearance.
 const terminalVector=p.arrival==='ESSA'&&positionFresh&&positioned(threshold)&&distanceNm(p as any,threshold!)<=50&&p.altitude>=350&&p.altitude<=18000&&(p.verticalSpeed??0)<=300&&!p.topskyMissedApproach
 if((directClearance||terminalVector)&&(p.assignedHeading??0)>0&&positionFresh&&positioned(threshold)&&p.altitude<=18000&&p.groundspeed>=60&&Number.isFinite(p.heading)){
  const path=vectoringDistance(p as any,p.heading!,threshold!,config.finalLengths?.[`${p.arrival}/${p.runway}`]??10,p.groundspeed)
  const distance=path.turnNm+path.finalNm
  const timing=predictRouteTiming({...p,assignedHeading:0,routeProblem:''},config,undefined,{distanceNm:distance})
  const seconds=timing?.seconds??routeSlowdownSeconds(distance,p.groundspeed)
  if(Number.isFinite(distance)&&distance>0&&distance<=200&&seconds!==undefined&&Number.isFinite(seconds))
   return result({seconds,rawSeconds,correctionSeconds:seconds-rawSeconds,reference:'threshold',method:'vector-position',distanceNm:distance,routeTiming:timing,establishedFinal:false,vectoringOnly:true})
 }
 if(p.departure==='ESSB'&&p.arrival==='ESSA'&&positionFresh&&positioned(threshold)&&p.altitude>=350&&p.altitude<=12000&&p.groundspeed>=60&&Number.isFinite(p.heading)&&!p.route.some(q=>q.name!==p.departure&&q.name!==p.arrival)){
  const path=vectoringDistance(p as any,p.heading!,threshold!,config.finalLengths?.[`${p.arrival}/${p.runway}`]??10,p.groundspeed),distance=path.turnNm+path.finalNm
  const timing=predictRouteTiming(p,config,undefined,{distanceNm:distance}),seconds=timing?.seconds??routeSlowdownSeconds(distance,p.groundspeed)
  if(seconds!==undefined&&distance<100)return result({seconds,rawSeconds,correctionSeconds:seconds-rawSeconds,reference:'threshold',method:'vector-position',distanceNm:distance,routeTiming:timing,establishedFinal:false})
 }
 const observedRouteTiming=predictRouteTiming(p,config)
 const assumedApproach=observedRouteTiming?undefined:predictAssumedApproachTiming(p,config)
 const routeTiming=observedRouteTiming??assumedApproach?.timing
 if(routeTiming){
  const correctionSeconds=routeTiming.seconds-rawSeconds
  return result({seconds:routeTiming.seconds,rawSeconds,correctionSeconds,reference:'threshold',method:'aircraft-profile',routeTiming,assumedApproach:assumedApproach?.assumption,
   distanceNm:routeTiming.distanceNm,establishedFinal:false,
   continuity:{runway:`${p.arrival}/${p.runway}`,seconds:Math.max(0,correctionSeconds),at:timestamp}})
 }
 let distance:number|undefined
 if(alignedApproach)distance=Math.max(0,relative!.along)
 if(distance===undefined&&positionFresh&&rawThreshold&&index>=0){
  const direct=p.direct?p.route.findIndex(q=>q.name===p.direct&&q.seconds>=0):-1
  const remaining=p.route.slice(0,index+1).filter((q,i)=>q.seconds>=0&&(direct<0||i>=direct))
  if(remaining.length&&remaining.at(-1)===point&&remaining.every(positioned)){
   let prior=p;distance=0
   for(const q of remaining){distance+=distanceNm(prior as any,q as any);prior=q as any}
  }
 }
 // A heading clearance provides no known route back to the STAR. Preserve
 // EuroScope's observation and an explicit fallback rather than invent a turn.
 const routeUsable=distance!==undefined&&distance<=1500&&(!((p.assignedHeading??0)>0)||alignedApproach)
 const travel=routeUsable?routeSlowdownSeconds(distance!,p.groundspeed):undefined
 const modeled=travel===undefined?undefined:Math.max(0,travel-Math.max(0,p.positionAgeSeconds??0))
 // SDK EET samples are quantized to whole minutes in our recordings. A
 // midpoint is an estimate of that uncertainty, not extra approach delay.
 const quantization=rawThreshold&&rawSeconds>=60&&rawSeconds%60===0?30:0
 const limit=Math.min(15,baseMinutes+Math.max(0,config.euroscopeHighSpeedBufferMinutes??6))*60
 if(modeled!==undefined){
  // Both progress and a fresh forward track prove that the large positive
  // clock at the current waypoint belongs to the consumed part of the FLEG.
  // Keep the geometric slowdown fallback even if the detailed type model
  // rejects an unusual observed speed ratio.
  if(progress&&p.speedDataValid!==false&&p.groundspeed>=60&&rawSeconds-modeled>180&&
   progress.currentSeconds>progress.currentDistanceNm/p.groundspeed*3600+120)
   return result({seconds:modeled,rawSeconds,correctionSeconds:modeled-rawSeconds,reference,method:'route-slowdown',distanceNm:distance,establishedFinal:false,rawClockRejected:true})
  // Account for slowdown already present in EuroScope's EET. The correction
  // is the missing time, rather than another full speed buffer on top of it.
  const correctionSeconds=Math.max(0,Math.min(limit,Math.max(quantization,modeled-rawSeconds)))
  return result({seconds:rawSeconds+correctionSeconds,rawSeconds,correctionSeconds,reference,method:'route-slowdown',distanceNm:distance,establishedFinal:false,
   continuity:{runway:`${p.arrival}/${p.runway}`,seconds:correctionSeconds,at:timestamp}})
 }
 // A vector does not undo the slowdown already predicted. Carry only the
 // last model correction, never STA, accepted delay or a holding instruction.
 // Do not refresh its age during fallback, cross runways or retain it forever.
 const last=previous?.continuity
 const continuity=last&&Number.isFinite(last.at)&&Number.isFinite(last.seconds)&&last.seconds>=0&&
  last.runway===`${p.arrival}/${p.runway}`&&timestamp>=last.at&&timestamp-last.at<=10*60000?last:undefined
 const fallback=Math.min(15*60,quantization+Math.min(Math.max(0,baseMinutes)*60,rawSeconds*.5))
 const retained=positionFresh&&rawSeconds>0&&continuity?Math.min(limit,continuity.seconds):0
 const correctionSeconds=Math.max(fallback,retained)
 return result({seconds:rawSeconds+correctionSeconds,rawSeconds,correctionSeconds,reference,method:retained>fallback?'retained-slowdown':'fallback',establishedFinal:false,continuity})
}
