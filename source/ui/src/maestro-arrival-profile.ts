import type {EngineConfig,EngineFlight,TelemetryFlight} from './maestro-engine'
import {STAR_PROFILES,STAR_FEEDERS,canonicalFeeder,distanceNm,starPrediction} from './maestro-star-prediction'
import {bearingBetween,headingDifference,localPosition} from './maestro-geometry'
import type {LandingPrediction} from './maestro-landing-prediction'

interface ManualArrivalPlan {error?:string;prediction?:ReturnType<typeof starPrediction>;landing?:LandingPrediction;observation?:{feeder:string;seconds:number;passed:boolean;available:boolean;source:string}}
const positioned=(p:any)=>Number.isFinite(p?.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p?.longitude)&&Math.abs(p.longitude)<=180

// An AMAN planning selection neither repairs the SDK route nor proves passage.
export function manualArrivalProfile(p:TelemetryFlight,config:EngineConfig,selected:string|undefined,old:EngineFlight|undefined,now:number,blocked=false):ManualArrivalPlan|undefined{
 if(!selected)return undefined
 const profile=STAR_PROFILES.find(row=>row.id===selected)
 if(!profile||p.arrival!=='ESSA'||profile.runway!==p.runway)return {error:'Selected Arrival route does not match the assigned arrival runway'}
 const selectedFeeder=profile.feeder,fix=STAR_FEEDERS[selectedFeeder],threshold=p.threshold
 const fresh=positioned(p)&&positioned(fix)&&positioned(threshold)&&Number.isFinite(p.positionAgeSeconds??0)&&(p.positionAgeSeconds??0)<=15&&
  Number.isFinite(p.groundspeed)&&p.groundspeed>=60&&p.groundspeed<=1200&&Number.isFinite(p.altitude)&&p.altitude>=350&&p.altitude<=60000&&p.speedDataValid!==false
 const prior=old?.ff===profile.feeder?old:undefined
 let passed=!!prior?.bufferedFeederVerified&&prior.passedFeeder
 if(fresh){
  const a=localPosition(p as any,fix),b=localPosition(threshold!,fix)
  passed=passed||distanceNm(p as any,fix)<.8||a.x*b.x+a.y*b.y>0&&distanceNm(p as any,threshold!)<distanceNm(fix,threshold!)+1
 }
 const holding=p.topskyHoldingPoint===profile.feeder&&fresh&&distanceNm(p as any,fix)<=12
 const rawIndex=p.route.findIndex(q=>canonicalFeeder(q)===profile.feeder),directIndex=p.direct?p.route.findIndex(q=>q.name===p.direct):-1
 const directPoint=directIndex>=0?p.route[directIndex]:undefined
 const returning=positioned(directPoint)&&positioned(p)&&Number.isFinite(p.heading)&&headingDifference(p.heading!,bearingBetween(p as any,directPoint as any))<=25
 const consumed=directIndex>=0&&(p.calculatedRouteIndex??-1)>directIndex&&!returning
 const bypassed=!!p.direct&&!consumed&&p.direct!==profile.feeder&&(rawIndex<0||directIndex<0||directIndex>rawIndex)
 const unavailable={feeder:profile.feeder,seconds:Math.max(0,((prior?.etaFf??now)-now)/1000),passed:false,available:false,source:'unavailable'}
 if(holding)return {observation:{...unavailable,seconds:distanceNm(p as any,fix)/p.groundspeed*3600,available:true,source:'holding'}}
 if(passed)return {observation:{feeder:profile.feeder,seconds:-1,passed:true,available:true,source:'passed'},...model()}
 if(!fresh||blocked||(p.assignedHeading??0)>0||bypassed){
  // A heading/direct is not a clearance back through the selected feeder.
  if(fresh&&Number.isFinite(p.heading)){
   const to=localPosition(fix,p as any),h=p.heading!*Math.PI/180,along=to.x*Math.sin(h)+to.y*Math.cos(h),cross=Math.abs(to.x*Math.cos(h)-to.y*Math.sin(h))
   if(along>0&&cross<=.8)return {observation:{...unavailable,seconds:Math.max(0,along/p.groundspeed*3600-(p.positionAgeSeconds??0)),available:true,source:'track'}}
  }
  return {observation:unavailable}
 }
 return model()
 function model():ManualArrivalPlan{
  if(!fresh||blocked||(p.assignedHeading??0)>0||bypassed)return {}
  const prediction=starPrediction({...p,arrivalProfile:selected},config,prior)
  if(prediction.error!==undefined)return {error:prediction.error}
  if(!Number.isFinite(prediction.seconds)||prediction.seconds<=0||prediction.seconds>14400)return {error:'Selected Arrival route has no usable airborne prediction'}
  const seconds=passed?-1:Math.max(0,prediction.feederSeconds??0)
  const rawSeconds=Number.isFinite(p.landingSeconds)&&p.landingSeconds>=0?p.landingSeconds:0
  const landing:LandingPrediction={seconds:prediction.seconds,rawSeconds,correctionSeconds:prediction.seconds-rawSeconds,reference:'threshold',method:'arrival-profile',
   arrivalProfile:selected,distanceNm:prediction.distanceProfile!.beforeFeederNm+prediction.distanceProfile!.remainingNm,establishedFinal:false}
  return {prediction:{...prediction,feederSeconds:seconds,passedFeeder:passed},landing,observation:{feeder:selectedFeeder,seconds,passed,available:true,source:'arrival-profile'}}
 }
}
