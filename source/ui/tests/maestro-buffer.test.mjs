import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DEFAULT_CONFIG,validateConfig,runEngine,euroscopeBufferMinutes,euroscopeFeederBufferMinutes,euroscopeInstruction,toJuhaSequence} from '../src/maestro-engine.ts'
import {sharedSettings,mergeSharedSettings} from '../src/maestro-settings.ts'
import {informationRoute} from '../src/maestro-operations.ts'
import directFixture from './fixtures/skipped-feeder-direct.json' with {type:'json'}
import advanceFixture from './fixtures/entered-manual-advance.json' with {type:'json'}
import speedFixture from './fixtures/high-speed-recompute.json' with {type:'json'}
import cutoffFixture from './fixtures/recording-7-feeder-cutoff.json' with {type:'json'}
const now=Date.UTC(2026,9,12,12)
const config=()=>({...structuredClone(DEFAULT_CONFIG),unstableSeconds:0,minimumNewSeconds:600})
const flight=(extra={})=>({callsign:'BUFFER',aircraft:'A320',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'19R',route:[{name:'ELTOK',seconds:900}],landingSeconds:1500,distanceNm:100,groundspeed:300,altitude:25000,positionAgeSeconds:1,...extra})
const packet=(p,t=now)=>({source:'LIVE',timestamp:t,flights:p})
test('buffer defaults to two minutes and is a shared supervisory setting with validated bounds',()=>{
 assert.equal(DEFAULT_CONFIG.timingModel,'euroscope-buffer');assert.equal(DEFAULT_CONFIG.euroscopeBufferMinutes,2)
 for(const n of [0,0.5,2,15])assert.equal(mergeSharedSettings(config(),{euroscopeBufferMinutes:n}).euroscopeBufferMinutes,n)
 for(const n of [-1,16,NaN,Infinity])assert.throws(()=>validateConfig({...config(),euroscopeBufferMinutes:n}))
 assert.equal(sharedSettings(config()).euroscopeBufferMinutes,2)
})
test('initial usable EuroScope arrival plus buffer sets a baseline without any performance/vector prediction',()=>{
 const s=runEngine(packet([flight()]),config(),{}),f=s.flights[0]
 assert.equal(f.eta,now+1620000);assert.equal(f.sta,f.eta);assert.equal(f.euroscopeBaseline.rawEta,now+1500000)
 assert.equal(f.euroscopeBaseline.bufferMinutes,2);assert.equal(f.trajectory,undefined);assert.equal(f.distanceProfile,undefined);assert.equal(f.gainCapacitySeconds,0)
})
test('direct, speed and route ETA changes do not recalculate accepted landing or feeder times',()=>{
 const c=config(),first=runEngine(packet([flight()]),c,{})
 const next=runEngine(packet([flight({direct:'OTHER',assignedSpeed:210,assignedHeading:100,groundspeed:220,landingSeconds:600,route:[{name:'ELTOK',seconds:300}]})],now+2000),c,{},first)
 const a=first.flights[0],b=next.flights[0]
 assert.equal(b.eta,a.eta);assert.equal(b.sta,a.sta);assert.equal(b.staFf,a.staFf)
 assert.equal(b.euroscopeBaseline.at,a.euroscopeBaseline.at);assert.equal(b.liveEuroscopeEta,now+602000);assert.equal(b.liveBufferedEta,now+722000)
})
test('Unstable allocations also retain their captured time until explicit Recompute',()=>{
 const c={...config(),unstableSeconds:60},first=runEngine(packet([flight()]),c,{})
 const next=runEngine(packet([flight({landingSeconds:1000,route:[{name:'ELTOK',seconds:800}]})],now+2000),c,{},first)
 assert.equal(next.flights[0].state,0);assert.equal(next.flights[0].sta,first.flights[0].sta);assert.equal(next.flights[0].staFf,first.flights[0].staFf)
})
test('saving a buffer does not move existing flights; Recompute captures the new EuroScope ETA and buffer',()=>{
 const c=config(),first=runEngine(packet([flight()]),c,{})
 const changed={...c,euroscopeBufferMinutes:4},input=packet([flight({landingSeconds:600,route:[{name:'ELTOK',seconds:300}]})],now+2000)
 const held=runEngine(input,changed,{},first);assert.equal(held.flights[0].sta,first.flights[0].sta)
 const recomputed=runEngine({...input,timestamp:now+3000},changed,{BUFFER:{recomputeAt:now+3000,changedAt:now+3000}},held)
 assert.equal(recomputed.flights[0].eta,now+843000);assert.equal(recomputed.flights[0].sta,now+843000);assert.equal(recomputed.flights[0].euroscopeBaseline.bufferMinutes,4)
})
test('waiting on the ground does not capture a slow initial estimate or poison the first airborne baseline',()=>{
 const c=config(),ground=runEngine(packet([flight({altitude:100,groundspeed:20,landingSeconds:10000})]),c,{})
 assert.equal(ground.flights[0].euroscopeBaseline,undefined);assert.match(ground.flights[0].issue,/Awaiting usable/)
 const air=runEngine(packet([flight()],now+2000),c,{},ground),f=air.flights[0]
 assert.equal(f.euroscopeBaseline.at,now+2000);assert.equal(f.initialEta,now+1622000);assert.equal(f.issue,'')
})
test('a valid near-term baseline is not inflated by the old new-arrival ten-minute floor',()=>{
 const c=config(),s=runEngine(packet([flight({landingSeconds:180,route:[{name:'ELTOK',seconds:60}]})]),c,{})
 assert.equal(s.flights[0].sta,now+240000)
})
test('buffer mode retains runway rate spacing for two arrivals',()=>{
 const c=config();c.rates['ESSA/19R']=120
 const s=runEngine(packet([flight(),flight({callsign:'FOLLOWER',landingSeconds:1510})]),c,{})
 const [a,b]=[...s.flights].sort((a,b)=>a.order-b.order)
 assert.ok(b.sta-a.sta>=120000);assert.equal(a.eta,now+1620000);assert.equal(b.eta,now+1630000)
})
test('old performance history adopts the new captured baseline rather than preserving the old model slot',()=>{
 const legacy={...config(),timingModel:'performance',predictionMode:'euroscope'},old=runEngine(packet([flight()]),legacy,{})
 const next=runEngine(packet([flight()],now+2000),config(),{},old),f=next.flights[0]
 assert.equal(f.euroscopeBaseline.at,now+2000);assert.equal(f.eta,now+1622000);assert.equal(f.sta,f.eta)
 assert.equal(f.state,0,'migration evaluates the phase against the buffered feeder time, which is 17 minutes away')
})
test('new Superstable arrivals use a one-minute buffer',()=>{
 const c=config(),s=runEngine(packet([flight({landingSeconds:600,route:[{name:'ELTOK',seconds:180}]})]),c,{}),f=s.flights[0]
 assert.equal(f.state,2);assert.equal(f.euroscopeBaseline.bufferMinutes,1);assert.equal(f.eta,now+660000)
})
test('Recompute updates a Superstable leader time without moving it behind its Stable follower',()=>{
 const c=config(),input=packet([
  flight({callsign:'LEADER',route:[{name:'ELTOK',seconds:180}],landingSeconds:840}),
  flight({callsign:'FOLLOWER',route:[{name:'ELTOK',seconds:780}],landingSeconds:1500})
 ])
 const first=runEngine(input,c,{}),leader=first.flights.find(f=>f.callsign==='LEADER'),follower=first.flights.find(f=>f.callsign==='FOLLOWER')
 assert.equal(leader.state,2);assert.equal(follower.state,1);assert.equal(leader.order,0);assert.equal(follower.order,1)
 const t=now+2000,latest=packet([
  flight({callsign:'LEADER',route:[{name:'ELTOK',seconds:180}],landingSeconds:1100}),
  flight({callsign:'FOLLOWER',route:[{name:'ELTOK',seconds:778}],landingSeconds:1498})
 ],t)
 const next=runEngine(latest,c,{LEADER:{recomputeAt:t,changedAt:t,mode:'sequenced'}},first),a=next.flights.find(f=>f.callsign==='LEADER'),b=next.flights.find(f=>f.callsign==='FOLLOWER')
 assert.equal(a.order,0);assert.equal(b.order,1)
 assert.equal(a.sta,a.eta);assert.equal(a.staFf,a.etaFf)
 assert.equal(a.euroscopeBaseline.at,t);assert.equal(a.euroscopeBaseline.bufferMinutes,1)
})
test('entering Superstable does not shorten an accepted normal-buffer landing slot',()=>{
 const c=config(),first=runEngine(packet([flight()]),c,{})
 const next=runEngine(packet([flight({landingSeconds:700,route:[{name:'ELTOK',seconds:180}]})],now+2000),c,{},first),f=next.flights[0]
 assert.equal(f.state,2);assert.equal(f.sta,first.flights[0].sta);assert.equal(f.euroscopeBaseline.bufferMinutes,2)
 assert.equal(f.liveBufferedEta,now+762000)
})
test('Recompute of a Superstable aircraft captures the shorter buffer and latest ETA',()=>{
 const c=config(),first=runEngine(packet([flight()]),c,{})
 const input=packet([flight({landingSeconds:700,route:[{name:'ELTOK',seconds:180}]})],now+2000),ss=runEngine(input,c,{},first)
 const recomputed=runEngine({...input,timestamp:now+3000},c,{BUFFER:{recomputeAt:now+3000,changedAt:now+3000}},ss),f=recomputed.flights[0]
 assert.equal(f.euroscopeBaseline.bufferMinutes,1);assert.equal(f.eta,now+763000);assert.equal(f.sta,f.eta)
})
test('near-landing buffer is configurable, shared and never exceeds the normal buffer',()=>{
 for(const n of [0,0.5,1,15])assert.equal(mergeSharedSettings(config(),{euroscopeSuperstableBufferMinutes:n}).euroscopeSuperstableBufferMinutes,n)
 for(const n of [-1,16,NaN,Infinity])assert.throws(()=>validateConfig({...config(),euroscopeSuperstableBufferMinutes:n}))
 const c={...config(),euroscopeBufferMinutes:0,euroscopeSuperstableBufferMinutes:1},s=runEngine(packet([flight({route:[{name:'ELTOK',seconds:100}]})]),c,{})
 assert.equal(s.flights[0].euroscopeBaseline.bufferMinutes,0)
})
test('arrival rate limits are 6–60 per hour for current rates, planned configurations and planned rate changes',()=>{
 for(const seconds of [60,600]){
  const c=config();c.rates['ESSA/19R']=seconds;assert.equal(validateConfig(c).rates['ESSA/19R'],seconds)
  assert.equal(validateConfig({...config(),pendingRate:{at:now+60000,seconds}}).pendingRate.seconds,seconds)
  const next={...config().rates,'ESSA/19R':seconds};assert.equal(validateConfig({...config(),pending:{at:now+60000,active:['ESSA/19R'],rates:next,applyRate:true}}).pending.rates['ESSA/19R'],seconds)
 }
 for(const seconds of [1,30,59,601]){
  const c=config();c.rates['ESSA/19R']=seconds;assert.throws(()=>validateConfig(c))
  assert.throws(()=>validateConfig({...config(),pendingRate:{at:now+60000,seconds}}))
  assert.throws(()=>validateConfig({...config(),pending:{at:now+60000,active:['ESSA/19R'],rates:{...config().rates,'ESSA/19R':seconds},applyRate:true}}))
 }
})
test('the same buffer shifts feeder and runway once, without creating an initial lose instruction',()=>{
 const f=runEngine(packet([flight()]),config(),{}).flights[0]
 assert.equal(f.etaFf,now+1020000);assert.equal(f.staFf,f.etaFf)
 assert.equal(f.eta,now+1620000);assert.equal(f.eta-f.etaFf,600000)
 assert.equal(f.delay,0);assert.equal(f.euroscopeBaseline.rawEtaFf,now+900000)
})
test('a direct beyond NILUG and negative EuroScope feeder EET cannot make distant cruise traffic entered or Superstable',()=>{
 const c=config();c.active=['ESSA/01R'];c.departureRunway='ESSA/01L'
 const a=directFixture[0],b=directFixture[1]
 const first=runEngine(packet([a.flight],a.timestamp),c,{})
 const next=runEngine(packet([b.flight],b.timestamp),c,{},first),f=next.flights[0]
 assert.equal(f.passedFeeder,false);assert.ok(f.state<2)
 assert.ok(f.etaFf-b.timestamp>240000);assert.equal(f.sta,first.flights[0].sta)
})
test('Information route ignores rerouting and Recompute; only observed passage removes route points',()=>{
 const c=config();c.active=['ESSA/01R'];c.departureRunway='ESSA/01L'
 const a=directFixture[0],p=a.flight,first=runEngine(packet([p],a.timestamp),c,{}),f=first.flights[0],original=f.amanRoute.map(p=>p.name)
 const feeder=f.amanRoute[0],nextPoint=f.amanRoute[1],newPoint={name:'INWIQ',seconds:1000,latitude:58.5,longitude:18}
 const rerouted={...p,route:[feeder,newPoint,...f.amanRoute.slice(1)],calculatedRouteIndex:99,direct:'INWIQ'}
 const changed=runEngine(packet([rerouted],a.timestamp+2000),c,{TEST_DIRECT:{recomputeAt:a.timestamp+2000,changedAt:a.timestamp+2000}},first)
 assert.deepEqual(changed.flights[0].amanRoute.map(p=>p.name),original)
 assert.ok(!informationRoute(changed.flights[0],a.timestamp+2000).some(p=>p.name==='INWIQ'))
 const crossed=runEngine(packet([{...rerouted,latitude:feeder.latitude,longitude:feeder.longitude}],a.timestamp+4000),c,{},changed)
 assert.ok(crossed.flights[0].passedFeeder);assert.ok(!informationRoute(crossed.flights[0],a.timestamp+4000).some(p=>p.name===feeder.name))
 const star=runEngine(packet([{...rerouted,latitude:nextPoint.latitude,longitude:nextPoint.longitude}],a.timestamp+6000),c,{},crossed)
 assert.ok(star.flights[0].amanRoutePassed>=2)
})
test('advancing an entered aircraft updates its lose instruction instead of retaining the old six-minute delay',()=>{
 const {input,config:c,edits,previous}=advanceFixture
 const next=runEngine(input,c,edits,previous),old=previous.flights.find(f=>f.callsign==='TEST_ADVANCED'),f=next.flights.find(f=>f.callsign==='TEST_ADVANCED')
 assert.equal(old.delay,390);assert.ok(f.sta<old.sta)
 assert.equal(f.delay,Math.round((f.sta-f.liveBufferedEta)/1000));assert.ok(f.delay<180)
 const repeated=runEngine({...input,timestamp:input.timestamp+2000},c,edits,next)
 const later=repeated.flights.find(p=>p.callsign==='TEST_ADVANCED')
 assert.equal(later.sta,f.sta)
 assert.equal(later.delay,f.delay,'accepted Superstable instruction stays fixed on ordinary updates')
})


