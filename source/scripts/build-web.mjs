import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
if(process.platform==='win32')fs.realpathSync.native=fs.realpathSync
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../ui')
process.chdir(root)
// Relative assets also work when the editor is hosted below a site path.
process.argv=['node','vite','build','--base=./','--outDir=dist-browser']
await import(pathToFileURL(path.join(root,'node_modules/vite/bin/vite.js')).href)
