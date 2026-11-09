import test from 'node:test'
import assert from 'node:assert/strict'
import {SharedRelay} from '../src/shared-relay.ts'
import {LegacyRelay} from '../src/legacy-relay.ts'

const clone=value=>JSON.parse(JSON.stringify(value))
const fail=(message,status)=>{throw Object.assign(new Error(message),{status})}

// Independent callsign-API contract, with the real desktop adapters driving
// publications. Browser requests are recorded separately from desktop traffic.
function room(start=Date.UTC(2026,10,8,12)){
 let now=start,serial=0,version=0,sequence=null,owner='',seen=0,nextCommand=0
 let commands=[],onCommand=async()=>{},browserReadError='',loseCommandResponse=false,allowStaleGet=false
 const requests=[],results=new Map()
 const alive=()=>owner&&now-seen<8000
 const send=async(client,method,path,body)=>{
  requests.push({client,method,path,body:body&&clone(body)})
  assert.match(path,/^\/aman\/sweatbox1\/ESSA(?:\/(?:poll|command|leave))?$/)
  if(method==='GET'){
   if(client.startsWith('browser')&&browserReadError)fail(browserReadError,browserReadError==='Not found'?404:503)
   if(!sequence||!allowStaleGet&&now-sequence.saamanRelay.publishedAt>=30000)fail('Not found',404)
   return clone(sequence)
  }
  if(path.endsWith('/command')){
   if(!alive())fail('No sequencer',503)
   const id=++nextCommand
   commands.push({id,from:body.callsign,cmd:clone(body.cmd),...(body.takeSequencer?{takeSequencer:true}:{})})
   await onCommand()
   if(loseCommandResponse){loseCommandResponse=false;fail('Response lost',503)}
   return {id}
  }
  if(path.endsWith('/leave')){if(owner===body.callsign)owner='';return {left:true}}
  if(!alive())owner=body.callsign
  if(path.endsWith('/poll')){
   if(owner===body.callsign)seen=now
   const out={role:owner===body.callsign?'sequencer':'editor',sequencer:owner,version,
    users:owner?[owner]:[],sequence:sequence&&clone(sequence),commands:owner===body.callsign?clone(commands):[],results:results.get(body.callsign)||[]}
   results.delete(body.callsign)
   return out
  }
  assert.equal(method,'PUT')
  if(owner!==body.callsign)fail('Another sequencer',409)
  if(body.expectedVersion!==undefined&&body.expectedVersion!==version)fail('Stale publication',409)
  seen=now;sequence=clone(body.sequence);version++
  commands=commands.filter(c=>c.id>(body.cmdAck||0))
  for(const result of body.results||[])results.set(result.from,[...(results.get(result.from)||[]),clone(result)])
  return {version}
 }
 const client=(id,call='ESSA_FMP',editorOnly=false)=>{
  let telemetryError='',connectionType=1
  const options={network:'sweatbox1',session:'ignored-exercise',channel:'saaman',instanceId:id}
  const telemetry=async()=>{
   if(telemetryError)fail(telemetryError,401)
   return {source:call,connected:true,connectionType,simulation:true,timestamp:now,
    activeRunways:{arrivals:['ESSA/01R'],departures:['ESSA/01L']},
    flights:editorOnly?[]:[{callsign:'SAS123',aircraft:'A320',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'01R',
     route:[{name:'ELTOK',seconds:800}],landingSeconds:1400,distanceNm:100,groundspeed:250,altitude:15000}]}
  }
  const legacy=new LegacyRelay({network:'sweatbox1',instanceId:id,editorOnly,send:(...args)=>send(id,...args),
   callsign:()=>call,cid:()=>1396125,supervisor:async()=>false,now:()=>now,requestId:()=>`legacy-${++serial}`})
  const relay=new SharedRelay(options,{editorOnly,telemetry,cid:()=>1396125,now:()=>now,requestId:()=>`command-${++serial}`,
   send:(...args)=>legacy.send(...args)})
  return {relay,legacy,telemetry,options,setTelemetryError:value=>telemetryError=value,setConnectionType:value=>connectionType=value}
 }
 return {client,send,requests,now:()=>now,advance:ms=>now+=ms,onCommand:fn=>onCommand=fn,
  readError:value=>browserReadError=value,loseNextCommandResponse:()=>loseCommandResponse=true,
  allowStaleGet:value=>allowStaleGet=value,state:()=>clone({sequence,owner,version,commands}),
  reset:()=>{sequence=null;owner='';version=0;seen=0;commands=[];results.clear()}}
}
const browserRequests=r=>r.requests.filter(q=>q.client.startsWith('browser'))
const commands=r=>browserRequests(r).filter(q=>q.path.endsWith('/command'))
function noAuthorityRequests(r){
 assert.ok(browserRequests(r).every(q=>q.method==='GET'||q.method==='POST'&&q.path.endsWith('/command')))
 assert.ok(browserRequests(r).every(q=>!q.path.endsWith('/poll')&&!q.path.endsWith('/leave')&&q.method!=='PUT'))
}

