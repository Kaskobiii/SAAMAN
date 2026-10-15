import {test} from 'node:test'
import assert from 'node:assert/strict'
import {predictRouteTiming,remainingRoute,PHASE_REFERENCES} from '../src/maestro-route-timing.ts'
import {DEFAULT_CONFIG,runEngine} from '../src/maestro-engine.ts'
import {SessionRecording,decodeRecording} from '../src/maestro-recording.ts'
import {phaseReferenceLookup,bundledPhaseReferences} from '../src/maestro-phase-references.ts'
import {predictLanding} from '../src/maestro-landing-prediction.ts'
import {iasToTas} from '../src/maestro-aircraft-performance.ts'
const c=()=>({...structuredClone(DEFAULT_CONFIG),minimumNewSeconds:0,unstableSeconds:0})
const p=(extra={})=>({callsign:'TIMING',aircraft:'A20N',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'19R',latitude:61,longitude:18,altitude:30000,groundspeed:440,verticalSpeed:0,positionAgeSeconds:0,
 route:[{name:'ELTOK',seconds:500,latitude:60.4,longitude:18},{name:'FI19R',seconds:900,latitude:59.8,longitude:17.95},{name:'SA19R',seconds:1000,latitude:59.6664,longitude:17.92377}],landingSeconds:1060,distanceNm:80,...extra})
test('the candidate has consistent feeder and landing times from one route integration',()=>{
 const a=predictRouteTiming(p(),c())
 assert.equal(a.feeder.name,'ELTOK');assert.ok(a.feeder.seconds>0)
 assert.equal(a.seconds,a.feeder.seconds+a.afterFeederSeconds)
 assert.ok(a.distanceNm>a.beforeFeederNm);assert.ok(a.seconds>a.distanceNm/440*3600)
 assert.equal(a.profile.type,'A20N');assert.match(a.profile.source,/eurocontrol/)
 const b=predictRouteTiming(p({positionAgeSeconds:5}),c())
 assert.ok(Math.abs(a.seconds-b.seconds-5)<.001);assert.ok(Math.abs(a.feeder.seconds-b.feeder.seconds-5)<.001)
 assert.equal(a.afterFeederSeconds,b.afterFeederSeconds,'position age is counted once')
})
test('observed simulator groundspeed anchors the candidate independently of nominal IAS',()=>{
 const fast=predictRouteTiming(p({groundspeed:460}),c()),slow=predictRouteTiming(p({groundspeed:350}),c())
 assert.ok(slow.feeder.seconds>fast.feeder.seconds);assert.ok(slow.seconds>fast.seconds)
 assert.equal(PHASE_REFERENCES.HDJT.approachIas,160);assert.equal(PHASE_REFERENCES.HDJT.landingIas,112)
 const jet=predictRouteTiming(p({aircraft:'HDJT',wake:'L',groundspeed:380}),c())
 assert.equal(jet.profile.type,'HDJT');assert.ok(Number.isFinite(jet.seconds))
 assert.notEqual(jet.seconds,fast.seconds)
})
test('vectors, stale data, unknown types, missing geometry and climbing aircraft do not invent an arrival path',()=>{
 for(const extra of [{assignedHeading:210},{positionAgeSeconds:16},{aircraft:'ZZZZ'},{speedDataValid:false},{verticalSpeed:1500},{latitude:undefined},{route:[{name:'SA19R',seconds:900}]}])
  assert.equal(predictRouteTiming(p(extra),c()),undefined)
 assert.equal(predictRouteTiming(p({groundspeed:NaN}),c()),undefined)
})
test('directs skip obsolete points and missing geometry is not treated as a straight shortcut',()=>{
 const f=p(),direct=predictRouteTiming({...f,direct:'FI19R'},c()),all=predictRouteTiming(f,c())
 assert.equal(direct.feeder,undefined);assert.ok(direct.distanceNm<=all.distanceNm)
 assert.equal(remainingRoute({...f,route:[{name:'OLD',seconds:100},...f.route]}),undefined)
 const passed=predictRouteTiming({...f,route:f.route.map((q,i)=>({...q,seconds:i===0?-1:q.seconds}))},c())
 assert.equal(passed.feeder,undefined)
})
test('candidate calculations do not alter assigned slots, shared configuration or raw telemetry',()=>{
 const input={timestamp:2_000_000,source:'ESSA_FMP',flights:[p()]},config=c(),first=runEngine(input,config,{})
 const copy=structuredClone({input,config,first})
 predictRouteTiming(input.flights[0],config)
 assert.deepEqual({input,config,first},copy)
 const next=runEngine({...input,timestamp:input.timestamp+2000},config,{},first)
 assert.equal(next.flights[0].sta,first.flights[0].sta);assert.equal(next.flights[0].staFf,first.flights[0].staFf)
})
test('recordings index exact initial and recompute capture inputs without duplicating each update',()=>{
 const config=c(),input={timestamp:2_000_000,source:'ESSA_FMP',flights:[p()]},first=runEngine(input,config,{}),recorder=new SessionRecording()
 recorder.start(first,config,{})
 let previous=first
 for(let i=1;i<=3;i++){
  previous=runEngine({...input,timestamp:input.timestamp+i*2000},config,{},previous);recorder.capture(previous,config,{})
 }
 const at=input.timestamp+8000,edits={TIMING:{recomputeAt:at}}
 previous=runEngine({...input,timestamp:at},config,edits,previous);recorder.capture(previous,config,edits)
 const data=recorder.export(),decoded=decodeRecording(data)
 assert.equal(data.timingCaptures.length,2);assert.equal(data.timingCaptures[0].kind,'initial');assert.equal(data.timingCaptures[1].kind,'recompute')
 for(const entry of data.timingCaptures){
  assert.equal(decoded[entry.frame].input.timestamp,entry.at)
  assert.deepEqual(entry.candidate,predictRouteTiming(decoded[entry.frame].input.flights.find(p=>p.callsign===entry.callsign),decoded[entry.frame].config))
 }
 data.timingCaptures[0].baseline.eta=0
 assert.notEqual(recorder.export().timingCaptures[0].baseline.eta,0)
})
test('starting late records missing capture evidence instead of substituting the first available position',()=>{
 const config=c(),input={timestamp:2_000_000,source:'ESSA_FMP',flights:[p()]},first=runEngine(input,config,{})
 const later=runEngine({...input,timestamp:input.timestamp+2000},config,{},first),recorder=new SessionRecording()
 recorder.start(later,config,{})
 assert.equal(recorder.export().timingCaptures.length,0)
 assert.deepEqual(recorder.export().unavailableCaptures,[{callsign:'TIMING',at:input.timestamp,reason:'before-recording'}])
 recorder.stop();recorder.start(first,config,{})
 assert.equal(recorder.export().timingCaptures.length,1);assert.deepEqual(recorder.export().unavailableCaptures,[])
})

