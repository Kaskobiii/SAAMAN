import {test} from 'node:test'
import assert from 'node:assert/strict'
import {normalizeTopSkySpeed} from '../src/maestro-assigned-speed.ts'
import {DEFAULT_CONFIG,runEngine,validateTelemetry} from '../src/maestro-engine.ts'
import {recordedTelemetry} from '../src/maestro-recording.ts'

const time=Date.UTC(2026,9,21,12)
const plane={callsign:'TEST123',aircraft:'A320',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'19R',route:[{name:'ELTOK',seconds:600},{name:'ESSA',seconds:1500}],landingSeconds:1500,distanceNm:100,groundspeed:350,altitude:25000}
const packet=(timestamp,extra={})=>({source:'LIVE',timestamp,flights:[{...plane,...extra}]})

test('TopSky HS sentinel is normalized without altering real IAS, Mach or source data',()=>{
 const raw={...plane,assignedSpeed:999,assignedMach:78}
 const fixed=normalizeTopSkySpeed(raw)
 assert.equal(fixed.assignedSpeed,0);assert.equal(fixed.topskyHighSpeed,true);assert.equal(fixed.assignedMach,78)
 assert.equal(raw.assignedSpeed,999)
 for(const assignedSpeed of [0,160,250,600,750,998,1000,-1,NaN]){
  const p={...plane,assignedSpeed};assert.equal(normalizeTopSkySpeed(p),p)
 }
})

test('legacy HS warning is repaired while other unavailable speed inputs remain guarded',()=>{
 const warning='Assigned speed 999 unavailable; speed-based gain disabled'
 const fixed=normalizeTopSkySpeed({...plane,assignedSpeed:0,topskyHighSpeed:true,speedDataValid:false,dataWarnings:[warning]})
 assert.deepEqual(fixed.dataWarnings,[]);assert.equal(fixed.speedDataValid,undefined)
 const other=normalizeTopSkySpeed({...plane,assignedSpeed:999,speedDataValid:false,dataWarnings:[warning,'assignedMach unavailable']})
 assert.deepEqual(other.dataWarnings,['assignedMach unavailable']);assert.equal(other.speedDataValid,false)
 assert.equal(normalizeTopSkySpeed({...plane,assignedSpeed:999,speedDataValid:false}).speedDataValid,false)
})

test('validation accepts HS, keeps Mach and retains diagnostics for genuinely invalid IAS',()=>{
 const good=validateTelemetry(packet(time,{assignedSpeed:999,assignedMach:780}),time).flights[0]
 assert.equal(good.assignedSpeed,0);assert.equal(good.topskyHighSpeed,true);assert.equal(good.assignedMach,78)
 assert.notEqual(good.speedDataValid,false);assert.deepEqual(good.dataWarnings,[])
 const bad=validateTelemetry(packet(time,{assignedSpeed:750}),time).flights[0]
 assert.equal(bad.assignedSpeed,0);assert.equal(bad.speedDataValid,false);assert.match(bad.dataWarnings[0],/750/)
 const badMach=validateTelemetry(packet(time,{assignedSpeed:999,assignedMach:150}),time).flights[0]
 assert.equal(badMach.speedDataValid,false);assert.deepEqual(badMach.dataWarnings,['assignedMach unavailable'])
 assert.throws(()=>validateTelemetry(packet(time,{topskyHighSpeed:'true'}),time),/high-speed flag/)
 const invalidFlag=validateTelemetry(packet(time,{assignedSpeed:'999',topskyHighSpeed:true}),time)
 assert.equal(invalidFlag.flights[0].speedDataValid,false)
 assert.equal(invalidFlag.flights[0].topskyHighSpeed,undefined)
 assert.match(invalidFlag.flights[0].dataWarnings[0],/string 999/)
 const guarded=runEngine(invalidFlag,structuredClone(DEFAULT_CONFIG),{}).flights[0]
 assert.equal(guarded.speedDataValid,false);assert.ok(guarded.dataWarnings.length)
})

test('HS flag correction is recorded once per activation and survives checkpoint and recording',()=>{
 const config=structuredClone(DEFAULT_CONFIG)
 let result=runEngine(packet(time,{assignedSpeed:999}),config,{})
 assert.equal(result.flights[0].assignedSpeed,0);assert.equal(result.flights[0].issue,'')
 assert.equal(result.automaticCorrections.filter(e=>e.kind==='speed-flag').length,1)
 assert.equal(recordedTelemetry(result).flights[0].topskyHighSpeed,true)
 result=runEngine(packet(time+1000,{assignedSpeed:0,topskyHighSpeed:true}),config,{},JSON.parse(JSON.stringify(result)))
 assert.equal(result.automaticCorrections.filter(e=>e.kind==='speed-flag').length,1)
 result=runEngine(packet(time+2000,{assignedSpeed:250}),config,{},result)
 result=runEngine(packet(time+3000,{assignedSpeed:999}),config,{},result)
 assert.equal(result.automaticCorrections.filter(e=>e.kind==='speed-flag').length,2)
})
