import {test} from 'node:test'
import assert from 'node:assert/strict'
import {runEngine,controllerInstructionSeconds,euroscopeInstruction} from '../src/maestro-engine.ts'
import fixture from './fixtures/initial-work-release-busy.json' with {type:'json'}
const row=(s,c)=>s.flights.find(f=>f.callsign===c)
for(const c of fixture.cases)test(`busy recording ${c.recording} frame ${c.frame}: ${c.callsign} cannot receive work absent from its assigned feeder slot`,()=>{
 const original=structuredClone(c),s=runEngine(c.input,c.config,c.edits,c.previous),f=row(s,c.callsign)
 assert.ok(c.oldControllerInstruction>=60);assert.equal(c.oldScheduledDifference,0)
 assert.equal(f.feederEtaAvailable,true);assert.equal(f.feederGuidanceAvailable,true);assert.equal(f.initialProfile.pending,true)
 assert.equal(f.staFf,f.etaFf);assert.equal(f.delay,0);assert.equal(controllerInstructionSeconds(f),0);assert.equal(euroscopeInstruction(f),0)
 assert.equal(f.guidance.instructionSeconds,0);assert.equal(f.guidance.absorption.mode,'none')
 assert.ok(f.initialProfile.workSeconds>=60,'historical capture work remains diagnostic data')
 assert.deepEqual(c,original,'recorded inputs and checkpoints remain unchanged')
})

test('inflating obsolete confirmation work does not invent a new reservation or instruction',()=>{
 const c=structuredClone(fixture.cases[0]),p=row(c.previous,c.callsign)
 p.initialProfile.workSeconds=7200
 const s=runEngine(c.input,c.config,c.edits,c.previous),f=row(s,c.callsign)
 assert.equal(f.staFf,f.etaFf);assert.equal(f.delay,0);assert.equal(controllerInstructionSeconds(f),0)
})

test('a real runway closure during confirmation still produces its assigned feeder work',()=>{
 const c=structuredClone(fixture.cases[0]),before=row(runEngine(c.input,c.config,c.edits,c.previous),c.callsign)
 c.config.slots=[{id:'REAL',kind:'closure',runway:`ESSA/${before.runway}`,begin:before.sta-1000,end:before.sta+180000}]
 const s=runEngine(c.input,c.config,c.edits,c.previous),f=row(s,c.callsign)
 assert.ok(f.sta>=c.config.slots[0].end);assert.ok(f.delay>0)
 assert.equal(f.delay,Math.max(0,Math.round((f.staFf-f.etaFf)/1000)))
 assert.equal(controllerInstructionSeconds(f),f.delay);assert.equal(f.guidance.instructionSeconds,f.delay)
})

test('an explicit controller time remains authoritative while a profile is being confirmed',()=>{
 const c=structuredClone(fixture.cases[1]),old=row(runEngine(c.input,c.config,c.edits,c.previous),c.callsign),target=Math.max(old.sta,old.euroscopeBaseline.eta)+180000
 c.edits[c.callsign]={...c.edits[c.callsign],target,targetKind:'time',changedAt:c.input.timestamp}
 const s=runEngine(c.input,c.config,c.edits,c.previous),f=row(s,c.callsign)
 assert.ok(f.sta>=target);assert.ok(f.delay>0);assert.equal(controllerInstructionSeconds(f),f.delay)
})


for(const original of fixture.cases)test(`busy ${original.callsign}: confirming a free replacement model cannot reserve the old work again`,()=>{
 const c=structuredClone(original),candidate=row(runEngine(c.input,c.config,c.edits,c.previous),c.callsign)
 const old=row(c.previous,c.callsign)
 old.initialProfile={...old.initialProfile,pending:true,candidateSince:c.input.timestamp-15000,candidateEta:candidate.initialProfile.candidateEta}
 const s=runEngine(c.input,c.config,c.edits,c.previous),f=row(s,c.callsign)
 assert.equal(f.initialProfile.appliedAt,c.input.timestamp);assert.equal(f.initialProfile.pending,false)
 assert.deepEqual(f.euroscopeBaseline,old.euroscopeBaseline);assert.equal(f.sta,f.liveBufferedEta);assert.equal(f.staFf,f.etaFf)
 assert.equal(f.delay,0);assert.equal(controllerInstructionSeconds(f),0)
})
