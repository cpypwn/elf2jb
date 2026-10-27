// UI and launch settings for the self-contained PS5 host.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {main} = require('../upstream/run.cjs');
const {launchBrowser} = require('./browser-launch.cjs');
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
  mediaShortcut: _native.shortcutInfo(),
  browser: {state:'not-requested'}};
const basic = `V=START(39380,${host.split('.').join(',')})`;
const original = console.log;
console.log = (...args) => { const text=args.map(String).join(' ');log.push(text);if(log.length>200)log.shift();original(...args); };
const escape = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function startHost() {
  status.canRestart = false;
  status.attempt++;
  status.state = 'waiting for Switch 2';
  status.hardware_execution_verified = false;
  delete status.error;
  delete status.result;
  log.length = 0;
  main([host]).then(result => {
    status.state = 'completed';
    status.result = result;
    status.hardware_execution_verified = !!result.verified;
  }, error => {
    // main rejects only after upstream has finished its cleanup and saved the report.
    status.state = 'failed';
    status.error = String(error) + '\n' + (error.stack || '');
    console.log(status.error);
    status.canRestart = true;
    _native.notify('elf2jb stopped. Restart Switch 2, then use Restart host on the page at port 8088.');
  });
}
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control','no-store');
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
    (status.canRestart ? '<p>Restart the Switch 2 and reopen SmileBASIC before starting a new attempt. Previous run reports are kept.</p>'+
      '<form method=post action=/restart><input type=hidden name=attempt value="'+status.attempt+'"><button type=submit>Restart host</button></form>' : '')+
    '<p>Experimental port. A full Switch 2 run has not been verified. Use Ethernet on both consoles.</p>'+
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
