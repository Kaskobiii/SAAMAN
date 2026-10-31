import {test} from 'node:test'
import assert from 'node:assert/strict'
import {SessionRecording,decodeRecording,sanitizeRecordingContext} from '../src/maestro-recording.ts'
import {DEFAULT_CONFIG,runEngine} from '../src/maestro-engine.ts'
const at=Date.UTC(2026,9,26),config={...structuredClone(DEFAULT_CONFIG),minimumNewSeconds:0,unstableSeconds:0}
const raw={source:'ESSA_FMP',timestamp:at,flights:[{callsign:'TEST1',aircraft:'A320',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'19R',route:[{name:'ELTOK',latitude:59.71,longitude:16.99,seconds:600}],landingSeconds:1200,distanceNm:80,groundspeed:250,altitude:15000}]}
const first=()=>runEngine(raw,config,{})
const context=(extra={})=>({room:'live/ESSA',epoch:'epoch-1',revisionGeneration:'epoch-1',revision:300,sequencer:'ESSA_FMP',sequencerVersion:'1.3.41',publisher:'ESSA_FMP',publisherVersion:'1.3.41',role:'observer',stale:false,recovery:'none',...extra})

test('recordings retain public initial authority without conflating publisher and elected sequencer',()=>{
 const recorder=new SessionRecording(),ctx=context({sequencer:'ESSA_E_APP',publisher:'ESSA_FMP'});recorder.start(first(),config,{},ctx)
 const data=recorder.export();assert.equal(data.initialContext.room,'live/ESSA');assert.equal(data.initialContext.sequencer,'ESSA_E_APP');assert.equal(data.initialContext.publisher,'ESSA_FMP');assert.equal(data.authorityEvents.length,0)
 ctx.publisher='CHANGED';assert.equal(recorder.export().initialContext.publisher,'ESSA_FMP')
 assert.match(data.initialContext.revisionGeneration,/^fnv1a32:[0-9a-f]{8}$/)
})

test('authority updates are change-only and normal revisions do not append events',()=>{
 const recorder=new SessionRecording();recorder.start(first(),config,{},context())
 for(let revision=301;revision<1000;revision++)recorder.observeContext(context({revision}),at+revision)
 assert.equal(recorder.export().authorityEvents.length,0)
 recorder.observeContext(context({revision:2,revisionGeneration:'counter-2',recovery:'counter-restart'}),at+2000)
 const event=recorder.export().authorityEvents[0];assert.ok(event.changes.includes('revision-rollback'));assert.ok(event.changes.includes('revisionGeneration'));assert.ok(event.changes.includes('recovery'));assert.equal(event.context.revision,2);assert.equal(event.observedAt,at+2000);assert.equal(event.snapshotAt,at)
 recorder.observeContext(context({revision:3,revisionGeneration:'counter-2',recovery:'counter-restart'}),at+3000)
 assert.equal(recorder.export().authorityEvents.length,1)
})

test('same-timestamp metadata changes survive a duplicate telemetry capture',()=>{
 const recorder=new SessionRecording(),snapshot=first();recorder.start(snapshot,config,{},context())
 recorder.capture(snapshot,config,{},context({sequencer:'ESSA_E_APP',sequencerVersion:'1.3.42'}))
 const data=recorder.export();assert.equal(data.frames.length,1);assert.equal(data.authorityEvents.length,1);assert.deepEqual(data.authorityEvents[0].changes,['sequencer','sequencerVersion']);assert.equal(data.authorityEvents[0].frame,0)
})

test('staleness and unknown authority are recorded without claiming a new source or owner',()=>{
 const recorder=new SessionRecording();recorder.start(first(),config,{},context())
 recorder.observeContext(context({stale:true,sequencer:undefined,sequencerVersion:undefined}),at+1)
 recorder.observeContext(undefined,at+2)
 recorder.observeContext(context({revision:301}),at+3)
 const data=recorder.export();assert.equal(data.authorityEvents.length,3);assert.equal(data.authorityEvents[0].context.sequencer,undefined);assert.equal(data.authorityEvents[1].context,undefined);assert.equal(data.authorityEvents[2].context.sequencer,'ESSA_FMP');assert.equal(recorder.active,true)
})

