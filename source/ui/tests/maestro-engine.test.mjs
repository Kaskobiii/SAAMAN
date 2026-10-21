import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, DEFAULT_CONFIG as RELEASE_DEFAULT_CONFIG, validateTelemetry, delayLabel, toJuhaSequence, wakeInterval, effectiveConfig, validateLockedEdits, validateConfig, correctedPrediction, reorderEdits, retimeEdits, dragChangesTime, windConfig, euroscopeInstruction, reconcileRunwayAssignments, gainCapacitySeconds } from '../src/maestro-engine.ts'
import { dubinsLength, vectoringSeconds } from '../src/maestro-geometry.ts'
import { labelPositions, scrollingLabelPositions } from '../src/maestro-label-layout.ts'
import scenarios from './fixtures/sweatbox-landing-scenarios.json' with {type:'json'}
import sectorGeometry from './fixtures/essa-sector-runway-geometry.json' with {type:'json'}
const DEFAULT_CONFIG={...RELEASE_DEFAULT_CONFIG,timingModel:'performance'}

const time = Date.UTC(2026, 9, 9, 12)
test('invalid optional runway geometry is omitted while fresh aircraft and active selections remain usable',()=>{
    const input={source:'ESSA_FMP',timestamp:time,activeRunways:{arrivals:['ESSA/01R'],departures:['ESSA/01L']},runways:{...sectorGeometry.runways,'ESSA/19R':{latitude:NaN,longitude:17.9,heading:184}},flights:[{callsign:'VALID',aircraft:'A320',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'01R',route:[],landingSeconds:1200,distanceNm:40,groundspeed:230,altitude:10000,threshold:{latitude:null,longitude:17.9,heading:4}}]}
    const result=validateTelemetry(input,time)
    assert.equal(result.runways['ESSA/07'],undefined);assert.equal(result.runways['ESSA/19R'],undefined)
    assert.deepEqual(result.runways['ESSA/01R'],sectorGeometry.runways['ESSA/01R'])
    assert.deepEqual(result.activeRunways,input.activeRunways);assert.equal(result.flights.length,1)
    assert.equal(result.flights[0].threshold,undefined);assert.ok(result.flights[0].dataWarnings.length)
    assert.ok(input.runways['ESSA/07']);assert.ok(input.flights[0].threshold,'native input remains untouched')
})
test('optional geometry recovery does not accept invalid core aircraft positions',()=>{
    assert.throws(()=>validateTelemetry({source:'ESSA_FMP',timestamp:time,runways:sectorGeometry.runways,flights:[{callsign:'BROKEN',aircraft:'A320',wake:'M',departure:'EKCH',arrival:'ESSA',runway:'01R',route:[],landingSeconds:1200,distanceNm:40,groundspeed:230,altitude:10000,latitude:100}]},time),/Invalid aircraft position/)
})
const config = () => ({...structuredClone(DEFAULT_CONFIG),predictionMode:'euroscope',stableMinutes:12,superStableMinutes:8,frozenMinutes:5})
const plane = (callsign, landingSeconds, extra = {}) => ({ callsign, aircraft: 'A320', wake: 'M', departure: 'EKCH',
    arrival: 'ESSA', runway: '19R', route: [{ name: 'ELTOK', seconds: landingSeconds - 600 }], landingSeconds,
    distanceNm: 60, groundspeed: 240, altitude: 15000, ...extra })
const packet = (timestamp, flights) => ({ source: 'ESSA_C_APP', timestamp, flights })

test('a Stable drag across another aircraft changes order, while same-gap or Shift drag sets time',()=>{
 assert.equal(dragChangesTime(1,1,0),false)
 assert.equal(dragChangesTime(1,1,1),true)
 assert.equal(dragChangesTime(1,1,0,true),true)
 assert.equal(dragChangesTime(2,1,0,true),false)
})

test('an area order change has current spacing work, which clears once the changed ETA includes that spacing',()=>{
 const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0;c.frozenMinutes=0;c.rates['ESSA/19R']=90
 const traffic=[plane('DLH2WR',870,{route:[{name:'NILUG',seconds:300}]}),plane('HUN79Z',920,{route:[{name:'NILUG',seconds:350}]})]
 const first=runEngine(packet(time,traffic),c,{})
 assert.equal(delayLabel(first.flights.find(f=>f.callsign==='HUN79Z').delay),'')
 const edits=reorderEdits(first,{},'HUN79Z',first.flights.find(f=>f.callsign==='DLH2WR').sta-1,'Runway',c)
 let s=runEngine(packet(time+1000,traffic.map(f=>({...f,landingSeconds:f.landingSeconds-1}))),c,edits,first)
 assert.equal(s.flights.find(f=>f.callsign==='DLH2WR').delay,140)
 assert.equal(delayLabel(s.flights.find(f=>f.callsign==='DLH2WR').delay),'2')
 for(let tick=2;tick<=32;tick++)s=runEngine(packet(time+tick*1000,traffic.map(f=>({...f,route:f.route.map(r=>({...r,seconds:r.seconds+(f.callsign==='DLH2WR'?140:0)-tick})),landingSeconds:(f.callsign==='DLH2WR'?1010:920)-tick}))),c,edits,s)
 assert.deepEqual([...s.flights].sort((a,b)=>a.order-b.order).map(f=>f.callsign),['HUN79Z','DLH2WR'])
 assert.equal(s.flights.find(f=>f.callsign==='DLH2WR').delay,140,'Superstable instruction requires an explicit refresh')
 const refreshed=runEngine(packet(time+33000,traffic.map(f=>({...f,route:f.route.map(r=>({...r,seconds:r.seconds+(f.callsign==='DLH2WR'?140:0)-33})),landingSeconds:(f.callsign==='DLH2WR'?1010:920)-33}))),c,{...edits,DLH2WR:{...edits.DLH2WR,refreshDelayAt:time+33000}},s)
 assert.equal(refreshed.flights.find(f=>f.callsign==='DLH2WR').delay,0)
})

test('absorbed TMA work is not resurrected solely because the live estimate changes back',()=>{
 const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0;c.frozenMinutes=0;c.rates['ESSA/19R']=85
 const traffic=seconds=>[plane('AAA',1200-seconds,{route:[{name:'ELTOK',seconds:-1}]}),plane('BBB',seconds<35?1400-seconds:1200-seconds,{route:[{name:'ELTOK',seconds:-1}]})]
 let s=runEngine(packet(time,[plane('AAA',1200,{route:[{name:'ELTOK',seconds:-1}]}),plane('BBB',1200,{route:[{name:'ELTOK',seconds:-1}]})]),c,{})
 assert.equal(s.flights.find(f=>f.callsign==='BBB').delay,85)
 const target=s.flights.find(f=>f.callsign==='BBB').sta
 for(let tick=1;tick<=70;tick++)s=runEngine(packet(time+tick*1000,traffic(tick)),c,{},s)
 assert.equal(s.flights.find(f=>f.callsign==='BBB').sta,target)
 assert.equal(s.flights.find(f=>f.callsign==='BBB').delay,85,'instruction remains fixed until a controller refreshes it')
})

test('a four-minute live ETA with an eleven-minute assigned slot remains editable Superstable, not Frozen',()=>{
 const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0
 const p=plane('LATE_SLOT',240)
 const edits={LATE_SLOT:{target:time+660000,targetKind:'time'}}
 const first=runEngine(packet(time,[p]),c,edits)
 assert.equal(first.flights[0].state,2)
 const oldWrongFrozen={...first,flights:first.flights.map(f=>({...f,state:3}))}
 const recovered=runEngine(packet(time+1000,[{...p,landingSeconds:239}]),c,edits,oldWrongFrozen)
 assert.equal(recovered.flights[0].state,2)
 const refreshed=runEngine(packet(time+2000,[{...p,landingSeconds:238}]),c,{LATE_SLOT:{recomputeAt:time+2000}},recovered)
 assert.equal(refreshed.flights[0].state,3)
 assert.equal(refreshed.flights[0].delay,0)
 assert.equal(refreshed.flights[0].order,0)
})

test('different order edits on one telemetry timestamp do not confuse old ranks after preceding landings',()=>{
 const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0;c.frozenMinutes=0
 const traffic=['CC','DD','AA','EE','BB'].map((name,i)=>plane(name,1200+i*50,{route:[{name:'ELTOK',seconds:-1}]}))
 const first=runEngine(packet(time,traffic),c,{})
 const edits={AA:{order:5,orderGroup:'older',changedAt:time,targetKind:'sequence'},EE:{order:6,orderGroup:'older',changedAt:time,targetKind:'sequence'},BB:{order:7,orderGroup:'older',changedAt:time,targetKind:'sequence'}}
 const saved={...first,flights:first.flights.map(f=>({...f,appliedOrder:edits[f.callsign]?.order,appliedOrderGroup:edits[f.callsign]?.orderGroup,appliedChangedAt:edits[f.callsign]?.changedAt}))}
 const changed=reorderEdits(saved,edits,'BB',saved.flights.find(f=>f.callsign==='EE').sta-1,'Runway',c)
 assert.notEqual(changed.BB.orderGroup,changed.AA.orderGroup)
 const next=runEngine(packet(time+1000,traffic.map(f=>({...f,landingSeconds:f.landingSeconds-1}))),c,changed,saved)
 assert.deepEqual([...next.flights].sort((a,b)=>a.order-b.order).map(f=>f.callsign),['CC','DD','AA','BB','EE'])
})

const runwayPoint=(geometry,along,cross=0)=>{
 const h=geometry.heading*Math.PI/180
 return {latitude:geometry.latitude+(-along*Math.cos(h)+cross*Math.sin(h))/60,
  longitude:geometry.longitude+(-along*Math.sin(h)-cross*Math.cos(h))/(60*Math.cos(geometry.latitude*Math.PI/180))}
}
for(const scenario of scenarios.scenarios)test(`scenario ${scenario.file}: every ILS arrival can roll out or disappear at touchdown`,()=>{
 const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0
 const runways=Object.fromEntries(Object.entries(scenario.runways).map(([key,value])=>[`ESSA/${key}`,value]))
 c.active=[...new Set(scenario.aircraft.map(p=>`ESSA/${p.runway}`))]
 for(const aircraft of scenario.aircraft){
  const geometry=scenario.runways[aircraft.runway]
  assert.ok(geometry,`${aircraft.callsign}: missing ILS geometry`)
  const flight=plane(aircraft.callsign,120,{runway:aircraft.runway,threshold:geometry,...runwayPoint(geometry,.05),
   heading:geometry.heading,altitude:scenario.elevation,groundspeed:140,verticalSpeed:-500,distanceNm:.05,positionAgeSeconds:0})
  const telemetry=(t,flights,simulation=true)=>({...packet(t,flights),simulation,runways})
  let s=runEngine(telemetry(time,[flight]),c,{})
  assert.notEqual(s.flights[0].state,4,'short final is still airborne')
  s=runEngine(telemetry(time+2000,[]),c,{},s)
  assert.ok(s.flights[0],`${aircraft.callsign} ${aircraft.runway}: touchdown deletion not retained`)
  assert.equal(s.flights[0].state,4)
  assert.equal(s.flights[0].landingDetection,'simulator-removal')
  assert.equal(s.landings[0].runway,`ESSA/${aircraft.runway}`)
  s=runEngine(telemetry(time+4000,[]),c,{},s)
  assert.equal(s.grounded[aircraft.callsign],time+2000)
  assert.equal(runEngine(telemetry(time+303000,[]),c,{},s).flights.length,0)
  const roll={...flight,...runwayPoint(geometry,-.25)}
  s=runEngine(telemetry(time,[roll]),c,{})
  s=runEngine(telemetry(time+2000,[roll]),c,{},s)
  s=runEngine(telemetry(time+8000,[roll]),c,{},s)
  assert.equal(s.flights[0].state,4)
  assert.equal(s.flights[0].landingDetection,'surface')
 }
})

test('deletion fallback rejects live losses, stale positions, go-arounds and runway mismatches',()=>{
 const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0
 const geometry=scenarios.scenarios[0].runways['19R']
 const p=plane('CHECK',120,{threshold:geometry,...runwayPoint(geometry,.05),heading:geometry.heading,altitude:137,groundspeed:140,verticalSpeed:-500,distanceNm:.05,positionAgeSeconds:0})
 for(const variant of [{simulation:false},{simulation:undefined},{age:9000},{positionAgeSeconds:10},{altitude:500},{verticalSpeed:500},{topskyMissedApproach:true},{heading:geometry.heading+40},{...runwayPoint(geometry,.05,.3)},{nextSource:'OFFLINE'},{nextSimulation:false}]){
  const simulation=Object.hasOwn(variant,'simulation')?variant.simulation:true
  const s=runEngine({...packet(time,[{...p,...variant}]),simulation},c,{})
  const next=runEngine({...packet(time+(variant.age??2000),[]),source:variant.nextSource??s.source,simulation:variant.nextSimulation??simulation},c,{},s)
  assert.equal(next.flights.length,0,JSON.stringify(variant))
 }
 assert.throws(()=>validateTelemetry({...packet(time,[p]),simulation:'yes'},time),/simulator connection/)
})

