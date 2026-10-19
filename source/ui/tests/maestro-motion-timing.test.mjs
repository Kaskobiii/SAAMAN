import {test} from 'node:test'
import assert from 'node:assert/strict'
import {motionTiming} from '../src/maestro-motion-timing.ts'
import {runEngine} from '../src/maestro-engine.ts'
import {SessionRecording,decodeRecording} from '../src/maestro-recording.ts'
import fixture from './fixtures/sas055-low-capture.json' with {type:'json'}

const start=fixture.inputs[0].timestamp
const sas=s=>s.flights.find(f=>f.callsign==='SAS055')
function replay(config=fixture.config,edits={},initial=fixture.initial){
 let s=structuredClone(initial);const rows=[]
 for(const input of fixture.inputs.slice(1)){s=runEngine(input,config,edits,s);rows.push(s)}
 return rows
}
const track=(extra={})=>({latitude:59.4,longitude:16.1,altitude:25000,groundspeed:300,wake:'M',positionAgeSeconds:0,departure:'ESGG',arrival:'ESSA',...extra})

test('SAS055 replaces its 75 kt initial capture after confirmed movement, without Recompute or changing order',()=>{
 const rows=replay(),changed=rows.filter(s=>sas(s).initialProfile?.appliedAt===s.timestamp)
 assert.equal(changed.length,1)
 const f=sas(changed[0]),last=sas(rows.at(-1)),original=sas(fixture.initial)
 assert.equal(f.initialProfile.reason,'motion');assert.equal(f.state,1);assert.equal(f.order,original.order)
 assert.ok(f.euroscopeBaseline.at>original.euroscopeBaseline.at)
 assert.equal(f.initialEta,original.initialEta);assert.equal(f.recomputedAt,0)
 assert.ok(Math.abs(last.delay)<30);assert.ok(Math.abs(last.sta-last.eta)<30000)
 for(const s of rows){const p=sas(s),leader=s.flights.find(f=>f.callsign===p.separation?.leader);if(leader)assert.ok(p.sta>=leader.sta+96000-1)}
})

test('repair cannot override a manual arrival time or a real closure',()=>{
 const target=start+35*60000
 const manual=replay(fixture.config,{SAS055:{target,targetKind:'time',changedAt:start}})
 assert.ok(manual.every(s=>sas(s).sta>=target));assert.ok(manual.every(s=>!sas(s).initialProfile?.appliedAt))
 const end=start+30*60000,c={...fixture.config,slots:[{id:'REAL',runway:'ESSA/19L',begin:start+18*60000,end}]}
 const rows=replay(c),last=sas(rows.at(-1))
 assert.ok(last.sta>=end);assert.ok(last.delay>0)
})

test('repair does not run for Superstable history or an explicit feeder sequence',()=>{
 const initial=structuredClone(fixture.initial);sas(initial).state=2
 assert.ok(replay(fixture.config,{},initial).every(s=>!sas(s).initialProfile?.appliedAt))
 assert.ok(replay(fixture.config,{SAS055:{order:3,orderExplicit:true,changedAt:start}}).every(s=>!sas(s).initialProfile?.appliedAt))
})

test('fresh stationary airborne reports are held after 20 seconds even with normal reported GS',()=>{
 let old={...track(),lastSeen:start,state:1,euroscopeBaseline:{at:start}}
 for(const elapsed of [5,10,15,20,25,30]){
  const p=track(),at=start+elapsed*1000,result=motionTiming(p,old,at)
  assert.equal(result.held,elapsed>=20)
  old={...old,...p,lastSeen:at,motionTiming:result.state}
 }
})

test('low-speed airborne samples are rejected immediately and recovery requires sustained movement',()=>{
 let old={...track(),lastSeen:start,state:1,euroscopeBaseline:{at:start}}
 for(const elapsed of [5,10,15]){
  const p=track({groundspeed:0}),at=start+elapsed*1000,result=motionTiming(p,old,at)
  assert.equal(result.held,true);old={...old,...p,lastSeen:at,motionTiming:result.state}
 }
 // Preserve state through the same JSON boundary used by shared checkpoints.
 old=JSON.parse(JSON.stringify(old))
 for(const [elapsed,longitude,held] of [[20,16.12,true],[25,16.14,true],[30,16.16,false]]){
  const p=track({longitude}),at=start+elapsed*1000,result=motionTiming(p,old,at)
  assert.equal(result.held,held);old={...old,...p,lastSeen:at,motionTiming:result.state}
 }
})

