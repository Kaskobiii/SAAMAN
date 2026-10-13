import {test} from 'node:test'
import assert from 'node:assert/strict'
import {arrivalTrajectory,feederTrajectory,surfaceHeadwind,energyVerticalRate} from '../src/maestro-trajectory.ts'
import {DEFAULT_CONFIG as RELEASE_DEFAULT_CONFIG,validateTelemetry,runEngine} from '../src/maestro-engine.ts'
import {STAR_FEEDERS,STAR_RUNWAYS} from '../src/maestro-star-prediction.ts'
const DEFAULT_CONFIG={...RELEASE_DEFAULT_CONFIG,timingModel:'performance'}

const config=()=>({...structuredClone(DEFAULT_CONFIG),surfaceWindAuto:false,surfaceWindDirection:0,surfaceWindSpeed:0})
const input=(extra={})=>({distanceNm:49,altitudeFeet:18000,heading:190,aircraft:'A320',wake:'M',initialGroundspeed:400,...extra})
test('energy accounting gives the correct acceleration and descent tradeoff',()=>{
    assert.equal(energyVerticalRate(-1800,250,18000,0,5),-1800)
    assert.ok(energyVerticalRate(-1800,250,18000,-2,5)>-1800,'deceleration leaves less descent for the same energy loss')
    assert.ok(energyVerticalRate(-1800,250,18000,2,5)<-1800)
    assert.ok(energyVerticalRate(1800,250,18000,2,5)<1800,'acceleration consumes climb energy')
})
test('trajectory carries altitude and CAS continuously and reaches its stated endpoint',()=>{
    const r=arrivalTrajectory(input(),config())
    assert.ok(r.feasible);assert.ok(r.endAltitudeFeet<=350);assert.ok(r.endCasKnots<=155)
    assert.ok(r.samples.length>5);assert.equal(r.samples[0].altitudeFeet,18000)
    for(let i=1;i<r.samples.length;i++){
        const a=r.samples[i-1],b=r.samples[i]
        assert.ok(b.seconds>a.seconds);assert.ok(b.remainingNm<a.remainingNm);assert.ok(b.altitudeFeet<=a.altitudeFeet)
        assert.ok(Math.abs(b.casKnots-a.casKnots)<=(b.seconds-a.seconds)*.5+1e-5)
    }
})
test('observed final does not manufacture a path extension to conceal impossible simulator altitude',()=>{
    const r=arrivalTrajectory(input({distanceNm:2,altitudeFeet:10000,initialGroundspeed:250,observedFinal:true}),config())
    assert.equal(r.pathNm,2);assert.equal(r.requiredExtensionNm,0);assert.equal(r.feasible,false);assert.ok(r.endAltitudeFeet>5000)
})
test('short high arrival reports additional track instead of extending elapsed time at the threshold',()=>{
    const r=arrivalTrajectory(input({distanceNm:10,altitudeFeet:18000}),config())
    assert.ok(r.requiredExtensionNm>5);assert.ok(r.pathNm>10);assert.ok(r.assumptions.some(s=>s.includes('unconfirmed')))
})
test('surface wind is bounded to the layer it describes',()=>{
    const c={...config(),surfaceWindDirection:190,surfaceWindSpeed:30}
    assert.equal(surfaceHeadwind(190,18000,c),0);assert.equal(surfaceHeadwind(190,2000,c),30)
    assert.equal(surfaceHeadwind(10,2000,c),-30)
})
test('numerical integration converges when the timestep is halved',()=>{
    const a=arrivalTrajectory(input({integrationStepSeconds:5}),config()),b=arrivalTrajectory(input({integrationStepSeconds:2.5}),config())
    assert.ok(Math.abs(a.seconds-b.seconds)<10);assert.ok(Math.abs(a.requiredExtensionNm-b.requiredExtensionNm)<1)
})
test('unknown types remain explicit generic assumptions rather than matched performance',()=>{
    const r=arrivalTrajectory(input({aircraft:'UNKN'}),config())
    assert.ok(Number.isFinite(r.seconds));assert.ok(r.assumptions.some(s=>s.includes('fallback')))
})
test('an assigned speed below the configured approach envelope is not marked feasible',()=>{
    const r=arrivalTrajectory(input({assignedSpeed:100}),config())
    assert.equal(r.feasible,false);assert.ok(r.assumptions.some(s=>s.includes('below configured')))
})
test('acceleration candidate starts at the same observed speed',()=>{
    const p={aircraft:'A320',wake:'M',altitude:18000,groundspeed:180,heading:190,verticalSpeed:0}
    const a=feederTrajectory(80,p,config()),b=feederTrajectory(80,p,config(),220)
    assert.ok(b.seconds<a.seconds);assert.ok(a.complete&&b.complete)
    assert.ok(b.seconds>80/220*3600,'instantaneous acceleration would be optimistic')
})

