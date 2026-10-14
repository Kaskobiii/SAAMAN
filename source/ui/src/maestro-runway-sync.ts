import {RUNWAYS,type Telemetry} from './maestro-engine'
export function runwaySelections(input:Telemetry,now:number){
 if(!Number.isFinite(input.timestamp)||now-input.timestamp>15000||input.timestamp>now+30000)throw Error('No fresh EuroScope runway selections are available')
 const allowed=(runway:string)=>runway.startsWith('ESSA/')&&RUNWAYS.includes(runway)
 const arrivals=input.activeRunways?.arrivals.filter(allowed)??[],departures=input.activeRunways?.departures.filter(allowed)??[]
 if(!arrivals.length||!departures.length)throw Error('Select ESSA arrival and departure runways in EuroScope')
 return {active:[...new Set(arrivals)],departureRunway:departures[0]}
}
