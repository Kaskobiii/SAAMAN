import {build} from 'esbuild'
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {spawn} from 'node:child_process'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root=fileURLToPath(new URL('../../',import.meta.url))
const pin=JSON.parse(await readFile(path.join(root,'backend-compatibility.json'),'utf8'))
const args=process.argv.slice(2)
if(args.length&&!(args.length===2&&['--ref','--router'].includes(args[0])))throw Error('Use --ref main, or --router <file> for a local regression check')
if(pin.repository!=='minsulander/vatiris'||pin.router!=='backend/src/routes/aman.ts'||!/^[a-f0-9]{40}$/.test(pin.commit)||!/^[a-f0-9]{64}$/.test(pin.sha256))throw Error('Invalid backend compatibility pin')
let commit=pin.commit,source,expected=pin.sha256
async function download(url){const response=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'SAAMAN-backend-compatibility'}});if(!response.ok)throw Error(`Cannot download vatIRIS test source: HTTP ${response.status}`);const buffer=Buffer.from(await response.arrayBuffer());if(buffer.length>1024*1024)throw Error('Unexpectedly large backend source');return buffer}
if(args[0]==='--router'){
    source=await readFile(path.resolve(args[1]));commit='LOCAL-UNPINNED';expected=''
}else{
    if(args[0]==='--ref'){
        if(args[1]!=='main')throw Error('The floating compatibility target must be main')
        const remote=JSON.parse((await download(`https://api.github.com/repos/${pin.repository}/commits/main`)).toString('utf8'))
        if(!/^[a-f0-9]{40}$/.test(remote.sha))throw Error('Invalid upstream commit')
        commit=remote.sha;expected=''
    }
    source=await download(`https://raw.githubusercontent.com/${pin.repository}/${commit}/${pin.router}`)
}
const hash=createHash('sha256').update(source).digest('hex')
if(expected&&hash!==expected)throw Error('Pinned vatIRIS router checksum mismatch')
console.log(`vatIRIS compatibility target: ${pin.repository}@${commit}; router SHA-256 ${hash}`)
const directory=await mkdtemp(path.join(tmpdir(),'saaman-backend-compat-'))
try{
    const router=path.join(directory,'vatiris-router.cjs'),test=path.join(directory,'compatibility.mjs')
    await build({stdin:{contents:source.toString('utf8'),resolveDir:fileURLToPath(new URL('../',import.meta.url)),sourcefile:pin.router,loader:'ts'},bundle:true,platform:'node',format:'cjs',outfile:router,alias:{axios:fileURLToPath(new URL('./fixtures/vatiris-controller-feed.mjs',import.meta.url))}})
    await build({entryPoints:[fileURLToPath(new URL('./backend-compatibility.test.mjs',import.meta.url))],bundle:true,platform:'node',format:'esm',outfile:test,define:{__VATIRIS_ROUTER__:JSON.stringify(router)},banner:{js:"import {createRequire as _createRequire} from 'node:module';const require=_createRequire(import.meta.url);"}})
    const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--test',test],{stdio:'inherit'});child.on('error',reject);child.on('exit',value=>resolve(value??1))})
    process.exitCode=code
}finally{
    const resolved=path.resolve(directory)
    if(path.dirname(resolved)!==path.resolve(tmpdir())||!path.basename(resolved).startsWith('saaman-backend-compat-'))throw Error('Unexpected compatibility-test output directory')
    await rm(resolved,{recursive:true,force:true})
}
