import type {TelemetryFlight,EngineFlight,EngineConfig,RoutePrediction,Telemetry,EngineSnapshot} from './maestro-engine'
import {FEEDERS} from './maestro-engine'
import {STAR_FEEDERS,STAR_RUNWAYS,distanceNm} from './maestro-star-prediction'
import {localPosition} from './maestro-geometry'
const positioned=(p:any)=>Number.isFinite(p?.latitude)&&Number.isFinite(p?.longitude)
export interface FeederPassage {arrival:string;departure:string;ff:string;seenAt:number;line0Suppressed:boolean}
export function retainedFeederPassages(input:Telemetry,previous?:EngineSnapshot){
 const retained:Record<string,FeederPassage>={}
 if(!previous||input.source==='DEMO'||previous.source==='DEMO'||input.simulation!==previous.simulation)return retained
 for(const [callsign,p] of Object.entries(previous.feederPassages??{}))
  if(p&&p.arrival==='ESSA'&&p.ff in STAR_FEEDERS&&Number.isFinite(p.seenAt)&&input.timestamp-p.seenAt>=0&&input.timestamp-p.seenAt<=300000)retained[callsign]={...p}
 for(const f of previous.flights)
  if(f.bufferedFeederVerified&&f.passedFeeder&&f.ff in STAR_FEEDERS&&f.state!==4&&f.mode==='sequenced'&&input.timestamp-f.lastSeen>=0&&input.timestamp-f.lastSeen<=300000)
   retained[f.callsign]={arrival:f.arrival,departure:f.departure,ff:f.ff,seenAt:f.lastSeen,line0Suppressed:!!f.line0Suppressed}
 return Object.fromEntries(Object.entries(retained).sort((a,b)=>b[1].seenAt-a[1].seenAt).slice(0,500))
}
export function observedFeeder(p:TelemetryFlight,old:EngineFlight|undefined,now:number,config:EngineConfig,remembered?:FeederPassage){
 const names:string[]=FEEDERS.filter(f=>f.airport===p.arrival).flatMap(f=>[...f.fixes])
 const star=(p.star??'').toUpperCase().replace(/[^A-Z0-9]/g,'')
 const name=old?.amanRoute?.find(point=>names.includes(point.name))?.name??(old?.ff&&names.includes(old.ff)?old.ff:p.route.find(point=>names.includes(point.name))?.name??names.find(name=>star.startsWith(name))??remembered?.ff)
 const raw=p.route.find(point=>point.name===name),fix=old?.amanRoute?.find(point=>point.name===name)??raw??STAR_FEEDERS[name??'']
 let crossed=false
 if(positioned(p)&&positioned(fix)){
  const threshold=p.threshold??STAR_RUNWAYS[p.runway],a=localPosition(p as any,fix as any),b=positioned(threshold)?localPosition(threshold!,fix as any):undefined
  crossed=distanceNm(p as any,fix as any)<.8||!!b&&a.x*b.x+a.y*b.y>0&&distanceNm(p as any,threshold!)<distanceNm(fix as any,threshold!)+1
 }
 const fresh=(p.positionAgeSeconds??0)<=15
 const passed=old?.bufferedFeederVerified&&old.passedFeeder||fresh&&crossed
 const rawIndex=p.route.findIndex(point=>point.name===name),directIndex=p.direct?p.route.findIndex(point=>point.name===p.direct):-1
 const bypassed=directIndex>=0&&(rawIndex<0||directIndex>rawIndex)||!!raw&&raw.seconds<0&&!passed
 if(!passed&&(bypassed||!raw)){
  if(fresh&&positioned(p)&&positioned(fix)&&p.groundspeed>=60&&Number.isFinite(p.heading)){
   const toFix=localPosition(fix as any,p as any),h=p.heading!*Math.PI/180
   const along=toFix.x*Math.sin(h)+toFix.y*Math.cos(h),cross=Math.abs(toFix.x*Math.cos(h)-toFix.y*Math.sin(h))
   if(along>0&&cross<=.8)return {feeder:name,seconds:Math.max(0,along/p.groundspeed*3600-(p.positionAgeSeconds??0)),passed:false,available:true,source:'track'}
  }
  return {feeder:name,seconds:Math.max(0,((old?.etaFf??old?.euroscopeBaseline?.etaFf??now)-now)/1000),passed:false,available:false,source:bypassed?'bypassed':'unavailable'}
 }
 const seconds=passed?-1:raw&&raw.seconds>=0?raw.seconds:positioned(p)&&positioned(fix)&&p.groundspeed>=60?distanceNm(p as any,fix as any)/p.groundspeed*3600:Math.max(0,((old?.liveEuroscopeEtaFf??old?.euroscopeBaseline?.rawEtaFf??old?.euroscopeBaseline?.etaFf??now+(p.landingSeconds-(config.defaultFeederMinutes??15)*60)*1000)-now)/1000)
 return {feeder:name,seconds,passed:!!passed,available:true,source:passed?'passed':'route'}
}
export function arrivalRoute(p:TelemetryFlight,old:EngineFlight|undefined,passed:boolean,runwayChanged=false){
 const names:string[]=FEEDERS.filter(f=>f.airport===p.arrival).flatMap(f=>[...f.fixes])
 const start=p.route.findIndex(point=>names.includes(point.name)),end=p.route.findIndex(point=>point.name===`SA${p.runway}`)
 const points:RoutePrediction[]=old?.amanRoute?.length&&!runwayChanged?old.amanRoute.map(point=>({...point})):p.route.slice(Math.max(0,start),end>=0&&end>=start?end+1:undefined).map(point=>({...point}))
 // Retain observed passage for points shared by the replacement approach.
 const passedNames=new Set(old?.amanRoute?.slice(0,old.amanRoutePassed??0).map(point=>point.name))
 let index=runwayChanged?0:old?.amanRoutePassed??0
 if(runwayChanged)while(index<points.length&&passedNames.has(points[index].name))index++
 if(passed&&points.length&&names.includes(points[0].name))index=Math.max(index,1)
 if(positioned(p))for(let i=index;i<points.length;i++){
  const point=points[i];if(/^SA(01L|01R|08|19L|19R|26)$/.test(point.name)||point.name===p.arrival)continue
  if(positioned(point)&&distanceNm(p as any,point as any)<.8)index=Math.max(index,i+1)
 }
 return {points,index}
}
