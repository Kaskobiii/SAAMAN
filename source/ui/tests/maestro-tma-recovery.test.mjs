import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DEFAULT_CONFIG,runEngine,reconcileRunwayAssignments,toJuhaSequence} from '../src/maestro-engine.ts'
import {STAR_FEEDERS,STAR_RUNWAYS} from '../src/maestro-star-prediction.ts'
import fixture from './fixtures/recording15-tma-recovery.json' with {type:'json'}

const first=(input=fixture.input,c=fixture.config,edits={})=>runEngine(structuredClone(input),structuredClone(c),edits)
const get=(s,name)=>s.flights.find(f=>f.callsign===name)
const p=fixture.input.flights.find(f=>f.callsign==='SAS71HG')
const packet=extra=>({...structuredClone(fixture.input),flights:[{...structuredClone(p),...extra}]})

test('recording 15 verified TMA traffic is immediately Superstable or Frozen after history loss',()=>{
 const s=first(),sas=get(s,'SAS71HG'),lot=get(s,'LOT457')
 assert.equal(sas.firstSeen,s.timestamp);assert.equal(lot.firstSeen,s.timestamp)
 assert.equal(sas.passedFeeder,true);assert.equal(lot.passedFeeder,true)
 assert.equal(sas.feederObservationSource,'passed');assert.equal(lot.feederObservationSource,'passed')
 assert.equal(sas.issue,'');assert.equal(lot.issue,'');assert.equal(sas.state,2);assert.equal(lot.state,3)
 assert.equal(sas.delay,0);assert.equal(lot.delay,0)
 const next=runEngine({...structuredClone(fixture.input),timestamp:s.timestamp+2000},fixture.config,{},JSON.parse(JSON.stringify(s)))
 assert.equal(get(next,'SAS71HG').state,2);assert.equal(get(next,'LOT457').state,3)
 assert.equal(get(next,'SAS71HG').sta,sas.sta);assert.equal(get(next,'LOT457').sta,lot.sta)
})

test('the startup timer still applies before the feeder even with an otherwise usable forecast',()=>{
 const ff=STAR_FEEDERS.NILUG,threshold=STAR_RUNWAYS['19R']
 const s=first(packet({latitude:ff.latitude+(ff.latitude-threshold.latitude)*.1,longitude:ff.longitude+(ff.longitude-threshold.longitude)*.1,
  route:[{name:'NILUG',...ff,seconds:300},{name:'SA19R',...threshold,seconds:900}],landingSeconds:900}))
 const f=s.flights[0];assert.equal(f.issue,'');assert.equal(f.passedFeeder,false);assert.equal(f.state,0)
})

test('missing, stale or invalid feeder evidence does not bypass the startup timer',()=>{
 for(const extra of [{latitude:undefined,longitude:undefined},{positionAgeSeconds:16},{speedDataValid:false},{route:[],star:''}]){
  const f=first(packet(extra)).flights[0]
  assert.equal(f.state,0,JSON.stringify(extra))
 }
})

test('an implausibly slow high-altitude jet is not promoted by its first feeder-passage report',()=>{
 const f=first(packet({groundspeed:75,altitude:12000})).flights[0]
 assert.equal(f.state,0)
})

test('a TopSky HOLD at the feeder does not prove entry on first capture',()=>{
 const ff=STAR_FEEDERS.NILUG,f=first(packet({...ff,topskyHoldingPoint:'NILUG'})).flights[0]
 assert.equal(f.feederObservationSource,'holding');assert.equal(f.passedFeeder,false);assert.equal(f.state,0)
})

test('a first missed-approach report still requires recovery instead of restoring ordinary TMA sequencing',()=>{
 const input=packet({topskyMissedApproach:true}),edits=reconcileRunwayAssignments(input,{}),s=first(input,fixture.config,edits),f=s.flights[0]
 assert.equal(f.mode,'missed');assert.equal(toJuhaSequence(s,fixture.config,edits).sequence.length,0)
})

