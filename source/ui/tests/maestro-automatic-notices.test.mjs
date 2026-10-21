import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createAutomaticNoticeFeed,isAutomaticCorrection} from '../src/maestro-automatic-notices.ts'

const event=(id,at=1000,changes={})=>({id,callsign:'SAS123',at,kind:'route-timing',detail:'Updated retained route timing.',...changes})
const snapshot=(events,timestamp=1000,source='ESSA_E_APP')=>({source,timestamp,automaticCorrections:events})

test('a fresh first snapshot may show a new correction but historical events are baselined silently',()=>{
 let time=1000
 const feed=createAutomaticNoticeFeed({now:()=>time})
 time=1200
 assert.deepEqual(feed.ingest(snapshot([event('old',900),event('new',1100)],1200),'room-a').map(e=>e.id),['new'])
 assert.deepEqual(feed.ingest(snapshot([event('old',900),event('new',1100)],1200),'room-a'),[])
})

test('polls, source handovers and reopened feeds do not replay observed corrections',()=>{
 let stored,saves=0
 const options={now:()=>1000,startAt:900,load:()=>stored,save:value=>{stored=structuredClone(value);saves++}}
 const first=createAutomaticNoticeFeed(options)
 assert.equal(first.ingest(snapshot([event('once')]),'room-a').length,1)
 assert.deepEqual(first.ingest(snapshot([event('once')],1000,'ESSA_FMP'),'room-a'),[])
 assert.deepEqual(createAutomaticNoticeFeed(options).ingest(snapshot([event('once')]),'room-a'),[])
 assert.ok(saves>0)
})

test('rooms and reset epochs baseline independently and can reuse correction IDs',()=>{
 let time=1000
 const feed=createAutomaticNoticeFeed({now:()=>time})
 assert.equal(feed.ingest(snapshot([event('same')]),'room-a/epoch-1').length,1)
 time=2000
 assert.deepEqual(feed.ingest(snapshot([event('old',1500),event('same',2000)],2000),'room-b/epoch-1').map(e=>e.id),['same'])
 time=3000
 assert.deepEqual(feed.ingest(snapshot([event('old',2500),event('same',3000)],3000),'room-a/epoch-2').map(e=>e.id),['same'])
 time=4000
 assert.deepEqual(feed.ingest(snapshot([event('same',1000),event('away',3500)],4000),'room-a/epoch-1'),[])
 assert.deepEqual(feed.ingest(snapshot([event('returned',4100)],4100),'room-a/epoch-1').map(e=>e.id),['returned'])
})

test('correction validation rejects malformed IDs, callsigns, timestamps, kinds and details',()=>{
 assert.equal(isAutomaticCorrection(event('valid')),true)
 for(const bad of [null,[],{},event(''),event('x',0),event('x',NaN),event('x',Infinity),event('x',1.5),event('x',1000,{kind:'other'}),event('x',1000,{callsign:'sas123'}),event('x',1000,{callsign:'SAS 123'}),event('x',1000,{callsign:'A'.repeat(17)}),event('x',1000,{detail:''}),event('x',1000,{detail:'x'.repeat(1001)}),event('x\n'),event('x',1000,{detail:'bad\0text'})])assert.equal(isAutomaticCorrection(bad),false)
 const feed=createAutomaticNoticeFeed({now:()=>1000})
 assert.deepEqual(feed.ingest(snapshot([event('good'),event('bad',1000,{kind:'other'})]),'a').map(e=>e.id),['good'])
})

test('invalid snapshots and scope keys do not establish or corrupt a baseline',()=>{
 const feed=createAutomaticNoticeFeed({now:()=>1000})
 for(const bad of [null,[],{source:'',timestamp:1000},{source:'X',timestamp:NaN},{source:'X',timestamp:0}])assert.deepEqual(feed.ingest(bad,'a'),[])
 for(const scope of ['',null,'a\n','a'.repeat(513)])assert.deepEqual(feed.ingest(snapshot([event('good')]),scope),[])
 assert.equal(feed.ingest(snapshot([event('good')]),'a').length,1)
})

