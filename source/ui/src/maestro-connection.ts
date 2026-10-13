export interface ConnectionSettings {shared:boolean;backendBaseUrl:string;authProvider:string;controllerCid?:number;relay:{network:string;session:string;channel:string}}
export function sameConnection(current:ConnectionSettings,next:ConnectionSettings){
    return current.shared===next.shared&&current.backendBaseUrl===next.backendBaseUrl&&current.authProvider===next.authProvider&&(current.controllerCid||0)===(next.controllerCid||0)&&current.relay.network===next.relay.network&&current.relay.session===next.relay.session&&current.relay.channel===next.relay.channel
}
// Save first. A persistence failure must not stop a functioning relay.
export async function saveConnectionSettings(current:ConnectionSettings,next:ConnectionSettings,key:string,actions:{persist:()=>Promise<{changed?:boolean}>;leave:()=>Promise<unknown>;reload:()=>void}){
    if(!key&&sameConnection(current,next))return false
    const result=await actions.persist()
    if(result.changed===false)return false
    await actions.leave().catch(()=>{})
    actions.reload();return true
}
