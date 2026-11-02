import test from 'node:test'
import assert from 'node:assert/strict'
import {runEngine,DEFAULT_CONFIG,validateConfig,wakeInterval,effectiveConfig} from '../src/maestro-engine.ts'
import {STAR_FEEDERS,STAR_RUNWAYS} from '../src/maestro-star-prediction.ts'
import {SessionRecording} from '../src/maestro-recording.ts'
const t=Date.UTC(2026,9,31,18),clone=x=>JSON.parse(JSON.stringify(x))
const config=extra=>({...structuredClone(DEFAULT_CONFIG),automaticTrafficModes:true,trafficHighDownwindNm:4,minimumNewSeconds:0,unstableSeconds:0,active:['ESSA/19L'],departureRunway:'ESSA/19R',...extra})
function plane(extra={}){return {callsign:'QUIET',aircraft:'A20N',wake:'M',departure:'EPWA',arrival:'ESSA',runway:'19L',star:'NILUG3P',latitude:58.1,longitude:17.9,altitude:30000,groundspeed:440,heading:5,verticalSpeed:0,positionAgeSeconds:0,threshold:STAR_RUNWAYS['19L'],landingSeconds:2000,distanceNm:140,route:[{name:'NILUG',...STAR_FEEDERS.NILUG,seconds:600},{name:'DOWNWIND',latitude:60.2,longitude:18.3,seconds:1800},{name:'FI19L',latitude:59.8,longitude:18,seconds:1950},{name:'SA19L',...STAR_RUNWAYS['19L'],seconds:2000}],...extra}}
const bankPlane=extra=>plane({latitude:58.6,altitude:18000,groundspeed:330,route:plane().route.map(q=>q.name==='DOWNWIND'?{...q,latitude:59.9,longitude:18.2}:q),...extra})
const input=(seconds,flights=[plane()])=>({timestamp:t+seconds*1000,source:'ESSA_FMP',simulation:false,flights:flights.map(p=>({...p,latitude:p.latitude+440*seconds/3600/60}))})
function spaced(snapshot,c){for(const runway of new Set(snapshot.flights.map(f=>f.runway))){const queue=snapshot.flights.filter(f=>f.runway===runway&&f.mode==='sequenced'&&f.state!==4&&!f.issue&&!f.lost).sort((a,b)=>a.order-b.order);for(let i=1;i<queue.length;i++){const a=queue[i-1],b=queue[i],key='ESSA/'+runway,plan=effectiveConfig(c,b.sta),required=Math.max(plan.rates[key],wakeInterval(a.wake,b.wake,key,plan));assert.ok(b.sta-a.sta>=required*1000-2)}}}
test('fresh defaults enable modes while historical raw configurations remain replayable',()=>{
 assert.equal(DEFAULT_CONFIG.automaticTrafficModes,true);assert.equal(validateConfig(config()).automaticTrafficModes,true)
 const historical=config();delete historical.automaticTrafficModes;assert.equal(validateConfig(historical).automaticTrafficModes,false)
 for(const automaticTrafficModes of ['true',1,null]){if(automaticTrafficModes===null)continue;assert.throws(()=>validateConfig(config({automaticTrafficModes})),/traffic mode/)}
 for(const trafficHighDownwindNm of [-1,21,NaN])assert.throws(()=>validateConfig(config({trafficHighDownwindNm})),/traffic mode/)
})
test('quiet runway uses shortest path, keeps feeder timing and refreshes Stable automatically without recapture',()=>{
 const c=config(),first=runEngine(input(0),c,{}),second=runEngine(input(2),c,{},first),old=second.flights[0]
 assert.equal(second.trafficModes['ESSA/19L'].mode,'low');assert.equal(old.trafficProfile.profile,'shortest');assert.equal(old.state,1)
 const later=runEngine(input(4,[plane({groundspeed:350})]),c,{},second),f=later.flights[0]
 assert.equal(f.state,1);assert.equal(f.euroscopeBaseline.at,old.euroscopeBaseline.at);assert.equal(f.initialEta,old.initialEta)
 assert.ok(f.liveBufferedEta>old.liveBufferedEta+30000);assert.ok(Math.abs(f.sta-f.liveBufferedEta)<2,'quiet automatic slot follows later credible ETA');assert.equal(f.delay,0);assert.ok(Math.abs(f.staFf-f.etaFf)<2);spaced(later,c)
})
test('a busy primary and quiet secondary receive independent modes and retain all runway/wake intervals',()=>{
 const c=config({rates:{...DEFAULT_CONFIG.rates,'ESSA/19L':150}}),bank=Array.from({length:8},(_,i)=>bankPlane({callsign:'BANK'+i,latitude:58.6+i*.01})),secondary=plane({callsign:'SECOND',runway:'19R',threshold:STAR_RUNWAYS['19R'],route:plane().route.map(q=>q.name==='SA19L'?{...q,name:'SA19R',...STAR_RUNWAYS['19R']}:q)})
 const snapshot=runEngine(input(0,[...bank,secondary]),c,{})
 assert.equal(snapshot.trafficModes['ESSA/19L'].mode,'high');assert.equal(snapshot.trafficModes['ESSA/19R'].mode,'low')
 assert.equal(snapshot.flights.find(f=>f.callsign==='SECOND').trafficProfile.mode,'low');assert.ok(snapshot.flights.filter(f=>f.runway==='19L').every(f=>f.trafficProfile?.profile==='extended'));spaced(snapshot,c)
})
test('path extension and assigned manual delays cannot feed back into measured demand',()=>{
 const bank=Array.from({length:8},(_,i)=>bankPlane({callsign:'F'+i,latitude:58.6+i*.01})),a=runEngine(input(0,bank),config(),{}),b=runEngine(input(0,bank),config({trafficHighDownwindNm:10}),{F0:{target:t+7200000,changedAt:t}})
 assert.deepEqual(a.trafficModes,b.trafficModes)
 assert.ok(b.flights.some(f=>f.trafficProfile?.extraTrackNm===20));spaced(b,config({trafficHighDownwindNm:10}))
})
test('controller times and HOLD instructions remain protected during quiet automatic updates',()=>{
 const c=config(),first=runEngine(input(0),c,{}),second=runEngine(input(2),c,{},first),at=t+4000,target=second.flights[0].sta+120000
 const manual={QUIET:{target,targetKind:'time',changedAt:at}},held=runEngine(input(4,[plane({groundspeed:350})]),c,manual,second)
 assert.equal(held.flights[0].sta,target)
 const hold=runEngine(input(6,[plane({topskyHoldingPoint:'NILUG',groundspeed:350})]),c,manual,held)
 assert.equal(hold.flights[0].sta,target);assert.equal(hold.flights[0].trafficProfile?.mode,'low')
})
test('Superstable accepts observations without automatically changing its accepted mode allocation',()=>{
 const c=config(),first=runEngine(input(0),c,{}),second=runEngine(input(2),c,{},first),protectedSnapshot=clone(second),f=protectedSnapshot.flights[0]
 f.state=2;f.passedFeeder=false;f.tmaAssignment={at:second.timestamp,sta:f.sta,instruction:0}
 const next=runEngine(input(4,[plane({groundspeed:350})]),c,{},protectedSnapshot)
 assert.ok(next.flights[0].state>=2);assert.equal(next.flights[0].sta,f.sta);assert.equal(next.flights[0].trafficProfile.mode,'low')
})
test('mode state and original prediction assumptions survive serialized handover and recording export',()=>{
 const c=config(),first=runEngine(input(0),c,{}),next=runEngine({...input(2),source:'ESSA_E_APP'},c,{},clone(first))
 assert.equal(next.trafficModes['ESSA/19L'].mode,'low');assert.equal(next.flights[0].firstSeen,first.flights[0].firstSeen)
 const recorder=new SessionRecording();recorder.start(next,c,{})
 const data=recorder.export();assert.equal(data.initial.trafficModes['ESSA/19L'].mode,'low');assert.equal(next.flights[0].initialTimingEvidence.model.trafficProfile.mode,'low')
})

