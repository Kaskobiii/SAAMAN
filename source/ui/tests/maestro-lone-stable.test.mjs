import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DEFAULT_CONFIG,runEngine,euroscopeInstruction} from '../src/maestro-engine.ts'

const now=Date.UTC(2026,9,20,12)
const config=()=>({...structuredClone(DEFAULT_CONFIG),unstableSeconds:0,minimumNewSeconds:0,active:['ESSA/19R'],departureRunway:'ESSA/19L'})
const plane={callsign:'LONE',aircraft:'A320',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'19R',route:[{name:'ELTOK',seconds:600}],landingSeconds:1500,distanceNm:100,groundspeed:300,altitude:25000,positionAgeSeconds:1}
const packet=(p=plane,elapsed=0)=>({source:'LIVE',timestamp:now+elapsed*1000,flights:[structuredClone(p)]})
const improved=(elapsed=2,extra={})=>({...plane,route:[{name:'ELTOK',seconds:480-elapsed}],landingSeconds:1230-elapsed,...extra})
const get=s=>s.flights.find(f=>f.callsign==='LONE')
const first=(c=config(),p=plane,edits={})=>runEngine(packet(p),c,edits)

test('a lone automatic Stable arrival adopts a consistent earlier landing/feeder pair without artificial work',()=>{
 const c=config();let s=first(c),capture=structuredClone(get(s).euroscopeBaseline),history=[get(s).initialEta,get(s).initialEtaFf]
 assert.equal(get(s).state,1);assert.equal(get(s).delay,0)
 for(const elapsed of [2,4,20,40,60]){
  s=runEngine(packet(improved(elapsed),elapsed),c,{},JSON.parse(JSON.stringify(s)));const f=get(s)
  assert.equal(f.state,1);assert.equal(f.sta,now+1350000);assert.equal(f.staFf,now+600000)
  assert.equal(f.delay,0);assert.equal(euroscopeInstruction(f),0);assert.equal(f.guidance.instructionSeconds,0)
  assert.equal(f.closureDelayMs,0);assert.equal(f.feederDelayMs,0);assert.deepEqual(f.euroscopeBaseline,capture)
  assert.deepEqual([f.initialEta,f.initialEtaFf],history)
 }
})

test('an earlier feeder forecast alone does not create work when the first runway slot is already available',()=>{
 const c=config(),s=first(c),p=improved(2,{landingSeconds:1498}),f=get(runEngine(packet(p,2),c,{},s))
 assert.equal(f.sta,get(s).sta);assert.equal(f.staFf,f.etaFf);assert.equal(f.delay,0)
})

test('the full aircraft performance model releases an unconstrained Stable pair while retaining its original capture',()=>{
 const c=config(),p={...plane,aircraft:'A20N',latitude:61,longitude:18,altitude:30000,groundspeed:300,verticalSpeed:0,positionAgeSeconds:0,
  route:[{name:'ELTOK',seconds:500,latitude:60.4,longitude:18},{name:'FI19R',seconds:900,latitude:59.8,longitude:17.95},{name:'SA19R',seconds:1000,latitude:59.6664,longitude:17.92377}],landingSeconds:1060,distanceNm:80}
 const s=first(c,p),old=get(s),f=get(runEngine(packet({...p,groundspeed:360},2),c,{},s))
 assert.equal(old.state,1);assert.equal(f.state,1);assert.equal(f.landingPrediction.method,'aircraft-profile')
 assert.ok(f.liveBufferedEta<old.sta);assert.ok(f.etaFf<old.staFf)
 assert.equal(f.sta,f.liveBufferedEta);assert.equal(f.staFf,f.etaFf);assert.equal(f.delay,0)
 assert.deepEqual(f.euroscopeBaseline,old.euroscopeBaseline)
})

test('stale positions and an unavailable feeder estimate cannot trigger the lone Stable release',()=>{
 const c=config(),s=first(c),old=get(s)
 const stale=get(runEngine(packet(improved(2,{positionAgeSeconds:16}),2),c,{},s))
 assert.equal(stale.lost,true);assert.equal(stale.sta,old.sta);assert.deepEqual(stale.euroscopeBaseline,old.euroscopeBaseline)
 const bypass=get(runEngine(packet(improved(2,{direct:'OTHER',route:[{name:'OTHER',seconds:200}]}),2),c,{},s))
 assert.equal(bypass.feederEtaAvailable,false);assert.equal(bypass.sta,old.sta);assert.equal(bypass.staFf,old.staFf)
})

test('an existing artificial first-slot instruction is repaired without recapturing its history',()=>{
 const c=config(),s=first(c),old=get(s);old.delay=300;old.sta+=300000;old.staFf+=300000
 old.guidance.scheduled=old.staFf
 const f=get(runEngine(packet(improved(),2),c,{},s))
 assert.equal(f.delay,0);assert.equal(f.sta,f.liveBufferedEta);assert.equal(f.staFf,f.etaFf)
 assert.deepEqual(f.euroscopeBaseline,old.euroscopeBaseline)
})

