import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DEFAULT_CONFIG,runEngine,controllerInstructionSeconds,euroscopeInstruction,delayLabel,toTopSkySequence} from '../src/maestro-engine.ts'

const now=Date.UTC(2026,9,25,19,19,33)
const config=()=>({...structuredClone(DEFAULT_CONFIG),unstableSeconds:0,minimumNewSeconds:0,active:['ESSA/19L'],departureRunway:'ESSA/19R'})
const plane={callsign:'LONE',aircraft:'A320',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'19L',route:[{name:'ELTOK',seconds:120}],landingSeconds:900,distanceNm:60,groundspeed:300,altitude:20000,positionAgeSeconds:0}
const packet=(elapsed,p=plane)=>({source:'LIVE',timestamp:now+elapsed*1000,flights:[structuredClone(p)]})
const one=s=>s.flights.find(f=>f.callsign==='LONE')
function superstableSlot(){
 const c=config(),initial=runEngine(packet(0),c,{})
 const target=one(initial).sta+180000,edits={LONE:{target,targetKind:'time',changedAt:now+1000}}
 const first=runEngine(packet(1,{...plane,landingSeconds:899,route:[{name:'ELTOK',seconds:119}]}),c,edits,initial)
 assert.equal(one(first).state,2);assert.equal(one(first).delay,180)
 return {c,edits,first}
}
function bank(known=false){
 const c=config(),flights=Array.from({length:21},(_,i)=>({...plane,callsign:i===10?'UNKNOWN':'TEST'+String(i).padStart(2,'0'),altitude:30000,distanceNm:80,
  star:i===10&&known?'ELTOK1P':undefined,route:[{name:i===10?'TEB':['ELTOK','NILUG','XILAN','VACRA'][i%4],seconds:300+i*30}],landingSeconds:900+i*30}))
 return {c,flights,first:runEngine({source:'LIVE',timestamp:now,flights},c,{})}
}

test('an unknown first feeder cannot turn a runway backlog into an L14 instruction',()=>{
 const {c,first}=bank(),f=first.flights.find(f=>f.callsign==='UNKNOWN')
 assert.equal(f.ff,'-');assert.equal(f.feederEtaAvailable,false);assert.equal(f.feederGuidanceAvailable,false)
 assert.equal(f.delay,850);assert.equal(f.runwayDelay,850);assert.equal(f.planningDelaySeconds,850)
 assert.equal(controllerInstructionSeconds(f),0);assert.equal(euroscopeInstruction(f),0);assert.equal(f.line0Suppressed,true)
 assert.equal(f.guidance.instructionSeconds,0);assert.deepEqual(f.guidance.absorption,{mode:'none'})
 assert.ok(f.sta>f.eta);assert.equal((f.sta-f.eta)/1000,850)
 assert.ok(!toTopSkySequence(first,c,{}).sequence.some(row=>row.callsign==='UNKNOWN'))
})

test('unknown and new known-but-unavailable feeders do not bootstrap from their placeholder checkpoint',()=>{
 for(const known of [false,true]){
  const {c,flights,first}=bank(known);let s=first
  const initial=s.flights.find(f=>f.callsign==='UNKNOWN')
  assert.equal(initial.feederGuidanceAvailable,false);assert.equal(initial.feederEtaAvailable,false)
  assert.equal(initial.ff,known?'ELTOK':'-');assert.equal(initial.euroscopeBaseline.etaFf,initial.euroscopeBaseline.at)
  for(const elapsed of [2,4,8]){
   const input=flights.map(p=>({...p,landingSeconds:p.landingSeconds-elapsed,route:p.route.map(r=>({...r,seconds:r.seconds-elapsed}))}))
   s=runEngine({source:'LIVE',timestamp:now+elapsed*1000,flights:input},c,{},JSON.parse(JSON.stringify(s)))
   const f=s.flights.find(f=>f.callsign==='UNKNOWN')
   assert.equal(f.feederGuidanceAvailable,false);assert.equal(controllerInstructionSeconds(f),0);assert.equal(euroscopeInstruction(f),0)
   assert.equal(f.line0Suppressed,true);assert.equal(f.guidance.instructionSeconds,0)
  }
 }
})

test('legacy known placeholders are rejected while credible legacy unavailable instructions are retained',()=>{
 const unavailable=bank(true),placeholder=unavailable.first.flights.find(f=>f.callsign==='UNKNOWN')
 delete placeholder.feederGuidanceAvailable
 assert.equal(controllerInstructionSeconds(placeholder),0)
 const {c,edits,first}=superstableSlot(),old=one(first)
 delete old.feederGuidanceAvailable;old.feederEtaAvailable=false;old.feederObservationSource='unavailable'
 const input={...plane,route:[{name:'TEB',seconds:500}],landingSeconds:898}
 const next=runEngine(packet(2,input),c,edits,JSON.parse(JSON.stringify(first))),f=one(next)
 assert.equal(f.ff,'ELTOK');assert.equal(f.feederEtaAvailable,false);assert.equal(f.feederGuidanceAvailable,true)
 assert.equal(f.sta,old.sta);assert.equal(f.staFf,old.staFf);assert.equal(f.delay,old.delay)
 assert.equal(controllerInstructionSeconds(f),180);assert.equal(euroscopeInstruction(f),180);assert.equal(f.line0Suppressed,false)
})

