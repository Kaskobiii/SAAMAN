import {test} from 'node:test'
import assert from 'node:assert/strict'
import {explainSlot} from '../src/maestro-slot-reasons.ts'

const now=Date.UTC(2026,9,18,19)
const flight=(name,values={})=>({callsign:name,arrival:'ESSA',departure:'EKCH',runway:'19L',ff:'NILUG',mode:'sequenced',state:1,lost:false,issue:'',passedFeeder:false,eta:now+600000,sta:now+600000,etaFf:now,staFf:now,slotBefore:0,slotAfter:0,minimumArrival:now,...values})
const snapshot=(...flights)=>({timestamp:now,flights})
const kinds=result=>result.reasons.filter(r=>r.binding).map(r=>r.kind)

test('a tight current runway interval identifies the actual rate leader without adding the delay fields',()=>{
 const leader=flight('LEAD'),follower=flight('FOLLOW',{sta:leader.sta+115000,eta:leader.sta+30000,separation:{leader:'LEAD',rateSeconds:115,wakeSeconds:77,scheduledSeconds:115},rateDelayMs:85000})
 const result=explainSlot(follower,snapshot(leader,follower))
 assert.deepEqual(kinds(result),['rate']);assert.equal(result.reasons[0].leader,'LEAD');assert.equal(result.reasons[0].seconds,115)
 assert.equal(result.summary,'Rate 115 s behind LEAD')
})

test('wake can be the tight minimum while the configured rate remains lower',()=>{
 const leader=flight('HEAVY'),follower=flight('MEDIUM',{sta:leader.sta+129000,separation:{leader:'HEAVY',rateSeconds:96,wakeSeconds:128.571428,scheduledSeconds:129}})
 const result=explainSlot(follower,snapshot(leader,follower))
 assert.deepEqual(kinds(result),['wake']);assert.equal(result.reasons[0].seconds,129);assert.match(result.summary,/HEAVY/)
})

test('a runway gap caused by feeder spacing does not falsely blame a non-binding rate or wake interval',()=>{
 const leader=flight('LOT4CE',{staFf:now,sta:now+1203000}),follower=flight('SWR3GT',{staFf:now+115000,sta:leader.sta+317000,feederDelayMs:202000,separation:{leader:'LOT4CE',rateSeconds:115,wakeSeconds:77,scheduledSeconds:317}})
 const result=explainSlot(follower,snapshot(leader,follower))
 assert.deepEqual(kinds(result),['feeder']);assert.equal(result.reasons[0].leader,'LOT4CE');assert.equal(result.reasons[0].seconds,202)
 assert.match(result.summary,/NILUG feeder spacing behind LOT4CE/);assert.doesNotMatch(result.summary,/Rate|Wake/)
})

test('a feeder leader can be on another runway and the absent leader is not guessed',()=>{
 const leader=flight('OTHER',{runway:'19R',staFf:now+100000}),follower=flight('FOLLOW',{staFf:now+215000,feederDelayMs:60000})
 assert.equal(explainSlot(follower,snapshot(leader,follower)).reasons[0].leader,'OTHER')
 const missing=explainSlot(follower,snapshot({...leader,passedFeeder:true},follower))
 assert.equal(missing.reasons[0].leader,undefined);assert.equal(missing.summary,'NILUG feeder spacing')
})

test('manual time and sequence order remain explicit intent without claiming all historical delay is caused by them',()=>{
 const f=flight('TEST',{sta:now+700000,editTracking:true,appliedTarget:now+650000,appliedOrder:2})
 const edits={TEST:{target:now+650000,targetKind:'time',order:2,orderExplicit:true}}
 const result=explainSlot(f,snapshot(f),edits)
 assert.deepEqual(kinds(result),[]);assert.deepEqual(result.reasons.map(r=>r.kind),['manual-time','manual-order'])
 assert.equal(result.reasons[0].target,now+650000);assert.equal(result.reasons[0].seconds,undefined)
 const atTarget=explainSlot({...f,sta:edits.TEST.target},snapshot(f),edits)
 assert.deepEqual(kinds(atTarget),['manual-time'])
 const sequence=explainSlot(f,snapshot(f),{TEST:{...edits.TEST,targetKind:'sequence'}})
 assert.equal(sequence.reasons.filter(r=>r.kind==='manual-order').length,1);assert.equal(sequence.reasons.some(r=>r.kind==='manual-time'),false)
})

test('unapplied edit requests and retained automatic Frozen ranks do not masquerade as active controller constraints',()=>{
 const f=flight('TEST',{editTracking:true,appliedOrder:2,appliedTarget:undefined})
 const pending=explainSlot(f,snapshot(f),{TEST:{target:now+500000,order:3,orderExplicit:true}})
 assert.deepEqual(pending.reasons.map(r=>r.kind),['forecast'])
 const rank=explainSlot(f,snapshot(f),{TEST:{order:2,orderExplicit:false}})
 assert.deepEqual(rank.reasons.map(r=>r.kind),['forecast'])
})

