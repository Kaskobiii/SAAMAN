import {test} from 'node:test'
import assert from 'node:assert/strict'
import {runEngine,controllerInstructionSeconds} from '../src/maestro-engine.ts'
import {predictLanding} from '../src/maestro-landing-prediction.ts'
import {planningRouteProgress} from '../src/maestro-route-progress.ts'
import {initialProfileHandover} from '../src/maestro-initial-profile.ts'
import {bearingBetween} from '../src/maestro-geometry.ts'
import {distanceNm,STAR_FEEDERS} from '../src/maestro-star-prediction.ts'
import fixture from './fixtures/live-nov4-timing.json' with {type:'json'}
const row=(s,n)=>s.flights.find(f=>f.callsign===n)
const project=c=>{const x=structuredClone(c);x.previous.timestamp=Math.min(x.previous.timestamp,x.input.timestamp-1);return runEngine(x.input,x.config,x.edits,x.previous)}
const lot=()=>structuredClone(fixture.lot.input.flights.find(p=>p.callsign==='LOT6LT'))

test('consumed positive FLEG clocks cannot turn an 11 NM approach into a 25-minute landing forecast',()=>{
 const c=structuredClone(fixture.lot),copy=structuredClone(c),s=project(c),f=row(s,'LOT6LT')
 assert.equal(f.landingPrediction.method,'aircraft-profile')
 assert.equal(f.landingPrediction.routeProgress.index,16)
 assert.equal(f.landingPrediction.routeProgress.consumedDirect,'NILUG')
 assert.ok(f.landingPrediction.distanceNm<11);assert.ok(f.landingPrediction.seconds>180&&f.landingPrediction.seconds<230)
 assert.ok(Math.abs(f.liveBufferedEta-Date.UTC(2026,10,4,18,29,29,718))<20000)
 assert.equal(f.delay,0);assert.deepEqual(c,copy)
 const q=s.flights.filter(f=>f.mode==='sequenced'&&!f.issue&&f.state!==4&&f.runway==='01L').sort((a,b)=>a.order-b.order)
 for(let i=1;i<q.length;i++)assert.ok(q[i].sta-q[i-1].sta>=121000-1)
})

test('planning route repair retains a genuine return direct, HOLD, RNP, stale data and unrelated route errors',()=>{
 const p=lot(),direct=p.route.find(q=>q.name===p.direct),original=structuredClone(p)
 assert.ok(planningRouteProgress(p));assert.deepEqual(p,original)
 for(const extra of [{heading:bearingBetween(p,direct)},{topskyHoldingPoint:'NILUG'},{star:'RNPX19R'},{positionAgeSeconds:16},{routeProblem:'Unknown destination route'},{calculatedRouteIndex:999},{assignedHeading:20}])
  assert.equal(planningRouteProgress({...p,...extra}),undefined,JSON.stringify(extra))
})

test('new return direct is retained before the aircraft starts turning and on later forward-track updates',()=>{
 const c=structuredClone(fixture.lot),p=c.input.flights.find(p=>p.callsign==='LOT6LT')
 p.direct='SA630'
 const first=row(project(c),'LOT6LT').landingPrediction
 assert.equal(first.routeProgress,undefined);assert.equal(first.rawClockRejected,undefined)
 assert.equal(first.directClearance.point,'SA630');assert.equal(first.directClearance.returning,true)
 const next=predictLanding(p,c.config,1,JSON.parse(JSON.stringify(first)),c.input.timestamp+20000)
 assert.equal(next.routeProgress,undefined);assert.equal(next.rawClockRejected,undefined)
 assert.equal(next.directClearance.at,first.directClearance.at)
})

test('unchanged SDK runway cannot create a reverse transition after a shared planned change',()=>{
 const c=structuredClone(fixture.runway)
 // Isolate an already accepted Stable flight from the initial-climb guard.
 row(c.previous,'SAS46R').initialProfile={pending:false,capture:c.previous.timestamp,workSeconds:0}
 let s=project(c),first=row(s,'SAS46R')
 assert.equal(first.runway,'01L');assert.equal(first.delay,0)
 for(let i=0;i<4;i++){
  s=JSON.parse(JSON.stringify(s));s.timestamp=c.input.timestamp-1;s=runEngine(c.input,c.config,c.edits,s)
  const f=row(s,'SAS46R');assert.equal(f.runway,'01L');assert.equal(f.runwayTransition?.pending,undefined)
  assert.equal(f.sta,first.sta);assert.equal(f.staFf,first.staFf);assert.equal(f.delay,0)
 }
})

