// Only the loader handoff runs in the host. System-service calls run elsewhere.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

function launchBrowser({root, helper, port=9021, timeout=8000}) {
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('loaderPort must be 1..65535');
  const status={state:'connecting-to-loader',loaderPort:port,startedAtMs:_native.now()};
  const bytes=fs.readFileSync(helper);
  if(bytes.subarray(0,4).toString('hex')!=='7f454c46')throw Error('Browser helper is not an ELF');
  const socket=net.createConnection(port,'127.0.0.1');
  let transferred=false;
  const timer=setTimeout(()=>{
    if(!transferred){status.state='loader-timeout';status.error='No complete helper transfer; host remains available';socket.destroy();}
  },timeout);
  socket.on('error',error=>{if(!transferred){status.state='loader-failed';status.error=error.message;}clearTimeout(timer);});
  socket.on('connect',()=>{
    status.state='sending-helper';
    socket.write(bytes,error=>{
      if(error)return;
      transferred=true;clearTimeout(timer);status.state='helper-sent';socket.end();
      // The payload loader receives a complete raw ELF followed by EOF.
      // No successful transfer is replayed: browser launch may already be underway.
      setTimeout(()=>socket.destroy(),1000).unref();
    });
  });
  const deadline=status.startedAtMs+20000;
  const poll=setInterval(()=>{
    try{
      const file=path.join(root,'browser-launch.json');
      if(fs.existsSync(file)){
        const report=JSON.parse(fs.readFileSync(file,'utf8'));
        if(Number.isFinite(report.monotonicMs)&&report.monotonicMs>=status.startedAtMs){
          delete status.reportError;
          status.helper=report;
          if(['launch-accepted','launch-failed','ui-not-ready'].includes(report.state)){
            status.state=report.state;clearInterval(poll);return;
          }
        }
      }
    }catch(error){status.reportError=error.message;}
    if(_native.now()>=deadline){
      clearInterval(poll);
      if(transferred&&status.state==='helper-sent')status.state='helper-report-timeout';
    }
  },250);
  poll.unref();return status;
}
module.exports={launchBrowser};
