import {test} from 'node:test'
import assert from 'node:assert/strict'
import {runEngine,DEFAULT_CONFIG,wakeInterval,effectiveConfig,windConfig} from '../src/maestro-engine.ts'
import fixture from './fixtures/recording-18-partial-recompute.json' with {type:'json'}
import entryFixture from './fixtures/recompute-arrival-gap.json' with {type:'json'}
import promotionFixture from './fixtures/phase-promotion-queue.json' with {type:'json'}

// Command IDs advance; traffic, clock and predictions deliberately do not.
// This is the same forced evaluation used for edits between telemetry packets.
function recompute(previous,edits,calls,step=1,input=fixture.input,config=fixture.config){
 const stamp=input.timestamp+10000+step*1000,nextEdits=structuredClone(edits)
 for(const call of calls)nextEdits[call]={...nextEdits[call],mode:'sequenced',recomputeAt:stamp,changedAt:stamp,order:undefined,target:undefined,swapAt:undefined,requeueAt:undefined,landedAt:undefined,closurePosition:undefined}
 const snapshot=runEngine(structuredClone(input),structuredClone(config),nextEdits,{...structuredClone(previous),timestamp:input.timestamp-1})
 return {snapshot,edits:nextEdits}
}
const queue=s=>s.flights.filter(f=>f.mode==='sequenced'&&!f.issue&&!f.lost&&f.state!==4).sort((a,b)=>a.order-b.order)
const slots=s=>queue(s).map(f=>[f.callsign,f.sta,f.staFf,f.delay])
function spaced(snapshot,config=fixture.config){
 const sorted=queue(snapshot)
 for(let i=1;i<sorted.length;i++){
  const a=sorted[i-1],b=sorted[i],runway=`${b.arrival}/${b.runway}`
  const c=windConfig(effectiveConfig(config,b.sta),b.arrival,snapshot.winds??{},snapshot.timestamp)
  const gap=Math.max(c.rates[runway],wakeInterval(a.wake,b.wake,runway,c))*1000+((a.slotAfter??0)+(b.slotBefore??0))*60000
  assert.ok(b.sta-a.sta>=gap-1,`${a.callsign} → ${b.callsign}: ${b.sta-a.sta} < ${gap}`)
  assert.equal(b.spacingConflict,false)
 }
}

for(const scenario of promotionFixture.cases)test(`recording 1 frame ${scenario.frame}: phase promotion keeps existing positions and does not extend held slots`,()=>{
 const saved=structuredClone(scenario),old=queue(scenario.previous),accepted=new Set(old.filter(f=>f.state>=1).map(f=>f.callsign))
 const snapshot=runEngine(scenario.input,scenario.config,scenario.edits,scenario.previous)
 assert.deepEqual(queue(snapshot).filter(f=>accepted.has(f.callsign)).map(f=>f.callsign),old.filter(f=>accepted.has(f.callsign)).map(f=>f.callsign),'a phase transition must not reinsert an accepted flight among later accepted slots')
 const prior=new Map(old.map(f=>[f.callsign,f]))
 for(const f of queue(snapshot).filter(f=>accepted.has(f.callsign)))assert.ok(f.sta<=prior.get(f.callsign).sta+1,`${f.callsign} gained ${(f.sta-prior.get(f.callsign).sta)/1000} seconds without a new constraint`)
 const promoted={515:'AFR8120',532:'SAS8121',544:'RYR8122'}[scenario.frame]
 assert.equal(prior.get(promoted).state,1);assert.equal(snapshot.flights.find(f=>f.callsign===promoted).state,2)
 spaced(snapshot,scenario.config);assert.deepEqual(scenario,saved)
})

test('phase promotion during another aircraft partial Recompute does not postpone untouched accepted flights',()=>{
 const scenario=promotionFixture.cases.find(f=>f.frame===532)
 const {snapshot}=recompute(scenario.previous,scenario.edits,['SAS8127'],1,scenario.input,scenario.config)
 const old=queue(scenario.previous).filter(f=>f.callsign!=='SAS8127'),calls=new Set(old.map(f=>f.callsign))
 assert.deepEqual(queue(snapshot).filter(f=>calls.has(f.callsign)).map(f=>f.callsign),old.map(f=>f.callsign))
 for(const f of old)assert.equal(snapshot.flights.find(p=>p.callsign===f.callsign).sta,f.sta,`${f.callsign}: unselected target changed on promotion`)
 assert.equal(snapshot.flights.find(f=>f.callsign==='SAS8121').state,2)
 spaced(snapshot,scenario.config)
})

