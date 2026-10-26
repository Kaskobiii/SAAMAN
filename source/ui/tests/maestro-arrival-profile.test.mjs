import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DEFAULT_CONFIG,runEngine,toJuhaSequence} from '../src/maestro-engine.ts'
import {STAR_FEEDERS,STAR_RUNWAYS,starPrediction} from '../src/maestro-star-prediction.ts'
import {manualArrivalProfile} from '../src/maestro-arrival-profile.ts'

const now=Date.UTC(2026,9,25,12),profile='26:VACRA:VACRA1T',ff=STAR_FEEDERS.VACRA,threshold=STAR_RUNWAYS['26']
const position=(fraction=.2)=>({latitude:ff.latitude+(ff.latitude-threshold.latitude)*fraction,longitude:ff.longitude+(ff.longitude-threshold.longitude)*fraction})
const config=()=>({...structuredClone(DEFAULT_CONFIG),active:['ESSA/26'],unstableSeconds:60})
const flight=(extra={})=>({callsign:'MISSING',aircraft:'A320',wake:'M',departure:'EFHK',arrival:'ESSA',runway:'26',star:'',route:[{name:'SA26',...threshold,seconds:600}],landingSeconds:600,distanceNm:50,groundspeed:300,altitude:12000,heading:230,...position(),...extra})
const packet=(p,t=now)=>({source:'LIVE',timestamp:t,flights:[p]})
const edits=(t=now,extra={})=>({MISSING:{arrivalProfile:profile,recomputeAt:t,changedAt:t,...extra}})
const manual=(p=flight(),t=now,previous,c=config(),extra={})=>runEngine(packet(p,t),c,edits(t,extra),previous)

test('a missing feeder alone leaves a usable runway forecast Unstable; selection supplies the planning feeder',()=>{
 const p=flight(),c=config(),before=runEngine(packet(p),c,{})
 assert.equal(before.flights[0].issue,'');assert.equal(before.flights[0].mode,'sequenced')
 assert.equal(before.flights[0].state,0);assert.equal(before.flights[0].feederEtaAvailable,false)
 const next=manual(p,now+1000,before,c),f=next.flights[0]
 assert.equal(f.ff,'VACRA');assert.equal(f.feederEtaAvailable,true);assert.equal(f.feederObservationSource,'arrival-profile')
 assert.ok(f.state>=1);assert.equal(f.issue,'');assert.equal(f.passedFeeder,false)
 assert.ok(f.etaFf>next.timestamp);assert.ok(f.eta>f.etaFf)
 assert.equal(toJuhaSequence(next,c,edits(now+1000)).sequence[0].callsign,'MISSING')
})

test('an explicit profile works on first detection without changing the SDK route, STAR or raw EET',()=>{
 const p=flight(),original=structuredClone(p),s=manual(p),f=s.flights[0]
 const model=starPrediction({...p,arrivalProfile:profile,threshold},config())
 assert.equal(f.issue,'');assert.ok(f.state>=1);assert.equal(f.predictionSource,'star-distance')
 assert.equal(f.arrivalProfile,profile);assert.equal(f.landingPrediction.method,'arrival-profile');assert.equal(f.landingPrediction.arrivalProfile,profile)
 assert.equal(f.distanceProfile.id,profile);assert.ok(Math.abs(f.eta-now-model.seconds*1000)<.01)
 assert.ok(Math.abs(f.etaFf-now-model.feederSeconds*1000)<.01,'the model feeder time receives no second buffer')
 assert.deepEqual(p,original);assert.deepEqual(f.route,original.route);assert.equal(f.star,original.star);assert.equal(f.landingSeconds,original.landingSeconds)
 assert.equal(f.liveEuroscopeEtaFf,undefined);assert.equal(f.euroscopeBaseline.rawEtaFf,undefined)
})

test('selected arrival profiles recover unusable raw destination predictions and empty routes',()=>{
 for(const bad of [{landingSeconds:-1,route:[]},{landingSeconds:-1,route:[{name:'SA26',...threshold,seconds:-1}]},{landingSeconds:20000,routeProblem:'No usable destination route'}]){
  const p=flight(bad),c=config(),before=runEngine(packet(p),c,{})
  assert.ok(before.flights[0].issue)
  const s=manual(p,now+1000,JSON.parse(JSON.stringify(before)),c),f=s.flights[0]
  assert.equal(f.issue,'');assert.equal(f.ff,'VACRA');assert.equal(f.feederEtaAvailable,true);assert.ok(f.state>=1)
  assert.ok(f.etaFf>s.timestamp);assert.ok(f.eta>f.etaFf);assert.ok(f.sta>=f.eta)
  assert.equal(f.liveEuroscopeEta,undefined);assert.equal(f.euroscopeBaseline.rawEta,undefined)
  assert.deepEqual(f.route,p.route);assert.equal(f.originalLandingSeconds,p.landingSeconds)
 }
})