test('physical rollout is detected on the flown runway even if AMAN planned another',()=>{
 const c=config();c.active=['ESSA/19L','ESSA/19R'];c.unstableSeconds=0;c.minimumNewSeconds=0
 const geometry=scenarios.scenarios[0].runways['19R']
 const p=plane('ACTUAL',120,{threshold:geometry,...runwayPoint(geometry,-.25),heading:geometry.heading,altitude:137,groundspeed:130,verticalSpeed:0,distanceNm:.25,positionAgeSeconds:0})
 const edits={ACTUAL:{runway:'ESSA/19L'}}
 let s=runEngine(packet(time,[p]),c,edits)
 s=runEngine(packet(time+6000,[p]),c,edits,s)
 assert.equal(s.flights[0].state,4)
 assert.equal(s.flights[0].runway,'19L','do not rewrite the controller assignment')
 assert.equal(s.landings[0].runway,'ESSA/19R')
})

test('runway rollout at 79 knots is confirmed landed and retained after simulator deletion',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0
    const roll=plane('ROLL',30,{latitude:59.61,longitude:17.9,heading:0,altitude:137,groundspeed:79,verticalSpeed:0,distanceNm:.6,positionAgeSeconds:0,threshold:{latitude:59.60,longitude:17.9,heading:0}})
    let s=runEngine(packet(time,[roll]),c,{})
    assert.notEqual(s.flights[0].state,4)
    s=runEngine(packet(time+6000,[roll]),c,{},s)
    assert.equal(s.flights[0].state,4)
    const deleted=runEngine(packet(time+8000,[]),c,{},s)
    assert.equal(deleted.flights[0].state,4)
    assert.equal(runEngine(packet(time+307000,[]),c,{},deleted).flights.length,0)
})

test('low airborne final and a climbing go-around are not runway rollout',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0
    const p=plane('AIR',30,{latitude:59.59,longitude:17.9,heading:0,altitude:137,groundspeed:79,verticalSpeed:0,distanceNm:.6,positionAgeSeconds:0,threshold:{latitude:59.60,longitude:17.9,heading:0}})
    let s=runEngine(packet(time,[p]),c,{})
    s=runEngine(packet(time+6000,[p]),c,{},s);assert.notEqual(s.flights[0].state,4)
    const climb={...p,latitude:59.61,verticalSpeed:600}
    s=runEngine(packet(time+7000,[climb]),c,{},s)
    s=runEngine(packet(time+14000,[climb]),c,{},s);assert.notEqual(s.flights[0].state,4)
})
test('a parked rollout does not re-enter the sequence when the five-minute pink display expires',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0
    const p=plane('PARK',30,{latitude:59.61,longitude:17.9,heading:0,altitude:137,groundspeed:79,verticalSpeed:0,distanceNm:.6,positionAgeSeconds:0,threshold:{latitude:59.60,longitude:17.9,heading:0}})
    let s=runEngine(packet(time,[p]),c,{})
    s=runEngine(packet(time+6000,[p]),c,{},s)
    assert.equal(s.flights[0].state,4)
    const recovery=runEngine(packet(time+8000,[{...p,altitude:2000,verticalSpeed:1000,groundspeed:150}]),c,{},s)
    assert.equal(recovery.flights[0].state,2);assert.equal(recovery.flights[0].missedRecovery,true)
    s=runEngine(packet(time+307000,[p]),c,{},s);assert.equal(s.flights.length,0)
    s=runEngine(packet(time+309000,[{...p,groundspeed:120,heading:90,longitude:17.905}]),c,{},s);assert.equal(s.flights.length,0,'taxi turns must not reinsert a confirmed landed aircraft')
    assert.equal(s.grounded.PARK,time+6000)
    s=runEngine(packet(time+311000,[{...p,altitude:2000,verticalSpeed:1000,groundspeed:150}]),c,{},s)
    assert.notEqual(s.flights[0].state,4);assert.equal(s.grounded.PARK,undefined)
})

test('TopSky missed approach removes a Frozen flight from output, stays pending after flag clearing, and resumes movable',()=>{
    const c=config(),flight=plane('SAS1015',180)
    c.unstableSeconds=0
    let edits={},snapshot=runEngine(packet(time,[flight]),c,edits)
    assert.equal(snapshot.flights[0].state,3)
    const step=(at,flag)=>{const input=packet(at,[{...flight,topskyMissedApproach:flag}]);edits=reconcileRunwayAssignments(input,edits,snapshot);snapshot=runEngine(input,c,edits,snapshot)}
    edits.SAS1015={target:time+240000,order:0,landedAt:time,requeueAt:time,swapAt:time}
    step(time+1000,true)
    assert.equal(snapshot.flights[0].mode,'missed')
    assert.notEqual(snapshot.flights[0].state,4)
    assert.equal(toJuhaSequence(snapshot,c,edits).sequence.length,0)
    for(const key of ['target','order','landedAt','requeueAt','swapAt'])assert.equal(edits.SAS1015[key],undefined)
    step(time+2000,false)
    assert.equal(snapshot.flights[0].mode,'missed')
    step(time+3000,true)
    edits.SAS1015={...edits.SAS1015,mode:'sequenced',changedAt:time+4000,recomputeAt:time+4000}
    step(time+4000,true)
    assert.equal(snapshot.flights[0].mode,'sequenced')
    assert.equal(snapshot.flights[0].state,2)
    assert.equal(snapshot.flights[0].missedRecovery,true)
    step(time+5000,true)
    assert.equal(snapshot.flights[0].mode,'sequenced','held TopSky flag must not undo Resume')
    step(time+6000,false);step(time+7000,true)
    assert.equal(snapshot.flights[0].mode,'missed','a later missed approach is detected again')
})

test('TopSky flag present on first observation is detected; stale tracks and removed aircraft are not restored',()=>{
    const flagged=plane('SAS1015',300,{topskyMissedApproach:true})
    const input=packet(time,[flagged])
    const edits=reconcileRunwayAssignments(input,{})
    assert.equal(runEngine(input,config(),edits).flights[0].mode,'missed')
    assert.equal(reconcileRunwayAssignments(input,{SAS1015:{mode:'removed'}}).SAS1015.mode,'removed')
    assert.deepEqual(reconcileRunwayAssignments(packet(time,[{...flagged,positionAgeSeconds:20}]),{}),{})
    assert.throws(()=>validateTelemetry(packet(time,[{...flagged,topskyMissedApproach:'false'}]),time),/missed approach flag/)
})

test('scrolling translates the entire label layout without repacking visible edge aircraft', () => {
    const rows=[{id:'OUTSIDE',y:-20,side:'r'},{id:'TOP',y:5,side:'r'},{id:'MID',y:300,side:'r'},{id:'CLOSE',y:301,side:'r'},{id:'BOTTOM',y:510,side:'r'},{id:'BEYOND',y:550,side:'r'}]
    const gaps=[{side:'r',top:350,bottom:430}]
    const first=scrollingLabelPositions(rows,23,gaps)
    for(const offset of [-100,40,300]){
        const next=scrollingLabelPositions(rows.map(r=>({...r,y:r.y+offset})),23,gaps.map(g=>({...g,top:g.top+offset,bottom:g.bottom+offset})))
        for(const row of rows)assert.ok(Math.abs(next[row.id]-first[row.id]-offset)<1e-7)
    }
})

test('confirmed landings stay five minutes when the track disappears; missing airborne flights clear immediately', () => {
    const c=config()
    const ground=plane('LANDED',0,{distanceNm:.1,groundspeed:0,altitude:180})
    const first=runEngine(packet(time,[ground,plane('AIRBORNE',1200)]),c,{})
    assert.equal(first.flights.find(f=>f.callsign==='LANDED').state,4)
    const missing=runEngine(packet(time+1000,[]),c,{},first)
    assert.deepEqual(missing.flights.map(f=>f.callsign),['LANDED'])
    assert.equal(missing.flights[0].lost,false)
    const held=runEngine(packet(time+299999,[]),c,{},missing)
    assert.equal(held.flights[0].sta,time)
    const expired=runEngine(packet(time+300000,[]),c,{},held)
    assert.equal(expired.flights.length,0)
    const stillGround=runEngine(packet(time+301000,[ground]),c,{},expired)
    assert.equal(stillGround.flights.length,0,'a still-present ground track cannot restart the five-minute history timer')
})

test('closure captions cannot displace labels to the opposite side of a blocked interval', () => {
    const positions=labelPositions([{id:'BEFORE',y:437,side:'r'},{id:'AFTER',y:378,side:'r'}],532,23,[{side:'r',top:368,bottom:447}])
    assert.ok(positions.BEFORE>447)
    assert.ok(positions.AFTER<368)
})

