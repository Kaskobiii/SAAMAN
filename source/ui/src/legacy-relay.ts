import {DEFAULT_CONFIG} from './maestro-engine'
import {mergeSharedSettings} from './maestro-settings'
import {isTowerCallsign,canSequenceEssa} from './callsign-identity'
import {APPLICATION_BUILD} from './build'
import {sequencerVersionWarning} from './sequencer-version'
type Send=(method:string,path:string,body?:any)=>Promise<any>
type Receipt={digest:string;ok:boolean;message:string}
type Envelope={protocol:'saaman-legacy-1';epoch:string;revision:number;owner:string;instanceId:string;lease:string;settingsRevision:number;settings:Record<string,unknown>;checkpoint:any;receipts:Record<string,Receipt>;publication:string;publishedAt:number;engineVersion?:string}
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v))
const fail=(message:string,status=409):never=>{throw Object.assign(new Error(message),{status})}
async function digest(value:any){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')}

/** Adapter for vatIRIS's existing callsign-based /aman/:net/:icao API.
 * Recovery metadata travels as an extra field on its opaque MAESTRO sequence.
 * The server still elects the sequencer and checks live callsigns itself.
 */
export class LegacyRelay {
    readonly room:string
    private state:Envelope
    private callsign=''
    private observer=false
    private proxy=false
    private commandIds=new Map<number,string>()
    private role='disconnected'
    private pending=new Map<number,{from:string;requestId:string;digest:string;primary:number}>()
    private results=new Map<number,any>()
    private preserveRunwayPlan=false
    private reportedOwner=''
    private reportedVersion:unknown
    private knownVersions:unknown[]=[]
    constructor(private deps:{network:string;instanceId:string;send:Send;callsign:()=>string;cid:()=>number|null;supervisor:(callsign:string,claimedCid?:number)=>Promise<boolean>;now?:()=>number;requestId?:()=>string}){
        this.room=`/aman/${deps.network}/ESSA`;this.state=this.empty()
    }
    private now(){return this.deps.now?.()??Date.now()}
    private id(){return this.deps.requestId?.()??crypto.randomUUID()}
    private empty():Envelope{return {protocol:'saaman-legacy-1',epoch:this.id(),revision:0,owner:'',instanceId:'',lease:'',settingsRevision:0,settings:{},checkpoint:null,receipts:{},publication:'',publishedAt:0}}
    private adopt(sequence:any,revision?:number){
        if(!sequence)return
        const e=sequence.saamanRelay
        if(!e||e.protocol!=='saaman-legacy-1')fail('This shared sequence belongs to another AMAN plugin. Stop that sequencer before using SAAMAN.')
        if(typeof e.epoch!=='string'||!Number.isSafeInteger(e.revision)||!Number.isSafeInteger(e.settingsRevision)||!Number.isFinite(e.publishedAt)||typeof e.owner!=='string'||typeof e.instanceId!=='string'||typeof e.lease!=='string'||!e.settings||!e.receipts||Object.keys(e.receipts).length>1000)fail('Invalid SAAMAN recovery data',502)
        if(this.state.epoch!==e.epoch){this.results.clear();this.pending.clear();this.commandIds.clear()}
        this.state=copy(e);if(revision!==undefined)this.state.revision=revision
    }
    private async read(){
        try{this.adopt(await this.deps.send('GET',this.room))}
        catch(e:any){if((e.status||e.response?.status)!==404)throw e}
        // Same-callsign instances share the API's destructive results queue.
        // Recover this instance's receipts from the published checkpoint instead.
        for(const [id,requestId] of this.commandIds){const receipt=this.state.receipts[requestId];if(receipt){this.results.set(id,{id,ok:receipt.ok===true,message:String(receipt.message||'')});this.commandIds.delete(id)}}
        while(this.results.size>1000)this.results.delete(this.results.keys().next().value!)
        return this.state
    }
    private snapshot(role=this.role){
        const s=this.state,checkpoint=s.checkpoint
        return {epoch:s.epoch,revision:s.revision,role,settingsRevision:s.settingsRevision,settings:copy(s.settings),checkpoint:copy(checkpoint),updated:s.publishedAt,
            sequencerWarning:sequencerVersionWarning(this.reportedOwner||s.owner,this.reportedVersion??s.engineVersion,[APPLICATION_BUILD.replace(/^SAAMAN /,''),...this.knownVersions]),
            stale:!checkpoint||this.now()-s.publishedAt>=30000,...(role==='sequencer'?{lease:s.lease,preserveRunwayPlan:this.preserveRunwayPlan}:{}),results:[...this.results.values()]}
    }
    private remember(requestId:string,receipt:Receipt){
        this.state.receipts[requestId]=receipt
        const ids=Object.keys(this.state.receipts);for(const id of ids.slice(0,Math.max(0,ids.length-1000)))delete this.state.receipts[id]
    }
    private async commands(input:any[]){
        this.pending.clear();const seen=new Map<string,{id:number;digest:string}>(),commands:any[]=[]
        for(const item of input){
            const wrapped=item.cmd
            if(!Number.isSafeInteger(item.id)||typeof item.from!=='string')fail('Invalid shared command',502)
            if(isTowerCallsign(item.from)){
                const requestId=`tower-${item.id}`;this.pending.set(item.id,{from:item.from,requestId,digest:'',primary:item.id});this.remember(requestId,{digest:'',ok:false,message:'Tower positions are observers only'});continue
            }
            if(wrapped?.op!=='saaman-command'||typeof wrapped.requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(wrapped.requestId)){
                this.pending.set(item.id,{from:item.from,requestId:`unsupported-${item.id}`,digest:'',primary:item.id})
                this.remember(`unsupported-${item.id}`,{digest:'',ok:false,message:'Command belongs to another AMAN plugin'});continue
            }
            const hash=await digest({epoch:wrapped.epoch,settingsRevision:wrapped.settingsRevision,cmd:wrapped.cmd})
            const prior=seen.get(wrapped.requestId),primary=prior?.id??item.id
            if(!prior)seen.set(wrapped.requestId,{id:primary,digest:hash})
            this.pending.set(item.id,{from:item.from,requestId:wrapped.requestId,digest:hash,primary})
            if(prior&&prior.digest!==hash){this.pending.set(item.id,{from:item.from,requestId:`conflict-${item.id}`,digest:hash,primary:item.id});this.remember(`conflict-${item.id}`,{digest:hash,ok:false,message:'Conflicting command retry'});continue}
            const receipt=this.state.receipts[wrapped.requestId]
            if(receipt){if(receipt.digest!==hash)this.pending.set(item.id,{from:item.from,requestId:`conflict-${item.id}`,digest:hash,primary:item.id}),this.remember(`conflict-${item.id}`,{digest:hash,ok:false,message:'Conflicting command retry'});continue}
            if(primary!==item.id)continue
            if(wrapped.epoch!==this.state.epoch){this.remember(wrapped.requestId,{digest:hash,ok:false,message:'Shared sequence reset; retry with the current sequence'});continue}
            if(wrapped.cmd?.op==='legacy-settings'){
                let receipt:Receipt
                try{
                    if(!await this.deps.supervisor(item.from,wrapped.cid))fail('Supervisor access required',403)
                    if(wrapped.settingsRevision!==this.state.settingsRevision)fail('Another supervisor changed the settings; reload and retry')
                    const settings={...this.state.settings,...wrapped.cmd.settings};mergeSharedSettings(DEFAULT_CONFIG,settings)
                    this.state.settings=settings;this.state.settingsRevision++;receipt={digest:hash,ok:true,message:'Applied'}
                }catch(e:any){receipt={digest:hash,ok:false,message:e.message}}
                this.remember(wrapped.requestId,receipt);continue
            }
            if(!['plan','coordination'].includes(wrapped.cmd?.op)){this.remember(wrapped.requestId,{digest:hash,ok:false,message:'Unsupported SAAMAN command'});continue}
            commands.push({id:item.id,from:item.from,cmd:wrapped.cmd})
        }
        return commands
    }
    private async poll(body:any){
        this.callsign=body.callsign;this.observer=body.observer===true;this.proxy=body.proxy===true
        if(this.observer||this.proxy||!canSequenceEssa(this.callsign)){await this.read();this.role=this.observer?'observer':'editor';return this.snapshot()}
        // Empty role forces an immediate answer; the API's normal long poll is 20 s.
        const out=await this.deps.send('POST',this.room+'/poll',{callsign:this.callsign,role:'',version:body.revision||0,cmdAfter:0,sequencerPolicy:'essa-priority-1',engineVersion:body.engine?.version})
        if(!['sequencer','editor'].includes(out.role)||!Number.isSafeInteger(out.version))fail('Invalid vatIRIS AMAN response',502)
        if(!out.sequence&&out.version===0&&this.state.revision>0)this.state=this.empty()
        this.adopt(out.sequence,out.version);this.state.revision=out.version;this.role=out.role
        this.reportedOwner=typeof out.sequencer==='string'?out.sequencer:''
        this.reportedVersion=out.sequencerVersion
        this.knownVersions=Array.isArray(out.versions)?out.versions:[]
        this.preserveRunwayPlan=out.role==='sequencer'&&!!this.state.checkpoint&&typeof out.handover?.callsign==='string'&&out.handover?.version===out.version
        for(const result of out.results||[])this.results.set(result.id,result)
        while(this.results.size>1000)this.results.delete(this.results.keys().next().value!)
        if(this.role==='sequencer'){
            if(this.state.owner===this.callsign&&this.state.instanceId&&this.state.instanceId!==this.deps.instanceId&&this.now()-this.state.publishedAt<8000)fail('Another SAAMAN instance is using this EuroScope callsign')
            if(this.state.owner!==this.callsign||this.state.instanceId!==this.deps.instanceId||!this.state.lease){this.state.owner=this.callsign;this.state.instanceId=this.deps.instanceId;this.state.lease=this.id()}
        }
        const commands=this.role==='sequencer'?await this.commands(out.commands||[]):[]
        return {...this.snapshot(),commands}
    }
    private async publish(body:any){
        if(!canSequenceEssa(body.callsign))fail('This position cannot sequence ESSA',403)
        if(this.proxy||body.proxy===true)fail('Proxy connections follow the direct sequencer',403)
        const local=copy(this.state)
        await this.read()
        if(this.state.publication===body.requestId)return {revision:this.state.revision}
        // Keep locally processed commands/settings while checking the remote
        // publication. A changed remote revision must still invalidate the write.
        if(this.state.epoch===local.epoch&&this.state.revision===local.revision)this.state=local
        if(body.epoch!==this.state.epoch||body.lease!==this.state.lease||body.callsign!==this.state.owner||body.instanceId!==this.state.instanceId||body.settingsRevision!==this.state.settingsRevision)fail('Shared sequence changed; rejoin before publishing')
        for(const result of body.results||[]){const command=this.pending.get(result.id);if(command)this.remember(command.requestId,{digest:command.digest,ok:result.ok===true,message:String(result.message||'')})}
        const results:any[]=[];let ack=0
        for(const [id,command] of [...this.pending].sort(([a],[b])=>a-b)){
            const receipt=this.state.receipts[command.requestId]
            if(!receipt)break
            results.push({id,from:command.from,ok:receipt.ok,message:receipt.message});ack=id
        }
        const next={...copy(this.state),revision:body.revision+1,checkpoint:copy(body.checkpoint),publication:body.requestId,publishedAt:this.now(),engineVersion:body.engine?.version}
        const reply=await this.deps.send('PUT',this.room,{callsign:body.callsign,sequence:{...body.sequence,saamanRelay:next},results,cmdAck:ack,expectedVersion:body.revision})
        if(!Number.isSafeInteger(reply.version))fail('Invalid vatIRIS publication response',502)
        this.state={...next,revision:reply.version};this.pending.clear();return {revision:reply.version}
    }
    private async command(body:any){
        if(body.epoch!==this.state.epoch)fail('Shared sequence changed; reload and retry')
        const takeSequencer=body.cmd?.op==='plan'&&body.cmd.takeSequencer===true&&canSequenceEssa(body.callsign)&&this.state.owner!==body.callsign
        if(takeSequencer){
            let supported=false
            try{supported=(await this.deps.send('GET','/aman/capabilities'))?.runwayHandover===1}
            catch(e:any){if((e.status||e.response?.status)!==404)throw e}
            if(!supported)fail('The vatIRIS backend needs the runway-handover update before another controller can apply this configuration')
        }
        const reply=await this.deps.send('POST',this.room+'/command',{callsign:body.callsign,...(takeSequencer?{takeSequencer:true}:{}),cmd:{op:'saaman-command',requestId:body.requestId,epoch:body.epoch,settingsRevision:this.state.settingsRevision,cid:this.deps.cid(),cmd:body.cmd}})
        if(Number.isSafeInteger(reply.id)){this.commandIds.set(reply.id,body.requestId);while(this.commandIds.size>1000)this.commandIds.delete(this.commandIds.keys().next().value!)}
        return reply
    }
    private async supervision(){
        if(!await this.deps.supervisor(this.deps.callsign(),this.deps.cid()??undefined))fail('Supervisor access required',403)
        await this.read();const s=this.state
        return {epoch:s.epoch,revision:s.revision,settingsRevision:s.settingsRevision,settings:copy(s.settings),stale:!s.checkpoint||this.now()-s.publishedAt>=30000,
            supervision:s.checkpoint?{config:s.checkpoint.operational,edits:s.checkpoint.edits,snapshot:s.checkpoint.snapshot}:null}
    }
    private async settings(body:any){
        await this.supervision()
        if(body.epoch!==this.state.epoch||body.revision!==this.state.revision)fail('Shared sequence changed; reload and retry')
        mergeSharedSettings(DEFAULT_CONFIG,body.settings)
        const requestId=this.id(),epoch=this.state.epoch
        await this.command({callsign:this.deps.callsign(),epoch,requestId,cmd:{op:'legacy-settings',settings:body.settings}})
        for(let attempt=0;attempt<24;attempt++){
            await this.read();if(this.state.epoch!==epoch)fail('Shared sequence reset; reload and retry')
            const receipt=this.state.receipts[requestId]
            if(receipt){if(!receipt.ok)fail(receipt.message,400);return {revision:this.state.revision}}
            await new Promise(resolve=>setTimeout(resolve,250))
        }
        fail('Settings submitted; waiting for the sequencer. Check current settings before retrying.',202)
    }
    async send(method:string,path:string,body:any={}){
        if(isTowerCallsign(this.deps.callsign())){
            if(path.endsWith('/poll'))return this.poll({...body,observer:true})
            if(path.endsWith('/leave'))return {left:true}
            fail('Tower positions are observers only',403)
        }
        if(path.endsWith('/poll'))return this.poll(body)
        if(path.endsWith('/command'))return this.command(body)
        if(path.endsWith('/supervision'))return this.supervision()
        if(path.endsWith('/settings'))return this.settings(body)
        if(path.endsWith('/leave')){if(!this.observer&&!this.proxy&&canSequenceEssa(body.callsign))return this.deps.send('POST',this.room+'/leave',{callsign:body.callsign});return {left:true}}
        if(method==='PUT')return this.publish(body)
        fail('Unsupported legacy AMAN operation',400)
    }
}