test('a real newly available feeder enables its real instruction without changing the runway sequence',()=>{
 const {c,flights,first}=bank()
 const input=flights.map(p=>p.callsign==='UNKNOWN'?{...p,route:[{name:'ELTOK',seconds:598}],landingSeconds:p.landingSeconds-2}:{...p,landingSeconds:p.landingSeconds-2,route:p.route.map(r=>({...r,seconds:r.seconds-2}))})
 const next=runEngine({source:'LIVE',timestamp:now+2000,flights:input},c,{},first),f=next.flights.find(f=>f.callsign==='UNKNOWN')
 assert.equal(f.ff,'ELTOK');assert.equal(f.feederEtaAvailable,true);assert.equal(f.feederGuidanceAvailable,true)
 assert.equal(controllerInstructionSeconds(f),f.delay);assert.equal(f.guidance.instructionSeconds,f.delay)
 const sorted=next.flights.filter(f=>f.mode==='sequenced'&&!f.issue).sort((a,b)=>a.sta-b.sta)
 for(let i=1;i<sorted.length;i++)assert.ok(sorted[i].sta-sorted[i-1].sta>=c.rates['ESSA/19L']*1000-1)
})

test('fresh Superstable feeder estimates consume L03 to L02 to L00 while manual slots and order stay fixed',()=>{
 const {c,edits,first}=superstableSlot(),old=one(first),saved=JSON.stringify(first)
 let s=first
 for(const [elapsed,remaining,label] of [[60,120,'2'],[180,0,'']]){
  s=runEngine(packet(elapsed),c,edits,JSON.parse(JSON.stringify(s)));const f=one(s)
  assert.equal(f.state,2);assert.equal(f.passedFeeder,false);assert.equal(f.sta,old.sta);assert.equal(f.staFf,old.staFf);assert.equal(f.order,old.order)
  assert.deepEqual(f.euroscopeBaseline,old.euroscopeBaseline);assert.equal(f.recomputedAt,old.recomputedAt)
  assert.equal((f.staFf-f.etaFf)/1000,remaining);assert.equal(f.delay,remaining);assert.equal(controllerInstructionSeconds(f),remaining)
  assert.equal(euroscopeInstruction(f),remaining);assert.equal(delayLabel(controllerInstructionSeconds(f)),label);assert.equal(f.guidance.instructionSeconds,remaining)
 }
 assert.equal(JSON.stringify(first),saved,'previous checkpoints remain untouched')
})

test('fresh Superstable work changes preserve real runway gaps and rates rather than releasing slots',()=>{
 const {c,edits,first}=superstableSlot(),old=one(first)
 c.slots=[{id:'BLOCK',runway:'ESSA/19L',begin:old.sta-1000,end:old.sta+120000,kind:'gap'}]
 const next=runEngine(packet(60),c,edits,first),f=one(next)
 assert.ok(f.sta>=c.slots[0].end);assert.ok(f.sta>old.sta)
 assert.equal(f.delay,Math.round((f.staFf-f.etaFf)/1000));assert.ok(f.delay>120)
 assert.equal(f.guidance.instructionSeconds,controllerInstructionSeconds(f))
})

test('unavailable, stale and quarantined observations cannot consume a protected Superstable instruction',()=>{
 for(const input of [
  {...plane,positionAgeSeconds:16},
  {...plane,route:[{name:'TEB',seconds:500}]},
  {...plane,landingSeconds:2098,route:[{name:'ELTOK',seconds:1318}]},
 ]){
  const {c,edits,first}=superstableSlot(),old=one(first),next=runEngine(packet(2,input),c,edits,first),f=one(next)
  if(input.positionAgeSeconds>15){assert.equal(f.lost,true);assert.ok(!toTopSkySequence(next,c,edits).sequence.some(row=>row.callsign==='LONE'));continue}
  assert.equal(f.sta,old.sta);assert.equal(f.staFf,old.staFf);assert.equal(f.delay,old.delay)
  assert.equal(controllerInstructionSeconds(f),old.delay)
 }
})


test('a free arrival gains no lose instruction when the feeder buffer changes at Superstable',()=>{
 const c=config(),far={...plane,landingSeconds:1000,route:[{name:'ELTOK',seconds:300}]}
 const first=runEngine(packet(0,far),c,{}),old=one(first)
 assert.equal(old.state,1);assert.equal(old.delay,0)
 let s=first
 for(const elapsed of [190,200,210]){
  const p={...far,landingSeconds:1000-elapsed,route:[{name:'ELTOK',seconds:300-elapsed}]}
  s=runEngine(packet(elapsed,p),c,{},JSON.parse(JSON.stringify(s)));const f=one(s)
  assert.equal(f.state,2);assert.equal(f.sta,old.sta);assert.equal(f.delay,0);assert.equal(controllerInstructionSeconds(f),0)
 }
})
