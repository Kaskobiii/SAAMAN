import {test} from 'node:test'
import assert from 'node:assert/strict'
import {runEngine,DEFAULT_CONFIG,wakeInterval,effectiveConfig} from '../src/maestro-engine.ts'
const now=Date.UTC(2026,9,25,19,19,33)
const c=()=>({...structuredClone(DEFAULT_CONFIG),unstableSeconds:0,minimumNewSeconds:0,active:['ESSA/19L'],departureRunway:'ESSA/19R',rates:{...DEFAULT_CONFIG.rates,'ESSA/19L':115}})
const base={aircraft:'A320',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'19L',groundspeed:300,altitude:25000,positionAgeSeconds:0,distanceNm:100}
const lead={...base,callsign:'LEAD',route:[{name:'ELTOK',seconds:60}],landingSeconds:300}
const follow={...base,callsign:'FOLLOW',route:[{name:'NILUG',seconds:600}],landingSeconds:2400}
const packet=(flights,seconds=0)=>({source:'LIVE',timestamp:now+seconds*1000,flights:structuredClone(flights)})
const f=(s,name='FOLLOW')=>s.flights.find(p=>p.callsign===name)
const at=(p,seconds)=>({...p,landingSeconds:p.landingSeconds-seconds,route:p.route.map(q=>({...q,seconds:q.seconds-seconds}))})
const better=(seconds=2,extra={})=>({...follow,landingSeconds:1920-seconds,route:[{name:'NILUG',seconds:480-seconds}],...extra})
const initial=(config=c(),flights=[lead,follow],edits={})=>runEngine(packet(flights),config,edits)
const spacing=(s,config)=>{const rows=s.flights.filter(p=>p.mode==='sequenced'&&!p.issue&&!p.lost&&p.state!==4&&p.runway==='19L').sort((a,b)=>a.order-b.order);for(let i=1;i<rows.length;i++){const p=rows[i-1],q=rows[i],plan=effectiveConfig(config,q.sta);assert.ok(q.sta-p.sta>=Math.max(plan.rates['ESSA/19L'],wakeInterval(p.wake,q.wake,'ESSA/19L',plan))*1000-1)}}

test('a Stable follower releases eight artificial minutes into available runway space without recapturing history',()=>{
 const config=c(),start=initial(config),old=structuredClone(f(start));let s=start
 assert.equal(f(start,'LEAD').state,2);assert.equal(old.state,1)
 for(const seconds of [2,4,20,60]){
  s=runEngine(packet([at(lead,seconds),better(seconds)],seconds),config,{},JSON.parse(JSON.stringify(s)));const row=f(s)
  assert.equal(row.sta,now+2040000);assert.equal(row.staFf,now+600000);assert.equal(row.delay,0)
  assert.equal(row.state,1);assert.equal(row.order,old.order);assert.deepEqual(row.euroscopeBaseline,old.euroscopeBaseline)
  assert.deepEqual([row.initialEta,row.initialEtaFf,row.initialSta,row.initialStaFf],[old.initialEta,old.initialEtaFf,old.initialSta,old.initialStaFf]);spacing(s,config)
 }
})

test('matched EUROCONTROL performance releases an unconstrained Stable follower on a shorter credible pair',()=>{
 const config=c(),p={...follow,aircraft:'A20N',latitude:61,longitude:18,altitude:30000,groundspeed:300,verticalSpeed:0,route:[{name:'ELTOK',seconds:500,latitude:60.4,longitude:18},{name:'FI19L',seconds:900,latitude:59.8,longitude:17.95},{name:'SA19L',seconds:1000,latitude:59.6664,longitude:17.92377}],landingSeconds:1060}
 let s=initial(config,[lead,p]);const old=structuredClone(f(s))
 for(const seconds of [2,4,10,20]){
  s=runEngine(packet([at(lead,seconds),{...p,groundspeed:440,latitude:61-seconds*.002}],seconds),config,{},JSON.parse(JSON.stringify(s)));const row=f(s)
  assert.equal(row.landingPrediction.method,'aircraft-profile');assert.equal(row.state,1)
  assert.ok(row.sta<old.sta-180000);assert.ok(Math.abs(row.sta-row.liveBufferedEta)<1000);assert.ok(Math.abs(row.staFf-row.etaFf)<1000);assert.ok(Math.abs(row.delay)<=1)
  assert.deepEqual(row.euroscopeBaseline,old.euroscopeBaseline);spacing(s,config)
 }
})

