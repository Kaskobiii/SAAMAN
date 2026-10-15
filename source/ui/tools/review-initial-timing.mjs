import {readFileSync} from 'node:fs'
import {decodeRecording} from '../src/maestro-recording.ts'
import {predictRouteTiming} from '../src/maestro-route-timing.ts'
import {phaseReferenceLookup} from '../src/maestro-phase-references.ts'
import {predictLanding} from '../src/maestro-landing-prediction.ts'
import {euroscopeFeederBufferMinutes} from '../src/maestro-engine.ts'
import {STAR_RUNWAYS} from '../src/maestro-star-prediction.ts'
import {localPosition,finalPosition,headingDifference} from '../src/maestro-geometry.ts'
const args=process.argv.slice(2),ignored=new Set(),files=[]
let references,referenceFile
for(let i=0;i<args.length;i++){
 if(args[i]==='--ignore'){if(!args[i+1])throw Error('--ignore requires a callsign');ignored.add(args[++i]);}
 else if(args[i]==='--profiles'){if(!args[i+1])throw Error('--profiles requires a file');referenceFile=args[++i];references=phaseReferenceLookup(JSON.parse(readFileSync(referenceFile,'utf8')));}
 else if(args[i].startsWith('--'))throw Error('Unknown argument '+args[i])
 else files.push(args[i])
}
if(!files.length)throw Error('Usage: npm run replay:timing -- <recording.json> [...] [--ignore FIN521]')
const positioned=p=>Number.isFinite(p?.latitude)&&Number.isFinite(p?.longitude)&&(p.positionAgeSeconds??0)<=15
const reports=[]
for(const file of files){
 const recording=JSON.parse(readFileSync(file,'utf8')),frames=decodeRecording(recording),byCallsign=new Map()
 for(let frame=0;frame<frames.length;frame++)for(const p of frames[frame].input.flights){
  if(ignored.has(p.callsign))continue
  const rows=byCallsign.get(p.callsign)??[];rows.push({frame,f:frames[frame],p});byCallsign.set(p.callsign,rows)
 }
 const observations=[]
 for(const [callsign,rows] of byCallsign){
  const capture=recording.timingCaptures?.find(c=>c.callsign===callsign&&c.kind==='initial')
  let first=capture?rows.find(q=>q.frame===capture.frame&&q.f.input.timestamp===capture.at&&q.f.config&&q.f.input.flights.some(p=>p.callsign===callsign)):undefined
  if(capture&&(!first||capture.at!==capture.baseline?.at||capture.plan!==recording.frames[capture.frame]?.plan))throw Error('Invalid capture index for '+callsign)
  first??=rows.find(q=>q.p.altitude>=350&&q.p.groundspeed>=60)
  if(!first)continue
  const {p,f}=first,c=f.config,base=euroscopeFeederBufferMinutes(p,c),live=predictLanding(p,c,base),candidate=predictRouteTiming(p,c,references)
  const fix=p.route.find(q=>['ELTOK','NILUG','XILAN','VACRA'].includes(q.name)),rawFeeder=fix&&fix.seconds>=0?fix.seconds+base*60:undefined
  let prior,feederCrossing,thresholdCrossing,headingBeforeFeeder=0
  for(const row of rows){
   const q=row.p,t=row.f.input.timestamp-Math.max(0,q.positionAgeSeconds??0)*1000
   if(!positioned(q)){prior=undefined;continue}
   const geometry=q.threshold??STAR_RUNWAYS[q.runway],relative=geometry?finalPosition(q,geometry):undefined
   const toFix=positioned(fix)?localPosition(q,fix):undefined
   if(!feederCrossing&&q.assignedHeading>0)headingBeforeFeeder++
   if(prior&&t>prior.at&&t-prior.at<=15000){
    if(prior.toFix&&toFix){
     const a=prior.toFix,dx=toFix.x-a.x,dy=toFix.y-a.y,den=dx*dx+dy*dy,u=den>0?-(a.x*dx+a.y*dy)/den:0,d=Math.hypot(a.x+u*dx,a.y+u*dy)
     if(u>0&&u<1&&d<.3&&(!feederCrossing||d<feederCrossing.offsetNm))feederCrossing={at:prior.at+u*(t-prior.at),offsetNm:d}
    }
    if(prior.relative&&relative&&prior.runway===q.runway&&prior.relative.along>0&&relative.along<=0&&Math.abs(relative.cross)<.25&&q.altitude<1000&&headingDifference(q.heading??0,geometry.heading)<20)
     thresholdCrossing=prior.at+(t-prior.at)*prior.relative.along/(prior.relative.along-relative.along)
   }
   prior={at:t,toFix,relative,runway:q.runway}
  }
  const stamp=f.input.timestamp,currentLanding=capture?.baseline.eta??stamp+live.seconds*1000,currentFeeder=capture?.baseline.etaFf??(rawFeeder===undefined?undefined:stamp+rawFeeder*1000)
  const landingError=thresholdCrossing?{current:(currentLanding-thresholdCrossing)/1000,candidate:candidate?(stamp+candidate.seconds*1000-thresholdCrossing)/1000:null}:null
  const feederError=feederCrossing&&feederCrossing.at>stamp&&currentFeeder!==undefined?{current:(currentFeeder-feederCrossing.at)/1000,candidate:candidate?.feeder?(stamp+candidate.feeder.seconds*1000-feederCrossing.at)/1000:null}:null
  observations.push({callsign,inputAt:stamp,evidence:capture?'recorded-initial-capture':'first-available-input',rawInputFrame:first.frame,feeder:fix?.name,candidate,
   feederCrossing,thresholdCrossing,feederError,landingError,recordedInterventions:{headingBeforeFeeder,headingSamples:rows.filter(q=>q.p.assignedHeading>0).length,runways:[...new Set(rows.map(q=>q.p.runway))]}})
 }
 reports.push({file,engine:recording.engine,frames:frames.length,unavailableCaptures:recording.unavailableCaptures??[],observations})
}
function score(stage,evidence){
 const rows=reports.flatMap(r=>r.observations).filter(q=>(!evidence||q.evidence===evidence)&&Number.isFinite(q[stage]?.current)&&Number.isFinite(q[stage]?.candidate))
 const mae=key=>rows.length?rows.reduce((s,r)=>s+Math.abs(r[stage][key]),0)/rows.length:null
 return {matched:rows.length,currentMeanAbsoluteErrorSeconds:mae('current'),candidateMeanAbsoluteErrorSeconds:mae('candidate')}
}
console.log(JSON.stringify({scope:'Observed crossings, not counterfactual no-delay arrival times. Later clearances can change the flown path. First available input is not original capture evidence.',referenceFile,ignored:[...ignored],summary:{exactInitial:{feeder:score('feederError','recorded-initial-capture'),landing:score('landingError','recorded-initial-capture')},allAvailableInputs:{feeder:score('feederError'),landing:score('landingError')}},reports},null,2))
