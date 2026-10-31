import type {RecordingContext} from './maestro-recording'
const callsign=(value:unknown)=>typeof value==='string'&&/^[A-Z0-9_-]{1,20}$/.test(value)?value:undefined
const version=(value:unknown)=>typeof value==='string'&&/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(value)&&value.length<=64?value:undefined
const identity=(value:unknown,max=128)=>typeof value==='string'&&value.length>0&&value.length<=max?value:undefined
const roomId=(value:unknown)=>typeof value==='string'&&value.length<=128&&/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+){1,4}$/.test(value)?value:undefined
/** Publication identity is distinct from the last server-confirmed election. */
export function sharedRecordingContext(room:string,data:any):RecordingContext {
 const authority=data?.authority??{}
 const recovery=authority.recovery??data?.checkpointRecovery?.kind
 return {room:roomId(authority.room)??roomId(room)??'unknown/ESSA',
  epoch:identity(data?.epoch),revisionGeneration:identity(data?.revisionGeneration??data?.epoch,512),
  revision:Number.isSafeInteger(data?.revision)&&data.revision>=0?data.revision:undefined,
  sequencer:callsign(authority.sequencer??data?.sequencer),sequencerVersion:version(authority.sequencerVersion??data?.sequencerVersion),
  publisher:callsign(authority.publisher),publisherVersion:version(authority.publisherVersion),
  role:['sequencer','editor','observer','supervisor','disconnected'].includes(data?.role??data?.relayRole)?data.role??data.relayRole:undefined,
  stale:data?.stale===true,recovery:recovery==='legacy-empty-room'||recovery==='empty-room'?'empty-room':
   recovery==='legacy-restored-publication'||recovery==='counter-restart'?'counter-restart':recovery==='checkpoint'?'checkpoint':'none'}
}
export interface SharedRevision {epoch:string;generation:string;revision:number}
/** A counter restart is accepted once; old replies in that generation stay rejected. */
export function nextSharedRevision(current:SharedRevision,data:any):SharedRevision|undefined {
 if(!Number.isSafeInteger(data?.revision)||data.revision<0)return
 const epoch=typeof data.epoch==='string'?data.epoch:current.epoch
 const generation=typeof data.revisionGeneration==='string'?data.revisionGeneration:
  typeof data.recordingContext?.revisionGeneration==='string'?data.recordingContext.revisionGeneration:epoch===current.epoch?current.generation||epoch:epoch
 if(epoch===current.epoch&&generation===current.generation&&data.revision<current.revision)return
 return {epoch,generation,revision:data.revision}
}
