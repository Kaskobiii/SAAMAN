import fs from 'node:fs'
import vm from 'node:vm'
const source=fs.readFileSync(new URL('../native/sdk_input.h',import.meta.url),'utf8')
const script=source.match(/LR"SDK\(([\s\S]*)\)SDK"/u)?.[1]
if(!script)throw Error('SDK input script is missing')
new vm.Script(script,{filename:'sdk_input.h'})
console.log('SDK input script syntax passed')
