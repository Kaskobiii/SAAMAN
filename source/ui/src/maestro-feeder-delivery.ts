import type {EngineConfig,EngineFlight} from './maestro-engine'
import {PHASE_REFERENCES} from './maestro-route-timing'
import {aircraftType,performanceAt,iasToTas,machToTas} from './maestro-aircraft-performance'
import {distanceNm} from './maestro-star-prediction'
import {bearingBetween} from './maestro-geometry'

export interface FeederDelivery {gapId:string;seconds:number;entryIas:number;route:string}
const positioned=(p:any)=>Number.isFinite(p?.latitude)&&Number.isFinite(p?.longitude)
// This is a delivery plan for a constrained runway bank, not a replacement for
// the live ETA. Before the feeder the observed GS still determines ETA-FF.
// Beyond it, plan a compatible entry/deceleration profile rather than carrying
// an upstream cruise-speed offset through the whole STAR.
export function feederDelivery(f:EngineFlight,config:EngineConfig):Omit<FeederDelivery,'gapId'>|undefined {
 if(!f.euroscopeBaseline||f.initialProfile?.pending||f.passedFeeder||f.feederEtaAvailable===false||f.state>=3||f.missedRecovery||f.motionTiming?.held||
    f.speedDataValid===false||(f.positionAgeSeconds??0)>15||!Number.isFinite(f.groundspeed)||!Number.isFinite(f.altitude)||f.groundspeed<60||f.altitude<350)return undefined
 const route=f.amanRoute??f.route,start=route.findIndex(p=>p.name===f.ff),end=route.findIndex(p=>p.name===`SA${f.runway}`)
 if(start<0||end<=start)return undefined
 const points=route.slice(start,end+1)
 if(!points.every(positioned))return undefined
 const type=aircraftType(f.aircraft),reference=PHASE_REFERENCES[type]
 const profile=performanceAt(type,10000,'descent',config.performanceModel)
 const descentIas=reference?.descentIas??profile?.nominalIas,finalIas=reference?.landingIas
 if(!descentIas||!finalIas)return undefined
 const entryIas=Math.min(config.starApproachSpeed??250,descentIas,f.assignedSpeed&&f.assignedSpeed>0?f.assignedSpeed:Infinity)
 const legs=points.slice(1).map((point,i)=>({distance:distanceNm(points[i] as any,point as any),heading:bearingBetween(points[i] as any,point as any)}))
 const distance=legs.reduce((n,leg)=>n+leg.distance,0)
 if(!Number.isFinite(distance)||distance<=0||distance>200)return undefined
 const entryAltitude=Math.min(f.altitude,config.starEntryAltitude??18000,Math.max(3000,distance*318.4+150))
 const baseIas=Math.min(180,entryIas)
 let travelled=0,seconds=0
 for(const leg of legs){
  const steps=Math.max(1,Math.ceil(leg.distance/.25)),step=leg.distance/steps
  for(let i=0;i<steps;i++){
   const remaining=distance-travelled-step/2,altitude=150+(entryAltitude-150)*remaining/distance
   const ias=Math.min(entryIas,remaining<=4?finalIas:remaining<=10?finalIas+(baseIas-finalIas)*(remaining-4)/6:
    remaining<=20?baseIas+(entryIas-baseIas)*(remaining-10)/10:entryIas)
   // A surface report describes the surface layer, not the unknown wind aloft.
   const headwind=altitude<=3000&&config.surfaceWindDirection!==0?config.surfaceWindSpeed*Math.cos((config.surfaceWindDirection-leg.heading)*Math.PI/180):0
   const mach=f.assignedMach&&f.assignedMach>0?machToTas(f.assignedMach/100,altitude):Infinity
   const speed=Math.max(50,Math.min(f.groundspeed,iasToTas(ias,altitude)-headwind,mach-headwind))
   seconds+=step/speed*3600;travelled+=step
  }
 }
 if(!Number.isFinite(seconds)||seconds<=0||seconds>14400)return undefined
 return {seconds,entryIas,route:points.map(p=>p.name).join(' ')}
}
