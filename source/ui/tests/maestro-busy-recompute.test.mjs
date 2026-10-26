import {test} from 'node:test'
import assert from 'node:assert/strict'
import {reactive} from 'vue'
import {DEFAULT_CONFIG,runEngine,wakeInterval,effectiveConfig} from '../src/maestro-engine.ts'
import {recomputeFlightEdits,swapFlightEdits} from '../src/maestro-operations.ts'
import beforeFeeder from './fixtures/recording1-busy-recompute-501.json' with {type:'json'}
import entered from './fixtures/recording1-busy-recompute-785.json' with {type:'json'}
import rateAndFeeder from './fixtures/recompute-rate-feeder-reservation.json' with {type:'json'}
const clone=structuredClone
const slots=s=>s.flights.filter(f=>f.mode==='sequenced'&&!f.issue&&!f.lost&&f.state!==4).sort((a,b)=>a.order-b.order).map(f=>[f.callsign,f.state,f.order,f.sta,f.staFf,f.delay])
const get=(s,name)=>s.flights.find(f=>f.callsign===name)
function evaluate(input,c,e,previous){return runEngine(clone(input),c,e,{...clone(previous),timestamp:input.timestamp-1})}
function checkSpacing(s,c){
 const available=s.flights.filter(f=>f.mode==='sequenced'&&!f.issue&&!f.lost&&f.state!==4&&f.landingEtaAvailable!==false)
 for(const runway of new Set(available.map(f=>f.runway))){const q=available.filter(f=>f.runway===runway).sort((a,b)=>a.order-b.order);for(let i=1;i<q.length;i++){const a=q[i-1],b=q[i],plan=effectiveConfig(c,b.sta),rate=b.separation?.rateSeconds??plan.rates[`ESSA/${runway}`];assert.ok(b.sta-a.sta>=Math.max(rate,wakeInterval(a.wake,b.wake,`ESSA/${runway}`,plan))*1000-1)}}
 for(const ff of ['NILUG','XILAN','VACRA','ELTOK']){const q=available.filter(f=>f.ff===ff&&!f.passedFeeder&&f.feederEtaAvailable!==false).sort((a,b)=>a.staFf-b.staFf);for(let i=1;i<q.length;i++){const a=q[i-1],b=q[i],interval=Math.max(effectiveConfig(c,a.sta).rates[`ESSA/${a.runway}`],effectiveConfig(c,b.sta).rates[`ESSA/${b.runway}`]);assert.ok(b.staFf-a.staFf>=interval*1000-1)}}
}
for(const [name,f] of [['Stable follower',beforeFeeder],['Frozen rank in selected TMA group',entered]])test(`busy recording 1: ${name} settles on the first current-UI Recompute`,()=>{
 let s=clone(f.previous),edits=clone(f.edits),first;const original=JSON.stringify(f)
 for(let click=1;click<=8;click++){
  edits=recomputeFlightEdits(s,edits,f.names,f.input.timestamp+10000+click*1000)
  s=evaluate(f.input,f.config,edits,s);checkSpacing(s,f.config)
  if(!first)first=slots(s);else assert.deepEqual(slots(s),first,`identical click ${click} changed an allocated slot`)
 }
 assert.equal(JSON.stringify(f),original,'recorded inputs and accepted history stay immutable')
})

test('a Frozen rank preserved by Recompute is not treated as a newly entered manual order',()=>{
 const f=entered,old=get(f.previous,'NAX8110'),edits=recomputeFlightEdits(f.previous,f.edits,f.names,f.input.timestamp+1000)
 assert.equal(old.state,3);assert.equal(edits.NAX8110.order,old.order);assert.equal(edits.NAX8110.target,undefined)
 const first=evaluate(f.input,f.config,edits,f.previous),again=evaluate(f.input,f.config,recomputeFlightEdits(first,edits,f.names,f.input.timestamp+2000),first)
 assert.ok(get(first,'SAS8114').order<get(first,'SAS8118').order,'the selected pair is resolved on the first command')
 assert.deepEqual(slots(again),slots(first));assert.equal(get(first,'NAX8110').order,0)
})

const now=Date.UTC(2026,9,26,0),config=()=>({...clone(DEFAULT_CONFIG),active:['ESSA/01R'],departureRunway:'ESSA/01L',unstableSeconds:0,minimumNewSeconds:0,frozenMinutes:4.5})
const plane=(callsign,landing,feeder=100)=>({callsign,aircraft:'A320',wake:'M',departure:'EFHK',arrival:'ESSA',runway:'01R',groundspeed:250,altitude:10000,positionAgeSeconds:0,distanceNm:50,route:[{name:'NILUG',seconds:feeder}],landingSeconds:landing})
const input=(flights,t=now)=>({source:'ESSA_FMP',timestamp:t,flights})