test('browser sharing the desktop callsign stays editor even when telemetry claims a direct connection',async()=>{
 const r=room(),desktop=r.client('desktop'),browser=r.client('browser-tablet','ESSA_FMP',true)
 const published=await desktop.relay.tick(),first=await browser.relay.tick()
 assert.equal(first.relayRole,'editor');assert.deepEqual(first.snapshot,clone(published.snapshot))
 assert.ok(first.snapshot.flights.length,'browser receives the desktop picture although its identity telemetry has no flights')
 assert.equal((await browser.relay.setObserver(false)).relayRole,'editor')
 browser.setConnectionType(0);await browser.relay.tick();browser.setConnectionType(1);await browser.relay.tick()
 const version=r.state().version
 await browser.relay.leave()
 assert.equal(r.state().owner,'ESSA_FMP');assert.equal(r.state().version,version)
 assert.equal((await desktop.relay.tick()).relayRole,'sequencer')
 noAuthorityRequests(r)
})

test('editor-only legacy adapter ignores forged proxy flags and strips both takeover fields',async()=>{
 const r=room(),desktop=r.client('desktop'),browser=r.client('browser-direct','ESOS_1_CTR',true)
 await desktop.relay.tick()
 const path='/aman/rooms/sweatbox1/ESSA/ignored-exercise/saaman'
 const adopted=await browser.legacy.send('POST',path+'/poll',{callsign:'ESOS_1_CTR',proxy:false,observer:false})
 assert.equal(adopted.role,'editor')
 await browser.legacy.send('POST',path+'/command',{callsign:'ESOS_1_CTR',epoch:adopted.epoch,requestId:'forged-takeover',
  proxy:false,takeSequencer:true,cmd:{op:'plan',takeSequencer:true,edits:[],operational:[]}})
 const submitted=commands(r).at(-1).body
 assert.equal(submitted.takeSequencer,undefined);assert.equal(submitted.cmd.cmd.takeSequencer,undefined)
 await assert.rejects(browser.legacy.send('PUT',path,{callsign:'ESOS_1_CTR',proxy:false}),/browser|publish|calculate/i)
 await browser.legacy.send('POST',path+'/leave',{callsign:'ESOS_1_CTR',proxy:false})
 assert.equal(r.state().owner,'ESSA_FMP');noAuthorityRequests(r)
})

test('browser changes are acknowledged through the native publisher without stealing its same-callsign results',async()=>{
 const r=room(),desktop=r.client('desktop'),browser=r.client('browser-tablet','ESSA_FMP',true)
 await desktop.relay.tick();const base=await browser.relay.tick()
 r.onCommand(()=>desktop.relay.tick())
 const next={...base.edits,SAS123:{mode:'desequenced',changedAt:r.now()}}
 const updated=await browser.relay.edit(base.revision,next,base.config,true)
 assert.equal(updated.relayRole,'editor');assert.equal(updated.snapshot.flights[0].mode,'desequenced')
 assert.equal(updated.edits.SAS123.mode,'desequenced');assert.equal(r.state().owner,'ESSA_FMP')
 const submitted=commands(r).at(-1).body
 assert.equal(submitted.takeSequencer,undefined);assert.equal(submitted.cmd.cmd.takeSequencer,undefined)
 assert.equal(r.state().sequence.saamanRelay.receipts[submitted.cmd.requestId].ok,true)
 assert.ok(r.requests.some(q=>q.client==='desktop'&&q.method==='PUT'&&q.body.results.length))
 noAuthorityRequests(r)
})

