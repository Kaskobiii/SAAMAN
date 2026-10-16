import {createApp} from 'vue'
import {createPinia} from 'pinia'
import {installNativeTransport} from './native-transport'
import './style.css'
import {nativeRequest} from './native-rpc'
try{
    const info=await installNativeTransport()
    const {default:App}=await import('./NativeApp.vue')
    createApp(App).use(createPinia()).mount('#app')
    if(info.test&&info.view==='aman'){for(let attempt=0;attempt<40&&!document.querySelector('[data-callsign="SAAMAN_TEST"]');attempt++)await new Promise(resolve=>setTimeout(resolve,250))}
    await nativeRequest('host:ready')
}catch(error:any){document.getElementById('app')!.textContent=`SAAMAN could not start: ${error.message}`;void nativeRequest('host:ready').catch(()=>{})}