test('recording 18 partial Recompute fills scheduled gaps without putting early arrivals behind late retained slots',()=>{
 const original=structuredClone(fixture),{snapshot}=recompute(fixture.previous,fixture.edits,fixture.groups[0])
 const by=new Map(snapshot.flights.map(f=>[f.callsign,f])),old=new Map(fixture.previous.flights.map(f=>[f.callsign,f]))
 assert.ok(by.get('SAS2472').order<by.get('THY1797').order)
 assert.ok(by.get('SAS2472').sta<fixture.input.timestamp+20*60000)
 for(const f of snapshot.flights)if(!fixture.groups[0].includes(f.callsign)&&old.get(f.callsign)?.state>=1){
  assert.equal(f.sta,old.get(f.callsign).sta,`${f.callsign}: an unchanged retained slot must remain protected`)
 }
 assert.ok(Math.max(...snapshot.flights.map(f=>f.sta))<=Math.max(...fixture.previous.flights.map(f=>f.sta))+Math.max(...snapshot.flights.map(f=>f.feederDelayMs??0))+1)
 spaced(snapshot);assert.deepEqual(fixture,original,'allocation must not mutate the recorded input/edits/checkpoint')
})

test('recording 18 repeated equivalent partial Recomputes are idempotent with frozen traffic',()=>{
 let current=recompute(fixture.previous,fixture.edits,fixture.groups[0]),expected=slots(current.snapshot)
 for(let i=2;i<=8;i++){
  current=recompute(JSON.parse(JSON.stringify(current.snapshot)),current.edits,fixture.groups[0],i)
  assert.deepEqual(slots(current.snapshot),expected,`click ${i} must not add another interval`);spaced(current.snapshot)
 }
})

test('recording 18 alternating partial Recomputes cannot ratchet automatic delay across cohorts',()=>{
 let snapshot=fixture.previous,edits=fixture.edits;const latest=Math.max(...snapshot.flights.map(f=>f.sta))
 const maximum=Math.max(...snapshot.flights.map(f=>f.delay))
 for(let i=0;i<10;i++){
  ({snapshot,edits}=recompute(snapshot,edits,fixture.groups[i%2],i+1))
  const repairedLatest=i===0?latest+Math.max(...snapshot.flights.map(f=>f.feederDelayMs??0)):latest
  assert.ok(Math.max(...snapshot.flights.map(f=>f.sta))<=repairedLatest+1,`click ${i+1} extends the queue without a new feeder requirement`)
  assert.ok(Math.max(...snapshot.flights.map(f=>f.delay))<=maximum+102,`click ${i+1} accumulates prior automatic delay`)
  spaced(snapshot)
 }
})

test('dense SweatBox full-group Recompute remains deterministic through checkpoint restoration',()=>{
 const calls=fixture.previous.flights.map(f=>f.callsign)
 let current=recompute(fixture.previous,fixture.edits,calls),expected=slots(current.snapshot)
 for(let i=2;i<=5;i++){
  current=recompute(JSON.parse(JSON.stringify(current.snapshot)),current.edits,calls,i)
  assert.deepEqual(slots(current.snapshot),expected);spaced(current.snapshot)
 }
})

test('partial Recompute keeps a nonselected manual target and the relative order of protected aircraft',()=>{
 const edits=structuredClone(fixture.edits),target=fixture.previous.flights.find(f=>f.callsign==='THY1797').sta
 edits.THY1797={...edits.THY1797,target,targetKind:'time'}
 const {snapshot}=recompute(fixture.previous,edits,fixture.groups[0])
 assert.equal(snapshot.flights.find(f=>f.callsign==='THY1797').sta,target)
 assert.equal(snapshot.flights.find(f=>f.callsign==='THY1797').appliedTarget,target)
 const protectedCalls=queue(fixture.previous).filter(f=>f.state>=2).map(f=>f.callsign)
 assert.deepEqual(queue(snapshot).filter(f=>protectedCalls.includes(f.callsign)).map(f=>f.callsign),protectedCalls)
 spaced(snapshot)
})