test('manual targets, explicit order and personal intervals retain their protection',()=>{
 for(const edit of [{target:now+1800000,targetKind:'time'},{order:0,orderExplicit:true},{slotBefore:2},{slotAfter:2}]){
  const c=config(),edits={LONE:edit},s=first(c,plane,edits),f=get(runEngine(packet(improved(),2),c,edits,s))
  assert.equal(f.sta,get(s).sta,JSON.stringify(edit));assert.equal(f.staFf,get(s).staFf,JSON.stringify(edit))
 }
 const c=config(),edits={LONE:{etaFfOverride:now+900000}},s=first(c,plane,edits),f=get(runEngine(packet(improved(),2),c,edits,s))
 assert.equal(f.etaFf,get(s).etaFf);assert.equal(f.feederObservationSource,'manual');assert.deepEqual(f.euroscopeBaseline,get(s).euroscopeBaseline)
})

test('runway gaps and closures retain the assigned slot instead of advancing through their blocked bank',()=>{
 for(const kind of ['gap','closure']){
  const c=config();c.slots=[{id:'BLOCK',runway:'ESSA/19R',begin:now+1200000,end:now+1800000,kind}]
  const s=first(c),f=get(runEngine(packet(improved(),2),c,{},s))
  assert.equal(f.sta,get(s).sta);assert.ok(f.sta>=c.slots[0].end);assert.ok(f.delay>0)
 }
})

test('a runway predecessor still requires real spacing after an improved Stable forecast',()=>{
 const c=config(),lead={...plane,callsign:'LEAD',route:[{name:'ELTOK',seconds:570}],landingSeconds:1470}
 const input={...packet(),flights:[lead,plane]},s=runEngine(input,c,{})
 const next=runEngine({...packet(improved(),2),flights:[{...lead,landingSeconds:1468,route:[{name:'ELTOK',seconds:568}]},improved()]},c,{},s)
 const a=next.flights.find(f=>f.callsign==='LEAD'),b=get(next)
 assert.ok(b.sta-a.sta>=c.rates['ESSA/19R']*1000-1);assert.ok(b.delay>0)
})

test('a feeder reservation on the secondary runway prevents an overlapping automatic release',()=>{
 const c=config(),other={...plane,callsign:'OTHER',runway:'19L',route:[{name:'ELTOK',seconds:480}],landingSeconds:1230}
 const edits={OTHER:{target:now+1350000,targetKind:'time',runway:'ESSA/19L'}}
 const input={...packet(),flights:[plane,other]},s=runEngine(input,c,edits)
 const next=runEngine({...packet(improved(),2),flights:[improved(),{...other,landingSeconds:1228,route:[{name:'ELTOK',seconds:478}]}]},c,edits,s)
 const a=next.flights.find(f=>f.callsign==='OTHER'),b=get(next)
 assert.ok(Math.abs(a.staFf-b.staFf)>=Math.max(c.rates['ESSA/19R'],c.rates['ESSA/19L'])*1000-1)
 assert.ok(b.delay>0)
})

test('TopSky HOLD, paused observations and accepted Superstable/Frozen flights do not receive the lone repair',()=>{
 const c=config(),s=first(c),held=get(runEngine(packet(improved(2,{topskyHoldingPoint:'ELTOK'}),2),c,{},s))
 assert.equal(held.sta,get(s).sta);assert.equal(held.staFf,get(s).staFf)
 const positioned={...plane,latitude:60.15,longitude:16.2,heading:130},start=first(c,positioned)
 const waiting=runEngine(packet({...positioned,landingSeconds:1490,route:[{name:'ELTOK',seconds:590}]},10),c,{},start)
 const pause=get(runEngine(packet(improved(22,{latitude:60.15,longitude:16.2,heading:130}),22),c,{},waiting))
 assert.equal(pause.motionTiming.held,true);assert.equal(pause.sta,get(start).sta);assert.equal(pause.delay,get(start).delay)
 for(const [p,nextP,state] of [
  [{...plane,route:[{name:'ELTOK',seconds:120}],landingSeconds:900},{...plane,route:[{name:'ELTOK',seconds:60}],landingSeconds:700},2],
  [{...plane,route:[{name:'ELTOK',seconds:30}],landingSeconds:120},{...plane,route:[{name:'ELTOK',seconds:10}],landingSeconds:90},3]
 ]){
  const initial=first(c,p),next=get(runEngine(packet(nextP,2),c,{},initial))
  assert.equal(get(initial).state,state);assert.equal(next.state,state);assert.equal(next.sta,get(initial).sta)
 }
})
