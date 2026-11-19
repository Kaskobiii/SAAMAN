import test from 'node:test'
import assert from 'node:assert/strict'
import {SharedClock} from '../src/shared-clock.ts'
import {SharedRelay} from '../src/shared-relay.ts'
import {LegacyRelay} from '../src/legacy-relay.ts'

const start = 1794255140142

test('shared UTC corrects a 90-second offset and keeps running through a Windows clock change', () => {
    let wall = start + 90_000
    let elapsed = 0
    const clock = new SharedClock(() => elapsed, () => wall)
    elapsed = 80
    clock.observe(start + 40, 0, elapsed)
    assert.equal(clock.now(), start + 80)
    wall -= 180_000
    elapsed += 1000
    assert.equal(clock.now(), start + 1080)
    clock.observe(start + 800, elapsed - 80, elapsed)
    elapsed += 100
    assert.equal(clock.now(), start + 1170, 'later negative corrections slew without a backward jump')
})

test('a fresh backend publication survives an incorrect reader clock and expires without a new publication', async () => {
    let elapsed = 0
    const wall = () => start + 90_000
    const checkpoint = {schema:'saaman-1.1.9',operational:{},edits:{},snapshot:{source:'ESSA_E_APP',timestamp:start,flights:[],diagnostics:[]}}
    const sequence = {saamanRelay:{protocol:'saaman-legacy-1',epoch:'room',revision:1,owner:'ESSA_E_APP',instanceId:'east',lease:'lease',settingsRevision:0,settings:{},checkpoint,receipts:{},publication:'first',publishedAt:start}}
    const send = async (_method,_path,_body,timing) => {
        timing({publicationAgeMs:2000 + elapsed,serverTimeMs:start + 2000 + elapsed,freshRoomRead:true})
        return sequence
    }
    const legacy = new LegacyRelay({network:'live',instanceId:'proxy',send,callsign:()=> 'ESSA_W_APP',cid:()=>null,supervisor:async()=>false,now:wall,elapsed:()=>elapsed})
    const relay = new SharedRelay({network:'live',session:'test',channel:'saaman',instanceId:'proxy'}, {
        cid:()=>null,now:wall,elapsed:()=>elapsed,send:(...args)=>legacy.send(...args),
        telemetry:async()=>({source:'ESSA_W_APP',timestamp:wall(),captureAgeMs:0,connectionType:2,flights:[]})
    })
    const fresh = await relay.tick()
    assert.equal(fresh.snapshotAgeMs, 2000)
    assert.equal(fresh.stale, false)
    assert.equal(fresh.snapshot.timestamp, start)
    elapsed += 29_000
    assert.equal((await relay.tick()).stale, true)
    assert.equal(relay.view().snapshot, null)
})

test('handover leaves the sequence clock on backend UTC even with a 180-second difference between PCs', async () => {
    let now = start, elapsed = 0, revision = 0, checkpoint
    const client = (callsign, offset) => {
        const clock = new SharedClock(() => elapsed, () => now + offset)
        return new SharedRelay({network:'live',session:'test',channel:'saaman',instanceId:callsign}, {
            cid:()=>null,now:()=>clock.now(),elapsed:()=>elapsed,wallNow:()=>now+offset,serverClockReady:()=>clock.synchronized,
            telemetry:async()=>({source:callsign,timestamp:now+offset-1000,captureAgeMs:1000,flights:[],activeRunways:{arrivals:['ESSA/19L'],departures:['ESSA/19R']}}),
            send:async (method,_path,body) => {
                clock.observe(now,elapsed,elapsed)
                if(method==='PUT'){checkpoint=body.checkpoint;return {revision:++revision}}
                return {epoch:'room',role:'sequencer',revision,settingsRevision:0,lease:callsign,updated:now,checkpoint:checkpoint??null,publicationAgeMs:checkpoint?2000:undefined}
            }
        })
    }
    const centre = client('ESOS_3_CTR', 90_000)
    assert.equal((await centre.tick()).snapshot.timestamp,start-1000)
    now+=2000;elapsed+=2000
    const approach = client('ESSA_E_APP', -90_000)
    const view=await approach.tick()
    assert.equal(view.snapshot.timestamp,start+1000)
    assert.equal(view.revision,2)
})

test('a missed backend response keeps the last accepted publication until the receipt expires', async () => {
    let elapsed=0, offline=false
    const relay=new SharedRelay({network:'live',session:'test',channel:'saaman',instanceId:'reader'},{
        cid:()=>null,now:()=>start+elapsed+90_000,elapsed:()=>elapsed,
        telemetry:async()=>({source:'ESSA_W_APP',timestamp:start+elapsed+90_000,flights:[]}),
        send:async()=>{
            if(offline)throw Object.assign(new Error('Gateway timeout'),{status:504,retryableTransport:true})
            return {epoch:'room',revision:1,role:'editor',settingsRevision:0,updated:start,publicationAgeMs:5000,
                checkpoint:{schema:'saaman-1.1.9',operational:{},edits:{},snapshot:{source:'ESSA_E_APP',timestamp:start,flights:[],diagnostics:[]}}}
        }
    })
    assert.equal((await relay.tick()).stale,false)
    offline=true;elapsed=14_000
    await assert.rejects(relay.tick(),/Gateway timeout/)
    assert.equal(relay.view().snapshot.timestamp,start)
    assert.equal(relay.view().snapshotAgeMs,19_000)
    elapsed=25_000
    assert.equal(relay.view().snapshot,null)
    assert.equal(relay.view().stale,true)
})
