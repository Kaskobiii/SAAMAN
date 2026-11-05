import type {TelemetryFlight} from './maestro-engine'
import {bearingBetween,headingDifference} from './maestro-geometry'
import {distanceNm} from './maestro-star-prediction'

const positioned=(p:any)=>Number.isFinite(p?.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p?.longitude)&&Math.abs(p.longitude)<=180
const consumedDirectWarning='Assigned direct-to is behind the current route position'
// Planning-only repair. The original telemetry and its SDK clocks remain in
// recordings. A route index alone cannot cancel a genuine return clearance.
export function planningRouteProgress(p:TelemetryFlight,clearance?:{point:string;returning?:boolean}){
 const index=p.calculatedRouteIndex,route=p.route
 if(!Number.isInteger(index)||index!<=0||index!>=route.length||!positioned(p)||(p.positionAgeSeconds??0)>15||
  !Number.isFinite(p.heading)||(p.assignedHeading??0)>0||p.topskyHoldingPoint||p.topskyMissedApproach||
  (p.star??'').toUpperCase().includes('RNP')||p.routeProblem&&p.routeProblem!==consumedDirectWarning)return undefined
 if(clearance&&(clearance.point!==p.direct||clearance.returning))return undefined
 const direct=route.findIndex(q=>q.name===p.direct),current=route[index!],end=route.findIndex(q=>q.name===`SA${p.runway}`)
 if(direct<0||direct>=index!||end<index!||!positioned(current)||!positioned(route[direct])||
  !route.slice(0,index).some(q=>q.seconds>=0)||!route.slice(index!,end+1).every(positioned))return undefined
 if(headingDifference(p.heading!,bearingBetween(p as any,route[direct] as any))<=25)return undefined
 if(distanceNm(p as any,current as any)>1&&headingDifference(p.heading!,bearingBetween(p as any,current as any))>45)return undefined
 const flight={...p,direct:'',routeProblem:p.routeProblem===consumedDirectWarning?'':p.routeProblem,
  route:route.map((q,i)=>i<index!?{...q,seconds:-1}:q)}
 return {flight,index:index!,currentSeconds:current.seconds,currentDistanceNm:distanceNm(p as any,current as any),consumedDirect:p.direct!}
}
