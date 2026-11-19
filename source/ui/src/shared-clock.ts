/** Estimate backend UTC from short requests and advance it with a monotonic clock. */
export class SharedClock {
    private utc: number
    private at: number
    private correction = 0
    private sampleAt = -Infinity
    private latency = Infinity

    constructor(private elapsed: () => number = () => performance.now(), wall: () => number = Date.now) {
        this.utc = wall()
        this.at = elapsed()
    }

    get synchronized() { return Number.isFinite(this.sampleAt) }

    now() {
        const time = this.elapsed()
        const duration = Math.max(0, time - this.at)
        // Smooth later corrections so an NTP adjustment or a slower reply cannot
        // run the arrival timeline backwards or suddenly advance it by seconds.
        const adjustment = Math.sign(this.correction) * Math.min(Math.abs(this.correction), duration / 10)
        this.utc += duration + adjustment
        this.correction -= adjustment
        this.at = time
        return Math.floor(this.utc)
    }

    observe(serverTimeMs: number, sent: number, received: number) {
        const latency = received - sent
        if (!Number.isSafeInteger(serverTimeMs) || serverTimeMs < 1_000_000_000_000 || serverTimeMs > 4_000_000_000_000 ||
            !Number.isFinite(latency) || latency < 0 || latency > 4000) return
        if (received - this.sampleAt < 60_000 && latency > this.latency + 250) return
        const target = serverTimeMs + latency / 2 + Math.max(0, this.elapsed() - received)
        const current = this.now()
        if (this.synchronized) this.correction = target - current
        else this.utc = target
        this.sampleAt = received
        this.latency = latency
    }
}

export const elapsedNow = () => performance.now()
let activeClock: SharedClock | undefined

export function setOperationClock(clock: SharedClock | undefined) { activeClock = clock }
export function operationNow() { return activeClock?.now() ?? Date.now() }

export interface PublicationTiming {
    publicationAgeMs?: number
    /** Allows a successful, uncached room GET to prove freshness on older backends. */
    freshRoomRead?: boolean
    serverTimeMs?: number
}

export function publicationAge(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}
