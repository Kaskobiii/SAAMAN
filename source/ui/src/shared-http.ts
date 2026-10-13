// Compression is negotiated with the authenticated standalone backend.
// Keep JSON available for older servers and vatIRIS; never change the payload
// itself, so uncertain request retries retain their original meaning and ID.
export async function publicationBody(json:string,enabled:boolean){
    if(!enabled||json.length<8192||typeof CompressionStream==='undefined')return {data:json,compressed:false}
    const stream=new Blob([json],{type:'application/json'}).stream().pipeThrough(new CompressionStream('gzip'))
    const data=await new Response(stream).arrayBuffer()
    if(data.byteLength>=new TextEncoder().encode(json).length)return {data:json,compressed:false}
    return {data,compressed:true}
}