test('Mach assignments accept both SDK representations without changing their meaning',()=>{
    const now=Date.UTC(2026,9,11),p={callsign:'TEST',aircraft:'A320',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'19L',route:[],landingSeconds:1200,distanceNm:80,groundspeed:420,altitude:30000}
    const a=validateTelemetry({source:'LIVE',timestamp:now,flights:[{...p,assignedMach:75}]},now)
    const b=validateTelemetry({source:'LIVE',timestamp:now,flights:[{...p,assignedMach:750}]},now)
    assert.equal(a.flights[0].assignedMach,75);assert.equal(b.flights[0].assignedMach,75)
    assert.equal(feederTrajectory(100,a.flights[0],config()).seconds,feederTrajectory(100,b.flights[0],config()).seconds)
})
test('an observed departure climb continues toward its entry level on a short feeder leg',()=>{
    const result=feederTrajectory(20,{aircraft:'A320',wake:'M',altitude:2000,groundspeed:180,verticalSpeed:1800,finalAltitude:30000},config())
    assert.ok(result.altitudeFeet>2000,'the descent-planning zone must not suppress an observed climb')
    assert.ok(result.altitudeFeet<=18000)
})
test('a lower cleared level is respected in the pre-feeder descent plan',()=>{
    const result=feederTrajectory(160,{aircraft:'A320',wake:'M',altitude:30000,groundspeed:400,verticalSpeed:-1000,clearedAltitude:11000},config())
    assert.ok(result.altitudeFeet<=11001);assert.ok(result.complete)
})

test('a uniformly spaced 28-per-hour stream does not receive delay at 42-per-hour capacity',()=>{
    const c={...config(),active:['ESSA/19L'],unstableSeconds:0,minimumNewSeconds:0,rates:{...config().rates,'ESSA/19L':85}}
    const now=Date.UTC(2026,9,11),ff=STAR_FEEDERS.ELTOK,threshold=STAR_RUNWAYS['19L']
    const flights=Array.from({length:18},(_,i)=>{
        const nm=i*(3600/28)*400/3600
        return {callsign:`TEST${i}`,aircraft:'A320',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'19L',star:'ELTOK8P',route:[{name:'ELTOK',...ff,seconds:99999},{name:'SA19L',...threshold,seconds:99999}],landingSeconds:99999,distanceNm:100,groundspeed:400,altitude:18000,positionAgeSeconds:0,latitude:ff.latitude,longitude:ff.longitude-nm/(60*Math.cos(ff.latitude*Math.PI/180))}
    })
    const result=runEngine({source:'LIVE',timestamp:now,flights},c,{})
    assert.equal(result.flights.length,18)
    assert.ok(result.flights.every(f=>!f.issue&&!f.spacingConflict&&Math.abs(f.delay)<2))
    assert.ok(result.flights.every(f=>f.guidance?.validUntil===now+15000))
})
test('an explicit controller gain is published even when the nominal path requires review',()=>{
    const ff=STAR_FEEDERS.ELTOK,threshold=STAR_RUNWAYS['19L'],now=Date.UTC(2026,9,11)
    const c={...config(),active:['ESSA/19L'],unstableSeconds:0,minimumNewSeconds:0,frozenMinutes:0,stableMinutes:60,superStableMinutes:0}
    const p={callsign:'TEST',aircraft:'A320',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'19L',route:[{name:'ELTOK',...ff,seconds:0},{name:'SA19L',...threshold,seconds:9999}],landingSeconds:9999,distanceNm:50,groundspeed:400,altitude:18000,positionAgeSeconds:0,...ff}
    p.longitude-=.3
    const input={source:'LIVE',timestamp:now,flights:[p]},first=runEngine(input,c,{})
    assert.equal(first.flights[0].state,1)
    const next=runEngine({...input,timestamp:now+1000},c,{TEST:{target:first.flights[0].eta-120000}},first)
    assert.ok(next.flights[0].delay<0);assert.equal(next.flights[0].gainCapacitySeconds,0)
    assert.ok(next.flights[0].guidance.constraints.some(s=>s.includes('requested gain exceeds')))
})