test('inserted personal intervals identify the extra minimum separately from rate or wake',()=>{
 const leader=flight('LEAD',{slotAfter:1}),f=flight('TEST',{slotBefore:.5,sta:leader.sta+205000,separation:{leader:'LEAD',rateSeconds:115,wakeSeconds:77,scheduledSeconds:205}})
 const result=explainSlot(f,snapshot(leader,f))
 assert.deepEqual(kinds(result),['rate','interval']);assert.equal(result.reasons[1].seconds,90)
 const slack=explainSlot({...f,sta:f.sta+60000},snapshot(leader,f))
 assert.deepEqual(kinds(slack),[]);assert.equal(slack.reasons.find(r=>r.kind==='interval').binding,false)
})

test('closure and resume evidence are bounded and do not add overlapping engine adjustments into a total',()=>{
 const f=flight('TEST',{sta:now+900000,minimumArrival:now+900000,minimumArrivalSource:'resume',closureDelayMs:60000,wakeDelayMs:20000,rateDelayMs:30000})
 const result=explainSlot(f,snapshot(f))
 assert.deepEqual(kinds(result),['closure','minimum']);assert.equal(result.reasons.filter(r=>r.kind==='wake'||r.kind==='rate').every(r=>!r.binding),true)
 assert.equal('totalSeconds' in result,false);assert.ok(result.summary.length<=320)
})

test('released constraints disappear and accepted assignments are distinguished from a current landing estimate',()=>{
 const first=flight('TEST',{sta:now+800000,eta:now+600000,closureDelayMs:120000})
 assert.deepEqual(kinds(explainSlot(first,snapshot(first))),['closure'])
 const released={...first,sta:first.eta,closureDelayMs:0}
 assert.deepEqual(explainSlot(released,snapshot(released)),{summary:'Current landing estimate',reasons:[{kind:'forecast',detail:'Current landing estimate',binding:false}]})
 const protectedFlight={...released,passedFeeder:true,sta:released.sta+100000,tmaAssignment:{at:now,sta:released.sta+100000,instruction:0}}
 assert.equal(explainSlot(protectedFlight,snapshot(protectedFlight)).summary,'Accepted TMA sequence time')
})

test('old, cross-runway and inactive predecessor names never become current binding runway causes',()=>{
 const old=flight('LEAD',{runway:'19R'}),f=flight('TEST',{sta:now+715000,separation:{leader:'LEAD',rateSeconds:115,wakeSeconds:77,scheduledSeconds:115}})
 assert.deepEqual(kinds(explainSlot(f,snapshot(old,f))),[])
 assert.deepEqual(kinds(explainSlot(f,snapshot({...old,runway:'19L',state:4},f))),[])
 assert.deepEqual(kinds(explainSlot(f,snapshot({...old,runway:'19L',lost:true},f))),[])
})

test('landed and non-sequenced aircraft do not report leftover scheduling constraints',()=>{
 const f=flight('TEST',{state:4,feederDelayMs:120000,closureDelayMs:60000})
 assert.equal(explainSlot(f,snapshot(f)).summary,'Landed')
 assert.equal(explainSlot({...f,state:2,mode:'missed'},snapshot(f)).summary,'Missed approach')
})

test('explanations are deterministic, compact and leave authority snapshots and edits unchanged',()=>{
 const leader=flight('X'.repeat(300)),f=flight('TEST',{sta:leader.sta+115000,separation:{leader:leader.callsign,rateSeconds:115,wakeSeconds:77,scheduledSeconds:115},closureDelayMs:60000,feederDelayMs:120000})
 const s=snapshot(leader,f),edits={TEST:{target:now+500000,order:2}}
 const saved=JSON.stringify({s,edits}),a=explainSlot(f,s,edits),b=explainSlot(f,s,edits)
 assert.deepEqual(a,b);assert.ok(a.summary.length<=320);assert.ok(a.reasons.length<=8);assert.ok(a.reasons.every(r=>r.detail.length<=140&&(!r.leader||r.leader.length<=24)))
 assert.equal(JSON.stringify({s,edits}),saved)
})

import {observeSnapshot} from '../src/maestro-supervision.ts'
test('supervision slot-change history retains the current constraint without inventing a historical cause',()=>{
 const leader=flight('LEAD'),before=flight('TEST',{sta:leader.sta+115000,separation:{leader:'LEAD',rateSeconds:115,wakeSeconds:77,scheduledSeconds:115}})
 const movedLeader={...leader,sta:leader.sta+10000},after={...before,sta:before.sta+10000}
 const event=observeSnapshot(snapshot(leader,before),{...snapshot(movedLeader,after),timestamp:now+2000}).find(e=>e.callsign==='TEST'&&e.kind==='Landing slot')
 assert.match(event.detail,/Rate 115 s behind LEAD/)
 const released={...after,closureDelayMs:0,separation:undefined}
 const unknown=observeSnapshot(snapshot(after),{...snapshot({...released,sta:released.sta+10000}),timestamp:now+2000}).find(e=>e.kind==='Landing slot')
 assert.match(unknown.detail,/Assigned sequence time/);assert.doesNotMatch(unknown.detail,/closure|Rate|Wake/)
})
