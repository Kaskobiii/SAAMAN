// Only the external VATSIM feed is replaced. The vatIRIS router itself is real.
export default {
    async get(url){
        if(url!=='https://data.vatsim.net/v3/vatsim-data.json')throw Error('Unexpected upstream network request')
        const feed=globalThis.__SAAMAN_VATIRIS_TEST_FEED__
        if(!feed)throw Error('Missing isolated controller feed')
        feed.requests++
        if(feed.unavailable)throw Error('Simulated VATSIM feed outage')
        return {data:{controllers:feed.controllers}}
    },
}
