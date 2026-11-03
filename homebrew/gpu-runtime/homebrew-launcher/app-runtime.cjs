const fs=require('node:fs/promises'),path=require('node:path');
const catalogTools=require('./app-catalog.cjs');
const {prepare}=require('./gpu-app.cjs');
const check=(v,m)=>{if(!v)throw Error(m);};
async function atomic(file,value){const temp=file+'.tmp';await fs.writeFile(temp,JSON.stringify(value,null,2));await fs.rename(temp,file);}
async function create({rpc,menu,directory,prepareApp=prepare}){
 const mapped=menu.controls.mapped,cache=new Map();let generation=0,refreshSeen=0,menuState=await rpc.read(mapped,1024);
 let catalog,menuData;const runtime={active:null,report:{session:rpc.a.session,started:new Date().toISOString(),transitions:[],generation:0,resourcesRetained:true}};
 const save=()=>atomic(path.join(directory,'app-runtime.json'),runtime.report);
 async function audio(app){
  let effects={};
  if(app){
   const folder=path.join(directory,'loaded-apps',app.id+'-'+app.fingerprint.slice(0,16));await fs.mkdir(folder,{recursive:true});
   for(const [id,bytes]of Object.entries(app.effectData)){const out=path.join(folder,id+'.pcm');await fs.writeFile(out,bytes);effects[id]=out;}
  }
  await atomic(path.join(directory,'game-audio-source.json'),{session:rpc.a.session,mapped,package:app?{id:app.id,fingerprint:app.fingerprint,effects}:null});
 }
 async function rescan(state,upload=true){
  const selected=catalog?.apps[state.readUInt32LE(80)]?.id;
  const next=await catalogTools.scan(menu.catalog.root),bytes=await catalogTools.raster(next,directory,'catalog-'+(++generation));
  const font=await fs.readFile(path.join(__dirname,'shaders/launcher-text.bin'));check(font.length===catalogTools.ATLAS_BYTES,'Menu type atlas changed size');
  menuData=Buffer.concat([font,bytes]);check(menuData.length+1024<=menu.controls.bytes,'Catalog exceeds GPU storage');catalog=next;
  let index=selected?catalog.apps.findIndex(a=>a.id===selected):-1;if(index<0)index=Math.min(state.readUInt32LE(80),Math.max(0,catalog.apps.length-1));
  state.writeUInt32LE(index,80);state.writeFloatLE(index,68);state.writeUInt32LE(catalog.apps.length,112);state.writeUInt32LE(catalog.apps.length,1020);state.writeUInt32LE(0,116);
  state.writeFloatLE(0,96);state.writeFloatLE(0,100);state.writeFloatLE(state.readFloatLE(108)+1,108);state.writeUInt32LE(0,1012);state.writeUInt32LE(0,1016);
  refreshSeen=state.readFloatLE(104);menuState=state;
  if(upload){await rpc.write(mapped+1024,menuData);await rpc.write(mapped,menuState);}
  runtime.report.catalog=catalogTools.summary(catalog);runtime.report.generation=generation;await save();
 }
 async function returnToMenu(error){
  await runtime.active?.service?.close();
  await audio(null);runtime.active=null;runtime.report.active=null;
  menuState.writeFloatLE(1,960);menuState.writeFloatLE(0,964);menuState.writeUInt32LE(0,784);menuState.writeUInt32LE(error?1:0,92);
  await rescan(menuState);runtime.report.transitions.push({event:'return',error:error?.message,time:new Date().toISOString()});await save();
  return menu.commands[0];
 }
 runtime.afterBatch=async()=>{
  const state=await rpc.read(mapped,1024);
  if(runtime.active){if(state.readUInt32LE(1016)!==0)return returnToMenu();await runtime.active.service?.afterBatch(state);return runtime.active.gpu.commands[0];}
  const request=state.readUInt32LE(1012);
  if(request!==0){
   menuState=state;const selected=catalog.apps[request-1];
   try{
    check(selected,'The selected app is no longer in the catalog');
    const app=await catalogTools.readApp(selected.root);check(app.fingerprint===selected.fingerprint,'App changed; tap Refresh before opening it');
    let gpu=cache.get(app.fingerprint);
    if(!gpu){check(cache.size<64,'This session has retained 64 app versions; start a fresh session to load another');gpu=await prepareApp(rpc,menu,app,directory);check(gpu.ready&&gpu.scratchRestored,'App preparation incomplete');cache.set(app.fingerprint,gpu);}
    const bytes=Buffer.alloc(menu.controls.bytes);app.files.state.bytes.copy(bytes);app.files.data.bytes.copy(bytes,1024);
    bytes.writeUInt32LE(0,1012);bytes.writeUInt32LE(0,1016);
    if(app.manifest.transition==='none')bytes.writeFloatLE(0,960);
    if(app.files.memory){check(gpu.privateStorage?.bytes===app.files.memory.allocationBytes,'App private storage differs');const initial=Buffer.alloc(gpu.privateStorage.bytes);app.files.memory.bytes.copy(initial);await rpc.write(gpu.privateStorage.mapped,initial);}
    await rpc.write(mapped,bytes);await audio(app);
    runtime.active={app,gpu};
    runtime.report.active={id:app.id,fingerprint:app.fingerprint};runtime.report.transitions.push({event:'launch',id:app.id,fingerprint:app.fingerprint,time:new Date().toISOString()});await save();
    return gpu.commands[0];
   }catch(error){
    // A failed scratch restoration means the native session must not be reused.
    if(/restore scratch/.test(error.message))throw error;
    return returnToMenu(error);
   }
  }
  if(state.readFloatLE(104)!==refreshSeen)await rescan(state);
  return menu.commands[0];
 };
 runtime.close=async()=>{await runtime.active?.service?.close();};
 await rescan(menuState);await audio(null);return runtime;
}
module.exports={create};
