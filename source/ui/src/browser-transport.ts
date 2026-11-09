import {browserConnection,createBrowserSession,type BrowserConnection} from './browser-session'
import {configureNativeRequestHandler} from './native-rpc'
import {installNativeTransport} from './native-transport'

export interface BrowserCoordination {message:{id:string;message:string;senderCallsign?:string;at:number}|null;enabled?:boolean;busy?:boolean;status?:string}
let installed=false

async function controllerFeed(){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000)
 try{
  const response=await fetch('https://data.vatsim.net/v3/vatsim-data.json',{signal:controller.signal,cache:'no-cache'})
  if(!response.ok)throw Error('The VATSIM controller feed is unavailable')
  return await response.json()
 }catch(error:any){if(error?.name==='AbortError')throw Error('The VATSIM controller feed did not respond');throw error}
 finally{clearTimeout(timer)}
}

export async function installBrowserTransport(connection:BrowserConnection,onCoordination:(value:BrowserCoordination)=>void){
 if(installed)throw Object.assign(new Error('Reload the browser to change its connection'),{reloadRequired:true})
 const session=createBrowserSession(browserConnection(connection),{controllers:controllerFeed})
 await session.identity()
 configureNativeRequestHandler(async(method,data)=>{
  if(method==='host:info')return session.hostInfo()
  if(method==='telemetry:get')return session.telemetry()
  if(method==='host:coordination'){onCoordination(data as BrowserCoordination);return {ok:true}}
  if(method==='host:aircraft-selection')return {callsign:''}
  if(method==='host:aircraft-hover')return false
  if(method==='host:ready'||method==='host:floating-hide')return {ok:true}
  throw Error('This function requires EuroScope. The browser only edits the shared sequence.')
 })
 installed=true
 try{await installNativeTransport()}
 catch(error:any){throw Object.assign(error,{reloadRequired:true})}
 return session
}
