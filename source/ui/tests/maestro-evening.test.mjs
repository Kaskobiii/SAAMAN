import test from 'node:test'
import assert from 'node:assert/strict'
import {runEngine,wakeInterval} from '../src/maestro-engine.ts'
import {predictLanding} from '../src/maestro-landing-prediction.ts'
import {usableRecoveryApproach} from '../src/maestro-recovery.ts'
import fixture from './fixtures/recording12-evening.json' with {type:'json'}
const event=frame=>structuredClone(fixture.cases.find(c=>c.frame===frame))
const calculate=c=>runEngine(c.input,c.config,c.edits,{...c.previous,timestamp:c.input.timestamp-1})
const flight=(s,name)=>s.flights.find(f=>f.callsign===name)
function spaced(s,c){
 const q=s.flights.filter(f=>f.mode==='sequenced'&&f.state!==4&&!f.issue&&f.landingEtaAvailable!==false).sort((a,b)=>a.order-b.order)
 for(let i=1;i<q.length;i++){
  const a=q[i-1],b=q[i];if(a.runway!==b.runway)continue
  const gap=Math.max(c.rates[`ESSA/${b.runway}`],wakeInterval(a.wake,b.wake,`ESSA/${b.runway}`,c))*1000+(a.slotAfter+b.slotBefore)*60000
  assert.ok(b.sta>=a.sta+gap-2,`${a.callsign}/${b.callsign}: required runway spacing`)
 }
}
test('recording 12 bulk Recompute uses refreshed times when a selected flight promotes to Frozen',()=>{
 const c=event(798),s=calculate(c)
 assert.ok(flight(s,'NOZ842').delay<240,'old projected slot must not create L09:37')
 assert.ok(flight(s,'NOZ842').state>=2)
 assert.ok(flight(s,'SAS126').delay<300)
 spaced(s,c.config)
})
test('recording 12 partial Recompute inserts before flexible upstream automatic slots',()=>{
 const c=event(1146),s=calculate(c)
 assert.ok(flight(s,'EWG4BW').delay<115,'do not wait until the back of the whole Stable group')
 assert.equal(flight(s,'NOZ842').sta,flight(c.previous,'NOZ842').sta,'manual TMA target remains protected')
 spaced(s,c.config)
})
test('recording 12 moving SN2297 does not refresh SAS126 instruction or delay untouched SAS4CV',()=>{
 const c=event(1281),s=calculate(c),before=flight(c.previous,'SAS126'),after=flight(s,'SAS126')
 assert.equal(after.sta,before.sta)
 assert.equal(after.delay,before.delay,'unchanged manual target retains G22 instead of L04:41')
 assert.ok(flight(s,'SAS4CV').delay<10)
 spaced(s,c.config)
})
test('recording 12 explicit ERXEC reinsertion shifts automatic followers instead of taking a tail slot',()=>{
 const c=event(1439),s=calculate(c),f=flight(s,'SAS126')
 assert.equal(f.landingPrediction.method,'recovery-iaf')
 assert.ok(f.delay<=115,'real spacing, not the old L07:59 tail allocation')
 assert.equal(flight(s,'SN2297').sta,c.edits.SN2297.target,'manual target remains fixed')
 assert.ok(flight(s,'EWG4BW').sta>=flight(c.previous,'EWG4BW').sta)
 spaced(s,c.config)
})
for(const v of fixture.vectors)test(`recording 12 ${v.callsign} heading estimate excludes the restored FLEG`,()=>{
 const first=predictLanding(v.flight,v.config,1,undefined,v.timestamp)
 const restored={...v.flight,landingSeconds:v.flight.landingSeconds+1800,route:v.flight.route.map(q=>({...q,seconds:q.seconds<0?q.seconds:q.seconds+1800}))}
 const second=predictLanding(restored,v.config,1,first,v.timestamp+11*60000)
 assert.equal(first.method,'vector-position');assert.equal(second.method,'vector-position')
 assert.equal(second.seconds,first.seconds)
 const error=Math.abs(v.timestamp+first.seconds*1000-v.actual)
 assert.ok(error<90000,'observed threshold crossing within 90 seconds for this sample')
 assert.ok(error<Math.abs(v.recordedEta-v.actual))
 assert.equal(usableRecoveryApproach(v.flight,first),false,'a vector estimate alone is not an approach clearance after a go-around')
 assert.notEqual(predictLanding({...restored,positionAgeSeconds:16},v.config,1,undefined,v.timestamp).method,'vector-position')
})