test('manual workbook timing is independent of raw EuroScope EET and route diagnostics',()=>{
 const a=manual().flights[0],b=manual(flight({landingSeconds:9999,routeProblem:'Filed route incomplete',route:[{name:'SA26',...threshold,seconds:9999}]})).flights[0]
 assert.equal(a.eta,b.eta);assert.equal(a.etaFf,b.etaFf);assert.equal(a.distanceProfile.fullNm,b.distanceProfile.fullNm);assert.equal(b.issue,'')
})

test('a selected profile persists through a checkpoint and Recompute accepts its current geometry',()=>{
 const first=manual(),old=JSON.parse(JSON.stringify(first)),p=flight({...position(.1)})
 const continued=runEngine(packet(p,now+1000),config(),edits(),old).flights[0]
 assert.equal(continued.arrivalProfile,profile);assert.equal(continued.ff,'VACRA');assert.equal(continued.issue,'')
 assert.equal(continued.euroscopeBaseline.at,now)
 const recomputed=manual(p,now+2000,old).flights[0]
 assert.equal(recomputed.euroscopeBaseline.at,now+2000);assert.ok(recomputed.eta<first.flights[0].eta)
 assert.equal(recomputed.state,first.flights[0].state)
})

test('clearing a pre-feeder selection returns to raw planning without retaining its inferred feeder',()=>{
 const first=manual(),t=now+1000,next=runEngine(packet(flight(),t),config(),{MISSING:{recomputeAt:t,changedAt:t}},JSON.parse(JSON.stringify(first))).flights[0]
 assert.equal(next.arrivalProfile,undefined);assert.notEqual(next.landingPrediction.method,'arrival-profile');assert.equal(next.distanceProfile,undefined)
 assert.equal(next.ff,'-');assert.equal(next.feederEtaAvailable,false);assert.equal(next.issue,'')
 const invalid=runEngine(packet(flight({landingSeconds:-1,route:[]}),t),config(),{MISSING:{recomputeAt:t}},first).flights[0]
 assert.ok(invalid.issue);assert.equal(invalid.euroscopeBaseline,undefined,'clearing cannot retain a workbook capture as if it came from the SDK')
})

test('a mismatched or unknown selection reports the selected-route problem without bypassing runway validation',()=>{
 for(const selection of ['01L:VACRA:VACRA1M','not-a-profile']){
  const f=manual(flight({landingSeconds:-1,route:[]}),now,undefined,config(),{arrivalProfile:selection}).flights[0]
  assert.match(f.issue,/Selected Arrival route.*runway/);assert.equal(f.state,0)
 }
 const f=manual(flight({runway:'99'})).flights[0]
 assert.equal(f.issue,'No valid assigned arrival runway')
})

test('profile selection needs fresh usable airborne geometry',()=>{
 for(const bad of [{latitude:undefined},{positionAgeSeconds:16},{groundspeed:0},{altitude:100},{speedDataValid:false}]){
  const f=manual(flight({...bad,landingSeconds:-1,route:[]})).flights[0]
  assert.notEqual(f.landingPrediction?.method,'arrival-profile');assert.equal(f.feederEtaAvailable,false);assert.equal(f.state,0)
 }
})

test('heading and direct clearances do not acquire a workbook path back through the selected feeder',()=>{
 for(const extra of [{assignedHeading:90,heading:90},{direct:'SA26',heading:90},{direct:'UNKNOWN',heading:90}]){
  const p=flight(extra),f=manual(p).flights[0]
  assert.notEqual(f.landingPrediction.method,'arrival-profile');assert.equal(f.feederEtaAvailable,false);assert.equal(f.passedFeeder,false)
  assert.equal(f.ff,'VACRA');assert.deepEqual(f.route,p.route)
 }
})

test('an active TopSky hold cannot be converted into selected-route feeder passage',()=>{
 const f=manual(flight({...ff,topskyHoldingPoint:'VACRA'})).flights[0]
 assert.equal(f.feederObservationSource,'holding');assert.equal(f.passedFeeder,false);assert.notEqual(f.landingPrediction.method,'arrival-profile')
})

test('verified feeder passage survives selection recomputation and cannot create a new crossing',()=>{
 const p=flight({...ff}),first=manual(p),f=manual(flight({...position(.01)}),now+1000,JSON.parse(JSON.stringify(first))).flights[0]
 assert.equal(first.flights[0].passedFeeder,true);assert.equal(f.passedFeeder,true);assert.equal(f.etaFf,first.flights[0].etaFf)
})

