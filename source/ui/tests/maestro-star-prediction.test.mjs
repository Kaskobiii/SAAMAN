import {test} from 'node:test'
import assert from 'node:assert/strict'
import {STAR_PROFILES,STAR_FEEDERS,STAR_RUNWAYS,STAR_SOURCE,starPrediction,starTravelSeconds,iasToTas,canonicalFeeder,preFeederSeconds} from '../src/maestro-star-prediction.ts'
import {performanceAt,PERFORMANCE_SOURCE,machToTas} from '../src/maestro-aircraft-performance.ts'
import {DEFAULT_CONFIG as RELEASE_DEFAULT_CONFIG,runEngine,reorderEdits,migrateSequenceEdits} from '../src/maestro-engine.ts'
import {bearingBetween} from '../src/maestro-geometry.ts'
import recomputeGap from './fixtures/recompute-arrival-gap.json' with {type:'json'}
const DEFAULT_CONFIG={...RELEASE_DEFAULT_CONFIG,timingModel:'performance'}

const now=Date.UTC(2026,9,10,10)
const config=()=>({...structuredClone(DEFAULT_CONFIG),active:['ESSA/01L'],minimumNewSeconds:0,unstableSeconds:0})
const ff=STAR_FEEDERS.ELTOK,threshold=STAR_RUNWAYS['01L']
const before={latitude:ff.latitude+.3,longitude:ff.longitude-.3}
const point=(name,p,seconds=900)=>({name,...p,seconds})
const flight=(extra={})=>({callsign:'TEST',aircraft:'A320',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'01L',star:'ELTOK8M',route:[point('BEFORE',before),point('ELTOK',ff),point('SA01L',threshold)],landingSeconds:2000,distanceNm:60,groundspeed:400,altitude:18000,...before,...extra})
const packet=(flights,timestamp=now)=>({source:'ESSA_C_APP',timestamp,flights})

test('bulk Recompute fits an earlier Stable arrival ahead of a later unentered Superstable flight',()=>{
 const c={...config(),active:['ESSA/01R'],superStableMinutes:3,frozenMinutes:0}
 c.rates['ESSA/01R']=90
 const input={source:'TEST_APP',...recomputeGap}
 let s=runEngine(input,c,{})
 const ordered=()=>[...s.flights].sort((a,b)=>a.order-b.order)
 assert.deepEqual(ordered().map(f=>f.callsign),['ENTRY','EARLY','LATE'])
 assert.equal(s.flights.find(f=>f.callsign==='EARLY').state,1)
 assert.equal(s.flights.find(f=>f.callsign==='LATE').state,2)
 assert.equal(s.flights.find(f=>f.callsign==='LATE').passedFeeder,false)
 for(let i=1;i<=3;i++){
  const stamp=input.timestamp+i*2000
  const edits=Object.fromEntries(input.flights.map(f=>[f.callsign,{mode:'sequenced',recomputeAt:stamp,changedAt:stamp}]))
  s=runEngine({...input,timestamp:stamp},c,edits,s)
  assert.deepEqual(ordered().map(f=>f.callsign),['ENTRY','EARLY','LATE'])
  assert.equal(s.flights.find(f=>f.callsign==='EARLY').delay,0)
  assert.ok(s.flights.every(f=>!f.spacingConflict))
 }
 // Recompute still publishes actual work when no gap fits before the later flight.
 const stamp=input.timestamp+10000,edits={EARLY:{mode:'sequenced',recomputeAt:stamp,changedAt:stamp,target:s.flights.find(f=>f.callsign==='LATE').eta+60000,targetKind:'time'}}
 s=runEngine({...input,timestamp:stamp},c,edits,s)
 assert.ok(s.flights.find(f=>f.callsign==='EARLY').delay>0)
 assert.ok(s.flights.every(f=>!f.spacingConflict))
})

