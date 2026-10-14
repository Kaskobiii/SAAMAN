import type {TelemetryFlight,EngineFlight,EngineConfig,RoutePrediction} from './maestro-engine'
import {FEEDERS} from './maestro-engine'
import {STAR_FEEDERS,STAR_RUNWAYS,distanceNm} from './maestro-star-prediction'
import {localPosition} from './maestro-geometry'
const positioned=(p:any)=>Number.isFinite(p?.latitude)&&Number.isFinite(p?.longitude)
export function observedFeeder(p:TelemetryFlight,old:EngineFlight|undefined,now:number,config:EngineConfig){
 const names:string[]=FEEDERS.filter(f=>f.airport===p.arrival).flatMap(f=>[...f.fixes])
 const name=old?.amanRoute?.find(point=>names.includes(point.name))?.name??(old?.ff&&names.includes(old.ff)?old.ff:p.route.find(point=>names.includes(point.name))?.name)
 const raw=p.route.find(point=>point.name===name),fix=old?.amanRoute?.find(point=>point.name===name)??raw??STAR_FEEDERS[name??'']
 let crossed=false
 if(positioned(p)&&positioned(fix)){
  const threshold=p.threshold??STAR_RUNWAYS[p.runway],a=localPosition(p as any,fix as any),b=positioned(threshold)?localPosition(threshold!,fix as any):undefined
  crossed=distanceNm(p as any,fix as any)<.8||!!b&&a.x*b.x+a.y*b.y>0&&distanceNm(p as any,threshold!)<distanceNm(fix as any,threshold!)+1
 }
 const passed=old?.bufferedFeederVerified&&old.passedFeeder||crossed
 const seconds=passed?-1:raw&&raw.seconds>=0?raw.seconds:positioned(p)&&positioned(fix)&&p.groundspeed>=60?distanceNm(p as any,fix as any)/p.groundspeed*3600:Math.max(0,((old?.liveEuroscopeEtaFf??old?.euroscopeBaseline?.rawEtaFf??old?.euroscopeBaseline?.etaFf??now+(p.landingSeconds-(config.defaultFeederMinutes??15)*60)*1000)-now)/1000)
 return {feeder:name,seconds,passed:!!passed}
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
