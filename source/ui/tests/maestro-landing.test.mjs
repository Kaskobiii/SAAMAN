import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DEFAULT_CONFIG,runEngine,euroscopeInstruction} from '../src/maestro-engine.ts'
import {predictLanding,routeSlowdownSeconds} from '../src/maestro-landing-prediction.ts'
import fixture from './fixtures/recording-9-landing.json' with {type:'json'}
const config=()=>({...structuredClone(DEFAULT_CONFIG),unstableSeconds:0,minimumNewSeconds:0})
const p=(extra={})=>({callsign:'APPROACH',aircraft:'A320',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'19R',latitude:60,longitude:18,altitude:18000,groundspeed:400,heading:190,positionAgeSeconds:0,
 route:[{name:'SA19R',seconds:600,latitude:59.6664,longitude:17.92377},{name:'ESSA',seconds:660,latitude:59.65194,longitude:17.91861}],landingSeconds:660,distanceNm:21,...extra})

test('landing reference is the assigned threshold instead of the later airport endpoint',()=>{
 const f=p(),a=predictLanding(f,config(),1),b=predictLanding({...f,landingSeconds:1800,route:[f.route[0],{...f.route[1],seconds:1800}]},config(),1)
 assert.equal(a.reference,'threshold');assert.equal(a.rawSeconds,600);assert.deepEqual(a,b)
 const fallback=predictLanding({...f,route:[f.route[1]]},config(),1)
 assert.equal(fallback.reference,'airport');assert.equal(fallback.method,'fallback');assert.equal(fallback.rawSeconds,660)
})

test('remaining distance changes the slowdown correction even at identical groundspeed',()=>{
 const near=predictLanding(p(),config(),1),far=predictLanding(p({latitude:61}),config(),1)
 assert.equal(near.method,'route-slowdown');assert.equal(far.method,'route-slowdown')
 assert.ok(far.distanceNm>near.distanceNm);assert.ok(far.correctionSeconds>near.correctionSeconds)
 assert.ok(near.seconds>=near.rawSeconds);assert.ok(far.correctionSeconds<=7*60)
 const limited=predictLanding(p({latitude:65}),{...config(),euroscopeHighSpeedBufferMinutes:0},1)
 assert.ok(limited.correctionSeconds<=60)
})

test('the slowdown profile never accelerates slower aircraft and is continuous across profile boundaries',()=>{
 for(const speed of [80,120,180,300,450,500])for(const d of [1,4,10,20,40,100,250]){
  const seconds=routeSlowdownSeconds(d,speed)
  assert.ok(Number.isFinite(seconds)&&seconds>=d/speed*3600-.0001)
  assert.ok(routeSlowdownSeconds(d+.01,speed)>=seconds)
 }
 assert.ok(routeSlowdownSeconds(60,120)>routeSlowdownSeconds(60,300))
 assert.equal(routeSlowdownSeconds(0,120),0);assert.equal(routeSlowdownSeconds(NaN,300),undefined)
 assert.equal(routeSlowdownSeconds(20,0),undefined)
})

test('heading vectors, missing route geometry and stale positions use an explicit fallback without a speed-only addition',()=>{
 for(const extra of [{assignedHeading:210},{latitude:undefined},{positionAgeSeconds:16},{route:[{name:'SA19R',seconds:600}]}]){
  const result=predictLanding(p(extra),config(),1)
  assert.equal(result.method,'fallback');assert.ok(result.correctionSeconds<=90)
 }
 const zero=predictLanding(p({latitude:undefined,landingSeconds:0,route:[]}),config(),1)
 assert.equal(zero.seconds,0)
 const capped=predictLanding(p({latitude:undefined,route:[{name:'SA19R',seconds:3600}]}),config(),15)
 assert.equal(capped.correctionSeconds,15*60)
})

test('recording 9 fresh capture no longer starts four minutes late',()=>{
 const {input,config:c}=fixture.frames[0],first=runEngine(input,c,{}).flights[0]
 assert.equal(first.landingPrediction.method,'route-slowdown')
 assert.ok(Math.abs(first.eta-fixture.recordedArrival)<90000,'initial forecast is within 90 seconds of the observed arrival')
 assert.equal(first.sta,first.eta)
})

test('recording 9 short-final forecast converges to the threshold with no one-minute floor',()=>{
 const frame=fixture.frames[2],p=frame.input.flights[0],result=predictLanding(p,frame.config,1)
 assert.equal(result.method,'final-position');assert.equal(result.reference,'threshold')
 const eta=frame.input.timestamp+result.seconds*1000
 assert.ok(Math.abs(eta-fixture.thresholdCrossing)<15000)
 const nearing=fixture.frames[5],close=predictLanding(nearing.input.flights[0],nearing.config,1)
 assert.ok(close.seconds<5,'threshold crossing must not inherit a one-minute buffer')
 const crossed=fixture.frames[6],past=predictLanding(crossed.input.flights[0],crossed.config,1)
 assert.equal(past.seconds,0)
})