test('closure-side insertion can move a protected flight before or after the same gap without crossing another flight', () => {
    const c=config();c.minimumNewSeconds=0;c.frozenMinutes=0
    const input=packet(time,[plane('WHITE',700,{route:[{name:'ELTOK',seconds:-1}]}),plane('NEXT',2100)])
    const initial=runEngine(input,c,{})
    const begin=time+900000,end=time+1500000
    c.slots=[{id:'closure',runway:'ESSA/19R',begin,end}]
    const first=runEngine(input,c,{},initial)
    const after=reorderEdits(first,{},'WHITE',end+1,'Runway',c,{id:'closure',side:'after'})
    const held=runEngine(input,c,after,{...first,timestamp:time-1})
    assert.equal(held.flights.find(f=>f.callsign==='WHITE').sta,end)
    assert.ok(held.flights.find(f=>f.callsign==='WHITE').closureDelayMs>0)
    const before=reorderEdits(held,after,'WHITE',begin-1,'Runway',c,{id:'closure',side:'before'})
    const moved=runEngine(input,c,before,{...held,timestamp:time-1})
    assert.ok(moved.flights.find(f=>f.callsign==='WHITE').sta<begin)
    assert.equal(moved.flights.find(f=>f.callsign==='WHITE').closureDelayMs,0)
    assert.equal(moved.flights.find(f=>f.callsign==='WHITE').order,0)
    c.slots=[]
    const removed=runEngine(input,c,after,{...held,timestamp:time-1})
    assert.equal(removed.flights.find(f=>f.callsign==='WHITE').delay,initial.flights.find(f=>f.callsign==='WHITE').delay)
})
test('delay is not accumulated into ETA over repeated refreshes', () => {
    let previous
    for (let i = 0; i < 30; i++) {
        const elapsed = i * 5
        previous = runEngine(packet(time + elapsed * 1000, [plane('SAS1', 1200 - elapsed), plane('SAS2', 1210 - elapsed)]), config(), {}, previous)
        assert.equal(previous.flights.find(f => f.callsign === 'SAS2').delay, 105)
    }
})
test('entry-time minimum is applied once instead of being extended each refresh', () => {
    const c = config(); c.minimumNewSeconds = 600
    const seed=runEngine(packet(time-1000,[plane('SAS0',1200)]),c,{})
    const first = runEngine(packet(time, [plane('SAS0',1199),plane('SAS1', 480,{route:[{name:'ELTOK',seconds:120}]})]), c, {},seed)
    const next = runEngine(packet(time + 60000, [plane('SAS0',1139),plane('SAS1', 420,{route:[{name:'ELTOK',seconds:60}]})]), c, {}, first)
    assert.equal(next.flights.find(f=>f.callsign==='SAS1').minimumArrival, time + 600000)
    assert.equal(first.flights.find(f=>f.callsign==='SAS1').minimumArrival,next.flights.find(f=>f.callsign==='SAS1').minimumArrival)
})
test('disconnected aircraft leave the queue while corrupt new EETs retain credible leader spacing without extra delay', () => {
    const first = runEngine(packet(time, [plane('SAS1', 1200), plane('SAS2', 1210)]), config(), {})
    const lost = runEngine(packet(time + 5000, [plane('SAS2', 1205)]), config(), {}, first)
    assert.equal(lost.flights.find(f => f.callsign === 'SAS2').delay, 0)
    assert.equal(lost.flights.some(f => f.callsign === 'SAS1'), false)
    const corrupt = runEngine(packet(time + 5000, [plane('SAS1', 9000), plane('SAS2', 1205)]), config(), {}, first)
    assert.equal(corrupt.flights[0].issue,'')
    assert.equal(corrupt.flights[0].routeTimingQuarantined,true)
    assert.equal(corrupt.flights[0].eta,first.flights[0].eta)
    assert.equal(corrupt.flights[0].etaFf,first.flights[0].etaFf)
    assert.equal(corrupt.flights[1].delay,first.flights[1].delay)
    assert.ok(corrupt.flights[1].sta-corrupt.flights[0].sta>=config().rates['ESSA/19R']*1000-1)
    const stillCorrupt = runEngine(packet(time + 10000, [plane('SAS1', 8995), plane('SAS2', 1200)]), config(), {}, corrupt)
    assert.equal(stillCorrupt.flights[0].issue,'')
    assert.equal(stillCorrupt.flights[0].routeTimingQuarantined,true)
    assert.equal(stillCorrupt.flights[1].delay,first.flights[1].delay)
    assert.equal(stillCorrupt.automaticCorrections.length,1)
})
test('native TopSky feed has documented units and excludes quarantined flights', () => {
    const s = runEngine(packet(time, [plane('SAS1', 1200), plane('SAS2', 1210)]), config(), {})
    const data = toJuhaSequence(s, config(), {})
    assert.equal(data.data.timestamp, time / 1000)
    assert.equal(data.sequence[1].ttlttg_ff, 60,'TopSky receives the same whole minute displayed by AMAN')
    assert.equal(data.sequence[1].eet_ff, 610 / 60)
    assert.equal(data.sequence[1].sta_ff, (s.flights[1].staFf / 1000))
    s.flights[0].issue = 'Bad prediction'
    assert.equal(toJuhaSequence(s, config(), {}).sequence.length, 1)
})
test('heavy followers use distance wake spacing without adding a second copy of the base rate', () => {
    assert.ok(wakeInterval('H','M','ESSA/19R',config()) > 115)
    const s = runEngine(packet(time, [plane('SAS1', 1200, {wake:'H'}), plane('SAS2', 1200)]),config(),{})
    assert.ok(Math.abs((s.flights[1].sta - s.flights[0].sta) - 5 / 140 * 3600000) < 1)
})
test('ACC feeder schedule uses feeder-to-threshold transfer, not landing timestamp', () => {
    const s = runEngine(packet(time, [plane('SAS1', 1200), plane('SAS2', 1210)]), config(), {})
    const f = s.flights[1]
    assert.equal(f.sta - f.staFf, 600000)
    assert.equal(f.staFf - f.etaFf, 105000)
})
test('stable order is preserved when route ETA order changes', () => {
    const c = config(); c.unstableSeconds = 0
    const a = runEngine(packet(time, [plane('SAS1', 1000), plane('SAS2', 1020)]), c, {})
    const b = runEngine(packet(time + 5000, [plane('SAS1', 1100), plane('SAS2', 900)]), c, {}, a)
    assert.ok(b.flights[0].order < b.flights[1].order)
    assert.equal(delayLabel(b.flights[0].delay), '')
    assert.ok(b.flights[0].runwayDelay<0,'prediction difference stays available for information, not as an automatic gain instruction')
})
test('fixed and aircraft-relative slots apply once per sequence', () => {
    const c = config(); c.slots = [{ id: 'closure', runway: 'ESSA/19R', begin: time + 1100000, end: time + 1300000 }]
    const s = runEngine(packet(time, [plane('SAS1', 1200), plane('SAS2', 1210)]), c, { SAS1: { slotAfter: 2 } })
    assert.equal(s.flights[0].sta, time + 1300000)
    assert.equal(s.flights[1].sta - s.flights[0].sta, 235000)
})
test('ESSB arrivals are excluded from the ESSA engine even with an active legacy ESSB runway', () => {
    const c = config(); c.active.push('ESSB/30')
    const s = runEngine(packet(time, [plane('SAS1', 1200), plane('SAS2', 1200, { arrival: 'ESSB', runway: '30' })]), c, {})
    assert.deepEqual(s.flights.map(f=>f.callsign),['SAS1']);assert.deepEqual(s.diagnostics,[])
})
test('stale snapshots are rejected and out-of-order snapshots cannot rewind a sequence', () => {
    assert.throws(() => validateTelemetry(packet(time, []), time + 31000))
    const s = runEngine(packet(time, [plane('SAS1', 1200)]), config(), {})
    assert.equal(runEngine(packet(time - 1000, []), config(), {}, s), s)
})
test('white aircraft keep their times on ordinary updates; explicit rate changes recalculate spacing without changing order',()=>{
    const c=config();c.unstableSeconds=0
    const first=runEngine(packet(time,[plane('SAS1',1000),plane('SAS2',1020)]),c,{})
    assert.equal(first.flights[0].state,2)
    const next=runEngine(packet(time+5000,[plane('SAS1',900),plane('SAS2',1100)]),c,{},first)
    assert.equal(next.flights[0].sta,first.flights[0].sta)
    assert.equal(next.flights[1].sta,first.flights[1].sta)
    c.rates['ESSA/19R']=180
    const changed=runEngine(packet(time+10000,[plane('SAS1',890),plane('SAS2',1090)]),c,{},next)
    assert.equal(changed.flights[0].order,0)
    assert.equal(changed.flights[1].order,1)
    assert.ok(changed.flights[1].sta-changed.flights[0].sta>=180000)
})
test('white aircraft can explicitly swap existing sequence slots without drifting afterwards',()=>{
    const c=config();c.unstableSeconds=0
    const first=runEngine(packet(time,[plane('SAS1',1000),plane('SAS2',1200)]),c,{})
    const [a,b]=first.flights
    const edits={SAS1:{order:1,target:b.sta},SAS2:{order:0,target:a.sta}}
    assert.doesNotThrow(()=>validateLockedEdits(first,{},edits))
    const swapped=runEngine(packet(time+5000,[plane('SAS1',995),plane('SAS2',1195)]),c,edits,first)
    assert.equal(swapped.flights[0].sta,b.sta)
    assert.equal(swapped.flights[1].sta,a.sta)
    const again=runEngine(packet(time+10000,[plane('SAS1',990),plane('SAS2',1190)]),c,edits,swapped)
    assert.equal(again.flights[0].sta,b.sta)
    assert.doesNotThrow(()=>validateLockedEdits(first,{}, {SAS1:{target:b.sta+12345}}))
})
test('closure gaps shift locked times and moving the closure does not leave the old interval blocked',()=>{
    const c=config();c.unstableSeconds=0
    const first=runEngine(packet(time,[plane('SAS1',1000)]),c,{})
    c.slots=[{id:'gap',runway:'ESSA/19R',begin:time+900000,end:time+1100000}]
    const shifted=runEngine(packet(time+1000,[plane('SAS1',999)]),c,{},first)
    assert.equal(shifted.flights[0].sta,time+1100000)
    c.slots=[{id:'gap',runway:'ESSA/19R',begin:time+1400000,end:time+1500000}]
    const after=runEngine(packet(time+2000,[plane('SAS1',998)]),c,{},shifted)
    assert.ok(after.flights[0].sta<time+1400000)
})
test('configured runway directions and rates take effect at the scheduled UTC time',()=>{
    const c=config();c.pending={at:time+900000,active:['ESSA/01L'],rates:{...c.rates,'ESSA/01L':180}}
    assert.deepEqual(effectiveConfig(c,time+899999).active,['ESSA/19R'])
    assert.deepEqual(effectiveConfig(c,time+900000).active,['ESSA/01L'])
    assert.equal(effectiveConfig(c,time+900000).rates['ESSA/01L'],180)
    assert.doesNotThrow(()=>validateConfig(c))
    const next=runEngine(packet(time+900000,[plane('SAS1',600,{runway:'01L'}),plane('SAS2',610,{runway:'01L'})]),c,{})
    assert.equal(next.flights[1].sta-next.flights[0].sta,180000)
})
test('manual flights can be planned before they appear in EuroScope',()=>{
    const c=config();c.manualFlights=[{callsign:'TEST123',runway:'ESSA/19R',aircraft:'UNKN',wake:'?',feeder:'ELTOK',eta:time+1500000}]
    const s=runEngine(packet(time,[]),c,{})
    assert.equal(s.flights[0].callsign,'TEST123')
    assert.equal(s.flights[0].state,1)
    assert.equal(s.flights[0].sta,time+1500000)
    const real=runEngine(packet(time+5000,[plane('TEST123',1495,{aircraft:'A320'})]),c,{},s)
    assert.equal(real.flights.length,1)
    assert.equal(real.flights[0].aircraft,'A320')
})

test('dragging changes order without locking or inventing landing times',()=>{
    const c=config();c.unstableSeconds=0
    const first=runEngine(packet(time,[plane('SAS1',1200),plane('SAS2',1210),plane('SAS3',1220)]),c,{})
    const edits=reorderEdits(first,{},'SAS3',time+1190000)
    assert.equal(edits.SAS3.target,undefined)
    assert.equal(edits.SAS3.targetKind,'sequence')
    const moved=runEngine(packet(time+1000,[plane('SAS1',1199),plane('SAS2',1209),plane('SAS3',1219)]),c,edits,first)
    assert.equal(moved.flights.find(f=>f.callsign==='SAS3').order,0)
    assert.equal(moved.flights.find(f=>f.callsign==='SAS1').order,1)
    assert.notEqual(moved.flights.find(f=>f.callsign==='SAS3').sta,time+1190000)
    const slots=s=>s.flights.map(f=>f.sta).sort((a,b)=>a-b)
    assert.equal(moved.flights.find(f=>f.callsign==='SAS3').sta,time+1220000,'the new leader is not assigned an unsupported gain')
    assert.ok(moved.flights.every(f=>f.delay>=0&&!f.spacingConflict))
    const again=runEngine(packet(time+6000,[plane('SAS1',1194),plane('SAS2',1204),plane('SAS3',1214)]),c,edits,moved)
    assert.deepEqual(slots(again),slots(moved))
    const restoredEdits=reorderEdits(again,edits,'SAS3',time+1500000)
    const restored=runEngine(packet(time+7000,[plane('SAS1',1193),plane('SAS2',1203),plane('SAS3',1213)]),c,restoredEdits,again)
    assert.deepEqual(slots(restored),slots(first))
    assert.deepEqual(restored.flights.sort((a,b)=>a.order-b.order).map(f=>f.callsign),['SAS1','SAS2','SAS3'])
})
test('an exact drop on the next slot crosses it, as the original move handler does',()=>{
    const c=config();c.unstableSeconds=0
    const first=runEngine(packet(time,[plane('FIRST',1200),plane('NEXT',1210),plane('TAIL',1220)]),c,{})
    const nextSlot=first.flights.find(f=>f.callsign==='NEXT').sta
    const edits=reorderEdits(first,{},'FIRST',nextSlot)
    const moved=runEngine(packet(time+1000,[plane('FIRST',1199),plane('NEXT',1209),plane('TAIL',1219)]),c,edits,first)
    assert.deepEqual(moved.flights.sort((a,b)=>a.order-b.order).map(f=>f.callsign),['NEXT','FIRST','TAIL'])
    assert.equal(moved.flights.find(f=>f.callsign==='NEXT').sta,time+1210000)
    assert.equal(moved.flights.find(f=>f.callsign==='FIRST').sta,time+1325000)
    assert.ok(moved.flights.every(f=>!f.spacingConflict))
})

test('slot reordering adds only required wake spacing and respects runway closures',()=>{
    const c=config();c.unstableSeconds=0
    const first=runEngine(packet(time,[plane('MEDIUM',1200),plane('HEAVY',1210,{wake:'H'}),plane('TAIL',1220)]),c,{})
    const edits=reorderEdits(first,{},'HEAVY',time+1190000)
    const moved=runEngine(packet(time+1000,[plane('MEDIUM',1199),plane('HEAVY',1209,{wake:'H'}),plane('TAIL',1219)]),c,edits,first)
    const heavy=moved.flights.find(f=>f.callsign==='HEAVY'),medium=moved.flights.find(f=>f.callsign==='MEDIUM')
    assert.equal(heavy.sta,heavy.planningEta)
    assert.ok(Math.abs(medium.sta-heavy.sta-wakeInterval('H','M','ESSA/19R',c)*1000)<1)
    assert.ok(moved.flights.every(f=>!f.spacingConflict))
    c.slots=[{id:'closed',runway:'ESSA/19R',begin:heavy.sta-1000,end:heavy.sta+60000}]
    const closed=runEngine(packet(time+2000,[plane('MEDIUM',1198),plane('HEAVY',1208,{wake:'H'}),plane('TAIL',1218)]),c,edits,moved)
    assert.equal(closed.flights.find(f=>f.callsign==='HEAVY').sta,c.slots[0].end)
})

test('slot insertion across white aircraft passes locked-edit validation',()=>{
    const c=config();c.unstableSeconds=0
    const first=runEngine(packet(time,[plane('WHITE',900),plane('GREEN',1200),plane('TAIL',1210)]),c,{})
    assert.equal(first.flights.find(f=>f.callsign==='WHITE').state,2)
    const edits=reorderEdits(first,{},'GREEN',time+899000)
    assert.doesNotThrow(()=>validateLockedEdits(first,{},edits))
    const next=runEngine(packet(time+1000,[plane('WHITE',899),plane('GREEN',1199),plane('TAIL',1209)]),c,edits,first)
    assert.equal(next.flights.find(f=>f.callsign==='GREEN').sta,time+1200000)
    assert.ok(next.flights.every(f=>!f.spacingConflict))
})

test('a white reorder keeps its accepted wake spacing over later refreshes',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0
    const first=runEngine(packet(time,[plane('MEDIUM',900),plane('HEAVY',910,{wake:'H'}),plane('TAIL',920)]),c,{})
    assert.ok(first.flights.every(f=>f.state===2))
    const edits=reorderEdits(first,{},'HEAVY',time+899000)
    let accepted=runEngine(packet(time+1000,[plane('MEDIUM',899),plane('HEAVY',909,{wake:'H'}),plane('TAIL',919)]),c,edits,first)
    const times=new Map(accepted.flights.map(f=>[f.callsign,f.sta]))
    assert.ok(times.get('MEDIUM')-times.get('HEAVY')>=wakeInterval('H','M','ESSA/19R',c)*1000-1)
    for(let elapsed=2;elapsed<=30;elapsed++) {
        accepted=runEngine(packet(time+elapsed*1000,[plane('MEDIUM',900-elapsed),plane('HEAVY',910-elapsed,{wake:'H'}),plane('TAIL',920-elapsed)]),c,edits,accepted)
        assert.ok(accepted.flights.every(f=>!f.spacingConflict))
        assert.deepEqual(new Map(accepted.flights.map(f=>[f.callsign,f.sta])),times)
    }
})

