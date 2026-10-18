import {test} from 'node:test'
import assert from 'node:assert/strict'
import {runEngine,DEFAULT_CONFIG,wakeInterval} from '../src/maestro-engine.ts'
import {predictLanding} from '../src/maestro-landing-prediction.ts'
import {remainingRoute} from '../src/maestro-route-timing.ts'
import {gainDragEdits,swapFlightEdits} from '../src/maestro-operations.ts'
import {STAR_RUNWAYS} from '../src/maestro-star-prediction.ts'
import fixture from './fixtures/live-straight-in-resequence.json' with {type:'json'}
const now=Date.UTC(2026,9,18,11),config=()=>({...structuredClone(DEFAULT_CONFIG),active:['ESSA/01R'],unstableSeconds:0,minimumNewSeconds:0,frozenMinutes:0,euroscopeBufferMinutes:0,euroscopeSuperstableBufferMinutes:0,euroscopeHighSpeedBufferMinutes:0,rates:{...DEFAULT_CONFIG.rates,'ESSA/01R':96}})
const plane=(callsign,seconds=1200,feederSeconds=600)=>({callsign,aircraft:'A320',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'01R',route:[{name:'NILUG',seconds:feederSeconds}],landingSeconds:seconds,distanceNm:100,groundspeed:300,altitude:20000,positionAgeSeconds:0})
const packet=flights=>({source:'ESSA_FMP',timestamp:now,flights})
const queue=s=>s.flights.filter(f=>f.mode==='sequenced'&&!f.issue&&f.state<4).sort((a,b)=>a.order-b.order)
const flight=(s,c)=>s.flights.find(f=>f.callsign===c)
function evaluate(input,c,edits,previous){return runEngine(structuredClone(input),structuredClone(c),structuredClone(edits),{...structuredClone(previous),timestamp:input.timestamp-1})}
function recompute(input,c,previous,calls,edits={},stamp=now+1000){
 const next=structuredClone(edits)
 for(const call of calls)next[call]={...next[call],target:undefined,order:undefined,recomputeAt:stamp,changedAt:stamp,swapAt:undefined}
 return {snapshot:evaluate(input,c,next,previous),edits:next}
}
function spaced(s,c){const q=queue(s);for(let i=1;i<q.length;i++)assert.ok(q[i].sta-q[i-1].sta>=1000*Math.max(c.rates[`ESSA/${q[i].runway}`],wakeInterval(q[i-1].wake,q[i].wake,`ESSA/${q[i].runway}`,c))-1)}

for(const scenario of fixture.straight)for(const call of ['SAS66P','SAS77A'])test(`live frame ${scenario.frame}: direct UGJAM uses the aircraft profile to the runway`,()=>{
 const p=scenario.input.flights.find(f=>f.callsign===call),original=structuredClone(p),pred=predictLanding(p,scenario.config,2,undefined,scenario.input.timestamp)
 assert.equal(pred.method,'aircraft-profile');assert.equal(pred.reference,'threshold');assert.ok(pred.distanceNm>10&&pred.distanceNm<150)
 assert.equal(pred.routeTiming.feeder,undefined,'the bypassed NILUG route must not return')
 assert.ok(pred.seconds>pred.distanceNm/p.groundspeed*3600,'retain terminal slowdown')
 assert.deepEqual(p,original)
})

test('straight-in recovery works on every ESSA runway and rejects sideways, outbound, unknown or heading directs',()=>{
 for(const [runway,threshold] of Object.entries(STAR_RUNWAYS)){
  const h=threshold.heading*Math.PI/180,point=(along,cross=0)=>({latitude:threshold.latitude+(-along*Math.cos(h)-cross*Math.sin(h))/60,longitude:threshold.longitude+(-along*Math.sin(h)+cross*Math.cos(h))/(60*Math.cos(threshold.latitude*Math.PI/180))})
  const p={...plane('DIRECT'),runway,threshold,...point(65),direct:'FINAL',route:[{name:`SA${runway}`,seconds:-60,...threshold},{name:'FINAL',seconds:600,...point(14)},{name:'ESSA',seconds:900,...threshold}]}
  assert.ok(remainingRoute(p),runway)
  for(const change of [{assignedHeading:180},{direct:'UNKNOWN'},{route:[p.route[0],{...p.route[1],...point(14,8)},p.route[2]]},{route:[p.route[0],{...p.route[1],...point(-14)},p.route[2]]}])assert.equal(remainingRoute({...p,...change}),undefined)
 }
})