test('arrival selection preserves explicit mode and missed-approach recovery requirements',()=>{
 for(const mode of ['desequenced','removed','missed'])assert.equal(manual(flight(),now,undefined,config(),{mode}).flights[0].mode,mode)
 const first=manual(),missed=manual(flight({landingSeconds:-1,route:[]}),now+1000,first,config(),{mode:'missed'})
 const resumed=manual(flight({landingSeconds:-1,route:[]}),now+2000,missed,config(),{mode:'sequenced'}).flights[0]
 assert.equal(resumed.missedRecovery,true);assert.equal(resumed.landingEtaAvailable,false);assert.notEqual(resumed.landingPrediction?.method,'arrival-profile')
})

test('controller slot and order edits survive applying a selected profile',()=>{
 const first=manual(),t=now+1000,target=now+1500000,e={arrivalProfile:profile,recomputeAt:t,changedAt:t,order:4,target,targetKind:'time',orderExplicit:true}
 const f=runEngine(packet(flight(),t),config(),{MISSING:e},first).flights[0]
 assert.equal(f.sta,target);assert.equal(f.appliedOrder,4);assert.equal(f.appliedTarget,target);assert.equal(f.mode,'sequenced');assert.equal(f.state,first.flights[0].state)
})

test('the explicit helper does not infer a selection from SDK or filed STAR fields',()=>{
 const p=flight({arrivalProfile:profile,star:'VACRA1T',threshold})
 assert.equal(manualArrivalProfile(p,config(),undefined,undefined,now),undefined)
 const f=runEngine(packet(p),config(),{}).flights[0]
 assert.notEqual(f.landingPrediction.method,'arrival-profile')
})


test('clearing after a heading fallback removes a pre-feeder manual selection and its cache',()=>{
 const first=manual(),p=flight({assignedHeading:90,heading:90}),t=now+1000
 const heading=runEngine(packet(p,t),config(),edits(),first),old=heading.flights[0]
 assert.notEqual(old.landingPrediction.method,'arrival-profile');assert.equal(old.euroscopeBaseline.arrivalProfile,profile)
 const cleared=runEngine(packet(p,t+1000),config(),{MISSING:{recomputeAt:t+1000}},JSON.parse(JSON.stringify(heading))).flights[0]
 assert.equal(cleared.arrivalProfile,undefined);assert.equal(cleared.ff,'-');assert.equal(cleared.feederEtaAvailable,false)
 assert.equal(cleared.euroscopeBaseline.arrivalProfile,undefined);assert.notEqual(cleared.landingPrediction.method,'arrival-profile')
})

test('changing a selected route during a pause retains accepted timing until motion resumes',()=>{
 const first=manual(),nextProfile='26:ELTOK:ELTOK5T',e={MISSING:{arrivalProfile:nextProfile,recomputeAt:now+22000,changedAt:now+22000}}
 const waiting=runEngine(packet(flight(),now+10000),config(),edits(),first)
 const paused=runEngine(packet(flight(),now+22000),config(),e,waiting),p=paused.flights[0],old=waiting.flights[0]
 assert.equal(p.motionTiming.held,true);assert.equal(p.issue,'');assert.equal(p.sta,old.sta);assert.equal(p.staFf,old.staFf)
 assert.deepEqual(p.euroscopeBaseline,old.euroscopeBaseline);assert.equal(p.ff,old.ff);assert.equal(p.distanceProfile.id,profile)
 const moved=flight({...position(.18)}),m1=runEngine(packet(moved,now+24000),config(),e,paused)
 const m2=runEngine(packet(flight({...position(.15)}),now+35000),config(),e,m1).flights[0]
 assert.equal(m2.motionTiming.held,false);assert.equal(m2.euroscopeBaseline.arrivalProfile,nextProfile);assert.equal(m2.ff,'ELTOK')
})

test('clearing during a pause defers replacement of the accepted selected-route baseline',()=>{
 const first=manual(),waiting=runEngine(packet(flight(),now+10000),config(),edits(),first)
 const e={MISSING:{recomputeAt:now+22000,changedAt:now+22000}},paused=runEngine(packet(flight(),now+22000),config(),e,waiting)
 assert.equal(paused.flights[0].motionTiming.held,true);assert.equal(paused.flights[0].issue,'')
 assert.deepEqual(paused.flights[0].euroscopeBaseline,first.flights[0].euroscopeBaseline)
 const m1=runEngine(packet(flight({...position(.18)}),now+24000),config(),e,paused)
 const m2=runEngine(packet(flight({...position(.15)}),now+35000),config(),e,m1).flights[0]
 assert.equal(m2.motionTiming.held,false);assert.equal(m2.euroscopeBaseline.arrivalProfile,undefined);assert.equal(m2.ff,'-')
})
