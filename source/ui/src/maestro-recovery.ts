import type {EngineFlight,TelemetryFlight} from './maestro-engine'
import type {LandingPrediction} from './maestro-landing-prediction'
import {bearingBetween,headingDifference,finalPosition} from './maestro-geometry'
import {STAR_RUNWAYS,distanceNm,starTravelSeconds} from './maestro-star-prediction'
import data from './data/essa-star-distances.json'
import type {EngineConfig} from './maestro-engine'

export const RECOVERY_IAFS=['TEB','BALVI','ERXEC','OBCIV'] as const
export interface RecoveryEntry {fix:typeof RECOVERY_IAFS[number];runway:string;at:number}
export interface RecoveryRoute extends RecoveryEntry {passedAt?:number;approachSeconds?:number;completed?:boolean}
export function recoveryIafOptions(runway:string){
 return RECOVERY_IAFS.map(fix=>({fix,available:data.trajectories.some(p=>p.fix===fix&&p.runway===runway)}))
}
export function recoveryEntryPrediction(p:TelemetryFlight,config:EngineConfig,entry:RecoveryEntry,old:RecoveryRoute|undefined,now:number){
 if(entry.runway!==p.runway||!positioned(p)||(p.positionAgeSeconds??0)>15||p.groundspeed<60||p.altitude<350)return undefined
 const fix=data.navigation[entry.fix],threshold=p.threshold??STAR_RUNWAYS[p.runway]
 const method=config.starDistanceMethod==='ese'?'ese':'vectors'
 const leg=data.trajectories.find(q=>q.fix===entry.fix&&q.runway===p.runway&&q.method===method)
 if(!fix||!threshold||!leg)return undefined
 const state:RecoveryRoute=old?.at===entry.at&&old.fix===entry.fix&&old.runway===entry.runway?{...old}:{...entry}
 if(state.completed)return undefined
 const distance=distanceNm(p as any,fix),toFix=Math.max(0,distance/p.groundspeed*3600-Math.max(0,p.positionAgeSeconds??0))
 const altitude=Math.min(p.altitude,config.starEntryAltitude??18000,Math.max(3000,leg.remainingNm*318.4+150))
 const standard=starTravelSeconds(leg.remainingNm,altitude,threshold.heading,config,0,p.wake,p.aircraft)
 if(!Number.isFinite(standard)||standard<=0)return undefined
 if(state.passedAt===undefined&&distance<=.75){state.passedAt=now+toFix*1000;state.approachSeconds=standard}
 const seconds=state.passedAt===undefined?toFix+standard:Math.max(0,(state.passedAt-now)/1000+state.approachSeconds!)
 if(seconds<=0)return undefined
 const prediction:LandingPrediction={seconds,rawSeconds:Math.max(0,p.landingSeconds),correctionSeconds:seconds-Math.max(0,p.landingSeconds),reference:'threshold',method:'recovery-iaf',distanceNm:distance+leg.remainingNm,establishedFinal:false}
 return {prediction,state}
}

const positioned=(p:any)=>Number.isFinite(p?.latitude)&&Number.isFinite(p?.longitude)
export function observedGoAround(p:TelemetryFlight,old?:EngineFlight){
 return !!old&&old.mode==='sequenced'&&old.state>=2&&old.altitude<2500&&p.altitude>old.altitude+10&&
  (p.verticalSpeed??0)>500&&(p.positionAgeSeconds??0)<=15&&p.groundspeed>=60&&
  (old.landingPrediction?.establishedFinal===true||old.finalAlongNm!==undefined&&old.finalAlongNm>=-2&&old.finalAlongNm<=4)
}
export function usableRecoveryApproach(p:TelemetryFlight,prediction:LandingPrediction){
 if(prediction.method==='final-position'&&prediction.establishedFinal&&positioned(p)&&(p.positionAgeSeconds??0)<=15&&p.altitude>=-100&&(p.verticalSpeed??0)<=300&&p.groundspeed>=40)return true
 if(!positioned(p)||!Number.isFinite(p.heading)||(p.positionAgeSeconds??0)>15||p.groundspeed<60||p.altitude<350||(p.verticalSpeed??0)>300)return false
 if(prediction.method==='final-position'&&prediction.establishedFinal)return prediction.seconds>0
 if(!['aircraft-profile','route-slowdown','vector-position'].includes(prediction.method)||prediction.seconds<=0)return false
 const threshold=p.threshold??STAR_RUNWAYS[p.runway]
 if(prediction.method==='vector-position')return !prediction.vectoringOnly&&positioned(threshold)&&headingDifference(p.heading!,bearingBetween(p as any,threshold!))<=70
 if((p.assignedHeading??0)>0)return false
 const direct=p.direct?p.route.findIndex(q=>q.name===p.direct&&q.seconds>=0):-1
 const next=p.route.find((q,i)=>q.seconds>=0&&(direct<0||i>=direct))
 if(next&&(next.name===p.arrival||next.name===`SA${p.runway}`)){
  if(!positioned(threshold))return false
  const final=finalPosition(p as any,threshold!)
  return final.along>0&&final.along<=30&&Math.abs(final.cross)<=.5&&headingDifference(p.heading!,threshold!.heading)<=25&&p.altitude<=150+final.along*318.4+1500
 }
 return !!next&&positioned(next)&&headingDifference(p.heading!,bearingBetween(p as any,next as any))<=70
}
