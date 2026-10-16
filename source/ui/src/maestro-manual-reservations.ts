import type {EngineConfig,EngineSnapshot,FlightEdit,Telemetry} from './maestro-engine'

type Reservation=NonNullable<EngineConfig['manualFlights']>[number]
export interface ManualRetirement {reservation:Reservation;at:number;reason:'live'|'elapsed'}
const key=(p:Reservation)=>JSON.stringify([p.callsign,p.runway,p.aircraft,p.wake,p.departure??'----',p.feeder,p.eta,p.feederEta??null])
const same=(a:Reservation|undefined,b:Reservation)=>!!a&&key(a)===key(b)

// A placeholder is a reservation, not a second flight. Remember consumption
// in the checkpoint as well as pruning the operational config, so an older
// saved config cannot resurrect it after its live track disappears.
export function manualReservationLifecycle(input:Telemetry,config:EngineConfig,edits:Record<string,FlightEdit>,previous?:EngineSnapshot){
 const live=new Set(input.flights.filter(p=>p.arrival==='ESSA').map(p=>p.callsign))
 const previouslyLive=new Set(previous?.observedCallsigns??[])
 const oldFlights=new Map(previous?.flights.map(p=>[p.callsign,p])??[])
 const active:Reservation[]=[],retired:Record<string,ManualRetirement>={}
 for(const reservation of config.manualFlights??[]){
  const name=reservation.callsign,edit=edits[name]??{},prior=previous?.retiredManualFlights?.[name]
  const reusable=prior&&Number.isFinite(prior.at)&&prior.at<=input.timestamp&&['live','elapsed'].includes(prior.reason)&&same(prior.reservation,reservation)&&(edit.requeueAt??0)<=prior.at
  const newReservation=(edit.requeueAt??0)>(previous?.timestamp??Infinity)||!!prior&&!same(prior.reservation,reservation)
  const previousLive=!newReservation&&previouslyLive.has(name)
  const old=oldFlights.get(name),horizon=Math.max(reservation.eta,edit.target??0,Number.isFinite(old?.sta)?old!.sta:0)
  const reason=live.has(name)||previousLive?'live':input.timestamp>horizon?'elapsed':undefined
  if(reusable)retired[name]=prior
  else if(reason)retired[name]={reservation:{...reservation},at:input.timestamp,reason}
  else active.push(reservation)
 }
 return {active,retired}
}

export function pruneRetiredManualFlights(config:EngineConfig,snapshot:EngineSnapshot){
 const remaining=(config.manualFlights??[]).filter(p=>!same(snapshot.retiredManualFlights?.[p.callsign]?.reservation,p))
 return remaining.length===(config.manualFlights??[]).length?config:{...config,manualFlights:remaining}
}

export function pruneExpiredManualEdits(edits:Record<string,FlightEdit>,snapshot:Pick<EngineSnapshot,'retiredManualFlights'>){
 let next=edits
 for(const [name,retirement] of Object.entries(snapshot.retiredManualFlights??{})){
  if(retirement.reason!=='elapsed'||!edits[name]||(edits[name].changedAt??0)>retirement.at)continue
  if(next===edits)next={...edits}
  delete next[name]
 }
 return next
}
