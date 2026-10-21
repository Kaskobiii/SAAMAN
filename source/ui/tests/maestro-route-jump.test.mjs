import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DEFAULT_CONFIG,runEngine,appendAutomaticCorrection} from '../src/maestro-engine.ts'

const now=Date.UTC(2026,9,21,12),legacyIssue='Route ETA jumped by more than 10 minutes; review route and Recompute'
const config=()=>({...structuredClone(DEFAULT_CONFIG),unstableSeconds:0,minimumNewSeconds:0,active:['ESSA/19R'],departureRunway:'ESSA/19L'})
const p={callsign:'JUMP',aircraft:'A320',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'19R',route:[{name:'ELTOK',seconds:600}],landingSeconds:1500,distanceNm:100,groundspeed:300,altitude:25000,positionAgeSeconds:0}
const packet=(p,elapsed=0)=>({source:'LIVE',timestamp:now+elapsed*1000,flights:[structuredClone(p)]})
const flight=s=>s.flights[0]
const start=(c=config(),plane=p,e={})=>runEngine(packet(plane),c,e)
const raw=(elapsed,extra={})=>({...p,landingSeconds:2400-elapsed,route:[{name:'ELTOK',seconds:1500-elapsed}],...extra})
const profile={...p,aircraft:'A20N',latitude:61,longitude:18,altitude:30000,groundspeed:300,verticalSpeed:0,
 route:[{name:'ELTOK',seconds:500,latitude:60.4,longitude:18},{name:'FI19R',seconds:900,latitude:59.8,longitude:17.95},{name:'SA19R',seconds:1000,latitude:59.6664,longitude:17.92377}],landingSeconds:1060,distanceNm:80}
const extended=(elapsed)=>({...profile,latitude:61-elapsed*.001,
 route:[profile.route[0],{name:'EXTEND',seconds:700,latitude:61.4,longitude:18.2},...profile.route.slice(1)]})

test('a persistent raw FLEG jump retains usable timing, phase and slots with one protective correction event',()=>{
 const c=config();let s=start(c);const saved=structuredClone(s),old=flight(s)
 for(const elapsed of [2,8,18,30,60]){
  s=runEngine(packet(raw(elapsed),elapsed),c,{},JSON.parse(JSON.stringify(s)));const f=flight(s)
  assert.equal(f.issue,'');assert.equal(f.state,old.state);assert.equal(f.order,old.order)
  assert.equal(f.sta,old.sta);assert.equal(f.staFf,old.staFf);assert.equal(f.delay,old.delay)
  assert.equal(f.eta,old.eta);assert.equal(f.etaFf,old.etaFf);assert.equal(f.routeTimingQuarantined,true)
  assert.deepEqual(f.euroscopeBaseline,old.euroscopeBaseline);assert.equal(s.automaticCorrections.length,1)
  assert.match(s.automaticCorrections[0].detail,/previous timing retained/)
 }
 assert.deepEqual(saved,start(c),'previous checkpoints are not mutated by quarantine')
})

test('normal timing rearms a later independent anomaly without repeating the same episode after reload',()=>{
 const c=config(),first=start(c),blocked=runEngine(packet(raw(2),2),c,{},first)
 const normal={...p,landingSeconds:1490,route:[{name:'ELTOK',seconds:590}]}
 const restored=runEngine(packet(normal,10),c,{},blocked)
 assert.equal(flight(restored).routeTimingQuarantined,false);assert.equal(restored.automaticCorrections.length,1)
 const again=runEngine(packet(raw(20),20),c,{},JSON.parse(JSON.stringify(restored)))
 assert.equal(again.automaticCorrections.length,2);assert.notEqual(again.automaticCorrections[0].id,again.automaticCorrections[1].id)
})