test('a moving HOLD stack remains runway demand without changing its protected assignments',()=>{
 const c=config(),bank=Array.from({length:8},(_,i)=>bankPlane({callsign:'HOLD'+i,topskyHoldingPoint:'NILUG'}))
 const snapshot=runEngine(input(0,bank),c,{})
 assert.equal(snapshot.trafficModes['ESSA/19L'].mode,'high');assert.ok(snapshot.flights.every(f=>f.trafficProfile?.mode==='high'));spaced(snapshot,c)
})

test('a known Low to High planning transition cannot be mistaken for a corrupt route jump',()=>{
 const c=config({active:['ESSA/01R'],trafficHighDownwindNm:20}),p=plane({runway:'01R',star:'NILUG3M',threshold:STAR_RUNWAYS['01R'],route:plane().route.map(q=>q.name==='SA19L'?{...q,name:'SA01R',...STAR_RUNWAYS['01R']}:q.name==='FI19L'?{...q,name:'FI01R'}:q)})
 let snapshot=runEngine(input(0,[p]),c,{});snapshot=runEngine(input(2,[p]),c,{},snapshot)
 const old=snapshot.flights[0];assert.equal(old.state,1);assert.equal(old.trafficProfile.mode,'low')
 snapshot.trafficModes['ESSA/01R']={...snapshot.trafficModes['ESSA/01R'],mode:'high'}
 const next=runEngine(input(4,[p]),c,{},snapshot),f=next.flights[0]
 assert.equal(f.trafficProfile.mode,'high');assert.ok(f.liveBufferedEta>old.liveBufferedEta+600000);assert.equal(f.routeTimingQuarantined,false);assert.ok(f.trafficNeutralGuard.trusted);assert.equal(next.automaticCorrections?.length??0,0)
 assert.equal(f.euroscopeBaseline.at,old.euroscopeBaseline.at);assert.ok(Math.abs(f.sta-f.liveBufferedEta)<2);assert.equal(f.delay,0)
})

