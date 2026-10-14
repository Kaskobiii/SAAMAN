import {test} from 'node:test'
import {reactive} from 'vue'
import assert from 'node:assert/strict'
import {DEFAULT_CONFIG as RELEASE_DEFAULT_CONFIG,validateConfig,validateEdits,validateTelemetry,runEngine,delayLabel} from '../src/maestro-engine.ts'
import {gainDragEdits,insertRelative,extraFlightEdits,manualTransferSeconds,maximumDelayEdits,instructionColor,signedDuration,informationRoute,COORDINATION_MESSAGES} from '../src/maestro-operations.ts'
import {validateCoordinations,mergeCoordinationChanges} from '../src/maestro-coordination.ts'
import {SessionRecording,decodeRecording} from '../src/maestro-recording.ts'
import {distanceNm} from '../src/maestro-star-prediction.ts'
import {runwaySelections} from '../src/maestro-runway-sync.ts'
const DEFAULT_CONFIG={...RELEASE_DEFAULT_CONFIG,timingModel:'performance'}

const now=Date.UTC(2026,9,12,10),config=()=>({...structuredClone(DEFAULT_CONFIG),predictionMode:'euroscope',unstableSeconds:0,minimumNewSeconds:0})
const p=(callsign,seconds,extra={})=>({callsign,aircraft:'A320',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'19R',route:[{name:'ELTOK',seconds:100}],landingSeconds:seconds,distanceNm:60,groundspeed:240,altitude:12000,...extra})
const packet=(flights,timestamp=now,extra={})=>({source:'TEST_APP',timestamp,flights,...extra})