test('a consumed TEB direct does not send a continuing 01R arrival back through TEB',()=>{
 const route=[point('NILUG',STAR_FEEDERS.NILUG),point('SA630',{latitude:59.0976669444,longitude:18.1520277778}),point('TEB',{latitude:59.5316938889,longitude:18.2033058333}),point('CI01R',{latitude:59.3987388889,longitude:17.8687108333}),point('FI01R',{latitude:59.4314469444,longitude:17.8804277778}),point('SA01R',STAR_RUNWAYS['01R'])]
 const p=flight({runway:'01R',star:'NILUG3M',latitude:59.37892,longitude:17.86195,heading:13,altitude:4337,groundspeed:237,route,direct:'TEB',calculatedRouteIndex:3})
 const c={...config(),active:['ESSA/01R']},ordinary=starPrediction({...p,direct:''},c),consumed=starPrediction(p,c)
 assert.deepEqual(consumed,ordinary)
 assert.equal(consumed.distanceProfile.fullNm,80,'ordinary 01R NILUG Vectors distance remains unchanged')
 const returning=starPrediction({...p,heading:bearingBetween(p,route[2])},c)
 assert.equal(returning.distanceProfile.shortcut,true,'an intentional return direct remains honoured')
 assert.ok(returning.seconds>consumed.seconds+300)
 const upstream={...p,latitude:58.5,longitude:17.6,altitude:24000,groundspeed:410,calculatedRouteIndex:0}
 upstream.heading=bearingBetween(upstream,route[2])
 const ahead=starPrediction(upstream,c)
 assert.equal(ahead.distanceProfile.shortcut,true,'a direct skipping the feeder remains active before it is consumed')
 assert.ok(ahead.seconds<starPrediction({...upstream,direct:''},c).seconds)
})

test('latest workbook contains 24 STARs and eight RNP profiles, with vectors as default',()=>{
 assert.equal(STAR_PROFILES.filter(p=>p.kind==='star').length,24);assert.equal(STAR_PROFILES.filter(p=>p.kind==='rnp').length,8)
 assert.equal(STAR_SOURCE.sha256,'0ad96dafbb4dcf807ae55d2bc320e7eba1768aeb134c4f442df202a4bd73606e')
 assert.equal(STAR_PROFILES.find(p=>p.runway==='19R'&&p.feeder==='ELTOK'&&p.kind==='star').vectors,48)
 assert.equal(DEFAULT_CONFIG.predictionMode,'star');assert.equal(DEFAULT_CONFIG.starDistanceMethod,'vectors')
})
test('49 NM ELTOK vectors distance is used at the feeder, independently of all EuroScope EETs',()=>{
 const p=flight({...ff}),a=starPrediction(p,config()),b=starPrediction({...p,landingSeconds:-999,route:p.route.map(r=>({...r,seconds:99999}))},config())
 assert.equal(a.error,undefined);assert.equal(a.distanceProfile.fullNm,49);assert.equal(a.distanceProfile.remainingNm,49)
 assert.equal(a.distanceProfile.sourceRange,'A3:E3');assert.deepEqual(a,b)
 assert.ok(a.seconds>0);assert.equal(a.trajectory.model,'energy-accounted-kinematic');assert.ok(a.trajectory.samples.length>2)
})

test('zero-speed airborne initialization never creates a queued slow-flight forecast',()=>{
 const c=config(),p=flight({groundspeed:0})
 const waiting=runEngine(packet([p]),c,{})
 assert.match(waiting.flights[0].issue,/Awaiting usable/)
 assert.equal(waiting.flights[0].order,Number.MAX_SAFE_INTEGER)
 assert.equal(waiting.flights[0].delay,0)
 const ready=runEngine(packet([{...p,groundspeed:400}],now+2000),c,{},waiting)
 assert.equal(ready.flights[0].issue,'');assert.equal(ready.flights[0].order,0)
 assert.equal(ready.flights[0].initialEta,ready.flights[0].eta)
})
test('physical position advances the remaining distance without route time changes',()=>{
 const a=starPrediction(flight({...ff}),config()),mid={latitude:(ff.latitude+threshold.latitude)/2,longitude:(ff.longitude+threshold.longitude)/2}
 const b=starPrediction(flight({...mid,altitude:9000}),config())
 assert.ok(b.passedFeeder);assert.ok(b.distanceProfile.remainingNm<a.distanceProfile.remainingNm);assert.ok(b.seconds<a.seconds)
})

test('a FIN1NX-style old sequence target and insertion floor do not delay the first TMA arrival',()=>{
 const c=config();c.frozenMinutes=0;c.rates['ESSA/01L']=85
 const near={latitude:(ff.latitude+threshold.latitude)/2,longitude:(ff.longitude+threshold.longitude)/2}
 const traffic=[flight({...near,altitude:8000,callsign:'FIN1NX'})]
 const first=runEngine(packet(traffic),c,{})
 const saved={...first,flights:first.flights.map(f=>({...f,sta:f.eta+240000,delay:240,minimumArrival:f.eta+300000,tmaTiming:{delay:0,rateSeconds:85,instructionSource:'none'}}))}
 const edits={FIN1NX:{order:0,target:first.flights[0].eta+240000,changedAt:now}}
 const clean=migrateSequenceEdits(edits,saved)
 assert.equal(clean.FIN1NX.target,undefined);assert.equal(clean.FIN1NX.targetKind,'sequence')
 assert.equal(edits.FIN1NX.target,first.flights[0].eta+240000,'migration does not mutate the saved input')
 let fixed=runEngine(packet(traffic,now+1000),c,edits,saved)
 assert.equal(fixed.flights[0].delay,0);assert.equal(fixed.flights[0].order,0)
 for(const offset of [3000,20000,45000])fixed=runEngine(packet(traffic,now+offset),c,edits,fixed)
 assert.equal(fixed.flights[0].delay,0)
 const frozen=runEngine(packet(traffic,now+46000),{...c,frozenMinutes:60},clean,fixed)
 assert.equal(frozen.flights[0].state,3);assert.equal(frozen.flights[0].delay,0)
})

