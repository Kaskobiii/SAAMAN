// Basic feeder assignments: ESAA-Sectorfile/Plugins/TopSkySettings.txt.
// Ownership order: installed ESAA AIRAC 2610 v3 ESE, ESOS sectors containing
// the feeder at FL200. APP-W's ELTOK role is the requested AMAN exception;
// receiving APP positions do not acquire/remove upstream feeder coverage.
export const ESSA_FEEDERS=['NILUG','ELTOK','VACRA','XILAN'] as const
const ownership:Record<string,string[]>={
    NILUG:['S2','S7','S9','S1','S3','AA'],
    ELTOK:['W','S8','S3','SN','S1','AA'],
    VACRA:['S4','SF','SN','SK','S3','S1','AA'],
    XILAN:['S6','S9','S1','S3','AA'],
}
export interface ControllerPresence {callsign:string;positionId?:string;facility?:number;controller?:boolean}
export interface FeederCoverage {detected:boolean;view:'ACC'|'ARR-W'|null;position:string;feeders:string[];owners:Record<string,string|null>}
function position(controller:ControllerPresence){
    // Position matching only: handover underscores must not change ownership.
    // Network requests and live identity checks keep the actual full callsign.
    const callsign=String(controller.callsign||'').trim().toUpperCase().replace(/_+/g,'_')
    if(/^ESSA_W(?:_[A-Z0-9]+)?_APP$/.test(callsign))return 'W'
    if(/^ESAA(?:_[A-Z0-9]+)?_(CTR|FSS)$/.test(callsign))return 'AA'
    if(/^ESOS_.*_CTR$/.test(callsign)){
        const id=controller.positionId?.trim().toUpperCase()
        if(id&&/^S(?:[12346789]|F|K|N|XK|YK)$/.test(id))return id
        const match=/^ESOS_([12346789]|F|K|N|XK|YK)(?:_[A-Z0-9]+)?_CTR$/.exec(callsign)
        return match?'S'+match[1]:''
    }
    return ''
}
export function feederCoverage(own:ControllerPresence,controllers:ControllerPresence[]=[]):FeederCoverage {
    const ownPosition=position(own),callsign=String(own.callsign||'').trim().toUpperCase().replace(/_+/g,'_'),owners:Record<string,string|null>={}
    if(!ownPosition){
        const receiver=/_(APP|DEP)$/.test(callsign)
        const knownOther=receiver||/_(CTR|FSS|TWR|GND|DEL)$/.test(callsign)
        return {detected:knownOther,view:receiver?null:'ACC',position:'',feeders:knownOther?[]:[...ESSA_FEEDERS],owners}
    }
    const online=new Set([ownPosition,...controllers.filter(c=>c&&c.controller!==false&&(c.facility===undefined||c.facility>=5)).map(position)].filter(Boolean))
    for(const feeder of ESSA_FEEDERS)owners[feeder]=ownership[feeder].find(id=>online.has(id))??null
    return {detected:true,view:ownPosition==='W'?'ARR-W':'ACC',position:ownPosition,feeders:ESSA_FEEDERS.filter(ff=>owners[ff]===ownPosition),owners}
}