test('explicit Recompute updates a white aircraft while preserving the initial Information reference',()=>{
    const c=config();c.unstableSeconds=0
    const first=runEngine(packet(time,[plane('SAS1',1000),plane('SAS2',1100)]),c,{})
    const edits={SAS1:{recomputeAt:time+5000,changedAt:time+5000}}
    assert.doesNotThrow(()=>validateLockedEdits(first,{},edits))
    const next=runEngine(packet(time+5000,[plane('SAS1',1300),plane('SAS2',1095)]),c,edits,first)
    const f=next.flights.find(f=>f.callsign==='SAS1')
    assert.equal(f.initialEta,first.flights.find(f=>f.callsign==='SAS1').initialEta)
    assert.equal(f.eta,time+1305000)
    assert.equal(f.order,1)
})
test('new arrivals do not displace SuperStable order; missed approaches may enter before SuperStable but never Frozen',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0
    const first=runEngine(packet(time,[plane('FROZEN',250),plane('SUPER',900),plane('MISSED',1100)]),c,{MISSED:{mode:'missed'}})
    const next=runEngine(packet(time+5000,[plane('FROZEN',245),plane('SUPER',895),plane('MISSED',600),plane('NEW',500)]),c,{MISSED:{mode:'sequenced'}},first)
    const ordered=next.flights.filter(f=>f.mode==='sequenced').sort((a,b)=>a.order-b.order).map(f=>f.callsign)
    assert.deepEqual(ordered,['FROZEN','MISSED','SUPER','NEW'])
})
test('frozen post-feeder order stays committed even when final positions cross',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0
    const threshold={latitude:59.66,longitude:17.92,heading:180}
    const a=plane('SAS1',200,{latitude:59.76,longitude:17.92,heading:180,threshold})
    const b=plane('SAS2',220,{latitude:59.80,longitude:17.92,heading:180,threshold})
    const first=runEngine(packet(time,[a,b]),c,{})
    const next=runEngine(packet(time+5000,[a,{...b,latitude:59.72}]),c,{},first)
    assert.equal(next.flights.find(f=>f.callsign==='SAS2').order,1)
    assert.equal(next.flights.find(f=>f.callsign==='SAS2').sta,first.flights.find(f=>f.callsign==='SAS2').sta)
    const offFinal=runEngine(packet(time+5000,[a,{...b,latitude:59.72,longitude:18.0}]),c,{},first)
    assert.equal(offFinal.flights.find(f=>f.callsign==='SAS2').order,1)
})
test('minimum EET for a missed approach is anchored once, not added repeatedly',()=>{
    const c=config();c.unstableSeconds=0
    const first=runEngine(packet(time,[plane('SAS1',1000)]),c,{SAS1:{mode:'missed'}})
    const edits={SAS1:{mode:'sequenced',recomputeAt:time+5000}}
    const next=runEngine(packet(time+5000,[plane('SAS1',200)]),c,edits,first)
    assert.equal(next.flights[0].minimumArrival,time+605000)
    const again=runEngine(packet(time+10000,[plane('SAS1',195)]),c,edits,next)
    assert.equal(again.flights[0].minimumArrival,time+605000)
})
test('wind automatic mode uses fresh METAR data and manual wind remains authoritative',()=>{
    const c=config(),winds={ESSA:{direction:190,speed:20,timestamp:time}}
    assert.equal(windConfig(c,'ESSA',winds,time).surfaceWindSpeed,20)
    c.surfaceWindAuto=false
    assert.equal(windConfig(c,'ESSA',winds,time).surfaceWindSpeed,0)
    c.surfaceWindAuto=true
    assert.equal(windConfig(c,'ESSA',winds,time+3600001).surfaceWindSpeed,0)
    const s=runEngine({...packet(time,[plane('SAS1',1200)]),winds},c,{})
    assert.equal(toJuhaSequence(s,c,{}).wind.sfc_kts,20)
})
test('bounded-turn geometry has correct straight-line and reverse-course limits',()=>{
    assert.ok(Math.abs(dubinsLength(10,0,0,0,1)-10)<1e-8)
    assert.ok(dubinsLength(10,0,Math.PI,0,1)>10)
    const seconds=vectoringSeconds({latitude:59.76,longitude:17.92},180,{latitude:59.66,longitude:17.92,heading:180},10,180,140)
    assert.ok(Math.abs(seconds-6/140*3600)<.01)
})
test('vectoring replaces an obsolete route only with required geometry and enabled eligibility',()=>{
    const c=config();c.unstableSeconds=0
    const p=plane('SAS1',3000,{route:[{name:'ELTOK',seconds:-60}],assignedHeading:180,heading:180,
        latitude:59.76,longitude:17.92,threshold:{latitude:59.66,longitude:17.92,heading:180}})
    const old={state:2}
    assert.equal(correctedPrediction(p,c,old).source,'vectoring')
    assert.ok(correctedPrediction(p,c,old).seconds<300)
    c.vectoringMode=0
    assert.equal(correctedPrediction(p,c,old).seconds,3000)
    c.vectoringMode=1
    assert.equal(correctedPrediction({...p,threshold:undefined},c,old).source,'route')
})
test('delay path exclusion replaces arc with direct distance, not zero-time teleporting',()=>{
    const c=config();c.delayPaths=[{airport:'ESSA',runways:['19R'],feeders:['ELTOK'],points:['A','B','C']}]
    const route=[{name:'ELTOK',seconds:600},{name:'A',seconds:700,latitude:59.9,longitude:17.9},
        {name:'B',seconds:1000,latitude:60,longitude:18},{name:'C',seconds:1300,latitude:59.8,longitude:17.9}]
    const p=plane('SAS1',1800,{route,calculatedRouteIndex:0})
    const prediction=correctedPrediction(p,c)
    assert.equal(prediction.source,'delaypath')
    assert.ok(Math.abs(prediction.seconds-1290)<.01)
    assert.equal(correctedPrediction({...p,calculatedRouteIndex:3},c).seconds,1800)
})
test('starting MASTER with existing final traffic does not invent a ten-minute delay',()=>{
    const c=config();c.unstableSeconds=0
    const first=runEngine(packet(time,[plane('SAS1',120)]),c,{})
    assert.equal(first.flights[0].sta,time+120000)
    assert.equal(first.flights[0].minimumArrival,time)
})


test('explicit unstable reorder keeps its chosen order without pretending its time is stable',()=>{
    const c=config();c.unstableSeconds=0
    const inputs=[plane('A',1200),plane('B',1320),plane('BLUE',3300)]
    const first=runEngine(packet(time,inputs),c,{})
    assert.equal(first.flights.find(f=>f.callsign==='BLUE').state,0)
    const edits=reorderEdits(first,{},'BLUE',time+1250000)
    const changed=runEngine(packet(time+1000,inputs),c,edits,first)
    assert.deepEqual(changed.flights.slice().sort((a,b)=>a.order-b.order).map(f=>f.callsign),['A','BLUE','B'])
    assert.equal(changed.flights.find(f=>f.callsign==='BLUE').state,0)
})

test('dragging a landed flight reinserts it once and retains the plan on refresh',()=>{
    const c=config();c.unstableSeconds=0
    const inputs=[plane('A',1200),plane('B',1440),plane('PINK',-60,{distanceNm:.1,groundspeed:0,altitude:100,route:[{name:'ELTOK',seconds:600}]})]
    const first=runEngine(packet(time,inputs),c,{})
    assert.equal(first.flights.find(f=>f.callsign==='PINK').state,4)
    const edits=reorderEdits(first,{},'PINK',time+1300000)
    validateLockedEdits(first,{},edits)
    const changed=runEngine(packet(time+1000,inputs),c,edits,first)
    assert.deepEqual(changed.flights.slice().sort((a,b)=>a.order-b.order).map(f=>f.callsign),['A','PINK','B'])
    const requeued=changed.flights.find(f=>f.callsign==='PINK')
    assert.equal(requeued.state,1);assert.equal(requeued.issue,'')
    assert.ok(requeued.sta>time)
    const again=runEngine(packet(time+4000,inputs),c,edits,changed)
    assert.equal(again.flights.find(f=>f.callsign==='PINK').sta,requeued.sta)
    assert.equal(again.flights.find(f=>f.callsign==='PINK').state,1)
})


test('a changed leader wake category increases the gap even for a white follower',()=>{
    const c=config();c.unstableSeconds=0
    const first=runEngine(packet(time,[plane('LEADER',900),plane('FOLLOWER',910)]),c,{})
    assert.ok(first.flights.find(f=>f.callsign==='FOLLOWER').state>=2)
    const next=runEngine(packet(time+1000,[plane('LEADER',899,{wake:'H'}),plane('FOLLOWER',909)]),c,{},first)
    const leader=next.flights.find(f=>f.callsign==='LEADER'),follower=next.flights.find(f=>f.callsign==='FOLLOWER')
    assert.ok(follower.sta-leader.sta>=wakeInterval('H','M','ESSA/19R',c)*1000-1)
    assert.equal(follower.spacingConflict,false)
})


test('arrival and departure roles migrate separately and change together at the selected time',()=>{
    const legacy={...config(),active:['ESSA/19R','ESSA/26'],departureRunway:undefined}
    const migrated=validateConfig(legacy)
    assert.deepEqual(migrated.active,['ESSA/19R']);assert.equal(migrated.departureRunway,'ESSA/26')
    migrated.pending={at:time+60000,active:['ESSA/01R'],departureRunway:'ESSA/01L',rates:{...migrated.rates,'ESSA/01R':150}}
    const checked=validateConfig(migrated)
    assert.equal(effectiveConfig(checked,time).departureRunway,'ESSA/26')
    const next=effectiveConfig(checked,time+60000)
    assert.deepEqual(next.active,['ESSA/01R']);assert.equal(next.departureRunway,'ESSA/01L')
    assert.equal(next.rates['ESSA/01R'],150)
    const sequence=runEngine(packet(time+60000,[plane('DEPONLY',1200,{runway:'01L'})]),checked,{})
    assert.equal(sequence.flights[0].issue,'');assert.equal(sequence.flights[0].secondaryRunwayAccepted,true)
    assert.equal(sequence.flights[0].runway,'01L');assert.deepEqual(next.active,['ESSA/01R'])
})

test('a white reorder recomputes work for the actual new leader and follower',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0
    const inputs=[plane('FIN6X',420),plane('DLH2JT',540)]
    const first=runEngine(packet(time,inputs),c,{})
    assert.ok(first.flights.every(f=>f.state>=2))
    assert.ok(first.flights.every(f=>f.delay===0))
    const edits=reorderEdits(first,{},'DLH2JT',time+410000)
    let moved=runEngine(packet(time+1000,inputs.map(f=>({...f,landingSeconds:f.landingSeconds-1}))),c,edits,first)
    assert.deepEqual(moved.flights.slice().sort((a,b)=>a.order-b.order).map(f=>f.callsign),['DLH2JT','FIN6X'])
    assert.equal(moved.flights.find(f=>f.callsign==='DLH2JT').delay,0)
    assert.equal(moved.flights.find(f=>f.callsign==='FIN6X').delay,235)
    for(let seconds=2;seconds<20;seconds++){
        moved=runEngine(packet(time+seconds*1000,inputs.map(f=>({...f,landingSeconds:f.landingSeconds-seconds}))),c,edits,moved)
        assert.equal(moved.flights.find(f=>f.callsign==='DLH2JT').delay,0)
        assert.equal(moved.flights.find(f=>f.callsign==='FIN6X').delay,235)
    }
    assert.equal(toJuhaSequence(moved,c,edits).sequence.find(f=>f.callsign==='FIN6X').ttlttg_ff,0,'TMA slot difference is not an ACC instruction')
    c.slots=[{id:'close',runway:'ESSA/19R',begin:time+530000,end:time+640000}]
    const closed=runEngine(packet(time+20000,inputs.map(f=>({...f,landingSeconds:f.landingSeconds-20}))),c,edits,moved)
    assert.ok(closed.flights.some(f=>f.delay>0),'closure delays remain visible')
})

test('a white heavy reorder adds only the required extra wake spacing to its current gain/loss',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0
    const inputs=[plane('MEDIUM',420),plane('HEAVY',535,{wake:'H'})]
    const first=runEngine(packet(time,inputs),c,{})
    const edits=reorderEdits(first,{},'HEAVY',time+410000)
    const next=runEngine(packet(time+1000,inputs.map(f=>({...f,landingSeconds:f.landingSeconds-1}))),c,edits,first)
    assert.equal(next.flights.find(f=>f.callsign==='HEAVY').delay,0)
    assert.equal(next.flights.find(f=>f.callsign==='MEDIUM').delay,115+Math.round(wakeInterval('H','M','ESSA/19R',c)))
})


