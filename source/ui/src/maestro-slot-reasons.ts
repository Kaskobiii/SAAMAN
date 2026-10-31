import type {EngineFlight,EngineSnapshot,FlightEdit} from './maestro-engine'

export type SlotReasonKind='rate'|'wake'|'feeder'|'closure'|'manual-time'|'manual-order'|'interval'|'minimum'|'retained'|'forecast'|'state'
export interface SlotReason {
    kind:SlotReasonKind
    detail:string
    /** True only where the current engine evidence identifies a constraint or tight minimum. */
    binding:boolean
    leader?:string
    seconds?:number
    target?:number
}
export interface SlotExplanation {summary:string;reasons:SlotReason[]}
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)
const label=(v:unknown,max=24)=>typeof v==='string'?v.replace(/[\x00-\x1f\x7f]/g,'').slice(0,max):''
const utc=(n:number)=>new Date(n).toISOString().slice(11,19)
const positive=(n:unknown)=>finite(n)&&n>=1000?Math.min(n,86400000):0
const seconds=(n:number)=>Math.round(n)
const operational=(p:EngineFlight)=>p.mode==='sequenced'&&p.state!==4&&!p.issue&&!p.lost

/** Compact current slot evidence, not an additive delay breakdown or an inferred history. */
export function explainSlot(f:EngineFlight,snapshot:Pick<EngineSnapshot,'flights'|'timestamp'>,edits:Record<string,FlightEdit>={}):SlotExplanation {
    const reasons:SlotReason[]=[]
    const add=(reason:SlotReason)=>{
        if(reasons.some(r=>r.kind===reason.kind&&r.leader===reason.leader))return
        reasons.push({...reason,detail:reason.detail.slice(0,140),...(reason.leader?{leader:label(reason.leader)}:{})})
    }
    const finish=()=>{
        const ordered=[...reasons.filter(r=>r.binding),...reasons.filter(r=>!r.binding)].slice(0,8)
        return {summary:ordered.map(r=>r.detail).join(' \u00b7 ').slice(0,320),reasons:ordered}
    }
    if(f.state===4){add({kind:'state',detail:'Landed',binding:false});return finish()}
    if(f.mode!=='sequenced'){add({kind:'state',detail:f.mode==='missed'?'Missed approach':f.mode==='desequenced'?'Desequenced':'Outside sequence',binding:false});return finish()}
    const edit=edits[f.callsign]??{}
    const leader=f.separation?.leader?snapshot.flights.find(p=>p.callsign===f.separation!.leader&&p.arrival===f.arrival&&p.runway===f.runway&&operational(p)):undefined
    const leaderName=leader?label(leader.callsign):''
    const rate=finite(f.separation?.rateSeconds)?Math.max(0,f.separation!.rateSeconds):0
    const wake=finite(f.separation?.wakeSeconds)?Math.max(0,f.separation!.wakeSeconds):0
    const extra=60*(Math.max(0,finite(f.slotBefore)?f.slotBefore:0)+Math.max(0,finite(leader?.slotAfter)?leader!.slotAfter:0))
    const scheduled=leader&&finite(f.sta)&&finite(leader.sta)?(f.sta-leader.sta)/1000:undefined
    const tight=scheduled!==undefined&&rate>0&&Math.abs(scheduled-Math.max(rate,wake)-extra)<=1
    if(tight){
        if(wake>rate+1)add({kind:'wake',detail:`Wake ${seconds(wake)} s behind ${leaderName}`,binding:true,leader:leaderName,seconds:seconds(wake)})
        else add({kind:'rate',detail:`Rate ${seconds(rate)} s behind ${leaderName}`,binding:true,leader:leaderName,seconds:seconds(rate)})
    }
    if(extra>0)add({kind:'interval',detail:`Inserted interval +${seconds(extra)} s${leaderName?' behind '+leaderName:''}`,binding:!!tight,leader:leaderName||undefined,seconds:seconds(extra)})
    if(positive(f.feederDelayMs)){
        const feederLeader=!f.passedFeeder&&finite(f.staFf)?snapshot.flights.filter(p=>p.callsign!==f.callsign&&p.arrival===f.arrival&&p.ff===f.ff&&!p.passedFeeder&&p.feederEtaAvailable!==false&&operational(p)&&finite(p.staFf)&&p.staFf<=f.staFf).sort((a,b)=>b.staFf-a.staFf)[0]:undefined
        const name=feederLeader?label(feederLeader.callsign):''
        add({kind:'feeder',detail:`${label(f.ff)||'Entry'} feeder spacing${name?' behind '+name:''}`,binding:true,leader:name||undefined,seconds:seconds(positive(f.feederDelayMs)/1000)})
    }
    if(positive(f.closureDelayMs))add({kind:'closure',detail:'Runway gap / closure',binding:true,seconds:seconds(positive(f.closureDelayMs)/1000)})
    else if(f.closurePosition)add({kind:'closure',detail:f.closurePosition.side==='before'?'Before runway gap':'After runway gap',binding:false})
    // A saved adjustment can survive a protected assignment. Report it as retained
    // evidence when the current predecessor is no longer at that tight minimum.
    if(!tight&&positive(f.wakeDelayMs))add({kind:'wake',detail:`Protected wake adjustment ${seconds(positive(f.wakeDelayMs)/1000)} s`,binding:false,seconds:seconds(positive(f.wakeDelayMs)/1000)})
    if(!tight&&positive(f.rateDelayMs))add({kind:'rate',detail:`Protected rate adjustment ${seconds(positive(f.rateDelayMs)/1000)} s`,binding:false,seconds:seconds(positive(f.rateDelayMs)/1000)})
    if(finite(edit.target)&&Math.abs(edit.target)<=8640000000000000&&(!f.editTracking||f.appliedTarget===edit.target)){
        if(edit.targetKind==='sequence')add({kind:'manual-order',detail:'Controller sequence slot',binding:false})
        else add({kind:'manual-time',detail:`Manual time ${utc(edit.target)}`,binding:finite(f.sta)&&Math.abs(f.sta-edit.target)<=1000,target:edit.target})
    }
    if(finite(edit.order)&&edit.orderExplicit!==false&&(!f.editTracking||f.appliedOrder===edit.order)&&!reasons.some(r=>r.kind==='manual-order'))add({kind:'manual-order',detail:'Controller sequence order',binding:false})
    if(finite(f.minimumArrival)&&finite(f.eta)&&finite(f.sta)&&f.minimumArrival>f.eta+1000&&f.sta>=f.minimumArrival-1000&&Math.abs(f.minimumArrival)<=8640000000000000){
        add({kind:'minimum',detail:`${f.minimumArrivalSource==='resume'?'Resume':'Arrival'} minimum ${utc(f.minimumArrival)}`,binding:Math.abs(f.sta-f.minimumArrival)<=1000,target:f.minimumArrival})
    }
    if(!reasons.some(r=>r.binding)){
        if(f.tmaAssignment||f.guidance?.policy.includes('accepted allocation'))add({kind:'retained',detail:f.passedFeeder?'Accepted TMA sequence time':'Accepted sequence time',binding:false})
        else if(finite(f.sta)&&finite(f.eta)&&Math.abs(f.sta-f.eta)<=1000)add({kind:'forecast',detail:'Current landing estimate',binding:false})
        else if(!reasons.length)add({kind:'retained',detail:'Assigned sequence time',binding:false})
    }
    return finish()
}