test('external phase references retain IAS/Mach units and ignore implausible source values',()=>{
 const speed=(value,unit,status='reported')=>({value,unit,status})
 const dataset={schema:'saaman-descent-performance-1',aircraft:{A20N:{icao:'A20N',sourceUrl:'https://learningzone.eurocontrol.int/',phases:{
  initialDescent:{speed:speed(.78,'Mach'),altitude:{value:240,unit:'FL',meaning:'to'}},descent:{speed:speed(290,'kt IAS'),altitude:{value:100,unit:'FL',meaning:'to'}},
  approach:{speed:speed(250,'kt IAS'),minimumCleanSpeed:speed(1500,'kt IAS','implausible-as-labelled')},landing:{speed:speed(135,'kt IAS')}}}}}
 const refs=phaseReferenceLookup(dataset)
 assert.equal(refs.A20N.mach,.78);assert.equal(refs.A20N.descentIas,290);assert.equal(refs.A20N.initialDescentToFeet,24000)
 assert.equal(refs.A20N.landingIas,135);assert.equal(refs.A20N.minimumCleanIas,undefined)
 assert.ok(predictRouteTiming(p(),c(),refs))
 dataset.aircraft.A20N.phases.initialDescent.speed=speed(120,'Mach')
 assert.equal(phaseReferenceLookup(dataset).A20N.mach,undefined)
 dataset.aircraft.A20N.phases.descent.speed=speed(290,'kt TAS')
 assert.equal(phaseReferenceLookup(dataset).A20N.descentIas,undefined)
 assert.throws(()=>phaseReferenceLookup({schema:'unknown'}),/Unsupported/)
})

