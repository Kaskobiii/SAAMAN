import {test} from 'node:test'
import assert from 'node:assert/strict'
import {runEngine} from '../src/maestro-engine.ts'
import fixture from './fixtures/recording-17-timing-transitions.json' with {type:'json'}

const replay=(frames,config=fixture.config,edits={})=>{
 let previous;const results=[]
 for(const input of frames){previous=runEngine(input,config,edits,previous);results.push(previous)}
 return results
}
test('recording 17 confirms the first climb-to-profile handover once, retaining initial history and order',()=>{
 const snapshots=replay(fixture.sas),rows=snapshots.map(s=>s.flights[0]),initial=rows[0]
 const changed=rows.filter(f=>f.initialProfile?.appliedAt===f.lastSeen)
 assert.equal(changed.length,1);const f=changed[0]
 assert.equal(f.state,1);assert.equal(f.order,0);assert.equal(f.delay,0)
 assert.equal(f.sta,f.liveBufferedEta);assert.equal(f.staFf,f.etaFf)
 assert.equal(f.initialEta,initial.initialEta);assert.equal(f.initialEtaFf,initial.initialEtaFf)
 assert.ok(f.euroscopeBaseline.at>initial.euroscopeBaseline.at)
 const start=rows.find(f=>f.initialProfile?.candidateSince!==undefined)
 assert.ok(f.initialProfile.appliedAt-start.initialProfile.candidateSince>=15000)
 assert.ok(rows.filter(f=>f.initialProfile?.candidateSince!==undefined).every(f=>f.delay===0),'model confirmation must not publish artificial holding work')
 assert.equal(rows.at(-1).sta,f.sta,'later speed changes do not recapture the Stable target')
 assert.ok(Math.max(...rows.filter(f=>!f.initialProfile?.pending).map(f=>f.delay))<30)
})
test('an explicit manual target blocks the automatic handover',()=>{
 const target=fixture.sas.at(-1).timestamp+40*60000,edits={SAS864:{target,targetKind:'time',changedAt:fixture.sas[0].timestamp}}
 const rows=replay(fixture.sas,fixture.config,edits).map(s=>s.flights[0])
 assert.ok(rows.every(f=>f.sta===target));assert.ok(rows.every(f=>f.initialProfile?.appliedAt===undefined))
})
test('initial handover retains real closure delay',()=>{
 const day=Date.UTC(2026,9,16),begin=day+(9*60+49)*60000,end=day+(9*60+56)*60000
 const c={...fixture.config,slots:[{id:'REAL-CLOSURE',runway:'ESSA/19L',begin,end}]}
 const rows=replay(fixture.sas,c).map(s=>s.flights[0]),f=rows.find(f=>f.initialProfile?.appliedAt===f.lastSeen)
 assert.ok(f);assert.ok(f.sta>=end);assert.ok(f.delay>0)
 assert.ok(f.initialProfile.workSeconds>0,'work issued before the profile switch remains protected')
})
test('a Superstable flight never receives the initial-profile recapture',()=>{
 const split=fixture.sas.findIndex(p=>p.flights[0].verticalSpeed<=300),first=replay(fixture.sas.slice(0,split)).at(-1)
 const baseline=structuredClone(first.flights[0].euroscopeBaseline),sta=first.flights[0].sta
 first.flights[0].state=2;first.flights[0].committedSta=sta
 let s=first
 for(const input of fixture.sas.slice(split))s=runEngine(input,fixture.config,{},s)
 const f=s.flights[0];assert.deepEqual(f.euroscopeBaseline,baseline);assert.equal(f.sta,sta)
 assert.equal(f.initialProfile?.appliedAt,undefined)
})
test('recording 17 direct AGILI keeps an observed crossing ETA instead of adding the fallback buffer',()=>{
 const snapshots=replay(fixture.tom),a=snapshots[1].flights[0],b=snapshots[2].flights[0]
 assert.equal(b.feederObservationSource,'track');assert.equal(b.feederEtaAvailable,true)
 assert.equal(b.passedFeeder,false);assert.equal(b.staFf,a.staFf)
 assert.ok(Math.abs(b.etaFf-a.etaFf)<15000)
 assert.ok(Math.abs(b.etaFf-Date.UTC(2026,9,16,9,22,54))<15000)
 assert.equal(snapshots.at(-1).flights[0].passedFeeder,true)
})
test('a genuine feeder bypass retains assignments and instructions but marks the crossing estimate unavailable',()=>{
 const first=replay(fixture.tom.slice(0,2)).at(-1),old=first.flights[0]
 old.delay=123
 const input=structuredClone(fixture.tom[2]);input.flights[0].heading=(input.flights[0].heading+90)%360
 const f=runEngine(input,fixture.config,{},first).flights[0]
 assert.equal(f.feederEtaAvailable,false);assert.equal(f.feederObservationSource,'bypassed')
 assert.equal(f.passedFeeder,false);assert.equal(f.etaFf,old.etaFf);assert.equal(f.staFf,old.staFf);assert.equal(f.delay,old.delay)
 assert.ok(Number.isFinite(f.eta));assert.equal(f.issue,'')
})

test('an explicit feeder estimate remains available on a bypass',()=>{
 const first=replay(fixture.tom.slice(0,2)).at(-1),input=structuredClone(fixture.tom[2])
 input.flights[0].heading=(input.flights[0].heading+90)%360
 const estimate=input.timestamp+120000
 const f=runEngine(input,fixture.config,{TOM888:{etaFfOverride:estimate}},first).flights[0]
 assert.equal(f.feederEtaAvailable,true);assert.equal(f.feederObservationSource,'manual')
 assert.ok(Number.isFinite(f.etaFf));assert.equal(f.passedFeeder,false)
})

test('restoring a shared checkpoint cannot repeat the completed handover',()=>{
 const rows=replay(fixture.sas),done=rows.find(s=>s.flights[0].initialProfile?.appliedAt===s.timestamp)
 assert.ok(done)
 let restored=JSON.parse(JSON.stringify(done)),baseline=structuredClone(done.flights[0].euroscopeBaseline)
 for(const input of fixture.sas.filter(p=>p.timestamp>done.timestamp))restored=runEngine(input,fixture.config,{},restored)
 assert.deepEqual(restored.flights[0].euroscopeBaseline,baseline)
 assert.equal(restored.flights[0].initialProfile.appliedAt,done.timestamp)
})

test('a return to climb interrupts profile confirmation',()=>{
 const split=fixture.sas.findIndex(p=>p.flights[0].verticalSpeed<=300)
 let s=replay(fixture.sas.slice(0,split+1)).at(-1)
 assert.ok(s.flights[0].initialProfile.candidateSince!==undefined)
 const climb=structuredClone(fixture.sas[split+1]);climb.flights[0].verticalSpeed=1000
 s=runEngine(climb,fixture.config,{},s)
 assert.equal(s.flights[0].initialProfile.candidateSince,undefined)
 const next=fixture.sas[split+2];s=runEngine(next,fixture.config,{},s)
 assert.equal(s.flights[0].initialProfile.candidateSince,next.timestamp)
 assert.equal(s.flights[0].initialProfile.appliedAt,undefined)
})
