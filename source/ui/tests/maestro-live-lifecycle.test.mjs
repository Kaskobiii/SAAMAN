import test from 'node:test'
import assert from 'node:assert/strict'
import {runEngine,controllerInstructionSeconds} from '../src/maestro-engine.ts'
import {liveFlightLifecycle,pruneRetiredLiveEdits} from '../src/maestro-live-lifecycle.ts'
import {retainHandoverClearances} from '../src/maestro-telemetry-continuity.ts'
import fixture from './fixtures/live-callsign-handover-1342.json' with {type:'json'}
const copy=x=>structuredClone(x)
const get=(s,c)=>s.flights.find(f=>f.callsign===c)

for(const c of fixture.examples)test(`${c.callsign}: a later live flight does not inherit the recorded days-old controller edit`,()=>{
 const s=runEngine(c.input,c.config,c.edits),p=get(s,c.callsign)
 assert.equal(p.mode,'sequenced');assert.equal(p.issue,'');assert.ok(p.state<3)
 assert.ok(p.sta>=c.input.timestamp);assert.ok(Math.abs(controllerInstructionSeconds(p))<600)
 assert.equal(pruneRetiredLiveEdits(c.edits,s)[c.callsign],undefined)
 assert.equal(c.edits[c.callsign].changedAt<c.input.timestamp,true)
})

test('retirement survives serialization, but does not delete a fresh controller edit',()=>{
 const c=fixture.examples[0],s=runEngine(c.input,c.config,c.edits),next={...c.edits,[c.callsign]:{target:s.timestamp+3600000,changedAt:s.timestamp}}
 assert.equal(pruneRetiredLiveEdits(c.edits,copy(s))[c.callsign],undefined)
 assert.deepEqual(pruneRetiredLiveEdits(next,copy(s)),next)
 const again=runEngine({...c.input,timestamp:s.timestamp+2000},c.config,c.edits,copy(s))
 assert.equal(get(again,c.callsign).firstSeen,get(s,c.callsign).firstSeen)
 assert.ok(get(again,c.callsign).state<3)
})

test('a continuously observed flight and a short reconnect retain valid controller intent',()=>{
 const c=fixture.examples[0],s=runEngine(c.input,c.config,{}),p=get(s,c.callsign),now=s.timestamp+60000
 p.firstSeen=now-8*3600000
 const edits={[p.callsign]:{target:now+3600000,mode:'desequenced',changedAt:now-7*3600000}}
 const r=liveFlightLifecycle({...c.input,timestamp:now},edits,s)
 assert.deepEqual(r.edits,edits);assert.equal(r.previous,s)
 const missing={...s,flights:[],transientFlights:{[p.callsign]:p}}
 assert.deepEqual(liveFlightLifecycle({...c.input,timestamp:now},edits,missing).edits,edits)
})

test('a fresh mode change cannot revive an expired absolute target from an earlier date',()=>{
 const c=fixture.examples[0],oldTarget=c.edits[c.callsign].target
 const edits={[c.callsign]:{target:oldTarget,targetKind:'time',mode:'desequenced',changedAt:c.input.timestamp-1000}}
 const r=liveFlightLifecycle(c.input,edits)
 assert.equal(r.edits[c.callsign].target,undefined);assert.equal(r.edits[c.callsign].mode,'desequenced')
 assert.equal(r.edits[c.callsign].changedAt,edits[c.callsign].changedAt)
})

test('a recently reused callsign cannot receive an impossible past target from its previous approach',()=>{
 const c=fixture.examples[0],edits={[c.callsign]:{target:c.input.timestamp-10*60000,mode:'desequenced',changedAt:c.input.timestamp-15*60000}}
 const r=liveFlightLifecycle(c.input,edits)
 assert.equal(r.edits[c.callsign].target,undefined);assert.equal(r.edits[c.callsign].mode,'desequenced')
})

