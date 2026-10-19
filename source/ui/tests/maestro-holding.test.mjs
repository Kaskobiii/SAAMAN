import test from 'node:test'
import assert from 'node:assert/strict'
import {runEngine,DEFAULT_CONFIG,euroscopeInstruction,toTopSkySequence,validateTelemetry} from '../src/maestro-engine.ts'
import {observedFeeder} from '../src/maestro-arrival-route.ts'
const now=Date.UTC(2026,9,19,12),fix={latitude:59.824444,longitude:16.989917}
const config={...structuredClone(DEFAULT_CONFIG),active:['ESSA/19R'],departureRunway:'ESSA/19L',unstableSeconds:0,minimumNewSeconds:0}
const plane={callsign:'SAS456',aircraft:'A320',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'19R',groundspeed:250,altitude:10000,distanceNm:40,heading:90,positionAgeSeconds:0,latitude:fix.latitude+.03,longitude:fix.longitude,route:[{name:'ELTOK',seconds:60,...fix},{name:'TEB',seconds:600}],landingSeconds:1000}
const packet=(at,p=plane)=>({source:'ESOS_1_CTR',timestamp:at,flights:[structuredClone(p)]})
const get=s=>s.flights.find(f=>f.callsign==='SAS456')

test('TopSky feeder hold retains its assigned crossing and counts down line 0 across fix passage and checkpoint reload',()=>{
 let s=runEngine(packet(now),config,{})
 const initial=get(s),target=initial.sta+now+360000-initial.staFf
 const edits={SAS456:{target,targetKind:'time',changedAt:now+1000}}
 s=runEngine(packet(now+1000),config,edits,s)
 const slot=get(s).staFf
 assert.ok(Math.abs(slot-(now+360000))<1000)
 const held={...plane,...fix,topskyHoldingPoint:'ELTOK',route:[{name:'ELTOK',seconds:-1,...fix},{name:'TEB',seconds:600}]}
 let previousInstruction=Infinity
 for(const elapsed of [2,20,62,122,182]){
  s=runEngine(packet(now+elapsed*1000,held),config,edits,JSON.parse(JSON.stringify(s)))
  const f=get(s),instruction=euroscopeInstruction(f)
  assert.equal(f.passedFeeder,false);assert.equal(f.line0Suppressed,false);assert.equal(f.feederObservationSource,'holding')
  assert.equal(f.staFf,slot,'hold turns cannot silently release its assigned feeder slot')
  assert.ok(instruction>0&&instruction<=previousInstruction);previousInstruction=instruction
  assert.ok(toTopSkySequence(s,config,edits).sequence.some(row=>row.callsign==='SAS456'))
 }
 assert.ok(euroscopeInstruction(get(s))<190,'time flown is absorbed rather than retaining L05 forever')
 const released=runEngine(packet(now+183000,{...held,topskyHoldingPoint:''}),config,edits,s)
 assert.equal(get(released).passedFeeder,true);assert.equal(euroscopeInstruction(get(released)),0)
 assert.ok(!toTopSkySequence(released,config,edits).sequence.some(row=>row.callsign==='SAS456'))
})

test('only a fresh hold at the actual feeder can block passage; internal-TMA and far-away holds do not',()=>{
 const base={...plane,...fix,route:[{name:'ELTOK',seconds:-1,...fix}]}
 for(const changes of [{topskyHoldingPoint:'TEB'},{topskyHoldingPoint:'ELTOK',positionAgeSeconds:20},{topskyHoldingPoint:''}]){
  const p={...base,...changes},r=observedFeeder(p,undefined,now,config)
  assert.notEqual(r.source,'holding')
 }
 assert.notEqual(observedFeeder({...base,latitude:60.5,topskyHoldingPoint:'ELTOK'},undefined,now,config).source,'holding')
 assert.equal(observedFeeder({...base,topskyHoldingPoint:'ELTOK'},undefined,now,config).passed,false)
 assert.throws(()=>validateTelemetry(packet(now,{...base,topskyHoldingPoint:true}),now),/holding point/)
})

test('a feeder HOLD restores line 0 after geometric passage and still reserves its feeder slot',()=>{
 let s=runEngine(packet(now),config,{})
 const initial=get(s),target=initial.sta+now+360000-initial.staFf,edits={SAS456:{target,targetKind:'time',changedAt:now+1000}}
 s=runEngine(packet(now+1000),config,edits,s)
 const slot=get(s).staFf,crossed={...plane,...fix,route:[{name:'ELTOK',seconds:-1,...fix}]}
 s=runEngine(packet(now+2000,crossed),config,edits,s)
 assert.equal(get(s).passedFeeder,true);assert.equal(euroscopeInstruction(get(s)),0)
 const at=now+3000,p={...crossed,topskyHoldingPoint:'ELTOK'}
 s=runEngine({...packet(at,p),flights:[p,{...plane,callsign:'FOLLOWER',landingSeconds:1200}]},config,edits,s)
 const held=get(s),other=s.flights.find(f=>f.callsign==='FOLLOWER')
 assert.equal(held.passedFeeder,false);assert.equal(held.staFf,slot);assert.ok(euroscopeInstruction(held)>300)
 assert.ok(Math.abs(held.staFf-other.staFf)>=config.rates['ESSA/19R']*1000-1,'a hold crossing must retain a distinct feeder reservation')
})
