import test from 'node:test'
import assert from 'node:assert/strict'
import {CallsignIdentity,canSequenceEssa,canAutoConnectShared} from '../src/callsign-identity.ts'

test('ESSA sequencer eligibility includes local center, approach, planner and handover positions only',()=>{
 for(const call of ['ESOS_CTR','ESOS_1_CTR','ESOS_3__CTR','ESAA_CTR','ESAA_S__CTR','ESSA_APP','ESSA_W_APP','ESSA_E__APP','ESSA_FMP','esos_1_ctr'])assert.equal(canSequenceEssa(call),true,call)
 for(const call of ['ESMM_2_CTR','ESMM_CTR','ESSB_APP','ESSA_TWR','ESSA_1__TWR','ESOS_OBS','ESAA_FSS','NOTESOS_CTR','ESSA_FMP_OBS',''])assert.equal(canSequenceEssa(call),false,call)
})

test('ESMM shared autoconnect is excluded, including split and handover callsigns',()=>{
 for(const call of ['ESMM','ESMM_CTR','ESMM_2_CTR','ESMM_2__CTR','esmm_3_ctr','ESSA_TWR','ESSA_1__TWR','ESSB_APP','OTHER_OBS','ESOS_OBS'])assert.equal(canAutoConnectShared(call),false,call)
 for(const call of ['ESOS_1_CTR','ESAA_CTR','ESSA_FMP','ESSA_APP'])assert.equal(canAutoConnectShared(call),true,call)
})

test('ESMM waits for explicit connection, then continues refreshing that callsign normally',async()=>{
 const f=setup('sweatbox1');f.raw.source='ESMM_2_CTR'
 await assert.rejects(f.identity.refresh(),/do not connect automatically/)
 assert.equal(f.identity.identity,undefined);assert.equal(f.requests(),0)
 await f.identity.refresh(true);assert.equal(f.identity.identity.callsign,'ESMM_2_CTR')
 f.advance(2000);await f.identity.refresh();assert.equal(f.identity.identity.callsign,'ESMM_2_CTR')
 f.raw.source='ESMM_3_CTR';await assert.rejects(f.identity.refresh(),/do not connect automatically/)
 assert.equal(f.identity.identity,undefined)
 f.raw.source='ESSA_APP';await f.identity.refresh();assert.equal(f.identity.identity.callsign,'ESSA_APP')
})

