import {build} from '../ui/node_modules/esbuild/lib/main.js'
import {mkdtemp,rm} from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const directory=await mkdtemp(path.join(tmpdir(),'saaman-timing-review-'))
try{
 const outfile=path.join(directory,'review.mjs')
 await build({entryPoints:[fileURLToPath(new URL('../ui/tools/review-initial-timing.mjs',import.meta.url))],bundle:true,platform:'node',format:'esm',outfile})
 process.exitCode=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[outfile,...process.argv.slice(2)],{stdio:'inherit'})
  child.on('error',reject);child.on('exit',code=>resolve(code??1))
 })
}finally{
 if(path.dirname(path.resolve(directory))!==path.resolve(tmpdir())||!path.basename(directory).startsWith('saaman-timing-review-'))throw Error('Unexpected review directory')
 await rm(directory,{recursive:true,force:true})
}
