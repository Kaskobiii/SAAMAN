import {test} from 'node:test'
import assert from 'node:assert/strict'
import {runEngine,controllerInstructionSeconds,wakeInterval,effectiveConfig} from '../src/maestro-engine.ts'
import cases from './fixtures/live-busy-allocation-continuity.json' with {type:'json'}
const scenario=(clip,frame)=>structuredClone(cases.find(c=>c.clip===clip&&c.frame===frame))
const get=(s,c)=>s.flights.find(f=>f.callsign===c)
const replay=c=>runEngine(c.input,c.config,c.edits,c.previous)
function intervals(s,config){
 const runways=new Map(),feeders=new Map()
 for(const f of s.flights.filter(f=>f.mode==='sequenced'&&!f.issue&&!f.lost&&f.state!==4&&f.landingEtaAvailable!==false)){
  const r=runways.get(f.runway)??[];r.push(f);runways.set(f.runway,r)
  if(!f.passedFeeder&&['NILUG','ELTOK','XILAN','VACRA'].includes(f.ff)){const a=feeders.get(f.ff)??[];a.push(f);feeders.set(f.ff,a)}
 }
 for(const [runway,queue] of runways){queue.sort((a,b)=>a.order-b.order);for(let i=1;i<queue.length;i++){
  const a=queue[i-1],b=queue[i],key=`${b.arrival}/${runway}`,c=effectiveConfig(config,b.sta)
  const gap=Math.max(c.rates[key],wakeInterval(a.wake,b.wake,key,c))*1000
  assert.ok(b.sta>=a.sta+gap-1,`${a.callsign}/${b.callsign} runway spacing`)
 }}
 for(const queue of feeders.values()){queue.sort((a,b)=>a.staFf-b.staFf);for(let i=1;i<queue.length;i++){
  const a=queue[i-1],b=queue[i],c=effectiveConfig(config,b.sta)
  assert.ok(b.staFf>=a.staFf+c.rates[`${b.arrival}/${b.runway}`]*1000-1,`${a.callsign}/${b.callsign} feeder spacing`)
 }}
}

test('busy live pause cannot confirm the obsolete capture as a new planning ETA',()=>{
 const c=scenario('b',1185),s=replay(c),f=get(s,'CFG7W'),old=get(c.previous,'CFG7W')
 assert.equal(f.motionTiming.held,true);assert.equal(f.planningEta,old.planningEta)
 assert.notEqual(f.planningEta,f.euroscopeBaseline.eta);assert.equal(f.planningEtaCandidate,undefined)
 assert.ok(controllerInstructionSeconds(f)<=controllerInstructionSeconds(old)+2,'credible pause does not manufacture the recorded extra nine minutes')
 assert.equal(f.liveBufferedEta,old.liveBufferedEta);intervals(s,c.config)
})

test('moving Stable flight cannot resurrect its startup capture or charge that obsolete time to followers',()=>{
 const c=scenario('d',382),s=replay(c),f=get(s,'SAS689'),old=get(c.previous,'SAS689')
 assert.equal(f.motionTiming.held,false);assert.equal(f.state,1);assert.equal(f.planningEta,old.planningEta)
 assert.equal(f.planningEtaCandidate,undefined);assert.ok(Math.abs(f.sta-old.sta)<1000)
 for(const call of ['SAS689','SERJA','SAS126'])assert.ok(controllerInstructionSeconds(get(s,call))<=controllerInstructionSeconds(get(c.previous,call))+2,call)
 intervals(s,c.config)
})

test('accepted later Unstable forecast loses its provisional place in the same calculation',()=>{
 const c=scenario('b',1207),s=replay(c),delayed=get(s,'DIBSL')
 assert.ok(delayed.planningEta-get(c.previous,'DIBSL').planningEta>60000,'the corrected current-route model still accepts a material later forecast')
 for(const call of ['DLH6PX','ASL1551']){
  const f=get(s,call);assert.ok(f.order<delayed.order,call)
  assert.ok(controllerInstructionSeconds(f)<=controllerInstructionSeconds(get(c.previous,call))+2,call)
 }
 intervals(s,c.config)
})

