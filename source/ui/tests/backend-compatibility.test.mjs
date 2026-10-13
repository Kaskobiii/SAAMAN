import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import {createRequire} from 'node:module'
import {SharedRelay} from '../src/shared-relay.ts'
import {LegacyRelay} from '../src/legacy-relay.ts'

const load=createRequire(import.meta.url)
async function fixture(){
    const originalNow=Date.now,originalInterval=globalThis.setInterval,originalRequireAtc=process.env.AMAN_REQUIRE_ATC,originalKey=process.env.AMAN_SWEATBOX_KEY
    let clock=originalNow();const timers=[],requests=[],feed={requests:0,unavailable:false,controllers:[{callsign:'ESSA_FMP',facility:6},{callsign:'ESOS_1__CTR',facility:6},{callsign:'ESSA_W_APP',facility:5},{callsign:'TEST_OBS',facility:0}]}
    Date.now=()=>clock;globalThis.__SAAMAN_VATIRIS_TEST_FEED__=feed
    process.env.AMAN_REQUIRE_ATC='1';delete process.env.AMAN_SWEATBOX_KEY
    globalThis.setInterval=(...args)=>{const timer=originalInterval(...args);timer.unref();timers.push(timer);return timer}
    delete load.cache[load.resolve(__VATIRIS_ROUTER__)]
    let router
    try{router=load(__VATIRIS_ROUTER__).default}finally{globalThis.setInterval=originalInterval}
    const app=express();app.use(express.json({limit:'2mb'}));app.use('/aman',router)
    const server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)})
    const root=`http://127.0.0.1:${server.address().port}`;let lost=''
    async function raw(method,path,body){
        assert.match(path,/^\/aman(?:\/|$)/)
        const response=await fetch(root+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)})
        const text=await response.text();let data;try{data=JSON.parse(text)}catch{data=text}
        return {status:response.status,data}
    }
    async function send(method,path,body){
        requests.push({method,path,body:structuredClone(body)})
        const result=await raw(method,path,body)
        if(result.status>=400)throw Object.assign(Error(typeof result.data==='string'?result.data:JSON.stringify(result.data)),{status:result.status})
        if((lost==='command'&&path.endsWith('/command'))||(lost==='publication'&&method==='PUT')){lost='';throw Error('Response lost after server accepted it')}
        return result.data
    }
    function client(id,callsign,cid=null,network='sweatbox1'){
        const bridge=new LegacyRelay({network,instanceId:id,send,callsign:()=>callsign,cid:()=>cid,supervisor:async(_cs,claimed)=>claimed===1396125,now:()=>clock})
        return new SharedRelay({network,session:'not-a-backend-room',channel:'saaman',instanceId:id},{cid:()=>cid,now:()=>clock,send:(method,path,body)=>bridge.send(method,path,body),telemetry:async()=>({timestamp:clock,source:callsign,connected:true,simulation:network!=='live',activeRunways:{arrivals:['ESSA/01R'],departures:['ESSA/01L']},flights:[{callsign:'TEST123',aircraft:'A320',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'01R',route:[{name:'ELTOK',seconds:800}],landingSeconds:1400,distanceNm:100,groundspeed:250,altitude:15000}]})})
    }
    return {client,raw,requests,feed,advance:ms=>clock+=ms,lose:value=>lost=value,async close(){
        server.closeAllConnections();await new Promise(resolve=>server.close(resolve));timers.forEach(clearInterval);Date.now=originalNow;delete globalThis.__SAAMAN_VATIRIS_TEST_FEED__
        if(originalRequireAtc===undefined)delete process.env.AMAN_REQUIRE_ATC;else process.env.AMAN_REQUIRE_ATC=originalRequireAtc
        if(originalKey===undefined)delete process.env.AMAN_SWEATBOX_KEY;else process.env.AMAN_SWEATBOX_KEY=originalKey
    }}
}
test('actual vatIRIS router shares one sequence, edits, coordination metadata/acknowledgement, settings and handover',async()=>{
 const f=await fixture();let drive
 try{
  const a=f.client('a','ESSA_FMP',1396125),b=f.client('b','ESOS_1__CTR'),c=f.client('c','ESSA_W_APP'),supervisor=f.client('a','ESSA_FMP',1396125)
  const first=await a.tick(),second=await b.tick();await c.tick()
  assert.equal(first.relayRole,'sequencer');assert.equal(second.relayRole,'editor');assert.deepEqual(second.snapshot,JSON.parse(JSON.stringify(first.snapshot)))
  assert.deepEqual(second.config.active,['ESSA/01R']);assert.equal(second.config.departureRunway,'ESSA/01L')
  drive=setInterval(()=>void a.tick().catch(()=>{}),25)
  const target=second.snapshot.flights[0].sta+120000;await b.edit(second.revision,{TEST123:{target}},second.config)
  assert.equal((await c.tick()).edits.TEST123.target,target)
  const sent=(await b.coordinate('Update finished')).config.coordinations[0]
  assert.equal(sent.senderCallsign,'ESOS_1__CTR');assert.equal(sent.sender,'b')
  assert.deepEqual((await c.tick()).config.coordinations[0],sent)
  const acknowledged=await c.coordinate(undefined,sent.id)
  assert.ok(acknowledged.config.coordinations[0].acknowledgedBy.includes('c'));assert.equal(acknowledged.config.coordinations[0].at,sent.at)
  await assert.rejects(b.supervision(),/Supervisor access/)
  const base=await supervisor.supervision();await supervisor.saveSettings(base.revision,{euroscopeBufferMinutes:3})
  assert.equal((await b.tick()).config.euroscopeBufferMinutes,3)
  clearInterval(drive);drive=undefined;await a.leave()
  const takeover=await c.tick();assert.equal(takeover.relayRole,'sequencer');assert.equal(takeover.edits.TEST123.target,target)
  assert.equal(takeover.config.coordinations[0].senderCallsign,sent.senderCallsign);assert.equal(takeover.config.coordinations[0].at,sent.at)
  assert.ok(takeover.config.coordinations[0].acknowledgedBy.includes('c'));assert.equal(takeover.config.euroscopeBufferMinutes,3)
  assert.ok(f.requests.every(r=>!r.path.includes('/rooms/')));assert.ok(f.requests.some(r=>r.method==='PUT'&&r.body.sequence.saamanRelay.checkpoint))
 }finally{clearInterval(drive);await f.close()}
})
test('actual router preserves accepted publications and deduplicates coordination after lost responses',async()=>{
 const f=await fixture();try{
  const a=f.client('retry','ESSA_FMP',1396125);f.lose('publication');await assert.rejects(a.tick(),/Response lost/);await a.tick()
  f.lose('command');await assert.rejects(a.coordinate('Snow removal ESSA'),/Response lost/);await a.tick();await a.tick()
  assert.equal(a.view().config.coordinations.length,1);assert.equal(a.view().config.coordinations[0].senderCallsign,'ESSA_FMP')
  const raw=await f.raw('GET','/aman/sweatbox1/ESSA');assert.equal(raw.status,200);assert.equal(raw.data.saamanRelay.checkpoint.operational.coordinations.length,1)
 }finally{await f.close()}
})
test('actual router isolates networks and read-only observation does not claim the sequencer',async()=>{
 const f=await fixture();try{
  const observer=f.client('observer','ESSA_W_APP');await observer.setObserver(true)
  const before=await f.raw('GET','/aman');assert.equal(before.status,200);assert.deepEqual(before.data,{})
  const a=f.client('net1','ESSA_FMP',1396125),b=f.client('net2','ESOS_1__CTR',null,'sweatbox2')
  await a.tick();const initial=await b.tick();assert.equal(initial.relayRole,'sequencer')
  await a.coordinate('Update finished');assert.equal((await b.tick()).config.coordinations.length,0)
  await observer.tick();assert.equal(observer.view().relayRole,'observer')
  f.advance(9000);await observer.tick()
  const after=await f.raw('POST','/aman/sweatbox1/ESSA/poll',{callsign:'ESOS_1__CTR',wait:false,version:0});assert.equal(after.data.role,'sequencer')
 }finally{await f.close()}
})
test('actual live router accepts connected handover callsigns and rejects absent/observer callsigns',async()=>{
 const f=await fixture();try{
  const online=await f.raw('POST','/aman/live/ESSA/poll',{callsign:'ESOS_1__CTR',wait:false,version:0});assert.equal(online.status,200);assert.equal(online.data.sequencer,'ESOS_1__CTR')
  for(const callsign of ['OFFLINE_CTR','TEST_OBS'])assert.equal((await f.raw('POST','/aman/live/ESSA/command',{callsign,cmd:{}})).status,403)
  assert.equal((await f.raw('POST','/aman/live/ESSA/poll',{wait:false})).status,400)
  assert.equal((await f.raw('POST','/aman/unknown/ESSA/poll',{callsign:'ESSA_FMP',wait:false})).status,404)
 }finally{await f.close()}
})
test('actual live router rejects writes when the controller feed is unavailable or stale',async()=>{
 const f=await fixture();try{
  f.feed.unavailable=true;assert.equal((await f.raw('POST','/aman/live/ESSA/poll',{callsign:'ESSA_FMP',wait:false})).status,503)
  f.feed.unavailable=false;assert.equal((await f.raw('POST','/aman/live/ESSA/poll',{callsign:'ESSA_FMP',wait:false})).status,200)
  f.advance(61000);f.feed.unavailable=true
  assert.equal((await f.raw('PUT','/aman/live/ESSA',{callsign:'ESSA_FMP',sequence:{}})).status,503)
 }finally{await f.close()}
})
test('actual router still enforces an optional training key',async()=>{
 const f=await fixture();try{
  process.env.AMAN_SWEATBOX_KEY='test-only-training-key'
  for(const key of [undefined,'wrong'])assert.equal((await f.raw('POST','/aman/sweatbox1/ESSA/poll',{callsign:'ESSA_FMP',key,wait:false})).status,403)
  assert.equal((await f.raw('POST','/aman/sweatbox1/ESSA/poll',{callsign:'ESSA_FMP',key:'test-only-training-key',wait:false})).status,200)
 }finally{await f.close()}
})