test('one retained notice stays deduplicated after history eviction, checkpoint reload and an episode route-signature change',()=>{
 const c=config(),s=start(c),blocked=runEngine(packet(raw(2),2),c,{},s),id=blocked.automaticCorrections[0].id
 assert.equal(flight(blocked).routeTimingGuard.episode.retainedNotified,true)
 for(let i=0;i<55;i++)appendAutomaticCorrection(blocked.automaticCorrections,{id:`other-${i}`,callsign:'OTHER',at:now+3000+i,kind:'route-timing',detail:'Other correction'})
 assert.equal(blocked.automaticCorrections.some(e=>e.id===id),false)
 const next=runEngine(packet(raw(8,{assignedHeading:100}),8),c,{},JSON.parse(JSON.stringify(blocked)))
 assert.equal(next.automaticCorrections.length,50);assert.equal(next.automaticCorrections.some(e=>e.id===id),false)
 assert.equal(flight(next).routeTimingGuard.episode.retainedNotified,true)
})

test('retaining a credible forecast blocks phase demotion without preventing normal forward phase progression',()=>{
 const c=config();let s=start(c)
 s=runEngine(packet(raw(2),2),c,{},s);assert.equal(flight(s).state,1)
 s=runEngine(packet(raw(480),480),c,{},s)
 assert.equal(flight(s).routeTimingQuarantined,true);assert.equal(flight(s).state,2)
 const far={...p,landingSeconds:2400,route:[{name:'ELTOK',seconds:1600}]}
 let distant=start(c,far);assert.equal(flight(distant).state,0)
 distant=runEngine(packet({...far,landingSeconds:3298,route:[{name:'ELTOK',seconds:2498}]},2),c,{},distant)
 distant=runEngine(packet({...far,landingSeconds:2300,route:[{name:'ELTOK',seconds:1500}]},1000),c,{},distant)
 assert.equal(flight(distant).routeTimingQuarantined,true);assert.equal(flight(distant).state,1)
})

test('Recompute while paused cannot seed guard confidence from the paused raw FLEG',()=>{
 const c=config(),s=start(c,profile),old=flight(s),edits={JUMP:{recomputeAt:now+2000,changedAt:now+2000}}
 const paused={...profile,groundspeed:20,landingSeconds:4000,route:profile.route.map(q=>({...q,seconds:q.seconds+1000}))}
 const next=runEngine(packet(paused,2),c,edits,s),f=flight(next)
 assert.equal(f.motionTiming.held,true);assert.equal(f.eta,old.eta);assert.equal(f.lastTrustedEta,old.lastTrustedEta)
 assert.deepEqual(f.routeTimingGuard.trusted,old.routeTimingGuard.trusted)
 assert.equal(next.automaticCorrections?.length??0,0)
})

test('Recompute with stale or unusable core telemetry cannot bless a new trusted pair',()=>{
 const c=config(),s=start(c),old=flight(s),edits={JUMP:{recomputeAt:now+2000,changedAt:now+2000}}
 for(const extra of [{positionAgeSeconds:16},{speedDataValid:false},{route:[]}]){
  const next=runEngine(packet(raw(2,extra),2),c,edits,s),f=flight(next)
  assert.deepEqual(f.routeTimingGuard.trusted,old.routeTimingGuard.trusted,JSON.stringify(extra))
  assert.equal(f.lastTrustedEta,old.lastTrustedEta);assert.equal(next.automaticCorrections?.length??0,0)
 }
})

test('a manually inserted placeholder does not seed trust that can block its later filed replacement',()=>{
 const c=config();c.manualFlights=[{callsign:'JUMP',aircraft:'A320',wake:'M',runway:'ESSA/19R',feeder:'ELTOK',eta:now+900000,feederEta:now+300000,departure:'EKCH'}]
 const manual=runEngine({...packet(p),flights:[]},c,{})
 assert.equal(flight(manual).routeTimingGuard,undefined)
 const real={...p,landingSeconds:2400,route:[{name:'ELTOK',seconds:800}]}
 const next=runEngine(packet(real,2),c,{},JSON.parse(JSON.stringify(manual))),f=flight(next)
 assert.equal(f.issue,'');assert.equal(f.routeTimingQuarantined,false);assert.equal(f.euroscopeBaseline.at,now+2000)
 assert.equal(f.routeTimingGuard.trusted.eta,f.liveBufferedEta);assert.equal(next.automaticCorrections?.length??0,0)
})