test('multiple Unstable arrivals inserted against the same accepted bank keep their sorted cohort order',()=>{
 const c=scenario('d',89),s=replay(c),a=get(s,'BAW770'),b=get(s,'NSZ4110'),d=get(s,'ICE306')
 assert.ok(a.eta<b.eta&&b.eta<d.eta,'the observed landing forecasts define this cohort')
 assert.ok(a.order<b.order&&b.order<d.order,'repeated insertion at the same stable boundary must not reverse the bank')
 // A new route-profile model can change the terminal transfer relative to
 // this old checkpoint. That is independent of the bank-reversal bug: its
 // runway slot must not acquire the old spurious extra 347 seconds.
 assert.ok(Math.abs(a.sta-get(c.previous,'BAW770').sta)<1000)
 assert.equal(controllerInstructionSeconds(a),Math.round((a.staFf-a.etaFf)/1000))
 intervals(s,c.config)
})

test('HOLD on a historical checkpoint preserves accepted delivery instead of adding calibration work',()=>{
 const c=scenario('c',749),held=replay(c),control=structuredClone(c)
 control.input.flights.find(f=>f.callsign==='SAS80A').topskyHoldingPoint=''
 const normal=replay(control),f=get(held,'SAS80A'),old=get(c.previous,'SAS80A')
 assert.equal(f.sta,old.sta);assert.equal(f.staFf,old.staFf)
 assert.ok(controllerInstructionSeconds(f)<=controllerInstructionSeconds(old)+1,'the recorded HOLD-only 2:21 jump must disappear')
 // The no-HOLD control may adopt the newly calibrated terminal transfer;
 // preserving the accepted HOLD release must not add work to that control.
 for(const call of ['SAS80A','DLH7EW','PVG1442','WZZ3JB','SWR5KP']){
  const a=get(held,call),b=get(normal,call)
  assert.ok(a.sta<=b.sta+1,call);assert.ok(a.staFf<=b.staFf+1,call)
  assert.ok(controllerInstructionSeconds(a)<=controllerInstructionSeconds(b)+1,call)
 }
 intervals(held,c.config);intervals(normal,c.config)
})

test('with current-profile history, changing only TopSky HOLD leaves the entire delivery queue unchanged',()=>{
 const c=scenario('c',749)
 c.input.flights.find(f=>f.callsign==='SAS80A').topskyHoldingPoint=''
 // First calculate an ordinary current-version poll. Subsequent polls now
 // share the same profile calibration, so HOLD is the only changed evidence.
 const previous=replay(c),input=structuredClone(c.input)
 input.timestamp+=2000
 for(const p of input.flights){
  p.positionAgeSeconds=(p.positionAgeSeconds??0)+2;p.landingSeconds-=2
  for(const q of p.route)q.seconds-=2
 }
 const normal=runEngine(input,c.config,c.edits,previous),marked=structuredClone(input)
 marked.flights.find(f=>f.callsign==='SAS80A').topskyHoldingPoint='ELTOK'
 const held=runEngine(marked,c.config,c.edits,previous)
 for(const call of ['SAS80A','DLH7EW','PVG1442','WZZ3JB','SWR5KP']){
  const a=get(held,call),b=get(normal,call)
  assert.equal(a.sta,b.sta,call);assert.equal(a.staFf,b.staFf,call)
  assert.equal(controllerInstructionSeconds(a),controllerInstructionSeconds(b),call)
 }
 intervals(held,c.config);intervals(normal,c.config)
})

test('group Recompute can move held slots for real changed queue constraints while all intervals remain feasible',()=>{
 const c=scenario('c',934),s=replay(c),lead=get(s,'DIBSL')
 assert.ok(lead.sta-get(c.previous,'DIBSL').sta>300000,'the real preceding approach anchor is refreshed')
 for(const call of ['FIN2328','OCN414']){
  const f=get(s,call);assert.equal(f.feederObservationSource,'holding');assert.equal(f.passedFeeder,false)
  assert.equal(controllerInstructionSeconds(f),Math.max(0,Math.round((f.staFf-f.etaFf)/1000)))
 }
 intervals(s,c.config)
})