test('speed buffer defaults, settings migration and bounds are shared and validated',()=>{
 assert.equal(DEFAULT_CONFIG.euroscopeHighSpeedBufferMinutes,6)
 const legacy=config();delete legacy.euroscopeHighSpeedBufferMinutes
 assert.equal(validateConfig(legacy).euroscopeHighSpeedBufferMinutes,6)
 for(const n of [0,4,6,15])assert.equal(mergeSharedSettings(config(),{euroscopeHighSpeedBufferMinutes:n}).euroscopeHighSpeedBufferMinutes,n)
 for(const n of [-1,16,NaN,Infinity])assert.throws(()=>validateConfig({...config(),euroscopeHighSpeedBufferMinutes:n}))
 assert.equal(sharedSettings(config()).euroscopeHighSpeedBufferMinutes,6)
})

test('fast-flight buffer grows from 300 kt, interpolates through 450 kt and is capped',()=>{
 const c=config()
 for(const [groundspeed,seconds] of [[250,120],[300,120],[375,240],[450,360],[500,440],[1000,900]]){
  assert.equal(Math.round(euroscopeBufferMinutes(flight({groundspeed}),c)*60),seconds)
 }
 assert.equal(euroscopeBufferMinutes(flight({groundspeed:500}),{...c,euroscopeHighSpeedBufferMinutes:2}),2)
 assert.equal(euroscopeBufferMinutes(flight({groundspeed:500}),{...c,euroscopeHighSpeedBufferMinutes:1}),2)
 assert.equal(euroscopeBufferMinutes(flight({groundspeed:500}),{...c,euroscopeBufferMinutes:15}),15)
})

