import test from 'node:test'
import assert from 'node:assert/strict'
import {SharedRelay} from '../src/shared-relay.ts'
import {LegacyRelay} from '../src/legacy-relay.ts'
import {AmanRooms} from './fixtures/relay-rooms.ts'

const start=Date.UTC(2026,9,25,22),copy=v=>JSON.parse(JSON.stringify(v))
const options=instanceId=>({network:'live',session:'shared',channel:'saaman',instanceId})
const plane={callsign:'ARRIVAL',aircraft:'A320',wake:'M',departure:'EPWA',arrival:'ESSA',runway:'19R',route:[{name:'ELTOK',seconds:120}],landingSeconds:1200,distanceNm:60,groundspeed:280,altitude:15000,positionAgeSeconds:0}
function legacyRoom(){
 let now=start,serial=0,version=0,sequence=null,owner='',zero=false,zeroRole='sequencer',drop=false,foreign=false,onRead,pollValue
 const requests=[],error=(text,status)=>{throw Object.assign(new Error(text),{status})}
 const send=async(method,path,body)=>{
  requests.push({method,path,body:body&&copy(body)})
  if(method==='GET'){
   if(onRead)onRead()
   if(foreign)return {data:{icao:'ESSA'},sequence:[]}
   if(!sequence||now-sequence.saamanRelay.publishedAt>=30000)error('Not found',404)
   return copy(sequence)
  }
  if(path.endsWith('/poll')){
   if(pollValue){const result=pollValue;pollValue=undefined;return result}
   if(!owner)owner=body.callsign
   if(zero){zero=false;return {role:zeroRole,version:0,sequence:null,sequencer:zeroRole==='sequencer'?body.callsign:owner,commands:[]}}
   return {role:owner===body.callsign?'sequencer':'editor',version,sequence:sequence&&copy(sequence),sequencer:owner,commands:[]}
  }
  if(path.endsWith('/command'))return {id:1}
  if(method==='PUT'){
   if(owner!==body.callsign)error('Another sequencer',409)
   if(body.expectedVersion!==version)error('Stale publication',409)
   sequence=copy(body.sequence);version++
   if(drop){drop=false;error('Response lost',503)}
   return {version}
  }
  error('Unexpected endpoint',400)
 }
 const client=(id='direct',call='ESSA_FMP',proxy=false)=>{
  const legacy=new LegacyRelay({network:'live',instanceId:id,send,callsign:()=>call,cid:()=>1396125,supervisor:async()=>true,now:()=>now,requestId:()=>`legacy-${++serial}`})
  const relay=new SharedRelay(options(id),{now:()=>now,requestId:()=>`shared-${++serial}`,cid:()=>1396125,send:(m,p,b)=>legacy.send(m,p,b),telemetry:async()=>({source:call,connected:true,connectionType:proxy?2:1,timestamp:now,flights:[copy(plane)],activeRunways:{arrivals:['ESSA/19R'],departures:['ESSA/19L']}})})
  return {relay,legacy}
 }
 return {client,requests,onRead:fn=>onRead=fn,pollValue:value=>pollValue=value,advance:n=>now+=n,clear:()=>{sequence=null;version=0;owner=''},zero:(role='sequencer')=>{zero=true;zeroRole=role},owner:value=>owner=value,foreign:()=>foreign=true,dropPublication:()=>drop=true,
  remote:(value,v,cs)=>{sequence=copy(value);version=v;owner=cs},state:()=>copy({sequence,version,owner})}
}
async function established(f){
 const c=f.client();await c.relay.tick();f.advance(61000);await c.relay.tick()
 const base=c.relay.view(),checkpoint=f.state().sequence.saamanRelay.checkpoint
 // Accepted controller and operational state must survive the transport interruption.
 checkpoint.edits={ARRIVAL:{target:base.snapshot.flights[0].sta+180000,targetKind:'time',changedAt:base.snapshot.timestamp}}
 checkpoint.operational.pendingRate={at:base.snapshot.timestamp+600000,seconds:97}
 f.remote({...f.state().sequence,saamanRelay:{...f.state().sequence.saamanRelay,checkpoint}},f.state().version,'ESSA_FMP')
 f.advance(2000);const saved=await c.relay.tick()
 assert.ok(saved.snapshot.flights[0].state>=2)
 return {c,saved}
}
const accepted=f=>({firstSeen:f.firstSeen,initialEta:f.initialEta,initialEtaFf:f.initialEtaFf,initialSta:f.initialSta,initialStaFf:f.initialStaFf,baseline:f.euroscopeBaseline,state:f.state,sta:f.sta,staFf:f.staFf})

