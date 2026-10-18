import {test} from 'node:test'
import assert from 'node:assert/strict'
import {runEngine,toJuhaSequence,toTopSkySequence,euroscopeInstruction} from '../src/maestro-engine.ts'
import {predictLanding} from '../src/maestro-landing-prediction.ts'
import {usableRecoveryApproach} from '../src/maestro-recovery.ts'
import {informationRoute} from '../src/maestro-operations.ts'
import fixture from './fixtures/live-go-around-refresh.json' with {type:'json'}
const calls=['SAS77A','THY708'],get=(s,c)=>s.flights.find(f=>f.callsign===c)
const evaluate=(input,c,edits,previous)=>runEngine(structuredClone(input),structuredClone(c),structuredClone(edits),{...structuredClone(previous),timestamp:input.timestamp-1})
for(const f of fixture.cases)test(`live go-around frame ${f.frame}: Refresh cannot turn an unavailable approach ETA into lose/gain`,()=>{
 const original=structuredClone(f),s=evaluate(f.input,f.config,f.edits,f.previous)
 for(const c of calls.filter(c=>get(f.previous,c).missedRecovery)){const p=get(s,c),old=get(f.previous,c)
  assert.equal(p.landingEtaAvailable,false);assert.equal(p.missedRecovery,true);assert.equal(p.delay,0);assert.equal(p.runwayDelay,0);assert.equal(p.spacingActive,false)
  assert.equal(p.sta,old.sta,'an unavailable Recompute must not allocate a new landing slot')
  assert.equal(p.euroscopeBaseline?.at,old.euroscopeBaseline?.at,'do not capture the obsolete airport/threshold EET')
  assert.equal(p.liveBufferedEta,undefined);assert.equal(euroscopeInstruction(p),0);assert.equal(p.tmaAssignment,undefined)
  assert.ok(informationRoute(p,s.timestamp).every(p=>Number.isNaN(p.time)))
  assert.ok(!toJuhaSequence(s,f.config,f.edits).sequence.some(p=>p.callsign===c));assert.ok(!toTopSkySequence(s,f.config,f.edits).sequence.some(p=>p.callsign===c))
 }
 assert.deepEqual(f,original)
})

test('repeated Refresh and Recompute during an outbound go-around neither recapture nor ratchet slots, including after checkpoint reload',()=>{
 const f=fixture.cases[1],input=structuredClone(f.input),edits=structuredClone(f.edits)
 let current=evaluate(input,f.config,edits,{...f.previous,flights:f.previous.flights.map(p=>calls.includes(p.callsign)?{...p,missedRecovery:true}:p)})
 const held=calls.map(c=>[c,get(current,c).sta,get(current,c).euroscopeBaseline.at])
 for(let i=1;i<=6;i++){
  input.timestamp+=2000
  for(const c of calls)edits[c]={...edits[c],refreshDelayAt:input.timestamp,recomputeAt:input.timestamp,changedAt:input.timestamp,target:undefined,order:undefined}
  current=evaluate(input,f.config,edits,JSON.parse(JSON.stringify(current)))
  assert.deepEqual(calls.map(c=>[c,get(current,c).sta,get(current,c).euroscopeBaseline.at]),held)
  assert.ok(calls.every(c=>get(current,c).delay===0&&get(current,c).landingEtaAvailable===false))
 }
})

function finalFlight(p,along=3){const threshold=p.threshold??fixture.cases[1].input.runways['ESSA/01R'],h=threshold.heading*Math.PI/180
 return {...p,threshold,latitude:threshold.latitude-along*Math.cos(h)/60,longitude:threshold.longitude-along*Math.sin(h)/(60*Math.cos(threshold.latitude*Math.PI/180)),heading:threshold.heading,assignedHeading:0,direct:'',groundspeed:160,altitude:900,verticalSpeed:-600,positionAgeSeconds:0,landingSeconds:90,calculatedRouteIndex:0,route:[{name:'SA01R',seconds:90,latitude:threshold.latitude,longitude:threshold.longitude}]}
}

