import {arrivalTrajectory,feederTrajectory} from './maestro-trajectory'
export {iasToTas} from './maestro-aircraft-performance'
import data from './data/essa-star-distances.json'
import {localPosition,headingDifference,bearingBetween,type GeoPoint,type RunwayGeometry} from './maestro-geometry'
import type {TelemetryFlight,EngineConfig,EngineFlight} from './maestro-engine'
export interface StarProfile {id:string;runway:string;feeder:string;procedure:string;kind:string;shortest:number|null;ese:number|null;vectors:number|null;sourceRange:string}
export const STAR_PROFILES=data.profiles as StarProfile[]
export const STAR_SOURCE=data.source
export const STAR_FEEDERS=data.feeders as Record<string,GeoPoint>
export const STAR_RUNWAYS=data.runways as Record<string,RunwayGeometry>
const navigation=data.navigation as Record<string,GeoPoint>
const rad=(v:number)=>v*Math.PI/180
const valid=(p:any):p is GeoPoint=>Number.isFinite(p?.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p?.longitude)&&Math.abs(p.longitude)<=180
export function distanceNm(a:GeoPoint,b:GeoPoint){
    const dlat=rad(b.latitude-a.latitude),dlon=rad(b.longitude-a.longitude)
    const h=Math.sin(dlat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dlon/2)**2
    return 3440.065*2*Math.asin(Math.sqrt(Math.min(1,h)))
}
export function canonicalFeeder(point:{name:string;latitude?:number;longitude?:number}){
    if(point.name in STAR_FEEDERS)return point.name
    return valid(point)?Object.keys(STAR_FEEDERS).find(ff=>distanceNm(point,STAR_FEEDERS[ff])<.05):undefined
}
export function preFeederSeconds(distance:number,p:TelemetryFlight,config:EngineConfig){
    if(distance<=0)return 0
    return feederTrajectory(distance,p,config).seconds
}

export function starTravelSeconds(distance:number,altitude:number,heading:number,config:EngineConfig,assignedSpeed=0,wake='M',aircraft=''){
    if(distance<=0)return 0
    return arrivalTrajectory({distanceNm:distance,altitudeFeet:altitude,heading,assignedSpeed,wake,aircraft},config).seconds
}

