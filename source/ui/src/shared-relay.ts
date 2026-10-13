import {DEFAULT_CONFIG,RUNWAYS,runEngine,validateConfig,validateEdits,validateTelemetry,validateLockedEdits,toJuhaSequence,reconcileRunwayAssignments,migrateSequenceEdits,type EngineConfig,type EngineSnapshot,type FlightEdit,type Telemetry} from './maestro-engine'
import {OPERATIONAL_KEYS,mergeSharedSettings,settingsUnchanged} from './maestro-settings'
import {APPLICATION_BUILD} from './build'
import {mergeCoordinationChanges} from './maestro-coordination'
import {COORDINATION_MESSAGES,validateCoordinations} from './maestro-coordination'
import {isTowerCallsign} from './callsign-identity'

export interface RelayOptions { network:'live'|'sweatbox1'|'sweatbox2';session:string;channel:string;instanceId:string }
type Plan = {epoch:string;revision:number;config:EngineConfig;edits:Record<string,FlightEdit>;snapshot:EngineSnapshot|null;masterCid:number|null;relayRole:string;stale:boolean}
type Send = (method:string,path:string,body?:any)=>Promise<any>
export interface RelayDependencies {send:Send;telemetry:()=>Promise<any>;cid:()=>number|null;compactPublication?:()=>boolean;now?:()=>number;requestId?:()=>string}
const copy=<T>(v:T):T=>structuredClone(v)
const canonical=(v:any):string=>JSON.stringify(v===undefined?null:v)
const ops=(config:EngineConfig)=>Object.fromEntries(OPERATIONAL_KEYS.filter(k=>config[k]!==undefined).map(k=>[k,config[k]]))
function configuration(operational:any,settings:any){
    const allowed=Object.fromEntries(OPERATIONAL_KEYS.filter(k=>operational?.[k]!==undefined).map(k=>[k,operational[k]]))
    return mergeSharedSettings(validateConfig({...copy(DEFAULT_CONFIG),...allowed}),settings||{})
}
function fail(message:string,status=409):never{throw Object.assign(new Error(message),{status})}