test('uncertain browser coordination retries its command ID and the native publisher applies it once',async()=>{
 const r=room(),desktop=r.client('desktop'),browser=r.client('browser-tablet','ESSA_FMP',true)
 await desktop.relay.tick();await browser.relay.tick();r.onCommand(()=>desktop.relay.tick())
 r.loseNextCommandResponse()
 await assert.rejects(browser.relay.coordinate('Update finished'),/Response lost/)
 const recovered=await browser.relay.tick()
 assert.equal(recovered.config.coordinations.length,1)
 assert.equal(recovered.config.coordinations[0].sender,'browser-tablet')
 const submitted=commands(r)
 assert.equal(submitted.length,2);assert.equal(submitted[0].body.cmd.requestId,submitted[1].body.cmd.requestId)
 assert.equal(r.state().owner,'ESSA_FMP');noAuthorityRequests(r)
})

test('recognized missing public sequence invalidates a recent browser cache before edits or coordination',async()=>{
 const r=room(),desktop=r.client('desktop'),browser=r.client('browser-tablet','ESSA_FMP',true)
 await desktop.relay.tick();const base=await browser.relay.tick();r.advance(1000)
 r.readError('Not found')
 await assert.rejects(browser.relay.edit(base.revision,{...base.edits,SAS123:{mode:'desequenced'}},base.config),/fresh|current|unavailable|waiting/i)
 await assert.rejects(browser.relay.coordinate('Update finished'),/fresh|current|unavailable|waiting/i)
 assert.equal(browser.relay.view().snapshot,null);assert.equal(commands(r).length,0);noAuthorityRequests(r)
})

test('successful HTTP reads containing an old publication still cannot enable browser changes',async()=>{
 const r=room(),desktop=r.client('desktop'),browser=r.client('browser-tablet','ESSA_FMP',true)
 await desktop.relay.tick();const base=await browser.relay.tick();r.advance(31000);r.allowStaleGet(true)
 await assert.rejects(browser.relay.edit(base.revision,{...base.edits,SAS123:{mode:'desequenced'}},base.config),/fresh|current|unavailable|waiting/i)
 await assert.rejects(browser.relay.coordinate('Update finished'),/fresh|current|unavailable|waiting/i)
 assert.equal(browser.relay.view().snapshot,null);assert.equal(commands(r).length,0);noAuthorityRequests(r)
})

test('a browser cannot send a placement drafted before the shared epoch reset',async()=>{
 const r=room(),desktop=r.client('desktop'),browser=r.client('browser-tablet','ESSA_FMP',true)
 await desktop.relay.tick();const base=await browser.relay.tick()
 r.reset();r.advance(1000);const replacement=r.client('desktop-restarted')
 const restored=await replacement.relay.tick();assert.notEqual(restored.epoch,base.epoch)
 await assert.rejects(browser.relay.edit(base.revision,{...base.edits,SAS123:{mode:'desequenced'}},base.config),/reset|changed|reload|retry/i)
 assert.equal(commands(r).length,0);assert.equal(r.state().sequence.saamanRelay.checkpoint.snapshot.flights[0].mode,'sequenced')
 noAuthorityRequests(r)
})

test('browser identity verification failure prevents edits before any backend command is sent',async()=>{
 const r=room(),desktop=r.client('desktop'),browser=r.client('browser-tablet','ESSA_FMP',true)
 await desktop.relay.tick();const base=await browser.relay.tick(),before=browserRequests(r).length
 browser.setTelemetryError('Controller is no longer online')
 await assert.rejects(browser.relay.edit(base.revision,{...base.edits,SAS123:{mode:'desequenced'}},base.config),/no longer online/)
 await assert.rejects(browser.relay.coordinate('Update finished'),/no longer online/)
 assert.equal(browserRequests(r).length,before);assert.equal(commands(r).length,0);noAuthorityRequests(r)
})

