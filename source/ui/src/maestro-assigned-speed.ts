import type {TelemetryFlight} from './maestro-engine'

const highSpeedWarning='Assigned speed 999 unavailable; speed-based gain disabled'

/** TopSky encodes its HS flag as IAS 999. It is not an exact IAS restriction. */
export function normalizeTopSkySpeed<T extends TelemetryFlight>(flight:T):T {
    const highSpeed=flight.assignedSpeed===999||flight.topskyHighSpeed===true&&flight.assignedSpeed===0
    if(!highSpeed)return flight
    const legacyWarning=flight.dataWarnings?.includes(highSpeedWarning)===true
    const dataWarnings=legacyWarning?flight.dataWarnings!.filter(w=>w!==highSpeedWarning):flight.dataWarnings
    return {...flight,assignedSpeed:0,topskyHighSpeed:true,dataWarnings,
        // Undo only the invalidity explained by this exact legacy diagnostic.
        // Other unavailable inputs still disable speed-dependent guidance.
        speedDataValid:legacyWarning&&!dataWarnings?.length?undefined:flight.speedDataValid}
}
