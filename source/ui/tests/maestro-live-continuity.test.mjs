import {test} from 'node:test'
import assert from 'node:assert/strict'
import {runEngine,toJuhaSequence} from '../src/maestro-engine.ts'
import {predictLanding} from '../src/maestro-landing-prediction.ts'
import fixture from './fixtures/live-interruption-local-landing.json' with {type:'json'}
const get=(s,c)=>s.flights.find(p=>p.callsign===c)
function replay(c){let s=structuredClone(c.previous);const out=[];for(const f of c.frames){s=runEngine(f.input,f.config,f.edits,s);out.push(s)}return out}
test('SAS57F retains Superstable and its accepted slot across the recorded brief input gap',()=>{
 const c=fixture.cases[0],states=replay(c),before=get(c.previous,'SAS57F')
 assert.ok(states.some(s=>!get(s,'SAS57F')))
 for(const s of states){const p=get(s,'SAS57F');if(!p)continue;assert.ok(p.state>=2);assert.equal(p.firstSeen,before.firstSeen);assert.ok(p.delay<60);assert.equal(p.sta,before.sta)}
})
test('hidden interruption history expires and cannot transfer to a different flight identity',()=>{
 const c=fixture.cases[0],initial=c.frames[0],missing=runEngine({...initial.input,timestamp:c.previous.timestamp+2000,flights:[]},initial.config,initial.edits,c.previous)
 const p=initial.input.flights.find(p=>p.callsign==='SAS57F'),t=missing.timestamp+1000
 const changed=runEngine({...initial.input,timestamp:t,flights:[{...p,departure:'EGLL'}]},initial.config,{},missing)
 assert.equal(get(changed,'SAS57F').firstSeen,t)
 const expired=runEngine({...initial.input,timestamp:t+121000,flights:[p]},initial.config,{},missing)
 assert.equal(get(expired,'SAS57F').firstSeen,t+121000)
 assert.ok(!toJuhaSequence(missing,initial.config,initial.edits).sequence.some(p=>p.callsign==='SAS57F'))
})
test('SAS123 ESSB arrival Recompute accepts Superstable without inventing feeder guidance and inserts ahead of EZY350',()=>{
 const c=fixture.cases[1],f=c.frames[0],s=runEngine(f.input,f.config,f.edits,c.previous),p=get(s,'SAS123')
 assert.ok(p.state>=2);assert.equal(p.issue,'');assert.ok(p.eta<get(s,'EZY350').eta);assert.ok(p.sta<get(s,'EZY350').sta);assert.ok(p.delay<120)
 assert.equal(p.feederEtaAvailable,false)
})
test('SAS123 second final stays available below 350 feet and confirms landing before track removal',()=>{
 const states=replay(fixture.cases[2]);let landed=false
 for(const s of states){const p=get(s,'SAS123');if(!p)continue;if(p.state===4)landed=true;assert.equal(p.missedRecovery,false);assert.equal(p.landingEtaAvailable,true)}
 assert.equal(landed,true)
 const last=states.at(-1),landing=last.landings.filter(p=>p.callsign==='SAS123')
 assert.ok(landing.length>=2);assert.ok(landing.at(-1).time>fixture.cases[2].previous.landings.filter(p=>p.callsign==='SAS123').at(-1).time)
})
test('40 kt rollout marks landed immediately; a slow departure or aircraft outside the runway does not',()=>{
 const c=fixture.cases[2],f=structuredClone(c.frames[0]),old=get(c.previous,'SAS123'),t=f.input.runways['ESSA/01R'],h=t.heading*Math.PI/180
 const p={...f.input.flights.find(p=>p.callsign==='SAS123'),runway:'01R',latitude:t.latitude+.3*Math.cos(h)/60,longitude:t.longitude+.3*Math.sin(h)/(60*Math.cos(t.latitude*Math.PI/180)),heading:t.heading,altitude:110,groundspeed:40,verticalSpeed:0,positionAgeSeconds:0}
 const input={...f.input,flights:[p]},previous={...c.previous,flights:[old]}
 const s=runEngine(input,f.config,f.edits,previous);assert.equal(get(s,'SAS123').state,4);assert.equal(get(s,'SAS123').landingStopped,true)
 const noise=runEngine({...input,timestamp:input.timestamp+2000,flights:[{...p,groundspeed:65,altitude:550,verticalSpeed:1000}]},f.config,f.edits,s)
 assert.equal(get(noise,'SAS123').state,4);assert.equal(get(noise,'SAS123').missedRecovery,false)
 assert.notEqual(get(runEngine(input,f.config,{},undefined),'SAS123').state,4)
 const outside=runEngine({...input,flights:[{...p,longitude:p.longitude+.1}]},f.config,f.edits,previous);assert.notEqual(get(outside,'SAS123').state,4)
})
test('sustained alignment outside short final retains the assigned route; short final stays position-based',()=>{
 const f=fixture.cases[0].frames[0],base=f.input.flights[0],t=f.input.runways['ESSA/01R'],h=t.heading*Math.PI/180,now=f.input.timestamp
 const p={...base,runway:'01R',threshold:t,latitude:t.latitude-10*Math.cos(h)/60,longitude:t.longitude-10*Math.sin(h)/(60*Math.cos(t.latitude*Math.PI/180)),heading:t.heading,altitude:2500,verticalSpeed:-600,groundspeed:190,positionAgeSeconds:0,landingSeconds:1800}
 const a=predictLanding(p,f.config,1,undefined,now),b=predictLanding(p,f.config,1,a,now+10000)
 assert.notEqual(a.method,'vector-position');assert.notEqual(b.method,'vector-position');assert.equal(b.seconds,a.seconds)
 const short={...p,latitude:t.latitude-3*Math.cos(h)/60,longitude:t.longitude-3*Math.sin(h)/(60*Math.cos(t.latitude*Math.PI/180)),altitude:900}
 assert.equal(predictLanding(short,f.config,1,b,now+12000).method,'final-position')
 assert.notEqual(predictLanding({...p,heading:(t.heading+180)%360},f.config,1,a,now+10000).method,'vector-position')
})


test('Recompute accepts inside-TMA arrivals from any departure, including absent feeder information',()=>{
 const c=fixture.cases[1],f=structuredClone(c.frames[0]),p=f.input.flights.find(p=>p.callsign==='SAS123')
 p.departure='EFHK';p.route=p.route.filter(q=>q.name!=='ESSB');p.landingSeconds=600
 const previous=structuredClone(c.previous),old=get(previous,'SAS123');old.departure=p.departure;old.state=0;old.passedFeeder=false
 const s=runEngine(f.input,f.config,f.edits,previous),flight=get(s,'SAS123')
 assert.ok(flight.state>=2);assert.equal(flight.tmaEntryAccepted,true)
 const later=runEngine({...f.input,timestamp:f.input.timestamp+2000},f.config,f.edits,JSON.parse(JSON.stringify(s)))
 assert.ok(get(later,'SAS123').state>=2)
 for(const bad of [{latitude:56,longitude:16},{altitude:25000},{positionAgeSeconds:20}]){
  const input=structuredClone(f.input);Object.assign(input.flights.find(p=>p.callsign==='SAS123'),bad)
  assert.notEqual(get(runEngine(input,f.config,f.edits,previous),'SAS123').tmaEntryAccepted,true)
 }
})
