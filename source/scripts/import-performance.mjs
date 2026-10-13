import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
const directory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../ui/src/data')
const raw=fs.readFileSync(path.join(directory,'euroscope-aircraft-performance.txt'),'utf8').replace(/\r\n/g,'\n')
const records=[];let current
for(const text of raw.split('\n')){
    const line=text.trim()
    if(line.startsWith('PERFAC:')){current={type:line.split(':')[1],rotor:line.endsWith(':ROTOR'),rows:[]};records.push(current)}
    else if(line.startsWith('PERFLINE:')){
        const row=line.split(':').slice(1).map(Number)
        if(!current||row.length!==9||row.some(value=>!Number.isFinite(value)))throw new Error(`Invalid performance row: ${line}`)
        current.rows.push(row)
    }
}
const profiles={},ambiguous=new Set()
for(const record of records){
    if(!record.rows.length)throw new Error(`Missing performance rows: ${record.type}`)
    if(profiles[record.type]&&JSON.stringify(profiles[record.type])!==JSON.stringify(record))ambiguous.add(record.type)
    else profiles[record.type]=record
}
for(const type of ambiguous)delete profiles[type]
const source=JSON.parse(fs.readFileSync(path.join(directory,'euroscope-performance-source.json'),'utf8'))
source.sha256=createHash('sha256').update(raw).digest('hex');source.ambiguousTypes=[...ambiguous].sort();source.typeCount=Object.keys(profiles).length
fs.writeFileSync(path.join(directory,'euroscope-performance-profiles.json'),JSON.stringify({source,profiles}))
console.log(`Imported ${source.typeCount} aircraft profiles; excluded ${ambiguous.size} conflicting duplicate types`)
