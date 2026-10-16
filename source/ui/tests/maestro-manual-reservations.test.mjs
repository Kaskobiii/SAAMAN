import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DEFAULT_CONFIG,runEngine} from '../src/maestro-engine.ts'
import {pruneRetiredManualFlights,pruneExpiredManualEdits} from '../src/maestro-manual-reservations.ts'

const now=Date.UTC(2026,9,16,10)
const reservation={callsign:'CCA911',runway:'ESSA/19R',aircraft:'UNKN',wake:'?',feeder:'ELTOK',eta:now+1200000}
const config=()=>({...structuredClone(DEFAULT_CONFIG),unstableSeconds:0,minimumNewSeconds:0,manualFlights:[{...reservation}]})
const packet=(timestamp,flights=[])=>({timestamp,source:'ESSA_FMP',flights})
const real={callsign:'CCA911',aircraft:'B77W',wake:'H',departure:'ZBAA',arrival:'ESSA',runway:'19R',route:[{name:'ELTOK',seconds:600}],landingSeconds:1200,distanceNm:100,groundspeed:300,altitude:15000}

test('manual placeholder is consumed by the live flight and cannot return after track loss, landing or checkpoint restoration',()=>{
 const c=config();let s=runEngine(packet(now),c,{})
 assert.equal(s.flights[0].aircraft,'UNKN')
 s=runEngine(packet(now+1000,[real]),c,{},s)
 assert.equal(s.flights.length,1);assert.equal(s.flights[0].aircraft,'B77W')
 assert.equal(s.retiredManualFlights.CCA911.reason,'live')
 for(const seconds of [2,4,10,1210]){
  s=runEngine(packet(now+seconds*1000),c,{},JSON.parse(JSON.stringify(s)))
  assert.ok(!s.flights.some(p=>p.callsign==='CCA911'))
  assert.ok(!s.diagnostics.some(p=>p.includes('CCA911')))
 }
 assert.deepEqual(pruneRetiredManualFlights(c,s).manualFlights,[])
 assert.equal(c.manualFlights.length,1,'engine must not mutate caller config')
})

test('old checkpoint from before consumption tracking heals using its observed live inventory',()=>{
 const c=config(),s=runEngine(packet(now,[real]),{...c,manualFlights:[]},{})
 delete s.retiredManualFlights
 const restored=runEngine(packet(now+1000),c,{},s)
 assert.equal(restored.retiredManualFlights.CCA911.reason,'live')
 assert.equal(restored.flights.length,0)
})

test('expired unused reservation is retired on reload instead of producing an invalid destination prediction',()=>{
 const c=config();c.manualFlights[0].eta=now-60000
 const s=runEngine(packet(now),c,{})
 assert.equal(s.flights.length,0);assert.deepEqual(s.diagnostics,[])
 assert.equal(s.retiredManualFlights.CCA911.reason,'elapsed')
})

test('a later manual target or closure assignment keeps a reservation alive past its initial time',()=>{
 const c=config(),target=reservation.eta+600000,edits={CCA911:{target,targetKind:'time',changedAt:now}}
 let s=runEngine(packet(now),c,edits)
 s=runEngine(packet(reservation.eta+1000),c,edits,s)
 assert.equal(s.flights.length,1);assert.equal(s.flights[0].sta,target)
 assert.equal(s.retiredManualFlights,undefined)
 s=runEngine(packet(target+1000),c,edits,s)
 assert.equal(s.flights.length,0)
})

test('a deliberately new reservation for the same callsign is not suppressed by the old retirement',()=>{
 const c=config();let s=runEngine(packet(now,[real]),c,{})
 const later=structuredClone(c);later.manualFlights[0].eta+=600000
 s=runEngine(packet(now+1000),later,{},s)
 assert.equal(s.flights.length,1);assert.equal(s.retiredManualFlights,undefined)
 const original=config(),edits={CCA911:{requeueAt:now+2000,recomputeAt:now+2000,target:reservation.eta,targetKind:'time'}}
 const retired=runEngine(packet(now,[real]),original,{})
 const reinserted=runEngine(packet(now+2000),original,edits,retired)
 assert.equal(reinserted.flights.length,1)
})

test('unrelated live traffic and brief lack of a correlated target do not retire a future reservation',()=>{
 const c=config(),s=runEngine({...packet(now,[{...real,callsign:'OTHER123'}]),knownFlights:[{...real}]},c,{})
 assert.ok(s.flights.some(p=>p.callsign==='CCA911'))
 assert.equal(s.retiredManualFlights,undefined)
 assert.equal(pruneRetiredManualFlights(c,s),c)
})

test('expiry removes the obsolete manual target so a later live flight cannot inherit a past slot',()=>{
 const c=config(),edits={CCA911:{target:reservation.eta,targetKind:'time',changedAt:now,requeueAt:now,recomputeAt:now}}
 const first=runEngine(packet(now),c,edits)
 const expired=runEngine(packet(reservation.eta+1000),c,edits,first)
 const clean=pruneExpiredManualEdits(edits,expired)
 assert.deepEqual(clean,{})
 const live=runEngine(packet(reservation.eta+2000,[real]),c,edits,expired)
 assert.ok(live.flights[0].sta>live.timestamp)
 assert.equal(live.flights[0].delay,0)
 assert.deepEqual(pruneExpiredManualEdits({...edits,CCA911:{...edits.CCA911,changedAt:expired.timestamp+1}},expired).CCA911.changedAt,expired.timestamp+1)
})
