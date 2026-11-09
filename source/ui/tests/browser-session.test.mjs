import {test} from 'node:test'
import assert from 'node:assert/strict'
import {BROWSER_CONNECTION_KEY,BROWSER_DEFAULT_CONNECTION,browserConnection,loadBrowserConnection,saveBrowserConnection,createBrowserSession} from '../src/browser-session.ts'

const settings={callsign:'ESSA_FMP',network:'live',backendBaseUrl:'https://backend.vatiris.se'}
const controller=(callsign='ESSA_FMP',cid=1234567)=>({callsign,cid,facility:5})

test('browser connections normalize callsigns and allow only supported backend origins and networks',()=>{
 assert.deepEqual(browserConnection({...settings,callsign:'  esos_1__ctr ',backendBaseUrl:'https://backend.vatiris.se/'}),{...settings,callsign:'ESOS_1__CTR'})
 for(const backendBaseUrl of ['javascript:alert(1)','https://name:secret@backend.vatiris.se','https://backend.vatiris.se/path','https://backend.vatiris.se/?token=secret','http://remote.example','https://backend.vatiris.se/#secret'])assert.throws(()=>browserConnection({...settings,backendBaseUrl}),backendBaseUrl)
 assert.equal(browserConnection({...settings,backendBaseUrl:'http://localhost:5172'}).backendBaseUrl,'http://localhost:5172')
 for(const callsign of ['', 'DEMO','OFFLINE','ESSA FMP','<script>','A'.repeat(21)])assert.throws(()=>browserConnection({...settings,callsign}))
 assert.throws(()=>browserConnection({...settings,network:'training'}))
})

test('browser preferences contain connection details without retaining identity claims or credentials',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}
 saveBrowserConnection(storage,{...settings,cid:1234567,token:'secret',controllerKey:'secret'})
 assert.deepEqual(JSON.parse(values.get(BROWSER_CONNECTION_KEY)),settings)
 assert.deepEqual(loadBrowserConnection(storage),settings)
 values.set(BROWSER_CONNECTION_KEY,'broken json');assert.deepEqual(loadBrowserConnection(storage),BROWSER_DEFAULT_CONNECTION)
 assert.deepEqual(loadBrowserConnection({getItem(){throw Error('Blocked storage')}}),BROWSER_DEFAULT_CONNECTION)
})

test('a browser exposes only a proxy identity and never supplies aircraft or active-runway telemetry',async()=>{
 let at=1000,requests=0
 const session=createBrowserSession(settings,{now:()=>at,id:()=> 'unique-editor',controllers:async()=>{requests++;return {controllers:[controller(),controller('ESSA_E_APP',2345678),{callsign:'UNVERIFIED',cid:999,facility:0}]}}})
 const info=await session.hostInfo(),telemetry=await session.telemetry()
 assert.equal(requests,1);assert.equal(info.browser,true);assert.equal(info.shared,true);assert.equal(info.authProvider,'vatiris-callsign');assert.equal(info.controllerCid,1234567)
 assert.equal(info.instanceId,'browser-unique-editor');assert.equal(info.view,'aman');assert.equal(info.relay.network,'live')
 assert.equal(telemetry.source,'ESSA_FMP');assert.equal(telemetry.connectionType,2);assert.equal(telemetry.connected,true);assert.equal(telemetry.simulation,false)
 assert.deepEqual(telemetry.flights,[]);assert.equal(telemetry.activeRunways,undefined)
 assert.deepEqual(telemetry.controllers.map(c=>c.callsign),['ESSA_FMP','ESSA_E_APP'])
 at+=2000;assert.equal((await session.telemetry()).timestamp,at)
})

test('concurrent browser identity reads share one feed check and revalidate after fifteen seconds',async()=>{
 let at=0,requests=0,resolve
 const session=createBrowserSession(settings,{now:()=>at,id:()=> 'concurrent',controllers:()=>{requests++;return new Promise(r=>resolve=r)}})
 const first=session.identity(),second=session.telemetry(),third=session.hostInfo()
 await Promise.resolve();assert.equal(requests,1);resolve({controllers:[controller()]})
 await Promise.all([first,second,third]);assert.equal(requests,1)
 at=14999;await session.identity();assert.equal(requests,1)
 at=15000;const refresh=session.telemetry();await Promise.resolve();assert.equal(requests,2);resolve({controllers:[controller()]});await refresh
})

test('offline callsigns and feed failures cannot keep a browser identity ready from its old cached response',async()=>{
 let at=0,feed={controllers:[controller()]},failure=false,requests=0
 const session=createBrowserSession(settings,{now:()=>at,id:()=> 'refresh',controllers:()=>{requests++;if(failure)throw Error('Feed unavailable');return Promise.resolve(feed)}})
 assert.equal((await session.identity()).cid,1234567)
 at=15000;feed={controllers:[]};await assert.rejects(session.telemetry(),/not connected as ATC/)
 failure=true;await assert.rejects(session.identity(),/Feed unavailable/)
 failure=false;feed={controllers:[controller()]};assert.equal((await session.telemetry()).source,'ESSA_FMP')
 assert.equal(requests,4,'a synchronous fetch failure is retryable instead of retaining a rejected promise')
})

test('a different controller taking the same callsign requires an explicit browser reconnect',async()=>{
 let at=0,cid=1234567
 const session=createBrowserSession(settings,{now:()=>at,id:()=> 'handover',controllers:async()=>({controllers:[controller('ESSA_FMP',cid)]})})
 await session.identity();at=15000;cid=2345678
 await assert.rejects(session.telemetry(),/changed controller/)
 cid=1234567;await assert.rejects(session.identity(),/changed controller/)
})

test('SweatBox browser sessions stay proxy editors without requiring a VATSIM feed or claiming a CID',async()=>{
 let requests=0
 const session=createBrowserSession({...settings,network:'sweatbox2'},{id:()=> 'training',controllers:async()=>{requests++;throw Error('Should not query live network')}})
 const t=await session.telemetry(),info=await session.hostInfo()
 assert.equal(requests,0);assert.equal(t.simulation,true);assert.equal(t.connectionType,2);assert.equal(info.controllerCid,0);assert.equal(info.relay.network,'sweatbox2')
})

test('an invalid controller-feed shape cannot admit an arbitrary browser callsign',async()=>{
 const session=createBrowserSession(settings,{id:()=> 'invalid-feed',controllers:async()=>({controllers:{ESSA_FMP:1234567}})})
 await assert.rejects(session.identity(),/controller feed is unavailable/)
})
