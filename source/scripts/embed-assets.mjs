import {readdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dist=path.join(root,'ui/dist'),generated=path.join(root,'generated')
const {mkdir}=await import('node:fs/promises');await mkdir(generated,{recursive:true})
async function collect(folder){const files=[];for(const item of await readdir(folder,{withFileTypes:true})){const name=path.join(folder,item.name);if(item.isDirectory())files.push(...await collect(name));else files.push(name)}return files}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'}
const files=(await collect(dist)).sort(),rc=[],entries=[]
for(const [index,file] of files.entries()){
    const id=2000+index,url='/'+path.relative(dist,file).split(path.sep).join('/')
    rc.push(`${id} RCDATA "${file.split(path.sep).join('/')}"`)
    entries.push(`{${JSON.stringify(url)}, ${JSON.stringify(mime[path.extname(file)]||'application/octet-stream')}, ${id}}`)
}
await writeFile(path.join(generated,'assets.rc'),rc.join('\n'))
await writeFile(path.join(generated,'embedded_assets.h'),`#pragma once\nstruct EmbeddedAsset {const char* path;const char* mime;int id;};\ninline constexpr EmbeddedAsset EmbeddedAssets[]={\n${entries.join(',\n')}\n};\n`)
console.log(`Embedded ${files.length} UI assets in the DLL resource manifest`)
