/** Traffic demand is measured from neutral forecasts, never assigned slots or delay instructions. */
export type TrafficMode='low'|'medium'|'high'
export interface TrafficDemandFlight {
 callsign:string;runway:string;eta:number;wake?:string;valid?:boolean
 /** Neutral runway service interval when no interval callback is supplied. */
 requiredSeconds?:number
}
export interface RunwayTrafficMode {
 mode:TrafficMode;since:number;evaluatedAt:number
 count15:number;count10:number;utilization15:number;utilization10:number
 requiredSeconds15:number;requiredSeconds10:number;lookaheadSeconds?:number;bankStart?:number
 pendingMode?:TrafficMode;pendingSince?:number
}
export interface TrafficModeOptions {
 intervalSeconds?:(leader:TrafficDemandFlight|undefined,follower:TrafficDemandFlight,at:number)=>number
 upConfirmSeconds?:number;downConfirmSeconds?:number
}
export const TRAFFIC_MODE_LOOKAHEAD_SECONDS=1800
export const TRAFFIC_MODE_WINDOW_SECONDS=900
export const TRAFFIC_MODE_BURST_SECONDS=600
export const TRAFFIC_MODE_UP_SECONDS=30
export const TRAFFIC_MODE_DOWN_SECONDS=120
const modes=['low','medium','high'] as const
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)
const round=(v:number)=>Math.round(v*10000)/10000
const duration=(v:unknown,fallback:number)=>finite(v)&&v>=0&&v<=600?v:fallback
function interval(leader:TrafficDemandFlight|undefined,follower:TrafficDemandFlight,options:TrafficModeOptions){
 let value=follower.requiredSeconds??96
 if(options.intervalSeconds){try{value=options.intervalSeconds(leader,follower,follower.eta)}catch{value=follower.requiredSeconds??96}}
 return finite(value)&&value>0&&value<=3600?value:96
}
function demand(flights:TrafficDemandFlight[],options:TrafficModeOptions){
 const costs=flights.map((f,i)=>interval(i?flights[i-1]:undefined,f,options))
 const prefix=[0];for(const cost of costs)prefix.push(prefix.at(-1)!+cost)
 const peak=(seconds:number)=>{
  let required=0,count=0,end=0,bankStart:number|undefined
  for(let start=0;start<flights.length;start++){
   end=Math.max(end,start)
   while(end<flights.length&&flights[end].eta-flights[start].eta<=seconds*1000)end++
   const cost=prefix[end]-prefix[start]-costs[start]+interval(undefined,flights[start],options)
   if(cost>required){required=cost;count=end-start;bankStart=flights[start].eta}
  }
  return {required,count,bankStart}
 }
 // Look ahead thirty minutes so a bank is visible before feeder/TMA phase
 // protection. Classify its busiest 15/10-minute windows, not all 30 minutes.
 const full=peak(TRAFFIC_MODE_WINDOW_SECONDS),burst=peak(TRAFFIC_MODE_BURST_SECONDS)
 return {count15:full.count,count10:burst.count,requiredSeconds15:round(full.required),requiredSeconds10:round(burst.required),
  utilization15:round(full.required/TRAFFIC_MODE_WINDOW_SECONDS),utilization10:round(burst.required/TRAFFIC_MODE_BURST_SECONDS),
  lookaheadSeconds:TRAFFIC_MODE_LOOKAHEAD_SECONDS,bankStart:full.bankStart}
}
function desired(d:ReturnType<typeof demand>,previous?:RunwayTrafficMode):TrafficMode {
 // High is a sustained bank approaching the configured runway/wake capacity.
 // Exit thresholds are lower than entry thresholds to avoid boundary chatter.
 const high=previous?.mode==='high'?
  d.count15>=5&&(d.utilization15>=.70||d.utilization10>=.85):
  d.count15>=5&&(d.utilization15>=.85||d.count10>=5&&d.utilization10>=1)
 if(high)return 'high'
 // A quiet runway has only a small bank and substantial unused capacity.
 if(d.count15<=3&&d.utilization15<=.40&&d.utilization10<=.60)return 'low'
 return 'medium'
}
function usable(previous:RunwayTrafficMode|undefined,now:number){
 if(!previous||!modes.includes(previous.mode)||!finite(previous.since)||!finite(previous.evaluatedAt)||
  previous.since>now||previous.evaluatedAt>now||now-previous.evaluatedAt>60000)return undefined
 return previous
}
/**
 * Per-runway automatic mode with bounded serializable state. Callers must
 * supply a mode-independent ETA, and mark unavailable/lost/missed traffic invalid.
 * Repeated evaluations at the same timestamp do not advance confirmation.
 */
export function updateTrafficModes(forecasts:TrafficDemandFlight[],runways:string[],now:number,previous:Record<string,RunwayTrafficMode>={},options:TrafficModeOptions={}):Record<string,RunwayTrafficMode> {
 if(!finite(now))throw Error('Traffic mode requires a finite telemetry timestamp')
 const byRunway=new Map<string,Map<string,TrafficDemandFlight>>()
 const names=[...new Set(runways.filter(r=>typeof r==='string'&&/^[A-Z0-9]{4}\/(?:0[1-9]|[12][0-9]|3[0-6])[LRC]?$/.test(r)))].slice(0,16)
 for(const name of names)byRunway.set(name,new Map())
 for(const f of forecasts){
  const lane=byRunway.get(f?.runway)
  if(!lane||f.valid===false||typeof f.callsign!=='string'||!f.callsign||f.callsign.length>32||!finite(f.eta)||f.eta<now-30000||f.eta>now+TRAFFIC_MODE_LOOKAHEAD_SECONDS*1000)continue
  // Duplicate telemetry must not create demand. Earliest neutral ETA is the
  // conservative choice if callers provide inconsistent copies of a track.
  const prior=lane.get(f.callsign)
  if(!prior||f.eta<prior.eta)lane.set(f.callsign,{callsign:f.callsign,runway:f.runway,eta:Math.max(now,f.eta),wake:f.wake,requiredSeconds:f.requiredSeconds})
 }
 const output:Record<string,RunwayTrafficMode>={}
 for(const name of names){
  const flights=[...byRunway.get(name)!.values()].sort((a,b)=>a.eta-b.eta||a.callsign.localeCompare(b.callsign))
  const metrics=demand(flights,options),old=usable(previous?.[name],now),candidate=desired(metrics,old)
  let state:RunwayTrafficMode={...metrics,mode:old?.mode??candidate,since:old?.since??now,evaluatedAt:now}
  if(old&&candidate!==old.mode){
   const pendingSince=old.pendingMode===candidate&&finite(old.pendingSince)&&old.pendingSince<=now?old.pendingSince:now
   const wait=modes.indexOf(candidate)>modes.indexOf(old.mode)?duration(options.upConfirmSeconds,TRAFFIC_MODE_UP_SECONDS):duration(options.downConfirmSeconds,TRAFFIC_MODE_DOWN_SECONDS)
   if(now-pendingSince>=wait*1000)state={...state,mode:candidate,since:now}
   else state={...state,pendingMode:candidate,pendingSince}
  }
  output[name]=state
 }
 return output
}
