import {FEEDERS,delayLabel,validateEdits,wakeInterval,effectiveConfig,type EngineSnapshot,type EngineFlight,type FlightEdit,type EngineConfig} from './maestro-engine'
import {distanceNm,STAR_PROFILES,STAR_RUNWAYS,starTravelSeconds} from './maestro-star-prediction'
import {recoveryIafOptions,type RecoveryEntry} from './maestro-recovery'

export {COORDINATION_MESSAGES,type CoordinationMessage} from './maestro-coordination'
export function instructionColor(seconds:number){return seconds<0?'#29ff28':seconds<=150?'#f0e129':'#e11919'}
export function signedDuration(seconds:number){if(!Number.isFinite(seconds))return '—';const n=Math.round(Math.abs(seconds));return `${seconds<0?'-':seconds>0?'+':''}${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`}
export function zulu(time:number|undefined){return Number.isFinite(time)?new Date(time!).toISOString().slice(11,19):'—'}
export function manualTransferSeconds(config:EngineConfig,runway:string,feeder:string,wake:string,aircraft:string){
 if(config.timingModel==='euroscope-buffer')return (config.defaultFeederMinutes??15)*60
 const profile=STAR_PROFILES.find(p=>p.runway===runway.split('/')[1]&&p.feeder===feeder&&p.kind==='star'),distance=profile?.[config.starDistanceMethod??'vectors']
 return distance?starTravelSeconds(distance,config.starEntryAltitude??18000,STAR_RUNWAYS[runway.split('/')[1]]?.heading??0,config,0,wake,aircraft):(config.defaultFeederMinutes??15)*60
}
function copyEdits(edits:Record<string,FlightEdit>):Record<string,FlightEdit>{return Object.fromEntries(Object.entries(edits).map(([key,value])=>[key,{...value}]))}
function available(f:EngineFlight){return (f.landingEtaAvailable!==false||f.recoveryManualSlot)&&f.mode==='sequenced'&&f.state!==4&&!f.lost&&!f.issue}
export function reinsertRecoveryEdits(snapshot:EngineSnapshot,config:EngineConfig,edits:Record<string,FlightEdit>,callsign:string,fix:RecoveryEntry['fix']){
 const f=snapshot.flights.find(f=>f.callsign===callsign)
 if(!f||f.mode==='removed'||f.state===4||f.lost||(!f.missedRecovery&&f.mode!=='missed'&&f.landingEtaAvailable!==false))throw Error('Select a missed approach')
 const runway=(edits[callsign]?.runway??`${f.arrival}/${f.runway}`).split('/')[1]
 if(!recoveryIafOptions(runway).some(p=>p.fix===fix&&p.available))throw Error('No approach profile for this fix and runway')
 if((f.positionAgeSeconds??0)>15||!Number.isFinite(f.latitude)||!Number.isFinite(f.longitude)||f.groundspeed<60)throw Error('Waiting for a fresh aircraft position and speed')
 const stamp=Math.max(snapshot.timestamp+1,(edits[callsign]?.changedAt??0)+1,(edits[callsign]?.recomputeAt??0)+1)
 return validateEdits({...copyEdits(edits),[callsign]:{...edits[callsign],mode:'sequenced',recoveryEntry:{fix,runway,at:stamp},changedAt:stamp,recomputeAt:stamp,target:undefined,order:undefined,orderGroup:undefined,swapAt:undefined,requeueAt:undefined,landedAt:undefined,closurePosition:undefined,etaFfOverride:undefined}})
}
export function dragTargetTime(snapshot:EngineSnapshot,callsign:string,time:number,view='Runway',config?:EngineConfig){
 const f=snapshot.flights.find(f=>f.callsign===callsign);if(!f||!available(f))throw Error('Select an available arrival')
 if(!Number.isFinite(time))throw Error('Choose a valid time')
 const requested=view==='Runway'?time:f.sta+time-f.staFf
 // A reservation with no live flight has no physical arrival estimate to
 // restore. A later matching flight plan resumes the ordinary live policy.
 const manual=config?.manualFlights?.some(p=>p.callsign===callsign)&&!snapshot.observedCallsigns?.includes(callsign)
 const original=f.originalAssignedSta??f.initialSta??f.sta
 return Math.max(snapshot.timestamp+1000,manual?requested:Math.min(original,requested))
}
export function gainDragEdits(snapshot:EngineSnapshot,edits:Record<string,FlightEdit>,callsign:string,time:number,view='Runway',config?:EngineConfig){
 const f=snapshot.flights.find(f=>f.callsign===callsign);if(!f||!available(f))throw Error('Select an available arrival')
 const target=dragTargetTime(snapshot,callsign,time,view,config)
 const queue=snapshot.flights.filter(p=>available(p)&&p.runway===f.runway&&p.callsign!==callsign).sort((a,b)=>a.order-b.order)
 const index=queue.findIndex(p=>p.sta>target);queue.splice(index<0?queue.length:index,0,f)
 const next=copyEdits(edits),stamp=Math.max(snapshot.timestamp+1,...queue.map(p=>(edits[p.callsign]?.releaseDelayAt??0)+1)),group=`${stamp}-${Math.random().toString(36).slice(2,10)}`
 queue.forEach((p,order)=>{next[p.callsign]={...next[p.callsign],order,orderExplicit:p.callsign===callsign?true:next[p.callsign]?.orderExplicit??false,sequenceEditVersion:2,orderGroup:group,changedAt:stamp,targetKind:p.callsign===callsign?'time':next[p.callsign]?.targetKind}})
 next[callsign]={...next[callsign],target,targetKind:'time',swapAt:undefined}
 if(target<f.sta-1000){
  // Release only removable work behind this deliberate advance. A swapped
  // slot is movable; a separately requested time or Frozen arrival is a stop.
  for(const follower of queue.slice(queue.indexOf(f)+1)){
   const edit=next[follower.callsign]
   if(follower.state>=3||edit.target!==undefined&&!edit.swapAt||follower.delay<=0)break
   next[follower.callsign]={...edit,target:undefined,targetKind:'sequence',swapAt:undefined,releaseDelayAt:stamp}
  }
 }
 return validateEdits(next)
}
export function swapFlightEdits(snapshot:EngineSnapshot,edits:Record<string,FlightEdit>,callsign:string,other:string,view='Runway'){
 const a=snapshot.flights.find(f=>f.callsign===callsign),b=snapshot.flights.find(f=>f.callsign===other)
 if(!a||!b||a===b||!available(a)||!available(b)||a.arrival!==b.arrival||a.runway!==b.runway||(view!=='Runway'&&a.ff!==b.ff))throw Error('Select two available arrivals in the same sequence')
 const next=copyEdits(edits),stamp=Math.max(snapshot.timestamp+1,(edits[callsign]?.changedAt??0)+1,(edits[other]?.changedAt??0)+1),group=`${stamp}-${Math.random().toString(36).slice(2,10)}`
 for(const [flight,slot] of [[a,b],[b,a]]){
  const own=next[flight.callsign],manual=own?.target!==undefined&&!own.swapAt&&own.targetKind==='time'
  next[flight.callsign]={...own,order:slot.order,orderExplicit:true,sequenceEditVersion:2,sequenceAt:stamp,target:manual?own.target:undefined,targetKind:manual?'time':'sequence',orderGroup:group,changedAt:stamp,recomputeAt:stamp,closurePosition:undefined,swapAt:undefined}
 }
 return validateEdits(next)
}
export function insertRelative(snapshot:EngineSnapshot,edits:Record<string,FlightEdit>,callsign:string,anchor:string,side:'before'|'after'){
 const f=snapshot.flights.find(p=>p.callsign===callsign),a=snapshot.flights.find(p=>p.callsign===anchor)
 if(!f||!a||callsign===anchor||a.state===4||a.mode!=='sequenced')throw Error('Select an arrival and a different sequence aircraft')
 const queue=snapshot.flights.filter(p=>available(p)&&p.runway===a.runway&&p.callsign!==callsign).sort((a,b)=>a.order-b.order)
 const index=queue.findIndex(p=>p.callsign===anchor);if(index<0)throw Error('The insertion aircraft is no longer available')
 queue.splice(index+(side==='after'?1:0),0,f)
 const next=copyEdits(edits),stamp=snapshot.timestamp+1,group=`${stamp}-${Math.random().toString(36).slice(2,10)}`
 queue.forEach((p,order)=>{next[p.callsign]={...next[p.callsign],order,orderExplicit:p.callsign===callsign?true:next[p.callsign]?.orderExplicit??false,sequenceEditVersion:2,orderGroup:group,changedAt:stamp}})
 next[callsign]={...next[callsign],mode:'sequenced',runway:`ESSA/${a.runway}`,target:undefined,targetKind:'sequence',landedAt:undefined,requeueAt:undefined,recomputeAt:stamp}
 return validateEdits(next)
}
export function extraFlightEdits(snapshot:EngineSnapshot,config:EngineConfig,edits:Record<string,FlightEdit>,callsign:string){
 const f=snapshot.flights.find(p=>p.callsign===callsign);if(!f||!available(f))throw Error('Select an available arrival')
 const following=snapshot.flights.filter(p=>available(p)&&p.runway===f.runway&&p.order>f.order).sort((a,b)=>a.order-b.order)[0]
 if(following)return insertRelative(snapshot,edits,callsign,following.callsign,'after')
 const c=effectiveConfig(config,f.sta),stamp=snapshot.timestamp+1
 const target=Math.max(snapshot.timestamp+1000,f.sta+Math.max(c.rates[`ESSA/${f.runway}`],wakeInterval(f.wake,f.wake,`ESSA/${f.runway}`,c))*1000)
 return validateEdits({...copyEdits(edits),[callsign]:{...edits[callsign],mode:'sequenced',order:f.order,target,targetKind:'time',requeueAt:stamp,recomputeAt:stamp,changedAt:stamp}})
}
export function maximumDelayEdits(snapshot:EngineSnapshot,config:EngineConfig,edits:Record<string,FlightEdit>,callsign:string,minutes:number|undefined){
 const next=copyEdits(edits),f=snapshot.flights.find(p=>p.callsign===callsign);if(!f)throw Error('Aircraft is no longer available')
 next[callsign]={...next[callsign],maximumDelayMinutes:minutes,changedAt:snapshot.timestamp+1}
 if(minutes===undefined)return next
 next[callsign]={...next[callsign],recomputeAt:snapshot.timestamp+1,target:undefined,targetKind:'sequence'}
 const queue=snapshot.flights.filter(p=>available(p)&&p.runway===f.runway&&p.callsign!==callsign).sort((a,b)=>a.order-b.order)
 const original=queue.filter(p=>p.order<f.order).length
 for(let i=original;i>=0;i--){
  const prior=queue[i-1],following=queue[i],c=effectiveConfig(config,Math.max(f.eta,f.runwayAvailableFrom??0))
  // Preserve the physical feeder order; a priority limit cannot make an overtaking possible.
  if(!f.passedFeeder&&following&&following.ff===f.ff&&(following.passedFeeder||following.etaFf<f.etaFf))continue
  let target=Math.max(f.eta,f.runwayAvailableFrom??0,prior?prior.sta+(Math.max(c.rates[`ESSA/${f.runway}`],wakeInterval(prior.wake,f.wake,`ESSA/${f.runway}`,c))+(prior.slotAfter+f.slotBefore)*60)*1000:-Infinity)
  for(const slot of c.slots.filter(s=>s.runway===`ESSA/${f.runway}`).sort((a,b)=>a.begin-b.begin))if(target>=slot.begin&&target<slot.end)target=slot.end
  if(target-f.eta>minutes*60000)continue
  let last=f,time=target,conflict=false
  for(const p of queue.slice(i)){
   time=Math.max(p.sta,time+(Math.max(c.rates[`ESSA/${f.runway}`],wakeInterval(last.wake,p.wake,`ESSA/${f.runway}`,c))+(last.slotAfter+p.slotBefore)*60)*1000)
   for(const slot of c.slots.filter(s=>s.runway===`ESSA/${f.runway}`).sort((a,b)=>a.begin-b.begin))if(time>=slot.begin&&time<slot.end)time=slot.end
   const limit=edits[p.callsign]?.maximumDelayMinutes
   if(limit!==undefined&&Math.round((time-p.eta)/1000)>limit*60){conflict=true;break}
   last=p
  }
  if(conflict)continue
  if(following)return insertRelative(snapshot,next,callsign,following.callsign,'before')
  if(prior)return insertRelative(snapshot,next,callsign,prior.callsign,'after')
  break
 }
 return next
}
export function informationRoute(f:EngineFlight,now:number){
 const feederNames=new Set<string>(FEEDERS.filter(group=>group.airport===f.arrival).flatMap(group=>[...group.fixes]))
 // A route first seen without a STAR can contain the entire filed flightplan.
 // Display only the feeder/arrival portion, including after it is retained.
 // Known terminal fixes still support direct and local-TMA arrivals with no feeder.
 const arrivalStart=(points:EngineFlight['route'])=>{
  const feeder=points.findIndex(p=>feederNames.has(p.name))
  return feeder>=0?feeder:points.findIndex(p=>['TEB','BALVI','ERXEC','OBCIV'].includes(p.name)||/^(?:SA\d{2,3}[A-Z0-9]*|(?:CI|FI)(?:01[LR]|19[LR]|08|26))$/.test(p.name))
 }
 const route=f.amanRoute&&arrivalStart(f.amanRoute)>=0?f.amanRoute:f.route,retained=route===f.amanRoute
 const terminal=arrivalStart(route),threshold=route.findIndex(p=>p.name===`SA${f.runway}`)
 const begin=Math.max(terminal,retained?f.amanRoutePassed??0:0)
 let points=terminal<0?[]:route.slice(begin,threshold>=0?threshold+1:undefined)
 if(!retained&&f.passedFeeder&&Number.isInteger(f.calculatedRouteIndex))points=points.filter(p=>f.route.indexOf(p)>(f.calculatedRouteIndex??-1))
 if(!points.some(p=>p.name===f.arrival))points.push({name:f.arrival,seconds:0})
 if(f.landingEtaAvailable===false)return points.map(p=>({name:p.name,time:NaN}))
 if(f.euroscopeBaseline){
  // Route-point observations use distance / current GS, independently of the
  // buffered landing forecast and the protected feeder allocation.
  const at=Number.isFinite(f.lastSeen)?f.lastSeen:now,fresh=now-at<=15000&&(f.positionAgeSeconds??0)<=15
  let prior={latitude:f.latitude,longitude:f.longitude},distance=0,known=fresh&&f.groundspeed>=60&&Number.isFinite(prior.latitude)&&Number.isFinite(prior.longitude)
  const directIndex=f.direct?f.route.findIndex(point=>point.name===f.direct):-1
  const vectoring=(f.assignedHeading??0)>0||f.vectorDetection==='heading'||f.vectorDetection==='off-route'
  return points.map(p=>{
   if(p.name===f.arrival)return {name:p.name,time:f.eta}
   const routeIndex=f.route.findIndex(point=>point.name===p.name),observed=f.route[routeIndex]
   // Retain accepted route names, but do not forecast a return to skipped points.
   // A heading clearance has no known path back to the STAR.
   if(vectoring||!observed||observed.seconds<0||directIndex>=0&&routeIndex<directIndex)return {name:p.name,time:NaN}
   if(known&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)){
    distance+=distanceNm(prior as any,p as any);prior={latitude:p.latitude,longitude:p.longitude}
    const time=at+distance/f.groundspeed*3600000
    return {name:p.name,time:time<=f.eta?time:NaN}
   }
   known=false
   const time=fresh&&Number.isFinite(observed.seconds)?at+observed.seconds*1000:NaN
   return {name:p.name,time:time<=f.eta?time:NaN}
  })
 }
 const first=points[0],initialLeg=f.passedFeeder&&first&&Number.isFinite(f.latitude)&&Number.isFinite(first.latitude)?distanceNm(f as any,first as any):0
 const lengths=[initialLeg];for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i];lengths.push(lengths[i-1]+(Number.isFinite(a.latitude)&&Number.isFinite(b.latitude)?distanceNm(a as any,b as any):0))
 }
 const start=f.passedFeeder?now:f.etaFf,total=lengths.at(-1)??0
 return points.map((p,i)=>{
  const fraction=total>0?lengths[i]/total:i/Math.max(1,points.length-1),samples=f.trajectory?.samples??[]
  const remaining=(f.trajectory?.pathNm??0)*(1-fraction),index=samples.findIndex(sample=>sample.remainingNm<=remaining)
  let elapsed=fraction
  if(index>=0&&f.trajectory!.seconds>0){
   const b=samples[index],a=samples[Math.max(0,index-1)],ratio=a.remainingNm===b.remainingNm?0:(a.remainingNm-remaining)/(a.remainingNm-b.remainingNm)
   elapsed=(a.seconds+(b.seconds-a.seconds)*Math.max(0,Math.min(1,ratio)))/f.trajectory!.seconds
  }
  return {name:p.name,time:p.name===f.arrival?f.eta:start+Math.max(0,f.eta-start)*elapsed}
 })
}
export function instructionText(f:EngineFlight){return `${f.delay<0?'Gain':'Lose'} ${delayLabel(f.delay)||'0'} min (${signedDuration(f.delay)})`}
