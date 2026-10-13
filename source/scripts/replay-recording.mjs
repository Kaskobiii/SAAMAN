import {build} from '../ui/node_modules/esbuild/lib/main.js'
import {readFile,writeFile,mkdtemp,rm,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
const input=process.argv[2],output=process.argv[3]??'SAAMAN-replay-report.json'
if(!input)throw Error('Usage: node scripts/replay-recording.mjs <ESSA-AMAN-recording.json> [report.json]')
if((await stat(input)).size>128*1024*1024)throw Error('Recording exceeds size limit')
const data=JSON.parse(await readFile(input,'utf8'))
if(data.format!=='saaman-recording-1'||!Array.isArray(data.frames)||data.frames.length>18000||!Array.isArray(data.routes)||!Array.isArray(data.plans)||!data.initial)throw Error('Invalid session recording')
const temporary=await mkdtemp(path.join(tmpdir(),'saaman-recording-replay-'))
try{
    await Promise.all(['maestro-engine','maestro-recording'].map(name=>build({entryPoints:[fileURLToPath(new URL(`../ui/src/${name}.ts`,import.meta.url))],bundle:true,platform:'node',format:'esm',outfile:path.join(temporary,name+'.mjs')})))
    const {runEngine,validateConfig,validateEdits,validateTelemetry}=await import(pathToFileURL(path.join(temporary,'maestro-engine.mjs')))
    const {decodeRecording}=await import(pathToFileURL(path.join(temporary,'maestro-recording.mjs')))
    const frames=decodeRecording(data),differences=[]
    let previous=data.initial,conflicts=0,maximumDelay=0,calculated=0,controlCheckpoints=0
    for(let i=0;i<frames.length;i++){
        const f=frames[i]
        if(f.controlCheckpoint){previous=f.controlCheckpoint;controlCheckpoints++;continue}
        if(f.input.timestamp<=previous.timestamp)continue
        const snapshot=runEngine(validateTelemetry(f.input,f.input.timestamp),validateConfig(f.config),validateEdits(f.edits),previous)
        const expected=new Map(data.frames[i].results.map(r=>[r.callsign,r]))
        for(const flight of snapshot.flights){
            conflicts+=Number(!!flight.spacingConflict);maximumDelay=Math.max(maximumDelay,flight.delay)
            const old=expected.get(flight.callsign)
            if(!old||old.mode!==undefined&&old.mode!==flight.mode||old.state!==flight.state||old.order!==flight.order||Math.abs(old.eta-flight.eta)>1||Math.abs(old.sta-flight.sta)>1||old.delay!==flight.delay)
                differences.push({frame:i,callsign:flight.callsign,recorded:old??null,replayed:{state:flight.state,order:flight.order,eta:flight.eta,sta:flight.sta,delay:flight.delay}})
            expected.delete(flight.callsign)
        }
        for(const missing of expected.keys())differences.push({frame:i,callsign:missing,missing:true})
        previous=snapshot;calculated++
    }
    const report={recordedEngine:data.engine,frames:data.frames.length,calculated,controlCheckpoints,conflicts,maximumDelaySeconds:maximumDelay,differenceCount:differences.length,differences}
    await writeFile(output,JSON.stringify(report,null,2))
    console.log(`${calculated} frames replayed; ${conflicts} spacing conflicts; ${differences.length} result differences. Report: ${path.resolve(output)}`)
    if(conflicts||differences.length)process.exitCode=1
}finally{
    if(path.dirname(path.resolve(temporary))!==path.resolve(tmpdir())||!path.basename(temporary).startsWith('saaman-recording-replay-'))throw Error('Unsafe temporary directory')
    await rm(temporary,{recursive:true,force:true})
}