test('established airborne ETA continues below 350 feet while capture, assigned slots and instructions remain protected',()=>{
 let previous=structuredClone(fixture.previous);const original=structuredClone(previous),accepted=previous.flights[0]
 for(const frame of fixture.frames.slice(1)){
  const next=runEngine(frame.input,frame.config,frame.edits,previous),f=next.flights[0]
  assert.equal(f.sta,accepted.sta);assert.equal(f.staFf,accepted.staFf);assert.equal(f.order,accepted.order)
  assert.deepEqual(f.euroscopeBaseline,accepted.euroscopeBaseline);assert.equal(euroscopeInstruction(f),euroscopeInstruction(accepted))
  if(frame.input.flights[0].altitude<350){
   assert.ok(Number.isFinite(f.liveBufferedEta));assert.equal(f.eta,f.liveBufferedEta)
   assert.ok(f.eta<fixture.recordedArrival+15000,'low-altitude forecast cannot remain frozen at 09:42')
  }
  previous=next
 }
 assert.deepEqual(fixture.previous,original)
})

test('the initial ground guard remains and an aligned climbing aircraft is not treated as established final',()=>{
 const low=fixture.frames[4],input=structuredClone(low.input)
 const ground=runEngine(input,low.config,{}).flights[0]
 assert.equal(ground.euroscopeBaseline,undefined)
 const climb=predictLanding({...input.flights[0],verticalSpeed:1500},low.config,1)
 assert.notEqual(climb.method,'final-position')
})

test('position age is deducted from geometry forecasts, while heading and cross-track guard the final shortcut',()=>{
 const {input,config:c}=fixture.frames[2],f=input.flights[0]
 const a=predictLanding({...f,positionAgeSeconds:0},c,1),b=predictLanding({...f,positionAgeSeconds:5},c,1)
 assert.equal(a.seconds-b.seconds,5)
 assert.notEqual(predictLanding({...f,heading:(f.heading+90)%360},c,1).method,'final-position')
 assert.notEqual(predictLanding({...f,longitude:f.longitude+.1},c,1).method,'final-position')
})

test('an existing five-minute holding instruction is preserved through live final ETA changes without a refresh',()=>{
 const seed=structuredClone(fixture.previous),f=seed.flights[0],stamp=seed.timestamp-1
 const edits={[f.callsign]:{target:f.sta,targetKind:'time',changedAt:stamp}}
 Object.assign(f,{delay:300,spacingActive:true,appliedTarget:f.sta,appliedChangedAt:stamp,tmaTiming:{delay:300,rateSeconds:96,instructionSource:'manual'}})
 let previous=seed
 for(const frame of fixture.frames.slice(1,6)){
  previous=runEngine(frame.input,frame.config,edits,previous)
  const current=previous.flights[0]
  assert.equal(current.sta,f.sta);assert.equal(current.delay,300);assert.equal(current.order,f.order)
 }
})

test('vectors retain a recent model correction across checkpoints without feeding assigned delay into ETA',()=>{
 const now=1_000_000,f=p({latitude:61}),c=config(),model=predictLanding(f,c,1,undefined,now)
 assert.ok(model.correctionSeconds>90)
 const vector={...f,assignedHeading:210},checkpoint=JSON.parse(JSON.stringify(model))
 const held=predictLanding(vector,c,1,checkpoint,now+5000)
 assert.equal(held.method,'retained-slowdown');assert.equal(held.correctionSeconds,model.correctionSeconds)
 assert.equal(held.continuity.at,now)
 const again=predictLanding(vector,c,1,held,now+9*60000)
 assert.equal(again.continuity.at,now,'fallback must not renew the source observation')
 assert.equal(predictLanding(vector,c,1,again,now+10*60000+1).method,'fallback')
 assert.equal(predictLanding({...vector,runway:'01R'},c,1,held,now+6000).continuity,undefined)
 assert.equal(predictLanding({...vector,positionAgeSeconds:16},c,1,held,now+6000).method,'fallback')
 assert.equal(predictLanding(vector,c,1,undefined,now+6000).method,'fallback','old capture buffers are not a source')
 const {input,config:fc}=fixture.frames[2]
 const final=predictLanding(input.flights[0],fc,1,held,now+6000)
 assert.equal(final.method,'final-position');assert.equal(final.continuity,undefined)
})

test('engine handover preserves vector correction and accepted planning times independently',()=>{
 const timestamp=2_000_000,c=config(),f=p({latitude:61})
 f.route.unshift({name:'ELTOK',seconds:300,latitude:60.8,longitude:18})
 const input={timestamp,source:'ESSA_FMP',flights:[f]}
 const initial=runEngine(input,c,{}),accepted=initial.flights[0]
 assert.ok(accepted.landingPrediction.correctionSeconds>90)
 const checkpoint=JSON.parse(JSON.stringify(initial)),nextInput={...input,timestamp:timestamp+5000,flights:[{...f,assignedHeading:210}]}
 const next=runEngine(nextInput,c,{},checkpoint).flights[0]
 assert.equal(next.landingPrediction.method,'retained-slowdown')
 assert.equal(next.landingPrediction.correctionSeconds,accepted.landingPrediction.correctionSeconds)
 assert.equal(next.sta,accepted.sta);assert.equal(next.staFf,accepted.staFf);assert.equal(next.order,accepted.order)
 assert.deepEqual(next.euroscopeBaseline,accepted.euroscopeBaseline)
 assert.equal(next.eta,nextInput.timestamp+next.landingPrediction.seconds*1000)
 assert.deepEqual(checkpoint,JSON.parse(JSON.stringify(initial)),'handover checkpoint remains immutable')
})