test('removing a stale leading slot also releases its artificial backlog for following aircraft',()=>{
 const c=config();c.frozenMinutes=0;c.rates['ESSA/01L']=85
 const near={latitude:(ff.latitude+threshold.latitude)/2,longitude:(ff.longitude+threshold.longitude)/2}
 const traffic=[flight({...near,altitude:8000,callsign:'FIN1NX'}),flight({...near,altitude:8000,callsign:'FOLLOW'})]
 const first=runEngine(packet(traffic),c,{})
 const saved={...first,flights:first.flights.map(f=>({...f,sta:f.sta+240000,delay:f.delay+240,tmaTiming:{delay:0,rateSeconds:85,instructionSource:'none'}}))}
 const edits=Object.fromEntries(saved.flights.map(f=>[f.callsign,{order:f.order,target:f.sta}]))
 const s=runEngine(packet(traffic,now+1000),c,edits,saved)
 assert.equal(s.flights.find(f=>f.callsign==='FIN1NX').delay,0)
 assert.equal(s.flights.find(f=>f.callsign==='FOLLOW').delay,85,'only the current spacing constraint remains')
 assert.ok(s.flights.every(f=>!f.spacingConflict))
})

test('an explicitly selected manual time is preserved even for the first aircraft',()=>{
 const c=config();c.frozenMinutes=0
 const near={latitude:(ff.latitude+threshold.latitude)/2,longitude:(ff.longitude+threshold.longitude)/2}
 const traffic=[flight({...near,altitude:8000})],first=runEngine(packet(traffic),c,{})
 const edits={TEST:{order:0,target:first.flights[0].eta+240000,targetKind:'time'}}
 const s=runEngine(packet(traffic,now+1000),c,edits,first)
 assert.equal(s.flights[0].sta,edits.TEST.target);assert.equal(s.flights[0].delay,240)
 const oldManual={...first,flights:first.flights.map(f=>({...f,tmaTiming:{delay:240,rateSeconds:85,instructionSource:'manual'}}))}
 assert.equal(migrateSequenceEdits({TEST:{order:0,target:edits.TEST.target}},oldManual).TEST.target,edits.TEST.target)
 const stableManual={...first,flights:first.flights.map(f=>({...f,state:1,tmaTiming:undefined}))}
 assert.equal(migrateSequenceEdits({TEST:{order:0,target:edits.TEST.target}},stableManual).TEST.target,edits.TEST.target,'ambiguous legacy Stable time instructions are retained')
})

test('live order swaps transfer current spacing work and never pin an old automatic slot',()=>{
 const c=config();c.frozenMinutes=0;c.rates['ESSA/01L']=85
 const near={latitude:(ff.latitude+threshold.latitude)/2,longitude:(ff.longitude+threshold.longitude)/2}
 const traffic=[flight({...near,altitude:8000,callsign:'AAA'}),flight({...near,altitude:8000,callsign:'BBB'})]
 const first=runEngine(packet(traffic),c,{})
 const edits=reorderEdits(first,{},'BBB',first.flights.find(f=>f.callsign==='AAA').sta-1,'Runway',c)
 assert.ok(Object.values(edits).every(e=>e.target===undefined&&e.targetKind==='sequence'))
 let s=runEngine(packet(traffic,now+1000),c,edits,first)
 assert.equal(s.flights.find(f=>f.callsign==='BBB').delay,0)
 assert.equal(s.flights.find(f=>f.callsign==='AAA').delay,85)
 s=runEngine(packet(traffic,now+20000),c,edits,s)
 assert.equal(s.flights.find(f=>f.callsign==='BBB').delay,0)
 assert.equal(s.flights.find(f=>f.callsign==='AAA').delay,85)
 const back=reorderEdits(s,edits,'AAA',s.flights.find(f=>f.callsign==='BBB').sta-1,'Runway',c)
 s=runEngine(packet(traffic,now+21000),c,back,s)
 assert.equal(s.flights.find(f=>f.callsign==='AAA').delay,0)
 assert.equal(s.flights.find(f=>f.callsign==='BBB').delay,85)
})

