import test from 'node:test'
import assert from 'node:assert/strict'
import {LegacyRelay} from '../src/legacy-relay.ts'
import {SharedRelay} from '../src/shared-relay.ts'
import sectorGeometry from './fixtures/essa-sector-runway-geometry.json' with {type:'json'}

// Contract fixture for the existing vatIRIS routes: no scoped rooms, CAS,
// tokens, retry IDs, checkpoints or supervisor endpoints on the server.
function setup(){
    let now=Date.now(),serial=0,version=0,sequence=null,owner='',seen=0,commands=[],next=0,failure=''
    const results=new Map(),requests=[],copy=v=>JSON.parse(JSON.stringify(v))
    const error=(message,status)=>{throw Object.assign(new Error(message),{status})}
    const alive=()=>owner&&now-seen<8000
    const send=async(method,path,body)=>{
        requests.push({method,path,body:body&&copy(body)})
        assert.match(path,/^\/aman\/sweatbox1\/ESSA(?:\/(?:poll|command|leave))?$/)
        if(failure==='offline')error('Disconnected',503)
        if(method==='GET'){if(!sequence||now-sequence.saamanRelay.publishedAt>=30000)error('Not found',404);return copy(sequence)}
        const call=body.callsign
        if(path.endsWith('/leave')){if(owner===call)owner='';return 'ok'}
        if(path.endsWith('/command')){if(!alive())error('No sequencer',503);const id=++next;commands.push({id,from:call,cmd:copy(body.cmd)});if(failure==='command'){failure='';error('Response lost',503)}return {id}}
        if(!alive())owner=call
        if(path.endsWith('/poll')){
            if(owner===call)seen=now
            const out={role:owner===call?'sequencer':'editor',sequencer:owner,version,users:[call],sequence:sequence&&copy(sequence),commands:owner===call?copy(commands):[],results:results.get(call)||[]}
            results.delete(call);return out
        }
        if(owner!==call)error('Another sequencer',409)
        seen=now;sequence=copy(body.sequence);version++
        commands=commands.filter(c=>c.id>body.cmdAck)
        for(const r of body.results||[])results.set(r.from,[...(results.get(r.from)||[]),r])
        if(failure==='publication'){failure='';error('Response lost',503)}
        return {version}
    }
    const client=(instanceId,call,cid,initialRunways={arrivals:['ESSA/01R'],departures:['ESSA/01L']},runways)=>{
        let activeRunways=initialRunways
        const options={network:'sweatbox1',session:'ignored-exercise',channel:'ignored-channel',instanceId}
        const legacy=new LegacyRelay({network:'sweatbox1',instanceId,send,callsign:()=>call,cid:()=>cid,supervisor:async(cs,claimed)=>claimed===1396125,now:()=>now,requestId:()=>`relay-${++serial}`})
        const relay=new SharedRelay(options,{send:(method,path,body)=>legacy.send(method,path,body),cid:()=>cid,now:()=>now,requestId:()=>`request-${++serial}`,telemetry:async()=>({source:call,connected:true,simulation:true,timestamp:now,activeRunways,runways,flights:[{callsign:'SAS123',aircraft:'A320',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'01R',route:[{name:'ELTOK',seconds:800}],landingSeconds:1400,distanceNm:100,groundspeed:250,altitude:15000}]})})
        return {relay,legacy,options,setRunways:value=>activeRunways=value}
    }
    return {client,requests,advance:ms=>now+=ms,failure:value=>failure=value,reset:()=>{sequence=null;owner='';version=0;commands=[];results.clear()},state:()=>copy({sequence,commands,version,owner}),foreign:()=>{sequence={data:{icao:'ESSA'},sequence:[]};version=1}}
}
test('unchanged callsign API shares full engine state and active runways with no login/identity endpoint',async()=>{
    const f=setup(),a=f.client('instance-a','ESSA_APP',1396125),b=f.client('instance-b','ESSA_E_APP',null)
    const first=await a.relay.tick(),second=await b.relay.tick()
    assert.equal(first.relayRole,'sequencer');assert.equal(second.relayRole,'editor')
    assert.deepEqual(second.snapshot,JSON.parse(JSON.stringify(first.snapshot)))
    assert.deepEqual(second.config.active,['ESSA/01R'])
    assert.ok(f.state().sequence.saamanRelay.checkpoint.snapshot.flights.length)
    assert.ok(f.requests.every(r=>!r.path.includes('/rooms/')&&!r.path.includes('/identity')))
})
test('editor drag/reorder result survives destructive legacy result polling and handover',async()=>{
    const f=setup(),a=f.client('instance-a','ESSA_APP',1396125),b=f.client('instance-b','ESSA_E_APP',null)
    await a.relay.tick();await b.relay.tick();f.advance(1000)
    const base=b.relay.view(),target=base.snapshot.flights[0].sta+120000
    const drive=setInterval(()=>void a.relay.tick().catch(()=>{}),20)
    try{await b.relay.edit(base.revision,{SAS123:{target}},base.config)}finally{clearInterval(drive)}
    assert.equal((await b.relay.tick()).edits.SAS123.target,target)
    await a.relay.leave();f.advance(1000)
    const taken=await b.relay.tick();assert.equal(taken.relayRole,'sequencer');assert.equal(taken.edits.SAS123.target,target)
})
test('retry after a lost command response applies coordination once',async()=>{
    const f=setup(),a=f.client('instance-a','ESSA_APP',1396125),b=f.client('instance-b','ESSA_E_APP',null)
    await a.relay.tick();await b.relay.tick();f.failure('command')
    await assert.rejects(b.relay.coordinate('Update finished'),/Response lost/)
    await b.relay.tick();await a.relay.tick();await b.relay.tick()
    assert.equal(b.relay.view().config.coordinations.length,1)
    assert.equal(f.state().commands.length,0)
    assert.equal(b.relay.view().config.coordinations[0].senderCallsign,'ESSA_E_APP')
})
test('coordination sender login and UTC timestamp survive callsign API delivery, acknowledgement and owner handover',async()=>{
 const f=setup(),a=f.client('instance-a','ESSA_FMP',1396125),b=f.client('instance-b','ESOS_1__CTR',null),c=f.client('instance-c','ESSA_W__APP',null)
 await a.relay.tick();await b.relay.tick();await c.relay.tick();f.advance(1000)
 const drive=setInterval(()=>void a.relay.tick().catch(()=>{}),20)
 let original
 try{
  const sent=await b.relay.coordinate('Speed 230 kts for all arrivals to ESSA');original=sent.config.coordinations[0]
  assert.equal(original.senderCallsign,'ESOS_1__CTR');assert.equal(original.sender,'instance-b');assert.equal(original.at,sent.snapshot.timestamp)
  const delivered=(await c.relay.tick()).config.coordinations[0];assert.deepEqual(delivered,original)
  const acknowledged=(await c.relay.coordinate(undefined,original.id)).config.coordinations[0]
  assert.ok(acknowledged.acknowledgedBy.includes('instance-c'));assert.equal(acknowledged.senderCallsign,original.senderCallsign);assert.equal(acknowledged.at,original.at)
 }finally{clearInterval(drive)}
 await a.relay.leave();f.advance(1000);const next=await c.relay.tick()
 assert.equal(next.relayRole,'sequencer');assert.equal(next.config.coordinations[0].senderCallsign,original.senderCallsign);assert.equal(next.config.coordinations[0].at,original.at)
})
test('lost publication response is recovered without uploading it twice',async()=>{
    const f=setup(),a=f.client('instance-a','ESSA_APP',1396125)
    f.failure('publication');await assert.rejects(a.relay.tick(),/Response lost/)
    assert.equal(f.state().version,1)
    await a.relay.tick();assert.equal(a.relay.view().stale,false)
    const puts=f.requests.filter(r=>r.method==='PUT')
    assert.equal(new Set(puts.map(r=>r.body.sequence.saamanRelay.publication)).size,puts.length)
})
test('supervision settings go through the sequencer and ordinary controllers are refused',async()=>{
    const f=setup(),a=f.client('instance-a','ESSA_APP',1396125),b=f.client('instance-b','ESSA_E_APP',null),s=f.client('instance-a','ESSA_APP',1396125)
    await a.relay.tick();await b.relay.tick();await assert.rejects(b.relay.supervision(),/Supervisor access/)
    const current=await s.relay.supervision()
    const drive=setInterval(()=>void a.relay.tick().catch(()=>{}),20)
    try{await s.relay.saveSettings(current.revision,{euroscopeBufferMinutes:3})}finally{clearInterval(drive)}
    assert.equal((await b.relay.tick()).config.euroscopeBufferMinutes,3)
    assert.ok(!f.requests.some(r=>r.path.endsWith('/settings')||r.path.endsWith('/supervision')))
})
test('observe only does not acquire the legacy sequencer lease',async()=>{
    const f=setup(),a=f.client('instance-a','ESSA_APP',1396125),b=f.client('instance-b','ESSA_E_APP',null)
    await a.relay.tick();await b.relay.setObserver(true);await a.relay.leave();f.advance(9000)
    const observed=await b.relay.tick();assert.equal(observed.relayRole,'observer');assert.equal(f.state().owner,'')
})
test('backend reset clears old epochs, and a different AMAN engine is not silently overwritten',async()=>{
    const f=setup(),a=f.client('instance-a','ESSA_APP',1396125)
    const old=await a.relay.tick();f.reset();f.advance(1000)
    assert.notEqual((await a.relay.tick()).epoch,old.epoch)
    const other=setup(),b=other.client('instance-b','ESSA_E_APP',null);other.foreign()
    await assert.rejects(b.relay.tick(),/another AMAN plugin/)
    assert.ok(!other.requests.some(r=>r.method==='PUT'))
})

