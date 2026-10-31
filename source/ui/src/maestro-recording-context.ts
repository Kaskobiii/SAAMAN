/** Public diagnostic identity only. Never pass authentication or connection settings. */
export interface RecordingContext {
 room:string;epoch?:string;revisionGeneration?:string;revision?:number
 sequencer?:string;sequencerVersion?:string;publisher?:string;publisherVersion?:string
 role?:string;stale?:boolean;recovery?:'none'|'empty-room'|'counter-restart'|'checkpoint'|'unknown'
}
const token=(value:unknown,max:number,pattern:RegExp)=>typeof value==='string'&&value.length>0&&value.length<=max&&pattern.test(value)?value:undefined
const callsign=(value:unknown)=>token(value,32,/^[A-Z0-9][A-Z0-9_-]*$/)
const version=(value:unknown)=>token(value,64,/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/)
// Generations may contain serialized recovery metadata. Retain a stable identity,
// not its arbitrary payload, while preserving already-sanitized identities.
function generation(value:unknown){
 if(typeof value!=='string'||!value||value.length>512)return undefined
 if(/^fnv1a32:[0-9a-f]{8}$/.test(value))return value
 let hash=0x811c9dc5
 for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,0x01000193)}
 return 'fnv1a32:'+(hash>>>0).toString(16).padStart(8,'0')
}
export function sanitizeRecordingContext(value:unknown):RecordingContext|undefined {
 if(!value||typeof value!=='object')return undefined
 const input=value as Record<string,unknown>,room=token(input.room,128,/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/)
 if(!room||room.includes('://')||room.includes('//')||room.includes('..'))return undefined
 const context:RecordingContext={room},epoch=token(input.epoch,128,/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/)
 if(epoch)context.epoch=epoch
 const revisionGeneration=generation(input.revisionGeneration)
 if(revisionGeneration)context.revisionGeneration=revisionGeneration
 if(Number.isSafeInteger(input.revision)&&Number(input.revision)>=0)context.revision=Number(input.revision)
 for(const field of ['sequencer','publisher'] as const){const name=callsign(input[field]);if(name)context[field]=name}
 for(const field of ['sequencerVersion','publisherVersion'] as const){const build=version(input[field]);if(build)context[field]=build}
 if(['local','sequencer','editor','observer','supervisor','disconnected'].includes(String(input.role)))context.role=String(input.role)
 if(typeof input.stale==='boolean')context.stale=input.stale
 if(['none','empty-room','counter-restart','checkpoint','unknown'].includes(String(input.recovery)))context.recovery=input.recovery as RecordingContext['recovery']
 return context
}
export function recordingContextChanges(previous:RecordingContext|undefined,next:RecordingContext|undefined){
 if(!previous||!next)return previous===next?[]:['context']
 const fields=['room','epoch','revisionGeneration','sequencer','sequencerVersion','publisher','publisherVersion','role','stale','recovery'] as const
 const changes:string[]=fields.filter(field=>previous[field]!==next[field])
 if(previous.revision!==undefined&&next.revision!==undefined&&next.revision<previous.revision)changes.push('revision-rollback')
 return changes
}
export function recordingSource(value:unknown){return callsign(value)}