test('a newly detected ordinary TMA arrival has no ten-minute insertion minimum',()=>{
 const c=config();c.minimumNewSeconds=600;c.frozenMinutes=0
 const near={latitude:(ff.latitude+threshold.latitude)/2,longitude:(ff.longitude+threshold.longitude)/2}
 const seed=runEngine(packet([flight({callsign:'KNOWN'})]),c,{})
 const s=runEngine(packet([flight({callsign:'KNOWN'}),flight({...near,altitude:8000,callsign:'TMA'})],now+1000),c,{},seed)
 assert.equal(s.flights.find(f=>f.callsign==='TMA').minimumArrival,now+1000)
 assert.equal(s.flights.find(f=>f.callsign==='TMA').passedFeeder,true)
})

test('an identifiable saved missed-approach minimum is retained over repeated TMA updates',()=>{
 const c=config();c.minimumNewSeconds=300;c.frozenMinutes=0
 const near={latitude:(ff.latitude+threshold.latitude)/2,longitude:(ff.longitude+threshold.longitude)/2}
 const traffic=[flight({...near,altitude:8000})]
 const first=runEngine(packet(traffic),c,{})
 let s={...first,flights:first.flights.map(f=>({...f,firstSeen:now-120000,minimumArrival:now+600000,minimumArrivalSource:undefined,recomputedAt:now}))}
 const edits={TEST:{recomputeAt:now}}
 for(const t of [1000,3000,10000]){
  s=runEngine(packet(traffic,now+t),c,edits,s)
  assert.equal(s.flights[0].minimumArrival,now+600000)
  assert.equal(s.flights[0].minimumArrivalSource,'resume')
 }
})

test('Frozen aircraft with manual order use current rate constraints instead of an old slower rate',()=>{
 const c=config();c.frozenMinutes=60;c.rates['ESSA/01L']=240
 const near={latitude:(ff.latitude+threshold.latitude)/2,longitude:(ff.longitude+threshold.longitude)/2}
 const traffic=[flight({...near,altitude:8000,callsign:'AAA'}),flight({...near,altitude:8000,callsign:'BBB'})]
 const edits={AAA:{order:0,targetKind:'sequence'},BBB:{order:1,targetKind:'sequence'}}
 const first=runEngine(packet(traffic),c,edits)
 assert.equal(first.flights.find(f=>f.callsign==='BBB').delay,240)
 const relaxed=runEngine(packet(traffic,now+1000),{...c,rates:{...c.rates,'ESSA/01L':85}},edits,first)
 assert.equal(relaxed.flights.find(f=>f.callsign==='BBB').delay,85)
 const restored=runEngine(packet(traffic,now+2000),c,edits,relaxed)
 assert.equal(restored.flights.find(f=>f.callsign==='BBB').delay,240)
 assert.equal(restored.flights.find(f=>f.callsign==='AAA').delay,0)
})

test('post-entry order and assigned times stay fixed until Recompute refreshes time only',()=>{
 const c=config();c.frozenMinutes=0;c.rates['ESSA/01L']=85
 const near={latitude:(ff.latitude+threshold.latitude)/2,longitude:(ff.longitude+threshold.longitude)/2}
 const traffic=[flight({...ff,altitude:10000,callsign:'LATER'}),flight({...near,altitude:8000,callsign:'EARLIER'})]
 let s=runEngine(packet(traffic),c,{})
 s=runEngine(packet(traffic,now+1000),c,reorderEdits(s,{},'LATER',s.flights.find(f=>f.callsign==='EARLIER').sta-1,'Runway',c),s)
 const original=s
 const slots=Object.fromEntries(s.flights.map(f=>[f.callsign,f.sta]))
 const ordered=()=>[...s.flights].sort((a,b)=>a.order-b.order).map(f=>f.callsign)
 for(let tick=2;tick<=60;tick++){
  s=runEngine(packet(traffic,now+tick*1000),c,{},s)
  assert.deepEqual(Object.fromEntries(s.flights.map(f=>[f.callsign,f.sta])),slots)
 }
 assert.deepEqual(ordered(),['LATER','EARLIER'])
 const shorter=traffic.map(f=>f.callsign==='LATER'?{...f,...near,altitude:8000}:f)
 s=runEngine(packet(shorter,now+65000),c,{LATER:{recomputeAt:now+65000,changedAt:now+65000}},s)
 assert.deepEqual(ordered(),['LATER','EARLIER'])
 assert.ok(s.flights.find(f=>f.callsign==='LATER').sta<slots.LATER)
 assert.ok(s.flights.every(f=>!f.spacingConflict))
 let manual=original
 const edits={LATER:{order:0,target:original.flights.find(f=>f.callsign==='LATER').eta},EARLIER:{order:1}}
 for(let tick=1;tick<=60;tick++)manual=runEngine(packet(traffic,now+tick*1000),c,edits,manual)
 assert.deepEqual([...manual.flights].sort((a,b)=>a.order-b.order).map(f=>f.callsign),['LATER','EARLIER'])
})