test('trusted explicit shortcut releases stale automatic allocation without a controller Recompute',()=>{
 const c=fixture.shortcut,s=project(c),f=row(s,'NSZ2041'),old=row(c.previous,'NSZ2041')
 assert.ok(old.delay>400);assert.equal(f.delay,0);assert.equal(f.sta,f.liveBufferedEta)
 assert.equal(f.recomputedAt,old.recomputedAt,'automatic acceptance does not invent an edit stamp')
 assert.ok(f.sta<old.sta-400000);assert.equal(f.feederGuidanceBypassed,true)
 for(const target of [old.sta+60000]){
  const manual=structuredClone(c);manual.edits.NSZ2041={...manual.edits.NSZ2041,target,targetKind:'time',changedAt:manual.input.timestamp}
  assert.ok(row(project(manual),'NSZ2041').sta>=target)
 }
})

test('the slow turboprop feeder forecast cannot require an unobserved acceleration to become Superstable',()=>{
 const c=fixture.gain,s=project(c),f=row(s,'SAS45H'),p=row(c.input,'SAS45H'),old=row(c.previous,'SAS45H')
 const minimumSeconds=distanceNm(p,STAR_FEEDERS.NILUG)/p.groundspeed*3600-(p.positionAgeSeconds??0)
 assert.equal(old.state,1);assert.ok(minimumSeconds>450)
 assert.ok(f.etaFf>=c.input.timestamp+minimumSeconds*1000-1)
 assert.equal(f.state,1);assert.equal(f.sta,old.sta);assert.equal(f.staFf,old.staFf)
 assert.ok(controllerInstructionSeconds(f)<0,'the protected feeder slot is earlier than its credible current ETA')
})

test('Superstable guidance cannot retain gain when the fresh feeder pair requires lose',()=>{
 const c=structuredClone(fixture.gain),p=row(c.input,'SAS45H'),old=row(c.previous,'SAS45H')
 c.input.flights=[p];c.previous.flights=[old]
 const feederSeconds=distanceNm(p,STAR_FEEDERS.NILUG)/p.groundspeed*3600-(p.positionAgeSeconds??0)
 const target=c.input.timestamp+(feederSeconds+54)*1000,delta=target-old.staFf
 old.state=2;old.staFf=target;old.sta+=delta
 old.guidance.scheduled=target
 assert.equal(old.delay,-66,'the stored instruction has the obsolete gain sign')
 const f=row(project(c),'SAS45H')
 assert.equal(f.state,2);assert.equal(f.sta,old.sta);assert.equal(f.staFf,old.staFf)
 assert.equal(f.delay,54);assert.equal(controllerInstructionSeconds(f),54)
})

test('an airborne climb away from final cannot accept a zero threshold clock as landing now',()=>{
 const c=fixture.zero,p=c.flight,a=predictLanding(p,c.config,1,undefined,c.timestamp)
 assert.ok(p.altitude>3000);assert.equal(a.rawSeconds,0);assert.equal(a.rawClockRejected,true)
 assert.equal(a.method,'vector-position');assert.equal(a.vectoringOnly,true);assert.equal(a.establishedFinal,false)
 assert.ok(a.seconds>300&&a.seconds<1200)
 assert.equal(predictLanding({...p,positionAgeSeconds:16},c.config,1).rawClockRejected,undefined)
 assert.equal(predictLanding({...p,altitude:150},c.config,1).rawClockRejected,undefined)
})

test('incidental order normalization and automatic runway confirmation cannot cancel a pending climb handover',()=>{
 const c=fixture.runway,p=c.input.flights.find(p=>p.callsign==='SAS46R'),old=structuredClone(row(c.previous,'SAS46R'))
 old.state=0;old.initialProfile={pending:true,capture:old.firstSeen,reason:'climb',workSeconds:0}
 const prediction={method:'fallback',seconds:1000,rawSeconds:900,correctionSeconds:100,reference:'threshold',establishedFinal:false}
 assert.equal(initialProfileHandover(p,old,{order:4,orderExplicit:false},prediction,c.input.timestamp,false).state.pending,true)
 assert.equal(initialProfileHandover(p,old,{},prediction,c.input.timestamp,true,true,false,'runway').state.pending,true)
 assert.equal(initialProfileHandover(p,old,{order:4,orderExplicit:true},prediction,c.input.timestamp,false).state.pending,false)
 assert.equal(initialProfileHandover(p,old,{},prediction,c.input.timestamp,true).state.pending,false)
 const active=structuredClone(c);row(active.previous,'SAS46R').initialProfile=old.initialProfile;row(active.previous,'SAS46R').state=0
 const climbing=project(active);assert.equal(row(climbing,'SAS46R').state,0);assert.equal(row(climbing,'SAS46R').initialProfile.pending,true)
})
