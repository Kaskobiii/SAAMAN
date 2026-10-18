import test from 'node:test'
import assert from 'node:assert/strict'
import {newestVersion,sequencerVersionWarning} from '../src/sequencer-version.ts'
import {controllerInstructionSeconds,euroscopeInstruction,toTopSkySequence,runEngine} from '../src/maestro-engine.ts'
import fixture from './fixtures/recording12-evening.json' with {type:'json'}

test('sequencer version comparison uses numeric versions, ignores malformed reports, and warns on older or unknown owner',()=>{
 assert.equal(newestVersion(['1.3.9','1.3.34','1.3.100','bad',null]),'1.3.100')
 assert.match(sequencerVersionWarning('ESSA_E_APP','1.3.33',['1.3.34']),/uses 1.3.33; 1.3.34 is available/)
 assert.match(sequencerVersionWarning('ESSA_FMP',undefined,['1.3.34']),/version unknown/)
 assert.equal(sequencerVersionWarning('ESSA_E_APP','1.3.34',['1.3.33','1.3.34']),'')
 assert.equal(sequencerVersionWarning('ESSA_E_APP','1.3.35',['1.3.34']),'')
 assert.equal(sequencerVersionWarning('',undefined,['1.3.34']),'')
})

test('TMA Recompute preserves assigned runway spacing but emits no ACC instruction or stale TopSky line 0',()=>{
 const c=structuredClone(fixture.cases.find(c=>c.frame===1281))
 const s=runEngine(c.input,c.config,c.edits,{...c.previous,timestamp:c.input.timestamp-1})
 const inside=s.flights.filter(f=>f.passedFeeder&&f.mode==='sequenced'&&f.state!==4)
 assert.ok(inside.length>1);assert.ok(inside.some(f=>Math.abs(f.delay)>=60),'fixture contains genuine remaining planner work')
 for(const f of inside){assert.equal(controllerInstructionSeconds(f),0);assert.equal(euroscopeInstruction(f),0)}
 const output=toTopSkySequence(s,c.config,c.edits)
 for(const f of inside)assert.ok(!output.sequence.some(row=>row.callsign===f.callsign))
 for(const f of s.flights.filter(f=>!f.passedFeeder))assert.equal(controllerInstructionSeconds(f),f.delay)
 const ordered=inside.sort((a,b)=>a.order-b.order)
 for(let i=1;i<ordered.length;i++)if(ordered[i].separation?.leader===ordered[i-1].callsign)assert.ok(ordered[i].sta>ordered[i-1].sta)
})
