import test from 'node:test'
import assert from 'node:assert/strict'
import {createRecentDiagnostics} from '../src/maestro-recent-diagnostics.ts'
import {DEFAULT_CONFIG} from '../src/maestro-engine.ts'

const t=Date.UTC(2026,10,14,19)
const flight={
    callsign:'SAS123',aircraft:'A20N',wake:'M',arrival:'ESSA',runway:'ESSA/19L',ff:'ELTOK',
    state:1,mode:'sequenced',order:1,eta:t+1200000,sta:t+1200000,etaFf:t+600000,staFf:t+600000,
    delay:0,totalDelay:0,groundspeed:420,altitude:29000,assignedSpeed:250,landingSeconds:1200,
    route:[{name:'UPSTREAM',seconds:-20},{name:'ELTOK',seconds:600},{name:'ESSA',seconds:1200}],
}
function observation(offset,changes={},context={}){
    return {at:t+offset,snapshot:{timestamp:t+offset,source:'ESSA_E_APP',flights:[{...flight,...changes}]},
        config:DEFAULT_CONFIG,context:{room:'live/ESSA',epoch:'first',role:'editor',sequencer:'ESSA_E_APP',...context}}
}
async function drain(){await new Promise(resolve=>setImmediate(resolve))}
function fixture(){
    const frames=[]
    let tick=0
    const capture=createRecentDiagnostics(async frame=>{frames.push(frame)},()=>tick)
    return {frames,async capture(frame,ms){tick=ms;capture(frame);await drain()}}
}

test('periodically samples fresh snapshots and immediately retains evidence of an instruction jump',async()=>{
    const {frames,capture}=fixture()
    await capture(observation(0),0)
    await capture(observation(1000),1000)
    assert.equal(frames.length,1)
    await capture(observation(5000),5000)
    assert.equal(frames.length,2)
    await capture(observation(6000,{delay:300,staFf:flight.staFf+300000,direct:'ELTOK'}),6000)
    assert.equal(frames.length,3)
    assert.equal(frames[2].flights[0].delay,300)
    assert.equal(frames[2].flights[0].line0InstructionSeconds,300)
    assert.equal(frames[2].before[0].delay,0)
    assert.deepEqual(frames[2].flights[0].route.points.map(point=>point[0]),['ELTOK','ESSA'])
    await capture(observation(6000,{delay:300,staFf:flight.staFf+300000,direct:'ELTOK'}),12000)
    assert.equal(frames.length,3)
})

test('captures plan changes, repeated telemetry with a new edit, and clean reconnects',async()=>{
    const {frames,capture}=fixture()
    await capture(observation(0,{}, {revision:3}),0)
    await capture({...observation(0,{}, {revision:4}),edits:{SAS123:{recomputeAt:t}}},200)
    assert.equal(frames[1].flights[0].edit.recomputeAt,t)
    await capture({...observation(0,{}, {revision:5}),config:{...DEFAULT_CONFIG,rates:{'ESSA/19L':95},pendingRate:{at:t+600000,seconds:119}}},400)
    assert.equal(frames[2].plan.pendingRate.seconds,119)
    await capture({at:t+1500,error:'Shared backend timed out',clockSynchronized:true},1500)
    assert.equal(frames[3].error,'timeout')
    assert.equal(frames[3].clockSynchronized,true)
    assert.deepEqual(frames[3].flights,[])
    await capture({...observation(2000,{delay:90},{sequencer:'ESOS_3_CTR'}),snapshotAgeMs:1000,clockSynchronized:true,backendMinusLocalMs:-90_000},2000)
    assert.equal(frames[4].snapshotAgeMs,1000)
    assert.equal(frames[4].backendMinusLocalMs,-90_000)
    assert.equal(frames[4].context.sequencer,'ESOS_3_CTR')
    assert.equal(frames[4].before[0].delay,0)
    await capture(observation(2500,{delay:600},{epoch:'new'}),2500)
    assert.deepEqual(frames[5].before,[])
    assert.ok(frames[5].authorityChanges.includes('epoch'))
    await capture(observation(30*60000+2500,{delay:1000},{epoch:'new'}),30*60000+2500)
    assert.deepEqual(frames[6].before,[])
})

test('leaves raw connection and coordination details out of exports',async()=>{
    const {frames,capture}=fixture()
    const secret='test-private-token'
    await capture({
        ...observation(0,{routeText:secret},{token:secret}),
        config:{...DEFAULT_CONFIG,coordinations:[{text:secret}]},
        error:'Cannot reach https://example.test/'+secret,
    },0)
    assert.equal(frames[0].error,'connection')
    assert.ok(!JSON.stringify(frames[0]).includes(secret))
})

test('does not queue writes and retries after a failed diagnostic sink',async()=>{
    const frames=[]
    let resolve
    const capture=createRecentDiagnostics(frame=>{
        frames.push(frame)
        return new Promise(accept=>{resolve=accept})
    },()=>t)
    capture(observation(0))
    capture(observation(2000,{delay:300}))
    assert.equal(frames.length,1)
    resolve(false)
    await drain()
    capture(observation(3000))
    assert.equal(frames.length,2)
    resolve(true)
    await drain()
    capture(observation(4000))
    assert.equal(frames.length,2)
})
