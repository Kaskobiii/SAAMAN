import {decodeRecording} from './maestro-recording'
import {STAR_FEEDERS,STAR_RUNWAYS,distanceNm} from './maestro-star-prediction'
import {localPosition,finalPosition,headingDifference} from './maestro-geometry'
const finite=(v:any)=>typeof v==='number'&&Number.isFinite(v)
const positioned=(p:any)=>finite(p?.latitude)&&finite(p?.longitude)
const median=(values:number[])=>{const a=[...values].sort((a,b)=>a-b),m=Math.floor(a.length/2);return a.length?a.length%2?a[m]:(a[m-1]+a[m])/2:null}
const bucket=(minutes:number)=>minutes<5?'0-5':minutes<15?'5-15':minutes<30?'15-30':'30+'
type Row={at:number;positionAt:number;p:any;mode?:string}
export interface ForecastReviewRow {callsign:string;captureAt:number;kind:string;method:string;stage:'feeder'|'landing';feeder:string;runway:string;actualRunway?:string;horizonMinutes:number;horizon:string;errorSeconds:number;flags:string[];cleanCalibration:boolean;engine:string}
function remaining(p:any){const route=p.route.filter((q:any)=>q.seconds>=0&&positioned(q));return positioned(p)&&route.length?distanceNm(p,route[0])+route.slice(1).reduce((s:number,q:any,i:number)=>s+distanceNm(route[i],q),0):undefined}
/** Scores recorded forecasts against geometric passages, without rerunning a different predictor. */
export function reviewLiveTiming(recording:any){
 const frames=decodeRecording(recording)
 if(recording.initial?.simulation===true||frames.some(f=>f.input.simulation===true))return {excluded:'simulation',rows:[] as ForecastReviewRow[],groups:[],thresholdPasses:0}
 if(recording.initial?.simulation!==false||frames.some(f=>f.input.simulation!==false))return {excluded:'live-status-unavailable',rows:[] as ForecastReviewRow[],groups:[],thresholdPasses:0}
 const tracks=new Map<string,Row[]>()
 for(const [frameIndex,frame] of frames.entries())for(const p of frame.input.flights){
  const list=tracks.get(p.callsign)??[];if(!tracks.has(p.callsign))tracks.set(p.callsign,list)
  const row={at:frame.input.timestamp,positionAt:frame.input.timestamp-Math.max(0,p.positionAgeSeconds??0)*1000,p,mode:(recording.frames[frameIndex]?.results??[]).find((r:any)=>r.callsign===p.callsign)?.mode}
  if(list.at(-1)?.at===row.at)list[list.length-1]=row;else list.push(row)
 }
 const rows:ForecastReviewRow[]=[],observed:any[]=[]
 const original=(recording.originalTimingCaptures??[]).filter((c:any)=>c.at===c.evidence?.at&&c.evidence?.provenance==='capture-summary').map((c:any)=>({callsign:c.callsign,at:c.at,kind:'initial',baseline:{...c.evidence.accepted,runway:c.evidence.input?.runway,landingMethod:c.evidence.model?.method},evidence:c.evidence,summary:true}))
 const captures=[...recording.timingCaptures??[],...original],seen=new Set<string>()
 for(const [callsign,track] of tracks){
  const thresholds:any[]=[],feeders:any[]=[];let prior:Row|undefined
  for(const row of track){const p=row.p
   if(!positioned(p)||(p.positionAgeSeconds??0)>15){prior=undefined;continue}
   if(prior&&row.positionAt>prior.positionAt&&row.positionAt-prior.positionAt<=15000){
    const a=prior.p,dt=row.positionAt-prior.positionAt
    for(const [runway,defaultGeometry] of Object.entries(STAR_RUNWAYS)){
     const geometry=p.runway===runway&&positioned(p.threshold)&&finite(p.threshold.heading)?p.threshold:defaultGeometry
     const before=finalPosition(a,geometry),after=finalPosition(p,geometry)
     if(before.along>0&&after.along<=0&&Math.abs(before.cross)<.3&&Math.abs(after.cross)<.3&&p.altitude<1000&&a.groundspeed>=60&&p.groundspeed>=40&&finite(p.heading)&&headingDifference(p.heading,geometry.heading)<=20){
      const at=prior.positionAt+dt*before.along/(before.along-after.along)
      if(!thresholds.some(e=>Math.abs(e.at-at)<120000))thresholds.push({at,runway})
     }
    }
    for(const [feeder,fix] of Object.entries(STAR_FEEDERS)){
     const aa=localPosition(a,fix),bb=localPosition(p,fix),dx=bb.x-aa.x,dy=bb.y-aa.y,den=dx*dx+dy*dy,u=den?-(aa.x*dx+aa.y*dy)/den:-1
     if(u>0&&u<1&&Math.hypot(aa.x+u*dx,aa.y+u*dy)<.3)feeders.push({at:prior.positionAt+u*dt,feeder})
    }
   }prior=row
  }
  observed.push(...thresholds.map(t=>({callsign,...t})))
  for(const capture of captures.filter((c:any)=>c.callsign===callsign)){
   const b=capture.baseline;if(!b||!finite(capture.at)||b.at!==undefined&&b.at!==capture.at)continue
   const kind=['initial','recompute','recapture'].includes(capture.kind)?capture.kind:'unknown'
   const key=JSON.stringify([callsign,capture.at,kind]);if(seen.has(key))continue;seen.add(key)
   const exact=track.find(q=>q.at===capture.at),input=capture.evidence?.input??exact?.p
   const runway=String(b.runway??input?.runway??'').split('/').at(-1)??''
   const feeder=String(b.feeder??capture.candidate?.feeder?.name??input?.star?.match(/^(ELTOK|NILUG|XILAN|VACRA)/)?.[0]??input?.route?.find((q:any)=>q.name in STAR_FEEDERS)?.name??'unknown')
   const method=String(b.landingMethod??capture.evidence?.model?.method??'unknown')
   for(const stage of ['feeder','landing'] as const){
    const actual=stage==='landing'?thresholds.find(t=>t.at>capture.at):feeders.find(t=>t.at>capture.at&&t.feeder===feeder),forecast=stage==='landing'?b.eta:b.etaFf
    if(!actual||!finite(forecast))continue
    const flags:string[]=[],between=track.filter(q=>q.at>=capture.at&&q.positionAt<=actual.at+15000)
    if(!input)flags.push('capture-input-unavailable')
    if(capture.at<track[0].at)flags.push('capture-before-recording')
    if(stage==='landing'&&runway!==actual.runway)flags.push('different-landing-runway')
    if(between.some(q=>q.p.runway!==runway))flags.push('runway-change')
    if(between.some(q=>(q.p.assignedHeading??0)>0))flags.push('heading-clearance')
    if(between.some(q=>q.p.topskyHoldingPoint))flags.push('holding')
    if(between.some(q=>q.p.topskyMissedApproach||q.mode==='missed'))flags.push('missed-approach')
    if(between.some(q=>(q.p.positionAgeSeconds??0)>15))flags.push('tracking-interruption')
    if(input?.speedDataValid===false)flags.push('unreliable-capture-speed')
    if(input&&(input.verticalSpeed??0)>500)flags.push('climbing-capture')
    if(input&&input.altitude<1500)flags.push('low-altitude-capture')
    let priorDistance:number|undefined,priorRow:Row|undefined
    for(const q of between){
     const d=remaining(q.p)
     if(priorRow&&priorDistance!==undefined&&d!==undefined&&q.positionAt>priorRow.positionAt&&q.positionAt-priorRow.positionAt<=15000&&Math.abs(d-priorDistance)>distanceNm(priorRow.p,q.p)+5){flags.push('route-geometry-change');break}
     priorDistance=d;priorRow=q
    }
    if(new Set(between.map(q=>q.p.direct??'')).size>1)flags.push('direct-change')
    const horizonMinutes=(actual.at-capture.at)/60000
    rows.push({callsign,captureAt:capture.at,kind,method,stage,feeder,runway,actualRunway:stage==='landing'?actual.runway:undefined,horizonMinutes,horizon:bucket(horizonMinutes),errorSeconds:(forecast-actual.at)/1000,flags:[...new Set(flags)],cleanCalibration:flags.length===0&&kind!=='unknown',engine:String(capture.evidence?.engine??recording.engine??'unknown')})
   }
  }
 }
 const groups=new Map<string,ForecastReviewRow[]>()
 for(const r of rows){const key=JSON.stringify([r.engine,r.kind,r.stage,r.feeder,r.runway,r.method,r.horizon]);groups.set(key,[...groups.get(key)??[],r])}
 const summaries=[...groups.values()].map(group=>{
  const unique=new Map<string,ForecastReviewRow>();for(const r of [...group].sort((a,b)=>a.captureAt-b.captureAt))if(!unique.has(r.callsign))unique.set(r.callsign,r)
  const selected=[...unique.values()],clean=selected.filter(r=>r.cleanCalibration)
  const stats=(items:ForecastReviewRow[])=>({aircraft:items.length,medianErrorSeconds:median(items.map(r=>r.errorSeconds)),medianAbsoluteErrorSeconds:median(items.map(r=>Math.abs(r.errorSeconds))),within60:items.filter(r=>Math.abs(r.errorSeconds)<=60).length})
  const r=group[0];return {engine:r.engine,kind:r.kind,stage:r.stage,feeder:r.feeder,runway:r.runway,method:r.method,horizon:r.horizon,observed:stats(selected),cleanCalibration:stats(clean)}
 })
 return {excluded:undefined,scope:'Recorded forecasts and position-interpolated passages, not confirmed touchdown or a new-engine benchmark. Positive error means forecast later than passage. Each group uses one earliest capture per aircraft; changed routes and clearances are flagged, not treated as pure model error.',engine:recording.engine,thresholdPasses:observed.length,observedThresholds:observed,unavailableCaptures:recording.unavailableCaptures?.length??0,rows,groups:summaries}
}
