import type {EngineSnapshot,Telemetry,TelemetryFlight} from './maestro-engine'

export interface ClearanceContinuity {source:string;since:number}
type Flight=TelemetryFlight&{clearanceContinuity?:ClearanceContinuity}

/** A different source's missing clearance fields are not a new ATC clearance. */
export function retainHandoverClearances(input:Telemetry,previous?:EngineSnapshot):Telemetry {
 if(!previous||input.source==='DEMO'||input.simulation!==previous.simulation)return input
 const prior=new Map(previous.flights.map(f=>[f.callsign,f]))
 return {...input,flights:input.flights.map(p=>{
  const old=prior.get(p.callsign)
  if(!old||old.arrival!==p.arrival||old.departure!==p.departure||input.timestamp-old.lastSeen>15000||old.state===4)return p
  const continuing=old.clearanceContinuity?.source===input.source
  const handover=previous.source!==input.source
  const missing=!p.runway&&!p.star&&!!old.runway&&!!old.star
  if(!(handover||continuing)||!missing||!old.route.length)return p
  const fresh=new Map(p.route.map(q=>[q.name,q]))
  const feeder=old.route.findIndex(q=>['NILUG','ELTOK','VACRA','XILAN'].includes(q.name)),direct=old.route.findIndex(q=>q.name===p.direct)
  // Direct-to-feeder is not a new terminal clearance. Keep its known STAR
  // tail through takeover. A heading or direct beyond the feeder keeps the
  // received route instead; the explicit clearance still drives prediction.
  const changedPath=(p.assignedHeading??0)>0||!!p.direct&&(feeder<0||direct<0||direct>feeder)
  const route=changedPath?p.route:old.route.map(q=>fresh.get(q.name)??{...q,seconds:q.seconds<0?q.seconds:Math.max(-1,q.seconds-(input.timestamp-old.lastSeen)/1000)})
  const continuity=continuing?old.clearanceContinuity!:{source:input.source,since:input.timestamp}
  return {...p,runway:old.euroscopeRunway||old.runway,star:old.star,route,
   threshold:p.threshold??old.threshold,routeProblem:p.routeProblem||'',clearanceContinuity:continuity} as Flight
 })}
}