test('a genuine new final automatically replaces the old approach baseline and can freeze normally',()=>{
 const f=fixture.cases[1],waiting=evaluate(f.input,f.config,f.edits,f.previous),input=structuredClone(f.input)
 input.timestamp+=60000;input.flights=input.flights.map(p=>p.callsign==='SAS77A'?finalFlight(p):p)
 const next=evaluate(input,f.config,f.edits,waiting),p=get(next,'SAS77A')
 assert.equal(p.landingEtaAvailable,true);assert.equal(p.missedRecovery,false);assert.equal(p.landingPrediction.method,'final-position');assert.equal(p.state,3)
 assert.equal(p.euroscopeBaseline.at,input.timestamp);assert.ok(p.sta>=input.timestamp)
 assert.notEqual(p.sta,get(waiting,'SAS77A').sta)
 assert.ok(toJuhaSequence(next,f.config,f.edits).sequence.some(p=>p.callsign==='SAS77A'))
 const again=evaluate({...input,timestamp:input.timestamp+2000},f.config,f.edits,JSON.parse(JSON.stringify(next)))
 assert.equal(get(again,'SAS77A').missedRecovery,false);assert.equal(get(again,'SAS77A').landingEtaAvailable,true)
})

test('an obsolete positive route EET, climbing, stale data and an outbound heading cannot prove a new approach',()=>{
 const f=fixture.cases[1],raw=f.input.flights.find(p=>p.callsign==='SAS77A'),good=finalFlight(raw)
 for(const p of [raw,{...good,verticalSpeed:1000},{...good,positionAgeSeconds:16},{...good,heading:(good.heading+180)%360,assignedHeading:180,landingSeconds:900}]){
  const prediction=predictLanding(p,f.config,1,undefined,f.input.timestamp)
  assert.equal(usableRecoveryApproach(p,prediction),false)
 }
 assert.equal(usableRecoveryApproach(good,predictLanding(good,f.config,1,undefined,f.input.timestamp)),true)
})

test('valid landing traffic still receives ordinary Refresh delay and genuine post-recovery spacing delay',()=>{
 const f=fixture.cases[1],waiting=evaluate(f.input,f.config,f.edits,f.previous),input=structuredClone(f.input)
 input.timestamp+=60000
 const base=input.flights.find(p=>p.callsign==='SAS77A'),returning=finalFlight(base),leader={...finalFlight(base,2),callsign:'LEAD',altitude:600,landingSeconds:45}
 input.flights=[returning,leader]
 const next=evaluate(input,f.config,f.edits,waiting),p=get(next,'SAS77A'),a=get(next,'LEAD')
 assert.equal(p.landingEtaAvailable,true);assert.equal(p.missedRecovery,false)
 assert.ok(p.sta>=a.sta+96000-1);assert.ok(p.delay>0,'real spacing work after a valid approach must not be blanket-zeroed')
 const stamp=input.timestamp+2000,edits={...f.edits,SAS77A:{...f.edits.SAS77A,refreshDelayAt:stamp,changedAt:stamp}}
 const refreshed=evaluate({...input,timestamp:stamp},f.config,edits,next),v=get(refreshed,'SAS77A')
 assert.equal(v.delay,Math.round((v.sta-v.liveBufferedEta)/1000))
})


test('the complete live recording retains both go-arounds in recovery instead of accepting an obsolete positive EET',()=>{
 let current=structuredClone(fixture.initial)
 for(const frame of fixture.trace){
  current=evaluate(frame.input,frame.config,frame.edits,current)
  for(const c of calls){const p=get(current,c)
   assert.equal(p.missedRecovery,true,c);assert.equal(p.landingEtaAvailable,false,c);assert.equal(p.delay,0,c);assert.equal(p.spacingActive,false,c)
   assert.ok(!toJuhaSequence(current,frame.config,frame.edits).sequence.some(p=>p.callsign===c))
  }
 }
})

test('a fresh routed inbound approach restores forecasting before the short final',()=>{
 const f=fixture.cases[1],waiting=evaluate(f.input,f.config,f.edits,f.previous),input=structuredClone(f.input)
 input.timestamp+=60000
 input.flights=input.flights.map(p=>p.callsign==='SAS77A'?{...finalFlight(p,12),altitude:3000,groundspeed:210,landingSeconds:300,route:finalFlight(p,12).route.map(q=>({...q,seconds:300}))}:p)
 const next=evaluate(input,f.config,f.edits,waiting),p=get(next,'SAS77A')
 assert.equal(p.landingEtaAvailable,true);assert.equal(p.missedRecovery,false);assert.equal(p.landingPrediction.method,'aircraft-profile');assert.equal(p.euroscopeBaseline.at,input.timestamp)
})

