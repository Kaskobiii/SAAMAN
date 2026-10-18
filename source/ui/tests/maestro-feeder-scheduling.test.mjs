import {test} from 'node:test'
import assert from 'node:assert/strict'
import {runEngine,migrateSequenceEdits,validateEdits,DEFAULT_CONFIG} from '../src/maestro-engine.ts'
import {swapFlightEdits,gainDragEdits} from '../src/maestro-operations.ts'
import fixture from './fixtures/recording11-scheduling.json' with {type:'json'}
const get=(s,c)=>s.flights.find(p=>p.callsign===c),byFrame=n=>fixture.cases.find(p=>p.frame===n)
const evaluate=(f,edits=f.edits,previous=f.previous)=>runEngine(structuredClone(f.input),structuredClone(f.config),structuredClone(edits),{...structuredClone(previous),timestamp:f.input.timestamp-1})
function check(s,c){
 const available=s.flights.filter(f=>f.mode==='sequenced'&&!f.lost&&!f.issue&&f.state!==4&&f.landingEtaAvailable!==false)
 for(const runway of new Set(available.map(f=>f.runway))){const q=available.filter(f=>f.runway===runway).sort((a,b)=>a.order-b.order);for(let i=1;i<q.length;i++)assert.ok(q[i].sta-q[i-1].sta>=c.rates[`ESSA/${runway}`]*1000-1,`${q[i-1].callsign}/${q[i].callsign}: runway spacing`)}
 for(const ff of ['NILUG','XILAN','ELTOK','VACRA']){const q=available.filter(f=>f.ff===ff&&!f.passedFeeder&&f.feederEtaAvailable!==false).sort((a,b)=>a.staFf-b.staFf);for(let i=1;i<q.length;i++)assert.ok(q[i].staFf-q[i-1].staFf>=Math.max(c.rates[`ESSA/${q[i].runway}`],c.rates[`ESSA/${q[i-1].runway}`])*1000-1,`${q[i-1].callsign}/${q[i].callsign}: ${ff} spacing`)}
}
test('recording 11: Stable RYR174C/HUN22JD receive separated NILUG slots',()=>{
 const f=byFrame(502),before=Math.abs(get(f.previous,'RYR174C').staFf-get(f.previous,'HUN22JD').staFf)
 assert.ok(before<96000);const s=evaluate(f);check(s,f.config)
 assert.ok(Math.abs(get(s,'RYR174C').staFf-get(s,'HUN22JD').staFf)>=96000)
})
test('same physical feeder is protected across primary and secondary runway banks',()=>{
 const f=structuredClone(byFrame(502)),a=f.input.flights.find(p=>p.callsign==='RYR174C'),b=f.input.flights.find(p=>p.callsign==='HUN22JD')
 f.input.flights=[a,{...b,runway:'01L',threshold:f.input.runways['ESSA/01L']}];f.previous.flights=f.previous.flights.filter(p=>[a.callsign,b.callsign].includes(p.callsign))
 const s=evaluate(f,{});assert.equal(get(s,b.callsign).runway,'01L');check(s,f.config)
})
test('swapping SAS46R/SAS2091 back restores order without inheriting the old empty slots',()=>{
 const f=byFrame(734),before=structuredClone(f.previous),saved=structuredClone({f,before})
 let edits=swapFlightEdits(before,f.edits,'SAS46R','SAS2091'),s=evaluate(f,edits,before)
 assert.ok(get(s,'SAS2091').order<get(s,'SAS46R').order);check(s,f.config)
 edits=swapFlightEdits(s,edits,'SAS46R','SAS2091');s=evaluate(f,edits,s)
 assert.ok(get(s,'SAS46R').order<get(s,'SAS2091').order)
 for(const name of ['SAS46R','SAS2091']){assert.equal(edits[name].target,undefined);assert.ok(Math.abs(get(s,name).delay)<2);assert.ok(Math.abs(get(s,name).sta-get(s,name).eta)<1000)}
 check(s,f.config);assert.deepEqual({f,before},saved)
})
test('SAS3FF behind RYR174C receives genuine spacing work, never an impossible inherited gain',()=>{
 const f=byFrame(904),edits=swapFlightEdits(f.previous,f.edits,'SAS3FF','RYR174C'),s=evaluate(f,edits)
 assert.ok(get(s,'RYR174C').order<get(s,'SAS3FF').order)
 for(const c of ['RYR174C','SAS3FF'])assert.ok(get(s,c).sta>=get(s,c).eta-1)
 assert.ok(get(s,'SAS3FF').delay>0);check(s,f.config)
})
test('repeated swaps and repeated equivalent Recompute cannot add another interval',()=>{
 const f=byFrame(734);let edits=f.edits,s=f.previous,first
 for(let i=0;i<8;i++){
  edits=swapFlightEdits(s,edits,'SAS46R','SAS2091');s=evaluate(f,edits,s);check(s,f.config)
  const pair=['SAS46R','SAS2091'].map(c=>[get(s,c).sta,get(s,c).delay])
  if(i===1)first=pair;if(i>1&&i%2===1)assert.deepEqual(pair,first)
 }
})
test('legacy swap-generated targets retire once, survive checkpoint reload, and do not become deliberate manual times',()=>{
 const f=byFrame(904);let s=evaluate(f,f.nextEdits),capture=get(s,'RYR174C').euroscopeBaseline.at
 assert.equal(get(s,'RYR174C').appliedTarget,undefined);assert.ok(get(s,'RYR174C').sta>=get(s,'RYR174C').eta-1)
 for(let i=0;i<4;i++){s=evaluate(f,f.nextEdits,JSON.parse(JSON.stringify(s)));assert.equal(get(s,'RYR174C').euroscopeBaseline.at,capture);check(s,f.config)}
})
test('dragging one aircraft marks only its own order as deliberate',()=>{
 const f=byFrame(502),edits=gainDragEdits(f.previous,{},'SAS3FF',get(f.previous,'SAS3FF').sta-60000,'Runway',f.config)
 assert.equal(edits.SAS3FF.orderExplicit,true)
 for(const [c,e] of Object.entries(edits))if(c!=='SAS3FF'&&e.order!==undefined)assert.equal(e.orderExplicit,false)
 assert.throws(()=>validateEdits({SAS3FF:{order:0,orderExplicit:'yes'}}),/order intent/)
})
test('legacy queue-wide drag ranks do not mark all the untouched aircraft as explicitly ordered',()=>{
 const f=byFrame(502),edits=migrateSequenceEdits(f.edits,f.previous)
 assert.equal(edits.RYR174C.orderExplicit,false);assert.equal(edits.AUA21M.orderExplicit,true)
})
test('bulk Recompute stays deterministic after feeder corrections and across shared checkpoint restoration',()=>{
 const f=byFrame(2157),names=Object.keys(f.nextEdits).filter(c=>f.nextEdits[c].recomputeAt!==f.edits[c]?.recomputeAt)
 let edits=structuredClone(f.nextEdits),s=evaluate(f,edits),slots=s.flights.map(p=>[p.callsign,p.sta,p.staFf])
 check(s,f.config)
 for(let i=1;i<=4;i++){for(const c of names)edits[c]={...edits[c],recomputeAt:f.input.timestamp+i*1000+10000,changedAt:f.input.timestamp+i*1000+10000};s=evaluate(f,edits,JSON.parse(JSON.stringify(s)));assert.deepEqual(s.flights.map(p=>[p.callsign,p.sta,p.staFf]),slots);check(s,f.config)}
})


