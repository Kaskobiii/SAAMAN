import type {AutomaticCorrection} from './maestro-engine'

export interface AutomaticNoticeSeenState {version:1;scopes:{scope:string;ids:string[];through?:{at:number;id:string}}[]}
export interface AutomaticNoticeFeedOptions {
 now?:()=>number
 startAt?:number
 load?:()=>unknown
 save?:(state:AutomaticNoticeSeenState)=>void
 maxAgeMs?:number
 futureSkewMs?:number
 maxBatch?:number
 maxSeenIds?:number
 maxScopes?:number
}

const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)
const text=(value:unknown,max:number):value is string=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value)
const stamp=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0
const scopeKey=(value:unknown):value is string=>text(value,512)
const idKey=(value:unknown):value is string=>text(value,200)

export function isAutomaticCorrection(value:unknown):value is AutomaticCorrection {
 if(!object(value))return false
 return idKey(value.id)&&typeof value.callsign==='string'&&/^[A-Z0-9_-]{2,16}$/.test(value.callsign)&&stamp(value.at)&&
  (value.kind==='route-timing'||value.kind==='speed-flag')&&text(value.detail,1000)
}

const bounded=(value:number|undefined,fallback:number,min:number,max:number)=>typeof value==='number'&&Number.isFinite(value)?Math.max(min,Math.min(max,Math.floor(value))):fallback
const lexical=(a:string,b:string)=>a<b?-1:a>b?1:0
const chronological=(a:AutomaticCorrection,b:AutomaticCorrection)=>a.at-b.at||lexical(a.id,b.id)||lexical(a.callsign,b.callsign)||lexical(a.kind,b.kind)||lexical(a.detail,b.detail)

/** Local, nonmodal notices. History belongs to supervision, not this feed.
 * The first room is baselined at creation; entering another room/epoch starts
 * a new baseline. Pass the same scope for reconnects and a new epoch on reset.
 * Persist only bounded seen IDs, never flight details or controller data.
 */
export function createAutomaticNoticeFeed(options:AutomaticNoticeFeedOptions={}){
 const now=options.now??Date.now
 const startedAt=stamp(options.startAt)?options.startAt:now()
 const maxAge=bounded(options.maxAgeMs,60000,0,3600000),futureSkew=bounded(options.futureSkewMs,5000,0,60000)
 const maxBatch=bounded(options.maxBatch,3,1,10),maxSeen=bounded(options.maxSeenIds,256,1,2048),maxScopes=bounded(options.maxScopes,8,1,16)
 type ScopeState={ids:Set<string>;baseline:number;through?:{at:number;id:string}}
 const scopes=new Map<string,ScopeState>()
 let activeScope:string|undefined
 const trimIds=(ids:Set<string>)=>{while(ids.size>maxSeen)ids.delete(ids.values().next().value!)}
 const trimScopes=()=>{while(scopes.size>maxScopes)scopes.delete(scopes.keys().next().value!)}
 try{
  const stored=options.load?.()
  if(object(stored)&&stored.version===1&&Array.isArray(stored.scopes))for(const row of stored.scopes.slice(-maxScopes)){
   if(!object(row)||!scopeKey(row.scope)||!Array.isArray(row.ids))continue
   const ids=new Set<string>();for(const id of row.ids.slice(-maxSeen))if(idKey(id))ids.add(id)
   const through=object(row.through)&&stamp(row.through.at)&&row.through.at<=now()+futureSkew&&idKey(row.through.id)?{at:row.through.at,id:row.through.id}:undefined
   scopes.delete(row.scope);scopes.set(row.scope,{ids,baseline:0,through})
  }
 }catch{/* Storage is optional; in-memory deduplication still works. */}
 const save=()=>{
  try{options.save?.({version:1,scopes:[...scopes].map(([scope,state])=>({scope,ids:[...state.ids],...(state.through?{through:{...state.through}}:{})}))})}catch{/* Blocked or full storage must not interrupt controlling. */}
 }
 return {
  ingest(snapshot:unknown,scope:string):AutomaticCorrection[]{
   if(!scopeKey(scope)||!object(snapshot)||!text(snapshot.source,120)||!stamp(snapshot.timestamp))return []
   const time=now();if(!stamp(time))return []
   let state=scopes.get(scope),changed=false
   if(!state){state={ids:new Set<string>(),baseline:0};scopes.set(scope,state);changed=true}
   if(activeScope!==scope){
    state.baseline=activeScope===undefined&&stamp(startedAt)?startedAt:time
    activeScope=scope;scopes.delete(scope);scopes.set(scope,state);trimScopes();changed=true
   }
   const fresh:AutomaticCorrection[]=[]
   const corrections=Array.isArray(snapshot.automaticCorrections)?snapshot.automaticCorrections.slice(-1024).filter(isAutomaticCorrection).sort(chronological):[]
   for(const correction of corrections){
    // Do not consume future-dated events: a subsequent correctly timed poll
    // may make them eligible. Expired/history events are consumed silently.
    if(correction.at>time+futureSkew||correction.at>snapshot.timestamp+futureSkew||state.ids.has(correction.id)||state.through&&(correction.at<state.through.at||correction.at===state.through.at&&lexical(correction.id,state.through.id)<=0))continue
    state.ids.add(correction.id);trimIds(state.ids);changed=true
    state.through={at:correction.at,id:correction.id}
    if(correction.at<state.baseline||correction.at<time-maxAge)continue
    fresh.push({id:correction.id,callsign:correction.callsign,at:correction.at,kind:correction.kind,detail:correction.detail})
   }
   if(changed)save()
   // Suppress an old backlog rather than releasing it over later polls.
   return fresh.slice(-maxBatch)
  }
 }
}