// Shared backend transport. Aircraft timing always runs in the DLL's embedded engine.
export class SharedRelay {
    readonly room:string
    private plan:Plan={epoch:'',revision:0,config:copy(DEFAULT_CONFIG),edits:{},snapshot:null,masterCid:null,relayRole:'disconnected',stale:true}
    private settings:Record<string,unknown>={}
    private settingsRevision=0
    private lease=''
    private initializeRunways=true
    private callsign=''
    private observer=false
    private commands:any[]=[]
    private applied:Record<string,{ok:boolean;message:string}>={}
    private history=new Map<number,Plan>()
    private pendingPublish:any=null
    private pendingCommand:any=null
    private busy:Promise<any>|null=null
    private lastUpdated=0
    private stopped=false
    private now:()=>number
    private id:()=>string
    constructor(readonly options:RelayOptions,private deps:RelayDependencies){
        for(const value of [options.session,options.channel])if(!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(value))fail('Use letters, numbers, hyphens or underscores for the exercise and room',400)
        if(!['live','sweatbox1','sweatbox2'].includes(options.network))fail('Select a valid network',400)
        this.room=`/aman/rooms/${options.network}/ESSA/${options.session}/${options.channel}`
        this.now=deps.now||Date.now;this.id=deps.requestId||(()=>crypto.randomUUID())
    }
    private identity(){return {instanceId:this.options.instanceId,callsign:this.callsign,engine:{name:'saaman',version:APPLICATION_BUILD.replace(/^SAAMAN /,''),schema:'saaman-1.1.9'},observer:this.observer||isTowerCallsign(this.callsign)}}
    private remember(){this.history.set(this.plan.revision,copy(this.plan));while(this.history.size>24)this.history.delete(this.history.keys().next().value!)}
    view(){return {...copy(this.plan),snapshot:this.plan.stale||this.now()-this.lastUpdated>=30000?null:copy(this.plan.snapshot)}}
    private serial<T>(action:()=>Promise<T>):Promise<T>{
        const prior=this.busy||Promise.resolve()
        const job=prior.catch(()=>{}).then(action)
        this.busy=job
        void job.finally(()=>{if(this.busy===job)this.busy=null}).catch(()=>{})
        return job
    }
    private accept(data:any){
        if(typeof data.epoch!=='string'||!Number.isSafeInteger(data.revision))fail('Invalid backend room response',502)
        const reset=this.plan.epoch!==data.epoch
        if(!reset&&data.revision<this.plan.revision)return
        if(reset||data.role==='sequencer'&&(this.plan.relayRole!=='sequencer'||this.lease!==data.lease))this.initializeRunways=true
        if(reset){this.plan={...this.plan,epoch:data.epoch,config:copy(DEFAULT_CONFIG),edits:{},snapshot:null};this.history.clear();this.applied={};this.pendingPublish=null;this.pendingCommand=null;this.settings={}}
        if(data.settings!==undefined)this.settings=data.settings
        if(data.checkpoint!==undefined){
            const c=data.checkpoint
            if(c!==null){
                if(c.schema!=='saaman-1.1.9'||!c.snapshot||!Array.isArray(c.snapshot.flights)||c.snapshot.flights.length>500||!Number.isFinite(c.snapshot.timestamp))fail('Incompatible SAAMAN checkpoint',409)
                this.plan.config=configuration(c.operational,this.settings)
                this.plan.edits=validateEdits(c.edits||{})
                this.plan.snapshot=copy(c.snapshot)
                this.applied=c.appliedCommands&&typeof c.appliedCommands==='object'&&!Array.isArray(c.appliedCommands)?copy(c.appliedCommands):{}
            }else{this.plan.config=configuration({},this.settings);this.plan.edits={};this.plan.snapshot=null;this.applied={}}
        }else this.plan.config=configuration(ops(this.plan.config),this.settings)
        this.plan.epoch=data.epoch;this.plan.revision=data.revision;this.settingsRevision=data.settingsRevision
        this.plan.relayRole=data.role;this.plan.masterCid=data.role==='sequencer'?this.deps.cid():null
        this.lease=data.lease||'';this.commands=data.commands||[]
        this.lastUpdated=data.updated||0;this.plan.stale=data.stale===true
        this.remember()
    }
    private async pollRoom(force=false){
        const result=await this.deps.send('POST',this.room+'/poll',{...this.identity(),epoch:this.plan.epoch||undefined,revision:this.plan.revision,role:force?'':this.plan.relayRole,wait:false})
        this.accept(result)
    }
    private async telemetry(){
        const raw=await this.deps.telemetry(),t=validateTelemetry(raw,this.now())
        if(raw.connected===false)fail('Connect EuroScope before joining a shared room',503)
        if(Math.abs(this.now()-t.timestamp)>30000)fail('EuroScope telemetry is stale',503)
        const callsign=String(t.source).toUpperCase()
        if(!/^[A-Z0-9_-]{1,20}$/.test(callsign)||callsign==='OFFLINE'||callsign==='DEMO')fail('Connect EuroScope before joining a shared room',503)
        this.callsign=callsign
        if(isTowerCallsign(callsign)){this.pendingCommand=null;this.pendingPublish=null}
        return t
    }
    private applyCommand(command:any){
        const known=this.applied[String(command.id)];if(known)return known
        try{
            const c=command.cmd
            if(c?.op==='coordination'){
                const messages=copy(this.plan.config.coordinations??[])
                if(c.action==='send'){
                    const proposed=validateCoordinations([c.message])[0],existing=messages.find(m=>m.id===proposed.id)
                    if(existing&&(existing.message!==proposed.message||existing.sender!==proposed.sender||existing.senderCallsign!==proposed.senderCallsign||existing.at!==proposed.at))fail('Conflicting coordination ID',400)
                    if(!existing)messages.push(proposed)
                }else if(c.action==='ack'&&typeof c.id==='string'&&typeof c.operator==='string'&&c.operator.length<=100){
                    const message=messages.find(m=>m.id===c.id);if(!message)fail('Coordination no longer available',400)
                    message.acknowledgedBy=[...new Set([...message.acknowledgedBy,c.operator])]
                }else fail('Invalid coordination command',400)
                this.plan.config.coordinations=validateCoordinations(messages.slice(-100))
                return this.applied[String(command.id)]={ok:true,message:'Applied'}
            }
            if(c?.op!=='plan'||!Array.isArray(c.edits)||!Array.isArray(c.operational))fail('Unsupported SAAMAN command',400)
            const edits=copy(this.plan.edits),config:any=copy(this.plan.config)
            for(const patch of c.edits){
                if(typeof patch.key!=='string'||! /^[A-Z0-9_-]{2,16}$/.test(patch.key)||canonical(edits[patch.key])!==canonical(patch.before))fail('Aircraft edit changed; retry with the current sequence')
                if(patch.after===null)delete edits[patch.key];else edits[patch.key]=patch.after
            }
            for(const patch of c.operational){
                if(patch.key==='coordinations'){config.coordinations=mergeCoordinationChanges(patch.before??undefined,patch.after??undefined,config.coordinations);continue}
                if(!(OPERATIONAL_KEYS as readonly string[]).includes(patch.key)||canonical(config[patch.key])!==canonical(patch.before))fail('Runway or rate plan changed; retry with the current sequence')
                if(patch.after===null)delete config[patch.key];else config[patch.key]=patch.after
            }
            const next=validateConfig(config),validated=validateEdits(edits)
            validateLockedEdits(this.plan.snapshot,this.plan.edits,validated,next)
            this.plan.config=next;this.plan.edits=validated
            return this.applied[String(command.id)]={ok:true,message:'Applied'}
        }catch(e:any){return this.applied[String(command.id)]={ok:false,message:String(e.message).slice(0,500)}}
    }
    private async publish(telemetry:Telemetry){
        // Retry the identical publication first: an uncertain response must not apply its edits twice.
        if(this.pendingPublish){
            try{const result=await this.deps.send('PUT',this.room,this.pendingPublish);this.plan.revision=result.revision;this.pendingPublish=null}
            catch(e:any){const status=e.status||e.response?.status;if(status>=400&&status<500)this.pendingPublish=null;else throw e}
            await this.pollRoom(true)
            if(this.plan.relayRole!=='sequencer')return
        }
        if(this.initializeRunways){
            const firstEssa=(runways:unknown)=>Array.isArray(runways)?runways.find(r=>typeof r==='string'&&r.startsWith('ESSA/')&&RUNWAYS.includes(r)):undefined
            const active=firstEssa(telemetry.activeRunways?.arrivals),departureRunway=firstEssa(telemetry.activeRunways?.departures)
            if(!active||!departureRunway)fail(`Waiting for active ESSA arrival and departure runways in EuroScope (ARR: ${active?.split('/')[1]||'not detected'}; DEP: ${departureRunway?.split('/')[1]||'not detected'})`,503)
            const seeded={...this.plan.config,active:[active],departureRunway}
            // An expired runway change restored from the room must not undo
            // the current EuroScope selection on the first calculation.
            if(seeded.pending&&seeded.pending.at<=this.now())delete seeded.pending
            this.plan.config=validateConfig(seeded)
            this.initializeRunways=false
        }
        this.plan.edits=migrateSequenceEdits(reconcileRunwayAssignments(telemetry,this.plan.edits,this.plan.snapshot),this.plan.snapshot??undefined)
        const results=this.commands.sort((a,b)=>a.id-b.id).map(command=>({id:command.id,...this.applyCommand(command)}))
        const previous=this.plan.snapshot?{...this.plan.snapshot,timestamp:Math.min(this.plan.snapshot.timestamp,telemetry.timestamp-1)}:undefined
        this.plan.snapshot=runEngine(telemetry,this.plan.config,this.plan.edits,previous)
        const keep=Object.keys(this.applied).map(Number).sort((a,b)=>b-a).slice(0,1000)
        this.applied=Object.fromEntries(keep.map(id=>[id,this.applied[String(id)]]))
        const checkpoint={schema:'saaman-1.1.9',operational:ops(this.plan.config),edits:this.plan.edits,snapshot:this.plan.snapshot,appliedCommands:this.applied}
        this.pendingPublish={...this.identity(),epoch:this.plan.epoch,revision:this.plan.revision,lease:this.lease,settingsRevision:this.settingsRevision,requestId:this.id(),sequence:toJuhaSequence(this.plan.snapshot,this.plan.config,this.plan.edits),checkpoint,results,
            supervision:this.deps.compactPublication?.()===true?{sameAsCheckpoint:true}:{config:ops(this.plan.config),edits:this.plan.edits,snapshot:this.plan.snapshot}}
        const result=await this.deps.send('PUT',this.room,this.pendingPublish)
        this.plan.revision=result.revision;this.lastUpdated=this.now();this.plan.stale=false;this.pendingPublish=null;this.commands=[];this.remember()
    }
    private async cycle(){
        if(this.stopped)return this.view()
        try{
            const telemetry=await this.telemetry()
            await this.pollRoom()
            if(!this.observer&&!isTowerCallsign(this.callsign)&&this.plan.relayRole==='sequencer')await this.publish(telemetry)
            if(this.pendingCommand){
                let response:any
                try{response=await this.deps.send('POST',this.room+'/command',this.pendingCommand)}catch(e:any){if((e.status||e.response?.status)===409)this.pendingCommand=null;throw e}
                this.pendingCommand=null
                return {...this.view(),commandId:response.id}
            }
            return this.view()
        }catch(e:any){this.plan.stale=true;throw e}
    }
    tick(){return this.serial(()=>this.cycle())}
    setObserver(observer:boolean){return this.serial(async()=>{this.observer=observer;this.pendingPublish=null;await this.telemetry();await this.pollRoom();return this.view()})}
    coordinate(message?:string,acknowledge?:string){return this.serial(async()=>{
        if(this.pendingCommand)fail('A previous command is awaiting delivery; check the room before retrying')
        if((message===undefined)===(acknowledge===undefined)||message!==undefined&&!(COORDINATION_MESSAGES as readonly string[]).includes(message))fail('Select a valid coordination message',400)
        await this.telemetry();await this.pollRoom()
        if(isTowerCallsign(this.callsign))fail('Tower positions are observers only',403)
        const command=message!==undefined?{op:'coordination',action:'send',message:{id:this.id(),message,sender:this.options.instanceId,senderCallsign:this.callsign,at:this.now(),acknowledgedBy:[this.options.instanceId]}}:{op:'coordination',action:'ack',id:acknowledge,operator:this.options.instanceId}
        this.pendingCommand={...this.identity(),epoch:this.plan.epoch,revision:this.plan.revision,requestId:this.id(),cmd:command}
        let response:any
        try{response=await this.deps.send('POST',this.room+'/command',this.pendingCommand);this.pendingCommand=null}
        catch(e:any){if((e.status||e.response?.status)===409)this.pendingCommand=null;throw e}
        const id=response.id
        for(let attempt=0;attempt<8;attempt++){
            await this.cycle()
            const reply=await this.deps.send('POST',this.room+'/poll',{...this.identity(),epoch:this.plan.epoch,revision:this.plan.revision,role:this.plan.relayRole,wait:false})
            this.accept(reply)
            const result=reply.results?.find((r:any)=>r.id===id)
            if(result){if(!result.ok)fail(result.message,400);return this.view()}
            await new Promise(resolve=>setTimeout(resolve,250))
        }
        fail('Coordination submitted; waiting for the sequencer.',202)
    })}
    edit(revision:number,nextEdits:any,nextConfig:any){return this.serial(async()=>{
        if(this.pendingCommand)fail('A previous change is awaiting delivery; check the sequence before editing again')
        if(this.observer)fail('Observer cannot edit',403)
        await this.telemetry();if(isTowerCallsign(this.callsign))fail('Tower positions are observers only',403)
        const base=this.history.get(revision)
        if(!base)fail('Sequence changed; reload and retry')
        const config=validateConfig(nextConfig),edits=validateEdits(nextEdits)
        if(!settingsUnchanged(base.config,config))fail('Use the separate supervisory window',403)
        validateLockedEdits(base.snapshot,base.edits,edits,config)
        const difference=(before:any,after:any,keys:string[])=>keys.filter(k=>canonical(before[k])!==canonical(after[k])).map(key=>({key,before:before[key]??null,after:after[key]??null}))
        const changes={op:'plan',edits:difference(base.edits,edits,[...new Set([...Object.keys(base.edits),...Object.keys(edits)])]),operational:difference(base.config,config,[...OPERATIONAL_KEYS])}
        await this.pollRoom()
        this.pendingCommand={...this.identity(),epoch:this.plan.epoch,revision:this.plan.revision,requestId:this.id(),cmd:changes}
        let response:any
        try{response=await this.deps.send('POST',this.room+'/command',this.pendingCommand);this.pendingCommand=null}
        catch(e:any){if((e.status||e.response?.status)===409)this.pendingCommand=null;throw e}
        const id=response.id
        for(let attempt=0;attempt<8;attempt++){
            await this.cycle()
            const reply=await this.deps.send('POST',this.room+'/poll',{...this.identity(),epoch:this.plan.epoch,revision:this.plan.revision,role:this.plan.relayRole,wait:false})
            this.accept(reply)
            const result=reply.results?.find((r:any)=>r.id===id)
            if(result){if(!result.ok)fail(result.message,400);return this.view()}
            await new Promise(resolve=>setTimeout(resolve,250))
        }
        fail('Change submitted; waiting for the sequencer. Check the current sequence before retrying.',202)
    })}
    async supervision(){
        const data=await this.deps.send('GET',this.room+'/supervision')
        const detail=data.supervision
        this.settings=data.settings||{};this.settingsRevision=data.settingsRevision
        this.plan={...this.plan,epoch:data.epoch,revision:data.revision,config:configuration(detail?.config,this.settings),edits:validateEdits(detail?.edits||{}),snapshot:detail?.snapshot||null,stale:data.stale,relayRole:'supervisor'}
        this.lastUpdated=detail?.snapshot?.timestamp||0
        return this.view()
    }
    async saveSettings(revision:number,settings:Record<string,unknown>){
        await this.telemetry();if(isTowerCallsign(this.callsign))fail('Tower positions are observers only',403)
        if(this.plan.revision!==revision)fail('Shared settings changed; reload and retry')
        mergeSharedSettings(this.plan.config,settings)
        const expectedEpoch=this.plan.epoch,expectedSettingsRevision=this.settingsRevision
        for(let attempt=0;attempt<3;attempt++){
            const current=await this.deps.send('GET',this.room+'/supervision')
            if(current.epoch!==expectedEpoch||current.settingsRevision!==expectedSettingsRevision)fail('Another supervisor changed the settings; reload and retry')
            try{await this.deps.send('PUT',this.room+'/settings',{epoch:current.epoch,revision:current.revision,settings:{...current.settings,...settings}});return this.supervision()}
            catch(e:any){if((e.status||e.response?.status)!==409)throw e}
        }
        fail('The shared plan is updating; retry saving the settings')
    }
    leave(){
        this.stopped=true;this.plan.stale=true
        return this.serial(async()=>{this.plan.stale=true;this.pendingPublish=null;this.pendingCommand=null;if(this.callsign)await this.deps.send('POST',this.room+'/leave',this.identity())})
    }
}