test('15/4 minute phase boundaries are permanent across config and persisted settings',()=>{
 for(const horizons of [[12,8],[20,10],[60,30]]){
  const c=validateConfig({...config(),stableMinutes:horizons[0],superStableMinutes:horizons[1]})
  assert.equal(c.stableMinutes,15);assert.equal(c.superStableMinutes,4)
 }
 const c=config();c.frozenMinutes=0
 for(const [seconds,state] of [[901,0],[900,1],[241,1],[240,2]]){
  const s=runEngine(packet([p('TEST',2000,{route:[{name:'ELTOK',seconds}]})]),c,{})
  assert.equal(s.flights[0].state,state)
 }
})
test('aircraft type and current instructions are mandatory in the replacement label layout',()=>{
 const c=validateConfig({...config(),displayPreferences:{labels:{type:false,currentDelay:false,totalDelay:false,feeder:false,runway:false},panels:{winds:false,rates:false,tracks:true}}})
 assert.equal(c.displayPreferences.labels.type,true);assert.equal(c.displayPreferences.labels.currentDelay,true)
})
test('positive instructions show complete minutes; 150 seconds yellow, 151 red; gain green',()=>{
 assert.equal(delayLabel(150),'2');assert.equal(delayLabel(151),'2');assert.equal(delayLabel(121),'2');assert.equal(delayLabel(120),'2');assert.equal(delayLabel(1),'');assert.equal(delayLabel(0),'')
 assert.equal(instructionColor(150),'#f0e129');assert.equal(instructionColor(151),'#e11919');assert.equal(instructionColor(-1),'#29ff28')
 assert.equal(signedDuration(-151),'-2:31');assert.equal(signedDuration(150),'+2:30');assert.equal(signedDuration(0),'0:00')
})
test('gain-only dragging advances and restores an allocation but cannot drag beyond its original time',()=>{
 const c=config(),input=packet([p('TEST_ONE',450)])
 let s=runEngine(input,c,{}),original=s.flights[0].sta
 let edits=gainDragEdits(s,{},'TEST_ONE',now+150000)
 s=runEngine({...input,timestamp:now+1000},c,edits,s)
 assert.equal(s.flights[0].state,3);assert.equal(s.flights[0].sta,now+150000)
 edits=gainDragEdits(s,edits,'TEST_ONE',now+600000)
 s=runEngine({...input,timestamp:now+2000},c,edits,s)
 assert.equal(s.flights[0].sta,original);assert.equal(s.flights[0].state,2)
})
test('manually gaining an Unstable flight promotes it to Stable',()=>{
 const c=config();c.unstableSeconds=60;c.frozenMinutes=0
 const input=packet([p('BLUE',1800,{route:[{name:'ELTOK',seconds:1200}]})]),first=runEngine(input,c,{})
 assert.equal(first.flights[0].state,0)
 const edits=gainDragEdits(first,{},'BLUE',first.flights[0].sta-60000)
 const next=runEngine({...input,timestamp:now+1000},c,edits,first)
 assert.equal(next.flights[0].state,1)
})
test('Refresh delay changes the instruction without moving a Superstable allocation or its order',()=>{
 const c=config();c.frozenMinutes=0;const input=packet([p('LEAD',1200),p('FOLLOW',1200)])
 let s=runEngine(input,c,{}),old=s.flights.find(p=>p.callsign==='FOLLOW'),sta=old.sta,delay=old.delay
 const changed=packet([p('LEAD',1200),p('FOLLOW',1400,{route:[{name:'ELTOK',seconds:200}]})],now+1000)
 s=runEngine(changed,c,{},s);assert.equal(s.flights.find(p=>p.callsign==='FOLLOW').delay,delay)
 const edits={FOLLOW:{refreshDelayAt:now+2000,changedAt:now+2000}}
 s=runEngine({...changed,timestamp:now+2000},c,edits,s)
 const f=s.flights.find(p=>p.callsign==='FOLLOW');assert.equal(f.sta,sta);assert.equal(f.staFf,old.staFf);assert.equal(f.order,old.order);assert.equal(f.delay,Math.round((f.staFf-f.etaFf)/1000))
})
test('an ETA-FF override changes the feeder prediction and corresponding landing prediction',()=>{
 const c=config();c.frozenMinutes=0;const input=packet([p('TEST',1800,{route:[{name:'ELTOK',seconds:600}]})])
 const first=runEngine(input,c,{}),edits={TEST:{etaFfOverride:now+720000,recomputeAt:now+1000}}
 const next=runEngine({...input,timestamp:now+1000},c,edits,first)
 assert.equal(next.flights[0].etaFf,now+720000)
 assert.equal(next.flights[0].eta-next.flights[0].etaFf,first.flights[0].eta-first.flights[0].etaFf)
})
test('an ACC manual reservation uses its declared feeder time and nominal workbook transfer',()=>{
 const c=config(),feederEta=now+600000,transfer=manualTransferSeconds(c,'ESSA/19R','ELTOK','M','A320')
 c.manualFlights=[{callsign:'KNOWN',aircraft:'A320',wake:'M',departure:'EDDH',runway:'ESSA/19R',feeder:'ELTOK',feederEta,eta:feederEta+transfer*1000}]
 const snapshot=runEngine(packet([]),c,{})
 assert.equal(snapshot.flights[0].etaFf,feederEta);assert.equal(snapshot.flights[0].eta,feederEta+transfer*1000)
 assert.equal(snapshot.flights[0].departure,'EDDH')
})
test('before/after insertion resumes missed traffic with one callsign and transfers ordering',()=>{
 const c=config();c.frozenMinutes=0;const input=packet([p('AA',1200),p('BB',1400),p('MISSED',1500)])
 const first=runEngine(input,c,{MISSED:{mode:'missed'}}),edits=insertRelative(first,{MISSED:{mode:'missed'}},'MISSED','BB','before')
 const next=runEngine({...input,timestamp:now+1000},c,edits,first)
 assert.deepEqual(next.flights.filter(f=>f.mode==='sequenced').sort((a,b)=>a.order-b.order).map(f=>f.callsign),['AA','MISSED','BB'])
 assert.equal(next.flights.filter(f=>f.callsign==='MISSED').length,1)
})
test('an explicit missed-approach insertion does not add the generic ten-minute resume floor',()=>{
 const c=config();c.minimumNewSeconds=600;c.frozenMinutes=0
 const input=packet([p('AA',1200),p('BB',1400),p('MISSED',1500)])
 const first=runEngine(input,c,{MISSED:{mode:'missed'}}),edits=insertRelative(first,{MISSED:{mode:'missed'}},'MISSED','BB','before')
 const next=runEngine({...input,timestamp:now+1000},c,edits,first)
 assert.equal(next.flights.find(f=>f.callsign==='MISSED').minimumArrival,now+1000)
 assert.equal(next.flights.find(f=>f.callsign==='MISSED').minimumArrivalSource,undefined)
})
test('Extra flight reinserts the last arrival one slot later and allows newly known earlier traffic ahead',()=>{
 const c=config();c.frozenMinutes=0;const input=packet([p('EXTRA',450)])
 const first=runEngine(input,c,{}),edits=extraFlightEdits(first,c,{},'EXTRA')
 let next=runEngine({...input,timestamp:now+1000},c,edits,first)
 assert.equal(next.flights[0].state,1);assert.ok(next.flights[0].sta>first.flights[0].sta)
 next=runEngine(packet([p('EXTRA',450),p('NEW',500)],now+2000),c,edits,next)
 assert.deepEqual(next.flights.sort((a,b)=>a.order-b.order).map(f=>f.callsign),['NEW','EXTRA'])
 assert.ok(next.flights.every(f=>!f.spacingConflict))
})
test('maximum delay preserves required constraints and flags an impossible zero limit',()=>{
 const c=config();c.rates['ESSA/19R']=115;c.frozenMinutes=0
 const input=packet([p('AA',1200,{route:[{name:'ELTOK',seconds:-1}]}),p('BB',1200)])
 const first=runEngine(input,c,{}),edits=maximumDelayEdits(first,c,{},'BB',0)
 const next=runEngine({...input,timestamp:now+1000},c,edits,first),f=next.flights.find(f=>f.callsign==='BB')
 assert.ok(f.delay>0);assert.equal(f.maximumDelayExceeded,true);assert.ok(next.flights.every(f=>!f.spacingConflict))
 assert.throws(()=>validateEdits({BB:{maximumDelayMinutes:7}}))
})
test('a zero-delay priority can move ahead of a different feeder and allocate real spacing work to the follower',()=>{
 const c=config();c.rates['ESSA/19R']=115;c.frozenMinutes=0
 const input=packet([p('AA',1200),p('HOSP',1200,{route:[{name:'NILUG',seconds:100}]})])
 const first=runEngine(input,c,{}),edits=maximumDelayEdits(first,c,{},'HOSP',0)
 const next=runEngine({...input,timestamp:now+1000},c,edits,first),flights=next.flights.sort((a,b)=>a.order-b.order)
 assert.deepEqual(flights.map(f=>f.callsign),['HOSP','AA']);assert.equal(flights[0].delay,0);assert.ok(flights[1].delay>=115)
 assert.ok(flights.every(f=>!f.spacingConflict))
})
test('solid closures and hollow gaps retain their kinds through validation',()=>{
 const c=validateConfig({...config(),slots:[{id:'closure',runway:'ESSA/19R',begin:now,end:now+480000,kind:'closure'},{id:'gap',runway:'ESSA/19R',begin:now+480000,end:now+780000,kind:'gap'}]})
 assert.equal(c.slots[0].kind,'closure');assert.equal(c.slots[1].kind,'gap')
})
test('explicit individual secondary-runway assignments are sequenced without changing EuroScope or the configuration',()=>{
 const c=config();c.departureRunway='ESSA/26';const input=packet([p('TEST',1200)])
 const first=runEngine(input,c,{}),edits={TEST:{runway:'ESSA/26',recomputeAt:now+1000}}
 let next=runEngine({...input,timestamp:now+1000},c,edits,first)
 assert.equal(next.flights[0].runway,'26');assert.equal(next.flights[0].issue,'');assert.equal(next.flights[0].secondaryRunwayAccepted,true)
 assert.equal(input.flights[0].runway,'19R');assert.deepEqual(c.active,['ESSA/19R'])
 const changed=packet([p('TEST',1200,{runway:'26'})],now+2000)
 next=runEngine(changed,c,{},first);assert.equal(next.flights[0].issue,'')
 next=runEngine({...changed,timestamp:now+3000},c,{},next);assert.equal(next.flights[0].issue,'')
 const cold=runEngine(changed,c,{})
 assert.match(cold.flights[0].issue,/not active/,'an unexplained cold departure-only arrival remains a diagnostic')
})
test('a manual future-runway choice waits for its activation and uses the planned arrival rate',()=>{
 const c=config();c.frozenMinutes=0;c.pending={at:now+600000,active:['ESSA/01R'],departureRunway:'ESSA/01L',rates:{...c.rates,'ESSA/01R':150}}
 const input=packet([p('AA',300),p('BB',300)]),first=runEngine(input,c,{})
 const edits={AA:{runway:'ESSA/01R',recomputeAt:now+1000},BB:{runway:'ESSA/01R',recomputeAt:now+1000}}
 const next=runEngine({...input,timestamp:now+1000},c,edits,first),flights=next.flights.sort((a,b)=>a.order-b.order)
 assert.ok(flights.every(f=>!f.issue&&f.sta>=c.pending.at));assert.ok(flights[1].sta-flights[0].sta>=150000)
 assert.ok(flights[0].guidance.constraints.includes('planned runway availability'))
 c.pending.at=now+720000
 const delayed=runEngine({...input,timestamp:now+2000},c,edits,next)
 assert.ok(delayed.flights.every(f=>f.sta>=c.pending.at))
})
test('a planned bank change reassigns ordinary later arrivals without altering SDK runway assignments',()=>{
 const c=config();c.frozenMinutes=0;c.pending={at:now+600000,active:['ESSA/01R'],departureRunway:'ESSA/01L',rates:{...c.rates,'ESSA/01R':150}}
 const input=packet([p('EARLY',300),p('LATER',1200)])
 let s=runEngine(input,c,{})
 assert.equal(s.flights.find(f=>f.callsign==='EARLY').runway,'19R')
 assert.equal(s.flights.find(f=>f.callsign==='LATER').runway,'01R')
 assert.ok(s.flights.every(f=>!f.issue))
 s=runEngine({...input,timestamp:now+1000},c,{},s)
 assert.equal(s.flights.find(f=>f.callsign==='LATER').runway,'01R')
 assert.equal(input.flights[1].runway,'19R')
})
test('immediate bank changes persist in AMAN planning without writing the SDK runway',()=>{
 const c=config();c.frozenMinutes=0;const input=packet([p('TEST',1200)]),first=runEngine(input,c,{})
 c.active=['ESSA/01R'];c.departureRunway='ESSA/19R'
 let s=runEngine({...input,timestamp:now+1000},c,{},first)
 assert.equal(s.flights[0].runway,'01R');assert.equal(s.flights[0].euroscopeRunway,'19R')
 s=runEngine({...input,timestamp:now+2000},c,{},s)
 assert.equal(s.flights[0].runway,'01R');assert.equal(s.flights[0].issue,'')
})
test('coordination messages accept only the specified choices and preserve acknowledgements',()=>{
 assert.equal(COORDINATION_MESSAGES.length,10)
 const m={id:'message-1',message:'Update finished',sender:'controller-a',at:now,acknowledgedBy:['controller-b','controller-b']}
 assert.deepEqual(validateCoordinations([m])[0].acknowledgedBy,['controller-b'])
 assert.throws(()=>validateCoordinations([{...m,message:'Unspecified command'}]));assert.throws(()=>validateCoordinations([m,m]))
})
test('concurrent coordination acknowledgements merge without losing another operator or message',()=>{
 const message={id:'message-1',message:'Update finished',sender:'a',at:now,acknowledgedBy:['a']}
 const current=[{...message,acknowledgedBy:['a','b']},{id:'message-2',message:'Snow removal ESSA',sender:'b',at:now+1,acknowledgedBy:['b']}]
 const merged=mergeCoordinationChanges([message],[{...message,acknowledgedBy:['a','c']}],current)
 assert.deepEqual(merged[0].acknowledgedBy,['a','b','c']);assert.equal(merged.length,2)
 assert.throws(()=>mergeCoordinationChanges([message],[{...message,message:'New Approach Times'}],current))
})
test('coordination login callsign is optional for older peers and immutable with its send time',()=>{
 const old={id:'legacy',message:'Update finished',sender:'instance-a',at:now,acknowledgedBy:['instance-a']}
 assert.equal(validateCoordinations([old])[0].senderCallsign,undefined)
 const m={...old,id:'current',senderCallsign:'ESOS_1__CTR'}
 assert.equal(validateCoordinations([m])[0].senderCallsign,'ESOS_1__CTR')
 const acknowledged={...m,acknowledgedBy:[...m.acknowledgedBy,'instance-b']}
 assert.deepEqual(mergeCoordinationChanges([m],[acknowledged],[m])[0],acknowledged)
 for(const changed of [{senderCallsign:'ESSA_FMP'},{at:now+1},{senderCallsign:undefined}])assert.throws(()=>mergeCoordinationChanges([m],[{...m,...changed}],[m]))
 for(const callsign of ['',null,123,'<script>','a'.repeat(100)])assert.throws(()=>validateCoordinations([{...m,senderCallsign:callsign}]))
})
test('explicit termination survives target removal, is recorded, and is distinct from disappearance',()=>{
 const c=config(),input=packet([p('TEST',1200)]),first=runEngine(input,c,{})
 const terminated=validateTelemetry(packet([],now+1000,{terminatedCallsigns:['TEST']}),now+1000)
 const next=runEngine(terminated,c,{},first)
 assert.equal(next.flights[0].state,4);assert.equal(next.flights[0].landingDetection,'termination')
 const recorder=new SessionRecording();recorder.start(first,c,{});recorder.capture(next,c,{})
 assert.deepEqual(decodeRecording(recorder.export())[1].input.terminatedCallsigns,['TEST'])
 assert.equal(runEngine(packet([],now+1000),c,{},first).flights.length,0)
 const removed=runEngine(packet(input.flights,now+1000,{terminatedCallsigns:['TEST']}),c,{TEST:{mode:'removed'}},first)
 assert.equal(removed.flights[0].mode,'removed','termination cannot silently undo an operator Remove')
})
test('Information route drops passed points and ends at ESSA with the independent ETA',()=>{
 const c=config(),input=packet([p('TEST',1200,{route:[{name:'ELTOK',latitude:59.8,longitude:17,seconds:100},{name:'STAR1',latitude:59.7,longitude:17.5,seconds:500},{name:'SA19R',latitude:59.65,longitude:17.92,seconds:1200}]})])
 const first=runEngine(input,c,{}),f={...first.flights[0],passedFeeder:true,calculatedRouteIndex:0}
 const points=informationRoute(f,now);assert.ok(points.every(p=>p.name!=='ELTOK'));assert.equal(points.at(-1).name,'ESSA');assert.equal(points.at(-1).time,f.eta)
})

