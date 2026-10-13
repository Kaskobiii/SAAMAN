export const COORDINATION_MESSAGES=[
 'Update in progress for ESSA','Update finished','Snow removal ESSA',
 'CAT I Conditions ESSA','CAT II Conditions ESSA','CAT III Conditions ESSA',
 'New Approach Times','Speed 230 kts for all arrivals to ESSA',
 'Speed 250 kts for all arrivals to ESSA','Normal speed for all arrivals to ESSA',
] as const
// Keep instance identity separate from the login callsign shown to controllers.
export interface CoordinationMessage {id:string;message:string;sender:string;senderCallsign?:string;at:number;acknowledgedBy:string[]}
export function validateCoordinations(value:unknown):CoordinationMessage[]{
 if(value===undefined)return []
 if(!Array.isArray(value)||value.length>100)throw Error('Invalid coordination history')
 const ids=new Set<string>()
 return value.map(m=>{
  if(!m||typeof m.id!=='string'||m.id.length>100||ids.has(m.id)||!COORDINATION_MESSAGES.includes(m.message)||typeof m.sender!=='string'||m.sender.length>100||!Number.isFinite(m.at)||m.at<0||!Array.isArray(m.acknowledgedBy)||m.acknowledgedBy.length>500||m.acknowledgedBy.some((v:any)=>typeof v!=='string'||v.length>100))throw Error('Invalid coordination message')
  if(m.senderCallsign!==undefined&&(typeof m.senderCallsign!=='string'||!/^([A-Z0-9_-]{1,32})$/.test(m.senderCallsign)))throw Error('Invalid coordination sender callsign')
  ids.add(m.id);return {...m,acknowledgedBy:[...new Set<string>(m.acknowledgedBy)]}
 })
}
export function mergeCoordinationChanges(before:unknown,after:unknown,current:unknown){
 const prior=new Map(validateCoordinations(before).map(m=>[m.id,m])),merged=validateCoordinations(current)
 for(const proposed of validateCoordinations(after)){
  const old=prior.get(proposed.id),live=merged.find(m=>m.id===proposed.id)
  if(old&&(!live||old.message!==proposed.message||old.sender!==proposed.sender||old.senderCallsign!==proposed.senderCallsign||old.at!==proposed.at))throw Error('Coordination message changed; reload and retry')
  if(live){
   if(live.message!==proposed.message||live.sender!==proposed.sender||live.senderCallsign!==proposed.senderCallsign||live.at!==proposed.at)throw Error('Conflicting coordination message ID')
   const newAcks=proposed.acknowledgedBy.filter(id=>!old?.acknowledgedBy.includes(id))
   live.acknowledgedBy=[...new Set([...live.acknowledgedBy,...newAcks])]
  }else if(!old)merged.push(proposed)
 }
 return merged.slice(-100)
}