test('explicit group Recompute puts an earlier landing ahead of a selected Superstable slot even when the old gap cannot fit it',()=>{
 const c=config(),input=packet([plane('THY708',1500,180),plane('SAS77A',1700,600)]),first=runEngine(input,c,{})
 assert.equal(flight(first,'THY708').state,2)
 const updated=packet([plane('THY708',1500,180),plane('SAS77A',1442,600)])
 let {snapshot,edits}=recompute(updated,c,first,['THY708','SAS77A'])
 assert.deepEqual(queue(snapshot).map(f=>f.callsign),['SAS77A','THY708'])
 assert.equal(flight(snapshot,'SAS77A').sta,now+1442000);assert.equal(flight(snapshot,'THY708').sta,now+1538000)
 const expected=queue(snapshot).map(f=>[f.callsign,f.sta])
 for(let i=2;i<=5;i++){({snapshot,edits}=recompute(updated,c,snapshot,['THY708','SAS77A'],edits,now+i*1000));assert.deepEqual(queue(snapshot).map(f=>[f.callsign,f.sta]),expected);spaced(snapshot,c)}
})

test('idle updates and a partial Recompute leave an unselected Superstable time protected',()=>{
 const c=config(),input=packet([plane('THY708',1500,180),plane('SAS77A',1700,600)]),first=runEngine(input,c,{}),updated=packet([plane('THY708',1500,180),plane('SAS77A',1442,600)])
 const idle=evaluate(updated,c,{},first)
 assert.equal(flight(idle,'THY708').sta,flight(first,'THY708').sta)
 const {snapshot}=recompute(updated,c,first,['SAS77A'])
 assert.equal(flight(snapshot,'THY708').sta,flight(first,'THY708').sta);assert.ok(flight(snapshot,'SAS77A').order>flight(snapshot,'THY708').order)
})

test('real-session group Recompute gives the cleared straight-in aircraft landing-ETA order',()=>{
 const s=fixture.cases[0],original=structuredClone(s),snapshot=runEngine(s.input,s.config,s.edits,s.previous)
 assert.ok(flight(snapshot,'SAS77A').eta<flight(snapshot,'THY708').eta)
 assert.ok(flight(snapshot,'SAS77A').order<flight(snapshot,'THY708').order)
 assert.ok(flight(snapshot,'SAS66P').order<flight(snapshot,'SAS77A').order)
 spaced(snapshot,s.config);assert.deepEqual(s,original)
})

function swapped(){const c=config(),input=packet(['AA','BB','CC','DD'].map(c=>plane(c))),first=runEngine(input,c,{}),edits=swapFlightEdits(first,{},'AA','CC'),snapshot=evaluate(input,c,edits,first);return {c,input,edits,snapshot}}
test('after a swap, advancing the leader releases following delay in order without pulling anyone ahead of its ETA',()=>{
 const {c,input,edits,snapshot}=swapped(),copy=structuredClone({edits,snapshot}),leader=flight(snapshot,'CC'),next=gainDragEdits(snapshot,edits,'CC',leader.sta-60000,'Runway',c),moved=evaluate(input,c,next,snapshot)
 assert.deepEqual(queue(moved).map(f=>f.callsign),['CC','BB','AA','DD'])
 for(const call of ['BB','AA','DD']){assert.equal(flight(moved,call).sta,flight(snapshot,call).sta-60000,call);assert.ok(flight(moved,call).sta>=flight(moved,call).eta);assert.ok(flight(moved,call).delay<flight(snapshot,call).delay)}
 assert.equal(next.AA.target,undefined,'a swapped slot is not a permanent fixed-time boundary')
 const again=evaluate(input,c,next,moved)
 assert.deepEqual(queue(again).map(f=>[f.callsign,f.sta,f.delay]),queue(moved).map(f=>[f.callsign,f.sta,f.delay]))
 spaced(moved,c);assert.deepEqual({edits,snapshot},copy)
})

test('an earlier move stops releasing at an independently fixed time or Frozen aircraft',()=>{
 for(const boundary of ['fixed','frozen']){
  const {c,input,edits,snapshot}=swapped()
  if(boundary==='fixed')edits.BB={...edits.BB,target:flight(snapshot,'BB').sta,targetKind:'time',swapAt:undefined}
  else flight(snapshot,'BB').state=3
  const next=gainDragEdits(snapshot,edits,'CC',flight(snapshot,'CC').sta-60000,'Runway',c)
  assert.equal(next.BB.releaseDelayAt,undefined);assert.equal(next.AA.releaseDelayAt,undefined)
  const moved=evaluate(input,c,next,snapshot)
  assert.equal(flight(moved,'BB').sta,flight(snapshot,'BB').sta);assert.equal(flight(moved,'AA').sta,flight(snapshot,'AA').sta);spaced(moved,c)
 }
})