test('buffer-mode route point ETA uses current GS and accepted route distance, independently of landing buffer',()=>{
 const c={...config(),timingModel:'euroscope-buffer'},route=[{name:'SA630',latitude:59,longitude:18,seconds:180},{name:'TEB',latitude:59.1,longitude:18,seconds:420},{name:'SA19R',latitude:59.2,longitude:18,seconds:700}]
 const first=runEngine(packet([p('EJU14A',1200,{route,latitude:58.9,longitude:18,groundspeed:440})]),c,{})
 const f={...first.flights[0],amanRoute:route,amanRoutePassed:0,passedFeeder:true}
 const points=informationRoute(f,now),seconds=distanceNm(f,route[0])/440*3600
 assert.equal(points[0].time,now+seconds*1000)
 assert.ok(points[0].time<now+120000,'nearby point does not inherit several minutes of landing buffer')
 const slower=informationRoute({...f,groundspeed:220,eta:f.eta+600000},now)
 assert.ok(Math.abs(slower[0].time-now-2*(points[0].time-now))<1)
 assert.equal(slower.at(-1).time,f.eta+600000)
 assert.equal(informationRoute(f,now+2000)[0].time,points[0].time,'clock tick alone cannot move an estimate from the same position sample')
})

test('Information retains accepted route names after rerouting but does not forecast a return to omitted points',()=>{
 const c={...config(),timingModel:'euroscope-buffer'},route=[{name:'ELTOK',latitude:59,longitude:18,seconds:300},{name:'SA630',latitude:59.1,longitude:18,seconds:500},{name:'TEB',latitude:59.2,longitude:18,seconds:700}]
 const f=runEngine(packet([p('TEST',1200,{route,latitude:59.05,longitude:18,groundspeed:300})]),c,{}).flights[0]
 const passed={...f,passedFeeder:true,amanRoute:route,amanRoutePassed:1,route:[{name:'DIRECT_OTHER',latitude:59.3,longitude:18,seconds:100}]}
 const points=informationRoute(passed,now)
 assert.deepEqual(points.map(p=>p.name),['SA630','TEB','ESSA'])
 assert.ok(points.slice(0,-1).every(p=>Number.isNaN(p.time)))
 assert.equal(points.at(-1).time,passed.eta)
 assert.ok(Number.isNaN(informationRoute({...passed,positionAgeSeconds:16},now)[0].time))
})

