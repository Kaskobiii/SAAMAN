import {test} from 'node:test'
import assert from 'node:assert/strict'
import {distanceGatedApproachSpeed,predictRouteTiming,PHASE_REFERENCES} from '../src/maestro-route-timing.ts'
import {iasToTas,machToTas} from '../src/maestro-aircraft-performance.ts'
import fixture from './fixtures/hdjt-approach-distance.json' with {type:'json'}

const c=fixture.cases.find(c=>c.frame===286),p=c.flights.find(p=>p.callsign==='OY15B')

test('approach speed is reached at 8 NM, with smooth slowdown confined to the last 12 NM',()=>{
 const speed=d=>distanceGatedApproachSpeed(d,250,160,112)
 assert.equal(speed(66),250);assert.equal(speed(46),250);assert.equal(speed(12),250)
 assert.equal(speed(10),205);assert.equal(speed(8),160);assert.equal(speed(6),136)
 assert.equal(speed(4),112);assert.equal(speed(0),112)
 for(const d of [4,8,12])assert.ok(Math.abs(speed(d+.0001)-speed(d-.0001))<.01)
})

test('the distance stages preserve every bundled type speed without accelerating slow aircraft',()=>{
 for(const [type,ref] of Object.entries(PHASE_REFERENCES)){
  const phase=Math.min(ref.descentIas??ref.approachIas,250),approach=Math.min(ref.approachIas,180)
  for(const d of [0,2,4,6,8,10,12,20,60]){
   const speed=distanceGatedApproachSpeed(d,phase,approach,ref.landingIas)
   assert.ok(Number.isFinite(speed)&&speed>0&&speed<=phase,type+' '+d)
   if(d>=12)assert.equal(speed,phase,type)
   if(d===8)assert.equal(speed,Math.min(phase,approach),type)
  }
 }
 assert.equal(distanceGatedApproachSpeed(8,240,250,130),240,'J328 higher approach reference cannot accelerate its descent')
 assert.equal(distanceGatedApproachSpeed(50,140,100,70),140,'slow types are not raised to 250')
})

test('the recorded HondaJet no longer spends 22 minutes from NILUG to runway 26',()=>{
 const copy=structuredClone({p,config:c.config}),r=predictRouteTiming(p,c.config)
 assert.ok(r);assert.equal(r.profile.type,'HDJT');assert.ok(Math.abs(r.distanceNm-r.beforeFeederNm-66.08860460616685)<.00001)
 assert.ok(r.afterFeederSeconds>16*60&&r.afterFeederSeconds<18*60)
 assert.ok(Math.abs(r.feeder.seconds-409.27010601890066)<.00001,'the observed cruise leg remains anchored to the same speed')
 assert.equal(r.seconds,r.feeder.seconds+r.afterFeederSeconds)
 assert.deepEqual({p,config:c.config},copy)
})

test('a type approach-speed reference cannot change the upstream feeder ETA when approach is still far away',()=>{
 const refs={...PHASE_REFERENCES,HDJT:{...PHASE_REFERENCES.HDJT,approachIas:230}},a=predictRouteTiming(p,c.config),b=predictRouteTiming(p,c.config,refs)
 assert.ok(a&&b);assert.equal(a.feeder.seconds,b.feeder.seconds)
 assert.ok(a.afterFeederSeconds>b.afterFeederSeconds,'the faster reference affects only the close approach')
})

test('an aircraft already flying slowly far out remains modeled without predicted acceleration',()=>{
 const slow={...p,altitude:5000,groundspeed:iasToTas(160,5000),verticalSpeed:0,assignedSpeed:0}
 const a=predictRouteTiming(slow,c.config)
 assert.ok(a);assert.equal(a.profile.type,'HDJT')
 assert.ok(a.seconds>=a.distanceNm/slow.groundspeed*3600-(slow.positionAgeSeconds??0)-.001)
 const matching=predictRouteTiming({...slow,assignedSpeed:160},c.config)
 assert.ok(matching);assert.equal(matching.profile.observedSpeedRatio,1,'an aircraft at its cleared reference is not calibrated as an additional speed deficit')
 assert.equal(matching.feeder.seconds,a.feeder.seconds,'the level upstream segment stays anchored to observed GS')
 // Holding 160 IAS while descending yields lower TAS than holding the
 // current observed GS. That small terminal difference is physically valid.
 assert.ok(matching.seconds>=a.seconds&&matching.seconds<a.seconds+60,'constant IAS during descent adds only the terminal speed difference')
 const lower=predictRouteTiming({...slow,assignedSpeed:140},c.config)
 assert.ok(lower);assert.ok(lower.seconds>=matching.seconds)
})