test('stable runway and feeder slots do not move with minute-resolution route updates',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0
    const first=runEngine(packet(time,[plane('LEAD',1200),plane('GREEN',1260)]),c,{})
    const again=runEngine(packet(time+35000,[plane('LEAD',1140),plane('GREEN',1200)]),c,{},first)
    for(const f of again.flights){const old=first.flights.find(o=>o.callsign===f.callsign);assert.equal(f.sta,old.sta);assert.equal(f.staFf,old.staFf);assert.equal(f.order,old.order)}
    const changed=runEngine(packet(time+40000,[plane('LEAD',1500),plane('GREEN',1770)]),c,{},again)
    assert.ok(changed.flights.every(f=>f.state>=1),'stable does not become unstable because route EET increases')
})

test('unconstrained leading minute-resolution jitter is not published as a holding instruction',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0
    const first=runEngine(packet(time,[plane('BLX658',1080,{wake:'H',route:[{name:'NILUG',seconds:-60}]})]),c,{})
    const changed=runEngine(packet(time+10000,[plane('BLX658',1020,{wake:'H',route:[{name:'NILUG',seconds:-60}]})]),c,{},first)
    assert.equal(changed.flights[0].runwayDelay,50)
    assert.equal(changed.flights[0].delay,0)
    c.slots=[{id:'closed',runway:'ESSA/19R',begin:time+1000000,end:time+1150000}]
    const closed=runEngine(packet(time+15000,[plane('BLX658',1020,{wake:'H',route:[{name:'NILUG',seconds:-60}]})]),c,{},changed)
    assert.ok(closed.flights[0].delay>0,'actual closure constraints remain instructions')
})

test('heavy/medium wake requirement stays visible even when the runway rate is already larger',()=>{
    const c=config();c.unstableSeconds=0;c.rates['ESSA/19R']=142
    const first=runEngine(packet(time,[plane('BLX658',1080,{wake:'H'}),plane('NYX720',1090)]),c,{})
    const follower=first.flights.find(f=>f.callsign==='NYX720')
    assert.equal(follower.separation.leader,'BLX658');assert.equal(follower.separation.wakeNm,5)
    assert.equal(follower.separation.scheduledSeconds,142)
    assert.ok(follower.separation.wakeSeconds<142)
})


test('removing a closure restores pre-closure white times and gain/loss, including its followers',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0
    const inputs=[plane('WHITE1',420),plane('WHITE2',540)]
    const original=runEngine(packet(time,inputs),c,{})
    c.slots=[{id:'gap',runway:'ESSA/19R',begin:time+400000,end:time+700000}]
    const delayed=runEngine(packet(time+1000,inputs.map(f=>({...f,landingSeconds:f.landingSeconds-1}))),c,{},original)
    assert.ok(delayed.flights.every(f=>f.closureDelayMs>0))
    c.slots=[]
    const restored=runEngine(packet(time+2000,inputs.map(f=>({...f,landingSeconds:f.landingSeconds-2}))),c,{},delayed)
    for(const f of restored.flights){const before=original.flights.find(o=>o.callsign===f.callsign);assert.equal(f.sta,before.sta);assert.equal(f.delay,before.delay);assert.equal(f.closureDelayMs,0)}
})


test('post-feeder slots, feeder identity and delay survive oscillating or missing route estimates',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0
    let s=runEngine(packet(time,[plane('A',420),plane('B',540)]),c,{})
    const accepted=structuredClone(s)
    for(let i=1;i<=30;i++){
        const flights=[plane('A',i%2?1200:180,{route:[],routeProblem:'No route prediction'}),plane('B',i%2?2000:250,{route:[{name:i%2?'ELTOK':'NILUG',seconds:800}]})]
        s=runEngine(packet(time+i*1000,flights),c,{},s)
        for(const f of s.flights){const old=accepted.flights.find(p=>p.callsign===f.callsign);assert.equal(f.sta,old.sta);assert.equal(f.staFf,old.staFf);assert.equal(f.delay,old.delay);assert.equal(f.order,old.order);assert.equal(f.passedFeeder,true);assert.equal(f.issue,'');assert.equal(f.feederId,old.feederId)}
    }
})

test('post-feeder order edits use filtered forecasts rather than an instantaneous route jump',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0
    const inputs=[plane('A',420),plane('B',540)]
    const first=runEngine(packet(time,inputs),c,{})
    const edits=reorderEdits(first,{},'B',time+410000)
    let s=runEngine(packet(time+1000,[plane('A',1200),plane('B',900)]),c,edits,first)
    assert.deepEqual(s.flights.slice().sort((a,b)=>a.order-b.order).map(f=>f.callsign),['B','A'])
    assert.equal(s.flights.find(f=>f.callsign==='B').delay,0)
    assert.equal(s.flights.find(f=>f.callsign==='A').delay,235)
    const slots=s.flights.map(f=>f.sta)
    c.rates['ESSA/19R']=240
    for(let i=2;i<10;i++)s=runEngine(packet(time+i*1000,[plane('A',600+i*60),plane('B',1800-i*60)]),c,edits,s)
    assert.deepEqual(s.flights.map(f=>f.sta),slots);assert.ok(s.flights.every(f=>!f.spacingConflict))
})

test('post-feeder closure and extra wake delays are reversible despite route ETA jitter',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0
    const first=runEngine(packet(time,[plane('A',420),plane('B',535)]),c,{})
    let s=runEngine(packet(time+1000,[plane('A',1000,{wake:'H'}),plane('B',1500)]),c,{},first)
    assert.equal(s.flights[0].delay,0);assert.equal(s.flights[1].delay,Math.round(wakeInterval('H','M','ESSA/19R',c)-115))
    c.slots=[{id:'closed',runway:'ESSA/19R',begin:time+400000,end:time+700000}]
    s=runEngine(packet(time+2000,[plane('A',1200,{wake:'H'}),plane('B',700)]),c,{},s)
    assert.ok(s.flights.every(f=>f.delay>0))
    c.slots=[]
    s=runEngine(packet(time+3000,[plane('A',900),plane('B',1800)]),c,{},s)
    for(const f of s.flights){const old=first.flights.find(p=>p.callsign===f.callsign);assert.equal(f.sta,old.sta);assert.equal(f.delay,old.delay)}
})


test('a cleared telemetry inventory removes old tracks immediately and new traffic bootstraps without an old-session minimum',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=600
    const first=runEngine(packet(time,[plane('OLD1',420),plane('OLD2',540)]),c,{})
    const cleared=runEngine(packet(time+1000,[]),c,{},first)
    assert.deepEqual(cleared.flights,[])
    const replaced=runEngine(packet(time+2000,[plane('NEW',120)]),c,{},first)
    assert.deepEqual(replaced.flights.map(f=>f.callsign),['NEW'])
    assert.equal(replaced.flights[0].minimumArrival,time+2000)
    assert.equal(replaced.flights[0].sta,time+122000)
    assert.deepEqual(toJuhaSequence(replaced,c,{}).sequence.map(f=>f.callsign),['NEW'])
})


test('explicit recompute releases a held early slot and discards post-feeder delay anchors',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0
    const first=runEngine(packet(time,[plane('SAS44D',1200)]),c,{})
    const later=runEngine(packet(time+1000,[plane('SAS44D',1680)]),c,{},first)
    assert.equal(later.flights[0].delay,Math.round((later.flights[0].staFf-later.flights[0].etaFf)/1000),'a later feeder ETA requires gain to reach the accepted feeder slot')
    const edits={SAS44D:{recomputeAt:time+2000,changedAt:time+2000}}
    const recomputed=runEngine(packet(time+2000,[plane('SAS44D',1680)]),c,edits,later)
    assert.equal(recomputed.flights[0].delay,0);assert.equal(recomputed.flights[0].sta,recomputed.flights[0].eta)
    assert.equal(recomputed.flights[0].reorderTiming,undefined);assert.equal(recomputed.flights[0].tmaTiming,undefined)
})


test('Frozen aircraft permit explicit controller moves while Recompute preserves entered order',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0
    const first=runEngine(packet(time,[plane('FROZEN',240),plane('WHITE',420),plane('GREEN',1200)]),c,{})
    assert.equal(first.flights[0].state,3)
    assert.doesNotThrow(()=>reorderEdits(first,{},'FROZEN',time+500000))
    assert.doesNotThrow(()=>reorderEdits(first,{},'WHITE',time+230000))
    assert.doesNotThrow(()=>validateLockedEdits(first,{}, {FROZEN:{order:1},WHITE:{order:0}}))
    const edits={FROZEN:{order:0,recomputeAt:time+2000,target:undefined}}
    assert.doesNotThrow(()=>validateLockedEdits(first,{},edits))
    const changed=runEngine(packet(time+2000,[plane('FROZEN',1200),plane('WHITE',418),plane('GREEN',1198)]),c,edits,first)
    assert.equal(changed.flights.find(f=>f.callsign==='FROZEN').state,2,'a recomputed twenty-minute assignment is no longer inside the Frozen horizon')
    assert.equal(changed.flights.find(f=>f.callsign==='FROZEN').order,0)
})

test('Stable order survives existing unstable ETA changes, but accepts newly captured earlier arrivals',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0
    const first=runEngine(packet(time,[plane('STABLE',1200),plane('BLUE',2000)]),c,{})
    const changed=runEngine(packet(time+1000,[plane('STABLE',1700),plane('BLUE',1600)]),c,{},first)
    assert.deepEqual(changed.flights.slice().sort((a,b)=>a.order-b.order).map(f=>f.callsign),['STABLE','BLUE'])
    const incoming=runEngine(packet(time+2000,[plane('STABLE',1700),plane('BLUE',1600),plane('NEW',1100)]),c,{},changed)
    assert.ok(incoming.flights.find(f=>f.callsign==='NEW').order<incoming.flights.find(f=>f.callsign==='STABLE').order)
})

test('planned time never marks Landed; touchdown needs sustained low altitude and speed near the airport',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0
    const first=runEngine(packet(time,[plane('AIRBORNE',5)]),c,{})
    const next=runEngine(packet(time+10000,[plane('AIRBORNE',120)]),c,{},first)
    assert.notEqual(next.flights[0].state,4)
    const ground=plane('AIRBORNE',0,{distanceNm:.1,groundspeed:40,altitude:180})
    const candidate=runEngine(packet(time+11000,[ground]),c,{},next)
    assert.notEqual(candidate.flights[0].state,4,'one ground-like sample is insufficient')
    const ended=runEngine(packet(time+16000,[ground]),c,{},candidate)
    assert.equal(ended.flights[0].state,4);assert.equal(ended.landings.at(-1).time,time+16000)
    const marked=runEngine(packet(time+11000,[plane('AIRBORNE',0)]),c,{AIRBORNE:{landedAt:time+11000}},next)
    assert.equal(marked.flights[0].state,4,'controller can explicitly confirm landing')
    const far=runEngine(packet(time+17000,[{...ground,distanceNm:20}]),c,{},candidate)
    assert.notEqual(far.flights[0].state,4,'a slow low aircraft away from the airport is not landed')
})


test('VACRA is an ESSA feeder crossing rather than the default synthetic feeder time',()=>{
    const c=config();c.unstableSeconds=0
    const s=runEngine(packet(time,[plane('VACRA1',1500,{route:[{name:'VACRA',seconds:400}]})]),c,{})
    const f=s.flights[0]
    assert.equal(f.ff,'VACRA');assert.equal(f.feeder,'VACRA');assert.equal(f.feederId,'V')
    assert.equal(f.etaFf,time+400000);assert.equal(f.passedFeeder,false)
    const passed=runEngine(packet(time+1000,[plane('VACRA1',1499,{route:[{name:'VACRA',seconds:-60}]})]),c,{},s)
    assert.equal(passed.flights[0].passedFeeder,true)
})


test('timed runway and rate changes survive together and apply chronologically to the active arrival runway',()=>{
    const c=config();c.pending={at:time+600000,active:['ESSA/01R'],departureRunway:'ESSA/01L',rates:{...c.rates,'ESSA/01R':180},applyRate:true}
    c.pendingRate={at:time+900000,seconds:150}
    const checked=validateConfig(c)
    assert.equal(checked.pendingRate.seconds,150);assert.equal(checked.pending.at,time+600000)
    assert.equal(effectiveConfig(checked,time).rates['ESSA/19R'],115)
    const afterRunway=effectiveConfig(checked,time+600000)
    assert.deepEqual(afterRunway.active,['ESSA/01R']);assert.equal(afterRunway.rates['ESSA/01R'],180)
    const afterRate=effectiveConfig(checked,time+900000)
    assert.equal(afterRate.rates['ESSA/01R'],150);assert.equal(afterRate.rates['ESSA/19R'],115)
    checked.pendingRate.at=time+300000
    assert.equal(effectiveConfig(checked,time+300000).rates['ESSA/19R'],150)
    assert.equal(effectiveConfig(checked,time+600000).rates['ESSA/19R'],150,'runway changes cannot overwrite unrelated rate history')
    checked.pendingRate.at=checked.pending.at
    assert.equal(effectiveConfig(checked,checked.pending.at).rates['ESSA/01R'],150,'explicit rate wins when both changes have the same time')
})

