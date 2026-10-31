import {test} from 'node:test'
import assert from 'node:assert/strict'
import {motionTiming} from '../src/maestro-motion-timing.ts'
import {runEngine} from '../src/maestro-engine.ts'
import {SessionRecording,decodeRecording} from '../src/maestro-recording.ts'
import fixture from './fixtures/hun22jd-tracking-recovery.json' with {type:'json'}

const start=1700000000000
const track=(extra={})=>({callsign:'RECOVER',aircraft:'A320',latitude:59.4,longitude:16.1,altitude:33000,groundspeed:416,wake:'M',positionAgeSeconds:0,departure:'ESGG',arrival:'ESSA',...extra})
const prior=(extra={})=>({...track(),state:1,mode:'sequenced',lastSeen:start,euroscopeBaseline:{at:start-60000},motionTiming:{anchor:{latitude:59.4,longitude:16.1,altitude:33000,at:start},held:false,groundspeed:416},...extra})
const point=(knots,seconds,extra={})=>track({groundspeed:knots,longitude:16.1+knots*seconds/3600/(60*Math.cos(59.4*Math.PI/180)),...extra})
const next=(old,p,now)=>{const result=motionTiming(p,old,now);return {result,old:{...old,...p,lastSeen:now,motionTiming:result.state}}}

function replay(){let snapshot=structuredClone(fixture.initial);const rows=[];for(const frame of fixture.frames){snapshot=runEngine(frame.input,frame.config,frame.edits,snapshot);rows.push({frame:frame.originalFrame,flight:snapshot.flights.find(f=>f.callsign==='HUN22JD'),snapshot})}return rows}

test('live tracking recovery keeps its latest credible forecast through the 152-199 kt burst',()=>{
 const rows=replay(),before=rows.find(r=>r.frame===209).flight,bad=rows.filter(r=>r.frame>=210&&r.frame<=217)
 assert.equal(before.groundspeed,416)
 for(const {flight:f} of bad){assert.equal(f.motionTiming.held,true);assert.ok(f.motionTiming.recovery);assert.equal(f.eta,before.eta);assert.equal(f.liveBufferedEta,before.liveBufferedEta??before.eta);assert.equal(f.euroscopeBaseline.at,before.euroscopeBaseline.at);assert.equal(f.state,before.state);assert.equal(f.issue,'')}
 assert.deepEqual(bad.map(r=>r.flight.groundspeed),[152,152,198,198,198,199,199,199],'raw reported GS remains available')
 const good=rows.find(r=>r.frame===220).flight
 assert.equal(good.motionTiming.held,false);assert.equal(good.motionTiming.recovery,undefined)
 assert.ok(Math.abs(good.liveBufferedEta-(before.liveBufferedEta??before.eta))<120000,'resumed performance does not keep the seven-minute bad-speed forecast')
 assert.ok(rows.at(-1).snapshot.timestamp-rows.at(-1).flight.motionTiming.movingSince>=10000)
})

test('recording replay retains raw speed while a recovery forecast is held',()=>{
 const rows=replay(),row=rows.find(r=>r.frame===210),frame=fixture.frames.find(r=>r.originalFrame===210),recording=new SessionRecording()
 recording.start(row.snapshot,frame.config,frame.edits)
 const input=decodeRecording(recording.export())[0].input.flights.find(f=>f.callsign==='HUN22JD')
 assert.equal(input.groundspeed,152);assert.equal(input.positionAgeSeconds,0)
})

test('stale samples keep trusted motion across JSON checkpoints without being marked as a pause',()=>{
 let old=prior()
 for(const age of [11,15,19]){const step=next(old,track({positionAgeSeconds:age}),start+age*1000);old=step.old;assert.equal(step.result.held,false)}
 old=JSON.parse(JSON.stringify(old))
 const result=motionTiming(track({groundspeed:152,longitude:16.11}),old,start+21000)
 assert.equal(result.held,true);assert.equal(result.state.groundspeed,416);assert.ok(result.state.recovery)
})

test('a genuinely slower resumed track qualifies on fresh consistent motion',()=>{
 let old=prior({positionAgeSeconds:19}),first=start+20000
 for(const elapsed of [0,4,8,12]){const step=next(old,point(152,elapsed),first+elapsed*1000);old=step.old;if(elapsed<12)assert.equal(step.result.held,true);else {assert.equal(step.result.held,false);assert.equal(step.result.state.groundspeed,152)}}
})

test('recovery expires within 20 seconds when reported speed remains inconsistent',()=>{
 let old=prior({positionAgeSeconds:19}),first=start+20000
 for(const elapsed of [0,5,10,15,20]){const step=next(old,point(416,elapsed,{groundspeed:152}),first+elapsed*1000);old=step.old;assert.equal(step.result.held,elapsed<20)}
 assert.equal(old.motionTiming.recovery,undefined)
 const step=next(old,point(416,25,{groundspeed:152}),first+25000)
 assert.equal(step.result.held,false,'expired episode does not restart without another gap')
})

test('fresh normal speed changes are not delayed by the recovery guard',()=>{
 const result=motionTiming(point(250,5),prior(),start+5000)
 assert.equal(result.held,false);assert.equal(result.state.groundspeed,250);assert.equal(result.state.recovery,undefined)
})

test('light aircraft, initial climb and short final remain usable',()=>{
 for(const [old,p] of [
  [prior({groundspeed:100,wake:'L',altitude:8000,positionAgeSeconds:19,motionTiming:undefined}),point(75,20,{wake:'L',altitude:8000})],
  [prior({groundspeed:180,altitude:2000,positionAgeSeconds:19,motionTiming:undefined}),point(240,20,{altitude:3000,verticalSpeed:2200})],
  [prior({groundspeed:230,altitude:1800,state:3,positionAgeSeconds:19,motionTiming:undefined}),point(140,20,{altitude:1400,verticalSpeed:-600})]
 ])assert.equal(motionTiming(p,old,start+20000).held,false)
})

test('missed approaches, rollout and long-expired identities do not inherit recovery holds',()=>{
 const p=track({groundspeed:152})
 assert.equal(motionTiming(p,prior({positionAgeSeconds:19,missedRecovery:true}),start+20000).held,false)
 assert.equal(motionTiming(track({groundspeed:35,altitude:100}),prior({state:4}),start+20000).held,false)
 assert.equal(motionTiming(p,prior({positionAgeSeconds:19,departure:'EGLL'}),start+20000).held,false)
 assert.equal(motionTiming(p,prior({positionAgeSeconds:19}),start+61000).held,false)
})

test('a short reconnect with bad speed qualifies while moving holding tracks stay usable',()=>{
 assert.equal(motionTiming(track({groundspeed:152}),prior(),start+30000).held,true)
 let old=prior({altitude:10000,groundspeed:230,motionTiming:undefined})
 for(const seconds of [5,10,15,20]){const step=next(old,point(230,seconds,{altitude:10000,topskyHoldingPoint:'ELTOK'}),start+seconds*1000);old=step.old;assert.equal(step.result.held,false)}
})

test('a sparse normal-speed polling interval does not invent stationary evidence or freeze a HOLD countdown',()=>{
 const p=track({topskyHoldingPoint:'ELTOK'}),old=prior({topskyHoldingPoint:'ELTOK'})
 assert.equal(motionTiming(p,old,start+20000).held,false)
 assert.equal(motionTiming(p,old,start+60000).held,false)
})
