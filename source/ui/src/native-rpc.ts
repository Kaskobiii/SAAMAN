type Result={id:number;ok:boolean;result?:any;error?:string;status?:number}
let serial=0
const pending=new Map<number,{resolve:(data:any)=>void;reject:(error:any)=>void;timer:ReturnType<typeof setTimeout>}>()
const webview=(window as any).chrome?.webview
webview?.addEventListener('message',(event:{data:Result})=>{
    if((event.data as any).event==='pulse'){window.dispatchEvent(new Event('saaman-pulse'));return}
    if((event.data as any).event==='aircraft-selection'){window.dispatchEvent(new CustomEvent('saaman-aircraft-selection',{detail:{callsign:(event.data as any).callsign}}));return}
    if((event.data as any).event==='aircraft-hover-reset'){window.dispatchEvent(new Event('saaman-aircraft-hover-reset'));return}
    if((event.data as any).event==='coordination-ack'){window.dispatchEvent(new CustomEvent('saaman-coordination-ack',{detail:{id:(event.data as any).messageId}}));return}
    if((event.data as any).event==='floating-close'){window.dispatchEvent(new CustomEvent('saaman-floating-close',{detail:{key:(event.data as any).key}}));return}
    const message=event.data,request=pending.get(message.id);if(!request)return
    pending.delete(message.id);clearTimeout(request.timer)
    if(message.ok)request.resolve(message.result)
    else request.reject(Object.assign(new Error(message.error||'Native request failed'),{status:message.status||500}))
})
export function nativeRequest(method:string,data:any={},timeout=10000):Promise<any>{
    if(!webview)return Promise.reject(new Error('Load SAAMAN.dll in EuroScope to use this interface'))
    const id=++serial
    return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(id);reject(new Error('EuroScope did not respond'))},timeout)
        pending.set(id,{resolve,reject,timer});webview.postMessage({id,method,data})
    })
}
export async function nativeLogin(url:string,redirect:string){
    const state=crypto.randomUUID(),target=new URL(url);target.searchParams.set('state',state)
    const result=await nativeRequest('auth:open',{url:target.toString(),redirect,state},300000)
    if(result.state!==state||!result.code)throw new Error('Sign-in response was not valid')
    return result.code as string
}
