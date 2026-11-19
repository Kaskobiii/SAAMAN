import {APPLICATION_BUILD} from './build'
import {createRecentDiagnostics} from './maestro-recent-diagnostics'
import {nativeRequest} from './native-rpc'

export const captureRecentDiagnostics=createRecentDiagnostics(frame=>nativeRequest('diagnostics:append',{frame}))

type DiagnosticPage={after:number;through:number;complete:boolean;trimmed:boolean;frames:string[]}

export async function exportRecentDiagnostics(){
    const frames:string[]=[]
    let after=0,through=0,trimmedDuringExport=false
    // A fixed end ID keeps an export finite while the sequencer continues.
    for(;;){
        const page:DiagnosticPage=await nativeRequest('diagnostics:read',{after,through})
        for(const frame of page.frames)frames.push(frame)
        trimmedDuringExport||=page.trimmed
        if(page.complete)break
        if(page.after<=after)throw new Error('Recent diagnostics could not be read')
        after=page.after
        through=page.through
    }
    if(!frames.length)throw new Error('No recent diagnostics yet')
    const header=JSON.stringify({format:'saaman-diagnostics-1',engine:APPLICATION_BUILD,trimmedDuringExport})
    const blob=new Blob([header.slice(0,-1),',"frames":[',frames.join(','),']}'],{type:'application/json'})
    const link=document.createElement('a'),url=URL.createObjectURL(blob)
    link.href=url
    link.download='ESSA-AMAN-recent-diagnostics.json'
    link.click()
    setTimeout(()=>URL.revokeObjectURL(url),1000)
}
