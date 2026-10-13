import axios, { type AxiosResponse } from "axios"
import moment from "moment"
import {nativeLogin,nativeRequest} from "@/native-rpc"
import { defineStore } from "pinia"
import { computed, ref, onScopeDispose } from "vue"
import {CallsignIdentity} from '@/callsign-identity'

const clientId = import.meta.env.VITE_CLIENT_ID || "682"
const redirectUri = import.meta.env.VITE_REDIRECT_URI || "http://localhost:5173/login"
const vatsimAuthBaseUri = import.meta.env.VITE_VATSIM_AUTH_BASE_URI || "https://auth-dev.vatsim.net"
export const backendBaseUrl = (window as any).__SAAMAN_HOST__?.backendBaseUrl || import.meta.env.VITE_BACKEND_BASE_URL || "http://localhost:5172"
export const controllerKeyMode = (window as any).__SAAMAN_HOST__?.authProvider === 'keys'
export const callsignMode = (window as any).__SAAMAN_HOST__?.authProvider === 'vatiris-callsign'

export const useAuthStore = defineStore("auth", () => {
    const pending = ref(true)
    const token = ref({} as any)
    const user = ref(undefined as any)
    const loginError=ref('')
    const ready=computed(()=>callsignMode?!!user.value?.callsign:!!token.value.access_token)
    const requestHeaders=computed(()=>{const headers:Record<string,string>={};if(!callsignMode&&token.value.access_token)headers.Authorization=`Bearer ${token.value.access_token}`;return headers})
    const host=(window as any).__SAAMAN_HOST__
    const registered=callsignMode?new CallsignIdentity({network:host.relay.network,cid:host.controllerCid||undefined,now:()=>Date.now(),telemetry:()=>nativeRequest('telemetry:get'),changed:identity=>{user.value=identity},controllers:async()=> (await axios.get('https://data.vatsim.net/v3/vatsim-data.json',{timeout:10000})).data}):undefined
    let nextAttempt=0
    async function refreshRegistered(force=false){
        if(!registered||(!force&&Date.now()<nextAttempt))return
        try{await registered.refresh();loginError.value='';nextAttempt=0}
        catch(e:any){loginError.value=e.response?.data?.error||e.message;nextAttempt=Date.now()+8000}
        finally{pending.value=false}
    }

    if ((window as any).__SAAMAN_LOCAL__===true) {
        pending.value=false
    } else if (callsignMode) {
        void refreshRegistered()
        const timer=setInterval(()=>void refreshRegistered(),2000)
        const pulse=()=>void refreshRegistered()
        window.addEventListener('saaman-pulse',pulse)
        onScopeDispose(()=>{clearInterval(timer);window.removeEventListener('saaman-pulse',pulse)})
    } else if (controllerKeyMode) {
        void login().catch((e:any)=>{loginError.value=e.response?.data?.error||e.message||'Controller key authentication failed';pending.value=false})
    } else if (sessionStorage.authorizationCode) {
        axios
            .get(`${backendBaseUrl}/token?code=${sessionStorage.authorizationCode}`)
            .then((response) => {
                receiveToken(response)
            })
            .catch((error) => {
                console.error("Failed to get token from authorization code", error)
                pending.value = false
            })
    } else if (localStorage.token) {
        token.value = JSON.parse(localStorage.token)
        if (
            !localStorage.tokenTimestamp ||
            moment().isAfter(
                moment(localStorage.tokenTimestamp).add(token.value.expires_in - 600, "second"),
            )
        ) {
            console.log("Refreshing token")
            const expiredToken = JSON.parse(localStorage.token)
            axios
                .get(`${backendBaseUrl}/token?refresh_token=${expiredToken.refresh_token}`)
                .then((response) => {
                    receiveToken(response)
                })
                .catch((error) => {
                    console.error("Failed to get token from refresh token", error)
                    pending.value = false
                })
        } else {
            fetchUser()
        }
    } else {
        pending.value = false
    }

    function receiveToken(response: AxiosResponse) {
        token.value = response.data
        localStorage.token = JSON.stringify(response.data)
        localStorage.tokenTimestamp = moment().toISOString()
        delete sessionStorage.authorizationCode
        fetchUser()
    }

    function fetchUser() {
        nativeRequest('auth:user',{url:`${vatsimAuthBaseUri}/api/user`,token:token.value.access_token})
            .then(data=>({data}))
            .then((response) => {
                user.value = response.data.data
                pending.value = false
                axios
                    .post(
                        `${backendBaseUrl}/login`,
                        {},
                        {
                            headers: { Authorization: `Bearer ${token.value.access_token}` },
                            timeout: 5000,
                        },
                    )
                    .then((response) => {
                        console.log(
                            "Logged in user",
                            user.value.cid,
                            user.value.personal.name_full,
                            response.data,
                        )
                    })
                    .catch((error) => {
                        console.error("Failed to login user", error)
                    })
            })
            .catch((error) => {
                console.error("Failed to get user from token", error)
                pending.value = false
            })
    }

    async function fetchUserData(key: string) {
        const response = await axios.get(`${backendBaseUrl}/data/${key}`, {
            headers: { Authorization: `Bearer ${token.value.access_token}` },
            timeout: 5000,
        })
        return response.data
    }

    async function postUserData(key: string, data: object) {
        return axios.post(`${backendBaseUrl}/data/${key}`, data, {
            headers: { Authorization: `Bearer ${token.value.access_token}` },
            timeout: 15000,
        })
    }

    async function deleteUserData(key: string) {
        return axios.delete(`${backendBaseUrl}/data/${key}`, {
            headers: { Authorization: `Bearer ${token.value.access_token}` },
            timeout: 15000,
        })
    }

    async function deleteAllUserData() {
        return axios.delete(`${backendBaseUrl}/data`, {
            headers: { Authorization: `Bearer ${token.value.access_token}` },
            timeout: 15000,
        })
    }

    async function login() {
        if(callsignMode){await refreshRegistered(true);return}
        if(controllerKeyMode){
            pending.value=true;loginError.value='';token.value={};user.value=undefined
            try{
                const stored=await nativeRequest('key:read')
                if(!stored.key)throw new Error('Enter your controller key in MAESTRO → Operation mode')
                const response=await axios.get(`${backendBaseUrl}/auth/me`,{headers:{Authorization:`Bearer ${stored.key}`},timeout:5000})
                const cid=Number(response.data?.data?.cid)
                if(!Number.isSafeInteger(cid)||cid<10000)throw new Error('Invalid backend identity response')
                token.value={access_token:stored.key};user.value=response.data.data
            }finally{pending.value=false}
            return
        }
        const loginUrl =
            `${vatsimAuthBaseUri}/oauth/authorize` +
            `?response_type=code&client_id=${encodeURIComponent(clientId)}` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&scope=full_name%20vatsim_details%20country` +
            `&prompt=login`
        const code=await nativeLogin(loginUrl,redirectUri)
        receiveToken(await axios.get(`${backendBaseUrl}/token`,{params:{code}}))
    }

    function logout() {
        registered?.clear()
        delete sessionStorage.authorizationCode
        delete localStorage.token
        delete localStorage.tokenTimestamp
        token.value = {}
        user.value = undefined
    }
    const isSupervisor=(callsign:string,cid?:number)=>registered?.isSupervisor(callsign,cid)??Promise.resolve(false)

    return {
        pending,
        ready,
        requestHeaders,
        isSupervisor,
        token,
        user,
        loginError,
        login,
        logout,
        fetchUserData,
        postUserData,
        deleteUserData,
        deleteAllUserData,
    }
})