test('a new sequencer seeds EuroScope runways even when it restores a 19R/26 checkpoint',async()=>{
    const f=setup(),a=f.client('instance-a','ESSA_APP',1396125,{arrivals:['ESSA/19R'],departures:['ESSA/26']}),b=f.client('instance-b','ESSA_E_APP',null)
    const old=await a.relay.tick();assert.deepEqual(old.config.active,['ESSA/19R']);assert.equal(old.config.departureRunway,'ESSA/26')
    const follower=await b.relay.tick();assert.deepEqual(follower.config.active,['ESSA/19R'])
    await a.relay.leave();f.advance(1000)
    const taken=await b.relay.tick()
    assert.deepEqual(taken.config.active,['ESSA/01R']);assert.equal(taken.config.departureRunway,'ESSA/01L')
    assert.equal(taken.snapshot.flights[0].firstSeen,old.snapshot.flights[0].firstSeen)
    assert.deepEqual(f.state().sequence.saamanRelay.checkpoint.operational.active,['ESSA/01R'])
})

test('startup waits for both EuroScope runway selections before publishing any default configuration',async()=>{
    for(const selection of [undefined,{arrivals:[],departures:[]},{arrivals:['ESSA/01R'],departures:[]},{arrivals:['ESSB/12','ESSA/99'],departures:['ESSA/01L']}]){
        const f=setup(),a=f.client('instance-a','ESSA_APP',1396125);a.setRunways(selection)
        await assert.rejects(a.relay.tick(),/Waiting for active ESSA arrival and departure runways/)
        assert.equal(f.requests.filter(r=>r.method==='PUT').length,0);assert.equal(a.relay.view().snapshot,null)
        a.setRunways({arrivals:['ESSA/01R'],departures:['ESSA/01L']});f.advance(2000)
        const ready=await a.relay.tick();assert.deepEqual(ready.config.active,['ESSA/01R']);assert.equal(ready.config.departureRunway,'ESSA/01L')
    }
})

