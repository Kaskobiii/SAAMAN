import test from 'node:test'
import assert from 'node:assert/strict'
import {sharedRecordingContext,nextSharedRevision} from '../src/shared-recording-context.ts'
import {LegacyRelay} from '../src/legacy-relay.ts'
import {SharedRelay} from '../src/shared-relay.ts'
import {DEFAULT_CONFIG} from '../src/maestro-engine.ts'

test('recording authority distinguishes the accepted publisher from a server-confirmed election',()=>{
 const value=sharedRecordingContext('live/ESSA/shared/saaman',{epoch:'epoch',revision:42,revisionGeneration:'counter-1',role:'supervisor',authority:{room:'live/ESSA',publisher:'ESSA_FMP',publisherVersion:'1.3.40',sequencer:'ESSA_E__APP',sequencerVersion:'1.3.41'}})
 assert.equal(value.room,'live/ESSA');assert.equal(value.publisher,'ESSA_FMP');assert.equal(value.sequencer,'ESSA_E__APP');assert.equal(value.sequencerVersion,'1.3.41')
 assert.equal(value.revision,42);assert.equal(value.revisionGeneration,'counter-1')
})
test('public diagnostic fields do not copy identity credentials or infer election from telemetry source',()=>{
 const value=sharedRecordingContext('live/ESSA/shared/saaman',{epoch:'epoch',revision:42,source:'ESSA_FMP',snapshot:{source:'ESSA_FMP'},token:'SECRET',cid:123,lease:'SECRET',authority:{room:'https://host/?token=SECRET',publisher:'invalid callsign',publisherVersion:'SECRET',password:'SECRET'}})
 assert.equal(value.room,'live/ESSA/shared/saaman');assert.equal(value.publisher,undefined);assert.equal(value.sequencer,undefined);assert.equal(value.publisherVersion,undefined)
 assert.ok(!JSON.stringify(value).includes('SECRET'));assert.ok(!('cid' in value));assert.ok(!('lease' in value))
})
test('recovery kind exposes a small event name without copying a checkpoint or recovery body',()=>{
 const value=sharedRecordingContext('live/ESSA',{epoch:'epoch',revision:0,checkpointRecovery:{kind:'legacy-empty-room',snapshot:{flights:['private']}}})
 assert.equal(value.recovery,'empty-room');assert.ok(!JSON.stringify(value).includes('private'))
 assert.equal(sharedRecordingContext('live/ESSA',{checkpointRecovery:{kind:'legacy-restored-publication'}}).recovery,'counter-restart')
})
test('supervision accepts a restarted generation then rejects its stale replies',()=>{
 const old={epoch:'epoch',generation:'first',revision:300}
 assert.equal(nextSharedRevision(old,{epoch:'epoch',revisionGeneration:'first',revision:299}),undefined)
 const fresh=nextSharedRevision(old,{epoch:'epoch',revisionGeneration:'second',revision:1})
 assert.deepEqual(fresh,{epoch:'epoch',generation:'second',revision:1})
 assert.equal(nextSharedRevision(fresh,{epoch:'epoch',revisionGeneration:'second',revision:0}),undefined)
 assert.equal(nextSharedRevision(fresh,{epoch:'epoch',revision:0}),undefined,'an omitted generation cannot reopen a counter')
 assert.equal(nextSharedRevision(fresh,{epoch:'epoch',revisionGeneration:'second',revision:2}).revision,2)
 assert.equal(nextSharedRevision(fresh,{epoch:'new-room',revision:0}).revision,0)
 assert.equal(nextSharedRevision(fresh,{revision:NaN}),undefined)
})
test('a separate callsign supervisor records the publication identity without polling or claiming a sequencer',async()=>{
 const at=Date.UTC(2026,9,26),requests=[]
 const envelope={protocol:'saaman-legacy-1',epoch:'same-room',revision:23,owner:'ESSA_E_APP',instanceId:'publisher',lease:'PRIVATE-LEASE',settingsRevision:0,settings:{},receipts:{},publication:'accepted',publishedAt:at,engineVersion:'1.3.40',checkpoint:{schema:'saaman-1.1.9',operational:DEFAULT_CONFIG,edits:{},snapshot:{source:'ESSA_E_APP',timestamp:at,flights:[],diagnostics:[]}}}
 const legacy=new LegacyRelay({network:'live',instanceId:'supervision',callsign:()=> 'ESSA_FMP',cid:()=>123,supervisor:async()=>true,now:()=>at,send:async(method,path)=>{requests.push({method,path});assert.equal(method,'GET');return {saamanRelay:envelope}}})
 const relay=new SharedRelay({network:'live',session:'ignored',channel:'ignored',instanceId:'supervision'},{cid:()=>123,now:()=>at,telemetry:async()=>{throw Error('supervision must not publish')},send:(m,p,b)=>legacy.send(m,p,b)})
 const view=await relay.supervision(),context=view.recordingContext
 assert.equal(context.room,'live/ESSA');assert.equal(context.publisher,'ESSA_E_APP');assert.equal(context.publisherVersion,'1.3.40');assert.equal(context.sequencer,undefined);assert.equal(context.role,'supervisor');assert.equal(context.revision,23)
 assert.ok(!JSON.stringify(context).includes('PRIVATE-LEASE'));assert.equal(requests.length,1)
 envelope.revision=1;envelope.counterReset={revision:23,publication:'accepted',checkpointAt:at,at:at+1};envelope.publishedAt=at+1
 const recovered=await relay.supervision();assert.notEqual(recovered.revisionGeneration,view.revisionGeneration);assert.equal(recovered.recordingContext.revision,1)
})