type Point=GeoPoint&{name:string}
function cumulative(points:Point[]){const result=[0];for(let i=1;i<points.length;i++)result.push(result[i-1]+distanceNm(points[i-1],points[i]));return result}
function locate(points:Point[],position:GeoPoint){
    let best={index:0,t:0,distance:Infinity}
    for(let i=0;i<points.length-1;i++){
        const a=localPosition(position,points[i]),b=localPosition(points[i+1],points[i]),length=b.x*b.x+b.y*b.y
        if(length<1e-10)continue
        const t=Math.max(0,Math.min(1,(a.x*b.x+a.y*b.y)/length)),d=Math.hypot(a.x-b.x*t,a.y-b.y*t)
        if(d<best.distance)best={index:i,t,distance:d}
    }
    return best
}
export function matchStarProfile(p:TelemetryFlight,old?:EngineFlight){
    if(p.arrivalProfile)return STAR_PROFILES.find(row=>row.id===p.arrivalProfile&&row.runway===p.runway)
    const normalized=(p.star??'').toUpperCase().replace(/[^A-Z0-9]/g,'')
    const feeder=Object.keys(STAR_FEEDERS).find(ff=>normalized.startsWith(ff))??p.route.map(canonicalFeeder).find(Boolean)??(old?.passedFeeder?old.ff:undefined)
    const candidates=STAR_PROFILES.filter(row=>row.runway===p.runway&&row.feeder===feeder)
    return candidates.find(row=>row.kind==='star'&&row.procedure.replace(/[^A-Z0-9]/g,'')===normalized)??candidates.find(row=>row.kind==='star')
}
export function starPrediction(p:TelemetryFlight,config:EngineConfig,old?:EngineFlight){
    const profile=matchStarProfile(p,old),threshold=p.threshold??STAR_RUNWAYS[p.runway]
    if(!profile)return {seconds:0,error:'No workbook arrival profile matches the feeder and runway; select Arrival route'}
    if(!valid(p)||!valid(threshold))return {seconds:0,error:'No fresh aircraft position or runway threshold for STAR prediction'}
    if((p.positionAgeSeconds??0)>15)return {seconds:0,error:'Aircraft position is stale'}
    if(p.groundspeed<10&&p.altitude>350)return {seconds:0,error:'Awaiting usable airborne groundspeed'}
    const method=profile.kind==='rnp'?'shortest':config.starDistanceMethod??'vectors'
    const total=profile[method]
    if(!Number.isFinite(total)||total!<=0)return {seconds:0,error:'The selected workbook distance is unavailable'}
    const feeder=p.route.find(point=>canonicalFeeder(point)===profile.feeder&&valid(point))??STAR_FEEDERS[profile.feeder]
    if(!valid(feeder))return {seconds:0,error:'Feeder coordinates are unavailable'}
    const route=p.route.filter(valid).filter(point=>{
        const runwayPoint=point.name.match(/^(?:CI|FI|SA)(01L|01R|08|19L|19R|26)$/)
        return !runwayPoint||runwayPoint[1]===p.runway
    }).map(point=>({...point,name:canonicalFeeder(point)??point.name})) as Point[]
    let ffIndex=route.findIndex(point=>point.name===profile.feeder)
    const namedThreshold=route.findIndex(point=>point.name===`SA${p.runway}`)
    let star=ffIndex>=0?route.slice(ffIndex,namedThreshold>ffIndex?namedThreshold+1:undefined).filter(point=>point.name!==p.arrival):[]
    if(profile.kind==='rnp'){
        const name=profile.procedure.split(' ')[0],iaf=route.find(point=>point.name===name)??(navigation[name]?{...navigation[name],name}:undefined)
        if(!iaf)return {seconds:0,error:'The selected RNP approach has no IAF geometry'}
        star=[{...feeder,name:profile.feeder},iaf,{...threshold,name:`SA${p.runway}`}]
    }
    if(star.length<2)star=[{...feeder,name:profile.feeder},{...threshold,name:`SA${p.runway}`}]
    if(distanceNm(star.at(-1)!,threshold)>.1)star.push({...threshold,name:`SA${p.runway}`})
    const lengths=cumulative(star),full=lengths.at(-1)!
    if(full<.1)return {seconds:0,error:'STAR geometry has no usable length'}
    const checkpoints=[{at:0,remaining:total!},{at:full,remaining:0}]
    if(profile.kind==='rnp'&&star.length===3){
        const remaining=total!-lengths[1]
        if(remaining>0)checkpoints.splice(1,0,{at:lengths[1],remaining})
    }else{
        const anchors=data.trajectories.filter(row=>row.runway===p.runway&&row.method===method&&row.remainingNm<total!).map(row=>({...row,index:star.findIndex(point=>point.name===row.fix)})).filter(row=>row.index>0&&row.index<star.length-1).sort((a,b)=>b.index-a.index)
        if(anchors[0])checkpoints.splice(1,0,{at:lengths[anchors[0].index],remaining:anchors[0].remainingNm})
    }
    const remainingAt=(at:number)=>{
        const i=checkpoints.findIndex((point,index)=>index>0&&point.at>=at),upper=checkpoints[i<0?checkpoints.length-1:i],lower=checkpoints[Math.max(0,(i<0?checkpoints.length-1:i)-1)]
        return Math.max(0,lower.remaining+(upper.remaining-lower.remaining)*Math.min(1,Math.max(0,(at-lower.at)/Math.max(1e-9,upper.at-lower.at))))
    }
    const starLeg=locate(star,p),whole=route.length>1?locate(route,p):undefined
    // EuroScope retains the direct-to name after the aircraft has passed it.
    // Do not route a continuing arrival back through that consumed clearance.
    // A deliberate turn back toward the fix remains an active direct.
    const directRouteIndex=p.direct?p.route.findIndex(point=>point.name===p.direct&&valid(point)):-1
    const directPoint=directRouteIndex>=0?p.route[directRouteIndex]:undefined
    const followingRoute=directRouteIndex>=0&&(p.calculatedRouteIndex??-1)>directRouteIndex
    const returningToDirect=directPoint&&Number.isFinite(p.heading)&&headingDifference(p.heading!,bearingBetween(p,directPoint as GeoPoint))<=25
    const consumedDirect=followingRoute&&!returningToDirect
    const directIndex=p.direct&&!consumedDirect?star.findIndex(point=>point.name===p.direct):-1
    const directBeforeIndex=p.direct&&!consumedDirect&&ffIndex>=0?route.findIndex(point=>point.name===p.direct):-1
    const vector=localPosition(p,feeder),towards=localPosition(threshold,feeder)
    const oldPassed=!!old?.passedFeeder&&old.distanceProfile?.id===profile.id
    const forward=vector.x*towards.x+vector.y*towards.y>0
    // A route beginning at the feeder has index zero even when the aircraft
    // is still upstream. Projection onto the first leg is not a crossing.
    let passed=oldPassed||distanceNm(p,feeder)<=.1||(ffIndex>=0&&whole?
        whole.index>ffIndex||whole.index===ffIndex&&whole.t>.001&&forward:
        forward&&distanceNm(p,threshold)<distanceNm(feeder,threshold))
    let before=0,remaining=total!,shortcut=false
    if(!passed){
        if(whole&&ffIndex>whole.index){
            before=distanceNm(p,route[whole.index+1]);for(let i=whole.index+1;i<ffIndex;i++)before+=distanceNm(route[i],route[i+1])
            if(directBeforeIndex>whole.index&&directBeforeIndex<=ffIndex){before=distanceNm(p,route[directBeforeIndex]);for(let i=directBeforeIndex;i<ffIndex;i++)before+=distanceNm(route[i],route[i+1]);shortcut=true}
        }else before=distanceNm(p,feeder)
    }
    if(directIndex>0){
        const toDirect=distanceNm(p,star[directIndex]),fromFeeder=distanceNm(feeder,star[directIndex])
        before=oldPassed?0:Math.max(0,toDirect-fromFeeder);passed=before<=.1
        remaining=(passed?toDirect:Math.min(toDirect,fromFeeder))+remainingAt(lengths[directIndex]);shortcut=true
    }else if(passed){
        const next=starLeg.index+1,ratio=(remainingAt(lengths[starLeg.index])-remainingAt(lengths[next]))/Math.max(.01,lengths[next]-lengths[starLeg.index])
        remaining=distanceNm(p,star[next])*ratio+remainingAt(lengths[next])
    }
    const feederFlight=feederTrajectory(before,p,config),preSeconds=feederFlight.seconds
    const entryAltitude=passed?p.altitude:feederFlight.altitudeFeet
    const heading=passed?bearingBetween(p,star[Math.min(starLeg.index+1,star.length-1)]):bearingBetween(feeder,star[1])
    const trajectory=arrivalTrajectory({distanceNm:remaining,altitudeFeet:entryAltitude,heading,assignedSpeed:p.assignedSpeed,wake:p.wake,aircraft:p.aircraft,initialGroundspeed:passed?p.groundspeed:feederFlight.groundspeedKnots},config)
    return {seconds:preSeconds+trajectory.seconds,trajectory,feederSeconds:passed?-1:preSeconds,passedFeeder:passed,feeder:profile.feeder,
        distanceProfile:{id:profile.id,procedure:profile.procedure,runway:p.runway,method:profile.kind==='rnp'?'rnp':method,fullNm:total!,remainingNm:remaining,beforeFeederNm:before,sourceRange:profile.sourceRange,shortcut,workbookSha256:STAR_SOURCE.sha256},error:undefined}
}
