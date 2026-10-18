const valid=(v:unknown):v is string=>typeof v==='string'&&/^\d+\.\d+\.\d+$/.test(v)
export function newestVersion(versions:unknown[]){
    return versions.filter(valid).sort((a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);return y[0]-x[0]||y[1]-x[1]||y[2]-x[2]})[0]
}
/** Compare reported builds. Private GitHub releases cannot be queried anonymously. */
export function sequencerVersionWarning(callsign:string,version:unknown,known:unknown[]){
    if(!callsign)return ''
    const latest=newestVersion(known)
    if(!valid(version))return `Sequencer ${callsign}: version unknown. Check that it has the latest DLL.`
    if(latest&&newestVersion([latest,version])!==version)return `Sequencer ${callsign} uses ${version}; ${latest} is available. Update the sequencer DLL.`
    return ''
}
