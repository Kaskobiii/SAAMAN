export interface AircraftPhaseReference {
 mach?:number;descentIas?:number;approachIas?:number;minimumCleanIas?:number;landingIas?:number
 initialDescentToFeet?:number;descentToFeet?:number
 highDescentFpm?:number;descentFpm?:number;approachFpm?:number;source:string
}
export type PhaseReferences=Record<string,AircraftPhaseReference>
// Fail closed on damaged data. Unknown fields never become executable inputs.
export function bundledPhaseReferences(dataset:any):PhaseReferences {
 const result:PhaseReferences=Object.create(null)
 if(dataset?.schema!=='saaman-phase-profiles-1'||!dataset.profiles||typeof dataset.profiles!=='object')return result
 for(const [icao,p] of Object.entries(dataset.profiles).slice(0,1000) as [string,any][]){
  if(!/^[A-Z0-9]{1,4}$/.test(icao)||!p||typeof p!=='object')continue
  const entry:AircraftPhaseReference={source:`https://learningzone.eurocontrol.int/ilp/customs/ATCPFDB/details.aspx?ICAO=${icao}`}
  for(const key of ['mach','descentIas','approachIas','minimumCleanIas','landingIas','initialDescentToFeet','descentToFeet'] as const){
   const value=p[key],limit=key==='mach'?5:key.endsWith('Feet')?60001:1500
   if(Number.isFinite(value)&&value>0&&value<limit)entry[key]=value
  }
  if(entry.approachIas&&entry.landingIas)result[icao]=Object.freeze(entry)
 }
 return Object.freeze(result)
}
// Import the locally extracted speed-only dataset without treating missing or
// implausibly labelled values as valid performance. No unit guessing occurs.
export function phaseReferenceLookup(dataset:any):PhaseReferences {
 if(dataset?.schema!=='saaman-descent-performance-1'||!dataset.aircraft||typeof dataset.aircraft!=='object')throw Error('Unsupported phase-reference dataset')
 const result:PhaseReferences=Object.create(null)
 const speed=(v:any,unit:string)=>v?.status==='reported'&&v.unit===unit&&Number.isFinite(v.value)&&v.value>0&&v.value<(unit==='Mach'?5:1500)?v.value:undefined
 const endpoint=(v:any)=>v?.meaning==='to'&&Number.isFinite(v.value)&&v.value>0?
  v.unit==='FL'&&v.value<=600?v.value*100:v.unit==='ft'&&v.value<=60000?v.value:undefined:undefined
 for(const [icao,entry] of Object.entries(dataset.aircraft) as [string,any][]){
  if(!/^[A-Z0-9]{1,4}$/.test(icao)||entry?.icao!==icao||!entry.phases)continue
  const p=entry.phases
  result[icao]={mach:speed(p.initialDescent?.speed,'Mach'),descentIas:speed(p.descent?.speed,'kt IAS'),
   approachIas:speed(p.approach?.speed,'kt IAS'),minimumCleanIas:speed(p.approach?.minimumCleanSpeed,'kt IAS'),landingIas:speed(p.landing?.speed,'kt IAS'),
   initialDescentToFeet:endpoint(p.initialDescent?.altitude),descentToFeet:endpoint(p.descent?.altitude),source:entry.sourceUrl??'Local phase reference'}
 }
 return result
}
