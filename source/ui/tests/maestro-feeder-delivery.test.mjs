import {test} from 'node:test'
import assert from 'node:assert/strict'
import {runEngine,wakeInterval} from '../src/maestro-engine.ts'
import {feederDelivery} from '../src/maestro-feeder-delivery.ts'
import fixture from './fixtures/gap-bank-recording14.json' with {type:'json'}

const a='AUA96Y',b='SWR1KV',get=(s,c)=>s.flights.find(f=>f.callsign===c)
const evaluate=(c=fixture.config,e=fixture.edits,previous=fixture.previous,input=fixture.input)=>runEngine(structuredClone(input),structuredClone(c),structuredClone(e),structuredClone(previous))
function check(s,c){
 const flights=s.flights.filter(f=>f.mode==='sequenced'&&f.state!==4&&!f.lost&&!f.issue&&f.landingEtaAvailable!==false)
 const queue=flights.filter(f=>f.runway==='19L').sort((x,y)=>x.order-y.order)
 for(let i=1;i<queue.length;i++)assert.ok(queue[i].sta-queue[i-1].sta>=Math.max(c.rates['ESSA/19L'],wakeInterval(queue[i-1].wake,queue[i].wake,'ESSA/19L',c))*1000-1)
 const nilug=flights.filter(f=>f.ff==='NILUG'&&!f.passedFeeder).sort((x,y)=>x.staFf-y.staFf)
 for(let i=1;i<nilug.length;i++)assert.ok(nilug[i].staFf-nilug[i-1].staFf>=96000-1)
 for(const f of flights)for(const gap of c.slots.filter(g=>g.runway===`ESSA/${f.runway}`))assert.ok(f.sta<gap.begin||f.sta>=gap.end)
}

test('recording 14: compact the runway bank while retaining separate NILUG slots and live ETAs',()=>{
 const s=evaluate(),leader=get(s,a),follower=get(s,b)
 check(s,fixture.config)
 assert.equal(leader.sta,fixture.config.slots[0].end)
 assert.ok(Math.abs(follower.sta-leader.sta-96000)<1)
 assert.ok(follower.staFf-leader.staFf>=96000)
 assert.ok(follower.staFf-leader.staFf<110000)
 assert.equal(leader.order,get(fixture.previous,a).order);assert.equal(follower.order,get(fixture.previous,b).order)
 assert.ok(leader.feederDelivery);assert.ok(follower.feederDelivery)
 assert.ok(leader.delay>0&&follower.delay>0)
 const withoutGap=evaluate({...fixture.config,slots:[]})
 assert.equal(leader.eta,get(withoutGap,a).eta);assert.equal(follower.eta,get(withoutGap,b).eta)
 assert.equal(leader.etaFf,get(withoutGap,a).etaFf);assert.equal(follower.etaFf,get(withoutGap,b).etaFf)
})

test('removing or shortening the blocking GAP releases its bank without a residual backlog',()=>{
 const s=evaluate(),clear={...fixture.config,slots:[]},next=evaluate(clear,fixture.edits,s,{...fixture.input,timestamp:fixture.input.timestamp+2000})
 check(next,clear)
 for(const name of [a,b]){assert.equal(get(next,name).feederDelivery,undefined);assert.ok(Math.abs(get(next,name).delay)<60)}
 const short={...fixture.config,slots:fixture.config.slots.map(g=>({...g,end:g.begin+300000}))}
 const shrunk=evaluate(short,fixture.edits,s,{...fixture.input,timestamp:fixture.input.timestamp+2000})
 for(const name of [a,b])assert.equal(get(shrunk,name).feederDelivery,undefined)
})

test('repeated GAP application and checkpoint restoration do not add delay intervals',()=>{
 let s=evaluate();const slots=s.flights.map(f=>[f.callsign,f.sta,f.staFf])
 for(let i=0;i<5;i++){s=evaluate(fixture.config,fixture.edits,JSON.parse(JSON.stringify(s)));check(s,fixture.config);assert.deepEqual(s.flights.map(f=>[f.callsign,f.sta,f.staFf]),slots)}
})