test('a runway-only configuration change cannot reset a separately planned rate',()=>{
    const c=config();c.pending={at:time+600000,active:['ESSA/19R'],departureRunway:'ESSA/01L',rates:{...c.rates},applyRate:false};c.pendingRate={at:time+300000,seconds:170}
    assert.equal(effectiveConfig(validateConfig(c),time+600000).rates['ESSA/19R'],170)
    assert.equal(effectiveConfig(validateConfig({...c,pending:undefined}),time+600000).rates['ESSA/19R'],170)
    assert.equal(effectiveConfig(validateConfig({...c,pendingRate:undefined}),time+600000).rates['ESSA/19R'],115)
    assert.throws(()=>validateConfig({...c,pendingRate:{at:time,seconds:10}}),/rate change/)
})


test('older timed rate-only records migrate out of the runway configuration slot',()=>{
    const c=config();c.pending={at:time+600000,active:[...c.active],departureRunway:c.departureRunway,rates:{...c.rates,'ESSA/19R':170}}
    const migrated=validateConfig(c)
    assert.equal(migrated.pending,undefined);assert.deepEqual(migrated.pendingRate,{at:time+600000,seconds:170})
    assert.equal(effectiveConfig(migrated,time+600000).rates['ESSA/19R'],170)
})

test('invalid ESSB runway data does not produce diagnostics or block valid ESSA arrivals',()=>{
    const c=config(),input=packet(time,[plane('ESSA1',1200),{callsign:'DEMAB',arrival:'ESSB',runway:'',route:null}])
    const valid=validateTelemetry(input,time)
    assert.deepEqual(valid.flights.map(f=>f.callsign),['ESSA1'])
    const s=runEngine(input,c,{})
    assert.deepEqual(s.flights.map(f=>f.callsign),['ESSA1']);assert.deepEqual(s.diagnostics,[])
    const old={...s,flights:[...s.flights,{...s.flights[0],callsign:'OLDESSB',arrival:'ESSB',runway:'30',state:4,sta:time}],landings:[{callsign:'OLDESSB',runway:'ESSB/30',time}]}
    const next=runEngine(packet(time+1000,[plane('ESSA1',1199)]),c,{},old)
    assert.equal(next.flights.some(f=>f.arrival==='ESSB'),false);assert.equal(next.landings.some(l=>l.runway.startsWith('ESSB/')),false)
    const native=toJuhaSequence(old,c,{})
    assert.deepEqual(native.airports.map(a=>a.icao),['ESSA']);assert.equal(native.sequence.some(f=>f.ades==='ESSB'),false)
})

const vectorRoute=[{name:'ELTOK',seconds:-1,latitude:59.824444,longitude:16.989917},{name:'FI01L',seconds:180,latitude:59.516028,longitude:17.869592},{name:'SA01L',seconds:300,latitude:59.637253,longitude:17.913222},{name:'ESSA',seconds:360,latitude:59.651944,longitude:17.918611}]
const vectorPlane=(extra={})=>plane('VECTOR1',1200,{runway:'01L',route:vectorRoute,latitude:59.57,longitude:17.889,heading:10.4,assignedHeading:0,calculatedRouteIndex:1,...extra})
const vectorConfig=()=>({...config(),active:['ESSA/01L'],departureRunway:'ESSA/01R',minimumNewSeconds:0,unstableSeconds:0})
test('final approach detection uses named runway geometry and observed speed without an assigned heading',()=>{
    const c=vectorConfig(),s=runEngine(packet(time,[vectorPlane({groundspeed:180})]),c,{})
    const f=s.flights[0]
    assert.equal(f.predictionSource,'vectoring');assert.equal(f.vectorDetection,'final')
    assert.ok(f.eta-time>60000&&f.eta-time<120000,'final estimate uses distance to the runway threshold, not the airport centre or stale STAR EET')
    assert.equal(f.state,3)
    const next=runEngine(packet(time+5000,[vectorPlane({groundspeed:100})]),c,{},s)
    assert.ok(next.flights[0].eta>f.eta)
    assert.equal(next.flights[0].sta,f.sta,'a changed forecast cannot silently move a Frozen slot')
    const edits={VECTOR1:{order:f.order,recomputeAt:time+6000,changedAt:time+6000}}
    const refreshed=runEngine(packet(time+6000,[vectorPlane({groundspeed:100})]),c,edits,next)
    assert.ok(refreshed.flights[0].sta>f.sta,'explicit recompute adopts the latest physical prediction')
    assert.equal(refreshed.flights[0].order,f.order)
})
test('off-route vector detection requires persistent fresh geometry and does not classify a matching direct-to as vectoring',()=>{
    const c=vectorConfig();c.frozenMinutes=0
    const p=vectorPlane({latitude:59.6,longitude:17.8,heading:90})
    let s=runEngine(packet(time,[p]),c,{})
    assert.equal(s.flights[0].predictionSource,'route')
    s=runEngine(packet(time+3000,[p]),c,{},s);assert.equal(s.flights[0].predictionSource,'route')
    s=runEngine(packet(time+6000,[p]),c,{},s);assert.equal(s.flights[0].vectorDetection,'off-route')
    const stale=runEngine(packet(time+7000,[{...p,positionAgeSeconds:20}]),c,{},s)
    assert.equal(stale.flights[0].predictionSource,'route')
    const d={...p,direct:'SA01L',heading:57}
    let direct=runEngine(packet(time,[d]),c,{})
    direct=runEngine(packet(time+10000,[d]),c,{},direct)
    assert.equal(direct.flights[0].vectorDetection,undefined,'a flight tracking its instructed direct remains route-based')
})

test('Stable dragging assigns both lose and gain times without exchanging unrelated slots',()=>{
    const c=config();c.unstableSeconds=0;c.stableMinutes=60;c.superStableMinutes=0;c.frozenMinutes=0;c.minimumNewSeconds=0
    const input=packet(time,[plane('FIRST',1200),plane('VKG2565',2400),plane('LAST',3600)])
    const first=runEngine(input,c,{})
    assert.equal(first.flights.find(f=>f.callsign==='VKG2565').state,1)
    for(const delta of [-120000,120000]){
        const edits=retimeEdits(first,{},'VKG2565',time+2400000+delta,'Runway',c)
        const next=runEngine(packet(time+1000,input.flights.map(f=>({...f,landingSeconds:f.landingSeconds-1}))),c,edits,first)
        const f=next.flights.find(f=>f.callsign==='VKG2565')
        assert.equal(f.sta,time+2400000+delta);assert.equal(f.delay,Math.round((f.staFf-f.etaFf)/1000))
        assert.equal(next.flights.find(f=>f.callsign==='LAST').sta,first.flights.find(f=>f.callsign==='LAST').sta)
        const repeated=runEngine(packet(time+5000,input.flights.map(f=>({...f,landingSeconds:f.landingSeconds-5}))),c,edits,next)
        assert.equal(repeated.flights.find(f=>f.callsign==='VKG2565').sta,f.sta)
    }
    const f=first.flights.find(f=>f.callsign==='VKG2565'),acc=retimeEdits(first,{},f.callsign,f.staFf+120000,'ACC',c)
    assert.equal(acc[f.callsign].target,f.sta+120000)
})
test('Stable feeder estimate drift and manual targets publish remaining feeder work',()=>{
    const c=config();c.unstableSeconds=0;c.stableMinutes=60;c.superStableMinutes=0;c.frozenMinutes=0;c.minimumNewSeconds=0
    const first=runEngine(packet(time,[plane('LEADER',600),plane('VKG2565',2400)]),c,{})
    const input=packet(time+5000,[plane('LEADER',595),plane('VKG2565',2330)])
    const drift=runEngine(input,c,{},first),f=drift.flights.find(f=>f.callsign==='VKG2565')
    assert.equal(f.runwayDelay,65);assert.equal(f.delay,Math.round((f.staFf-f.etaFf)/1000));assert.equal(f.sta,first.flights.find(f=>f.callsign==='VKG2565').sta)
    const ss=runEngine({...input,timestamp:time+5001,flights:input.flights.map(p=>p.callsign==='VKG2565'?{...p,route:[{name:'ELTOK',seconds:600}]}:p)},{...c,superStableMinutes:12},{},drift)
    assert.equal(ss.flights.find(p=>p.callsign==='VKG2565').state,2);assert.equal(ss.flights.find(p=>p.callsign==='VKG2565').delay,f.delay,'the accepted feeder work stays fixed on entering Superstable')
    const edits=retimeEdits(drift,{},f.callsign,f.eta+120000,'Runway',c)
    const manual=runEngine({...input,timestamp:time+5001},c,edits,drift)
    assert.ok(manual.flights.find(p=>p.callsign===f.callsign).delay>=119)
})

test('Super Stable before the feeder holds instructions through ETA changes and cleans up legacy unsolicited gains',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0
    const first=runEngine(packet(time,[plane('FIN3EJ',1000)]),c,{})
    assert.equal(first.flights[0].state,2);assert.equal(first.flights[0].passedFeeder,false)
    const old={...first,flights:first.flights.map(f=>({...f,delay:-110,runwayDelay:-110}))}
    const changed=runEngine(packet(time+5000,[plane('FIN3EJ',1200)]),c,{},old)
    assert.equal(changed.flights[0].delay,-110);assert.equal(changed.flights[0].sta,first.flights[0].sta)
    const again=runEngine(packet(time+10000,[plane('FIN3EJ',1250)]),c,{},changed)
    assert.equal(again.flights[0].delay,-110);assert.equal(again.flights[0].sta,first.flights[0].sta)
})
test('a Stable manual gain remains assigned on entering Super Stable',()=>{
    const c=config();c.unstableSeconds=0;c.stableMinutes=60;c.superStableMinutes=0;c.minimumNewSeconds=0;c.frozenMinutes=0
    const first=runEngine(packet(time,[plane('VKG2565',2400)]),c,{})
    const edits=retimeEdits(first,{},'VKG2565',time+2280000,'Runway',c)
    const manual=runEngine(packet(time+1000,[plane('VKG2565',2399)]),c,edits,first)
    assert.equal(manual.flights[0].delay,-120)
    const ss=runEngine(packet(time+2000,[plane('VKG2565',2398,{route:[{name:'ELTOK',seconds:200}]})]),{...c,superStableMinutes:5},edits,manual)
    assert.equal(ss.flights[0].state,2);assert.equal(ss.flights[0].delay,-120);assert.equal(ss.flights[0].tmaTiming.instructionSource,'manual')
})

test('resumed missed approaches remain movable while the old near-runway prediction persists, then arm freezing for a fresh approach',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=600
    const first=runEngine(packet(time,[plane('GOAROUND',180)]),c,{})
    assert.equal(first.flights[0].state,3)
    const missed=runEngine(packet(time+1000,[plane('GOAROUND',0,{altitude:100,groundspeed:40,distanceNm:.1})]),c,{GOAROUND:{mode:'missed'}},first)
    const edits={GOAROUND:{mode:'sequenced',recomputeAt:time+2000,changedAt:time+2000}}
    let resumed=runEngine(packet(time+2000,[plane('GOAROUND',-60,{altitude:100,groundspeed:40,distanceNm:.1})]),c,edits,missed)
    assert.equal(resumed.flights[0].state,2);assert.equal(resumed.flights[0].missedRecovery,true);assert.equal(resumed.flights[0].delay,0)
    resumed=runEngine(packet(time+6000,[plane('GOAROUND',0,{altitude:500,groundspeed:150})]),c,edits,resumed)
    assert.equal(resumed.flights[0].state,2)
    assert.doesNotThrow(()=>reorderEdits(resumed,edits,'GOAROUND',time+900000,'Runway',c))
    const fresh=runEngine(packet(time+10000,[plane('GOAROUND',900,{altitude:1500,groundspeed:180})]),c,edits,resumed)
    assert.equal(fresh.flights[0].missedRecovery,false);assert.equal(fresh.flights[0].state,2)
    const final=runEngine(packet(time+12000,[plane('GOAROUND',240,{altitude:1000,groundspeed:150})]),c,{GOAROUND:{...edits.GOAROUND,recomputeAt:time+12000}},fresh)
    assert.equal(final.flights[0].state,3,'Frozen returns normally on the next approach')
})

test('NSZ38K gains Super Stable status without inventing five lose minutes from its held estimate',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0;c.frozenMinutes=0;c.stableMinutes=30
    const first=runEngine(packet(time,[plane('NSZ38K',1800)]),c,{})
    assert.equal(first.flights[0].state,1)
    const next=runEngine(packet(time+5000,[plane('NSZ38K',1495,{route:[{name:'ELTOK',seconds:200}]})]),c,{},first)
    assert.equal(next.flights[0].state,2);assert.equal(next.flights[0].sta,first.flights[0].sta)
    assert.equal(next.flights[0].runwayDelay,300);assert.equal(next.flights[0].delay,0)
})

