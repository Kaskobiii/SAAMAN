import test from 'node:test'
import assert from 'node:assert/strict'
import {updateTrafficModes} from '../src/maestro-traffic-modes.ts'
const start=Date.UTC(2026,9,31,12),runway='ESSA/19L'
const bank=(count,spacing=120,offset=60,r=runway)=>Array.from({length:count},(_,i)=>({callsign:`F${i}`,runway:r,eta:start+(offset+i*spacing)*1000,wake:'M',requiredSeconds:96}))
const mode=(forecasts,now=start,previous={},options={})=>updateTrafficModes(forecasts,[runway,'ESSA/19R'],now,previous,options)

test('quiet, balanced and congested neutral demand select three modes even with no delay instructions',()=>{
 assert.equal(mode(bank(2))[runway].mode,'low')
 assert.equal(mode(bank(5,170))[runway].mode,'medium')
 assert.equal(mode(bank(8,90))[runway].mode,'high')
 const source=bank(5,170),withSlots=source.map(f=>({...f,sta:start+90000000,delay:999999}))
 assert.deepEqual(mode(withSlots),mode(source),'assigned slot and delay fields cannot affect demand')
})
test('a quiet secondary runway stays low while the primary runway has a busy bank',()=>{
 const result=mode([...bank(8,90),...bank(2,170,100,'ESSA/19R')])
 assert.equal(result[runway].mode,'high');assert.equal(result['ESSA/19R'].mode,'low')
 assert.equal(result[runway].count15,8);assert.equal(result['ESSA/19R'].count15,2)
})
test('demand changes with configured runway service and wake intervals',()=>{
 const forecasts=bank(5,170)
 assert.equal(mode(forecasts,start,{}, {intervalSeconds:()=>60})[runway].mode,'medium')
 const heavy=forecasts.map((f,i)=>({...f,wake:i%2?'M':'H'}))
 const result=mode(heavy,start,{}, {intervalSeconds:(leader)=>leader?.wake==='H'?240:120})
 assert.equal(result[runway].mode,'high');assert.ok(result[runway].requiredSeconds15>forecasts.length*96)
 const sparse=bank(3,170).map(f=>({...f,requiredSeconds:180}));assert.equal(mode(sparse)[runway].mode,'medium')
})
test('rolling burst detection finds a late bank within the neutral fifteen-minute horizon',()=>{
 const result=mode(bank(7,35,600))[runway]
 assert.equal(result.count15,7);assert.equal(result.count10,7);assert.equal(result.mode,'high');assert.ok(result.utilization10>=1)
})
test('far, obsolete, unavailable and duplicate telemetry does not inflate traffic',()=>{
 const forecasts=[...bank(2),...bank(5,10,1850),{callsign:'LATE',runway,eta:start-31000},...bank(8,30,10).map(f=>({...f,callsign:'BAD'+f.callsign,valid:false})),{callsign:'NAN',runway,eta:NaN}]
 forecasts.push({...forecasts[0],eta:forecasts[0].eta+5000},{...forecasts[1]})
 const result=mode(forecasts)[runway];assert.equal(result.count15,2);assert.equal(result.mode,'low')
 assert.equal(mode([{callsign:'JUST',runway,eta:start-1000}])[runway].count15,1)
})
test('upward changes require thirty seconds of continuously confirmed demand',()=>{
 let state=mode(bank(2));state=mode(bank(8,90),start+1000,state)
 assert.equal(state[runway].mode,'low');assert.equal(state[runway].pendingMode,'high')
 state=mode(bank(8,90),start+30000,state);assert.equal(state[runway].mode,'low')
 state=mode(bank(8,90),start+31000,state);assert.equal(state[runway].mode,'high');assert.equal(state[runway].since,start+31000);assert.equal(state[runway].pendingMode,undefined)
})
test('falling demand requires two minutes before leaving high mode',()=>{
 let state=mode(bank(8,90));state=mode([],start+1000,state)
 assert.equal(state[runway].mode,'high');assert.equal(state[runway].pendingMode,'low')
 for(const elapsed of [30000,60000,90000,120000]){state=mode([],start+elapsed,state);assert.equal(state[runway].mode,'high')}
 state=mode([],start+121000,state);assert.equal(state[runway].mode,'low')
})
test('boundary hysteresis retains a high mode until pressure is clearly lower',()=>{
 let state=mode(bank(8,90));const reduced=bank(7,125)
 state=mode(reduced,start+1000,state);assert.equal(state[runway].mode,'high');assert.equal(state[runway].pendingMode,undefined)
 assert.equal(mode(reduced)[runway].mode,'medium','the same bank does not initiate high from a fresh context')
})
test('a brief demand reversal resets a pending transition instead of advancing it',()=>{
 let state=mode(bank(2));state=mode(bank(8,90),start+1000,state);state=mode(bank(2),start+20000,state)
 assert.equal(state[runway].pendingMode,undefined)
 state=mode(bank(8,90),start+30000,state);assert.equal(state[runway].pendingSince,start+30000)
 state=mode(bank(8,90),start+50000,state);assert.equal(state[runway].mode,'low')
})
test('serialized handover state keeps confirmation while stale or reversed clocks restart observation',()=>{
 let state=mode(bank(2));state=mode(bank(8,90),start+1000,state);state=JSON.parse(JSON.stringify(state))
 const restored=mode(bank(8,90),start+31000,state);assert.equal(restored[runway].mode,'high')
 const reset=mode([],start+70000,state);assert.equal(reset[runway].mode,'low');assert.equal(reset[runway].pendingMode,undefined)
 const rewind=mode([],start-1000,state);assert.equal(rewind[runway].mode,'low');assert.equal(rewind[runway].since,start-1000)
})
test('duplicate timestamps do not complete dwell, and malformed prior state cannot leak into output',()=>{
 let state=mode(bank(2));state=mode(bank(8,90),start+1000,state)
 for(let i=0;i<100;i++)state=mode(bank(8,90),start+1000,state)
 assert.equal(state[runway].mode,'low')
 const bad=mode(bank(2),start,{[runway]:{mode:'not-a-mode',since:NaN,evaluatedAt:start,secret:'private'}})
 assert.equal(bad[runway].mode,'low');assert.ok(!JSON.stringify(bad).includes('private'))
 assert.throws(()=>mode([],NaN),/timestamp/)
})
test('interval callbacks are bounded and the stored state contains no aircraft payload or extra runways',()=>{
 const result=updateTrafficModes(bank(2),[runway,runway,'not a runway'],start,{}, {intervalSeconds:()=>NaN})
 assert.deepEqual(Object.keys(result),[runway]);assert.equal(result[runway].requiredSeconds15,192)
 assert.ok(JSON.stringify(result).length<400);assert.ok(!JSON.stringify(result).includes('F0'))
})

test('a bank twenty minutes ahead is detected before Superstable assumptions are protected',()=>{
 const result=mode(bank(8,60,1200))[runway]
 assert.equal(result.mode,'high');assert.equal(result.count15,8);assert.equal(result.lookaheadSeconds,1800);assert.equal(result.bankStart,start+1200000)
})
test('well-spread thirty-minute traffic is scored by peak fifteen-minute demand rather than total count',()=>{
 const forecasts=bank(8,220,60),result=mode(forecasts)[runway]
 assert.equal(result.count15,5);assert.equal(result.mode,'medium');assert.equal(result.requiredSeconds15,480)
})