for(const f of fixture.cases.filter(p=>p.recomputeNames?.length))test(`recording 11 Recompute frame ${f.frame}: no repeated allocation ratchet`,()=>{
 let edits=structuredClone(f.nextEdits),s=evaluate(f,edits)
 check(s,f.config)
 const initial=new Map(s.flights.map(p=>[p.callsign,{sta:p.sta,staFf:p.staFf,order:p.order}]))
 for(let i=1;i<=3;i++){
  for(const c of f.recomputeNames)edits[c]={...edits[c],recomputeAt:f.input.timestamp+10000+i*1000,changedAt:f.input.timestamp+10000+i*1000}
  s=evaluate(f,edits,JSON.parse(JSON.stringify(s)));check(s,f.config)
  for(const p of s.flights){const old=initial.get(p.callsign);assert.ok(p.sta<=old.sta+1,`${p.callsign}: click ${i+1} added ${(p.sta-old.sta)/1000} s without new traffic`)}
 }
})


test('a sequence swap refreshes timing without demoting an already accepted Superstable phase',()=>{
 const config={...structuredClone(DEFAULT_CONFIG),active:['ESSA/01R'],unstableSeconds:0},now=Date.UTC(2026,9,18,18)
 const input={source:'TEST',timestamp:now,flights:['AA','BB'].map((callsign,i)=>({callsign,aircraft:'A320',wake:'M',departure:'EFHK',arrival:'ESSA',runway:'01R',route:[{name:'NILUG',seconds:600+i*120},{name:'SA01R',seconds:1800+i*120}],landingSeconds:1800+i*120,distanceNm:100,groundspeed:300,altitude:25000}))}
 const first=runEngine(input,config,{})
 for(const p of first.flights){p.state=2;p.passedFeeder=false}
 const edits=swapFlightEdits(first,{},'AA','BB'),s=runEngine({...input,timestamp:now+1000},config,edits,first)
 assert.ok(s.flights.every(p=>p.state===2));assert.ok(get(s,'BB').order<get(s,'AA').order)
})