test('an explicit two-minute manual time survives an order change without an unaligned slot exchange',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0;c.stableMinutes=60;c.superStableMinutes=0;c.frozenMinutes=0
    const clock=time+40*60000,input=packet(clock,[plane('EWG89W',12*60),plane('NSZ38K',12*60)])
    const first=runEngine(input,c,{})
    const manual=retimeEdits(first,{},'NSZ38K',time+54*60000,'Runway',c)
    const assigned=runEngine(packet(clock+1000,input.flights.map(p=>({...p,landingSeconds:p.landingSeconds-1}))),c,manual,first)
    const assignedFlight=assigned.flights.find(f=>f.callsign==='NSZ38K');assert.equal(assignedFlight.delay,Math.round((assignedFlight.staFf-assignedFlight.etaFf)/1000))
    const ssConfig={...c,superStableMinutes:5}
    const ss=runEngine(packet(clock+2000,input.flights.map(p=>({...p,landingSeconds:p.landingSeconds-2,route:[{name:'ELTOK',seconds:200}]}))),ssConfig,manual,assigned)
    const swap=reorderEdits(ss,manual,'NSZ38K',time+52*60000-1,'Runway',ssConfig)
    const moved=runEngine(packet(clock+3000,input.flights.map(p=>({...p,landingSeconds:p.landingSeconds-3,route:[{name:'ELTOK',seconds:199}]}))),ssConfig,swap,ss)
    const nsz=moved.flights.find(f=>f.callsign==='NSZ38K')
    assert.equal(new Date(nsz.sta).getUTCMinutes(),54)
    assert.equal(nsz.delay,assignedFlight.delay);assert.equal(delayLabel(nsz.delay),delayLabel(assignedFlight.delay))
    assert.equal(nsz.tmaTiming.instructionSource,'manual')
    assert.equal(delayLabel(toJuhaSequence(moved,ssConfig,swap).sequence.find(f=>f.callsign==='NSZ38K').ttlttg_ff),delayLabel(assignedFlight.delay))
})


test('SAS898 moving from minute 24 to 22 satisfies its old two-minute lose instruction inside the TMA',()=>{
 const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0;c.frozenMinutes=0;c.rates['ESSA/19R']=120
 const input=packet(time,[plane('SAS035',1320,{route:[{name:'ELTOK',seconds:-1}]}),plane('SAS898',1320,{route:[{name:'ELTOK',seconds:-1}]})])
 const seed=runEngine(input,c,{})
 assert.equal(seed.flights.find(f=>f.callsign==='SAS898').delay,120)
 assert.equal(new Date(seed.flights.find(f=>f.callsign==='SAS898').sta).getUTCMinutes(),24)
 const edits=reorderEdits(seed,{},'SAS898',time+1320000-1,'Runway',c)
 let moved=runEngine(packet(time+1000,input.flights.map(f=>({...f,landingSeconds:f.landingSeconds-1}))),c,edits,seed)
 const leading=moved.flights.find(f=>f.callsign==='SAS898')
 assert.equal(new Date(leading.sta).getUTCMinutes(),22);assert.equal(leading.delay,0)
 assert.equal(moved.flights.find(f=>f.callsign==='SAS035').delay,120)
 for(let seconds=2;seconds<10;seconds++){
  moved=runEngine(packet(time+seconds*1000,input.flights.map(f=>({...f,landingSeconds:f.landingSeconds-seconds}))),c,edits,moved)
  assert.equal(moved.flights.find(f=>f.callsign==='SAS898').delay,0)
 }
})
test('EuroScope gain/lose ends at TMA entry and stays suppressed after turning back',()=>{
 const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0;c.frozenMinutes=0
 const fix={latitude:59.824444,longitude:16.989917}
 const p=plane('TTLTEST',1400,{route:[{name:'ELTOK',seconds:-1}],latitude:fix.latitude-.18,longitude:fix.longitude})
 const first=runEngine(packet(time,[p]),c,{})
 const seed={...first,flights:first.flights.map(f=>({...f,sta:f.sta+120000,delay:120,tmaTiming:{delay:120,rateSeconds:115,instructionSource:'manual'}}))}
 const edits={TTLTEST:{target:time+1520000,targetKind:'time'}}
 const near=runEngine(packet(time+1000,[{...p,landingSeconds:1399}]),c,edits,seed)
 assert.ok(near.flights[0].feederDistanceNm<12);assert.equal(euroscopeInstruction(near.flights[0]),0)
 const far=runEngine(packet(time+2000,[{...p,latitude:fix.latitude-.21,landingSeconds:1398}]),c,edits,near)
 assert.ok(far.flights[0].feederDistanceNm>=12);assert.equal(far.flights[0].delay,120)
 assert.equal(euroscopeInstruction(far.flights[0]),0);assert.equal(toJuhaSequence(far,c,{}).sequence[0].ttlttg_ff,0)
 const back=runEngine(packet(time+3000,[{...p,landingSeconds:1397}]),c,edits,far)
 assert.equal(euroscopeInstruction(back.flights[0]),0)
 const before=runEngine(packet(time,[{...p,latitude:fix.latitude+.4,route:[{name:'ELTOK',seconds:700}]}]),c,{})
 assert.equal(before.flights[0].passedFeeder,false);assert.equal(before.flights[0].line0Suppressed,false)
 assert.equal(euroscopeInstruction({...before.flights[0],delay:120}),120)
})


test('EuroScope runway reassignment supersedes an AMAN override and persists on later updates',()=>{
    const c=config();c.active=['ESSA/01L'];c.minimumNewSeconds=0
    const edits={NOZ812:{runway:'ESSA/01L',runwayAssignment:'19R',changedAt:time}}
    const input=packet(time,[plane('NOZ812',1200)])
    const manual=runEngine(input,c,edits)
    assert.equal(manual.flights[0].runway,'01L')
    assert.equal(manual.flights[0].euroscopeRunway,'19R')
    assert.equal(input.flights[0].runway,'19R','AMAN must not write into EuroScope telemetry')
    assert.equal(reconcileRunwayAssignments(input,edits,manual).NOZ812.runway,'ESSA/01L','unchanged SDK data must retain the AMAN override')
    const changed=packet(time+2000,[plane('NOZ812',1200,{runway:'26'})])
    const cleaned=reconcileRunwayAssignments(changed,edits,manual)
    assert.equal(cleaned.NOZ812.runway,undefined)
    c.active=['ESSA/26']
    const assigned=runEngine(changed,c,cleaned,manual)
    assert.equal(assigned.flights[0].runway,'26')
    const later=runEngine(packet(time+4000,[plane('NOZ812',1200,{runway:'26'})]),c,cleaned,assigned)
    assert.equal(later.flights[0].runway,'26')
    assert.equal(edits.NOZ812.runway,'ESSA/01L','reconciliation must not mutate the supplied edits')
})

const gainFlight=(callsign,wake='M',extra={})=>plane(callsign,2400,{wake,latitude:60.61,longitude:16.989917,altitude:18000,groundspeed:180,verticalSpeed:0,positionAgeSeconds:0,route:[{name:'ELTOK',seconds:1800}],...extra})
test('model-based Stable follower retains its accepted time until an explicit recalculation',()=>{
    const c=structuredClone(DEFAULT_CONFIG);c.unstableSeconds=0;c.minimumNewSeconds=0;c.frozenMinutes=0;c.stableMinutes=120;c.superStableMinutes=0;c.rates['ESSA/19R']=85
    const traffic=['AAA','BBB','CCC'].map(name=>gainFlight(name,'M',{aircraft:'UNKNOWN'}))
    const first=runEngine(packet(time,traffic),c,{})
    const saved={...first,flights:first.flights.map((f,i)=>({...f,state:i===1?1:2,order:i,sta:f.eta+300000+i*85000,committedSta:f.eta+300000+i*85000,planningEta:undefined,delay:300+i*85,tmaTiming:{delay:0,rateSeconds:85,instructionSource:'none'}}))}
    const next=runEngine(packet(time+1000,traffic),c,{},saved)
    const middle=next.flights.find(f=>f.callsign==='BBB')
    assert.equal(middle.order,1);assert.equal(middle.state,1)
    assert.equal(middle.sta,saved.flights[1].sta,'ordinary observation does not replace the accepted allocation')
    for(const f of next.flights)if(f.separation)assert.ok(f.separation.scheduledSeconds>=85)
})
test('a feasible first-aircraft gain reduces follower delay without breaking wake separation',()=>{
    const c=structuredClone(DEFAULT_CONFIG);c.minimumNewSeconds=0
    const input=packet(time,[gainFlight('FDX596','H'),gainFlight('SAS1AB')])
    const next=runEngine(input,c,{})
    const lead=next.flights.find(f=>f.callsign==='FDX596'),follow=next.flights.find(f=>f.callsign==='SAS1AB')
    assert.ok(lead.gainCapacitySeconds>=30)
    assert.ok(lead.delay<0)
    assert.ok(-lead.delay<=lead.gainCapacitySeconds)
    assert.ok(follow.sta>=lead.sta+wakeInterval('H','M','ESSA/19R',c)*1000-1)
    const blocked=runEngine(packet(time,[gainFlight('FDX596','H',{aircraft:'UNKN'}),gainFlight('SAS1AB')]),c,{})
    assert.equal(blocked.flights.find(f=>f.callsign==='FDX596').delay,0)
    assert.ok(follow.delay<blocked.flights.find(f=>f.callsign==='SAS1AB').delay)
    assert.equal(input.flights[0].groundspeed,180)
})
test('automatic gain is withheld for unavailable performance, binding speed caps, TMA and closure constraints',()=>{
    const c=structuredClone(DEFAULT_CONFIG);c.minimumNewSeconds=0
    for(const extra of [{aircraft:'UNKN'},{positionAgeSeconds:20},{assignedSpeed:100},{verticalSpeed:1000}]){
        const result=runEngine(packet(time,[gainFlight('FDX596','H',extra),gainFlight('SAS1AB')]),c,{})
        const first=result.flights.find(f=>f.callsign==='FDX596')
        assert.ok(!first.automaticGainSeconds)
        assert.ok(first.delay>=0)
    }
    const result=runEngine(packet(time,[gainFlight('FDX596','H'),gainFlight('SAS1AB')]),c,{})
    const first=result.flights.find(f=>f.callsign==='FDX596')
    c.slots=[{id:'closed',runway:'ESSA/19R',begin:time+1000,end:time+5000}]
    const closure=runEngine(packet(time,[gainFlight('FDX596','H'),gainFlight('SAS1AB')]),c,{})
    assert.equal(closure.flights.find(f=>f.callsign==='FDX596').delay,0)
    assert.equal(gainCapacitySeconds(gainFlight('TMA'),c,{...first.distanceProfile,beforeFeederNm:0}),0)
})
test('a retained automatic gain is withdrawn when performance no longer supports it',()=>{
    const c=structuredClone(DEFAULT_CONFIG);c.minimumNewSeconds=0
    const first=runEngine(packet(time,[gainFlight('FDX596','H'),gainFlight('SAS1AB')]),c,{})
    assert.ok(first.flights.find(f=>f.callsign==='FDX596').delay<0)
    const next=runEngine(packet(time+1000,[gainFlight('FDX596','H',{assignedSpeed:100}),gainFlight('SAS1AB')]),c,{},first)
    assert.ok(next.flights.find(f=>f.callsign==='FDX596').delay>=0)
    const alone=runEngine(packet(time+1000,[gainFlight('FDX596','H')]),c,{},first)
    assert.equal(alone.flights[0].delay,0,'automatic gain clears when there is no follower to help')
})

test('Unstable order follows current estimated entry times while new earlier traffic can insert',()=>{
    const c=config();c.minimumNewSeconds=0
    const first=runEngine(packet(time,[plane('SAS886',1200),plane('GLD1620',1300),plane('EWG1B',1400)]),c,{})
    const order=first.flights.sort((a,b)=>a.order-b.order).map(f=>f.callsign)
    const flipped=runEngine(packet(time+1000,[plane('SAS886',1600),plane('GLD1620',1300),plane('EWG1B',1100)]),c,{},first)
    assert.deepEqual(flipped.flights.sort((a,b)=>a.order-b.order).map(f=>f.callsign),['EWG1B','GLD1620','SAS886'])
    const inserted=runEngine(packet(time+2000,[plane('SAS886',1600),plane('GLD1620',1300),plane('EWG1B',1100),plane('NEW',900)]),c,{},flipped)
    const newOrder=inserted.flights.sort((a,b)=>a.order-b.order).map(f=>f.callsign)
    assert.equal(newOrder[0],'NEW')
    assert.deepEqual(newOrder.filter(call=>call!=='NEW'),['EWG1B','GLD1620','SAS886'])
})

test('known live arrivals may receive spacing instructions before reaching 50 NM',()=>{
    const c=structuredClone(DEFAULT_CONFIG);c.minimumNewSeconds=0
    const far=runEngine(packet(time,[gainFlight('FDX596','H',{latitude:61.5}),gainFlight('SAS1AB','M',{latitude:61.5})]),c,{})
    assert.equal(far.flights.length,2)
    assert.ok(far.flights.every(f=>f.spacingActive));assert.ok(far.flights.find(f=>f.callsign==='FDX596').delay<0)
    assert.ok(far.flights.find(f=>f.callsign==='SAS1AB').planningDelaySeconds>0)
    const near=runEngine(packet(time+1000,[gainFlight('FDX596','H'),gainFlight('SAS1AB')]),c,{},far)
    assert.ok(near.flights.every(f=>f.spacingActive))
    assert.ok(near.flights.find(f=>f.callsign==='FDX596').delay<0)
    assert.deepEqual(near.flights.sort((a,b)=>a.order-b.order).map(f=>f.callsign),far.flights.sort((a,b)=>a.order-b.order).map(f=>f.callsign))
})

