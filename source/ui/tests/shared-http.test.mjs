import test from 'node:test'
import assert from 'node:assert/strict'
import {gunzipSync} from 'node:zlib'
import {publicationBody} from '../src/shared-http.ts'
test('negotiated publication compression preserves exact retry JSON and reduces upload bytes',async()=>{
 const json=JSON.stringify({requestId:'same-retry',checkpoint:{snapshot:{flights:Array.from({length:30},(_,i)=>({callsign:'TEST'+i,route:[{name:'ELTOK',seconds:600}],details:'diagnostic '.repeat(100)}))}}})
 const encoded=await publicationBody(json,true)
 assert.equal(encoded.compressed,true);assert.equal(gunzipSync(Buffer.from(encoded.data)).toString('utf8'),json)
 assert.ok(encoded.data.byteLength<Buffer.byteLength(json)*0.2)
 const retry=await publicationBody(json,true);assert.equal(gunzipSync(Buffer.from(retry.data)).toString('utf8'),json)
})
test('older servers and small requests retain their original JSON format',async()=>{
 const large='x'.repeat(10000),small=JSON.stringify({poll:true})
 assert.deepEqual(await publicationBody(large,false),{data:large,compressed:false})
 assert.deepEqual(await publicationBody(small,true),{data:small,compressed:false})
})