test('Information skips negative EET and direct-bypassed points without adding their distances to the next estimate',()=>{
 const c={...config(),timingModel:'euroscope-buffer'},route=[{name:'ELTOK',latitude:59,longitude:18,seconds:300},{name:'TEB',latitude:59.1,longitude:18,seconds:600},{name:'SA19R',latitude:59.2,longitude:18,seconds:900}]
 const f=runEngine(packet([p('TEST',1200,{route,latitude:58.9,longitude:18,groundspeed:300})]),c,{}).flights[0]
 for(const extra of [{route:route.map((p,i)=>({...p,seconds:i===0?-1:p.seconds}))},{direct:'TEB'}]){
  const points=informationRoute({...f,...extra,amanRoute:route,amanRoutePassed:0},now)
  assert.ok(Number.isNaN(points[0].time));assert.equal(points[1].time,now+distanceNm(f,route[1])/300*3600000)
  assert.equal(f.amanRoutePassed,0,'an unavailable prediction is not an observed passage')
 }
})

test('heading vectors and route times after airport ETA display unavailable, retaining the independent airport ETA',()=>{
 const c={...config(),timingModel:'euroscope-buffer'},route=[{name:'ELTOK',latitude:59,longitude:18,seconds:100},{name:'TEB',latitude:60,longitude:18,seconds:1200}]
 const f=runEngine(packet([p('TEST',300,{route,latitude:58.9,longitude:18,groundspeed:300})]),c,{}).flights[0]
 const vectors=informationRoute({...f,assignedHeading:180},now)
 assert.ok(vectors.slice(0,-1).every(p=>Number.isNaN(p.time)));assert.equal(vectors.at(-1).time,f.eta)
 const normal=informationRoute(f,now);assert.ok(Number.isFinite(normal[0].time));assert.ok(Number.isNaN(normal[1].time))
})