test('compatible jets share a planned terminal profile without inheriting cruise GS differences',()=>{
 const f=get(fixture.previous,a),c=fixture.config
 const fast=feederDelivery({...f,groundspeed:450},c),slow=feederDelivery({...f,groundspeed:370},c)
 assert.deepEqual(fast,slow)
 const a321=feederDelivery({...f,aircraft:'A321',groundspeed:400},c)
 assert.ok(Math.abs(fast.seconds-a321.seconds)<10)
 const assigned=feederDelivery({...f,assignedSpeed:210},c)
 assert.equal(assigned.entryIas,210);assert.ok(assigned.seconds>fast.seconds)
 const prop=feederDelivery({...f,aircraft:'AT72',groundspeed:200},c)
 assert.ok(prop.seconds>fast.seconds)
})

test('wind and different approach routes still change planned transfer time',()=>{
 const f=get(fixture.previous,a),c=fixture.config,calm=feederDelivery(f,c)
 const windy=feederDelivery(f,{...c,surfaceWindDirection:190,surfaceWindSpeed:30})
 assert.notEqual(windy.seconds,calm.seconds)
 const short={...f,amanRoute:f.amanRoute.filter(p=>!['SA630','TEB','ERXEC'].includes(p.name))}
 assert.ok(feederDelivery(short,c).seconds<calm.seconds)
})

test('slow traffic and heavy wake constraints can retain more runway spacing',()=>{
 const previous=structuredClone(fixture.previous),input=structuredClone(fixture.input)
 get(previous,b).aircraft='AT72';get(previous,b).groundspeed=200;input.flights.find(f=>f.callsign===b).aircraft='AT72';input.flights.find(f=>f.callsign===b).groundspeed=200
 const prop=evaluate(fixture.config,fixture.edits,previous,input);check(prop,fixture.config)
 assert.ok(get(prop,b).sta-get(prop,a).sta>96000)
 const heavyInput=structuredClone(fixture.input),heavyPrevious=structuredClone(fixture.previous)
 heavyInput.flights.find(f=>f.callsign===a).wake='H';get(heavyPrevious,a).wake='H'
 const heavy=evaluate(fixture.config,fixture.edits,heavyPrevious,heavyInput);check(heavy,fixture.config)
 assert.ok(get(heavy,b).sta-get(heavy,a).sta>96000)
})

test('controller times and special before/after-GAP placements remain authoritative',()=>{
 const target=fixture.config.slots[0].end+600000,e={...fixture.edits,[b]:{target,targetKind:'time',changedAt:fixture.input.timestamp}}
 const s=evaluate(fixture.config,e);check(s,fixture.config)
 assert.equal(get(s,b).sta,target);assert.equal(get(s,b).feederDelivery,undefined)
 const before={...fixture.edits,[a]:{closurePosition:{id:fixture.config.slots[0].id,side:'before'},changedAt:fixture.input.timestamp}}
 const placed=evaluate(fixture.config,before)
 assert.equal(get(placed,a).feederDelivery,undefined)
})

test('a GAP bank cannot reorder an unentered Stable aircraft behind a Superstable follower',()=>{
 const previous=structuredClone(fixture.previous);get(previous,b).state=2
 const s=evaluate(fixture.config,fixture.edits,previous);check(s,fixture.config)
 assert.ok(get(s,a).order<get(s,b).order);assert.equal(get(s,b).state,2)
})

test('entered, Frozen, paused, bypassed and unknown-profile flights do not acquire a new delivery plan',()=>{
 const f=get(fixture.previous,a)
 for(const extra of [{passedFeeder:true},{state:3},{motionTiming:{held:true}},{feederEtaAvailable:false},{aircraft:'ZZZZ'},{initialProfile:{pending:true}},{euroscopeBaseline:undefined},{speedDataValid:false}])
  assert.equal(feederDelivery({...f,...extra},fixture.config),undefined)
})