test('entered aircraft cannot overtake each other automatically when their live predictions invert',()=>{
 const c=config();c.frozenMinutes=0;c.rates['ESSA/01L']=85
 const near={latitude:(ff.latitude+threshold.latitude)/2,longitude:(ff.longitude+threshold.longitude)/2}
 const initialTraffic=[flight({...near,altitude:8000,callsign:'AAA'}),flight({...ff,altitude:10000,callsign:'BBB'})]
 let s=runEngine(packet(initialTraffic),c,{})
 s=runEngine(packet(initialTraffic,now+1000),c,{},s)
 const slots=Object.fromEntries(s.flights.map(f=>[f.callsign,f.sta]))
 const reversed=[flight({...ff,altitude:10000,callsign:'AAA'}),flight({...near,altitude:8000,callsign:'BBB'})]
 for(let tick=2;tick<=90;tick++){
  s=runEngine(packet(reversed,now+tick*1000),c,{},s)
  assert.deepEqual([...s.flights].sort((a,b)=>a.order-b.order).map(f=>f.callsign),['AAA','BBB'])
  assert.deepEqual(Object.fromEntries(s.flights.map(f=>[f.callsign,f.sta])),slots)
 }
 assert.ok(s.flights.find(f=>f.callsign==='AAA').eta>s.flights.find(f=>f.callsign==='BBB').eta)
})

test('same-edit controller order is restored through promotion, and Recompute clears the explicit late time',()=>{
 const c=config();c.frozenMinutes=0;c.rates['ESSA/01L']=85
 const midway={latitude:(ff.latitude+threshold.latitude)/2,longitude:(ff.longitude+threshold.longitude)/2}
 const closer={latitude:threshold.latitude+(ff.latitude-threshold.latitude)*.25,longitude:threshold.longitude+(ff.longitude-threshold.longitude)*.25}
 const traffic=[flight({...midway,altitude:8000,callsign:'DLH2WR'}),flight({...closer,altitude:3000,groundspeed:220,callsign:'HUN79Z'})]
 const first=runEngine(packet(traffic),c,{})
 const stamp=now-1000,target=first.flights.find(f=>f.callsign==='HUN79Z').eta+420000
 const edits={HUN79Z:{order:1,target,targetKind:'time',changedAt:stamp},DLH2WR:{order:2,targetKind:'sequence',changedAt:stamp}}
 const saved={...first,flights:first.flights.map(f=>({...f,state:f.callsign==='HUN79Z'?3:1,order:f.callsign==='HUN79Z'?1:0,sta:f.callsign==='HUN79Z'?target:f.sta,
  appliedOrder:edits[f.callsign].order,appliedTarget:edits[f.callsign].target,appliedChangedAt:stamp,tmaAssignment:undefined,guidance:undefined}))}
 let s=runEngine(packet(traffic,now+1000),c,edits,saved)
 assert.deepEqual([...s.flights].sort((a,b)=>a.order-b.order).map(f=>f.callsign),['HUN79Z','DLH2WR'])
 assert.equal(s.flights.find(f=>f.callsign==='HUN79Z').sta,target,'the explicit time remains until a controller releases it')
 const recompute={...edits,HUN79Z:{...edits.HUN79Z,target:undefined,order:0,recomputeAt:now+2000,changedAt:now+2000}}
 s=runEngine(packet(traffic,now+2000),c,recompute,s)
 assert.deepEqual([...s.flights].sort((a,b)=>a.order-b.order).map(f=>f.callsign),['HUN79Z','DLH2WR'])
 assert.equal(s.flights.find(f=>f.callsign==='HUN79Z').delay,0)
 assert.equal(s.flights.find(f=>f.callsign==='DLH2WR').delay,0)
 assert.ok(s.flights.find(f=>f.callsign==='HUN79Z').sta<target)
})

test('a forecast becoming earlier after entry cannot create fresh lose work against the held target',()=>{
 const c=config();c.frozenMinutes=0
 const traffic=[flight({...ff,altitude:10000})]
 let s=runEngine(packet(traffic),c,{})
 s=runEngine(packet(traffic,now+1000),c,{},s)
 const target=s.flights[0].sta
 const closer={latitude:threshold.latitude+(ff.latitude-threshold.latitude)*.25,longitude:threshold.longitude+(ff.longitude-threshold.longitude)*.25}
 for(const t of [2000,10000,20000,40000])s=runEngine(packet([flight({...closer,altitude:3000,groundspeed:220})],now+t),c,{},s)
 assert.equal(s.flights[0].sta,target);assert.equal(s.flights[0].delay,0)
 assert.ok(target-s.flights[0].eta>60000)
})