test('release respects closures and controller-inserted intervals',()=>{
 const {c,input,edits,snapshot}=swapped(),next=gainDragEdits(snapshot,edits,'CC',flight(snapshot,'CC').sta-60000,'Runway',c)
 next.BB.slotBefore=1
 c.slots=[{id:'closed',kind:'closure',runway:'ESSA/01R',begin:flight(snapshot,'CC').sta,end:flight(snapshot,'CC').sta+120000}]
 const moved=evaluate(input,c,next,snapshot)
 for(const f of queue(moved))assert.ok(f.sta<c.slots[0].begin||f.sta>=c.slots[0].end)
 assert.ok(flight(moved,'BB').sta-flight(moved,'CC').sta>=156000);spaced(moved,c)
})

test('a selected Superstable pair can be explicitly resequenced but Frozen traffic remains protected',()=>{
 const c=config(),input=packet([plane('THY708',1500,180),plane('SAS77A',1700,200)]),first=runEngine(input,c,{})
 assert.ok(first.flights.every(f=>f.state===2))
 const updated=packet([plane('THY708',1500,180),plane('SAS77A',1442,200)])
 const {snapshot}=recompute(updated,c,first,['THY708','SAS77A'])
 assert.deepEqual(queue(snapshot).map(f=>f.callsign),['SAS77A','THY708']);spaced(snapshot,c)
 const protectedFirst=structuredClone(first);flight(protectedFirst,'THY708').state=3
 const frozenConfig={...c,frozenMinutes:30}
 const {snapshot:protectedNext}=recompute(updated,frozenConfig,protectedFirst,['THY708','SAS77A'])
 assert.equal(queue(protectedNext)[0].callsign,'THY708');spaced(protectedNext,frozenConfig)
})

test('the live-session earlier drag advances THY708 and the delayed follower only as far as their current ETAs allow',()=>{
 const s=fixture.cases[0],recomputed=runEngine(s.input,s.config,s.edits,s.previous),leader=flight(recomputed,'SAS77A')
 const next=gainDragEdits(recomputed,s.edits,'SAS77A',leader.sta-60000,'Runway',s.config),moved=evaluate(s.input,s.config,next,recomputed)
 for(const call of ['THY708','SAS72C']){
  assert.ok(flight(moved,call).sta<flight(recomputed,call).sta,call)
  assert.ok(flight(moved,call).sta>=flight(moved,call).eta,call)
  assert.ok(flight(moved,call).delay<=flight(recomputed,call).delay,call)
 }
 assert.deepEqual(queue(moved).map(f=>f.callsign),queue(recomputed).map(f=>f.callsign));spaced(moved,s.config)
 const nextIdle=evaluate(s.input,s.config,next,moved)
 for(const call of ['THY708','SAS72C'])assert.equal(flight(nextIdle,call).sta,flight(moved,call).sta)
})

test('capacity release stops when the preceding slot does not actually advance',()=>{
 const {c,input,edits,snapshot}=swapped(),next=gainDragEdits(snapshot,edits,'CC',flight(snapshot,'CC').sta-60000,'Runway',c)
 next.CC.target=flight(snapshot,'CC').sta
 const held=evaluate(input,c,next,snapshot)
 for(const call of ['BB','AA','DD'])assert.equal(flight(held,call).sta,flight(snapshot,call).sta,call)
})

test('a follower whose live ETA has become late is not advanced or implicitly recomputed by another aircraft drag',()=>{
 const {c,input,edits,snapshot}=swapped(),next=gainDragEdits(snapshot,edits,'CC',flight(snapshot,'CC').sta-60000,'Runway',c)
 input.flights.find(f=>f.callsign==='BB').landingSeconds=1500
 const moved=evaluate(input,c,next,snapshot)
 assert.equal(flight(moved,'BB').sta,flight(snapshot,'BB').sta)
 assert.equal(flight(moved,'AA').sta,flight(snapshot,'AA').sta)
 assert.equal(flight(moved,'DD').sta,flight(snapshot,'DD').sta)
 spaced(moved,c)
})