test('a fresh climb out of a known low final invalidates the old approach without a TopSky missed flag',()=>{
 const f=fixture.cases[1],input=structuredClone(f.input),raw=input.flights.find(p=>p.callsign==='SAS77A')
 const seed=structuredClone(f.previous);get(seed,'SAS77A').missedRecovery=false;seed.grounded={}
 input.flights=[finalFlight(raw,1)];const old=evaluate(input,f.config,{},seed),previous=get(old,'SAS77A')
 assert.equal(previous.landingPrediction.establishedFinal,true)
 input.timestamp+=5000;input.flights=[{...finalFlight(raw,-1),altitude:1200,verticalSpeed:1500,heading:90}]
 const next=evaluate(input,f.config,{},old),p=get(next,'SAS77A')
 assert.equal(p.missedRecovery,true);assert.equal(p.landingEtaAvailable,false);assert.equal(p.delay,0)
})



test('a controller can deliberately reserve a new go-around slot without manufacturing a landing ETA or TTL',()=>{
 const f=fixture.cases[1],waiting=evaluate(f.input,f.config,f.edits,f.previous),input=structuredClone(f.input)
 input.timestamp+=2000;const stamp=input.timestamp+1,target=input.timestamp+15*60000
 const edits={...f.edits,SAS77A:{...f.edits.SAS77A,mode:'sequenced',runway:'ESSA/01R',target,targetKind:'time',order:undefined,requeueAt:stamp,recomputeAt:stamp,changedAt:stamp}}
 const next=evaluate(input,f.config,edits,waiting),p=get(next,'SAS77A')
 assert.equal(p.recoveryManualSlot,true);assert.equal(p.landingEtaAvailable,false);assert.equal(p.delay,0);assert.ok(p.sta>=target);assert.equal(p.spacingActive,true);assert.equal(p.liveBufferedEta,undefined)
 assert.equal(euroscopeInstruction(p),0);assert.ok(!toJuhaSequence(next,f.config,edits).sequence.some(f=>f.callsign==='SAS77A'))
 const again=evaluate({...input,timestamp:input.timestamp+2000},f.config,edits,JSON.parse(JSON.stringify(next)))
 assert.equal(get(again,'SAS77A').recoveryManualSlot,true);assert.equal(get(again,'SAS77A').sta,p.sta);assert.equal(get(again,'SAS77A').delay,0)
})

test('touchdown on the departure runway is detected even when EuroScope retains the arrival-runway assignment',()=>{
 const f=fixture.cases[1],c=structuredClone(f.config),input=structuredClone(f.input)
 c.active=['ESSA/01R'];c.departureRunway='ESSA/01L'
 const p=input.flights.find(p=>p.callsign==='SAS72C'),rwy=input.runways['ESSA/01L']
 assert.ok(rwy)
 const h=rwy.heading*Math.PI/180
 input.flights=[{...p,runway:'01R',heading:rwy.heading,latitude:rwy.latitude+.5*Math.cos(h)/60,longitude:rwy.longitude+.5*Math.sin(h)/(60*Math.cos(rwy.latitude*Math.PI/180)),altitude:140,groundspeed:130,verticalSpeed:0,positionAgeSeconds:0,landingSeconds:0,distanceNm:2}]
 let s=evaluate(input,c,f.edits,f.previous)
 s=evaluate({...input,timestamp:input.timestamp+6000},c,f.edits,s)
 const landed=get(s,'SAS72C');assert.equal(landed.state,4);assert.equal(landed.landingRunway,'ESSA/01L');assert.equal(landed.landingDetection,'surface')
 assert.ok(s.landings.some(l=>l.callsign==='SAS72C'&&l.runway==='ESSA/01L'))
})

test('confirmed rollout after a go-around completes recovery on the actual runway despite the old assignment',()=>{
 const f=fixture.cases[1],waiting=evaluate(f.input,f.config,f.edits,f.previous),input=structuredClone(f.input),rwy=input.runways['ESSA/01L'],h=rwy.heading*Math.PI/180
 const p=input.flights.find(p=>p.callsign==='SAS77A')
 input.timestamp+=60000;input.flights=[{...p,runway:'01R',latitude:rwy.latitude+.5*Math.cos(h)/60,longitude:rwy.longitude+.5*Math.sin(h)/(60*Math.cos(rwy.latitude*Math.PI/180)),heading:rwy.heading,altitude:140,verticalSpeed:0,groundspeed:125,positionAgeSeconds:0,landingSeconds:0}]
 let next=evaluate(input,f.config,f.edits,waiting)
 assert.notEqual(get(next,'SAS77A').state,4,'one low sample is not a confirmed rollout')
 next=evaluate({...input,timestamp:input.timestamp+6000},f.config,f.edits,next)
 const landed=get(next,'SAS77A');assert.equal(landed.state,4);assert.equal(landed.missedRecovery,false);assert.equal(landed.landingEtaAvailable,true);assert.equal(landed.landingRunway,'ESSA/01L')
})
