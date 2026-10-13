import {iasToTas,tasToIas,machToTas,performanceAt,planningTas} from './maestro-aircraft-performance'
import type {EngineConfig,TelemetryFlight} from './maestro-engine'

export interface TrajectorySample {seconds:number;remainingNm:number;altitudeFeet:number;casKnots:number;groundspeedKnots:number}
export interface TrajectoryResult {
    model:'energy-accounted-kinematic';seconds:number;pathNm:number;requiredExtensionNm:number;feasible:boolean
    endAltitudeFeet:number;endCasKnots:number;assumptions:string[];samples:TrajectorySample[]
    finalGateSeconds?:number
}
export interface ArrivalTrajectoryInput {distanceNm:number;altitudeFeet:number;heading:number;aircraft:string;wake:string;assignedSpeed?:number;initialGroundspeed?:number;observedFinal?:boolean;integrationStepSeconds?:number}
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v))
const kt=.514444,ft=.3048,g=9.80665
// Signed ft/min. With a fixed nominal energy budget, acceleration reduces
// climb (or increases sink); deceleration reduces sink. The density term
// preserves the supplied nominal rate when CAS is held constant.
export function energyVerticalRate(nominalFpm:number,cas:number,altitude:number,deltaCas:number,seconds:number){
    const tas=iasToTas(cas,altitude)*kt
    const speedSlope=(iasToTas(cas,altitude+50)-iasToTas(cas,Math.max(0,altitude-50)))*kt/(100*ft)
    const factor=1+tas/g*speedSlope
    const dv=(iasToTas(cas+deltaCas,altitude)-iasToTas(cas,altitude))*kt
    return nominalFpm-tas/g*(dv/Math.max(.001,seconds))/factor/ft*60
}
// Surface observations are not a wind profile. Use them only below 3000 ft;
// no claim is made that upper-air wind or atmospheric temperature is known.
export function surfaceHeadwind(heading:number,altitude:number,config:EngineConfig){
    return altitude<=3000&&config.surfaceWindDirection!==0?config.surfaceWindSpeed*Math.cos((config.surfaceWindDirection-heading)*Math.PI/180):0
}
export function feederTrajectory(distanceNm:number,p:TelemetryFlight,config:EngineConfig,requestedCruiseGs?:number){
    const heading=p.heading??0,initialAltitude=Math.max(150,p.altitude)
    const climbing=(p.verticalSpeed??0)>300
    const phase=climbing?'climb':'descent'
    const perf=performanceAt(p.aircraft,initialAltitude,phase,config.performanceModel)
    const requestedAltitude=p.clearedAltitude&&p.clearedAltitude>=initialAltitude?p.clearedAltitude:p.finalAltitude&&p.finalAltitude>=initialAltitude?p.finalAltitude:30000
    const cruiseAltitude=climbing?Math.min(requestedAltitude,perf?.ceilingFeet??30000):initialAltitude
    const entryAltitude=climbing?Math.min(cruiseAltitude,config.starEntryAltitude??18000):
        Math.min(initialAltitude,config.starEntryAltitude??18000,p.clearedAltitude&&p.clearedAltitude>=3000?p.clearedAltitude:Infinity)
    const observed=Math.max(100,p.groundspeed)
    const cruiseGs=requestedCruiseGs??(climbing?Math.max(observed,Math.min(config.starCruiseSpeed??450,performanceAt(p.aircraft,cruiseAltitude,'cruise',config.performanceModel)?.nominalTas??config.starCruiseSpeed??450)):observed)
    const cruiseCas=tasToIas(cruiseGs,cruiseAltitude)
    const light=p.wake==='L',prop=/^(AT|DH8|DHC|SF|SB20)/.test(p.aircraft)
    const entryCas=Math.min(cruiseCas,p.assignedSpeed||Infinity,light?180:prop?220:config.starApproachSpeed??250)
    let remaining=distanceNm,altitude=initialAltitude,cas=tasToIas(observed+surfaceHeadwind(heading,initialAltitude,config),initialAltitude),seconds=0
    for(let iteration=0;remaining>1e-8&&iteration<36000;iteration++){
        const profile=performanceAt(p.aircraft,altitude,phase,config.performanceModel)
        const sink=Math.min(config.starDescentRate??1800,profile?.descentFpm&&profile.descentFpm>0?profile.descentFpm:config.starDescentRate??1800)
        const gs=Math.max(60,iasToTas(cas,altitude)-surfaceHeadwind(heading,altitude,config)),dt=Math.min(5,remaining/gs*3600)
        const descentDistance=Math.max(40,Math.max(0,cruiseAltitude-entryAltitude)/Math.max(100,sink)*cruiseGs/60+20)
        const descent=remaining<descentDistance
        const fraction=clamp(remaining/descentDistance,0,1)
        let targetCas=descent?entryCas+(cruiseCas-entryCas)*fraction:cruiseCas
        targetCas=Math.min(targetCas,p.assignedSpeed||Infinity)
        if(p.assignedMach&&altitude>=18000)targetCas=Math.min(targetCas,tasToIas(machToTas(p.assignedMach/100,altitude),altitude))
        if(altitude<10000)targetCas=Math.min(targetCas,250)
        const target=tasToIas(planningTas(targetCas,altitude,p.aircraft,config.performanceModel),altitude)
        const dCas=seconds<15?0:clamp(target-cas,-.5*dt,.5*dt)
        if(descent&&altitude>entryAltitude){
            const effective=Math.max(0,-energyVerticalRate(-sink,cas,altitude,dCas,dt))
            altitude=Math.max(entryAltitude,altitude-effective*dt/60)
        }else if(climbing&&altitude<(descent?entryAltitude:cruiseAltitude)){
            const rate=Math.min(config.starClimbRate??1800,profile?.climbFpm&&profile.climbFpm>0?profile.climbFpm:config.starClimbRate??1800)
            altitude=Math.min(descent?entryAltitude:cruiseAltitude,altitude+Math.max(0,energyVerticalRate(rate,cas,altitude,dCas,dt))*dt/60)
        }
        cas+=dCas;remaining=Math.max(0,remaining-gs*dt/3600);seconds+=dt
    }
    return {seconds,altitudeFeet:altitude,groundspeedKnots:Math.max(60,iasToTas(cas,altitude)-surfaceHeadwind(heading,altitude,config)),complete:remaining<1e-6}
}
export function arrivalTrajectory(input:ArrivalTrajectoryInput,config:EngineConfig):TrajectoryResult {
    const {distanceNm,heading,aircraft,wake}=input
    if(!Number.isFinite(distanceNm)||distanceNm<0||!Number.isFinite(input.altitudeFeet))throw Error('Invalid trajectory geometry')
    const initialAltitude=Math.max(150,input.altitudeFeet),finalCas=wake==='L'?Math.min(110,config.landingSpeedKnots):config.landingSpeedKnots
    const finalNm=config.starFinalNm??10,baseNm=config.starBaseNm??20
    const assumptions=['ISA atmosphere','upper-air wind unavailable','performance rates describe nominal energy loss','0.5 kt/s CAS response; 15 s initial response','3 degree final path; 150 ft model threshold']
    if(!performanceAt(aircraft,initialAltitude,'descent',config.performanceModel))assumptions.push('generic performance fallback; no gain capability')
    const requested=(remaining:number)=>{
        if(input.observedFinal)return finalCas
        if(remaining>baseNm)return wake==='L'?Math.min(180,config.starApproachSpeed??250):config.starApproachSpeed??250
        if(remaining>finalNm)return wake==='L'?Math.min(150,config.starBaseSpeed??180):config.starBaseSpeed??180
        // A gradual final speed schedule replaces an instantaneous drop to
        // landing speed at ten miles. These distances are local assumptions.
        const base=wake==='L'?Math.min(150,config.starBaseSpeed??180):config.starBaseSpeed??180
        return finalCas+(base-finalCas)*clamp((remaining-4)/Math.max(1,finalNm-4),0,1)
    }
    const cap=(cas:number,alt:number)=>tasToIas(planningTas(cas,alt,aircraft,config.performanceModel),alt)
    const start=()=>input.initialGroundspeed&&input.initialGroundspeed>0?
        tasToIas(Math.max(50,input.initialGroundspeed+surfaceHeadwind(heading,initialAltitude,config)),initialAltitude):cap(Math.min(input.assignedSpeed||Infinity,requested(distanceNm)),initialAltitude)
    function integrate(path:number){
        let altitude=initialAltitude,cas=start(),remaining=path,seconds=0,nextSample=0,finalGateSeconds:number|undefined=path<=finalNm?0:undefined
        const samples:TrajectorySample[]=[]
        // Bounded five-second integration. Response and energy effects are
        // accounted for together; this is not a mass/thrust/drag solver.
        for(let iteration=0;remaining>1e-8&&iteration<18000;iteration++){
            const tas=iasToTas(cas,altitude),gs=Math.max(50,tas-surfaceHeadwind(heading,altitude,config))
            const dt=Math.min(clamp(input.integrationStepSeconds??5,1,10),remaining/gs*3600)
            const target=cap(Math.min(input.assignedSpeed||Infinity,requested(remaining)),altitude)
            const dCas=seconds<15?0:clamp(target-cas,-.5*dt,.5*dt)
            const profile=performanceAt(aircraft,altitude,'descent',config.performanceModel)
            const nominalSink=Math.min(config.starDescentRate??1800,profile?.descentFpm&&profile.descentFpm>0?profile.descentFpm:config.starDescentRate??1800)
            const sink=Math.max(0,-energyVerticalRate(-nominalSink,cas,altitude,dCas,dt))
            const nextRemaining=Math.max(0,remaining-gs*dt/3600)
            if(finalGateSeconds===undefined&&nextRemaining<=finalNm)finalGateSeconds=seconds+(remaining-finalNm)/gs*3600
            const desiredAltitude=150+nextRemaining*318.4
            const nextAltitude=Math.max(150,altitude-Math.min(sink*dt/60,Math.max(0,altitude-desiredAltitude)))
            if(seconds>=nextSample){samples.push({seconds,remainingNm:remaining,altitudeFeet:altitude,casKnots:cas,groundspeedKnots:gs});nextSample+=60}
            remaining=Math.max(0,remaining-gs*dt/3600);seconds+=dt;altitude=nextAltitude;cas+=dCas
        }
        samples.push({seconds,remainingNm:remaining,altitudeFeet:altitude,casKnots:cas,groundspeedKnots:Math.max(50,iasToTas(cas,altitude)-surfaceHeadwind(heading,altitude,config))})
        return {seconds,samples,altitude,cas,finalGateSeconds,complete:remaining<1e-6}
    }
    let path=distanceNm,result=integrate(path)
    // Final-position observations use the observed path. Do not invent a
    // circuit or teleport altitude to make a simulated final appear flyable.
    if(!input.observedFinal){
        for(let attempt=0;attempt<6&&(result.altitude>350||result.cas>finalCas+15);attempt++){
            const vertical=Math.max(0,result.altitude-150)/Math.max(100,Math.min(config.starDescentRate??1800,performanceAt(aircraft,result.altitude,'descent',config.performanceModel)?.descentFpm??config.starDescentRate??1800))*60
            const speed=Math.max(0,result.cas-finalCas)/.5
            path+=Math.max(1,Math.max(vertical,speed)*Math.max(100,iasToTas(result.cas,result.altitude))/3600)
            result=integrate(path)
        }
    }
    const requiredExtensionNm=Math.max(0,path-distanceNm)
    if(requiredExtensionNm>.1)assumptions.push('additional track required for descent/deceleration; future vectors unconfirmed')
    if(result.cas<finalCas-15)assumptions.push('assigned speed below configured approach envelope')
    return {model:'energy-accounted-kinematic',seconds:result.seconds,pathNm:path,requiredExtensionNm,feasible:result.complete&&result.altitude<=350&&result.cas<=finalCas+15&&result.cas>=finalCas-15,endAltitudeFeet:result.altitude,endCasKnots:result.cas,assumptions,samples:result.samples,finalGateSeconds:result.finalGateSeconds}
}
