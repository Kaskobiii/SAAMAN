import test from 'node:test'
import assert from 'node:assert/strict'
import {reviewLiveTiming} from '../src/maestro-timing-review.ts'
import {STAR_RUNWAYS} from '../src/maestro-star-prediction.ts'
const t=Date.UTC(2026,9,26),copy=v=>JSON.parse(JSON.stringify(v)),rwy=STAR_RUNWAYS['19L']
function point(along,cross=0){const h=rwy.heading*Math.PI/180,x=-along*Math.sin(h)+cross*Math.cos(h),y=-along*Math.cos(h)-cross*Math.sin(h);return {latitude:rwy.latitude+y/60,longitude:rwy.longitude+x/(60*Math.cos(rwy.latitude*Math.PI/180))}}
function recording(){
 const frame=(ms,along,altitude)=>({input:{timestamp:t+ms,source:'ESSA_FMP',simulation:false,flights:[{callsign:'TEST1',aircraft:'A320',wake:'M',arrival:'ESSA',departure:'EPWA',runway:'19L',heading:rwy.heading,groundspeed:200,altitude,verticalSpeed:0,positionAgeSeconds:0,...point(along),route:0,times:[600-ms/1000]}]},plan:0,results:[]})
 return {format:'saaman-recording-1',engine:'1.3.41',initial:{timestamp:t,source:'ESSA_FMP',simulation:false,flights:[]},plans:[{config:{},edits:{}}],routes:[[{name:'SA19L',...rwy}]],frames:[frame(0,30,10000),frame(310000,12,6000),frame(320000,11.8,5800),frame(599000,.04,150),frame(601000,-.04,140)],timingCaptures:[{callsign:'TEST1',at:t,kind:'initial',frame:0,plan:0,baseline:{at:t,runway:'ESSA/19L',landingMethod:'aircraft-profile',eta:t+630000}}]}
}
test('a live scorecard measures recorded forecast against gated threshold passage, not the Landed cache',()=>{
 const r=recording();r.initial.landings=[{callsign:'TEST1',time:t+1,runway:'ESSA/19L'}]
 const report=reviewLiveTiming(r),row=report.rows[0]
 assert.equal(report.thresholdPasses,1);assert.equal(row.stage,'landing');assert.equal(row.kind,'initial');assert.ok(Math.abs(row.errorSeconds-30)<.01);assert.equal(row.cleanCalibration,true);assert.equal(row.horizon,'5-15')
})
test('initial and Recompute groups stay separate and repeated captures do not overweight one aircraft',()=>{
 const r=recording();for(const [ms,eta] of [[310000,660000],[320000,690000]])r.timingCaptures.push({callsign:'TEST1',at:t+ms,kind:'recompute',baseline:{at:t+ms,runway:'19L',landingMethod:'aircraft-profile',eta:t+eta}})
 const result=reviewLiveTiming(r),groups=result.groups
 assert.equal(groups.length,2);assert.equal(groups.find(g=>g.kind==='initial').observed.aircraft,1)
 assert.equal(groups.find(g=>g.kind==='recompute').observed.aircraft,1);assert.ok(Math.abs(groups.find(g=>g.kind==='recompute').observed.medianErrorSeconds-60)<.01)
})
test('any simulated or mixed-session telemetry excludes the entire recording',()=>{
 const r=recording();r.frames[2].input.simulation=true;assert.equal(reviewLiveTiming(r).excluded,'simulation')
 const unknown=recording();delete unknown.initial.simulation;assert.equal(reviewLiveTiming(unknown).excluded,'live-status-unavailable')
})
test('first visible input cannot be relabeled as an original capture',()=>{
 const r=recording();r.timingCaptures=[];r.initial.flights=[{callsign:'TEST1',initialEta:t+630000,euroscopeBaseline:{at:t-60000,eta:t+630000}}];r.unavailableCaptures=[{callsign:'TEST1',at:t-60000,reason:'before-recording'}]
 const result=reviewLiveTiming(r);assert.equal(result.rows.length,0);assert.equal(result.unavailableCaptures,1)
})
test('retained original evidence before recording is scored separately from clean calibration',()=>{
 const r=recording();r.timingCaptures=[];r.originalTimingCaptures=[{callsign:'TEST1',at:t-60000,evidence:{at:t-60000,provenance:'capture-summary',engine:'SAAMAN 1.3.40',input:{runway:'19L',altitude:10000},model:{method:'aircraft-profile'},accepted:{eta:t+630000}}}]
 const row=reviewLiveTiming(r).rows[0];assert.equal(row.kind,'initial');assert.equal(row.engine,'SAAMAN 1.3.40');assert.ok(row.flags.includes('capture-before-recording'));assert.equal(row.cleanCalibration,false)
})
test('runway changes and heading/HOLD clearances are flagged instead of silently contaminating calibration',()=>{
 const r=recording();r.timingCaptures[0].baseline.runway='19R';r.frames[1].input.flights[0].assignedHeading=250;r.frames[2].input.flights[0].topskyHoldingPoint='NILUG'
 const row=reviewLiveTiming(r).rows[0];assert.ok(row.flags.includes('different-landing-runway'));assert.ok(row.flags.includes('runway-change'));assert.ok(row.flags.includes('heading-clearance'));assert.ok(row.flags.includes('holding'));assert.equal(row.cleanCalibration,false)
})
test('lateral or stale tracks cannot manufacture an observed runway passage',()=>{
 const r=recording();for(const fr of r.frames.slice(-2))Object.assign(fr.input.flights[0],point(fr.input.timestamp<t+600000?.04:-.04,1));assert.equal(reviewLiveTiming(r).thresholdPasses,0)
 const stale=recording();stale.frames.at(-1).input.flights[0].positionAgeSeconds=20;assert.equal(reviewLiveTiming(stale).thresholdPasses,0)
})

test('tracking interruptions, invalid speed and recorded missed-approach mode prevent clean calibration',()=>{
 const r=recording();r.frames[0].input.flights[0].speedDataValid=false;r.frames[1].input.flights[0].positionAgeSeconds=19;r.frames[2].results=[{callsign:'TEST1',mode:'missed'}]
 const row=reviewLiveTiming(r).rows[0];assert.ok(row.flags.includes('tracking-interruption'));assert.ok(row.flags.includes('unreliable-capture-speed'));assert.ok(row.flags.includes('missed-approach'));assert.equal(row.cleanCalibration,false)
})
