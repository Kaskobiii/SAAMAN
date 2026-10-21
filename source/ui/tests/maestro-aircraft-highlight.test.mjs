import {test,afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {createAircraftHighlight} from '../src/maestro-aircraft-highlight.ts'

const activeStates=[]
afterEach(()=>{for(const state of activeStates.splice(0))state.dispose()})
function setup(request){
 const calls=[],selections=[],hovers=[]
 const state=createAircraftHighlight((method,data)=>{calls.push({method,data});return request?.(method,data)??Promise.resolve({callsign:'SAS123'})},value=>selections.push(value),value=>hovers.push(value))
 activeStates.push(state)
 return {state,calls,selections,hovers}
}

test('local radar selection highlights a callsign without changing AMAN placement or sending hover/plan commands',async()=>{
 const {state,calls,selections}=setup()
 await state.loadSelection();assert.deepEqual(selections,['SAS123'])
 state.receiveSelection('RYR456');assert.deepEqual(selections,['SAS123','RYR456'])
 state.receiveSelection('');assert.equal(selections.at(-1),'')
 assert.deepEqual(calls,[{method:'host:aircraft-selection',data:undefined}])
})

test('a newer native selection event wins over a delayed initial request',async()=>{
 let finish
 const {state,selections}=setup(()=>new Promise(resolve=>finish=resolve))
 const pending=state.loadSelection();state.receiveSelection('NEW456')
 finish({callsign:'OLD123'});await pending
 assert.deepEqual(selections,['NEW456'])
})

test('hover renews only while active and clears immediately on leaving that aircraft',()=>{
 const {state,calls,hovers}=setup()
 state.hover('SAS123');state.hover('SAS123');assert.equal(calls.length,1)
 state.refresh();assert.equal(calls.length,2);assert.equal(calls.at(-1).data.renew,true)
 state.leave('RYR456');assert.equal(calls.length,2)
 state.leave('SAS123');assert.equal(calls.at(-1).data.callsign,'')
 state.refresh();assert.equal(calls.length,3);assert.deepEqual(hovers,['SAS123',''])
 assert.ok(calls.every(c=>c.method==='host:aircraft-hover'))
})

test('moving between callsigns cannot let a late leave event clear the new radar highlight',()=>{
 const {state,calls,hovers}=setup()
 state.hover('SAS123');state.hover('RYR456');state.leave('SAS123')
 assert.equal(calls.at(-1).data.callsign,'RYR456');assert.deepEqual(hovers,['SAS123','RYR456'])
 state.leave('RYR456');assert.equal(calls.at(-1).data.callsign,'')
})

test('callsigns are bounded and normalized before native visual requests',()=>{
 const {state,calls,selections}=setup()
 state.hover(' sas123 ');assert.equal(calls.at(-1).data.callsign,'SAS123')
 state.hover('A'.repeat(17));assert.equal(calls.at(-1).data.callsign,'')
 state.receiveSelection({callsign:'SAS123'});state.receiveSelection('<script>');assert.deepEqual(selections,[])
 state.receiveSelection(' esa_01 ');assert.equal(selections.at(-1),'ESA_01')
})

test('a failed local bridge remains optional and never sends backend or controller edits',async()=>{
 const {state,calls}=setup(()=>Promise.reject(new Error('Not connected')))
 state.hover('SAS123');state.refresh();state.clear();await state.loadSelection()
 await Promise.resolve()
 assert.deepEqual(calls.map(c=>c.method),['host:aircraft-hover','host:aircraft-hover','host:aircraft-hover','host:aircraft-selection'])
})

test('disposing clears the temporary highlight and ignores later selections, refreshes and late reads',async()=>{
 let finish
 const {state,calls,selections}=setup(method=>method==='host:aircraft-selection'?new Promise(resolve=>finish=resolve):Promise.resolve({}))
 state.hover('SAS123');const pending=state.loadSelection();state.dispose()
 const count=calls.length;state.refresh();state.hover('RYR456');state.receiveSelection('RYR456');state.dispose()
 finish({callsign:'OLD123'});await pending
 assert.equal(calls.length,count);assert.equal(calls.at(-1).data.callsign,'');assert.deepEqual(selections,[''])
})

test('native lease rejection clears the hover instead of resurrecting it after hide or reconnect',async()=>{
 const {state,calls,hovers}=setup((method,data)=>Promise.resolve(data?.renew?false:true))
 state.hover('SAS123');state.refresh();await Promise.resolve();await Promise.resolve()
 assert.equal(hovers.at(-1),'');assert.equal(calls.at(-1).data.callsign,'')
 const count=calls.length;state.refresh();assert.equal(calls.length,count)
})

test('a rejected old renewal cannot clear a newer hover',async()=>{
 let finish
 const {state,calls,hovers}=setup((method,data)=>data?.renew?new Promise(resolve=>finish=resolve):Promise.resolve(true))
 state.hover('SAS123');state.refresh();state.hover('RYR456')
 finish(false);await Promise.resolve();await Promise.resolve()
 assert.equal(hovers.at(-1),'RYR456');assert.equal(calls.at(-1).data.callsign,'RYR456')
})

test('the AMAN callsign box expires after three seconds and repeated selection reports do not renew it',t=>{
 t.mock.timers.enable({apis:['setTimeout']})
 const {state,selections,calls}=setup()
 state.receiveSelection('SAS123');t.mock.timers.tick(2000)
 state.receiveSelection('SAS123');t.mock.timers.tick(999)
 assert.equal(selections.at(-1),'SAS123')
 t.mock.timers.tick(1);assert.equal(selections.at(-1),'')
 state.receiveSelection('SAS123');t.mock.timers.tick(3000)
 assert.deepEqual(selections,['SAS123','']);assert.deepEqual(calls,[])
})

test('changing selection starts a fresh three-second box and clearing/disposal cancel expiry',t=>{
 t.mock.timers.enable({apis:['setTimeout']})
 const {state,selections}=setup()
 state.receiveSelection('SAS123');t.mock.timers.tick(2000);state.receiveSelection('RYR456')
 t.mock.timers.tick(1000);assert.equal(selections.at(-1),'RYR456')
 t.mock.timers.tick(2000);assert.equal(selections.at(-1),'')
 state.receiveSelection('');state.receiveSelection('RYR456');assert.equal(selections.at(-1),'RYR456')
 state.receiveSelection('');const count=selections.length
 t.mock.timers.tick(3000);assert.equal(selections.length,count)
 state.receiveSelection('SAS123');state.dispose();const disposed=selections.length
 t.mock.timers.tick(3000);assert.equal(selections.length,disposed)
})
