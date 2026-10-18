import {test} from 'node:test'
import assert from 'node:assert/strict'
import {runEngine,validateEdits,toJuhaSequence} from '../src/maestro-engine.ts'
import {recoveryIafOptions,recoveryEntryPrediction} from '../src/maestro-recovery.ts'
import {reinsertRecoveryEdits} from '../src/maestro-operations.ts'
import {distanceNm} from '../src/maestro-star-prediction.ts'
import data from '../src/data/essa-star-distances.json' with {type:'json'}
import fixture from './fixtures/ice306-go-around.json' with {type:'json'}
const scenario=fixture.cases[0],get=s=>s.flights.find(p=>p.callsign==='ICE306')
const evaluate=(input,config,edits,previous)=>runEngine(structuredClone(input),structuredClone(config),structuredClone(edits),{...structuredClone(previous),timestamp:input.timestamp-1})
for(const s of fixture.cases)test(`ICE306 frame ${s.frame}: turning toward the airport from the wrong side is not a new approach`,()=>{
 const next=evaluate(s.input,s.config,s.edits,s.previous),p=get(next)
 assert.equal(p.missedRecovery,true);assert.equal(p.landingEtaAvailable,false);assert.notEqual(p.state,3)
 assert.ok(!toJuhaSequence(next,s.config,s.edits).sequence.some(p=>p.callsign==='ICE306'))
})

test('selecting TEB immediately reinserts ICE306 using time to the fix plus its standard approach leg',()=>{
 const s=scenario,waiting=evaluate(s.input,s.config,s.edits,s.previous),before=structuredClone({waiting,edits:s.edits}),edits=reinsertRecoveryEdits(waiting,s.config,s.edits,'ICE306','TEB'),next=evaluate(s.input,s.config,edits,waiting),p=get(next)
 assert.equal(edits.ICE306.recoveryEntry.fix,'TEB');assert.equal(p.landingEtaAvailable,true);assert.equal(p.missedRecovery,false)
 assert.equal(p.landingPrediction.method,'recovery-iaf');assert.ok(p.eta-s.input.timestamp>240000);assert.notEqual(p.state,3)
 assert.ok(p.eta-s.input.timestamp>distanceNm(p,data.navigation.TEB)/p.groundspeed*3600000)
 assert.ok(toJuhaSequence(next,s.config,edits).sequence.some(p=>p.callsign==='ICE306'));assert.equal(p.line0Suppressed,true)
 assert.deepEqual({waiting,edits:s.edits},before)
})

test('IAF options are runway-specific and all four choices are represented without guessing missing profiles',()=>{
 for(const [runway,expected] of [['01R',['TEB','OBCIV']],['19L',['BALVI','ERXEC']],['19R',['BALVI','ERXEC']],['26',['TEB','ERXEC']]]){
  const options=recoveryIafOptions(runway);assert.equal(options.length,4);assert.deepEqual(options.filter(p=>p.available).map(p=>p.fix),expected)
 }
 const s=scenario,waiting=evaluate(s.input,s.config,s.edits,s.previous)
 assert.throws(()=>reinsertRecoveryEdits(waiting,s.config,s.edits,'ICE306','BALVI'),/No approach profile/)
 assert.throws(()=>validateEdits({ICE306:{recoveryEntry:{fix:'ESSA',runway:'01R',at:1}}}),/Invalid recovery/)
})

test('repeated Recompute and restored checkpoints do not reset the chosen IAF or add another approach leg',()=>{
 const s=scenario,waiting=evaluate(s.input,s.config,s.edits,s.previous);let edits=reinsertRecoveryEdits(waiting,s.config,s.edits,'ICE306','TEB'),next=evaluate(s.input,s.config,edits,waiting)
 const expected=get(next).sta,selection=edits.ICE306.recoveryEntry.at
 for(let i=1;i<=5;i++){
  edits={...edits,ICE306:{...edits.ICE306,recomputeAt:selection+i,changedAt:selection+i}}
  next=evaluate(s.input,s.config,edits,JSON.parse(JSON.stringify(next)))
  assert.equal(get(next).sta,expected);assert.equal(get(next).recoveryRoute.at,selection)
 }
})

test('passing the selected IAF starts its approach leg once instead of routing back to the fix',()=>{
 const s=scenario,p=s.input.flights.find(p=>p.callsign==='ICE306'),entry={fix:'TEB',runway:'01R',at:s.input.timestamp},fix=data.navigation.TEB
 const atFix={...p,...fix,verticalSpeed:0,altitude:4000,groundspeed:200,positionAgeSeconds:0}
 const crossed=recoveryEntryPrediction(atFix,s.config,entry,undefined,s.input.timestamp)
 assert.ok(crossed.state.passedAt);const later=recoveryEntryPrediction({...atFix,latitude:fix.latitude+.1},s.config,entry,JSON.parse(JSON.stringify(crossed.state)),s.input.timestamp+60000)
 assert.ok(Math.abs(later.prediction.seconds-crossed.prediction.seconds+60)<.01)
 assert.equal(later.state.passedAt,crossed.state.passedAt)
})

test('a new selection resets the recovery path but stale positions cannot produce an insertion',()=>{
 const s=scenario,waiting=evaluate(s.input,s.config,s.edits,s.previous)
 get(waiting).positionAgeSeconds=16
 assert.throws(()=>reinsertRecoveryEdits(waiting,s.config,s.edits,'ICE306','TEB'),/fresh aircraft/)
 const p=s.input.flights.find(p=>p.callsign==='ICE306'),entry={fix:'OBCIV',runway:'01R',at:s.input.timestamp+1},old={fix:'TEB',runway:'01R',at:s.input.timestamp,passedAt:s.input.timestamp,approachSeconds:600}
 const next=recoveryEntryPrediction(p,s.config,entry,old,s.input.timestamp+2)
 assert.equal(next.state.fix,'OBCIV');assert.equal(next.state.passedAt,undefined)
 assert.equal(recoveryEntryPrediction({...p,positionAgeSeconds:16},s.config,entry,old,s.input.timestamp),undefined)
})


test('a returning aircraft uses its corrected landing forecast for phase instead of the short airport EET',()=>{
 const s=scenario,waiting=evaluate(s.input,s.config,s.edits,s.previous),input=structuredClone(s.input),t=input.runways['ESSA/01R'],h=t.heading*Math.PI/180
 input.timestamp+=60000
 input.flights=input.flights.map(p=>p.callsign==='ICE306'?{...p,latitude:t.latitude-12*Math.cos(h)/60,longitude:t.longitude-12*Math.sin(h)/(60*Math.cos(t.latitude*Math.PI/180)),heading:t.heading,assignedHeading:0,direct:'',altitude:3500,groundspeed:210,verticalSpeed:-500,positionAgeSeconds:0,landingSeconds:60,calculatedRouteIndex:0,route:[{name:'SA01R',seconds:60,latitude:t.latitude,longitude:t.longitude}]}:p)
 const p=get(evaluate(input,s.config,s.edits,waiting))
 assert.equal(p.landingEtaAvailable,true);assert.equal(p.missedRecovery,false)
 assert.ok(p.landingPrediction.seconds>210);assert.notEqual(p.state,3)
})