test('slower Superstable/Frozen capture keeps one minute, while fast near-feeder traffic gets the speed addition',()=>{
 const c=config(),near=flight({groundspeed:250,route:[{name:'ELTOK',seconds:100}]})
 assert.equal(euroscopeBufferMinutes(near,c),1)
 assert.equal(euroscopeBufferMinutes({...near,groundspeed:450},c),5);assert.equal(euroscopeFeederBufferMinutes({...near,groundspeed:450},c),1)
 assert.equal(euroscopeBufferMinutes(flight({groundspeed:250,landingSeconds:180}),c),1)
})

test('speed selection is captured once for landing while feeder keeps its base buffer until Recompute',()=>{
 const c=config(),first=runEngine(packet([flight({groundspeed:450})]),c,{}),a=first.flights[0]
 assert.equal(a.euroscopeBaseline.groundspeed,450);assert.equal(a.euroscopeBaseline.bufferMinutes,6)
 assert.equal(a.eta,now+1860000);assert.equal(a.etaFf,now+1020000);assert.equal(a.delay,0);assert.equal(a.euroscopeBaseline.feederBufferMinutes,2)
 const input=packet([flight({groundspeed:250,landingSeconds:1000,direct:'OTHER'})],now+2000)
 const next=runEngine(input,c,{},first),b=next.flights[0]
 assert.equal(b.sta,a.sta);assert.equal(b.staFf,a.staFf);assert.deepEqual(b.euroscopeBaseline,a.euroscopeBaseline)
 assert.equal(b.liveBufferedEta,input.timestamp+1360000)
 const refreshed=runEngine({...input,timestamp:now+3000},c,{BUFFER:{recomputeAt:now+3000,changedAt:now+3000}},next).flights[0]
 assert.equal(refreshed.euroscopeBaseline.groundspeed,250);assert.equal(refreshed.euroscopeBaseline.bufferMinutes,2)
 assert.equal(refreshed.eta,now+1123000)
})