test('a paused track retains its credible ETAs, slot and instruction while manual timing edits remain usable',()=>{
 let s=structuredClone(fixture.initial);const initial=sas(s),expected=initial.delay
 for(let i=1;i<=12;i++){
  const input=structuredClone(fixture.inputs[0]);input.timestamp=start+i*5000
  const p=input.flights.find(p=>p.callsign==='SAS055');p.groundspeed=0;p.positionAgeSeconds=0
  s=runEngine(input,fixture.config,{},s);const f=sas(s)
  assert.equal(f.motionTiming.held,true);assert.equal(f.eta,initial.eta);assert.equal(f.etaFf,initial.etaFf)
  assert.equal(f.sta,initial.sta);assert.equal(f.delay,expected);assert.equal(f.state,initial.state);assert.equal(f.issue,'')
 }
 const input=structuredClone(fixture.inputs[0]);input.timestamp=start+65000
 input.flights.find(p=>p.callsign==='SAS055').groundspeed=0
 const target=initial.sta+60000
 s=runEngine(input,fixture.config,{SAS055:{target,targetKind:'time',changedAt:input.timestamp}},s)
 assert.equal(sas(s).sta,target);assert.equal(sas(s).issue,'')
 assert.ok(Math.abs(sas(s).delay-(expected+60))<=1,'manual drag changes the instruction by its actual slot change')
 const baseline=structuredClone(sas(s).euroscopeBaseline)
 input.timestamp+=5000
 s=runEngine(input,fixture.config,{SAS055:{recomputeAt:input.timestamp,changedAt:input.timestamp}},s)
 assert.deepEqual(sas(s).euroscopeBaseline,baseline,'Recompute must not capture the paused zero-speed sample')
 assert.equal(sas(s).state,initial.state);assert.equal(sas(s).issue,'')
})

test('moving holds, stale tracks and landing rollout are not classified as pauses',()=>{
 let old={...track(),lastSeen:start,state:2,euroscopeBaseline:{at:start}}
 for(const [i,latitude,longitude] of [[1,59.41,16.1],[2,59.41,16.12],[3,59.4,16.12],[4,59.4,16.1],[5,59.41,16.1]]){
  const p=track({latitude,longitude,groundspeed:230,altitude:10000,topskyHoldingPoint:'ELTOK'}),at=start+i*10000,result=motionTiming(p,old,at)
  assert.equal(result.held,false);old={...old,...p,lastSeen:at,motionTiming:result.state}
 }
 assert.equal(motionTiming(track({positionAgeSeconds:30}),old,start+60000).held,false)
 assert.equal(motionTiming(track({altitude:100,groundspeed:30}),old,start+60000).held,false)
})

test('recordings retain the TopSky holding flag needed to replay motion and feeder guidance',()=>{
 const s=structuredClone(fixture.initial);sas(s).topskyHoldingPoint='ELTOK'
 const recorder=new SessionRecording();recorder.start(s,fixture.config,{})
 const decoded=decodeRecording(recorder.export())
 assert.equal(decoded[0].input.flights.find(p=>p.callsign==='SAS055').topskyHoldingPoint,'ELTOK')
})

test('a genuinely slow moving light aircraft is not rejected for its groundspeed',()=>{
 let old={...track({groundspeed:75,wake:'L',altitude:7000}),lastSeen:start,state:1,euroscopeBaseline:{at:start}}
 for(let i=1;i<=8;i++){
  const p=track({groundspeed:75,wake:'L',altitude:7000,longitude:16.1+i*.007}),at=start+i*10000,result=motionTiming(p,old,at)
  assert.equal(result.held,false);old={...old,...p,lastSeen:at,motionTiming:result.state}
 }
})

test('the stationary guard freezes timing even when a paused simulator keeps reporting normal GS',()=>{
 let s=structuredClone(fixture.initial);let heldEta
 for(let i=1;i<=10;i++){
  const input=structuredClone(fixture.inputs[0]);input.timestamp=start+i*5000
  s=runEngine(input,fixture.config,{},s);const f=sas(s)
  if(f.motionTiming.held){heldEta??=f.eta;assert.equal(f.eta,heldEta);assert.equal(f.issue,'');assert.equal(f.state,1)}
 }
 assert.ok(heldEta)
})