test('a Stable released leader brings constrained Stable successors forward while retaining real delivery spacing',()=>{
 const config=c(),leader={...lead,landingSeconds:1800},next={...follow,callsign:'NEXT',landingSeconds:2520,route:[{name:'NILUG',seconds:700}]},last={...follow,callsign:'LAST',landingSeconds:2700,route:[{name:'NILUG',seconds:720}]}
 const start=initial(config,[leader,follow,next,last]),old=start.flights.map(p=>[p.callsign,p.order,p.euroscopeBaseline]);let s=start
 for(const seconds of [2,4,20]){
  const newer={...next,landingSeconds:1980-seconds,route:[{name:'NILUG',seconds:600-seconds}]},later={...last,landingSeconds:2000-seconds,route:[{name:'NILUG',seconds:720-seconds}]}
  s=runEngine(packet([at(leader,seconds),better(seconds),newer,later],seconds),config,{},JSON.parse(JSON.stringify(s)))
  assert.equal(f(s).sta,now+2040000);assert.equal(f(s,'NEXT').sta,now+2155000);assert.equal(f(s,'LAST').sta,now+2270000)
  assert.equal(f(s).delay,0);assert.equal(f(s,'NEXT').delay,55);assert.equal(f(s,'LAST').delay,150)
  assert.deepEqual(s.flights.map(p=>[p.callsign,p.order,p.euroscopeBaseline]),old);spacing(s,config)
 }
})

test('mixed Stable and Unstable traffic releases old capacity without changing sequence order',()=>{
 const config=c(),far={...follow,callsign:'FAR',landingSeconds:3300,route:[{name:'VACRA',seconds:1200}]},start=initial(config,[lead,follow,far])
 const next=runEngine(packet([at(lead,2),better(),{...far,landingSeconds:2698,route:[{name:'VACRA',seconds:1078}]}],2),config,{},start)
 assert.equal(f(next,'FOLLOW').delay,0);assert.equal(f(next,'FAR').state,0);assert.equal(f(next,'FAR').sta,now+2820000);assert.equal(f(next,'FAR').delay,0)
 assert.deepEqual(next.flights.map(p=>[p.callsign,p.order]),start.flights.map(p=>[p.callsign,p.order]));spacing(next,config)
})

test('a genuinely busy runway retains only the required rate or heavier wake constraint',()=>{
 for(const wake of ['M','H']){
  const config=c(),leader={...lead,wake,landingSeconds:1920},start=initial(config,[leader,follow])
  const next=runEngine(packet([at(leader,2),better()],2),config,{},start),row=f(next),leaderRow=f(next,'LEAD')
  const seconds=Math.max(115,wakeInterval(wake,'M','ESSA/19L',config))
  assert.ok(Math.abs(row.sta-leaderRow.sta-seconds*1000)<1);assert.equal(row.delay,Math.round((row.sta-row.liveBufferedEta)/1000))
  assert.ok(row.delay>0&&row.delay<120);assert.ok(row.sta<f(start).sta-300000);spacing(next,config)
 }
})

test('a cross-runway manual feeder reservation retains its slot and only adds the entry interval actually needed',()=>{
 const config=c(),other={...follow,callsign:'OTHER',runway:'19R',landingSeconds:1920,route:[{name:'NILUG',seconds:480}]},edits={OTHER:{target:now+2040000,targetKind:'time',runway:'ESSA/19R'}}
 const start=initial(config,[lead,follow,other],edits),next=runEngine(packet([at(lead,2),better(),at(other,2)],2),config,edits,start)
 assert.equal(f(next,'OTHER').sta,edits.OTHER.target);assert.equal(f(next).sta,now+2155000);assert.equal(f(next).delay,115)
 assert.ok(Math.abs(f(next).staFf-f(next,'OTHER').staFf)>=115000-1);spacing(next,config)
})

test('manual targets, explicit order and personal intervals cannot be silently released',()=>{
 for(const edit of [{target:now+2700000,targetKind:'time'},{order:1,orderExplicit:true},{slotBefore:2},{slotAfter:2}]){
  const config=c(),edits={FOLLOW:edit},start=initial(config,[lead,follow],edits),next=runEngine(packet([at(lead,2),better()],2),config,edits,start)
  assert.equal(f(next).sta,f(start).sta,JSON.stringify(edit));assert.equal(f(next).staFf,f(start).staFf,JSON.stringify(edit));spacing(next,config)
 }
})