test('recorded SAS1AB at 499 kt gains the selected buffer on Recompute without changing the entered order',()=>{
 const {input,config:c,edits,previous}=speedFixture
 const next=runEngine(input,c,edits,previous),sas=next.flights.find(f=>f.callsign==='SAS1AB'),ryr=next.flights.find(f=>f.callsign==='RYR5W')
 assert.equal(sas.euroscopeBaseline.groundspeed,499);assert.equal(Math.round(sas.euroscopeBaseline.bufferMinutes*60),438)
 assert.equal(new Date(sas.eta).toISOString().slice(11,19),'21:04:26');assert.equal(new Date(sas.euroscopeBaseline.etaFf).toISOString().slice(11,19),'20:51:08');assert.equal(sas.euroscopeBaseline.feederBufferMinutes,2)
 assert.ok(sas.order>ryr.order);assert.ok(sas.sta>ryr.sta)
 const hold=runEngine({...input,timestamp:input.timestamp+2000,flights:input.flights.map(f=>f.callsign==='SAS1AB'?{...f,groundspeed:250,landingSeconds:500}:f)},c,edits,next)
 assert.equal(hold.flights.find(f=>f.callsign==='SAS1AB').sta,sas.sta)
 assert.equal(hold.flights.find(f=>f.callsign==='SAS1AB').euroscopeBaseline.bufferMinutes,sas.euroscopeBaseline.bufferMinutes)
})

