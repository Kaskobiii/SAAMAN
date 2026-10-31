import type {EngineFlight,TelemetryFlight} from './maestro-engine'
import {distanceNm} from './maestro-star-prediction'

type MotionPoint={latitude:number;longitude:number;altitude:number;at:number}
export interface MotionTiming {
 anchor:MotionPoint
 movingSince?:number;held:boolean;groundspeed:number
 gapAt?:number
 recovery?:{since:number;until:number;anchor:MotionPoint;lastAt:number;consistentSince?:number}
}
const positioned=(p:TelemetryFlight)=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)
// A radar update can repeat between sweeps. Measure movement across a window,
// not between UI polls, and require sustained movement before trusting recovery.
export function motionTiming(p:TelemetryFlight,old:EngineFlight|undefined,now:number){
 if(!positioned(p)||p.altitude<500||old?.state===4||old?.missedRecovery||old?.mode&&old.mode!=='sequenced'||old&&
    (old.departure!==p.departure||old.arrival!==p.arrival||now-old.lastSeen>60000))return {state:undefined,held:false,reliable:false}
 const age=Math.max(0,p.positionAgeSeconds??0),at=now-age*1000
 const point={latitude:p.latitude!,longitude:p.longitude!,altitude:p.altitude,at}
 const prior=old?.motionTiming
 const anchor=prior?.anchor??(old&&positioned(old)?{latitude:old.latitude!,longitude:old.longitude!,altitude:old.altitude,at:old.lastSeen-Math.max(0,old.positionAgeSeconds??0)*1000}:point)
 const trustedSpeed=prior?.groundspeed??old?.groundspeed??p.groundspeed
 const speedDiscontinuity=trustedSpeed>=180&&p.altitude>=5000&&p.groundspeed>=40&&
  Math.abs(p.groundspeed-trustedSpeed)>=80&&(p.groundspeed<trustedSpeed*.65||p.groundspeed>trustedSpeed*1.4)
 // A sparse controller/test poll is not continuous evidence of a stopped track.
 // Only qualify its return when the recovered speed itself is inconsistent.
 if(old&&now-old.lastSeen>15000&&!speedDiscontinuity)return {state:undefined,held:false,reliable:false}
 // Keep the last useful motion sample through stale UI polls. Freshness alone
 // cannot qualify the first speed after tracking resumes.
 if(age>15){
  const state:MotionTiming|undefined=old?{anchor,held:false,groundspeed:trustedSpeed,gapAt:prior?.gapAt??now}:undefined
  return {state,held:false,reliable:false}
 }
 const elapsed=at-anchor.at,travel=distanceNm(anchor,point)
 const moved=elapsed>0&&(travel>=.06||Math.abs(p.altitude-anchor.altitude)>=100)
 const stopped=elapsed>=20000&&!moved
 const interrupted=!!old&&(prior?.gapAt!==undefined||(old.positionAgeSeconds??0)>=10||now-old.lastSeen>10000)
 let recovery=prior?.recovery
 if(!recovery&&old?.euroscopeBaseline&&interrupted&&speedDiscontinuity)
  recovery={since:now,until:now+20000,anchor:point,lastAt:at}
 let recoveryHeld=false
 if(recovery){
  recovery={...recovery}
  const duration=at-recovery.anchor.at,trip=distanceNm(recovery.anchor,point)
  const observed=duration>0?trip/duration*3600000:0
  const freshSweep=at>recovery.lastAt+1000
  const consistent=duration>=4000&&trip>=.06&&p.groundspeed>=40&&observed>=p.groundspeed*.65&&observed<=p.groundspeed*1.4
  if(freshSweep){
   recovery.consistentSince=consistent?recovery.consistentSince??at:undefined
   recovery.lastAt=at
  }
  const qualified=recovery.consistentSince!==undefined&&at-recovery.consistentSince>=8000
  recoveryHeld=now<recovery.until&&!qualified
  if(!recoveryHeld)recovery=undefined
 }
 // Very low airborne GS is not a useful descent/landing timing sample. Keep
 // slow aircraft and normal approach/rollout speeds outside this test.
 const observedSpeed=elapsed>0?travel/elapsed*3600000:0
 const credibleSlow=elapsed>=5000&&travel>=.06&&p.groundspeed>=40&&observedSpeed>=p.groundspeed*.5&&observedSpeed<=p.groundspeed*1.5
 const implausible=!credibleSlow&&(p.altitude>=5000&&p.groundspeed<100&&(p.wake!=='L'&&p.wake!=='?'||trustedSpeed>=180)||p.altitude>=1500&&trustedSpeed>=180&&p.groundspeed<60)
 const movingSince=implausible||stopped?undefined:moved?prior?.movingSince??(prior?.held?at:anchor.at):prior?.movingSince
 const reliable=movingSince!==undefined&&at-movingSince>=10000&&!recoveryHeld
 const pauseHeld=implausible||stopped||prior?.held===true&&!prior.recovery&&!reliable
 const held=!!old?.euroscopeBaseline&&(pauseHeld||recoveryHeld)
 const state:MotionTiming={anchor:moved?point:anchor,movingSince,held,groundspeed:held?trustedSpeed:p.groundspeed,...(recovery?{recovery}:{})}
 return {state,held,reliable}
}
