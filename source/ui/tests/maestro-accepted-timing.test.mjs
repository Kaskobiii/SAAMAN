import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DEFAULT_CONFIG,runEngine,controllerInstructionSeconds} from '../src/maestro-engine.ts'
const now=Date.UTC(2026,9,25,22),ms=1000
const config=()=>({...structuredClone(DEFAULT_CONFIG),unstableSeconds:0,minimumNewSeconds:0,active:['ESSA/19L'],departureRunway:'ESSA/19R'})
const base={callsign:'TEST',aircraft:'A320',wake:'M',departure:'EPWA',arrival:'ESSA',runway:'19L',groundspeed:300,altitude:25000,positionAgeSeconds:0,distanceNm:100}
const plane=(elapsed,feeder=478,landing=1918,extra={})=>({...base,landingSeconds:landing,route:[{name:'NILUG',seconds:feeder}],...extra})
const input=(elapsed,p)=>({source:'ESSA_FMP',timestamp:now+elapsed*ms,flights:Array.isArray(p)?p:[p]})
const row=(s,name='TEST')=>s.flights.find(f=>f.callsign===name)
function released(c=config(),lead){
 const first=runEngine(input(0,[...(lead?[lead]:[]),plane(0,600,2400)]),c,{})
 const next=runEngine(input(2,[...(lead?[{...lead,landingSeconds:lead.landingSeconds-2,route:lead.route.map(q=>({...q,seconds:q.seconds-2}))}]:[]),plane(2)]),c,{},first)
 return {c,first,next}
}
function promoted(c,previous,elapsed=4,lead){return runEngine(input(elapsed,[...(lead?[{...lead,landingSeconds:lead.landingSeconds-elapsed,route:lead.route.map(q=>({...q,seconds:q.seconds-elapsed}))}]:[]),plane(elapsed,104-elapsed,1504-elapsed)]),c,{},JSON.parse(JSON.stringify(previous)))}

test('a released Stable pair survives filtering, Superstable promotion and a benign arrival-rate change',()=>{
 const {c,first,next}=released(),original=structuredClone(row(first).euroscopeBaseline)
 assert.equal(row(next).sta,now+2040000);assert.equal(row(next).planningEta,now+2040000)
 let s=next
 for(const elapsed of [20,40,60]){
  s=runEngine(input(elapsed,plane(elapsed,480-elapsed,1920-elapsed)),c,{},JSON.parse(JSON.stringify(s)))
  assert.equal(row(s).state,1);assert.equal(row(s).sta,now+2040000);assert.equal(row(s).planningEta,now+2040000)
  assert.equal(row(s).stableTiming.etaFf,now+600000);assert.deepEqual(row(s).euroscopeBaseline,original)
 }
 s=promoted(c,s,62);assert.equal(row(s).state,2);const accepted=structuredClone(row(s))
 const changed={...c,rates:{...c.rates,'ESSA/19L':120}}
 for(const elapsed of [64,80,100]){
  s=promoted(changed,s,elapsed)
  assert.equal(row(s).sta,accepted.sta);assert.equal(row(s).staFf,accepted.staFf)
  assert.equal(row(s).delay,0);assert.equal(controllerInstructionSeconds(row(s)),0)
  assert.equal(row(s).planningEta,now+2040000);assert.deepEqual(row(s).euroscopeBaseline,original)
 }
})

test('the accepted Stable forecast stays demand while a real leader and a slower rate still add required spacing',()=>{
 const c=config(),lead={...base,callsign:'LEAD',route:[{name:'ELTOK',seconds:100}],landingSeconds:1920}
 const {first,next}=released(c,lead),leader=row(next,'LEAD'),old=row(next)
 assert.ok(old.sta>old.stableTiming.eta);assert.ok(old.sta<row(first).sta)
 let s=promoted(c,next,4,lead),before=row(s)
 const changed={...c,rates:{...c.rates,'ESSA/19L':180}}
 s=promoted(changed,s,6,lead);const f=row(s),a=row(s,'LEAD')
 assert.ok(f.sta>=a.sta+180000);assert.ok(f.sta>before.sta)
 assert.ok(f.sta<row(first).sta);assert.equal(f.planningEta,now+2040000)
 assert.ok(f.delay>0);assert.equal(f.staFf,f.sta-(f.stableTiming.eta-f.stableTiming.etaFf))
})

