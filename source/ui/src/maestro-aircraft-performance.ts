import data from './data/euroscope-performance-profiles.json'
import {openapValues,openapProfile,OPENAP_SOURCE,type PerformanceModel} from './maestro-openap'
export {OPENAP_SOURCE,openapProfile}
export const PERFORMANCE_SOURCE=data.source
type Phase='climb'|'cruise'|'descent'
export function aircraftType(value:string){return value.trim().toUpperCase().match(/^(?:[A-Z]\/)?([A-Z0-9]{2,4})(?:\/.*)?$/)?.[1]??''}
function atmosphere(altitude:number){
    const height=Math.max(0,Math.min(60000,altitude))*.3048,lower=Math.min(11000,height)
    const temperature=1-.0065*lower/288.15
    const pressure=temperature**5.25588*Math.exp(-9.80665*Math.max(0,height-11000)/(287.05287*216.65))
    return {temperature,pressure}
}
export function iasToTas(ias:number,altitude:number){
    const {temperature,pressure}=atmosphere(altitude),impact=(1+.2*(ias/661.4786)**2)**3.5-1
    return 661.4786*Math.sqrt(temperature)*Math.sqrt(5*((1+impact/pressure)**(2/7)-1))
}
export function machToTas(mach:number,altitude:number){return mach*661.4786*Math.sqrt(atmosphere(altitude).temperature)}
export function tasToIas(tas:number,altitude:number){let low=0,high=1000;for(let i=0;i<40;i++){const mid=(low+high)/2;if(iasToTas(mid,altitude)<tas)low=mid;else high=mid}return (low+high)/2}
export function performanceAt(value:string,altitude:number,phase:Phase='descent',model:PerformanceModel='euroscope'){
    if(!Number.isFinite(altitude))return undefined
    const typeCode=aircraftType(value),oa=model==='openap'?openapValues(typeCode,altitude,phase):undefined
    if(oa){
        let tas=oa.mach>0?machToTas(oa.mach,altitude):iasToTas(oa.cas,altitude)
        if(oa.property?.vmo)tas=Math.min(tas,iasToTas(oa.property.vmo,altitude))
        if(oa.property?.mmo)tas=Math.min(tas,machToTas(oa.property.mmo,altitude))
        return {type:typeCode,nominalTas:tas,nominalIas:tasToIas(tas,altitude),climbFpm:oa.climbFpm,descentFpm:oa.descentFpm,ceilingFeet:oa.ceilingFeet,source:OPENAP_SOURCE.repository,blobSha:OPENAP_SOURCE.commit,provider:'openap',profileType:oa.model!,match:oa.match!,gainEligible:oa.match==='exact'&&!!oa.property.vmo&&!!oa.property.mmo,vmo:oa.property?.vmo,mmo:oa.property?.mmo}
    }
    const type=aircraftType(value),profile=(data.profiles as Record<string,{type:string;rotor:boolean;rows:number[][]}>)[type]
    if(!profile||profile.rotor||!Number.isFinite(altitude))return undefined
    const rows=profile.rows,fl=altitude/100,index=rows.findIndex(r=>r[0]>=fl)
    const upper=rows[index<0?rows.length-1:index],lower=rows[Math.max(0,(index<0?rows.length-1:index)-1)]
    const fraction=upper[0]===lower[0]?0:Math.max(0,Math.min(1,(fl-lower[0])/(upper[0]-lower[0])))
    const column=phase==='climb'?1:phase==='cruise'?2:3
    const speed=(row:number[])=>row[column]>0?iasToTas(row[column],altitude):row[column+3]>0?machToTas(row[column+3]/100,altitude):undefined
    const a=speed(lower),b=speed(upper);if(a===undefined||b===undefined)return undefined
    const tas=a+(b-a)*fraction
    return {type,nominalTas:tas,nominalIas:tasToIas(tas,altitude),climbFpm:lower[7]+(upper[7]-lower[7])*fraction,descentFpm:lower[8]+(upper[8]-lower[8])*fraction,ceilingFeet:rows.at(-1)![0]*100,source:PERFORMANCE_SOURCE.repository,blobSha:PERFORMANCE_SOURCE.blobSha,provider:'euroscope',profileType:type,match:model==='openap'?'fallback':'exact',gainEligible:model!=='openap',vmo:undefined,mmo:undefined}
}
export function descentSeconds(type:string,from:number,to:number,configuredRate:number,model:PerformanceModel='euroscope'){
    let seconds=0
    for(let altitude=from;altitude>to;){const step=Math.min(500,altitude-to),profile=performanceAt(type,altitude-step/2,'descent',model),rate=Math.min(configuredRate,profile?.descentFpm&&profile.descentFpm>0?profile.descentFpm:configuredRate);seconds+=step/Math.max(100,rate)*60;altitude-=step}
    return seconds
}
// Controller/configured speeds take precedence over statistical WRAP means.
// Retain the existing nominal-profile cap only for the legacy provider.
export function planningTas(ias:number,altitude:number,type:string,model:PerformanceModel='euroscope'){
    const profile=performanceAt(type,altitude,'descent',model),requested=iasToTas(ias,altitude)
    if(profile?.provider!=='openap')return Math.min(requested,profile?.nominalTas??Infinity)
    return Math.min(requested,profile.vmo?iasToTas(profile.vmo,altitude):Infinity,profile.mmo?machToTas(profile.mmo,altitude):Infinity)
}
