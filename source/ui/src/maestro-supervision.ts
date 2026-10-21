import { STATE_NAMES, type EngineSnapshot } from './maestro-engine'
import {isAutomaticCorrection} from './maestro-automatic-notices'

export interface SupervisionEvent { time:number; callsign:string; kind:string; detail:string }
export function observeSnapshot(previous:EngineSnapshot|null,next:EngineSnapshot):SupervisionEvent[] {
    if(previous && next.timestamp<previous.timestamp)return []
    const reset=previous?.source!==next.source
    const old=new Map((reset?[]:previous?.flights??[]).map(f=>[f.callsign,f]))
    const events:SupervisionEvent[]=[]
    const add=(callsign:string,kind:string,detail:string)=>events.push({time:next.timestamp,callsign,kind,detail})
    for(const f of next.flights){
        const prior=old.get(f.callsign)
        if(!prior){add(f.callsign,'Observed',`${STATE_NAMES[f.state]} · ${f.mode}`);continue}
        if(prior.state!==f.state)add(f.callsign,'State',`${STATE_NAMES[prior.state]} → ${STATE_NAMES[f.state]}`)
        if(f.state===4&&prior.state!==4)add(f.callsign,'Landing evidence',`${f.landingDetection??'manual'} · ${f.landingRunway??`${f.arrival}/${f.runway}`}`)
        if(prior.mode!==f.mode)add(f.callsign,'Mode',`${prior.mode} → ${f.mode}`)
        if(prior.delay!==f.delay)add(f.callsign,'Instruction',`${prior.delay}s → ${f.delay}s (positive = lose)`)
        if(Math.abs(prior.sta-f.sta)>=1000)add(f.callsign,'Landing slot',`${new Date(prior.sta).toISOString().slice(11,19)} → ${new Date(f.sta).toISOString().slice(11,19)} UTC`)
        if(prior.order!==f.order)add(f.callsign,'Sequence',`${prior.order+1} → ${f.order+1}`)
        if(prior.predictionSource!==f.predictionSource||prior.vectorDetection!==f.vectorDetection)add(f.callsign,'Prediction',`${prior.predictionSource??'unknown'} → ${f.predictionSource??'unknown'}${f.vectorDetection?' · '+f.vectorDetection:''}`)
        if(prior.passedFeeder!==f.passedFeeder)add(f.callsign,'Feeder',f.passedFeeder?'Passed '+f.ff:'Before '+f.ff)
        if(prior.issue!==f.issue)add(f.callsign,'Issue',f.issue||'Cleared')
        if(prior.line0Suppressed!==f.line0Suppressed)add(f.callsign,'EuroScope guidance',f.line0Suppressed?'Hidden':'Visible')
    }
    if(!reset)for(const f of previous?.flights??[])if(!next.flights.some(n=>n.callsign===f.callsign))add(f.callsign,'Removed','No longer in the AMAN snapshot')
    const previousCorrections=new Set((reset?[]:previous?.automaticCorrections??[]).filter(isAutomaticCorrection).map(e=>e.id))
    for(const correction of (next.automaticCorrections??[]).filter(isAutomaticCorrection))if(!previousCorrections.has(correction.id)){
        previousCorrections.add(correction.id)
        events.push({time:correction.at,callsign:correction.callsign,kind:'Automatic correction',detail:correction.detail})
    }
    return events
}