test('automatic correction never lets an upstream follower overtake its entry leader',()=>{
 const c=config();c.frozenMinutes=0
 const traffic=[flight({...ff,callsign:'ENTRY'}),flight({...before,callsign:'UPSTREAM',groundspeed:480})]
 let s=runEngine(packet(traffic),c,{})
 s={...s,flights:s.flights.map(f=>({...f,state:2,order:f.callsign==='ENTRY'?0:1,planningEta:f.eta+(f.callsign==='ENTRY'?600000:0)}))}
 for(let tick=1;tick<=60;tick++)s=runEngine(packet(traffic,now+tick*1000),c,{},s)
 assert.deepEqual([...s.flights].sort((a,b)=>a.order-b.order).map(f=>f.callsign),['ENTRY','UPSTREAM'])
})

test('a sustained pre-entry inversion can correct a whole eligible block across different feeders',()=>{
 const c=config();c.frozenMinutes=0;c.unstableSeconds=600;c.rates['ESSA/01L']=85
 const distant={latitude:ff.latitude+.8,longitude:ff.longitude-.4},xf=STAR_FEEDERS.XILAN,xpos={latitude:xf.latitude+.1,longitude:xf.longitude+.1}
 const traffic=[flight({...distant,altitude:18000,callsign:'LATER1'}),flight({...distant,altitude:18000,callsign:'LATER2'}),flight({...xpos,altitude:10000,callsign:'EARLIER',star:'XILAN',route:[point('BEFORE',xpos),point('XILAN',xf),point('SA01L',threshold)]})]
 let s=runEngine(packet(traffic),c,{})
 s={...s,flights:s.flights.map((f,i)=>({...f,state:0,passedFeeder:false,order:i}))}
 for(let tick=1;tick<=46;tick++)s=runEngine(packet(traffic,now+tick*1000),c,{},s)
 assert.deepEqual([...s.flights].sort((a,b)=>a.order-b.order).map(f=>f.callsign),['EARLIER','LATER1','LATER2'])
 assert.equal(s.flights.find(f=>f.callsign==='EARLIER').delay,0)
 assert.ok(s.flights.every(f=>!f.spacingConflict))
})

test('Frozen automatic timing releases an obsolete delay while manual targets remain fixed',()=>{
 const c=config();c.frozenMinutes=60;c.rates['ESSA/01L']=85
 const near={latitude:(ff.latitude+threshold.latitude)/2,longitude:(ff.longitude+threshold.longitude)/2}
 const traffic=[flight({...near,altitude:8000})]
 const initial=runEngine(packet(traffic),c,{})
 const saved={...initial,flights:initial.flights.map(f=>({...f,state:3,sta:f.eta+300000,committedSta:f.eta+300000,delay:300,tmaTiming:{delay:300,rateSeconds:85,instructionSource:'constraint'}}))}
 const repaired=runEngine(packet(traffic,now+1000),c,{},saved)
 assert.equal(repaired.flights[0].delay,0)
 assert.equal(repaired.flights[0].sta,repaired.flights[0].planningEta)
 const edits={TEST:{target:saved.flights[0].sta}}
 const manual=runEngine(packet(traffic,now+1000),c,edits,saved)
 assert.equal(manual.flights[0].sta,edits.TEST.target)
})

test('post-entry traffic discards an old pending automatic order-correction timer',()=>{
 const c=config();c.frozenMinutes=0
 const near={latitude:(ff.latitude+threshold.latitude)/2,longitude:(ff.longitude+threshold.longitude)/2}
 const traffic=[flight({...ff,altitude:10000,callsign:'LATER'}),flight({...near,altitude:8000,callsign:'EARLIER'})]
 let s=runEngine(packet(traffic),c,{})
 s={...s,flights:s.flights.map(f=>({...f,state:2,passedFeeder:true,order:f.callsign==='LATER'?0:1,sequenceCorrectionCandidate:f.callsign==='EARLIER'?{leader:'LATER',since:now-40000}:undefined}))}
 const interrupted={...s,flights:s.flights.map(f=>({...f,planningEta:f.callsign==='LATER'?now:now+600000}))}
 s=runEngine(packet(traffic,now+1000),c,{},interrupted)
 assert.equal(s.flights.find(f=>f.callsign==='EARLIER').sequenceCorrectionCandidate,undefined)
 for(let tick=2;tick<=50;tick++)s=runEngine(packet(traffic,now+tick*1000),c,{},s)
 assert.deepEqual([...s.flights].sort((a,b)=>a.order-b.order).map(f=>f.callsign),['LATER','EARLIER'])
})

