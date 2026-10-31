import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {reviewLiveTiming} from '../src/maestro-timing-review.ts'
const files=process.argv.slice(2)
if(!files.length)throw Error('Pass one or more exported SAAMAN recording JSON files')
const seen=new Map(),reports=[]
for(const file of files){
 const bytes=fs.readFileSync(file),digest=createHash('sha256').update(bytes).digest('hex')
 if(seen.has(digest)){reports.push({file,excluded:'duplicate-recording',duplicateOf:seen.get(digest)});continue}
 seen.set(digest,file);reports.push({file,...reviewLiveTiming(JSON.parse(bytes.toString('utf8')))})
}
console.log(JSON.stringify({reports},null,2))