test('a genuinely changed estimate can still change the first Recompute while an unselected manual Frozen target stays protected',()=>{
 const c=config(),p=input([plane('LOCKED',180,30),plane('FIRST',900),plane('SECOND',1000,110)]),edits={LOCKED:{target:now+240000,targetKind:'time',changedAt:now}},initial=runEngine(p,c,edits)
 assert.equal(get(initial,'LOCKED').state,3)
 const nextInput=input([p.flights[0],plane('FIRST',600),plane('SECOND',720,110)],now+2000),nextEdits=recomputeFlightEdits(initial,edits,['FIRST','SECOND'],now+2000),first=evaluate(nextInput,c,nextEdits,initial)
 assert.ok(get(first,'FIRST').sta<get(initial,'FIRST').sta);assert.equal(get(first,'LOCKED').sta,edits.LOCKED.target)
 assert.deepEqual(nextEdits.LOCKED,edits.LOCKED)
 for(let i=1,s=first,e=nextEdits;i<=4;i++){e=recomputeFlightEdits(s,e,['FIRST','SECOND'],now+2000+i);s=evaluate(nextInput,c,e,s);assert.deepEqual(slots(s),slots(first));checkSpacing(s,c)}
})

test('deliberate swaps retain their requested order despite the Frozen-Recompute distinction',()=>{
 const c=config(),p=input([plane('AA',180,30),plane('BB',240,40)]),first=runEngine(p,c,{}),edits=swapFlightEdits(first,{},'AA','BB'),next=evaluate(p,c,edits,first)
 assert.ok(get(next,'BB').order<get(next,'AA').order);checkSpacing(next,c)
})

test('Recompute edit construction accepts reactive records, skips missing/lost aircraft and clears only selected timing controls',()=>{
 const snapshot=reactive(clone(entered.previous)),edits=reactive({...clone(entered.edits),SAS8114:{...entered.edits.SAS8114,target:123,swapAt:1,requeueAt:1,landedAt:1,closurePosition:{id:'GAP',side:'after'},etaFfOverride:123},KEEP:{target:999,order:2}})
 get(snapshot,'SAS8118').lost=true
 const before=JSON.stringify(edits),changes=recomputeFlightEdits(snapshot,edits,['SAS8114','SAS8118','MISSING'],entered.input.timestamp+1000)
 assert.equal(JSON.stringify(edits),before);assert.equal(changes.SAS8114.mode,'sequenced');assert.equal(changes.SAS8114.target,undefined);assert.equal(changes.SAS8114.swapAt,undefined);assert.equal(changes.SAS8114.etaFfOverride,undefined)
 assert.deepEqual(changes.SAS8118,edits.SAS8118);assert.deepEqual(changes.KEEP,edits.KEEP);assert.equal(changes.MISSING,undefined)
})

for(const withGapAndFrozen of [false,true])test(`partial Recompute projects cross-runway feeder reservations through a scheduled rate change${withGapAndFrozen?' with a runway gap and selected Frozen anchor':''}`,()=>{
 const f=clone(rateAndFeeder),origin=f.input.timestamp-2000
 if(withGapAndFrozen){
  f.config.slots=[{id:'TEST',runway:'ESSA/01R',kind:'gap',begin:origin+1250000,end:origin+1370000}]
  const frozen={...clone(f.input.flights[0]),callsign:'FROZEN',landingSeconds:120,route:[{name:'NILUG',seconds:30}]}
  f.previous=runEngine({...clone(f.input),timestamp:origin,flights:[frozen,...f.input.flights.map(p=>p.callsign==='B'?{...p,landingSeconds:1000}:p)]},f.config,f.edits)
  f.input.flights.unshift(frozen);f.names.unshift('FROZEN')
 }
 let s=clone(f.previous),edits=clone(f.edits),first
 const manual=clone(edits.D),frozen=get(s,'FROZEN')
 for(let click=1;click<=8;click++){
  edits=recomputeFlightEdits(s,edits,f.names,f.input.timestamp+10000+click*1000)
  s=evaluate(f.input,f.config,edits,s);checkSpacing(s,f.config)
  assert.deepEqual(edits.D,manual,'an unselected controller time remains unchanged')
  assert.equal(get(s,'D').sta,manual.target,'the cross-runway controller reservation is honored')
  for(const flight of s.flights)assert.ok(!f.config.slots.some(slot=>slot.runway===`ESSA/${flight.runway}`&&flight.sta>=slot.begin&&flight.sta<slot.end),'no projected flight lands inside a gap')
  if(frozen){assert.equal(get(s,'FROZEN').state,3);assert.equal(get(s,'FROZEN').order,frozen.order)}
  if(!first){first=slots(s);assert.ok(get(s,'C').order<get(s,'A').order,'the feasible earlier refreshed arrival is inserted on the first command')}
  else assert.deepEqual(slots(s),first,`identical click ${click} changed an allocated slot`)
 }
})
