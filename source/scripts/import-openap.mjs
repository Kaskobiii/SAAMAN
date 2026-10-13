import {readFileSync,writeFileSync,readdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),base=path.join(root,'vendor/openap/openap/data')
const files={},wrap={},properties={},synonyms={},rejectedProperties={}
function read(file){const buffer=readFileSync(path.join(base,file));files[file]=createHash('sha256').update(buffer).digest('hex');return buffer.toString('utf8')}
for(const file of readdirSync(path.join(base,'wrap')).filter(f=>f.endsWith('.txt')).sort()){
    const [header,...lines]=read('wrap/'+file).split(/\r?\n/),start=header.indexOf('opt'),min=header.indexOf('min'),max=header.indexOf('max'),end=header.indexOf('model'),vars={}
    for(const line of lines.filter(l=>l.trim())){
        const name=line.trim().split(/\s+/)[0],value=Number(line.slice(start,min).trim()),low=Number(line.slice(min,max).trim()),high=Number(line.slice(max,end).trim())
        if(![value,low,high].every(Number.isFinite)||low>high)throw Error('Invalid WRAP row '+file+':'+name)
        vars[name]={default:value,minimum:low,maximum:high}
    }
    wrap[file.slice(0,-4).toUpperCase()]=vars
}
for(const line of read('wrap/_synonym.csv').trim().split(/\r?\n/).slice(1)){const [a,b]=line.split(',');if(!(b.toUpperCase() in wrap))throw Error('Missing WRAP synonym target');synonyms[a.toUpperCase()]=b.toUpperCase()}
for(const file of readdirSync(path.join(base,'aircraft')).filter(f=>f.endsWith('.yml')).sort()){
    const text=read('aircraft/'+file),p={}
    for(const key of ['ceiling','vmo','mmo']){const match=text.match(new RegExp('^'+key+':\\s*([0-9.]+)','m'));if(match)p[key]=Number(match[1])}
    if(!p.ceiling||p.ceiling<1000||p.ceiling>20000)throw Error('Invalid OpenAP ceiling '+file)
    for(const [key,min,max] of [['vmo',100,400],['mmo',.3,1.2]])if(p[key]!==undefined&&(p[key]<min||p[key]>max)){rejectedProperties[file.slice(0,-4).toUpperCase()]={...(rejectedProperties[file.slice(0,-4).toUpperCase()]||{}),[key]:p[key]};delete p[key]}
    properties[file.slice(0,-4).toUpperCase()]=p
}
const output={source:{repository:'https://github.com/junzis/openap',commit:'a19a1cd559aa51c2ff385a71ee1884a53d866a33',version:'2.6.2',license:'GPL-3.0 (data)',units:'WRAP: m/s, km, Mach; properties: ceiling m, vmo kt CAS, mmo Mach',files,rejectedProperties},wrap,properties,synonyms}
writeFileSync(path.join(root,'ui/src/data/openap-profiles.json'),JSON.stringify(output,null,2)+'\n')
console.log(`Imported OpenAP: ${Object.keys(wrap).length} exact WRAP models, ${Object.keys(properties).length} aircraft properties.`)