test('a verified same-room handover keeps the recording and source transition',()=>{
 const recorder=new SessionRecording(),snapshot=first();recorder.start(snapshot,config,{},context())
 const handover={...snapshot,source:'ESSA_E_APP',timestamp:at+2000}
 recorder.capture(handover,config,{},context({sequencer:'ESSA_E_APP',publisher:'ESSA_E_APP',revision:301}))
 const data=recorder.export();assert.equal(recorder.active,true);assert.equal(data.frames.length,2);assert.equal(decodeRecording(data)[1].input.source,'ESSA_E_APP');assert.equal(data.authorityEvents.length,1)
 const event=data.authorityEvents[0];assert.equal(event.previousSource,'ESSA_FMP');assert.equal(event.source,'ESSA_E_APP');assert.ok(event.changes.includes('source'));assert.ok(event.changes.includes('sequencer'));assert.equal(event.stopped,undefined)
})

test('source changes without matching shared-room evidence retain the stop and its event',()=>{
 for(const missing of [undefined,context({room:'sweatbox1/ESSA'})]){
  const recorder=new SessionRecording(),snapshot=first();recorder.start(snapshot,config,{},context())
  recorder.capture({...snapshot,source:'ESOS_1_CTR',timestamp:at+2000},config,{},missing)
  const data=recorder.export();assert.equal(recorder.active,false);assert.equal(data.frames.length,1);assert.equal(data.authorityEvents.length,1);assert.ok(data.authorityEvents[0].changes.includes('source'));assert.ok(data.authorityEvents[0].stopped)
 }
 const recorder=new SessionRecording(),snapshot=first();recorder.start(snapshot,config,{})
 recorder.capture({...snapshot,source:'ESSA_E_APP',timestamp:at+2000},config,{},context())
 assert.equal(recorder.active,false);assert.equal(recorder.export().authorityEvents[0].stopped,'source-unverified')
})

test('room changes stop even when the telemetry source has not changed',()=>{
 const recorder=new SessionRecording();recorder.start(first(),config,{},context())
 recorder.observeContext(context({room:'sweatbox2/ESSA'}),at+1000)
 assert.equal(recorder.active,false);assert.match(recorder.status,/room changed/);assert.equal(recorder.export().authorityEvents[0].stopped,'room-changed')
})

test('diagnostic context uses a bounded whitelist and never exports credentials or arbitrary payloads',()=>{
 const value={...context(),cid:12345,token:'SECRET-AUTH',controllerKey:'SECRET-KEY',url:'https://private.example/?token=SECRET',password:'SECRET-PASS',revisionGeneration:'["publication",{"token":"SECRET-GENERATION"}]'}
 const safe=sanitizeRecordingContext(value),serialized=JSON.stringify(safe)
 for(const secret of ['SECRET','12345','private.example','password','controllerKey','token'])assert.equal(serialized.includes(secret),false)
 assert.equal(safe.room,'live/ESSA');assert.equal(sanitizeRecordingContext({...value,room:value.url}),undefined)
 const malformed=sanitizeRecordingContext({...context(),revision:-1,epoch:'https://private.example',publisher:'invalid value',sequencerVersion:'x'.repeat(1000),revisionGeneration:'y'.repeat(1000)})
 assert.equal(malformed.revision,undefined);assert.equal(malformed.epoch,undefined);assert.equal(malformed.publisher,undefined);assert.equal(malformed.sequencerVersion,undefined);assert.equal(malformed.revisionGeneration,undefined)
 assert.deepEqual(sanitizeRecordingContext(safe),safe);assert.equal(sanitizeRecordingContext(context({role:'supervisor'})).role,'supervisor')
})

test('authority events share the recording byte budget and duplicate polling is bounded',()=>{
 const snapshot=first(),probe=new SessionRecording();probe.start(snapshot,config,{},context())
 const budget=JSON.stringify(probe.export()).length*2+10000
 const recorder=new SessionRecording(budget,18000);recorder.start(snapshot,config,{},context());assert.equal(recorder.active,true)
 let iterations=0;while(recorder.active&&iterations<1000){iterations++;recorder.observeContext(context({revision:300+iterations,stale:iterations%2===0}),at+iterations)}
 assert.ok(iterations<1000);assert.equal(recorder.active,false);assert.match(recorder.status,/limit/)
 const count=recorder.export().authorityEvents.length;assert.ok(count>0);for(let i=0;i<100;i++)recorder.observeContext(context(),at+i)
 assert.equal(recorder.export().authorityEvents.length,count);assert.ok(JSON.stringify(recorder.export()).length*2<budget+2000)
})