test('existing recorded high-speed baseline stays fixed until an explicit new Recompute',()=>{
 const {input,config:c,previous}=speedFixture
 const held=runEngine(input,c,{},previous),sas=held.flights.find(f=>f.callsign==='SAS1AB'),old=previous.flights.find(f=>f.callsign==='SAS1AB')
 assert.deepEqual(sas.euroscopeBaseline,old.euroscopeBaseline)
 assert.equal(sas.eta,old.eta)
})

test('recording 7 clears line 0 just beyond twelve miles after ELTOK and retains its information delay',()=>{
 const {input,afterInput,config:c,edits,previous}=cutoffFixture
 const before=runEngine(input,c,edits,previous),a=before.flights.find(f=>f.callsign==='SAS1AB')
 assert.equal(a.passedFeeder,true);assert.ok(a.feederDistanceNm<12);assert.equal(euroscopeInstruction(a),102)
 const after=runEngine(afterInput,c,edits,before),b=after.flights.find(f=>f.callsign==='SAS1AB')
 assert.ok(b.feederDistanceNm>=12);assert.equal(b.line0Suppressed,true);assert.equal(euroscopeInstruction(b),0);assert.equal(b.delay,102)
 assert.equal(toJuhaSequence(after,c,edits).sequence.find(f=>f.callsign==='SAS1AB').ttlttg_ff,0)
})
