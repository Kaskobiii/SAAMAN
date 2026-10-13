export interface ControllerIdentity { cid:number|null; callsign:string; supervisor:boolean }
export function isTowerCallsign(callsign:string){return callsign.toUpperCase().includes('TWR')}
/** EuroScope callsign identity; the existing vatIRIS API checks live writers. */
export class CallsignIdentity {
    identity:ControllerIdentity|undefined
    private running=false
    private controllers:{cid:number;callsign:string}[]=[]
    private feedAt=0
    constructor(private deps:{network:string;cid?:number;now:()=>number;telemetry:()=>Promise<any>;controllers:()=>Promise<any>;changed:(identity:ControllerIdentity|undefined)=>void}){}
    private async feed(){
        if(!this.feedAt||this.deps.now()-this.feedAt>=15000){
            const response=await this.deps.controllers()
            if(!Array.isArray(response?.controllers))throw new Error('Invalid VATSIM controller feed')
            this.controllers=response.controllers.filter((c:any)=>c.facility>0&&Number.isSafeInteger(c.cid)&&c.cid>=1000&&typeof c.callsign==='string').map((c:any)=>({cid:c.cid,callsign:c.callsign.toUpperCase()}))
            this.feedAt=this.deps.now()
        }
        return this.controllers
    }
    async isSupervisor(callsign:string,claimedCid?:number){
        if(isTowerCallsign(callsign))return false
        if(this.deps.network!=='live')return claimedCid===1396125
        return (await this.feed()).some(c=>c.callsign===callsign&&c.cid===1396125)
    }
    async refresh(){
        if(this.running)return
        this.running=true
        try{
            const raw=await this.deps.telemetry(),now=this.deps.now(),callsign=String(raw.source||'').trim().toUpperCase()
            if(raw.connected!==true||!Number.isFinite(raw.timestamp)||Math.abs(now-raw.timestamp)>10000||!/^[A-Z0-9_-]{1,20}$/.test(callsign)||['OFFLINE','DEMO'].includes(callsign))throw new Error('Waiting for a connected EuroScope callsign')
            if(this.deps.network==='live'&&raw.simulation===true)throw new Error('Select SweatBox in Operation mode for this simulator connection')
            if(this.identity?.callsign!==callsign)this.clear()
            const cid=this.deps.network==='live'?(await this.feed()).find(c=>c.callsign===callsign)?.cid:this.deps.cid||null
            if(this.deps.network==='live'&&!cid)throw new Error('Your EuroScope callsign is not in the VATSIM ATC feed yet; it updates every 15 seconds')
            this.identity={cid:cid??null,callsign,supervisor:cid===1396125};this.deps.changed(this.identity)
        }catch(e){this.clear();throw e}finally{this.running=false}
    }
    clear(){this.identity=undefined;this.deps.changed(undefined)}
}
