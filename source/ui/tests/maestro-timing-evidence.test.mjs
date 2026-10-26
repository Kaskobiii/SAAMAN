import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DEFAULT_CONFIG,runEngine} from '../src/maestro-engine.ts'
import {SessionRecording} from '../src/maestro-recording.ts'
import {timingEvidence,TIMING_EVIDENCE_MAX_BYTES} from '../src/maestro-timing-evidence.ts'
import fixture from './fixtures/recording15-tma-recovery.json' with {type:'json'}

const p=fixture.input.flights.find(f=>f.callsign==='LOT457'),c=fixture.config,at=fixture.input.timestamp
const packet=(p,t=at)=>({...structuredClone(fixture.input),timestamp:t,flights:[structuredClone(p)]})
const first=()=>runEngine(packet(p),c,{})

test('the first accepted prediction stores detached actual scalar inputs and derived model evidence',()=>{
 const raw=structuredClone(p),s=runEngine(packet(raw),c,{}),f=s.flights[0],e=f.initialTimingEvidence
 assert.equal(e.schema,'saaman-timing-summary-1');assert.equal(e.provenance,'capture-summary');assert.equal(e.at,at)
 assert.equal(e.input.groundspeed,p.groundspeed);assert.equal(e.input.altitude,p.altitude)
 assert.equal(e.input.latitude,p.latitude);assert.equal(e.input.longitude,p.longitude);assert.equal(e.input.runway,p.runway)
 assert.equal(e.model.seconds,f.landingPrediction.seconds);assert.equal(e.accepted.eta,f.euroscopeBaseline.eta)
 assert.equal(e.model.routeTiming.distanceNm,f.landingPrediction.routeTiming.distanceNm)
 assert.ok(e.model.phaseReference.landingIas>0);assert.match(e.route.fingerprint,/^fnv1a32:/)
 assert.ok(Buffer.byteLength(JSON.stringify(e))<=TIMING_EVIDENCE_MAX_BYTES)
 raw.latitude=0;raw.route[0].name='CHANGED';assert.equal(e.input.latitude,p.latitude);assert.notEqual(e.route.points[0]?.[0],'CHANGED')
})

test('original capture evidence survives Recompute, changed live telemetry and a JSON checkpoint',()=>{
 const s=first(),original=structuredClone(s.flights[0].initialTimingEvidence),t=at+2000
 const changed={...p,groundspeed:p.groundspeed+10,altitude:p.altitude-100}
 const next=runEngine(packet(changed,t),c,{LOT457:{recomputeAt:t,changedAt:t}},JSON.parse(JSON.stringify(s)))
 assert.equal(next.flights[0].euroscopeBaseline.at,t);assert.deepEqual(next.flights[0].initialTimingEvidence,original)
 assert.equal(next.flights[0].initialTimingEvidence.input.groundspeed,p.groundspeed)
})

test('starting a recording later exports the retained original as a summary without inventing a historical frame',()=>{
 const s=first(),later=runEngine(packet({...p,altitude:p.altitude-100},at+2000),c,{},s),recorder=new SessionRecording()
 recorder.start(later,c,{})
 const data=recorder.export(),e=data.originalTimingCaptures[0]
 assert.equal(e.callsign,'LOT457');assert.equal(e.at,at);assert.equal(e.evidence.input.groundspeed,p.groundspeed)
 assert.equal(data.unavailableCaptures.length,0);assert.equal(data.timingCaptures.length,0)
 assert.equal(data.frames.length,1);assert.equal(data.frames[0].input.timestamp,at+2000)
})

test('current captures carry their actual evidence and legacy originals remain explicitly unavailable',()=>{
 const s=first(),r=new SessionRecording();r.start(s,c,{})
 const capture=r.export().timingCaptures[0]
 assert.equal(capture.evidence.at,at);assert.equal(capture.evidence.input.altitude,p.altitude)
 const legacy=JSON.parse(JSON.stringify(s));delete legacy.flights[0].initialTimingEvidence;legacy.timestamp+=2000
 r.start(legacy,c,{})
 const data=r.export();assert.equal(data.originalTimingCaptures.length,0)
 assert.deepEqual(data.unavailableCaptures,[{callsign:'LOT457',at,reason:'before-recording'}])
})

test('summary size is bounded independently of a 512-point route, with explicit omitted geometry',()=>{
 const s=first(),prediction=s.flights[0].landingPrediction
 const long={...p,route:Array.from({length:512},(_,i)=>({name:'WAYPOINT'+String(i).padStart(3,'0'),latitude:59+i*.001,longitude:18+i*.001,seconds:i*60}))}
 const evidence=timingEvidence(long,c,prediction,at)
 assert.ok(evidence);assert.equal(evidence.route.totalPoints,512);assert.equal(evidence.route.remainingPoints,512)
 assert.ok(evidence.route.points.length<=6);assert.equal(evidence.route.omittedPoints,512-evidence.route.points.length)
 assert.ok(Buffer.byteLength(JSON.stringify(evidence))<=TIMING_EVIDENCE_MAX_BYTES)
 const tiny=new SessionRecording(100,100);tiny.start(s,c,{})
 assert.equal(tiny.active,false);assert.equal(tiny.count,0);assert.match(tiny.status,/limit/)
})

test('a legacy capture cannot acquire invented original inputs during a later Recompute',()=>{
 const s=first(),legacy=JSON.parse(JSON.stringify(s));delete legacy.flights[0].initialTimingEvidence
 const next=runEngine(packet({...p,groundspeed:200},at+2000),c,{LOT457:{recomputeAt:at+2000}},legacy)
 assert.equal(next.flights[0].initialTimingEvidence,undefined)
})