test('an extracted route starting at the feeder does not mark an upstream aircraft passed',()=>{
 const p=flight({route:[point('ELTOK',ff),point('SA01L',threshold)]})
 const result=starPrediction(p,config())
 assert.equal(result.passedFeeder,false);assert.ok(result.distanceProfile.beforeFeederNm>10)
 assert.ok(result.feederSeconds>0)
})

test('current rate replaces an obsolete automatic post-feeder rate and reverses cleanly',()=>{
 const c=config();c.frozenMinutes=0;c.rates['ESSA/01L']=85
 const pos={latitude:(ff.latitude+threshold.latitude)/2,longitude:(ff.longitude+threshold.longitude)/2}
 const traffic=[flight({...pos,altitude:8000,callsign:'AAA'}),flight({...pos,altitude:8000,callsign:'BBB'})]
 let first=runEngine(packet(traffic),c,{})
 assert.ok(first.flights.every(f=>f.state===2&&f.passedFeeder))
 const changed=runEngine(packet(traffic,now+1000),{...c,rates:{...c.rates,'ESSA/01L':240}},{},first)
 assert.equal(changed.flights.find(f=>f.callsign==='BBB').separation.rateSeconds,240)
 assert.ok(changed.flights.find(f=>f.callsign==='BBB').delay>first.flights.find(f=>f.callsign==='BBB').delay)
 const restored=runEngine(packet(traffic,now+2000),c,{},changed)
 assert.equal(restored.flights.find(f=>f.callsign==='BBB').separation.rateSeconds,85)
 assert.ok(restored.flights.find(f=>f.callsign==='BBB').delay<changed.flights.find(f=>f.callsign==='BBB').delay)
})

