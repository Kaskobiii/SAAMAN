export type BrowserNetwork='live'|'sweatbox1'|'sweatbox2'
export interface BrowserConnection {callsign:string;network:BrowserNetwork;backendBaseUrl:string}
export interface BrowserController {callsign:string;cid:number;facility:number;positionId?:string}
export const BROWSER_CONNECTION_KEY='saaman-browser-connection-v1'
export const BROWSER_DEFAULT_CONNECTION:BrowserConnection={callsign:'',network:'live',backendBaseUrl:'https://backend.vatiris.se'}

export function browserConnection(value:Partial<BrowserConnection>,requireCallsign=true):BrowserConnection {
 const callsign=String(value.callsign??'').trim().toUpperCase()
 if((requireCallsign||callsign)&&(!/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(callsign)||['OFFLINE','DEMO'].includes(callsign)))throw Error('Enter a callsign connected in EuroScope')
 const network=value.network??'live'
 if(!['live','sweatbox1','sweatbox2'].includes(network))throw Error('Select VATSIM live or a SweatBox network')
 let url:URL
 try{url=new URL(String(value.backendBaseUrl??BROWSER_DEFAULT_CONNECTION.backendBaseUrl).trim())}catch{throw Error('Enter the backend HTTPS address')}
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('Use an HTTPS backend address without a path or credentials')
 return {callsign,network:network as BrowserNetwork,backendBaseUrl:url.origin}
}

export function loadBrowserConnection(storage:Pick<Storage,'getItem'>):BrowserConnection {
 try{return browserConnection(JSON.parse(storage.getItem(BROWSER_CONNECTION_KEY)||'null')??{},false)}catch{return {...BROWSER_DEFAULT_CONNECTION}}
}

export function saveBrowserConnection(storage:Pick<Storage,'setItem'>,connection:BrowserConnection){
 storage.setItem(BROWSER_CONNECTION_KEY,JSON.stringify(browserConnection(connection)))
}

/** Identity and controller coverage only. A browser never supplies aircraft telemetry. */
export function createBrowserSession(connection:BrowserConnection,deps:{controllers:()=>Promise<any>;now?:()=>number;id?:()=>string}){
 const settings=browserConnection(connection),now=deps.now??Date.now,instanceId=`browser-${(deps.id??(()=>crypto.randomUUID()))()}`
 let cid:number|null=null,controllers:BrowserController[]=[],feedAt=Number.NEGATIVE_INFINITY,pending:Promise<void>|undefined,controllerChanged=false
 async function identity(){
  if(controllerChanged)throw Error('This position changed controller. Disconnect and reconnect the browser.')
  if(settings.network==='live'){
   if(now()-feedAt>=15000||now()<feedAt){
    if(!pending){
     pending=Promise.resolve().then(async()=>{
      try{
       const response=await deps.controllers()
       if(!Array.isArray(response?.controllers))throw Error('The VATSIM controller feed is unavailable')
       const fresh:BrowserController[]=response.controllers.filter((c:any)=>c&&typeof c.callsign==='string'&&Number.isSafeInteger(c.cid)&&c.cid>=1000&&Number.isFinite(c.facility)&&c.facility>0)
        .map((c:any)=>({callsign:c.callsign.trim().toUpperCase(),cid:c.cid,facility:c.facility,...(typeof c.positionId==='string'?{positionId:c.positionId}:{})}))
       const selected=fresh.find(c=>c.callsign===settings.callsign)
       if(!selected)throw Error(`${settings.callsign} is not connected as ATC on VATSIM. The feed updates every 15 seconds.`)
       if(cid!==null&&selected.cid!==cid){controllerChanged=true;throw Error('This position changed controller. Disconnect and reconnect the browser.')}
       cid=selected.cid;controllers=fresh;feedAt=now()
      }catch(error){controllers=[];feedAt=Number.NEGATIVE_INFINITY;throw error}
      finally{pending=undefined}
     })
    }
    await pending
   }
  }
  return {cid,callsign:settings.callsign,controllers:controllers.map(c=>({...c}))}
 }
 async function telemetry(){
  const selected=await identity()
  return {timestamp:now(),source:selected.callsign,connected:true,simulation:settings.network!=='live',connectionType:2,
   controllerPositionId:selected.controllers.find(c=>c.callsign===settings.callsign)?.positionId??'',controllers:selected.controllers,flights:[]}
 }
 async function hostInfo(){
  const selected=await identity()
  return {browser:true,shared:true,authProvider:'vatiris-callsign',backendBaseUrl:settings.backendBaseUrl,controllerCid:selected.cid??0,instanceId,view:'aman',test:false,
   relay:{network:settings.network,session:'browser',channel:'saaman'}}
 }
 return {settings,instanceId,identity,telemetry,hostInfo}
}