test('fresh callsign-room restart preserves the epoch, aircraft phases, times, edits and pending rates',async()=>{
 const f=legacyRoom(),{c,saved}=await established(f),old=copy(saved.snapshot.flights[0])
 f.clear();f.advance(2000);const recovered=await c.relay.tick()
 assert.equal(recovered.epoch,saved.epoch);assert.equal(recovered.revision,1)
 assert.deepEqual(accepted(recovered.snapshot.flights[0]),accepted(old))
 assert.deepEqual(recovered.edits,saved.edits);assert.deepEqual(recovered.config.pendingRate,saved.config.pendingRate)
 assert.deepEqual(recovered.config.active,saved.config.active);assert.equal(recovered.config.departureRunway,saved.config.departureRunway)
 assert.equal(f.requests.filter(r=>r.method==='PUT').at(-1).body.expectedVersion,0)
 assert.equal(f.state().sequence.saamanRelay.checkpoint.snapshot.flights[0].firstSeen,old.firstSeen)
})

test('a transient zero poll reads the current authoritative sequence before considering recovery',async()=>{
 const f=legacyRoom(),{c,saved}=await established(f),before=f.state().version
 f.zero();f.advance(2000);const result=await c.relay.tick()
 assert.equal(result.epoch,saved.epoch);assert.equal(result.revision,before+1)
 assert.deepEqual(accepted(result.snapshot.flights[0]),accepted(saved.snapshot.flights[0]))
 assert.equal(f.requests.filter(r=>r.method==='PUT').at(-1).body.expectedVersion,before)
})

test('an empty room cannot make an editor restore its saved sequence over the elected owner',async()=>{
 const f=legacyRoom(),{c,saved}=await established(f),next=f.client('priority','ESSA_E_APP')
 await next.relay.tick();const writes=f.requests.filter(r=>r.method==='PUT').length
 f.clear();f.owner('ESSA_E_APP');f.advance(2000)
 const waiting=await c.relay.tick();assert.equal(waiting.relayRole,'editor');assert.equal(waiting.snapshot,null)
 assert.equal(f.requests.filter(r=>r.method==='PUT').length,writes)
 await next.relay.tick();const authoritative=f.state().sequence
 authoritative.saamanRelay.checkpoint.edits.ARRIVAL.target+=120000
 f.remote(authoritative,1,'ESSA_E_APP');const restored=await c.relay.tick()
 assert.equal(restored.edits.ARRIVAL.target,saved.edits.ARRIVAL.target+120000)
 assert.equal(f.requests.filter(r=>r.method==='PUT').length,writes+1)
})

test('a fresh followed checkpoint can be restored by the controller newly elected to an empty room',async()=>{
 const f=legacyRoom(),{c,saved}=await established(f),next=f.client('next','ESSA_E_APP')
 await next.relay.tick();f.clear();f.advance(2000)
 const recovered=await next.relay.tick()
 assert.equal(recovered.relayRole,'sequencer');assert.equal(recovered.epoch,saved.epoch)
 assert.deepEqual(recovered.edits,saved.edits);assert.equal(recovered.snapshot.flights[0].firstSeen,saved.snapshot.flights[0].firstSeen)
 assert.equal(f.state().owner,'ESSA_E_APP')
})

test('expired callsign history does not revive aircraft or edits after an empty backend restart',async()=>{
 const f=legacyRoom(),{c,saved}=await established(f)
 f.clear();f.advance(31000);const result=await c.relay.tick()
 assert.notEqual(result.epoch,saved.epoch);assert.deepEqual(result.edits,{})
 assert.notEqual(result.snapshot.flights[0].firstSeen,saved.snapshot.flights[0].firstSeen)
 assert.equal(result.config.pendingRate,undefined)
})

test('a proxy never claims or republishes an empty callsign room from its cache',async()=>{
 const f=legacyRoom(),{saved}=await established(f),proxy=f.client('proxy','ESSA_FMP',true)
 await proxy.relay.tick();const writes=f.requests.filter(r=>r.method==='PUT').length
 f.clear();f.advance(31000);const result=await proxy.relay.tick()
 assert.equal(result.snapshot,null);assert.equal(f.state().owner,'');assert.equal(f.requests.filter(r=>r.method==='PUT').length,writes)
})

