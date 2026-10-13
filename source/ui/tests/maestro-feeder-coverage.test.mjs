import test from 'node:test'
import assert from 'node:assert/strict'
import {feederCoverage,ESSA_FEEDERS} from '../src/maestro-feeder-coverage.ts'
const c=(callsign,extras={})=>({callsign,facility:callsign.endsWith('_CTR')?6:5,controller:true,...extras})
test('standalone ESOS 1 or 3 covers every ESSA feeder',()=>{
    for(const callsign of ['ESOS_1_CTR','ESOS_3_CTR'])assert.deepEqual(feederCoverage(c(callsign)).feeders,[...ESSA_FEEDERS])
})
test('combined ESOS 1 and 3 split south/east and west/north according to sector ownership',()=>{
    const online=[c('ESOS_1_CTR'),c('ESOS_3_CTR')]
    assert.deepEqual(feederCoverage(online[0],online).feeders,['NILUG','XILAN'])
    assert.deepEqual(feederCoverage(online[1],online).feeders,['ELTOK','VACRA'])
})
test('a feeder sector joining below the covering center removes that fix, and leaving restores it',()=>{
    const own=c('ESOS_1_CTR')
    assert.deepEqual(feederCoverage(own).feeders,[...ESSA_FEEDERS])
    assert.deepEqual(feederCoverage(own,[c('ESOS_8_CTR')]).feeders,['NILUG','VACRA','XILAN'])
    assert.deepEqual(feederCoverage(own,[c('ESOS_8_CTR'),c('ESOS_6_CTR')]).feeders,['NILUG','VACRA'])
    assert.deepEqual(feederCoverage(own,[c('ESOS_6_CTR')]).feeders,['NILUG','ELTOK','VACRA'])
})
test('ARR-W covers only ELTOK; receiving APPs neither acquire feeders nor remove upstream coverage',()=>{
    const west=c('ESSA_W_APP'),east=c('ESSA_E_APP'),director=c('ESSA_W_DEP'),center=c('ESOS_1_CTR')
    assert.equal(feederCoverage(west,[center]).view,'ARR-W');assert.deepEqual(feederCoverage(west,[center]).feeders,['ELTOK'])
    assert.deepEqual(feederCoverage(center,[west,east,director]).feeders,['NILUG','VACRA','XILAN'])
    assert.deepEqual(feederCoverage(center,[east,director]).feeders,[...ESSA_FEEDERS])
    for(const receiver of [east,director,c('ESSA_APP')]){const coverage=feederCoverage(receiver,[center]);assert.equal(coverage.view,null);assert.deepEqual(coverage.feeders,[])}
})
test('feeder ownership respects the actual lower-sector priority chains',()=>{
    const online=['ESOS_2_CTR','ESOS_7_CTR','ESOS_9_CTR','ESOS_4_CTR','ESOS_F_CTR','ESOS_N_CTR','ESOS_6_CTR'].map(cs=>c(cs))
    assert.deepEqual(feederCoverage(c('ESOS_2_CTR'),online).feeders,['NILUG'])
    assert.deepEqual(feederCoverage(c('ESOS_7_CTR'),online).feeders,[])
    assert.deepEqual(feederCoverage(c('ESOS_9_CTR'),online).feeders,[])
    assert.deepEqual(feederCoverage(c('ESOS_4_CTR'),online).feeders,['VACRA'])
    assert.deepEqual(feederCoverage(c('ESOS_6_CTR'),online).feeders,['XILAN'])
})
test('EuroScope position IDs and alternate callsigns are understood; observers cannot steal coverage',()=>{
    assert.deepEqual(feederCoverage(c('ESOS_OTHER_CTR',{positionId:'S1'})).feeders,[...ESSA_FEEDERS])
    assert.deepEqual(feederCoverage(c('ESOS_1_2_CTR'),[c('ESOS_8_CTR',{controller:false}),c('ESSA_W_APP',{facility:0})]).feeders,[...ESSA_FEEDERS])
    assert.deepEqual(feederCoverage(c('ESSA_W_1_APP')).feeders,['ELTOK'])
})
test('ESAA fallback covers unstaffed feeders; unknown demo/local identities keep the manual feeder view',()=>{
    assert.deepEqual(feederCoverage(c('ESAA_CTR'),[c('ESOS_8_CTR')]).feeders,['NILUG','VACRA','XILAN'])
    assert.equal(feederCoverage(c('SAAMAN_NATIVE_TEST')).detected,false)
    assert.deepEqual(feederCoverage(c('SAAMAN_NATIVE_TEST')).feeders,[...ESSA_FEEDERS])
})
test('handover positions preserve their sector identity and delegation',()=>{
    assert.deepEqual(feederCoverage(c('ESOS_1__CTR')).feeders,[...ESSA_FEEDERS])
    assert.deepEqual(feederCoverage(c('ESOS_1__CTR'),[c('ESOS_8__CTR')]).feeders,['NILUG','VACRA','XILAN'])
    assert.deepEqual(feederCoverage(c('ESOS_1_CTR'),[c('ESOS_1__CTR')]).feeders,[...ESSA_FEEDERS])
    assert.deepEqual(feederCoverage(c('ESSA_W__APP')).feeders,['ELTOK'])
})
