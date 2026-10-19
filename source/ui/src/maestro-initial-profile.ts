import type {EngineFlight,FlightEdit,TelemetryFlight} from './maestro-engine'
import type {LandingPrediction} from './maestro-landing-prediction'

export interface InitialProfile {
 pending:boolean;capture:number;candidateSince?:number;candidateEta?:number
 workSeconds:number;appliedAt?:number
 reason?:'climb'|'motion'
}
// Only an unreliable initial forecast can receive this one-time handover.
// Later speed/route changes are observations against the accepted allocation.
export function initialProfileHandover(p:TelemetryFlight,old:EngineFlight|undefined,edit:FlightEdit,prediction:LandingPrediction,now:number,reset:boolean,usable=true,moving=false){
 let state=old?.initialProfile?{...old.initialProfile}:undefined
 if(reset&&usable&&old?.euroscopeBaseline)return {state:state?{...state,pending:false,candidateSince:undefined}:undefined,ready:false}
 const lowCapture=!old?.euroscopeBaseline&&p.altitude>=5000&&p.groundspeed<100
 const legacyLowCapture=!!old?.euroscopeBaseline&&!state&&old.euroscopeBaseline.groundspeed!==undefined&&old.euroscopeBaseline.groundspeed<120&&p.altitude>=5000&&p.groundspeed>=180
 const initialPause=!state&&old?.motionTiming?.held&&now-old.firstSeen<=60000
 if(lowCapture||legacyLowCapture||initialPause)state={pending:true,capture:old?.euroscopeBaseline?.at??now,workSeconds:0,reason:'motion'}
 else if(!old?.euroscopeBaseline&&(p.verticalSpeed??0)>300&&prediction.method!=='aircraft-profile')
  state={pending:true,capture:now,workSeconds:0,reason:'climb'}
 if(!state?.pending)return {state,ready:false}
 const manual=edit.target!==undefined||edit.order!==undefined||!!edit.slotBefore||!!edit.slotAfter||!!old?.reorderTiming
 if(manual||old&&(![0,1].includes(old.state)||old.passedFeeder||old.mode!=='sequenced'||old.missedRecovery||old.minimumArrivalSource==='resume'))
  return {state:{...state,pending:false,candidateSince:undefined},ready:false}
 const spacing=old?.separation,constrained=old&&((old.closureDelayMs??0)>0||(old.feederDelayMs??0)>0||(old.wakeDelayMs??0)>0||(old.rateDelayMs??0)>0||
  spacing&&spacing.scheduledSeconds<=Math.max(spacing.rateSeconds,spacing.wakeSeconds)+1)
 if(constrained)state.workSeconds=Math.max(state.workSeconds,old!.delay,0)
 if(!usable||state.reason==='motion'&&!moving||prediction.method!=='aircraft-profile'||!prediction.routeTiming?.feeder||(p.positionAgeSeconds??0)>15||(p.verticalSpeed??0)>300){
  state.candidateSince=undefined;state.candidateEta=undefined;return {state,ready:false}
 }
 const eta=now+prediction.seconds*1000
 const consistent=state.candidateSince!==undefined&&state.candidateEta!==undefined&&Math.abs(eta-state.candidateEta)<=60000
 state.candidateSince=consistent?state.candidateSince:now;state.candidateEta=eta
 const ready=now-state.candidateSince!>=15000
 if(ready)state={...state,pending:false,appliedAt:now,candidateSince:undefined,candidateEta:undefined}
 return {state,ready}
}