test('phase transition bands remain continuous rather than jumping at FL 100 or FL 240',()=>{
 for(const altitude of [10000,24000]){
  const a=predictRouteTiming(p({altitude:altitude-1,groundspeed:350}),c()),b=predictRouteTiming(p({altitude:altitude+1,groundspeed:350}),c())
  assert.ok(a&&b);assert.ok(Math.abs(a.seconds-b.seconds)<2)
 }
})

test('all 398 bundled profiles are validated, with source anomalies omitted and bounded finite forecasts',()=>{
 assert.equal(Object.keys(PHASE_REFERENCES).length,398)
 for(const code of ['B412','C160','C340','DA40','DA42','KA52','MI8'])assert.equal(PHASE_REFERENCES[code].mach,undefined)
 assert.equal(PHASE_REFERENCES.C25A.minimumCleanIas,undefined)
 let modeled=0
 for(const [aircraft,ref] of Object.entries(PHASE_REFERENCES)){
  const f=p({aircraft,altitude:5000,groundspeed:Math.max(60,Math.min(1200,iasToTas(ref.approachIas,5000)))})
  const result=predictLanding(f,c(),2)
  assert.ok(Number.isFinite(result.seconds)&&result.seconds>=0,aircraft)
  if(result.routeTiming){modeled++;assert.ok(result.seconds<=14400);assert.ok(result.routeTiming.feeder.seconds<=result.seconds)}
 }
 assert.ok(modeled>350,`${modeled} profiles modeled from plausible inputs`)
 assert.deepEqual(Object.keys(bundledPhaseReferences({schema:'broken'})),[])
 const damaged=bundledPhaseReferences({schema:'saaman-phase-profiles-1',profiles:{BAD:null,A320:{mach:Infinity,descentIas:-1,approachIas:240,landingIas:135,initialDescentToFeet:1e100}}})
 assert.equal(damaged.A320.mach,undefined);assert.equal(damaged.A320.descentIas,undefined);assert.equal(damaged.A320.initialDescentToFeet,undefined)
})

test('live engine uses a full-database type for both timing sections without a second buffer or slot recapture',()=>{
 const config=c(),flight=p({aircraft:'C25A',altitude:5000,groundspeed:240}),timestamp=2_000_000
 const input={timestamp,source:'ESSA_FMP',flights:[flight]},snapshot=runEngine(input,config,{}),first=snapshot.flights[0]
 assert.equal(first.landingPrediction.method,'aircraft-profile');assert.equal(first.landingPrediction.routeTiming.profile.type,'C25A')
 assert.equal(first.euroscopeBaseline.eta,timestamp+first.landingPrediction.routeTiming.seconds*1000)
 assert.equal(first.euroscopeBaseline.etaFf,timestamp+first.landingPrediction.routeTiming.feeder.seconds*1000)
 const nextInput={...input,timestamp:timestamp+2000,flights:[{...flight,groundspeed:200}]},next=runEngine(nextInput,config,{},snapshot).flights[0]
 assert.notEqual(next.liveBufferedEta,first.liveBufferedEta)
 assert.deepEqual(next.euroscopeBaseline,first.euroscopeBaseline);assert.equal(next.sta,first.sta);assert.equal(next.staFf,first.staFf)
 const at=timestamp+4000,recomputed=runEngine({...nextInput,timestamp:at},config,{TIMING:{recomputeAt:at}}, {...snapshot,flights:[next]}).flights[0]
 assert.equal(recomputed.euroscopeBaseline.at,at);assert.equal(recomputed.euroscopeBaseline.landingMethod,'aircraft-profile')
})

test('out-of-range telemetry declines the profile promptly and retains finite fallback timing',()=>{
 for(const extra of [{altitude:1e100},{altitude:Infinity},{groundspeed:1e100},{groundspeed:Infinity},{verticalSpeed:NaN},{positionAgeSeconds:NaN},{route:Array.from({length:513},()=>({name:'SA19R',seconds:60}))}]){
  const flight=p(extra)
  assert.equal(predictRouteTiming(flight,c()),undefined)
  const result=predictLanding(flight,c(),2)
  assert.ok(Number.isFinite(result.seconds)&&result.seconds>=0)
 }
 const input={timestamp:2_000_000,source:'ESSA_FMP',flights:[p({aircraft:'ZZZZ'})]},f=runEngine(input,c(),{}).flights[0]
 assert.notEqual(f.landingPrediction.method,'aircraft-profile');assert.ok(Number.isFinite(f.eta)&&Number.isFinite(f.etaFf))
})