test('expired and future corrections are suppressed with explicit clock tolerances',()=>{
 let time=100000
 const feed=createAutomaticNoticeFeed({now:()=>time,startAt:1,maxAgeMs:60000,futureSkewMs:5000,maxBatch:10})
 assert.deepEqual(feed.ingest(snapshot([event('expired',39999),event('edge',40000),event('future',105001),event('allowed',105000)],100000),'a').map(e=>e.id),['edge','allowed'])
 time=105001
 assert.deepEqual(feed.ingest(snapshot([event('future',105001),event('expired',39999)],105001),'a').map(e=>e.id),['future'])
})

test('an event cannot run ahead of the snapshot that carries it',()=>{
 const feed=createAutomaticNoticeFeed({now:()=>2000,startAt:1,futureSkewMs:0})
 assert.deepEqual(feed.ingest(snapshot([event('new',2000)],1000),'a'),[])
 assert.deepEqual(feed.ingest(snapshot([event('new',2000)],2000),'a').map(e=>e.id),['new'])
})

test('batched corrections are deterministic, chronological and capped without a delayed burst',()=>{
 const events=[event('d',1040),event('b',1020),event('a',1020),event('c',1030)]
 const feed=createAutomaticNoticeFeed({now:()=>1100,startAt:1000,maxBatch:3})
 assert.deepEqual(feed.ingest(snapshot(events,1100),'a').map(e=>e.id),['b','c','d'])
 assert.deepEqual(feed.ingest(snapshot([...events].reverse(),1100),'a'),[])
 assert.deepEqual(createAutomaticNoticeFeed({now:()=>1100,startAt:1000,maxBatch:3}).ingest(snapshot([...events].reverse(),1100),'a').map(e=>e.id),['b','c','d'])
})

test('seen-ID storage is bounded by IDs per room and recently used rooms',()=>{
 let stored,time=1000
 const feed=createAutomaticNoticeFeed({now:()=>time,maxScopes:2,maxSeenIds:2,maxBatch:10,save:value=>stored=structuredClone(value)})
 feed.ingest(snapshot([event('a'),event('b'),event('c')]),'first')
 assert.deepEqual(stored.scopes,[{scope:'first',ids:['b','c'],through:{at:1000,id:'c'}}])
 assert.deepEqual(feed.ingest(snapshot([event('a'),event('b'),event('c')]),'first'),[])
 assert.deepEqual(createAutomaticNoticeFeed({now:()=>1000,maxSeenIds:2,startAt:1,load:()=>stored}).ingest(snapshot([event('a'),event('b'),event('c')]),'first'),[])
 time=2000;feed.ingest(snapshot([event('x',2000)],2000),'second')
 time=3000;feed.ingest(snapshot([event('z',3000)],3000),'third')
 assert.deepEqual(stored.scopes.map(s=>s.scope),['second','third'])
 assert.ok(stored.scopes.every(s=>s.ids.length<=2))
})

test('blocked or corrupt storage falls back to in-memory deduplication',()=>{
 const feed=createAutomaticNoticeFeed({now:()=>1000,load:()=>{throw Error('blocked')},save:()=>{throw Error('full')}})
 assert.equal(feed.ingest(snapshot([event('once')]),'a').length,1)
 assert.deepEqual(feed.ingest(snapshot([event('once')]),'a'),[])
 for(const bad of [null,{},[],{version:2,scopes:[]},{version:1,scopes:[null,{scope:'a',ids:[{},null,'x\n']}]}]){
  const other=createAutomaticNoticeFeed({now:()=>1000,load:()=>bad})
  assert.equal(other.ingest(snapshot([event('once')]),'a').length,1)
 }
})

test('persisted state is sanitized and trimmed, and returned notices are detached from the snapshot',()=>{
 let stored
 const correction=event('new',1100),input=snapshot([correction],1200)
 const feed=createAutomaticNoticeFeed({now:()=>1200,startAt:1000,maxSeenIds:2,maxScopes:2,load:()=>({version:1,scopes:[{scope:'older',ids:['x']},{scope:'a',ids:['old1','old2','old3']},{scope:'b',ids:['old']}] }),save:value=>stored=structuredClone(value)})
 const result=feed.ingest(input,'a');assert.equal(result.length,1)
 result[0].detail='changed';assert.equal(correction.detail,'Updated retained route timing.')
 assert.equal(stored.version,1);assert.ok(stored.scopes.length<=2);assert.ok(stored.scopes.every(s=>s.ids.length<=2))
 assert.ok(!JSON.stringify(stored).includes('SAS123'))
})
