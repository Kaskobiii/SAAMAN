import test from 'node:test'
import assert from 'node:assert/strict'
import {saveConnectionSettings} from '../src/maestro-connection.ts'
const current={shared:true,backendBaseUrl:'https://backend.vatiris.se',authProvider:'vatiris-callsign',controllerCid:0,relay:{network:'live',session:'live',channel:'saaman'}}
function actions(failure=''){
 const calls=[]
 return {calls,persist:async()=>{calls.push('persist');if(failure==='persist')throw new Error('Cannot save settings');return {changed:failure!=='unchanged'}},leave:async()=>{calls.push('leave');if(failure==='leave')throw new Error('Backend unavailable')},reload:()=>calls.push('reload')}
}
test('saving unchanged connection leaves the active relay and view intact',async()=>{
 const a=actions();assert.equal(await saveConnectionSettings(current,structuredClone(current),'',a),false);assert.deepEqual(a.calls,[])
})
test('failure to save connection cannot stop the current relay',async()=>{
 const a=actions('persist');await assert.rejects(saveConnectionSettings(current,{...current,relay:{...current.relay,network:'sweatbox1'}},'',a),/Cannot save/);assert.deepEqual(a.calls,['persist'])
})
test('changed connection persists before leaving/reloading and tolerates an unavailable old backend',async()=>{
 for(const failure of ['', 'leave']){const a=actions(failure);assert.equal(await saveConnectionSettings(current,{...current,controllerCid:1396125},'',a),true);assert.deepEqual(a.calls,['persist','leave','reload'])}
})
test('native unchanged result also avoids disconnecting after a credential/settings check',async()=>{
 const a=actions('unchanged');assert.equal(await saveConnectionSettings(current,current,'test-key',a),false);assert.deepEqual(a.calls,['persist'])
})