test('Superstable promotion to Frozen does not count its existing spacing delay twice',()=>{
 const c=config();c.frozenMinutes=0;c.rates['ESSA/01L']=85
 const pos={latitude:(ff.latitude+threshold.latitude)/2,longitude:(ff.longitude+threshold.longitude)/2}
 const traffic=[flight({...pos,altitude:8000,callsign:'AAA'}),flight({...pos,altitude:8000,callsign:'BBB'})]
 const first=runEngine(packet(traffic),c,{})
 const seed={...first,flights:first.flights.map(f=>({...f,tmaTiming:{delay:f.delay,rateSeconds:85,instructionSource:f.delay>0?'constraint':'none'},rateDelayMs:f.delay*1000}))}
 const next=runEngine(packet(traffic,now+1000),{...c,frozenMinutes:60},{},seed)
 for(const f of next.flights){assert.equal(f.state,3);assert.equal(f.delay,Math.max(0,Math.round((f.sta-f.planningEta)/1000)))}
})
test('IAS converts to TAS and speed, wind and descent assumptions affect elapsed time',()=>{
 assert.ok(Math.abs(iasToTas(250,0)-250)<1e-6);assert.ok(iasToTas(250,18000)>250)
 const c=config(),base=starTravelSeconds(49,18000,180,c)
 assert.ok(starTravelSeconds(49,18000,180,c,160)>base)
 assert.ok(starTravelSeconds(49,18000,180,{...c,surfaceWindDirection:180,surfaceWindSpeed:30})>base)
 assert.ok(starTravelSeconds(10,18000,180,{...c,starDescentRate:500})>=2142)
})
test('departing aircraft are forecast to accelerate instead of spending the entire trip at takeoff groundspeed',()=>{
 const p=flight({groundspeed:180,altitude:2000,verticalSpeed:1800})
 assert.ok(preFeederSeconds(300,p,config())<300/180*3600)
})
test('legacy HMR coordinate maps to VACRA, and missing positions have no EuroScope time fallback',()=>{
 assert.equal(canonicalFeeder({name:'HMR',...STAR_FEEDERS.VACRA}),'VACRA')
 assert.match(starPrediction(flight({latitude:undefined}),config()).error,/position/)
 assert.match(starPrediction(flight({star:'',route:[]}),config()).error,/profile/)
})
test('direct-to beyond the feeder shortens the workbook path independently of EETs',()=>{
 const p=flight(),a=starPrediction(p,config()),b=starPrediction({...p,direct:'SA01L'},config())
 assert.ok(b.distanceProfile.shortcut);assert.ok(b.seconds<a.seconds)
})
test('live engine ignores unreliable route times and infers the active ESSA runway if unset',()=>{
 const p=flight({runway:''}),a=runEngine(packet([p]),config(),{}),b=runEngine(packet([{...p,landingSeconds:-1000,route:p.route.map(r=>({...r,seconds:99999}))}]),config(),{})
 assert.equal(a.flights[0].runway,'01L');assert.equal(a.flights[0].runwaySource,'active');assert.equal(a.flights[0].predictionSource,'star-distance')
 assert.equal(a.flights[0].eta,b.flights[0].eta);assert.equal(a.flights[0].sta,b.flights[0].sta);assert.equal(a.flights[0].state,b.flights[0].state)
})
test('automatic aircraft from the same feeder retain their order in ACC and Runway',()=>{
 const a=flight({callsign:'NOZ826',groundspeed:400}),b=flight({callsign:'DLH1A',groundspeed:300,wake:'H'})
 const result=runEngine(packet([b,a]),config(),{}).flights
 const noz=result.find(f=>f.callsign==='NOZ826'),dlh=result.find(f=>f.callsign==='DLH1A')
 assert.ok(noz.etaFf<dlh.etaFf);assert.ok(noz.staFf<dlh.staFf);assert.ok(noz.sta<dlh.sta)
 assert.equal(noz.sta-noz.staFf,noz.eta-noz.etaFf)
})
test('wake separation is still applied with workbook predictions',()=>{
 const p=flight(),result=runEngine(packet([{...p,callsign:'HEAVY',wake:'H'},{...p,callsign:'MEDIUM'}]),config(),{}).flights
 const leader=result.find(f=>f.callsign==='HEAVY'),follower=result.find(f=>f.callsign==='MEDIUM')
 assert.ok(follower.sta>leader.sta);assert.ok(follower.separation.wakeNm>=5)
})
test('coincident ELTOK arrivals receive spacing and lose instructions in both views',()=>{
 const p=flight(),c=config(),result=runEngine(packet([{...p,callsign:'NOZ826'},{...p,callsign:'DLH1A',groundspeed:395,altitude:19000,wake:'H'}]),c,{}).flights
 const noz=result.find(f=>f.callsign==='NOZ826'),dlh=result.find(f=>f.callsign==='DLH1A')
 assert.ok(Math.abs(dlh.etaFf-noz.etaFf)<30000)
 assert.ok(dlh.staFf-noz.staFf>=c.rates['ESSA/01L']*1000)
 assert.ok(dlh.delay>=80,'the feeder constraint must publish lose minutes, rather than being cleared because runway spacing was already sufficient')
 assert.ok(dlh.feederDelayMs>=0)
})
test('a shorter predicted approach cannot automatically overtake its feeder predecessor',()=>{
 const p=flight(),result=runEngine(packet([{...p,callsign:'NOZ826',latitude:ff.latitude+.001,longitude:ff.longitude-.001,assignedSpeed:100},{...p,callsign:'DLH1A',groundspeed:400}]),config(),{}).flights
 const noz=result.find(f=>f.callsign==='NOZ826'),dlh=result.find(f=>f.callsign==='DLH1A')
 assert.ok(noz.etaFf<dlh.etaFf);assert.ok(noz.eta>dlh.eta)
 assert.ok(noz.sta<dlh.sta);assert.ok(noz.staFf<dlh.staFf)
})

test('aircraft-specific performance uses the pinned EuroScope dataset and normalizes ICAO type',()=>{
 assert.equal(PERFORMANCE_SOURCE.blobSha,'af94db8b72e961dccfb4d1779c8a5c682be5f126')
 assert.equal(PERFORMANCE_SOURCE.typeCount,430)
 const a=performanceAt('H/A320/M',18000)
 assert.equal(a.type,'A320');assert.ok(Math.abs(a.nominalIas-290)<.001);assert.ok(a.descentFpm>2000&&a.descentFpm<2300)
})
test('IAS to Mach crossover interpolates true speed without interpreting zero IAS as zero speed',()=>{
 const at=performanceAt('A320',27500)
 assert.ok(at.nominalTas>350&&at.nominalTas<500)
 assert.ok(machToTas(.78,35000)>430&&machToTas(.78,35000)<470)
})
test('missing and conflicting aircraft profiles remain explicitly unavailable',()=>{
 assert.equal(performanceAt('UNKN',18000),undefined)
 assert.equal(performanceAt('B77W',18000),undefined)
 assert.equal(performanceAt('B77L',18000),undefined)
 assert.ok(PERFORMANCE_SOURCE.ambiguousTypes.includes('B77W'))
})
test('a slow aircraft performance profile changes the travel time without changing the STAR distance',()=>{
 const c=config()
 const jet=starTravelSeconds(49,9000,0,c,0,'M','A320')
 const light=starTravelSeconds(49,9000,0,c,0,'L','C172')
 assert.ok(light>jet)
})
