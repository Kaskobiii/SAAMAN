import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
// Use the standard realpath implementation with Windows bundled runtimes.
if(process.platform==='win32')fs.realpathSync.native=fs.realpathSync
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../ui')
const corruptSymbols=['\u00c2\u00b7','\u00e2\u2020\u2019','\u00e2\u20ac\u201d','\u00e2\u2013\u00bc','\u00c3\u2014','\u00c2\u00b0','\u00e2\u20ac\u201c','\u00e2\u2013\u00b8','\ufffd']
const utf8=new TextDecoder('utf-8',{fatal:true})
function checkText(directory){
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
        const file=path.join(directory,entry.name)
        if(entry.isDirectory())checkText(file)
        else if(/\.(vue|ts|css|html|json)$/.test(entry.name)){
            const text=utf8.decode(fs.readFileSync(file))
            if(corruptSymbols.some(symbol=>text.includes(symbol)))throw Error(`Corrupted UI text in ${path.relative(root,file)}; save the original symbols as UTF-8`)
        }
    }
}
checkText(path.join(root,'src'))
utf8.decode(fs.readFileSync(path.join(root,'index.html')))
process.chdir(root);process.argv=['node','vite','build']
await import(pathToFileURL(path.join(root,'node_modules/vite/bin/vite.js')).href)