test('HOLD, pause, stale, bypassed feeder and route quarantine remain protected during Stable release',()=>{
 const config=c(),start=initial(config)
 const held=runEngine(packet([at(lead,2),better(2,{topskyHoldingPoint:'NILUG'})],2),config,{},start)
 assert.equal(f(held).sta,f(start).sta);assert.equal(f(held).staFf,f(start).staFf)
 const bypass=runEngine(packet([at(lead,2),better(2,{direct:'OTHER',route:[{name:'OTHER',seconds:200}]})],2),config,{},start)
 assert.equal(f(bypass).feederEtaAvailable,false);assert.equal(f(bypass).sta,f(start).sta)
 const stale=runEngine(packet([at(lead,2),better(2,{positionAgeSeconds:16})],2),config,{},start)
 assert.equal(f(stale).lost,true);assert.equal(f(stale).sta,f(start).sta)
 const bad=runEngine(packet([at(lead,2),better(2,{landingSeconds:4000,route:[{name:'NILUG',seconds:1800}]})],2),config,{},start)
 assert.equal(f(bad).routeTimingQuarantined,true);assert.equal(f(bad).sta,f(start).sta)
 const positioned={...follow,latitude:61,longitude:18,heading:190},moving=initial(config,[lead,positioned])
 const waiting=runEngine(packet([at(lead,10),at(positioned,10)],10),config,{},moving)
 const paused=runEngine(packet([at(lead,22),better(22,{latitude:61,longitude:18,heading:190})],22),config,{},waiting)
 assert.equal(f(paused).motionTiming.held,true);assert.equal(f(paused).sta,f(moving).sta)
})

test('gap and closure banks still prevent landing inside their blocked intervals',()=>{
 for(const kind of ['gap','closure']){
  const config=c();config.slots=[{id:'CLOSED',kind,runway:'ESSA/19L',begin:now+1980000,end:now+2640000}]
  const start=initial(config),next=runEngine(packet([at(lead,2),better()],2),config,{},start)
  assert.ok(f(next).sta>=config.slots[0].end);assert.ok(f(next).delay>0);spacing(next,config)
 }
})

test('an earlier slot uses its actual current rate rather than the faster planned rate of the held slot',()=>{
 const config=c();config.rates['ESSA/19L']=120;config.pendingRate={at:Date.UTC(2026,9,25,20),seconds:90}
 const leader={...lead,landingSeconds:(Date.UTC(2026,9,25,19,53,25)-now)/1000-60},oldLanding=(Date.UTC(2026,9,25,20,5)-now)/1000-120
 const follower={...follow,landingSeconds:oldLanding},start=initial(config,[leader,follower])
 const observed=(Date.UTC(2026,9,25,19,55)-now)/1000-120-2,next=runEngine(packet([at(leader,2),better(2,{landingSeconds:observed})],2),config,{},start)
 assert.equal(f(next).sta,Date.UTC(2026,9,25,19,55,25));assert.equal(f(next).separation.rateSeconds,120);spacing(next,config)
})

test('waiting for a faster planned rate selects its boundary without a before/after oscillation',()=>{
 const config=c();config.rates['ESSA/19L']=120;const boundary=Date.UTC(2026,9,25,20);config.pendingRate={at:boundary,seconds:90}
 const leader={...lead,landingSeconds:(Date.UTC(2026,9,25,19,58,15)-now)/1000-60},follower={...follow,landingSeconds:(Date.UTC(2026,9,25,20,5)-now)/1000-120}
 let s=initial(config,[leader,follower]);const original=structuredClone(f(s).euroscopeBaseline)
 for(const seconds of [2,4,20]){
  const observed=(Date.UTC(2026,9,25,19,59,40)-now)/1000-120-seconds
  s=runEngine(packet([at(leader,seconds),better(seconds,{landingSeconds:observed})],seconds),config,{},JSON.parse(JSON.stringify(s)))
  assert.equal(f(s).sta,boundary);assert.equal(f(s).separation.rateSeconds,90);assert.deepEqual(f(s).euroscopeBaseline,original);spacing(s,config)
 }
})

