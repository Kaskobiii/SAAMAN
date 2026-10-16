import test from 'node:test'
import assert from 'node:assert/strict'
import {SharedRelay} from '../src/shared-relay.ts'
import {AmanRooms} from './fixtures/relay-rooms.ts'
import {DEFAULT_CONFIG as RELEASE_DEFAULT_CONFIG} from '../src/maestro-engine.ts'

const DEFAULT_CONFIG={...RELEASE_DEFAULT_CONFIG,timingModel:'performance'}

const options=id=>({network:'sweatbox1',session:'essa-test-01',channel:'saaman',instanceId:id})
const flight=()=>({callsign:'SAS123',aircraft:'A320',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'19R',route:[{name:'ELTOK',seconds:800}],landingSeconds:1400,distanceNm:100,groundspeed:250,altitude:15000})
function setup(){
    let now=Date.now(),serial=0,flights=[flight()],failure='',requests=[]
    const rooms=new AmanRooms(()=>now),key='sweatbox1/ESSA/essa-test-01/saaman'
    const deps=cid=>({now:()=>now,requestId:()=>`request-${++serial}`,cid:()=>cid,telemetry:async()=>({source:cid===1396125?'ESSA_APP':'ESSA_E_APP',timestamp:now,flights,activeRunways:{arrivals:['ESSA/19R'],departures:['ESSA/26']}}),send:async(method,path,body)=>{
        requests.push({method,path,body:structuredClone(body)})
        if(failure==='offline')throw new Error('Disconnected')
        const room=path.replace(/^\/aman\/rooms\//,'').replace(/\/(poll|command|leave|settings|supervision)$/,'')
        const c=body?.engine?{id:`${cid}:${body.instanceId}`,callsign:body.callsign,engine:body.engine,canSequence:!body.observer}:null
        if(path.endsWith('/poll'))return rooms.poll(room,c,body).data
        if(path.endsWith('/command')){const result=rooms.command(room,c,body);if(failure==='lost-command'){failure='';throw new Error('Response lost')}return result}
        if(path.endsWith('/leave'))return rooms.leave(room,c)
        if(path.endsWith('/supervision')){if(cid!==1396125)throw Object.assign(new Error('Supervisor access required'),{status:403});return rooms.supervision(room)}
        if(path.endsWith('/settings')){if(cid!==1396125)throw Object.assign(new Error('Supervisor access required'),{status:403});return rooms.settings(room,body)}
        const result=rooms.publish(room,c,body)
        if(failure==='lost-publication'){failure='';throw new Error('Response lost')}
        return result
    }})
    return {rooms,key,deps,requests,advance:ms=>now+=ms,setFlights:value=>flights=value,setFailure:value=>failure=value}
}
test('two DLL adapters share one engine-owned sequence without calling the old backend API',async()=>{
    const s=setup(),a=new SharedRelay(options('instance-a'),s.deps(1396125)),b=new SharedRelay(options('instance-b'),s.deps(1234567))
    const first=await a.tick(),second=await b.tick()
    assert.equal(first.relayRole,'sequencer');assert.equal(second.relayRole,'editor')
    assert.deepEqual(second.snapshot,JSON.parse(JSON.stringify(first.snapshot)))
    assert.ok(s.requests.every(r=>r.path.startsWith('/aman/rooms/')))
    assert.match(s.requests[0].body.engine.version,/^\d+\.\d+\.\d+$/)
    assert.equal(s.requests.find(r=>r.method==='PUT').body.checkpoint.schema,'saaman-1.1.9')
})
test('compact publication is opt-in and retains the recovery snapshot exactly once in its upload',async()=>{
 const s=setup(),deps=s.deps(1396125);deps.compactPublication=()=>true
 const relay=new SharedRelay(options('compact'),deps);await relay.tick()
 const body=s.requests.find(r=>r.method==='PUT').body
 assert.deepEqual(body.supervision,{sameAsCheckpoint:true});assert.ok(body.checkpoint.snapshot.flights.length)
 const full={...body,supervision:{config:body.checkpoint.operational,edits:body.checkpoint.edits,snapshot:body.checkpoint.snapshot}}
 assert.ok(Buffer.byteLength(JSON.stringify(body))<Buffer.byteLength(JSON.stringify(full))*0.7)
 const fallback=setup(),old=new SharedRelay(options('legacy'),fallback.deps(1396125));await old.tick()
 assert.ok(fallback.requests.find(r=>r.method==='PUT').body.supervision.snapshot)
})
test('disconnected EuroScope cannot join a shared backend despite a retained callsign',async()=>{
 const s=setup(),deps=s.deps(1396125),capture=deps.telemetry
 deps.telemetry=async()=>({...await capture(),connected:false})
 const relay=new SharedRelay(options('offline'),deps)
 await assert.rejects(()=>relay.tick(),/Connect EuroScope/)
 assert.equal(s.requests.length,0);assert.equal(relay.view().stale,true)
})

test('ordinary operators coordinate and acknowledge across adapters and sequencer handover',async()=>{
 const s=setup(),a=new SharedRelay(options('instance-a'),s.deps(1396125)),b=new SharedRelay(options('instance-b'),s.deps(1234567)),c=new SharedRelay(options('instance-c'),s.deps(7654321))
 await a.tick();await b.tick();await c.tick();s.advance(1000)
 const drive=setInterval(()=>void a.tick().catch(()=>{}),40)
 try{
  const base=b.view(),message={id:'coordination-1',message:'Update finished',sender:'instance-b',at:base.snapshot.timestamp,acknowledgedBy:['instance-b']}
  await b.edit(base.revision,base.edits,{...base.config,coordinations:[message]})
  const received=await c.tick();assert.equal(received.config.coordinations[0].message,'Update finished')
  assert.equal(received.config.coordinations[0].acknowledgedBy.includes('instance-c'),false)
  await c.edit(received.revision,received.edits,{...received.config,coordinations:[{...message,acknowledgedBy:['instance-b','instance-c']}]})
  const acknowledged=await b.tick();assert.ok(acknowledged.config.coordinations[0].acknowledgedBy.includes('instance-c'))
 }finally{clearInterval(drive)}
 await a.leave();s.advance(1000);const taken=await c.tick()
 assert.equal(taken.relayRole,'sequencer');assert.ok(taken.config.coordinations[0].acknowledgedBy.includes('instance-c'))
})
test('read-only room members can coordinate and acknowledge without enabling sequence edits',async()=>{
 const s=setup(),a=new SharedRelay(options('instance-a'),s.deps(1396125)),b=new SharedRelay(options('instance-b'),s.deps(1234567))
 await a.tick();await b.setObserver(true);s.advance(1000)
 const drive=setInterval(()=>void a.tick().catch(()=>{}),40)
 try{
  const sent=await b.coordinate('Update finished'),message=sent.config.coordinations[0]
  assert.equal(message.sender,'instance-b');assert.equal(sent.relayRole,'observer')
  assert.equal(message.senderCallsign,'ESSA_E_APP');assert.equal(message.at,sent.snapshot.timestamp)
  await a.coordinate('Snow removal ESSA');await b.tick()
  const incoming=b.view().config.coordinations.find(m=>m.sender==='instance-a')
  const acknowledged=await b.coordinate(undefined,incoming.id)
  assert.ok(acknowledged.config.coordinations.find(m=>m.id===incoming.id).acknowledgedBy.includes('instance-b'))
  assert.equal(incoming.senderCallsign,'ESSA_APP');assert.equal(acknowledged.config.coordinations.find(m=>m.id===incoming.id).at,incoming.at)
  await assert.rejects(b.edit(acknowledged.revision,acknowledged.edits,acknowledged.config),/Observer cannot edit/)
 }finally{clearInterval(drive)}
})
test('an uncertain coordination submission retries the same request without duplicate messages',async()=>{
 const s=setup(),a=new SharedRelay(options('instance-a'),s.deps(1396125));await a.tick();s.setFailure('lost-command')
 await assert.rejects(a.coordinate('Update finished'),/Response lost/)
 s.advance(1000);await a.tick()
 assert.equal(a.view().config.coordinations.length,1)
 const requests=s.requests.filter(r=>r.path.endsWith('/command'))
 assert.equal(requests.length,2);assert.equal(requests[0].body.requestId,requests[1].body.requestId)
})
test('a follower submits a patch and the sequencer applies it, without losing unrelated aircraft edits',async()=>{
    const s=setup(),a=new SharedRelay(options('instance-a'),s.deps(1396125)),b=new SharedRelay(options('instance-b'),s.deps(1234567))
    await a.tick();const base=await b.tick()
    const drive=setInterval(()=>void a.tick(),40)
    try{
        const result=await b.edit(base.revision,{SAS123:{mode:'desequenced',changedAt:base.snapshot.timestamp}},base.config)
        assert.equal(result.edits.SAS123.mode,'desequenced')
        assert.equal(result.snapshot.flights[0].mode,'desequenced')
        const cmd=s.requests.find(r=>r.path.endsWith('/command')).body
        assert.equal(cmd.cmd.op,'plan');assert.equal(cmd.cmd.edits[0].key,'SAS123')
        assert.equal(cmd.cmd.operational.length,0)
    }finally{clearInterval(drive)}
})
test('handover restores aircraft state and accepted slots from checkpoint',async()=>{
    const s=setup(),a=new SharedRelay(options('instance-a'),s.deps(1396125)),b=new SharedRelay(options('instance-b'),s.deps(1234567))
    const first=await a.tick()
    await a.edit(first.revision,{SAS123:{order:0,changedAt:first.snapshot.timestamp}},first.config)
    const held=a.view()
    await a.leave();s.advance(1000)
    const taken=await b.tick()
    assert.equal(taken.relayRole,'sequencer')
    assert.deepEqual(taken.edits,held.edits)
    assert.equal(taken.snapshot.flights[0].firstSeen,held.snapshot.flights[0].firstSeen)
})

test('TopSky missed approach is published to followers and survives sequencer handover',async()=>{
    const s=setup(),a=new SharedRelay(options('instance-a'),s.deps(1396125)),b=new SharedRelay(options('instance-b'),s.deps(1234567))
    await a.tick();await b.tick();s.advance(1000)
    s.setFlights([{...flight(),topskyMissedApproach:true}])
    const missed=await a.tick(),follower=await b.tick()
    assert.equal(missed.edits.SAS123.mode,'missed')
    assert.equal(follower.snapshot.flights[0].mode,'missed')
    assert.equal(s.requests.filter(r=>r.method==='PUT'&&!r.path.endsWith('/settings')).at(-1).body.sequence.sequence.length,0)
    await a.leave();s.advance(1000);s.setFlights([{...flight(),topskyMissedApproach:false}])
    const taken=await b.tick()
    assert.equal(taken.relayRole,'sequencer');assert.equal(taken.snapshot.flights[0].mode,'missed')
})
test('separate channels and exercise resets do not reuse local or other-room history',async()=>{
    const s=setup(),a=new SharedRelay(options('instance-a'),s.deps(1396125))
    await a.tick()
    const isolated=new SharedRelay({...options('instance-b'),channel:'saaman-other'},s.deps(1234567))
    assert.equal((await isolated.tick()).revision,1)
    const before=a.view()
    s.rooms.reset(s.key,{epoch:before.epoch,revision:before.revision})
    s.setFlights([])
    const reset=await a.tick()
    assert.notEqual(reset.epoch,before.epoch);assert.deepEqual(reset.edits,{});assert.deepEqual(reset.snapshot.flights,[])
})
test('uncertain publication retries its identical request ID before recalculating',async()=>{
    const s=setup(),a=new SharedRelay(options('instance-a'),s.deps(1396125))
    s.setFailure('lost-publication')
    await assert.rejects(a.tick(),/Response lost/)
    assert.equal(a.view().snapshot,null)
    s.advance(1000);await a.tick()
    const writes=s.requests.filter(r=>r.method==='PUT')
    assert.deepEqual(writes[0].body,writes[1].body)
    assert.equal(a.view().revision,2)
})
test('backend outage clears display/output eligibility and observers do not calculate',async()=>{
    const s=setup(),a=new SharedRelay(options('instance-a'),s.deps(1396125)),b=new SharedRelay(options('instance-b'),s.deps(1234567))
    await a.tick();await b.setObserver(true);await b.tick()
    assert.equal(b.view().relayRole,'observer')
    assert.equal(s.requests.filter(r=>r.method==='PUT').length,1)
    s.setFailure('offline');await assert.rejects(a.tick(),/Disconnected/);assert.equal(a.view().snapshot,null)
    s.advance(31000);assert.equal(b.view().snapshot,null)
})
test('supervisor settings are saved separately and ordinary edits cannot change them',async()=>{
    const s=setup(),a=new SharedRelay(options('instance-a'),s.deps(1396125))
    const before=await a.tick()
    await assert.rejects(a.edit(before.revision,before.edits,{...before.config,euroscopeBufferMinutes:4}),/supervisory/)
    await assert.rejects(a.edit(before.revision,before.edits,{...before.config,performanceModel:'openap'}),/supervisory/)
    const sup=new SharedRelay(options('supervisor'),s.deps(1396125))
    const observed=await sup.supervision()
    // Ongoing telemetry publications must not make an unchanged settings draft impossible to save.
    s.advance(1000);await a.tick()
    await sup.saveSettings(observed.revision,{euroscopeBufferMinutes:4})
    const updated=await a.tick()
    assert.equal(updated.config.euroscopeBufferMinutes,4)
    assert.equal(updated.snapshot.flights[0].euroscopeBaseline.bufferMinutes,before.snapshot.flights[0].euroscopeBaseline.bufferMinutes,'saving settings preserves accepted aircraft baselines')
    assert.ok(s.requests.some(r=>r.path.endsWith('/settings')))
    const denied=new SharedRelay(options('not-supervisor'),s.deps(1234567))
    await assert.rejects(denied.supervision(),/Supervisor access/)
})
test('controller patches keep their meaning across telemetry publications; stale same-field edits fail',async()=>{
    const s=setup(),a=new SharedRelay(options('instance-a'),s.deps(1396125))
    const before=await a.tick();s.advance(2000);await a.tick()
    const changed=await a.edit(before.revision,{SAS123:{mode:'desequenced'}},before.config)
    assert.equal(changed.edits.SAS123.mode,'desequenced')
    await assert.rejects(a.edit(before.revision,{SAS123:{mode:'removed'}},before.config),/Aircraft edit changed/)
})

test('leaving drains an in-flight publication before releasing the sequencer',async()=>{
    const s=setup(),deps=s.deps(1396125),send=deps.send
    let unblock,started
    const blocked=new Promise(resolve=>unblock=resolve),publishing=new Promise(resolve=>started=resolve)
    deps.send=async(method,path,body)=>{if(method==='PUT'&&!path.endsWith('/settings')){started();await blocked}return send(method,path,body)}
    const a=new SharedRelay(options('instance-a'),deps),b=new SharedRelay(options('instance-b'),s.deps(1234567))
    const tick=a.tick();await publishing
    const leaving=a.leave()
    assert.equal(s.requests.some(r=>r.path.endsWith('/leave')),false)
    unblock();await tick;await leaving
    assert.ok(s.requests.at(-1).path.endsWith('/leave'))
    assert.equal(a.view().snapshot,null)
    assert.equal((await b.tick()).relayRole,'sequencer')
})

test('shared manual placeholder is removed from the checkpoint once live telemetry takes over, including sequencer reload',async()=>{
 const s=setup(),a=new SharedRelay(options('manual-owner'),s.deps(1396125)),first=await a.tick()
 const reserve={callsign:'CCA911',aircraft:'UNKN',wake:'?',runway:'ESSA/19R',feeder:'ELTOK',eta:first.snapshot.timestamp+1800000}
 let state=await a.edit(first.revision,first.edits,{...first.config,manualFlights:[reserve]})
 assert.ok(state.snapshot.flights.some(f=>f.callsign==='CCA911'&&f.aircraft==='UNKN'))
 s.advance(2000);s.setFlights([flight(),{...flight(),callsign:'CCA911',aircraft:'B77W',wake:'H'}])
 state=await a.tick();assert.deepEqual(state.config.manualFlights,[])
 assert.equal(state.snapshot.flights.filter(f=>f.callsign==='CCA911').length,1)
 assert.equal(state.snapshot.flights.find(f=>f.callsign==='CCA911').aircraft,'B77W')
 const published=s.requests.filter(r=>r.method==='PUT').at(-1).body
 assert.deepEqual(published.checkpoint.operational.manualFlights,[])
 s.advance(2000);s.setFlights([flight()]);await a.tick();await a.leave()
 const b=new SharedRelay(options('manual-reloaded'),s.deps(1396125));s.advance(2000)
 const restored=await b.tick();assert.deepEqual(restored.config.manualFlights,[])
 assert.ok(!restored.snapshot.flights.some(f=>f.callsign==='CCA911'))
 assert.ok(!restored.snapshot.diagnostics.some(message=>message.includes('CCA911')))
})
