export interface AircraftPhaseReference {
 mach?:number;descentIas?:number;approachIas?:number;minimumCleanIas?:number;landingIas?:number
 initialDescentToFeet?:number;descentToFeet?:number
 highDescentFpm?:number;descentFpm?:number;approachFpm?:number;source:string
}
export type PhaseReferences=Record<string,AircraftPhaseReference>
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
