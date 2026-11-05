import {RUNWAYS,rateDistanceNm,type EngineConfig} from './maestro-engine'

const spacing:Record<string,number>={'26/19R':4.3,'08/19L':4.3,'01R/08':4,'26/01L':5}
// Suggestions belong to the draft only. Keep distance presets in NM until
// conversion, so the menu's existing wind/speed display shows that spacing.
export function suggestedRunwayRate(arrival:string,departure:string|undefined,config:EngineConfig):number|undefined {
 if(!departure||![arrival,departure].every(r=>r.startsWith('ESSA/')&&RUNWAYS.includes(r)))return undefined
 const arr=arrival.split('/')[1],dep=departure.split('/')[1]
 const distance=arrival===departure?(arr==='08'?8.3:6.5):spacing[`${arr}/${dep}`]
 if(distance===undefined)return 95 // Rounded interval for 38 arrivals/hour.
 return Math.max(60,Math.min(600,Math.round(distance/rateDistanceNm(1,arrival,config))))
}