test('priming from excluded ESMM to ESOS, ESAA or ESSA automatically connects without reloading',async()=>{
 for(const call of ['ESOS_1_CTR','ESAA_CTR','ESSA_APP','ESSA_FMP']){
  const f=setup('sweatbox1');f.raw.source='ESMM_2_CTR'
  await assert.rejects(f.identity.refresh(),/do not connect automatically/)
  f.raw.source=call;f.advance(2000);await f.identity.refresh()
  assert.equal(f.identity.identity.callsign,call)
  f.raw.source='ESMM_2_CTR';await assert.rejects(f.identity.refresh(),/do not connect automatically/)
  assert.equal(f.identity.identity,undefined)
 }
})
function setup(network='live',cid){
    let now=100000,requests=0,fail=false,raw={source:'ESSA_APP',connected:true,timestamp:now,simulation:network!=='live'}
    const identity=new CallsignIdentity({network,cid,now:()=>now,telemetry:async()=>raw,changed:()=>{},controllers:async()=>{requests++;if(fail)throw new Error('Feed unavailable');return {controllers:[{callsign:'ESSA_APP',cid:1396125,facility:5},{callsign:'ESSA_FMP',cid:1396125,facility:6},{callsign:'ESOS_1_CTR',cid:1234567,facility:6},{callsign:'ESOS_1__CTR',cid:2345678,facility:6},{callsign:'OTHER_OBS',cid:2345678,facility:0}]}}})
    return {identity,raw,requests:()=>requests,advance:ms=>{now+=ms;raw.timestamp=now},fail:()=>fail=true}
}
test('live identity matches EuroScope callsign to feed without token or vatIRIS account lookup',async()=>{
    const f=setup('live',2222222);await f.identity.refresh()
    assert.deepEqual(f.identity.identity,{cid:1396125,callsign:'ESSA_APP',supervisor:true})
    await f.identity.refresh();assert.equal(f.requests(),1)
    f.advance(15000);await f.identity.refresh();assert.equal(f.requests(),2)
})
test('SweatBox needs no CID or public feed for ordinary controllers',async()=>{
    const f=setup('sweatbox1');await f.identity.refresh()
    assert.deepEqual(f.identity.identity,{cid:null,callsign:'ESSA_APP',supervisor:false});assert.equal(f.requests(),0)
    assert.equal(await f.identity.isSupervisor('ESSA_APP',1396125),true)
})
test('callsign change rechecks identity and live supervisor commands match the sender',async()=>{
    const f=setup();await f.identity.refresh();f.raw.source='ESOS_1_CTR';await f.identity.refresh()
    assert.equal(f.identity.identity.cid,1234567);assert.equal(f.identity.identity.supervisor,false)
    assert.equal(await f.identity.isSupervisor('ESOS_1_CTR',1396125),false)
    assert.equal(await f.identity.isSupervisor('ESSA_APP',1234567),true)
})
test('disconnect, stale data, missing ATC, and feed failure clear identity',async()=>{
    const f=setup();await f.identity.refresh();f.raw.connected=false
    await assert.rejects(f.identity.refresh(),/connected EuroScope/);assert.equal(f.identity.identity,undefined)
    f.raw.connected=true;f.raw.timestamp=0;await assert.rejects(f.identity.refresh(),/connected EuroScope/)
    f.advance(1);f.raw.source='OTHER_OBS';await assert.rejects(f.identity.refresh(true),/not in the VATSIM ATC feed/)
    f.raw.source='ESSA_APP';await f.identity.refresh();f.advance(15000);f.fail()
    await assert.rejects(f.identity.refresh(),/Feed unavailable/);assert.equal(f.identity.identity,undefined)
})
test('simulator sessions cannot use live mode',async()=>{
    const f=setup();f.raw.simulation=true;await assert.rejects(f.identity.refresh(),/Select SweatBox/);assert.equal(f.requests(),0)
})
test('ESSA_FMP is accepted as an online center planner without a CTR suffix',async()=>{
 const f=setup();f.raw.source='ESSA_FMP';await f.identity.refresh();assert.equal(f.identity.identity.callsign,'ESSA_FMP');assert.equal(f.identity.identity.cid,1396125)
})
test('handover identity keeps the exact callsign used by VATSIM',async()=>{
 const f=setup();f.raw.source='ESOS_1__CTR';await f.identity.refresh();assert.equal(f.identity.identity.callsign,'ESOS_1__CTR');assert.equal(f.identity.identity.cid,2345678)
})

test('background identity waiting before login recovers on login and reconnect without a manual login action',async()=>{
 const f=setup();f.raw.connected=false;f.raw.source='OFFLINE'
 await assert.rejects(f.identity.refresh(),/connected EuroScope/);assert.equal(f.identity.identity,undefined);assert.equal(f.requests(),0)
 f.raw.connected=true;f.raw.source='ESOS_1__CTR';f.advance(8000);await f.identity.refresh()
 assert.equal(f.identity.identity.callsign,'ESOS_1__CTR')
 f.raw.connected=false;await assert.rejects(f.identity.refresh(),/connected EuroScope/);assert.equal(f.identity.identity,undefined)
 f.raw.connected=true;f.raw.source='ESSA_FMP';f.advance(8000);await f.identity.refresh()
 assert.equal(f.identity.identity.callsign,'ESSA_FMP');assert.equal(f.identity.identity.cid,1396125)
})


test('tower login cannot gain supervision from its controller CID',async()=>{
 const f=setup('sweatbox1',1396125);f.raw.source='ESSA_1__TWR';await assert.rejects(f.identity.refresh(),/do not connect automatically/);await f.identity.refresh(true)
 assert.equal(await f.identity.isSupervisor('ESSA_1__TWR',1396125),false)
})
