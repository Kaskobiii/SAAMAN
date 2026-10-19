import type {EngineFlight,TelemetryFlight} from './maestro-engine'
import {distanceNm} from './maestro-star-prediction'

export interface MotionTiming {
 anchor:{latitude:number;longitude:number;altitude:number;at:number}
 movingSince?:number;held:boolean;groundspeed:number
}
const positioned=(p:TelemetryFlight)=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)
// A radar update can repeat between sweeps. Measure movement across a window,
// not between UI polls, and require sustained movement before trusting recovery.
export function motionTiming(p:TelemetryFlight,old:EngineFlight|undefined,now:number){
 if(!positioned(p)||(p.positionAgeSeconds??0)>15||p.altitude<500||old?.state===4||old?.missedRecovery||old?.mode&&old.mode!=='sequenced'||old&&
    (old.departure!==p.departure||old.arrival!==p.arrival||now-old.lastSeen>15000))return {state:undefined,held:false,reliable:false}
 const at=now-Math.max(0,p.positionAgeSeconds??0)*1000
 const point={latitude:p.latitude!,longitude:p.longitude!,altitude:p.altitude,at}
 const prior=old?.motionTiming
 const anchor=prior?.anchor??(old&&positioned(old)?{latitude:old.latitude!,longitude:old.longitude!,altitude:old.altitude,at:old.lastSeen-Math.max(0,old.positionAgeSeconds??0)*1000}:point)
 const elapsed=at-anchor.at,travel=distanceNm(anchor,point)
 const moved=elapsed>0&&(travel>=.06||Math.abs(p.altitude-anchor.altitude)>=100)
 const stopped=elapsed>=20000&&!moved
 // Very low airborne GS is not a useful descent/landing timing sample. Keep
 // slow aircraft and normal approach/rollout speeds outside this test.
 const trustedSpeed=prior?.groundspeed??old?.groundspeed??p.groundspeed
 const observedSpeed=elapsed>0?travel/elapsed*3600000:0
 const credibleSlow=elapsed>=5000&&travel>=.06&&p.groundspeed>=40&&observedSpeed>=p.groundspeed*.5&&observedSpeed<=p.groundspeed*1.5
 const implausible=!credibleSlow&&(p.altitude>=5000&&p.groundspeed<100&&(p.wake!=='L'&&p.wake!=='?'||trustedSpeed>=180)||p.altitude>=1500&&trustedSpeed>=180&&p.groundspeed<60)
 const movingSince=implausible||stopped?undefined:moved?prior?.movingSince??(prior?.held?at:anchor.at):prior?.movingSince
 const reliable=movingSince!==undefined&&at-movingSince>=10000
 const held=!!old?.euroscopeBaseline&&(implausible||stopped||prior?.held===true&&!reliable)
 const state:MotionTiming={anchor:moved?point:anchor,movingSince,held,groundspeed:held?trustedSpeed:p.groundspeed}
 return {state,held,reliable}
}