test('route-point fallback uses live EuroScope EET when coordinates are unavailable, never the landing buffer',()=>{
 const f=runEngine(packet([p('TEST',1200)]),{...config(),timingModel:'euroscope-buffer'},{}).flights[0]
 assert.equal(informationRoute(f,now)[0].time,now+100000)
 assert.ok(Number.isNaN(informationRoute({...f,route:[]},now)[0].time))
})

test('Information keeps remaining accepted points when feeder and assigned threshold are absent from that route',()=>{
 const f=runEngine(packet([p('TEST',1200)]),{...config(),timingModel:'euroscope-buffer'},{}).flights[0]
 const route=[{name:'SA630',seconds:100},{name:'TEB',seconds:300}]
 assert.deepEqual(informationRoute({...f,ff:'NILUG',route,amanRoute:route,amanRoutePassed:0},now).map(p=>p.name),['SA630','TEB','ESSA'])
})

test('Sync EuroScope uses fresh supported ESSA ARR and DEP selections and rejects missing or stale data',()=>{
 const input=packet([]),activeRunways={arrivals:['ESSA/07','ESSA/01R','ESSA/01R'],departures:['ESSA/25','ESSA/01L']}
 assert.deepEqual(runwaySelections({...input,activeRunways},now),{active:['ESSA/01R'],departureRunway:'ESSA/01L'})
 assert.throws(()=>runwaySelections({...input,activeRunways,timestamp:now-16000},now),/fresh/)
 assert.throws(()=>runwaySelections({...input,activeRunways:{...activeRunways,departures:[]}},now),/departure/)
 assert.throws(()=>runwaySelections({...input,activeRunways:{arrivals:['ESSB/30'],departures:['ESSB/12']}},now),/ESSA/)
})
test('legacy histories do not invent a missing initial allocation',()=>{
 const c=config(),input=packet([p('TEST',1200)]),first=runEngine(input,c,{})
 delete first.flights[0].initialSta;delete first.flights[0].initialStaFf
 const next=runEngine({...input,timestamp:now+1000},c,{},first)
 assert.equal(next.flights[0].initialSta,undefined);assert.equal(next.flights[0].initialStaFf,undefined)
})

