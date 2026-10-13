import {test} from 'node:test'
import assert from 'node:assert/strict'
import {performanceAt,iasToTas,machToTas,OPENAP_SOURCE,descentSeconds,planningTas} from '../src/maestro-aircraft-performance.ts'
import {openapProfile,openapValues} from '../src/maestro-openap.ts'
import {DEFAULT_CONFIG as RELEASE_DEFAULT_CONFIG,validateConfig,gainCapacitySeconds,runEngine} from '../src/maestro-engine.ts'
import {sharedSettings,settingsUnchanged} from '../src/maestro-settings.ts'
import {STAR_FEEDERS,STAR_RUNWAYS,starPrediction} from '../src/maestro-star-prediction.ts'
import data from '../src/data/openap-profiles.json' with {type:'json'}

test('OpenAP data is pinned; SI conversion, descent sign, Mach and final phase are correct',()=>{
    assert.equal(OPENAP_SOURCE.commit,'a19a1cd559aa51c2ff385a71ee1884a53d866a33')
    assert.equal(Object.keys(data.wrap).length,17);assert.equal(Object.keys(data.properties).length,37)
    const low=openapValues('A320',2500,'descent'),high=performanceAt('A320',35000,'descent','openap')
    assert.ok(Math.abs(low.cas-72/.514444)<1e-6)
    assert.ok(Math.abs(low.descentFpm-3.55*60/.3048)<1e-6)
    assert.ok(Math.abs(high.nominalTas-machToTas(.77,35000))<1e-6)
    assert.equal(high.provider,'openap');assert.equal(high.match,'exact');assert.equal(high.gainEligible,true)
    assert.ok(descentSeconds('A320',3000,150,1800,'openap')>200)
})
test('B38M has exact properties and a disclosed B737 timing proxy, without automatic gain',()=>{
    const p=performanceAt('B38M',15000,'descent','openap')
    assert.equal(p.type,'B38M');assert.equal(p.profileType,'B737');assert.equal(p.match,'proxy');assert.equal(p.gainEligible,false)
    assert.equal(p.vmo,340);assert.ok(p.ceilingFeet>40000)
})
test('ATR-to-E190 synonym is blocked; unsupported types keep explicit fallback',()=>{
    assert.equal(openapProfile('AT76').model,undefined)
    const a=performanceAt('AT76',10000,'descent','openap'),b=performanceAt('AT76',10000)
    assert.equal(a.nominalTas,b.nominalTas);assert.equal(a.match,'fallback');assert.equal(a.gainEligible,false)
    assert.equal(performanceAt('XXXX',10000,'descent','openap'),undefined)
})
test('suspicious VMO values are excluded rather than granting 515 kt capability',()=>{
    assert.equal(OPENAP_SOURCE.rejectedProperties.B788.vmo,515)
    const p=performanceAt('B788',20000,'descent','openap')
    assert.equal(p.vmo,undefined);assert.equal(p.gainEligible,false)
})
test('statistical WRAP means do not override configured speeds, while VMO/MMO constrain them',()=>{
    const p=performanceAt('A320',10000,'descent','openap')
    assert.ok(planningTas(250,10000,'A320','openap')>p.nominalTas)
    assert.ok(Math.abs(planningTas(250,10000,'A320','openap')-iasToTas(250,10000))<1e-6)
    assert.ok(planningTas(500,10000,'A320','openap')<=iasToTas(p.vmo,10000)+1e-6)
    assert.ok(planningTas(500,35000,'A320','openap')<=machToTas(p.mmo,35000)+1e-6)
})
test('every usable OpenAP timing profile returns finite positive values in all phases',()=>{
    for(const type of Object.keys(data.properties))for(const altitude of [0,3000,10000,20000,35000,40000])for(const phase of ['climb','cruise','descent']){
        const p=performanceAt(type,altitude,phase,'openap')
        if(!p)continue
        for(const key of ['nominalTas','nominalIas','climbFpm','descentFpm','ceilingFeet'])assert.ok(Number.isFinite(p[key])&&p[key]>0,`${type}/${altitude}/${phase}/${key}`)
        if(p.vmo)assert.ok(p.nominalIas<=p.vmo+1e-6)
        if(p.mmo)assert.ok(p.nominalTas<=machToTas(p.mmo,altitude)+1e-6)
    }
})
test('OpenAP is opt-in, validated and included in canonical supervised settings',()=>{
    assert.equal(DEFAULT_CONFIG.performanceModel,'euroscope')
    assert.equal(validateConfig({...DEFAULT_CONFIG,performanceModel:undefined}).performanceModel,'euroscope')
    assert.throws(()=>validateConfig({...DEFAULT_CONFIG,performanceModel:'untrusted'}),/performance model/)
    const other={...DEFAULT_CONFIG,performanceModel:'openap'}
    assert.equal(sharedSettings(other).performanceModel,'openap');assert.equal(settingsUnchanged(DEFAULT_CONFIG,other),false)
})
const DEFAULT_CONFIG={...RELEASE_DEFAULT_CONFIG,timingModel:'performance'}

const now=Date.UTC(2026,9,11),ff=STAR_FEEDERS.ELTOK,threshold=STAR_RUNWAYS['19L']
const plane=(type='A320')=>({callsign:'TEST',aircraft:type,wake:'M',departure:'EKCH',arrival:'ESSA',runway:'19L',star:'ELTOK8P',route:[{name:'ELTOK',...ff,seconds:500},{name:'SA19L',...threshold,seconds:1000}],landingSeconds:1000,distanceNm:100,groundspeed:250,altitude:15000,latitude:ff.latitude+1,longitude:ff.longitude,positionAgeSeconds:0})
test('selected model reaches STAR prediction, metadata and gain checks; proxy gain is disabled',()=>{
    const p=plane(),c={...DEFAULT_CONFIG,active:['ESSA/19L'],performanceModel:'openap',minimumNewSeconds:0}
    assert.notEqual(starPrediction(p,c).seconds,starPrediction(p,{...c,performanceModel:'euroscope'}).seconds)
    const snapshot=runEngine({source:'LIVE',timestamp:now,flights:[plane('B38M')]},c,{})
    assert.equal(snapshot.flights[0].aircraftPerformance.provider,'openap')
    assert.equal(snapshot.flights[0].aircraftPerformance.match,'proxy')
    assert.equal(snapshot.flights[0].gainCapacitySeconds,0)
    assert.equal(gainCapacitySeconds(plane('AT76'),c,starPrediction(plane('AT76'),c).distanceProfile),0)
})
test('switching performance provider preserves committed Superstable slot and instruction',()=>{
    const p={...plane(),...ff},c={...DEFAULT_CONFIG,active:['ESSA/19L'],unstableSeconds:0,minimumNewSeconds:0}
    const first=runEngine({source:'LIVE',timestamp:now,flights:[p]},c,{})
    assert.equal(first.flights[0].state,2)
    const next=runEngine({source:'LIVE',timestamp:now+1000,flights:[p]},{...c,performanceModel:'openap'},{},first)
    assert.equal(next.flights[0].state,2);assert.equal(next.flights[0].sta,first.flights[0].sta);assert.equal(next.flights[0].delay,first.flights[0].delay)
})
