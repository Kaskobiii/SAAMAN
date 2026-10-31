import test from 'node:test'
import assert from 'node:assert/strict'
import {trafficProfilePrediction} from '../src/maestro-traffic-profile.ts'
import {predictLanding} from '../src/maestro-landing-prediction.ts'
import {DEFAULT_CONFIG} from '../src/maestro-engine.ts'
import {STAR_FEEDERS,STAR_RUNWAYS,STAR_PROFILES,distanceNm} from '../src/maestro-star-prediction.ts'
const c=()=>structuredClone(DEFAULT_CONFIG)
function plane(extra={}){return {callsign:'PROFILE',aircraft:'A20N',wake:'M',departure:'EPWA',arrival:'ESSA',runway:'19L',star:'NILUG3P',latitude:58.1,longitude:17.9,altitude:30000,groundspeed:440,heading:5,verticalSpeed:0,positionAgeSeconds:0,threshold:STAR_RUNWAYS['19L'],landingSeconds:2000,distanceNm:140,
 route:[{name:'NILUG',...STAR_FEEDERS.NILUG,seconds:600},{name:'DOWNWIND',latitude:60.2,longitude:18.3,seconds:1800},{name:'FI19L',latitude:59.8,longitude:18,seconds:1950},{name:'SA19L',...STAR_RUNWAYS['19L'],seconds:2000}],...extra}}
function predictions(p=plane(),config=c(),options={}){const base=predictLanding(p,config,2);assert.ok(base.routeTiming,'fixture has usable aircraft performance timing');return {base,low:trafficProfilePrediction(p,config,base,'low',options),medium:trafficProfilePrediction(p,config,base,'medium',options),high:trafficProfilePrediction(p,config,base,'high',options)}}
test('workbook shortest, standard vectors and extended downwind give distinct performance-based landing estimates',()=>{
 const {base,low,medium,high}=predictions()
 assert.equal(low.assumption.profile,'shortest');assert.equal(medium.assumption.profile,'standard');assert.equal(high.assumption.profile,'extended')
 assert.equal(low.assumption.terminalDistanceNm,75);assert.equal(medium.assumption.terminalDistanceNm,88);assert.equal(high.assumption.terminalDistanceNm,96);assert.equal(high.assumption.extraTrackNm,8)
 assert.ok(low.prediction.seconds<medium.prediction.seconds);assert.ok(medium.prediction.seconds<high.prediction.seconds)
 for(const result of [low,medium,high]){assert.equal(result.neutralSeconds,base.seconds);assert.equal(result.assumption.neutralSeconds,base.seconds);assert.equal(result.assumption.plannedDistanceNm,result.prediction.distanceNm);assert.equal(result.assumption.secondsCorrection,result.prediction.seconds-base.seconds)}
})
test('changing the expected terminal path leaves the before-feeder time and distance exactly unchanged',()=>{
 const {base,low,medium,high}=predictions()
 for(const result of [low,medium,high]){const timing=result.prediction.routeTiming;assert.deepEqual(timing.feeder,base.routeTiming.feeder);assert.equal(timing.beforeFeederNm,base.routeTiming.beforeFeederNm);assert.equal(result.prediction.seconds,timing.feeder.seconds+timing.afterFeederSeconds)}
})
test('the configured downwind extension changes distance rather than adding fixed minutes',()=>{
 const p=plane(),config=c(),base=predictLanding(p,config,2)
 const zero=trafficProfilePrediction(p,config,base,'high',{highDownwindNm:0}),six=trafficProfilePrediction(p,config,base,'high',{highDownwindNm:6}),medium=trafficProfilePrediction(p,config,base,'medium')
 assert.equal(zero.assumption.extraTrackNm,0);assert.equal(zero.prediction.seconds,medium.prediction.seconds)
 assert.equal(six.assumption.extraTrackNm,12);assert.ok(six.prediction.seconds>medium.prediction.seconds)
 const slower=predictions(plane({groundspeed:350})),faster=predictions()
 assert.ok(slower.high.prediction.seconds>faster.high.prediction.seconds)
 assert.notEqual(slower.high.prediction.seconds-slower.medium.prediction.seconds,faster.high.prediction.seconds-faster.medium.prediction.seconds)
})
test('after-feeder extension tapers with progress and never restores already passed feeder track',()=>{
 const p=plane({latitude:59.2,longitude:18.2,altitude:14000,groundspeed:300,route:plane().route.map((q,i)=>({...q,seconds:i===0?-1:q.seconds}))}),{base,medium,high}=predictions(p,c(),{passedFeeder:true,feeder:'NILUG'})
 assert.equal(base.routeTiming.feeder,undefined);assert.equal(high.prediction.routeTiming.feeder,undefined);assert.equal(high.prediction.routeTiming.beforeFeederNm,0)
 assert.ok(high.assumption.extraTrackNm>0&&high.assumption.extraTrackNm<8);assert.ok(high.prediction.seconds>medium.prediction.seconds)
 assert.ok(high.prediction.distanceNm>=distanceNm(p,p.threshold))
})
test('explicit directs beyond the feeder, RNP, heading clearances and known final approach take precedence',()=>{
 const config=c(),p=plane(),base=predictLanding(p,config,2)
 for(const input of [{...p,direct:'DOWNWIND'},{...p,star:'RNPX19L'},{...p,assignedHeading:270},{...p,topskyHoldingPoint:'NILUG'},{...p,topskyMissedApproach:true}])assert.equal(trafficProfilePrediction(input,config,base,'high').prediction,base)
 const rnp=STAR_PROFILES.find(q=>q.kind==='rnp');assert.ok(rnp)
 assert.equal(trafficProfilePrediction({...p,runway:rnp.runway,arrivalProfile:rnp.id},config,base,'high').prediction,base)
 assert.equal(trafficProfilePrediction(p,config,{...base,establishedFinal:true},'high').assumption,undefined)
 const threshold=STAR_RUNWAYS['19L'],heading=threshold.heading*Math.PI/180
 const final=plane({latitude:threshold.latitude-10*Math.cos(heading)/60,longitude:threshold.longitude-10*Math.sin(heading)/(60*Math.cos(threshold.latitude*Math.PI/180)),altitude:3000,groundspeed:180,heading:threshold.heading})
 assert.equal(trafficProfilePrediction(final,config,base,'high').prediction,base,'ten-mile established final is not extended into a downwind')
})
test('a direct to the feeder retains terminal planning assumptions',()=>{
 const p=plane({direct:'NILUG'}),{low,high}=predictions(p)
 assert.ok(low.assumption);assert.ok(high.assumption);assert.ok(high.prediction.seconds>low.prediction.seconds)
})
test('missing, stale, fallback and unsafe inputs retain the neutral forecast',()=>{
 const config=c(),p=plane(),base=predictLanding(p,config,2)
 for(const input of [{...p,star:'',route:p.route.map(q=>q.name==='NILUG'?{...q,name:'UNKNOWN',latitude:58.6,longitude:17.2}:q)},{...p,positionAgeSeconds:16},{...p,speedDataValid:false},{...p,routeProblem:'bad route'}])assert.equal(trafficProfilePrediction(input,config,base,'low').prediction,base)
 for(const method of ['arrival-profile','fallback','route-slowdown','vector-position','recovery-iaf'])assert.equal(trafficProfilePrediction(p,config,{...base,method},'low').assumption,undefined)
 for(const highDownwindNm of [-1,Infinity,21])assert.equal(trafficProfilePrediction(p,config,base,'high',{highDownwindNm}).prediction,base)
})
test('the adapter never changes telemetry, clearance, config or the neutral prediction',()=>{
 const p=plane(),config=c(),base=predictLanding(p,config,2),before=structuredClone({p,config,base})
 for(const mode of ['low','medium','high'])trafficProfilePrediction(p,config,base,mode)
 assert.deepEqual({p,config,base},before)
})