test('a competing plugin found while checking a zero poll is not overwritten',async()=>{
 const f=legacyRoom(),{c}=await established(f),writes=f.requests.filter(r=>r.method==='PUT').length
 f.zero();f.foreign();await assert.rejects(c.relay.tick(),/another AMAN plugin/)
 assert.equal(f.requests.filter(r=>r.method==='PUT').length,writes)
})

test('a lost recovery publication response is retried without duplicate publications or a second flight capture',async()=>{
 const f=legacyRoom(),{c,saved}=await established(f)
 f.clear();f.advance(2000);f.dropPublication();await assert.rejects(c.relay.tick(),/Response lost/)
 f.advance(2000);const restored=await c.relay.tick()
 assert.equal(restored.epoch,saved.epoch);assert.equal(restored.snapshot.flights[0].firstSeen,saved.snapshot.flights[0].firstSeen)
 const writes=f.requests.filter(r=>r.method==='PUT'),recovery=writes.filter(r=>r.body.expectedVersion===0)
 assert.equal(recovery.length,2,'one initial publication and one recovery publication')
 assert.equal(new Set(writes.map(r=>r.body.sequence.saamanRelay.publication)).size,writes.length)
})

function scopedRoom(){
 let now=start,serial=0,intercept
 const rooms=new AmanRooms(()=>now),key='live/ESSA/shared/saaman',requests=[]
 const send=async(method,path,body)=>{
  requests.push({method,path,body:body&&copy(body)})
  const who={id:'local',callsign:'ESSA_FMP',engine:body.engine,canSequence:true}
  if(path.endsWith('/poll')){let result=rooms.poll(key,who,body).data;if(intercept){const fn=intercept;intercept=undefined;result=fn(result)}return result}
  if(method==='PUT')return rooms.publish(key,who,body)
  throw Error('Unexpected endpoint')
 }
 const relay=new SharedRelay(options('scoped'),{now:()=>now,cid:()=>1396125,requestId:()=>`scope-${++serial}`,send,telemetry:async()=>({source:'ESSA_FMP',timestamp:now,flights:[copy(plane)],activeRunways:{arrivals:['ESSA/19R'],departures:['ESSA/19L']}})})
 return {relay,rooms,key,requests,advance:n=>now+=n,intercept:fn=>intercept=fn}
}

test('same-epoch null checkpoint at the accepted revision retains the fresh scoped sequence',async()=>{
 const f=scopedRoom(),first=await f.relay.tick();f.advance(2000)
 f.intercept(result=>({...result,checkpoint:null}));const next=await f.relay.tick()
 assert.equal(next.epoch,first.epoch);assert.equal(next.snapshot.flights[0].firstSeen,first.snapshot.flights[0].firstSeen)
 assert.deepEqual(next.snapshot.flights[0].euroscopeBaseline,first.snapshot.flights[0].euroscopeBaseline)
})

test('higher-revision missing checkpoint blocks writes until the authoritative checkpoint is supplied',async()=>{
 for(const omitted of [false,true]){
  const f=scopedRoom(),first=await f.relay.tick(),writes=f.requests.filter(r=>r.method==='PUT').length
  f.rooms.settings(f.key,{epoch:first.epoch,revision:first.revision,settings:{euroscopeBufferMinutes:4}})
  f.intercept(result=>{if(omitted){delete result.checkpoint;return result}return {...result,checkpoint:null}})
  f.advance(2000);await assert.rejects(f.relay.tick(),/current shared recovery checkpoint/)
  assert.equal(f.requests.filter(r=>r.method==='PUT').length,writes);assert.equal(f.relay.view().snapshot,null)
  const recovered=await f.relay.tick()
  assert.equal(recovered.config.euroscopeBufferMinutes,4);assert.equal(recovered.snapshot.flights[0].firstSeen,first.snapshot.flights[0].firstSeen)
 }
})

test('an expired scoped checkpoint is retained internally but cannot be silently republished from a null poll',async()=>{
 const f=scopedRoom();await f.relay.tick();const writes=f.requests.filter(r=>r.method==='PUT').length
 f.advance(31000);f.intercept(result=>({...result,checkpoint:null}))
 await assert.rejects(f.relay.tick(),/current shared recovery checkpoint/)
 assert.equal(f.relay.view().snapshot,null);assert.equal(f.requests.filter(r=>r.method==='PUT').length,writes)
})

