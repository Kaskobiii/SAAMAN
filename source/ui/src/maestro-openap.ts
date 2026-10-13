import data from './data/openap-profiles.json'
export const OPENAP_SOURCE=data.source
export type PerformanceModel='euroscope'|'openap'
type Variable={default:number;minimum:number;maximum:number}
type Properties={ceiling:number;vmo?:number;mmo?:number}
const knots=1/.514444,feet=1/.3048,fpm=60/.3048
const props=data.properties as Record<string,Properties>,models=data.wrap as Record<string,Record<string,Variable>>,synonyms=data.synonyms as Record<string,string>
export function openapProfile(type:string){
    const property=props[type]
    // Do not use the upstream ATR -> E190 mapping for turboprop timing.
    const proxy=/^(AT|DH8|DHC|SF|SB20)/.test(type)?undefined:synonyms[type]
    const model=models[type]?type:proxy&&models[proxy]?proxy:undefined
    return {property,model,match:model?(model===type?'exact':'proxy') as 'exact'|'proxy':undefined,variables:model?models[model]:undefined}
}
export function openapValues(type:string,altitude:number,phase:'climb'|'cruise'|'descent'){
    const profile=openapProfile(type),v=profile.variables
    if(!v||!profile.property)return undefined
    const value=(key:string)=>{if(!v[key]||!Number.isFinite(v[key].default))throw Error('Missing OpenAP field '+key);return v[key].default}
    let cas:number,mach:number,rate:number,climb:number
    const climbCross=value('cl_h_mach_const')*1000*feet,climbLow=value('cl_h_cas_const')*1000*feet
    climb=(altitude>=climbCross?value('cl_vs_avg_mach_const'):altitude>=climbLow?value('cl_vs_avg_cas_const'):value('cl_vs_avg_pre_cas'))*fpm
    const descentCross=value('de_h_mach_const')*1000*feet,descentLow=value('de_h_cas_const')*1000*feet
    const descentCas=value('de_v_cas_const')*knots,finalCas=value('fa_va_avg')*knots
    rate=Math.abs(altitude>=descentCross?value('de_vs_avg_mach_const'):altitude>=descentLow?value('de_vs_avg_cas_const'):altitude>3000?value('de_vs_avg_after_cas'):value('fa_vs_avg'))*fpm
    if(phase==='climb'){cas=(altitude<climbLow?value('ic_va_avg'):value('cl_v_cas_const'))*knots;mach=altitude>=climbCross?value('cl_v_mach_const'):0}
    else if(phase==='cruise'){cas=value('cr_v_cas_mean')*knots;mach=altitude>=climbCross?value('cr_v_mach_mean'):0}
    else {cas=finalCas+(descentCas-finalCas)*Math.max(0,Math.min(1,(altitude-3000)/Math.max(1,descentLow-3000)));mach=altitude>=descentCross?value('de_v_mach_const'):0}
    return {...profile,cas,mach,climbFpm:Math.max(100,climb),descentFpm:Math.max(100,rate),ceilingFeet:profile.property.ceiling*feet}
}