test('a partial refresh still respects closures and controller-inserted intervals',()=>{
 const c=structuredClone(fixture.config),edits=structuredClone(fixture.edits)
 const at=fixture.input.timestamp,begin=at+17*60000,end=begin+3*60000
 c.slots=[{id:'recompute-closure',runway:'ESSA/19L',begin,end,kind:'closure'}]
 edits.NAX41G={...edits.NAX41G,slotAfter:2}
 edits.SAS2472={...edits.SAS2472,slotBefore:1}
 const {snapshot}=recompute(fixture.previous,edits,fixture.groups[0],1,fixture.input,c)
 spaced(snapshot,c)
 for(const f of queue(snapshot))assert.ok(f.sta<begin||f.sta>=end,`${f.callsign} inside a closure`)
 assert.equal(snapshot.flights.find(f=>f.callsign==='NAX41G').slotAfter,2)
 assert.equal(snapshot.flights.find(f=>f.callsign==='SAS2472').slotBefore,1)
})

test('idle evaluations between repeated partial Recomputes do not revive old delay anchors',()=>{
 let current=recompute(fixture.previous,fixture.edits,fixture.groups[0]),latest=Math.max(...current.snapshot.flights.map(f=>f.sta))
 for(let i=2;i<=8;i++){
  const snapshot=runEngine(structuredClone(fixture.input),fixture.config,current.edits,{...current.snapshot,timestamp:fixture.input.timestamp-1})
  current=recompute(JSON.parse(JSON.stringify(snapshot)),current.edits,fixture.groups[i%2],i)
  assert.ok(Math.max(...current.snapshot.flights.map(f=>f.sta))<=latest+1,`idle plus click ${i} extends the sequence`)
  spaced(current.snapshot)
 }
})

test('partial Recompute preserves untouched scheduled anchors when restoring a legacy checkpoint',()=>{
 const previous=structuredClone(fixture.previous)
 for(const f of previous.flights){delete f.editTracking;delete f.appliedOrder;delete f.appliedTarget;delete f.appliedChangedAt;delete f.appliedOrderGroup}
 const {snapshot}=recompute(previous,fixture.edits,fixture.groups[0])
 const old=new Map(previous.flights.map(f=>[f.callsign,f]))
 for(const f of snapshot.flights)if(!fixture.groups[0].includes(f.callsign)&&old.get(f.callsign)?.state>=1)assert.equal(f.sta,old.get(f.callsign).sta)
 assert.ok(snapshot.flights.find(f=>f.callsign==='SAS2472').sta<fixture.input.timestamp+20*60000)
 spaced(snapshot)
})

test('partial Recompute preserves runway and feeder spacing in distance-profile mode',()=>{
 const input={source:'TEST_APP',...structuredClone(entryFixture)}
 const c={...structuredClone(DEFAULT_CONFIG),timingModel:'performance',active:['ESSA/01R'],superStableMinutes:3,frozenMinutes:0,unstableSeconds:0,minimumNewSeconds:0}
 c.rates['ESSA/01R']=90
 let snapshot=runEngine(input,c,{}),edits={}
 assert.ok(snapshot.flights.every(f=>f.distanceProfile))
 const original=slots(snapshot)
 for(let i=0;i<6;i++){
  ({snapshot,edits}=recompute(snapshot,edits,i%2?['LATE']:['EARLY'],i+1,input,c))
  assert.deepEqual(slots(snapshot),original);spaced(snapshot,c)
  const sorted=queue(snapshot)
  for(let j=1;j<sorted.length;j++)if(sorted[j].ff===sorted[j-1].ff&&!sorted[j].passedFeeder&&!sorted[j-1].passedFeeder)assert.ok(sorted[j].staFf-sorted[j-1].staFf>=90000-1)
 }
})

test('the UI retaining a Frozen aircraft rank does not disable partial Recompute gap allocation',()=>{
 const previous=structuredClone(fixture.previous),frozen=previous.flights.find(f=>f.callsign==='SAS28')
 frozen.state=3
 const calls=[...fixture.groups[0],'SAS28'],stamp=fixture.input.timestamp+10000,edits=structuredClone(fixture.edits)
 for(const call of calls)edits[call]={...edits[call],mode:'sequenced',recomputeAt:stamp,changedAt:stamp,order:call==='SAS28'?frozen.order:undefined,target:undefined,swapAt:undefined,requeueAt:undefined,landedAt:undefined,closurePosition:undefined}
 const snapshot=runEngine(fixture.input,fixture.config,edits,{...previous,timestamp:fixture.input.timestamp-1})
 assert.equal(queue(snapshot)[0].callsign,'SAS28')
 assert.ok(snapshot.flights.find(f=>f.callsign==='SAS2472').sta<fixture.input.timestamp+20*60000)
 spaced(snapshot)
})