test('changed flight identity retires earlier-flight mode, target and timing history together',()=>{
 const c=fixture.examples[0],s=runEngine(c.input,c.config,{}),p=get(s,c.callsign),t=s.timestamp+2000
 const input={...c.input,timestamp:t,flights:[{...c.input.flights[0],departure:'EGLL'}]},edits={[p.callsign]:{mode:'missed',changedAt:s.timestamp-1000,target:s.timestamp+400000}}
 const r=liveFlightLifecycle(input,edits,s)
 assert.equal(r.previous.flights.length,0);assert.equal(r.edits[p.callsign],undefined)
 const after=runEngine(input,c.config,edits,s),f=get(after,p.callsign)
 assert.equal(f.firstSeen,t);assert.equal(f.mode,'sequenced');assert.equal(f.initialTimingEvidence.at,t)
})

test('expired checkpoint cannot carry an old capture into a newly observed flight',()=>{
 const c=fixture.examples[0],s=runEngine(c.input,c.config,{}),t=s.timestamp+86400000
 const after=runEngine({...c.input,timestamp:t},c.config,{},s),p=get(after,c.callsign)
 assert.equal(p.firstSeen,t);assert.equal(p.initialTimingEvidence.at,t)
})

test('historical simulator and demonstration exercises do not expire their manual exercise edits',()=>{
 const c=fixture.examples[0]
 for(const input of [{...c.input,simulation:true},{...c.input,source:'DEMO'}])
  assert.equal(liveFlightLifecycle(input,c.edits).edits,c.edits)
})

test('blank STAR and runway at sequencer takeover retain the accepted route until usable replacement data',()=>{
 const c=fixture.handover,first=c.frames[0],old=c.previous.flights[0],p=first.input.flights[0]
 assert.equal(p.runway,'');assert.equal(p.star,'')
 const retained=retainHandoverClearances(first.input,c.previous),f=retained.flights[0]
 assert.equal(f.runway,old.euroscopeRunway||old.runway);assert.equal(f.star,old.star)
 assert.ok(f.route.some(q=>q.name===`SA${f.runway}`));assert.ok(f.clearanceContinuity)
 const replacement={...first.input,flights:[{...p,runway:'19R',star:'ELTOK3Z'}]}
 assert.equal(retainHandoverClearances(replacement,c.previous).flights[0],replacement.flights[0])
 const heading={...first.input,flights:[{...p,assignedHeading:90}]}
 const headingKept=retainHandoverClearances(heading,c.previous).flights[0]
 assert.equal(headingKept.assignedHeading,90);assert.equal(headingKept.route,heading.flights[0].route)
 const feeder=old.ff,feederInput={...first.input,flights:[{...p,direct:feeder}]}
 const feederKept=retainHandoverClearances(feederInput,c.previous).flights[0]
 assert.equal(feederKept.direct,feeder);assert.ok(feederKept.route.some(q=>q.name===`SA${feederKept.runway}`))
})

test('an incomplete sequencer handover preserves an accepted final phase and slot',()=>{
 const c=fixture.handover,old=c.previous.flights[0];let s=copy(c.previous)
 for(const fr of c.frames){
  s=runEngine(fr.input,fr.config,fr.edits,s)
  const p=get(s,old.callsign);if(!p)continue
  assert.ok(p.state>=old.state,`phase ${p.state} at ${s.timestamp}`)
  if(p.state!==4)assert.ok(p.sta-old.sta<60000,`slot changed by ${(p.sta-old.sta)/1000}s`)
 }
})

test('an unchanged direct to the feeder cannot discard the STAR tail at a real sequencer takeover',()=>{
 const c=fixture.upstreamHandover,retained=retainHandoverClearances(c.input,c.previous)
 for(const p of retained.flights){
  const raw=c.input.flights.find(f=>f.callsign===p.callsign),old=get(c.previous,p.callsign)
  assert.equal(raw.star,'');assert.equal(raw.runway,'');assert.ok(raw.direct)
  assert.equal(p.direct,raw.direct);assert.equal(p.star,old.star)
  assert.equal(p.route.length,old.route.length)
  assert.ok(p.route.some(q=>q.name===`SA${p.runway}`))
 }
 const s=runEngine(c.input,c.config,c.edits,c.previous)
 for(const p of s.flights)assert.notEqual(p.landingPrediction.method,'fallback',p.callsign)
})
