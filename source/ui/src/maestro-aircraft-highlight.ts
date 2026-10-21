type LocalRequest=(method:string,data?:{callsign:string;renew?:boolean})=>Promise<unknown>
const callsign=(value:unknown)=>typeof value==='string'&&/^[A-Z0-9][A-Z0-9_-]{1,15}$/.test(value.trim().toUpperCase())?value.trim().toUpperCase():''

// Visual state belongs to this EuroScope instance, never to the shared plan.
export function createAircraftHighlight(request:LocalRequest,selected:(callsign:string)=>void,hovered:(callsign:string)=>void=()=>{}){
 let active=true,current='',selectionRevision=0,hoverRevision=0,selectionIdentity='',selectionLease=0
 let selectionTimer:ReturnType<typeof setTimeout>|undefined
 function showSelection(value:unknown){
  const next=callsign(value)
  if(next===selectionIdentity)return
  selectionIdentity=next;const lease=++selectionLease
  clearTimeout(selectionTimer);selected(next)
  if(next)selectionTimer=setTimeout(()=>{if(active&&lease===selectionLease)selected('')},3000)
 }
 function send(value:string,renew=false){
  const revision=hoverRevision
  try{void request('host:aircraft-hover',{callsign:value,...(renew?{renew:true}:{})}).then(result=>{
   if(result===false&&value&&active&&revision===hoverRevision&&current===value)clear()
  }).catch(()=>{})}catch{ /* Optional local visual bridge. */ }
 }
 function receiveSelection(value:unknown){if(active){selectionRevision++;showSelection(value)}}
 async function loadSelection(){
  const revision=selectionRevision
  try{const value=await request('host:aircraft-selection') as {callsign?:unknown};if(active&&revision===selectionRevision)showSelection(value?.callsign)}catch{}
 }
 function hover(value:unknown){
  if(!active)return
  const next=callsign(value);if(next===current)return
  current=next;hoverRevision++;hovered(current);send(current)
 }
 function leave(value:unknown){if(callsign(value)===current)clear()}
 function clear(){if(!active||!current)return;current='';hoverRevision++;hovered('');send('')}
 function refresh(){if(active&&current)send(current,true)}
 function dispose(){if(!active)return;clear();active=false;selectionRevision++;selectionLease++;clearTimeout(selectionTimer);selected('')}
 return {hover,leave,clear,refresh,dispose,loadSelection,receiveSelection}
}