test('EuroScope runway selections are read once per ownership, not on every refresh',async()=>{
    const f=setup(),a=f.client('instance-a','ESSA_APP',1396125),b=f.client('instance-b','ESSA_E_APP',null,{arrivals:['ESSA/19R'],departures:['ESSA/26']})
    await a.relay.tick();a.setRunways({arrivals:['ESSA/19R'],departures:['ESSA/26']});f.advance(1000)
    const refreshed=await a.relay.tick(),follower=await b.relay.tick()
    assert.deepEqual(refreshed.config.active,['ESSA/01R']);assert.equal(refreshed.config.departureRunway,'ESSA/01L')
    assert.deepEqual(follower.config.active,['ESSA/01R']);assert.equal(follower.config.departureRunway,'ESSA/01L')
})
test('FMP connects and publishes 01R/01L with the installed sector file additional 07/25 geometry',async()=>{
    const f=setup(),a=f.client('instance-a','ESSA_FMP',1396125,undefined,sectorGeometry.runways)
    const first=await a.relay.tick()
    assert.equal(first.relayRole,'sequencer');assert.equal(first.stale,false);assert.ok(first.snapshot.flights.length)
    assert.deepEqual(first.config.active,['ESSA/01R']);assert.equal(first.config.departureRunway,'ESSA/01L')
    assert.equal(first.snapshot.runways['ESSA/07'],undefined);assert.equal(first.snapshot.runways['ESSA/25'],undefined)
    assert.deepEqual(first.snapshot.runways['ESSA/01R'],sectorGeometry.runways['ESSA/01R'])
    assert.ok(f.requests.some(r=>r.method==='PUT'))
})