test('superstable swap out and back restores the original lose instruction',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0;c.frozenMinutes=0;c.rates['ESSA/19R']=120
    const traffic=[plane('FDX596',1320,{wake:'H',route:[{name:'ELTOK',seconds:-1}]}),plane('SAS1AB',1320,{route:[{name:'ELTOK',seconds:-1}]})]
    const initial=runEngine(packet(time,traffic),c,{})
    const original=initial.flights.find(f=>f.callsign==='SAS1AB').delay;assert.ok(original>0)
    const swap=reorderEdits(initial,{},'SAS1AB',initial.flights.find(f=>f.callsign==='FDX596').sta-1,'Runway',c)
    const moved=runEngine(packet(time+1000,traffic.map(f=>({...f,landingSeconds:f.landingSeconds-1}))),c,swap,initial)
    assert.equal(moved.flights.find(f=>f.callsign==='SAS1AB').delay,0)
    assert.equal(moved.flights.find(f=>f.callsign==='FDX596').delay,120,'the current M/H pair requires only the arrival rate, not the old H/M wake gap')
    const back=reorderEdits(moved,swap,'FDX596',moved.flights.find(f=>f.callsign==='SAS1AB').sta-1,'Runway',c)
    const restored=runEngine(packet(time+2000,traffic.map(f=>({...f,landingSeconds:f.landingSeconds-2}))),c,back,moved)
    assert.equal(restored.flights.find(f=>f.callsign==='SAS1AB').delay,original)
})
test('superstable instructions remain accepted during ordinary estimate jitter',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0;c.frozenMinutes=0;c.rates['ESSA/19R']=150
    const traffic=[plane('FDX596',1200,{wake:'H',route:[{name:'ELTOK',seconds:500}]}),plane('SAS1AB',1200,{route:[{name:'ELTOK',seconds:-1}]})]
    let previous=runEngine(packet(time,traffic),c,{})
    previous=runEngine(packet(time+1000,traffic.map(f=>({...f,landingSeconds:f.landingSeconds-1}))),c,{},previous)
    const delay=previous.flights.find(f=>f.callsign==='SAS1AB').delay
    for(let tick=2;tick<15;tick++){
        previous=runEngine(packet(time+tick*1000,traffic.map((f,i)=>({...f,landingSeconds:f.landingSeconds-tick+(i===0?(tick%2?25:-25):0)}))),c,{},previous)
        assert.equal(previous.flights.find(f=>f.callsign==='SAS1AB').delay,delay)
    }
})
test('invalid optional assigned speed does not stale the complete telemetry packet or permit gain',()=>{
    const raw=packet(time,[gainFlight('BAD','H',{assignedSpeed:750}),gainFlight('GOOD')])
    const data=validateTelemetry(raw,time)
    assert.equal(data.flights.length,2);assert.equal(data.flights[0].assignedSpeed,0);assert.equal(data.flights[0].speedDataValid,false)
    assert.ok(data.flights[0].dataWarnings.length)
    const c=structuredClone(DEFAULT_CONFIG);c.minimumNewSeconds=0
    const result=runEngine(data,c,{})
    assert.equal(result.timestamp,time);assert.equal(result.flights.find(f=>f.callsign==='BAD').gainCapacitySeconds,0)
    assert.equal(raw.flights[0].assignedSpeed,750)
})

test('before-feeder superstable swaps transfer sequencing delay to the aircraft moved behind',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0;c.frozenMinutes=0;c.rates['ESSA/19R']=120
    const input=packet(time,[plane('AAA',1300,{route:[{name:'ELTOK',seconds:300}]}),plane('ZZZ',1300,{route:[{name:'ELTOK',seconds:300}]})])
    let first=runEngine(input,c,{})
    first=runEngine(packet(time+1000,input.flights.map(f=>({...f,landingSeconds:f.landingSeconds-1}))),c,{},first)
    assert.ok(first.flights.every(f=>f.state===2&&!f.passedFeeder))
    const original=first.flights.find(f=>f.callsign==='ZZZ').delay;assert.ok(original>0)
    const edits=reorderEdits(first,{},'ZZZ',first.flights.find(f=>f.callsign==='AAA').sta-1,'Runway',c)
    const next=runEngine(packet(time+2000,input.flights.map(f=>({...f,landingSeconds:f.landingSeconds-2}))),c,edits,first)
    assert.equal(next.flights.find(f=>f.callsign==='ZZZ').delay,0)
    assert.equal(next.flights.find(f=>f.callsign==='AAA').delay,original)
})

test('rate-generated superstable delay also transfers when its stored baseline is zero',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0;c.frozenMinutes=0;c.rates['ESSA/19R']=120
    const traffic=[plane('AAA',1300,{route:[{name:'ELTOK',seconds:-1}]}),plane('ZZZ',1300,{route:[{name:'ELTOK',seconds:-1}]})]
    const first=runEngine(packet(time,traffic),c,{})
    const seed={...first,flights:first.flights.map(f=>f.callsign==='ZZZ'?{...f,delay:120,rateDelayMs:120000,tmaTiming:{delay:0,rateSeconds:120,instructionSource:'none'}}:{...f,tmaTiming:{delay:0,rateSeconds:120,instructionSource:'none'}})}
    const edits=reorderEdits(seed,{},'ZZZ',seed.flights.find(f=>f.callsign==='AAA').sta-1,'Runway',c)
    const next=runEngine(packet(time+1000,traffic.map(f=>({...f,landingSeconds:f.landingSeconds-1}))),c,edits,seed)
    assert.equal(next.flights.find(f=>f.callsign==='ZZZ').delay,0)
    assert.equal(next.flights.find(f=>f.callsign==='AAA').delay,120)
})

test('a provisional flight becoming superstable cannot push existing committed aircraft back',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0;c.frozenMinutes=0;c.rates['ESSA/19R']=143
    const traffic=[plane('FORECAST',1100,{route:[{name:'ELTOK',seconds:1000}]}),plane('LOCKED1',1200,{route:[{name:'ELTOK',seconds:-1}]}),plane('LOCKED2',1320,{route:[{name:'ELTOK',seconds:-1}]})]
    const first=runEngine(packet(time,traffic),c,{})
    const committed=first.flights.filter(f=>f.callsign.startsWith('LOCKED'))
    const moved=runEngine(packet(time+1000,traffic.map(f=>f.callsign==='FORECAST'?{...f,landingSeconds:1600,route:[{name:'ELTOK',seconds:400}]}:{...f,landingSeconds:f.landingSeconds-1})),c,{},first)
    for(const f of committed){const next=moved.flights.find(p=>p.callsign===f.callsign);assert.ok(next.sta<=f.sta,'automatic times may advance when an obsolete preceding constraint disappears');assert.ok(next.delay<600)}
    const locked=moved.flights.filter(f=>f.callsign.startsWith('LOCKED')).sort((a,b)=>a.order-b.order)
    assert.equal(locked[1].sta-locked[0].sta,143000)
    assert.equal(moved.flights.find(f=>f.callsign==='FORECAST').order,2)
})

test('old automatic Superstable slots do not cascade into a five-minute follower delay',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0;c.frozenMinutes=0;c.rates['ESSA/19R']=85
    const seconds=[960,1379,1394,1557,1668,1712,1686]
    const held=[1173,1550,1635,1734,1819,1904,1989]
    const traffic=seconds.map((s,i)=>plane(`AUTO${i}`,s,{route:[{name:'ELTOK',seconds:-1}]}))
    const first=runEngine(packet(time,traffic),c,{})
    const saved={...first,flights:first.flights.map((f,i)=>({...f,order:i,sta:time+held[i]*1000,committedSta:time+held[i]*1000,planningEta:undefined,planningEtaCandidate:undefined,tmaTiming:{delay:0,rateSeconds:85,instructionSource:'none'},delay:0}))}
    const next=runEngine(packet(time+1000,traffic.map(f=>({...f,landingSeconds:f.landingSeconds-1}))),c,{},saved)
    const sorted=next.flights.sort((a,b)=>a.order-b.order)
    assert.deepEqual(sorted.map(f=>f.callsign),traffic.map(f=>f.callsign))
    assert.equal(sorted[0].sta,sorted[0].eta)
    assert.equal(sorted.at(-1).delay,152)
    for(let i=1;i<sorted.length;i++)assert.ok(sorted[i].sta-sorted[i-1].sta>=85000)
})

test('Superstable allocations and instructions remain fixed through sustained prediction changes',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0;c.frozenMinutes=0;c.rates['ESSA/19R']=85
    const ssPlane=(name,seconds)=>plane(name,seconds,{route:[{name:'ELTOK',seconds:300}]})
    let previous=runEngine(packet(time,[ssPlane('AAA',1500),ssPlane('BBB',1500)]),c,{})
    assert.ok(previous.flights.every(f=>f.state===2))
    const original=previous.flights.map(f=>f.sta)
    for(let tick=1;tick<=14;tick++){
        previous=runEngine(packet(time+tick*1000,[ssPlane('AAA',1500-tick+(tick%2?25:-25)),ssPlane('BBB',1500-tick)]),c,{},previous)
        assert.deepEqual(previous.flights.map(f=>f.sta),original)
    }
    for(let tick=15;tick<=31;tick++)previous=runEngine(packet(time+tick*1000,[ssPlane('AAA',1380-tick),ssPlane('BBB',1500-tick)]),c,{},previous)
    assert.deepEqual(previous.flights.map(f=>f.sta),original)
    assert.equal(previous.flights[1].delay,85,'Refresh delay or Recompute is required')
    assert.deepEqual(previous.flights.map(f=>f.callsign),['AAA','BBB'])
})

test('manual and Frozen slots remain protected when automatic predictions shift',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0;c.frozenMinutes=5
    const traffic=[plane('FROZEN',180),plane('MANUAL',1200)]
    const edits={MANUAL:{target:time+1350000}}
    let previous=runEngine(packet(time,traffic),c,edits)
    const slots=previous.flights.map(f=>f.sta)
    for(let tick=1;tick<=20;tick++)previous=runEngine(packet(time+tick*1000,traffic.map(f=>({...f,landingSeconds:f.landingSeconds-tick+120}))),c,edits,previous)
    assert.deepEqual(previous.flights.map(f=>f.sta),slots)
})

test('a continuously improving prediction cannot keep restarting the automatic ETA filter',()=>{
 const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0;c.frozenMinutes=0
 const traffic=seconds=>[plane('TREND',seconds,{route:[{name:'ELTOK',seconds:300}]})]
 let s=runEngine(packet(time,traffic(1500)),c,{})
 for(let tick=1;tick<=24;tick++)s=runEngine(packet(time+tick*1000,traffic(1500-tick-tick*5)),c,{},s)
 assert.ok(s.flights[0].planningEta<time+1440000,'a sustained gradual correction is accepted despite exceeding 30 seconds overall')
 assert.ok(Math.abs(s.flights[0].planningEta-s.flights[0].eta)<90000)
})
test('legacy twenty-minute forecast pressure is removed without repeatedly replaying stale order edits',()=>{
    const c=config();c.unstableSeconds=0;c.minimumNewSeconds=0;c.frozenMinutes=0;c.rates['ESSA/19R']=143
    const traffic=[plane('LOCKED1',600,{route:[{name:'ELTOK',seconds:-1}]}),plane('LOCKED2',700,{route:[{name:'ELTOK',seconds:-1}]}),plane('LATER',1657,{route:[{name:'ELTOK',seconds:-1}]})]
    const first=runEngine(packet(time,traffic),c,{})
    const corrupt={...first,flights:first.flights.map(f=>{
        const base=f.callsign==='LOCKED1'?600:f.callsign==='LOCKED2'?743:1657
        const pushed=f.callsign==='LATER'?0:1200000
        return {...f,editTracking:undefined,committedSta:undefined,order:f.callsign==='LATER'?0:f.callsign==='LOCKED1'?1:2,sta:time+base*1000+pushed,delay:f.delay+pushed/1000,rateDelayMs:pushed,tmaTiming:{delay:f.delay,rateSeconds:143,instructionSource:f.delay?'constraint':'none',referenceSta:time+base*1000}}
    })}
    const edits={LOCKED1:{order:1,target:time+600000,changedAt:time-1000},LOCKED2:{order:2,target:time+743000,changedAt:time-1000}}
    let next=runEngine(packet(time+1000,traffic.map(f=>({...f,landingSeconds:f.landingSeconds-1}))),c,edits,corrupt)
    assert.deepEqual(next.flights.sort((a,b)=>a.order-b.order).map(f=>f.callsign),['LOCKED1','LOCKED2','LATER'])
    assert.equal(next.flights.find(f=>f.callsign==='LOCKED1').sta,time+600000)
    assert.equal(next.flights.find(f=>f.callsign==='LOCKED2').sta,time+743000)
    for(let i=2;i<8;i++){
        next=runEngine(packet(time+i*1000,traffic.map(f=>({...f,landingSeconds:f.landingSeconds-i}))),c,edits,next)
        assert.ok(next.flights.every(f=>f.delay<600))
        assert.deepEqual(next.flights.sort((a,b)=>a.order-b.order).map(f=>f.callsign),['LOCKED1','LOCKED2','LATER'])
    }
})
