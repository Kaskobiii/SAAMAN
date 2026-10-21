import {build} from 'esbuild'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawn} from 'node:child_process'

const directory=await mkdtemp(path.join(tmpdir(),'vatiris-maestro-'))
try {
    const tests=['maestro-route-jump','maestro-assigned-speed','maestro-automatic-notices','maestro-aircraft-highlight','maestro-lone-stable','maestro-feeder-delivery','maestro-motion-timing','maestro-holding','sequencer-version','maestro-evening','maestro-engine','maestro-buffer','maestro-recompute','maestro-live-resequence','maestro-recovery','maestro-reinsert-iaf','maestro-live-continuity','maestro-upstream-release','maestro-feeder-scheduling','maestro-unstable','maestro-initial-profile','maestro-landing','maestro-route-timing','maestro-operations','maestro-manual-reservations','maestro-star-prediction','maestro-trajectory','maestro-recording','maestro-supervision','maestro-openap','shared-relay','shared-http','callsign-identity','legacy-relay','maestro-feeder-coverage','maestro-connection'].map(name=>({source:fileURLToPath(new URL(`./${name}.test.mjs`,import.meta.url)),output:path.join(directory,`${name}.mjs`)}))
    await Promise.all(tests.map(test=>build({entryPoints:[test.source],bundle:true,platform:'node',format:'esm',outfile:test.output})))
    const exit=await new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,['--test',...tests.map(test=>test.output)],{stdio:'inherit'})
        child.on('error',reject);child.on('exit',code=>resolve(code??1))
    })
    process.exitCode=exit
} finally {
    if(path.dirname(path.resolve(directory))!==path.resolve(tmpdir())||!path.basename(directory).startsWith('vatiris-maestro-'))throw new Error('Unexpected test output directory')
    await rm(directory,{recursive:true,force:true})
}