test('a high aircraft too close to the feeder cannot gain an early ETA from an unreachable entry altitude',()=>{
 const p=plane({latitude:STAR_FEEDERS.NILUG.latitude-.01,longitude:STAR_FEEDERS.NILUG.longitude,altitude:43000,groundspeed:460}),config=c(),base=predictLanding(p,config,2)
 assert.ok(base.routeTiming&&base.routeTiming.feeder.seconds<60)
 const result=trafficProfilePrediction(p,config,base,'low')
 assert.equal(result.prediction,base);assert.equal(result.assumption,undefined)
})
test('a high aircraft after the feeder retains neutral timing when the shortest path cannot satisfy descent performance',()=>{
 const p=plane({latitude:59.2,longitude:18.2,altitude:43000,groundspeed:460,route:plane().route.map((q,i)=>({...q,seconds:i===0?-1:q.seconds}))}),config=c(),base=predictLanding(p,config,2)
 assert.ok(base.routeTiming&&!base.routeTiming.feeder)
 const result=trafficProfilePrediction(p,config,base,'low',{passedFeeder:true,feeder:'NILUG'})
 assert.equal(result.prediction,base);assert.equal(result.assumption,undefined)
})
test('a feasible slower light jet keeps ordered Low, Medium and High predictions with a type-aware descent floor',()=>{
 const {low,medium,high}=predictions(plane({aircraft:'HDJT',wake:'L',altitude:16000,groundspeed:300}))
 assert.ok(low.assumption&&medium.assumption&&high.assumption)
 assert.ok(low.prediction.seconds<medium.prediction.seconds);assert.ok(medium.prediction.seconds<high.prediction.seconds)
 for(const result of [low,medium,high])assert.ok(result.prediction.routeTiming.afterFeederSeconds>=result.assumption.minimumDescentSeconds)
})
