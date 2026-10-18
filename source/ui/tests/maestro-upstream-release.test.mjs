import {test} from 'node:test'
import assert from 'node:assert/strict'
import {runEngine} from '../src/maestro-engine.ts'
import {decodeRecording} from '../src/maestro-recording.ts'
import recording from './fixtures/live-sas1491-retained-slot.json' with {type:'json'}
const frame=decodeRecording(recording)[0],get=(s,c='SAS1491')=>s.flights.find(p=>p.callsign===c)
function tick(previous,seconds=2,input=frame.input,edits=frame.edits,config=frame.config){return runEngine({...structuredClone(input),timestamp:previous.timestamp+seconds*1000},config,edits,JSON.parse(JSON.stringify(previous)))}
function spaced(s){const queue=s.flights.filter(f=>f.mode==='sequenced'&&!f.lost&&!f.issue&&f.state!==4).sort((a,b)=>a.order-b.order);for(let i=1;i<queue.length;i++)assert.ok(queue[i].sta-queue[i-1].sta>=frame.config.rates['ESSA/01R']*1000-1)}
test('SAS1491 automatically gets ahead of the persistently later Unstable BEL19R without Recompute',()=>{
 let s=structuredClone(recording.initial)
 for(let i=0;i<35;i++){s=tick(s);spaced(s)}
 assert.ok(get(s).order<get(s,'BEL19R').order);assert.ok(get(s).delay<300);assert.ok(get(s).state>=1)
 assert.ok(get(s).sta<get(s,'BEL19R').sta)
})
test('a brief inversion does not reorder an accepted Stable aircraft',()=>{
 const s=tick(recording.initial,2);assert.ok(get(s).order>get(s,'BEL19R').order)
})
function isolated(state=1){const previous=structuredClone(recording.initial),p=get(previous),input=structuredClone(frame.input)
 input.flights=input.flights.filter(f=>f.callsign==='SAS1491');previous.flights=[p];p.state=state;p.order=0;p.delay=60;p.sta=p.eta+60000;p.staFf=p.etaFf+60000;p.planningEta=p.eta
 delete p.separation;p.guidance={...p.guidance,scheduled:p.staFf};return {previous,input,p}
}
test('a lone upstream arrival releases an old automatic minute without inventing gain',()=>{
 const {previous,input}=isolated();const s=tick(previous,2,input,{})
 assert.ok(Math.abs(get(s).delay)<2);assert.ok(Math.abs(get(s).sta-get(s).eta)<1000)
})
test('manual target, personal spacing and runway closure remain constraints when alone',()=>{
 const {previous,input,p}=isolated(),target=p.sta+120000
 const manual=tick(previous,2,input,{SAS1491:{target,targetKind:'time'}});assert.ok(get(manual).sta>=target)
 const personal=tick(previous,2,input,{SAS1491:{slotBefore:2}});assert.equal(get(personal).slotBefore,2)
 const config=structuredClone(frame.config),begin=p.eta-60000,end=p.eta+240000;config.slots=[{id:'closed',runway:'ESSA/01R',begin,end,kind:'closure'}]
 const closed=tick(previous,2,input,{},config);assert.ok(get(closed).sta>=end)
})
test('an accepted entered TMA assignment stays fixed even when alone with a positive instruction',()=>{
 const {previous,input,p}=isolated(2);p.passedFeeder=true;p.tmaAssignment={at:previous.timestamp-1000,sta:p.sta,instruction:60};p.guidance.scheduled=p.sta
 const s=tick(previous,2,input,{});assert.equal(get(s).sta,p.sta)
})