test('adding and removing a real runway closure cannot restore the old initial prediction',()=>{
 const {c,first,next}=released(),old=row(next),blocked={...c,slots:[{id:'BLOCK',kind:'closure',runway:'ESSA/19L',begin:old.sta-1000,end:old.sta+120000}]}
 let s=promoted(c,next)
 s=promoted(blocked,s,6);assert.ok(row(s).sta>=blocked.slots[0].end);assert.ok(row(s).delay>0)
 s=promoted(c,s,8);assert.equal(row(s).sta,old.sta);assert.equal(row(s).staFf,old.staFf)
 assert.equal(row(s).delay,0);assert.deepEqual(row(s).euroscopeBaseline,row(first).euroscopeBaseline)
})

test('Recompute accepts a new planning baseline and retires the old accepted Stable pair',()=>{
 const {c,next}=released(),p=plane(4,100,1500),at=now+4000
 const s=runEngine(input(4,p),c,{TEST:{recomputeAt:at,changedAt:at}},JSON.parse(JSON.stringify(next))),f=row(s)
 assert.equal(f.euroscopeBaseline.at,at);assert.equal(f.stableTiming,undefined)
 assert.equal(f.sta,f.liveBufferedEta);assert.equal(f.planningEta,f.euroscopeBaseline.eta)
})

test('a manual time remains authoritative after earlier automatic timing and later rate changes',()=>{
 const {c,next}=released(),target=now+2300000,edits={TEST:{target,targetKind:'time',changedAt:now+4000}}
 const manual=runEngine(input(4,plane(4,100,1500)),c,edits,next)
 const changed={...c,rates:{...c.rates,'ESSA/19L':180}},s=runEngine(input(6,plane(6,98,1498)),changed,edits,manual)
 assert.equal(row(manual).sta,target);assert.equal(row(s).sta,target);assert.equal(row(s).order,row(manual).order)
})

test('a feeder HOLD keeps its protected delivery slots through accepted-pair persistence',()=>{
 const {c,next}=released(),held=plane(4,100,1500,{topskyHoldingPoint:'NILUG'})
 let s=runEngine(input(4,held),c,{},next),old=structuredClone(row(s))
 s=runEngine(input(24,{...held,landingSeconds:1480,route:[{name:'NILUG',seconds:80}]}),c,{},JSON.parse(JSON.stringify(s)))
 assert.equal(row(s).sta,old.sta);assert.equal(row(s).staFf,old.staFf)
 assert.deepEqual(row(s).stableTiming,old.stableTiming);assert.deepEqual(row(s).euroscopeBaseline,old.euroscopeBaseline)
})

test('a changed flight identity, feeder or baseline cannot inherit an old Stable pair',()=>{
 const {c,next}=released()
 for(const patch of [{departure:'EDDF'},{runway:'19R'},{route:[{name:'ELTOK',seconds:100}]}]){
  const previous=JSON.parse(JSON.stringify(next)),p=plane(4,100,1500,patch)
  // Feeders normally remain remembered. A genuinely replaced feeder must be
  // explicitly identified by its new route and prior route identity together.
  if(patch.route){row(previous).ff='ELTOK';row(previous).feeder='ELTOK';row(previous).feederId='E'}
  const f=row(runEngine(input(4,p),c,{},previous))
  assert.equal(f.stableTiming,undefined,JSON.stringify(patch))
 }
 const previous=JSON.parse(JSON.stringify(next));row(previous).stableTiming.baselineAt-=1
 assert.equal(row(runEngine(input(4,plane(4,100,1500)),c,{},previous)).stableTiming,undefined)
})