test('a real scoped epoch reset still discards the preceding room history',async()=>{
 const f=scopedRoom(),first=await f.relay.tick()
 f.rooms.reset(f.key,{epoch:first.epoch,revision:first.revision});f.advance(2000)
 const next=await f.relay.tick();assert.notEqual(next.epoch,first.epoch);assert.notEqual(next.snapshot.flights[0].firstSeen,first.snapshot.flights[0].firstSeen)
})

test('ordinary lower-revision polls cannot use the recovery path to rewind an accepted plan',async()=>{
 const f=scopedRoom();await f.relay.tick();f.advance(2000);const first=await f.relay.tick()
 f.intercept(result=>({...result,revision:0,checkpointRecovery:{kind:'legacy-empty-room',epoch:first.epoch,fromRevision:first.revision},checkpoint:{schema:'saaman-1.1.9',snapshot:{...first.snapshot,timestamp:first.snapshot.timestamp-1000},edits:{},operational:{}}}))
 f.advance(2000);const next=await f.relay.tick()
 assert.ok(next.revision>first.revision);assert.equal(next.snapshot.flights[0].firstSeen,first.snapshot.flights[0].firstSeen)
})


test('a follower missing several pre-restart updates accepts the fresh restored authoritative generation',async()=>{
 const f=legacyRoom(),{c,saved}=await established(f),follower=f.client('behind','ESOS_1_CTR')
 await follower.relay.tick()
 for(let i=0;i<4;i++){f.advance(2000);await c.relay.tick()}
 f.clear();f.advance(2000);const owner=await c.relay.tick(),followed=await follower.relay.tick()
 assert.equal(followed.revision,owner.revision);assert.equal(followed.epoch,saved.epoch)
 assert.equal(followed.snapshot.flights[0].firstSeen,saved.snapshot.flights[0].firstSeen)
 assert.deepEqual(followed.snapshot,copy(owner.snapshot));assert.deepEqual(followed.edits,owner.edits)
})

test('an old recovered publication cannot rewind a client already updated in that generation',async()=>{
 const f=legacyRoom(),{c,saved}=await established(f)
 f.clear();f.advance(2000);await c.relay.tick();const older=f.state().sequence
 f.advance(2000);const current=await c.relay.tick()
 const stale=copy(older);stale.saamanRelay.checkpoint.edits.ARRIVAL.target+=900000
 f.pollValue({role:'sequencer',version:1,sequence:stale,sequencer:'ESSA_FMP',commands:[]})
 f.advance(2000);const next=await c.relay.tick()
 assert.ok(next.revision>current.revision);assert.equal(next.edits.ARRIVAL.target,saved.edits.ARRIVAL.target)
 assert.equal(next.snapshot.flights[0].firstSeen,saved.snapshot.flights[0].firstSeen)
})

test('a competing authoritative publication appearing after empty-room confirmation prevents recovery overwrite',async()=>{
 const f=legacyRoom(),{c}=await established(f),remote=copy(f.state().sequence),writes=f.requests.filter(r=>r.method==='PUT').length
 f.clear();f.advance(2000)
 let reads=0
 f.onRead(()=>{if(++reads===2){remote.saamanRelay.epoch='confirmed-new-owner';remote.saamanRelay.owner='ESSA_E_APP';remote.saamanRelay.instanceId='priority';remote.saamanRelay.lease='other-lease';remote.saamanRelay.revision=1;remote.saamanRelay.publishedAt+=2000;f.remote(remote,1,'ESSA_E_APP')}})
 await assert.rejects(c.relay.tick(),/Shared sequence changed/)
 assert.equal(f.requests.filter(r=>r.method==='PUT').length,writes)
 assert.equal(f.state().sequence.saamanRelay.epoch,'confirmed-new-owner')
})


test('a higher callsign version without its sequence fetches current edits before publishing',async()=>{
 for(const omitted of [false,true]){
  const f=legacyRoom(),{c,saved}=await established(f),next=f.state().version+1,authoritative=f.state().sequence
  authoritative.saamanRelay.revision=next;authoritative.saamanRelay.publishedAt+=2000
  authoritative.saamanRelay.checkpoint.edits.ARRIVAL.target+=120000
  f.remote(authoritative,next,'ESSA_FMP')
  f.pollValue({role:'sequencer',version:next,...(omitted?{}:{sequence:null}),sequencer:'ESSA_FMP',commands:[]})
  f.advance(2000);const result=await c.relay.tick()
  assert.equal(result.edits.ARRIVAL.target,saved.edits.ARRIVAL.target+120000)
  assert.equal(f.state().sequence.saamanRelay.checkpoint.edits.ARRIVAL.target,saved.edits.ARRIVAL.target+120000)
  assert.equal(f.requests.filter(r=>r.method==='PUT').at(-1).body.expectedVersion,next)
 }
})

