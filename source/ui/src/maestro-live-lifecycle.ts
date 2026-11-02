import type {EngineSnapshot,FlightEdit,Telemetry,TelemetryFlight} from './maestro-engine'

export interface LiveEditRetirement {before:number;targetBefore?:number;at:number}
const allowance=30*60*1000
const editTime=(e:FlightEdit)=>Math.max(0,...[e.changedAt,e.sequenceAt,e.recomputeAt,e.refreshDelayAt,e.releaseDelayAt,e.requeueAt,e.swapAt,e.landedAt].filter((v):v is number=>Number.isFinite(v)))
const identity=(a:TelemetryFlight,b:TelemetryFlight)=>a.arrival===b.arrival&&(!a.departure||a.departure==='----'||!b.departure||b.departure==='----'||a.departure===b.departure)

/** A callsign is reusable. Old approach edits cannot identify a later flight. */
export function liveFlightLifecycle(input:Telemetry,edits:Record<string,FlightEdit>,previous?:EngineSnapshot){
 if(input.source==='DEMO'||input.simulation)return {edits,previous,retired:previous?.retiredLiveEdits}
 edits=pruneRetiredLiveEdits(edits,previous??{})
 const reset=new Set<string>(),retired:Record<string,LiveEditRetirement>={...previous?.retiredLiveEdits}
 const prior=new Map([...(Object.values(previous?.transientFlights??{})),...(previous?.flights??[])].map(f=>[f.callsign,f]))
 for(const p of input.flights){
  const old=prior.get(p.callsign)
  const newFlight=!!old&&(!identity(old,p)||input.timestamp-old.lastSeen>30*60*1000)
  if(newFlight)reset.add(p.callsign)
  const firstSeen=newFlight?input.timestamp:old?.firstSeen??input.timestamp
  const e=edits[p.callsign],at=e?editTime(e):0
  // The generous age allowance is only applied at the start of this flight,
  // never to the duration of a continuously observed flight or a short reconnect.
  const before=firstSeen-allowance
  const targetBefore=firstSeen-60000
  if(e&&(at>0&&at<before||e.target!==undefined&&e.target<targetBefore)){
   retired[p.callsign]={before,targetBefore,at:input.timestamp};reset.add(p.callsign)
  }
  else if(newFlight&&e&&at>0&&at<=old!.lastSeen)
   retired[p.callsign]={before:old!.lastSeen,at:input.timestamp}
 }
 const clean=pruneRetiredLiveEdits(edits,{retiredLiveEdits:retired})
 const filtered=previous&&reset.size?{...previous,
  flights:previous.flights.filter(f=>!reset.has(f.callsign)),
  transientFlights:Object.fromEntries(Object.entries(previous.transientFlights??{}).filter(([name])=>!reset.has(name))),
  grounded:Object.fromEntries(Object.entries(previous.grounded??{}).filter(([name])=>!reset.has(name))),
  feederPassages:Object.fromEntries(Object.entries(previous.feederPassages??{}).filter(([name])=>!reset.has(name)))
 }:previous
 const bounded=Object.fromEntries(Object.entries(retired).sort((a,b)=>b[1].at-a[1].at).slice(0,500))
 return {edits:clean,previous:filtered,retired:Object.keys(bounded).length?bounded:undefined}
}

export function pruneRetiredLiveEdits(edits:Record<string,FlightEdit>,snapshot:{retiredLiveEdits?:Record<string,LiveEditRetirement>}){
 let next=edits
 for(const [name,r] of Object.entries(snapshot.retiredLiveEdits??{})){
  const e=edits[name]
  if(!e)continue
  if(editTime(e)>r.before){
   if(e.target===undefined||e.target>=(r.targetBefore??r.before))continue
   if(next===edits)next={...edits}
   const {target,targetKind,...current}=e
   next[name]=current
   continue
  }
  if(next===edits)next={...edits}
  delete next[name]
 }
 return next
}
