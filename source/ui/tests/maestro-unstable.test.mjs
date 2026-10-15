import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DEFAULT_CONFIG,runEngine} from '../src/maestro-engine.ts'
import fixture from './fixtures/recording-10-unstable.json' with {type:'json'}
const now=Date.UTC(2026,9,15,17)
const config=()=>({...structuredClone(DEFAULT_CONFIG),unstableSeconds:0,minimumNewSeconds:0})
const flight=(extra={})=>({callsign:'FIRST',aircraft:'B38M',wake:'M',departure:'ESNS',arrival:'ESSA',runway:'19R',route:[{name:'VACRA',seconds:1600}],landingSeconds:2400,distanceNm:200,groundspeed:300,altitude:20000,positionAgeSeconds:0,...extra})
const packet=(flights,timestamp=now)=>({source:'ESSA_FMP',timestamp,flights})

test('recording 10 NSZ4052 stays delay-free through acceleration and fallback-to-profile change',()=>{
 let previous
 for(const {input,config} of fixture.frames){
  const snapshot=runEngine(input,config,{},previous),f=snapshot.flights[0]
  assert.equal(f.state,0);assert.equal(f.issue,'');assert.equal(f.sta,f.liveBufferedEta)
  assert.equal(f.staFf,f.etaFf);assert.equal(f.delay,0)
  if(previous)assert.deepEqual(f.euroscopeBaseline,previous.flights[0].euroscopeBaseline)
  previous=JSON.parse(JSON.stringify(snapshot))
 }
 const last=previous.flights[0]
 assert.equal(last.landingPrediction.method,'aircraft-profile')
 assert.equal(new Date(last.staFf).toISOString().slice(11,19),'17:57:33')
 assert.equal(fixture.frames.at(-1).recordedDelay,488,'original recording displayed L08')
})

for(const [seconds,delay,feeder,state] of [[2198,0,1398,0],[2298,15,1498,0],[2298,15,700,1]])
test(`a later-discovered ${state===1?'Stable':'Unstable'} arrival enters ahead and imposes only ${delay} seconds of real spacing`,()=>{
 const c=config(),p=flight(),first=runEngine(packet([p]),c,{})
 const updated={...p,landingSeconds:2398,route:[{name:'VACRA',seconds:1598}]}
 const newcomer=flight({callsign:'NEW',landingSeconds:seconds,route:[{name:'ELTOK',seconds:feeder}]})
 const next=runEngine(packet([updated,newcomer],now+2000),c,{},first)
 const a=next.flights.find(f=>f.callsign==='FIRST'),b=next.flights.find(f=>f.callsign==='NEW')
 assert.equal(a.state,0);assert.equal(b.state,state);assert.equal(b.order,0);assert.equal(a.order,1)
 assert.equal(b.sta,b.eta);assert.equal(a.delay,delay);assert.equal(a.sta-a.eta,delay*1000)
 assert.ok(a.sta-b.sta>=c.rates['ESSA/19R']*1000)
 assert.deepEqual(a.euroscopeBaseline,first.flights[0].euroscopeBaseline)
})

test('Unstable closure delay disappears when its actual constraint is removed',()=>{
 const c=config(),p=flight(),first=runEngine(packet([p]),c,{})
 const blocked={...c,slots:[{id:'CLOSE',runway:'ESSA/19R',begin:now+2500000,end:now+2700000}]}
 const held=runEngine(packet([{...p,landingSeconds:2398,route:[{name:'VACRA',seconds:1598}]}],now+2000),blocked,{},first).flights[0]
 assert.equal(held.sta,now+2700000);assert.equal(held.delay,180)
 const next=runEngine(packet([{...p,landingSeconds:2396,route:[{name:'VACRA',seconds:1596}]}],now+4000),c,{}, {...first,timestamp:now+2000,flights:[held]}).flights[0]
 assert.equal(next.sta,next.eta);assert.equal(next.staFf,next.etaFf);assert.equal(next.delay,0)
})

test('an explicit Unstable target keeps its time and real instruction as the forecast changes',()=>{
 const c=config(),p=flight(),first=runEngine(packet([p]),c,{})
 const target=now+2800000,edits={FIRST:{target,targetKind:'time',changedAt:now+2000}}
 const held=runEngine(packet([p],now+2000),c,edits,first)
 const next=runEngine(packet([{...p,landingSeconds:2200,route:[{name:'VACRA',seconds:1400}]}],now+4000),c,edits,held).flights[0]
 assert.equal(next.sta,target);assert.deepEqual(next.euroscopeBaseline,first.flights[0].euroscopeBaseline)
 assert.equal(next.staFf,held.flights[0].staFf)
})

test('Stable begins at the final provisional times and then preserves those assignments',()=>{
 const c=config(),p=flight(),first=runEngine(packet([p]),c,{})
 const stable=runEngine(packet([{...p,landingSeconds:1700,route:[{name:'VACRA',seconds:700}]}],now+2000),c,{},first)
 const a=stable.flights[0]
 assert.equal(a.state,1);assert.equal(a.sta,a.eta);assert.equal(a.staFf,a.etaFf);assert.equal(a.delay,0)
 const next=runEngine(packet([{...p,landingSeconds:1600,route:[{name:'VACRA',seconds:600}]}],now+4000),c,{},JSON.parse(JSON.stringify(stable))).flights[0]
 assert.equal(next.state,1);assert.equal(next.sta,a.sta);assert.equal(next.staFf,a.staFf)
 assert.deepEqual(next.euroscopeBaseline,first.flights[0].euroscopeBaseline)
})

test('stale or unusable Unstable telemetry cannot restore an obsolete captured target',()=>{
 const c=config(),p=flight(),first=runEngine(packet([p]),c,{})
 const valid=runEngine(packet([{...p,landingSeconds:2000,route:[{name:'VACRA',seconds:1200}]}],now+2000),c,{},first),a=valid.flights[0]
 for(const extra of [{groundspeed:20},{positionAgeSeconds:16}]){
  const next=runEngine(packet([{...p,...extra}],now+4000),c,{},valid).flights[0]
  assert.equal(next.eta,a.eta);assert.equal(next.sta,a.sta);assert.equal(next.staFf,a.staFf)
 }
})
