<script setup lang="ts">
import {ref,computed} from 'vue'
import {validateConfig,type EngineConfig} from '@/maestro-engine'
import {sharedSettings} from '@/maestro-settings'
const props=defineProps<{config:EngineConfig;revision:number;busy:boolean}>()
const emit=defineEmits<{save:[revision:number,settings:Record<string,unknown>]}>()
const draft=ref<EngineConfig|null>(null),base=ref(-1),error=ref('')
const fields:{group:string;key:keyof EngineConfig;label:string;min:number;max:number}[]=[
    {group:'Surface wind',key:'surfaceWindDirection',label:'Direction (degrees)',min:0,max:360},
    {group:'Surface wind',key:'surfaceWindSpeed',label:'Speed (kt)',min:0,max:100},
    {group:'Sequence settings',key:'unstableSeconds',label:'Initial observation (seconds)',min:0,max:3600},
    {group:'Sequence settings',key:'frozenMinutes',label:'Frozen: minutes to landing',min:0,max:30},
    {group:'Sequence settings',key:'minimumNewSeconds',label:'Missed approach recovery minimum (seconds)',min:0,max:3600},
    {group:'Landing time',key:'euroscopeBufferMinutes',label:'Normal feeder / fallback allowance (minutes)',min:0,max:15},
    {group:'Landing time',key:'euroscopeHighSpeedBufferMinutes',label:'Extra landing correction limit (minutes)',min:0,max:15},
    {group:'Landing time',key:'euroscopeSuperstableBufferMinutes',label:'Near feeder / fallback allowance (minutes)',min:0,max:15},
    {group:'Sequence settings',key:'landingSpeedKnots',label:'Runway spacing reference speed (kt)',min:50,max:200}]
const groups=['Surface wind','Sequence settings','Landing time']
const labels={type:'Aircraft type (always shown)',feeder:'Feeder fix',totalDelay:'Total delay',currentDelay:'Current instruction (always shown)',runway:'Runway'}
const panels={winds:'Winds',rates:'Actual rates',tracks:'TMA / TOT'}
const current=computed(()=>validateConfig(props.config))
function edit(){draft.value=structuredClone(JSON.parse(JSON.stringify(current.value)));base.value=props.revision;error.value=''}
function number(key:keyof EngineConfig,event:Event){if(draft.value)(draft.value as any)[key]=Number((event.target as HTMLInputElement).value)}
function save(){try{if(draft.value)emit('save',base.value,sharedSettings(draft.value))}catch(e:any){error.value=e.message}}
defineExpose({saved:()=>{draft.value=null;error.value=''}})
</script>
<template><section class="settings"><h2>Shared supervisory settings</h2><p>Saved settings apply to every controller. Runway configuration, rates and sequencing remain in the normal AMAN.</p>
<button v-if="!draft" @click="edit">Edit shared settings</button>
<template v-if="draft"><p v-if="base!==revision" class="warning">The shared plan changed while you were editing. Reload settings before saving.</p>
<div class="groups"><fieldset v-for="group in groups" :key="group"><legend>{{group}}</legend>
<label v-if="group==='Surface wind'"><input type="checkbox" v-model="draft.surfaceWindAuto">Auto wind from EuroScope METAR</label>
<label v-for="field in fields.filter(f=>f.group===group)" :key="field.key">{{field.label}}<input type="number" :value="draft[field.key]" @input="number(field.key,$event)" :min="field.min" :max="field.max" :step="field.key==='frozenMinutes'||field.key.startsWith('euroscope')?0.5:1"></label>
<p v-if="group==='Sequence settings'">Stable: 15 minutes · Superstable: 4 minutes (fixed)</p>
<p v-if="group==='Landing time'">ETA updates live; existing slots change on Recompute.</p></fieldset><fieldset v-if="draft.displayPreferences"><legend>Shared labels and panels</legend><label v-for="(name,key) in labels" :key="key"><input type="checkbox" v-model="draft.displayPreferences.labels[key]" :disabled="key==='type'||key==='currentDelay'">{{name}}</label><label v-for="(name,key) in panels" :key="key"><input type="checkbox" v-model="draft.displayPreferences.panels[key]">{{name}}</label></fieldset></div>
<p v-if="error" class="warning">{{error}}</p><button @click="save" :disabled="busy||base!==revision">Save for everyone</button><button @click="edit" :disabled="busy">Reload settings</button><button @click="draft=null" :disabled="busy">Cancel</button>
</template><p v-else>Wind {{current.surfaceWindAuto?'automatic':`${current.surfaceWindDirection}° / ${current.surfaceWindSpeed} kt`}} · Frozen {{current.frozenMinutes}} min · Feeder allowances {{current.euroscopeBufferMinutes}} / {{Math.min(current.euroscopeBufferMinutes??2,current.euroscopeSuperstableBufferMinutes??1)}} min · Extra landing correction limit {{current.euroscopeHighSpeedBufferMinutes??6}} min</p>
</section></template>
<style scoped>.settings{padding:16px;background:#5b6b75;color:#fff;font:14px Arial,sans-serif}.settings h2{font-size:18px}.groups{display:flex;flex-wrap:wrap;gap:16px}fieldset{flex:1;min-width:220px;border:1px solid #9bafb9}label{display:flex;gap:12px;align-items:center;justify-content:space-between;margin:9px 0}input[type=number]{width:85px}input,select,button{font:inherit;padding:5px;border-radius:5px;border:1px solid #adbfc9}button{margin:6px 8px 0 0;cursor:pointer}.warning{color:#ffdf6a}button:disabled{opacity:.5}</style>