test('a newly assigned lower IAS or Mach remains a future cap without rejecting a credible current speed',()=>{
 const altitude=5000,fast={...p,altitude,groundspeed:iasToTas(250,altitude),verticalSpeed:0,assignedSpeed:0,assignedMach:0}
 const unchanged=structuredClone(fast),free=predictRouteTiming(fast,c.config),restricted=predictRouteTiming({...fast,assignedSpeed:160},c.config)
 assert.ok(free&&restricted)
 assert.equal(restricted.profile.observedSpeedRatio,free.profile.observedSpeedRatio,'the unsettled current GS uses its credible phase reference')
 assert.ok(restricted.seconds>free.seconds,'the future lower IAS still lengthens the route forecast')
 assert.ok(restricted.entryGroundspeed<=iasToTas(160,altitude))
 const mach={...fast,altitude:30000,groundspeed:machToTas(.72,30000)},machFree=predictRouteTiming(mach,c.config),machRestricted=predictRouteTiming({...mach,assignedMach:45},c.config)
 assert.ok(machFree&&machRestricted)
 assert.equal(machRestricted.profile.observedSpeedRatio,machFree.profile.observedSpeedRatio)
 assert.ok(machRestricted.seconds>machFree.seconds,'a newly assigned Mach restriction is still applied')
 assert.deepEqual(fast,unchanged)
})

test('one-unit IAS and Mach clearance changes cannot switch the calibration reference abruptly',()=>{
 const fast={...p,altitude:5000,groundspeed:iasToTas(250,5000),verticalSpeed:0,assignedMach:0}
 // These clearances straddle the former GS / cleared-speed 1.4 switch.
 const ias178=predictRouteTiming({...fast,assignedSpeed:178},c.config),ias179=predictRouteTiming({...fast,assignedSpeed:179},c.config)
 assert.ok(ias178&&ias179);assert.equal(ias178.profile.observedSpeedRatio,1);assert.equal(ias179.profile.observedSpeedRatio,1)
 assert.ok(ias178.seconds>=ias179.seconds&&ias178.seconds-ias179.seconds<20,'one IAS knot produces only its incremental route-time change')
 const high={...fast,altitude:30000,groundspeed:machToTas(.72,30000),assignedSpeed:0}
 const mach51=predictRouteTiming({...high,assignedMach:51},c.config),mach52=predictRouteTiming({...high,assignedMach:52},c.config)
 assert.ok(mach51&&mach52);assert.equal(mach51.profile.observedSpeedRatio,1);assert.equal(mach52.profile.observedSpeedRatio,1)
 assert.ok(mach51.seconds>=mach52.seconds&&mach51.seconds-mach52.seconds<20,'one Mach hundredth produces only its incremental route-time change')
})

test('calibration stays continuous as actual speed settles onto the assigned IAS or Mach',()=>{
 const slow={...p,altitude:5000,verticalSpeed:0,assignedSpeed:160,assignedMach:0}
 const below=predictRouteTiming({...slow,groundspeed:iasToTas(159,5000)},c.config),settled=predictRouteTiming({...slow,groundspeed:iasToTas(160,5000)},c.config),above=predictRouteTiming({...slow,groundspeed:iasToTas(161,5000)},c.config)
 assert.ok(below&&settled&&above)
 assert.equal(settled.profile.observedSpeedRatio,1);assert.equal(above.profile.observedSpeedRatio,1)
 assert.ok(below.profile.observedSpeedRatio<1&&below.profile.observedSpeedRatio>.99)
 assert.ok(below.seconds>=settled.seconds&&below.seconds-settled.seconds<20)
 assert.ok(settled.seconds>=above.seconds&&settled.seconds-above.seconds<20)
 const mach={...slow,altitude:30000,groundspeed:machToTas(.45,30000),assignedSpeed:0,assignedMach:45},machResult=predictRouteTiming(mach,c.config)
 assert.ok(machResult);assert.equal(machResult.profile.observedSpeedRatio,1,'a settled Mach clearance is not charged twice')
})

test('effective close-approach speed supports a slow airline while implausible observations remain rejected',()=>{
 const slow={...p,aircraft:'A20N',wake:'M',altitude:5000,groundspeed:iasToTas(160,5000),verticalSpeed:0,assignedSpeed:0,assignedMach:0}
 const result=predictRouteTiming(slow,c.config)
 assert.ok(result);assert.equal(result.profile.type,'A20N')
 assert.ok(result.seconds>=result.distanceNm/slow.groundspeed*3600-(slow.positionAgeSeconds??0)-.001)
 assert.equal(predictRouteTiming({...slow,groundspeed:60},c.config),undefined,'an implausibly low unassigned jet speed still fails confidence')
 const fast={...p,altitude:5000,groundspeed:iasToTas(250,5000)*1.41,verticalSpeed:0,assignedSpeed:160,assignedMach:0}
 assert.equal(predictRouteTiming(fast,c.config),undefined,'a lower clearance cannot rescue GS above both credible references')
})

test('the recorded 240 IAS assignment below 8000 ft is not replaced by the 160 IAS approach reference far from landing',()=>{
 const late=fixture.cases.find(c=>c.frame===600),f=late.flights.find(f=>f.callsign==='OY15B')
 assert.equal(f.assignedSpeed,240);assert.equal(f.altitude,7340);assert.equal(f.groundspeed,266)
 const timing=predictRouteTiming({...f,assignedHeading:0},late.config,undefined,{distanceNm:48.10486696188307})
 assert.ok(timing);assert.equal(timing.profile.type,'HDJT')
 assert.ok(timing.seconds<48.10486696188307/iasToTas(160,7340)*3600,'the entire route is not flown at approach speed')
})