test('Recompute and explicit landed state retain normal TMA phase handling',()=>{
 const s=first(),edits={SAS71HG:{recomputeAt:s.timestamp+2000,changedAt:s.timestamp+2000},LOT457:{landedAt:s.timestamp+2000}}
 const next=runEngine({...structuredClone(fixture.input),timestamp:s.timestamp+2000},fixture.config,edits,s)
 assert.equal(get(next,'SAS71HG').state,2);assert.equal(get(next,'LOT457').state,4)
})


test('a newly seen climbing aircraft cannot use known feeder geometry to skip startup confirmation',()=>{
 const input=packet({verticalSpeed:2000}),s=first(input),f=s.flights[0]
 assert.equal(f.issue,'');assert.equal(f.passedFeeder,true);assert.equal(f.ff,'NILUG');assert.equal(f.state,0)
 const at=s.timestamp+2000,next=runEngine({...input,timestamp:at},fixture.config,{SAS71HG:{recomputeAt:at,changedAt:at}},s)
 assert.equal(get(next,'SAS71HG').state,2,'an explicit TMA Recompute still accepts the current observation immediately')
})

test('local ESSB climb history is not feeder-passage proof and its first Recompute can enter ahead of distant traffic',()=>{
 const at=Date.UTC(2026,9,18,12,59,25),c={...structuredClone(DEFAULT_CONFIG),active:['ESSA/19R'],departureRunway:'ESSA/19L',unstableSeconds:60,minimumNewSeconds:0}
 const peer={callsign:'EZY350',aircraft:'A320',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'19R',route:[{name:'ELTOK',seconds:100}],landingSeconds:1800,distanceNm:100,groundspeed:250,altitude:15000,positionAgeSeconds:0}
 const local={callsign:'SAS123',aircraft:'A20N',wake:'M',departure:'ESSB',arrival:'ESSA',runway:'',latitude:59.35613,longitude:17.93677,heading:307,groundspeed:81,altitude:562,verticalSpeed:2096,landingSeconds:240,positionAgeSeconds:2,
  route:[{name:'ESSB',latitude:59.35444399999999,longitude:17.942221999999994,seconds:-60},{name:'ESSA',latitude:59.65194399999999,longitude:17.918611,seconds:240}]}
 const input=(t,flights)=>({timestamp:t,source:'ESSA_FMP',runways:{'ESSA/19R':STAR_RUNWAYS['19R']},flights})
 const seed=runEngine(input(at-120000,[peer]),c,{})
 const accepted=runEngine(input(at-60000,[{...peer,landingSeconds:1740,route:[{name:'ELTOK',seconds:40}]}]),c,{},seed)
 assert.equal(get(accepted,'EZY350').state,2)
 const firstLocal=runEngine(input(at,[peer,local]),c,{},accepted)
 assert.equal(get(firstLocal,'SAS123').ff,'-');assert.equal(get(firstLocal,'SAS123').passedFeeder,true)
 const secondLocal=runEngine(input(at+2000,[peer,{...local,positionAgeSeconds:4}]),c,{},firstLocal)
 assert.equal(get(secondLocal,'SAS123').state,0,'inherited local-TMA entry is not known feeder-passage evidence')
 const recomputeAt=at+4000,climbing={...local,latitude:59.36318,longitude:17.91732,heading:308,groundspeed:134,altitude:2230,verticalSpeed:8756,positionAgeSeconds:4}
 const result=runEngine(input(recomputeAt,[peer,climbing]),c,{SAS123:{recomputeAt,changedAt:recomputeAt}},secondLocal)
 const f=get(result,'SAS123'),leader=get(result,'EZY350')
 assert.equal(f.state,2);assert.equal(f.issue,'');assert.equal(f.order,0);assert.ok(f.sta<leader.sta)
 assert.ok(Math.abs(f.sta-f.liveBufferedEta)<1);assert.equal(f.delay,0)
})