test('controller operations accept Vue reactive edits without cloning errors or mutating the input',()=>{
 const c=config(),snapshot=runEngine(packet([p('ONE',600),p('TWO',800)]),c,{})
 const edits=reactive({ONE:{slotAfter:1,closurePosition:{id:'example',side:'after'}}}),before=JSON.stringify(edits)
 for(const result of [gainDragEdits(snapshot,edits,'ONE',snapshot.flights[0].sta-60000),insertRelative(snapshot,edits,'TWO','ONE','before'),extraFlightEdits(snapshot,c,edits,'ONE'),maximumDelayEdits(snapshot,c,edits,'ONE',3)])assert.ok(result.ONE)
 assert.equal(JSON.stringify(edits),before)
})
test('Stable feeder instruction and total delay use current ETA-FF versus accepted STA-FF',()=>{
 const c=config(),original=packet([p('AREA',1500,{route:[{name:'NILUG',seconds:600}]})])
 const first=runEngine(original,c,{})
 const next=runEngine(packet([p('AREA',1411,{route:[{name:'NILUG',seconds:511}]})],now+1000),c,{},first),f=next.flights[0]
 const difference=Math.round((f.staFf-f.etaFf)/1000)
 assert.equal(f.state,1);assert.equal(f.staFf,first.flights[0].staFf)
 assert.ok(difference>=80&&difference<120,JSON.stringify({difference,etaFf:f.etaFf,staFf:f.staFf,initial:first.flights[0].staFf}));assert.equal(f.delay,difference);assert.equal(f.totalDelay,difference)
 assert.equal(delayLabel(f.delay),'1');assert.equal(instructionColor(f.delay),'#f0e129')
})