test('performance-mode route fallback quarantines the same coherent pair without changing following runway/feeder spacing',()=>{
 const c={...config(),timingModel:'performance',predictionMode:'euroscope'},follower={...p,callsign:'NEXT',landingSeconds:1620,route:[{name:'ELTOK',seconds:720}]}
 const input={...packet(p),flights:[p,follower]},first=runEngine(input,c,{}),old=flight(first),oldNext=first.flights.find(f=>f.callsign==='NEXT')
 const result=runEngine({...packet(raw(2),2),flights:[raw(2),{...follower,landingSeconds:1618,route:[{name:'ELTOK',seconds:718}]}]},c,{},first)
 const lead=flight(result),next=result.flights.find(f=>f.callsign==='NEXT')
 assert.equal(lead.routeTimingQuarantined,true);assert.equal(lead.issue,'');assert.equal(lead.state,old.state)
 assert.equal(lead.eta,old.eta);assert.equal(lead.etaFf,old.etaFf);assert.equal(lead.sta,old.sta);assert.equal(lead.staFf,old.staFf)
 assert.equal(next.sta,oldNext.sta);assert.equal(next.staFf,oldNext.staFf)
 assert.ok(next.sta-lead.sta>=c.rates['ESSA/19R']*1000-1)
})

test('fresh independent geometry confirms a longer route after fifteen seconds without automatically recomputing its accepted slot',()=>{
 const c=config();let s=start(c,profile);const old=structuredClone(flight(s))
 assert.equal(old.state,1);assert.equal(old.landingPrediction.method,'aircraft-profile')
 for(const elapsed of [2,10,20])s=runEngine(packet(extended(elapsed),elapsed),c,{},JSON.parse(JSON.stringify(s)))
 const f=flight(s)
 assert.equal(f.issue,'');assert.equal(f.routeTimingQuarantined,false);assert.ok(f.eta>old.eta+600000)
 assert.equal(f.state,old.state);assert.equal(f.order,old.order);assert.equal(f.sta,old.sta)
 assert.deepEqual(f.euroscopeBaseline,old.euroscopeBaseline)
 assert.equal(s.automaticCorrections.filter(e=>e.id.endsWith(':confirmed')).length,1)
 const again=runEngine(packet(extended(22),22),c,{},s)
 assert.equal(again.automaticCorrections.length,s.automaticCorrections.length)
})

test('a restored consumed STAR cannot establish a longer clearance even when its raw geometry persists',()=>{
 const c=config();let s=start(c,profile);const old=flight(s)
 old.amanRoutePassed=1;old.landingPrediction.directClearance={runway:'ESSA/19R',point:'FI19R',at:now}
 const slot=old.sta
 for(const elapsed of [2,10,20,30])s=runEngine(packet(extended(elapsed),elapsed),c,{},JSON.parse(JSON.stringify(s)))
 assert.equal(flight(s).routeTimingQuarantined,true);assert.equal(flight(s).sta,slot)
 assert.equal(s.automaticCorrections.length,1);assert.equal(flight(s).issue,'')
})

test('manual slots, feeder HOLD, pauses and stale radar data do not establish a new automatic route estimate',()=>{
 const c=config(),edits={JUMP:{target:now+1800000,targetKind:'time',order:0,orderExplicit:true}}
 let s=start(c,p,edits);const old=flight(s)
 for(const elapsed of [2,10,20])s=runEngine(packet(raw(elapsed,{topskyHoldingPoint:'ELTOK'}),elapsed),c,edits,JSON.parse(JSON.stringify(s)))
 assert.equal(flight(s).sta,old.sta);assert.equal(flight(s).state,old.state);assert.equal(flight(s).recomputedAt,old.recomputedAt)
 let stale=start(c,profile)
 stale=runEngine(packet({...extended(2),positionAgeSeconds:16},2),c,{},stale)
 assert.equal(flight(stale).lost,true);assert.equal(stale.automaticCorrections?.some(e=>e.id.endsWith(':confirmed'))??false,false)
})