test('invalid initial routes cannot turn a quiet runway High or push a usable arrival later',()=>{
 const c=config(),good=bankPlane({callsign:'GOOD'}),bad=Array.from({length:8},(_,i)=>bankPlane({callsign:'BAD'+i,route:[],landingSeconds:-1}))
 const alone=runEngine(input(0,[good]),c,{}),mixed=runEngine(input(0,[good,...bad]),c,{})
 assert.equal(mixed.trafficModes['ESSA/19L'].mode,'low');assert.deepEqual(mixed.trafficModes,alone.trafficModes)
 assert.ok(mixed.flights.filter(f=>f.callsign.startsWith('BAD')).every(f=>f.issue))
 const a=alone.flights.find(f=>f.callsign==='GOOD'),b=mixed.flights.find(f=>f.callsign==='GOOD')
 assert.equal(b.eta,a.eta);assert.equal(b.sta,a.sta);spaced(mixed,c)
})
test('the same invalid callsigns count as demand once current routes recover, despite their old issues',()=>{
 const c=config(),good=bankPlane({callsign:'GOOD'}),bad=Array.from({length:8},(_,i)=>bankPlane({callsign:'BAD'+i,route:[],landingSeconds:-1})),recovered=bad.map(p=>bankPlane({callsign:p.callsign}))
 const first=runEngine(input(0,[good,...bad]),c,{})
 const next=runEngine(input(2,[good,...recovered]),c,{},first)
 assert.ok(next.trafficModes['ESSA/19L'].count15>=8);assert.equal(next.trafficModes['ESSA/19L'].pendingMode,'high')
 const fresh=runEngine(input(2,[good,...recovered]),c,{})
 assert.ok(Math.abs(next.trafficModes['ESSA/19L'].bankStart-fresh.trafficModes['ESSA/19L'].bankStart)<5000,'recovered demand uses the usable forecast rather than its old invalid fallback')
 const high=runEngine(input(32,[good,...recovered]),c,{},next)
 assert.equal(high.trafficModes['ESSA/19L'].mode,'high');assert.ok(high.flights.every(f=>!f.issue));spaced(high,c)
})
test('independent selected arrival profiles remain demand when raw destination timing is unavailable',()=>{
 const c=config(),p=bankPlane({callsign:'SELECTED',route:[],landingSeconds:-1}),edits={SELECTED:{arrivalProfile:'19L:NILUG:NILUG3P',recomputeAt:t}}
 const snapshot=runEngine(input(0,[p]),c,edits)
 assert.equal(snapshot.flights[0].issue,'');assert.equal(snapshot.flights[0].landingPrediction.method,'arrival-profile');assert.equal(snapshot.trafficModes['ESSA/19L'].count15,1)
})