test('a higher missing callsign sequence that GET cannot confirm blocks writes and recovers on a later full poll',async()=>{
 const f=legacyRoom(),{c,saved}=await established(f),next=f.state().version+1,authoritative=f.state().sequence,writes=f.requests.filter(r=>r.method==='PUT').length
 authoritative.saamanRelay.revision=next;authoritative.saamanRelay.publishedAt+=2000;authoritative.saamanRelay.checkpoint.edits.ARRIVAL.target+=120000
 f.remote(null,next,'ESSA_FMP');f.advance(2000)
 await assert.rejects(c.relay.tick(),/current shared sequence/)
 assert.equal(c.relay.view().snapshot,null);assert.equal(f.requests.filter(r=>r.method==='PUT').length,writes)
 f.remote(authoritative,next,'ESSA_FMP');const result=await c.relay.tick()
 assert.equal(result.edits.ARRIVAL.target,saved.edits.ARRIVAL.target+120000)
 assert.equal(result.snapshot.flights[0].firstSeen,saved.snapshot.flights[0].firstSeen)
})

test('a newly joined adapter cannot bootstrap over a higher version whose sequence is missing',async()=>{
 for(const available of [true,false]){
  const f=legacyRoom(),{saved}=await established(f),version=f.state().version,authoritative=f.state().sequence
  const joining=f.client('late','ESSA_E_APP'),writes=f.requests.filter(r=>r.method==='PUT').length
  f.owner('ESSA_E_APP');if(!available)f.remote(null,version,'ESSA_E_APP')
  f.pollValue({role:'sequencer',version,sequence:null,sequencer:'ESSA_E_APP',commands:[]});f.advance(2000)
  if(available){const result=await joining.relay.tick();assert.equal(result.snapshot.flights[0].firstSeen,saved.snapshot.flights[0].firstSeen);assert.deepEqual(result.edits,saved.edits)}
  else{await assert.rejects(joining.relay.tick(),/current shared sequence/);assert.equal(f.requests.filter(r=>r.method==='PUT').length,writes)}
 }
})


test('the validated counter generation reaches every pane once and stays stable on subsequent polls',async()=>{
 const f=legacyRoom(),{c,saved}=await established(f),follower=f.client('generation-follower','ESOS_1_CTR')
 const original=await follower.relay.tick()
 assert.equal(typeof original.revisionGeneration,'string');assert.equal(original.revisionGeneration,saved.revisionGeneration)
 f.clear();f.advance(2000);const restored=await c.relay.tick()
 assert.notEqual(restored.revisionGeneration,saved.revisionGeneration)
 assert.equal((await follower.relay.tick()).revisionGeneration,restored.revisionGeneration)
 const late=f.client('late-generation','ESSA_W_APP')
 assert.equal((await late.relay.tick()).revisionGeneration,restored.revisionGeneration)
 f.advance(2000);assert.equal((await c.relay.tick()).revisionGeneration,restored.revisionGeneration)
 f.clear();f.advance(2000);const again=await c.relay.tick()
 assert.equal(again.epoch,saved.epoch);assert.notEqual(again.revisionGeneration,restored.revisionGeneration)
})

test('a newer authoritative GET supersedes an advertised missing version without losing its edits',async()=>{
 const f=legacyRoom(),{c,saved}=await established(f),before=f.state().version,updated=copy(f.state().sequence)
 const target=saved.snapshot.flights[0].sta+240000
 updated.saamanRelay.revision=before+2;updated.saamanRelay.checkpoint.edits.ARRIVAL={target,targetKind:'time'}
 f.remote(updated,before+2,'ESSA_FMP')
 f.pollValue({role:'sequencer',sequencer:'ESSA_FMP',version:before+1,sequence:null,commands:[]})
 f.advance(2000);const next=await c.relay.tick()
 assert.equal(next.edits.ARRIVAL.target,target);assert.equal(f.state().sequence.saamanRelay.checkpoint.edits.ARRIVAL.target,target)
 assert.equal(next.revision,before+3);assert.equal(f.requests.filter(r=>r.method==='PUT').at(-1).body.expectedVersion,before+2)
})