test('a confirmed runway reassignment with a large new estimate does not trigger the old latching error',()=>{
 const c=config(),s=start(c),next=runEngine(packet(raw(2,{runway:'19L',landingSeconds:2700}),2),c,{},s),f=flight(next)
 assert.equal(f.runway,'19L');assert.equal(f.issue,'');assert.equal(f.state,flight(s).state)
 assert.equal(f.euroscopeBaseline.at,now+2000);assert.equal(next.automaticCorrections.length,1)
 assert.match(next.automaticCorrections[0].detail,/confirmed approach/)
})

test('a confirmed initial profile handover can repair a forecast by more than ten minutes without becoming Unstable',()=>{
 const c=config(),s=start(c,extended(0)),old=flight(s),expected=old.eta
 assert.equal(old.state,1)
 old.euroscopeBaseline={...old.euroscopeBaseline,eta:expected-900000};old.sta=expected-900000
 old.lastTrustedEta=old.sta;old.liveBufferedEta=old.sta;old.routeTimingGuard={trusted:{eta:old.sta,etaFf:old.etaFf}}
 old.initialProfile={pending:true,capture:now-30000,workSeconds:0,reason:'climb',candidateSince:now-20000,candidateEta:expected}
 const f=flight(runEngine(packet(extended(2),2),c,{},s))
 assert.equal(f.issue,'');assert.equal(f.state,1);assert.equal(f.initialProfile.appliedAt,now+2000)
 assert.ok(f.euroscopeBaseline.eta>old.euroscopeBaseline.eta+600000)
})

test('a legacy latched warning is cleared from a credible retained forecast and reported once',()=>{
 const c=config(),s=start(c),old=flight(s),slot=old.sta
 old.issue=legacyIssue;old.state=0;delete old.routeTimingGuard
 const repaired=runEngine(packet(raw(2),2),c,{},s),f=flight(repaired)
 assert.equal(f.issue,'');assert.equal(f.state,1);assert.equal(f.sta,slot);assert.equal(repaired.automaticCorrections.length,1)
 assert.ok(Number.isFinite(f.eta));assert.equal(f.eta,old.lastTrustedEta)
 const repeated=runEngine(packet(raw(4),4),c,{},JSON.parse(JSON.stringify(repaired)))
 assert.equal(repeated.automaticCorrections.length,1)
})

test('a corrupted legacy checkpoint needs independent moving geometry; raw repetition is not a repair',()=>{
 const c=config();let s=start(c,profile),old=flight(s)
 old.issue=legacyIssue;old.state=0;old.lastTrustedEta=NaN;delete old.routeTimingGuard
 old.liveBufferedEtaFf=old.etaFf=NaN
 for(const elapsed of [2,10,20]){
  s=runEngine(packet(raw(elapsed),elapsed),c,{},JSON.parse(JSON.stringify(s)))
  assert.equal(flight(s).issue,legacyIssue);assert.equal(s.automaticCorrections?.length??0,0)
 }
 for(const elapsed of [22,30,40])s=runEngine(packet(extended(elapsed),elapsed),c,{},s)
 assert.equal(flight(s).issue,'');assert.ok(Number.isFinite(flight(s).eta));assert.ok(s.automaticCorrections.some(e=>e.id.endsWith(':confirmed')))
})

test('quarantine does not replace an expired retained slot with invented raw timing, and correction history stays bounded',()=>{
 const c=config(),s=start(c),blocked=runEngine(packet(raw(2),2),c,{},s)
 const late=runEngine(packet(raw(2000),2000),c,{},JSON.parse(JSON.stringify(blocked)))
 assert.equal(flight(late).sta,flight(s).sta);assert.ok(flight(late).state>=flight(s).state)
 assert.equal(flight(late).delay,flight(s).delay);assert.equal(late.automaticCorrections.length,1)
 const events=[]
 for(let i=0;i<70;i++)appendAutomaticCorrection(events,{id:String(i),at:now+i,callsign:'JUMP',kind:'route-timing',detail:'Corrected'})
 appendAutomaticCorrection(events,events.at(-1));assert.equal(events.length,50);assert.equal(events[0].id,'20')
})