test('slot evidence records meaningful changes while ordinary small drift remains in frames',()=>{
 const recorder=new SessionRecording(),snapshot=first();recorder.start(snapshot,config,{},context());assert.equal(recorder.export().slotChanges.length,1)
 for(let i=1;i<=7;i++){
  const next={...snapshot,timestamp:at+i*2000,flights:snapshot.flights.map(f=>({...f,eta:f.eta+i*5000,sta:f.sta+i*5000,etaFf:f.etaFf+i*5000,staFf:f.staFf+i*5000}))};recorder.capture(next,config,{},context({revision:300+i}))
 }
 const data=recorder.export();assert.equal(data.frames.length,8);assert.equal(data.slotChanges.length,2);assert.ok(data.slotChanges[1].changes.includes('slot'));assert.equal(data.slotChanges[1].to.sta-data.slotChanges[0].to.sta,30000)
 assert.ok(data.slotChanges.every(e=>e.explanation.summary.length<=320&&e.explanation.reasons.length<=8))
})

test('Recompute and changed constraint identities remain visible at the same telemetry time',()=>{
 const recorder=new SessionRecording(),snapshot=first();recorder.start(snapshot,config,{},context())
 const edits={TEST1:{recomputeAt:at+1}},next={...snapshot,flights:snapshot.flights.map(f=>({...f,sta:f.sta+2000,feederDelayMs:120000}))}
 recorder.capture(next,config,edits,context({revision:301}))
 const data=recorder.export(),event=data.slotChanges.at(-1);assert.ok(event.changes.includes('recompute'));assert.ok(event.changes.includes('constraint'));assert.ok(event.explanation.reasons.some(r=>r.kind==='feeder'));assert.ok(data.frames[1].controlCheckpoint)
})

test('legacy exports without diagnostic events remain decodable and start resets diagnostics',()=>{
 const recorder=new SessionRecording(),snapshot=first();recorder.start(snapshot,config,{},context());const legacy=recorder.export();delete legacy.initialContext;delete legacy.authorityEvents;delete legacy.slotChanges
 assert.equal(decodeRecording(legacy).length,1)
 recorder.observeContext(context({stale:true}),at+1);recorder.start(snapshot,config,{})
 const data=recorder.export();assert.equal(data.initialContext,undefined);assert.equal(data.authorityEvents.length,0);assert.equal(data.slotChanges.length,1)
})


test('unknown and local room labels cannot authorize shared source handovers',()=>{
 for(const ctx of [context({room:'unknown/ESSA'}),context({room:'local/ESSA'}),context({role:'local'})]){
  const recorder=new SessionRecording(),snapshot=first();recorder.start(snapshot,config,{},ctx)
  recorder.capture({...snapshot,source:'ESSA_E_APP',timestamp:at+2000},config,{},ctx)
  assert.equal(recorder.active,false);assert.equal(recorder.count,1);assert.equal(recorder.export().authorityEvents.at(-1).stopped,'source-unverified')
 }
})

test('a rejected large frame does not retain unused plans or route dictionaries',()=>{
 const recorder=new SessionRecording(30000),snapshot=first();recorder.start(snapshot,config,{},context());assert.equal(recorder.active,true)
 const before=recorder.export(),huge={...snapshot,timestamp:at+2000,flights:snapshot.flights.map(f=>({...f,route:Array.from({length:512},(_,i)=>({name:'WAYPOINT'+i,latitude:59+i*.001,longitude:18+i*.001,seconds:i*60}))}))}
 recorder.capture(huge,{...config,extraTestPadding:'x'.repeat(50000)},{},context({revision:301}))
 const after=recorder.export();assert.equal(recorder.active,false);assert.equal(after.frames.length,before.frames.length);assert.equal(after.routes.length,before.routes.length);assert.equal(after.plans.length,before.plans.length);assert.equal(after.slotChanges.length,before.slotChanges.length)
})

test('a small configured interval change records new binding evidence even below the slot-movement threshold',()=>{
 const snapshot=first(),flight=snapshot.flights[0],leader={...flight,callsign:'LEAD',order:0,sta:flight.sta-96000,staFf:flight.staFf-120000,separation:undefined}
 const follower={...flight,order:1,separation:{leader:'LEAD',rateSeconds:96,wakeSeconds:77,wakeNm:3,scheduledSeconds:96}}
 snapshot.flights=[leader,follower]
 const recorder=new SessionRecording();recorder.start(snapshot,config,{},context())
 const changed={...snapshot,timestamp:snapshot.timestamp+2000,flights:[leader,{...follower,sta:follower.sta-6000,separation:{...follower.separation,rateSeconds:90,scheduledSeconds:90}}]}
 recorder.capture(changed,config,{},context({revision:301}))
 const event=recorder.export().slotChanges.at(-1)
 assert.equal(event.callsign,follower.callsign);assert.ok(event.changes.includes('constraint'));assert.ok(event.explanation.reasons.some(r=>r.kind==='rate'&&r.seconds===90));assert.ok(!event.changes.includes('slot'))
})
