import {test} from 'node:test'
import assert from 'node:assert/strict'
import {reactive} from 'vue'
import {SessionRecording,recordedTelemetry,decodeRecording} from '../src/maestro-recording.ts'
import {DEFAULT_CONFIG as RELEASE_DEFAULT_CONFIG,runEngine} from '../src/maestro-engine.ts'
const DEFAULT_CONFIG={...RELEASE_DEFAULT_CONFIG,timingModel:'performance'}

const now=Date.UTC(2026,9,11),config={...structuredClone(DEFAULT_CONFIG),predictionMode:'euroscope',minimumNewSeconds:0,unstableSeconds:0}
const flight={callsign:'TEST',aircraft:'A320',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'19R',route:[{name:'ELTOK',latitude:59.71,longitude:16.99,seconds:600}],landingSeconds:1200,distanceNm:80,groundspeed:250,altitude:15000,assignedMach:75,clearedAltitude:11000,finalAltitude:35000,topskyMissedApproach:false}
const input={source:'TEST_APP',timestamp:now,flights:[flight],activeRunways:{arrivals:['ESSA/19R'],departures:['ESSA/26']},runways:{'ESSA/19R':{latitude:59.6,longitude:17.9,heading:190}}}
test('recording reconstructs SDK runway independently of an AMAN runway override',()=>{
    const snapshot=runEngine(input,{...config,active:['ESSA/01L']},{TEST:{runway:'ESSA/01L'}})
    assert.equal(snapshot.flights[0].runway,'01L')
    const restored=recordedTelemetry(snapshot)
    assert.equal(restored.flights[0].runway,'19R');assert.equal(restored.flights[0].landingSeconds,1200)
    assert.deepEqual(restored.activeRunways,input.activeRunways);assert.deepEqual(restored.runways,input.runways)
})

test('simulator landing metadata survives recording and decoding',()=>{
 const first=runEngine({...input,simulation:true},config,{}),recorder=new SessionRecording()
 recorder.start(first,config,{})
 assert.equal(first.simulation,true)
 assert.equal(recordedTelemetry(first).simulation,true)
 assert.equal(decodeRecording(recorder.export())[0].input.simulation,true)
})
test('compressed recording preserves changing route times, plans and replay results',()=>{
    const first=runEngine(input,config,{}),recorder=new SessionRecording()
    recorder.start(first,config,{})
    const second=runEngine({...input,timestamp:now+2000,flights:[{...flight,landingSeconds:1198,route:[{...flight.route[0],seconds:598}]}]},config,{},first)
    recorder.capture(second,config,{});recorder.capture(second,config,{})
    const data=recorder.export(),frames=decodeRecording(data)
    assert.equal(data.routes.length,1);assert.equal(data.plans.length,1);assert.equal(frames.length,2)
    assert.equal(frames[1].input.flights[0].route[0].seconds,598)
    const replay=runEngine(frames[1].input,frames[1].config,frames[1].edits,data.initial)
    assert.deepEqual(replay.flights.map(f=>[f.callsign,f.state,f.sta,f.delay]),second.flights.map(f=>[f.callsign,f.state,f.sta,f.delay]))
})
test('recording is opt-in, bounded, and stops on a source change',()=>{
    const first=runEngine(input,config,{}),recorder=new SessionRecording(1024*1024,1)
    recorder.capture(first,config,{});assert.equal(recorder.count,0)
    recorder.start(first,config,{})
    recorder.capture({...first,timestamp:now+1000},config,{})
    assert.equal(recorder.count,1);assert.equal(recorder.active,false);assert.match(recorder.status,/limit/)
    recorder.start(first,config,{});recorder.capture({...first,source:'OTHER',timestamp:now+1000},config,{})
    assert.equal(recorder.active,false);assert.match(recorder.status,/Source changed/)
})

test('default recording continues beyond the former 3600-frame cutoff',()=>{
 const first=runEngine(input,config,{}),recorder=new SessionRecording()
 recorder.start(first,config,{})
 for(let i=1;i<=3600;i++)recorder.capture({...first,timestamp:now+i*2000},config,{})
 assert.equal(recorder.count,3601);assert.equal(recorder.active,true)
 assert.equal(decodeRecording(recorder.export()).length,3601)
})
test('telemetry of aircraft removed from the visible landed list remains replayable',()=>{
    const landed={...input,flights:[{...flight,distanceNm:0,groundspeed:0,altitude:100}]}
    const first=runEngine(landed,config,{})
    const later=runEngine({...landed,timestamp:now+360000},config,{},first)
    assert.equal(later.flights.length,0)
    assert.equal(recordedTelemetry(later).flights[0].callsign,'TEST')
    assert.equal(recordedTelemetry(later).flights[0].groundspeed,0)
})
test('the supervisory Vue reactive snapshot can be recorded and exported',()=>{
    const snapshot=reactive(runEngine(input,config,{})),recorder=new SessionRecording()
    recorder.start(snapshot,reactive(config),reactive({}))
    const frames=decodeRecording(recorder.export())
    assert.equal(frames.length,1);assert.equal(frames[0].input.flights[0].callsign,'TEST')
    assert.deepEqual(frames[0].input.runways,input.runways)
})
test('same-timestamp controller edits are preserved as control checkpoints',()=>{
    const first=runEngine(input,config,{}),recorder=new SessionRecording()
    recorder.start(first,config,{})
    const edits={TEST:{mode:'desequenced',changedAt:now+1}}
    const changed=runEngine(input,config,edits,{...first,timestamp:now-1})
    recorder.capture(changed,config,edits)
    const data=recorder.export()
    assert.equal(data.frames.length,2)
    assert.equal(decodeRecording(data)[1].controlCheckpoint.flights[0].mode,'desequenced')
})
test('known flight plans are deduplicated instead of repeated in every recording frame',()=>{
 const knownFlights=[{callsign:'FUTURE',aircraft:'A320',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'19R'}]
 const first=runEngine({...input,knownFlights},config,{}),recorder=new SessionRecording()
 recorder.start(first,config,{})
 recorder.capture({...first,timestamp:now+2000},config,{})
 const data=recorder.export(),frames=decodeRecording(data)
 assert.equal(data.inventories.length,1);assert.equal(data.frames[0].input.knownFlights,undefined)
 assert.deepEqual(frames[1].input.knownFlights,knownFlights)
 data.frames[1].input.knownInventory=999
 assert.throws(()=>decodeRecording(data),/inventory/)
})
