<script setup lang="ts">
import {computed} from 'vue'
import type {EngineFlight} from '@/maestro-engine'
import {informationRoute,signedDuration,zulu} from '@/maestro-operations'
const props=defineProps<{flight:EngineFlight;now:number}>()
const points=computed(()=>informationRoute(props.flight,props.now))
const currentAcc=computed(()=>props.flight.feederEtaAvailable===false?NaN:(props.flight.staFf-props.flight.etaFf)/1000)
const initialAcc=computed(()=>props.flight.initialStaFf===undefined||props.flight.initialEtaFf===undefined?NaN:(props.flight.initialStaFf-props.flight.initialEtaFf)/1000)
</script>
<template><div class="information-scroll"><table class="information-table"><tbody>
<tr><th>{{flight.callsign}}</th><th :colspan="Math.max(1,points.length)">Route</th><th>{{flight.ff}}</th><th>Initial</th><th>Current</th><th>{{flight.runway}}</th><th>Initial</th><th>Current</th><th>Delay</th><th>Initial</th><th>Current</th></tr>
<tr><td>{{flight.departure}} {{flight.arrival}}</td><td v-for="point in points" :key="point.name">{{point.name}}</td><th>ETA-FF</th><td>{{zulu(flight.initialEtaFf)}}</td><td>{{zulu(flight.feederEtaAvailable===false?undefined:flight.etaFf)}}</td><th>ETA</th><td>{{zulu(flight.initialEta)}}</td><td>{{zulu(flight.eta)}}</td><th>Total</th><td>{{signedDuration(initialAcc)}}</td><td>{{signedDuration(currentAcc)}}</td></tr>
<tr><td>{{flight.aircraft}}/{{flight.wake}}</td><td v-for="point in points" :key="point.name">{{zulu(point.time).slice(0,5)}}</td><th>STA-FF</th><td>{{zulu(flight.initialStaFf)}}</td><td>{{zulu(flight.staFf)}}</td><th>STA</th><td>{{zulu(flight.initialSta)}}</td><td>{{zulu(flight.sta)}}</td><th>ACC</th><td>{{signedDuration(initialAcc)}}</td><td>{{signedDuration(currentAcc)}}</td></tr>
</tbody></table></div></template>
<style scoped>.information-scroll{width:max-content;overflow:visible;transform-origin:top left}.information-table{max-width:none!important;border-collapse:collapse;white-space:nowrap;font:14px Arial,sans-serif;font-variant-numeric:tabular-nums}.information-table td,.information-table th{padding:7px 9px;border:1px solid #a7b5bf;text-align:center}.information-table th{background:#91a4af;color:#12242e}.information-table td{background:#849aa6;color:#12242e}</style>
