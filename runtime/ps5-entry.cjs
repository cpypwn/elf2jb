// UI and launch settings for the self-contained PS5 host.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {main} = require('../upstream/run.cjs');
const {launchBrowser} = require('./browser-launch.cjs');
const {inspectFailure} = require('./run-diagnostics.cjs');
const root = path.resolve(__dirname, '../../..');
const configFile = path.join(root, 'config.json');
let config = {};
if (fs.existsSync(configFile)) config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const host = config.host || _native.lan();
if (!require('node:net').isIPv4(host)) throw Error('config.json host must be the PS5 LAN IPv4 address');
const log = [];
const status = {application: 'elf2jb-host-candidate', engine: 'ns2jb', state: 'starting', host,
  port: 39380, runtime: 'QuickJS compatibility layer', hardware_execution_verified: false,
  attempt: 0, canRestart: false,
  browser: {state:'not-requested'}};
const basic = `V=START(39380,${host.split('.').join(',')})`;
let gpu;
let gpuAttempt;
function startGpu(directory) {
  if (status.state !== 'RPC held' || gpuAttempt === status.attempt) return;
  const attempt = status.attempt;
  gpuAttempt = attempt;
  status.showcase = {phase:'preparing',message:'Preparing the Switch graphics demo'};
  try {
    gpu = require('./switch-gpu-homebrew.cjs').start({runDirectory:directory,
      root:path.resolve(__dirname,'..'),onStatus:update=>{
        if (status.attempt === attempt) status.showcase = update;
      }});
    gpu.ready.catch(error=>{
      if (status.attempt === attempt) status.showcase = {phase:'failed',message:String(error)};
    });
    gpu.completed.then(outcome=>{
      if (status.attempt === attempt && outcome.state === 'failed')
        status.showcase = {phase:'failed',message:outcome.error || 'The graphics demo stopped'};
    });
  } catch(error) {
    status.showcase = {phase:'failed',message:String(error)};
    console.log('Graphics demo failed: ' + error);
  }
}
const original = console.log;
console.log = (...args) => {
  const text=args.map(String).join(' ');
  log.push(text);if(log.length>200)log.shift();
  if(text.startsWith('4/4 verified. SmileBASIC RPC and FS memory endpoint remain live')){
    status.state='RPC held';
    status.hardware_execution_verified=true;
    status.rpc={state:'held'};
  }else if(status.rpc?.state==='held'&&text.startsWith('Run folder: ')){
    status.rpc.directory=text.slice('Run folder: '.length);
    setImmediate(()=>startGpu(status.rpc.directory));
  }
  original(...args);
};
const escape = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function startHost() {
  gpu = null;
  gpuAttempt = null;
  status.canRestart = false;
  status.attempt++;
  status.state = 'waiting for Switch 2';
  status.hardware_execution_verified = false;
  delete status.rpc;
  delete status.error;
  delete status.result;
  delete status.diagnostics;
  delete status.showcase;
  log.length = 0;
  main(['--rpc',host]).then(result => {
    if (gpu) gpu.stop();
    status.state = 'completed';
    status.result = result;
    status.hardware_execution_verified = !!result.verified;
    status.rpc = result.rpc;
    status.canRestart = true;
  }, async error => {
    if (gpu) gpu.stop();
    // main rejects only after upstream has finished its cleanup and saved the report.
    status.state = 'failed';
    if(status.rpc)status.rpc.state='closed';
    status.error = String(error) + '\n' + (error.stack || '');
    console.log(status.error);
    try {
      status.diagnostics = await inspectFailure(error, path.join(__dirname, '../upstream/runs'));
      if (status.diagnostics) console.log('Run diagnostics: ' + JSON.stringify(status.diagnostics, null, 2));
    } catch (readError) {
      console.log('Could not inspect run diagnostics: ' + readError.message);
    }
    status.canRestart = true;
    _native.notify('elf2jb stopped. Restart Switch 2, then use Restart host on the page at port 8088.');
  });
}
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.url === '/finish') {
    if (req.method !== 'POST') {res.writeHead(405, {Allow:'POST'}).end();return;}
    let body = '';
    for await (const part of req) {
      body += part.toString();
      if (body.length > 64) {res.writeHead(413).end();return;}
    }
    if (status.state !== 'RPC held' || body !== 'attempt=' + status.attempt) {
      res.writeHead(409, {'Content-Type':'text/html; charset=utf-8'}).end(
        '<p>There is no held RPC session to finish. <a href="/">Return to elf2jb</a>.</p>');
      return;
    }
    status.state='finishing RPC session';
    const active = gpu;
    Promise.resolve().then(()=>active?.stop()).catch(error=>{
      status.showcase={phase:'failed',message:'The graphics demo did not stop cleanly: '+error};
    }).finally(()=>process.emit('SIGINT'));
    res.writeHead(303, {Location:'/'}).end();
    return;
  }
  if (req.url === '/restart') {
    if (req.method !== 'POST') {res.writeHead(405, {Allow:'POST'}).end();return;}
    let body = '';
    for await (const part of req) {
      body += part.toString();
      if (body.length > 64) {res.writeHead(413).end();return;}
    }
    // Bind the form to one failed attempt so double clicks and stale pages cannot replay it.
    if (!status.canRestart || body !== 'attempt=' + status.attempt) {
      res.writeHead(409, {'Content-Type':'text/html; charset=utf-8'}).end(
        '<p>The host is running or this restart request is out of date. <a href="/">Return to elf2jb</a>.</p>');
      return;
    }
    startHost();
    res.writeHead(303, {Location:'/'}).end();
    return;
  }
  if (req.method!=='GET') {res.writeHead(405).end();return;}
  if(req.url==='/icon.png') {
    res.setHeader('Content-Type','image/png');
    res.end(fs.readFileSync(path.join(__dirname,'../assets/payload-icon.png')));return;
  }
  if(req.url==='/status') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...status,log},null,2));return;}
  if(req.url!=='/') {res.writeHead(404).end();return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end('<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">'+
    '<meta http-equiv=refresh content=5><link rel=icon href="data:,"><title>elf2jb by cpypwn</title><h1>elf2jb by cpypwn</h1><p>'+escape(status.state)+'</p>'+
    (status.state==='RPC held' ? '<p>RPC is held open. Keep the ELF and SmileBASIC running.</p>'+
      '<form method=post action=/finish><input type=hidden name=attempt value="'+status.attempt+'"><button type=submit>Finish session</button></form>' : '')+
    (status.showcase ? '<p>Switch graphics demo: '+escape(status.showcase.message || status.showcase.phase)+'</p>' : '')+
    (status.canRestart ? '<p>Restart the Switch 2 and reopen SmileBASIC before starting a new attempt. Previous run reports are kept.</p>'+
      '<form method=post action=/restart><input type=hidden name=attempt value="'+status.attempt+'"><button type=submit>Restart host</button></form>' : '')+
    '<p>Use the upstream bootstrap.bas in SmileBASIC. After RUN and the documented REMOVE command, enter:</p><pre>'+basic+'</pre>'+
    '<p><a href=/status>JSON report</a></p><pre>'+escape(log.join('\n'))+'</pre></html>');
});
server.listen(8088,'0.0.0.0',()=>{
  _native.notify(`elf2jb by cpypwn: http://${host}:8088`);
  startHost();
  if(config.openBrowser===true || (__platform==='ps5' && config.openBrowser!==false)){
    setTimeout(()=>{
      try{status.browser=launchBrowser({root,helper:path.join(__dirname,'open-browser.elf'),port:config.loaderPort??9021});}
      catch(error){status.browser={state:'launch-setup-failed',error:error.message};console.log('Browser launch failed: '+error.message);}
    },1000);
  }else status.browser.state='disabled';
});