test('a browser opened for a tower callsign remains read only and cannot release the direct controller',async()=>{
 const r=room(),desktop=r.client('desktop'),tower=r.client('browser-tower','ESSA_1__TWR',true)
 await desktop.relay.tick();const base=await tower.relay.tick()
 assert.equal(base.relayRole,'observer')
 await assert.rejects(tower.relay.edit(base.revision,base.edits,base.config),/Tower positions are observers/)
 await assert.rejects(tower.relay.coordinate('Update finished'),/Tower positions are observers/)
 await tower.relay.setObserver(false);await tower.relay.leave()
 assert.equal(r.state().owner,'ESSA_FMP');assert.equal(commands(r).length,0);noAuthorityRequests(r)
})

test('browser transport polling never calls the native timing writer, including lost identity',async()=>{
 const r=room(Date.now()),desktop=r.client('desktop'),identity=r.client('browser-adapter','ESSA_FMP',true)
 await desktop.relay.tick()
 const saved={window:globalThis.window,location:globalThis.location,require:globalThis.require,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval}
 const window=new EventTarget(),intervals=[],nativeCalls=[]
 window.fetch=async()=>{throw Error('A browser editor must not contact a local EuroScope bridge')}
 globalThis.window=window;globalThis.location={origin:'https://saaman.example'}
 globalThis.setInterval=callback=>{intervals.push(callback);return intervals.length}
 globalThis.clearInterval=()=>{}
 // Bundled Axios' Node adapter can load built-ins while the selected HTTP
 // adapter below remains entirely in memory; no network listener is used.
 const {createRequire}=await import('node:module')
 globalThis.require=createRequire(import.meta.url)
 let axios,rpc,adapter
 try{
  axios=(await import('axios')).default;adapter=axios.defaults.adapter
  axios.defaults.adapter=async config=>{
   const url=new URL(config.url),body=typeof config.data==='string'?JSON.parse(config.data):config.data
   return {status:200,statusText:'OK',headers:{},config,data:await r.send('browser-adapter',String(config.method).toUpperCase(),url.pathname,body)}
  }
  rpc=await import('../src/native-rpc.ts')
  const host={browser:true,shared:true,view:'aman',authProvider:'vatiris-callsign',backendBaseUrl:'https://backend.example',instanceId:'browser-adapter',relay:identity.options}
  rpc.configureNativeRequestHandler(async(method,data)=>{
   nativeCalls.push({method,data})
   if(method==='host:info')return host
   if(method==='telemetry:get')return identity.telemetry()
   throw Error('Unexpected native method '+method)
  })
  const transport=await import('../src/native-transport.ts')
  let ready=true
  transport.configureRelayAuth(()=>({ready,callsign:'ESSA_FMP',cid:1396125,token:'',headers:{}}))
  await transport.installNativeTransport()
  const plan=(await axios.get('https://backend.example/maestro/ESSA')).data
  assert.equal(plan.relayRole,'editor');assert.ok(plan.snapshot.flights.length)
  assert.equal(intervals.length,1)
  intervals[0]()
  for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve))
  ready=false;intervals[0]()
  for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve))
  assert.equal(nativeCalls.filter(c=>c.method==='timing:set').length,0,'no attempted SDK write is hidden behind a browser no-op handler')
  assert.ok(nativeCalls.every(c=>['host:info','telemetry:get'].includes(c.method)))
  ready=true;await transport.leaveSharedRoom()
  assert.equal(r.state().owner,'ESSA_FMP');noAuthorityRequests(r)
 }finally{
  window.dispatchEvent(new Event('beforeunload'))
  for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve))
  rpc?.configureNativeRequestHandler(undefined)
  if(axios)axios.defaults.adapter=adapter
  for(const [name,value] of Object.entries(saved)){if(value===undefined)delete globalThis[name];else globalThis[name]=value}
 }
})
