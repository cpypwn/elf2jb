const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const {once} = require('node:events');
const {spawn} = require('node:child_process');
require('../upstream/test.cjs');
for(const name of ['ro/layout','retained/pool-anchor','retained/metadata-window','retained/cache-shape'])
  require('../upstream/engine/switch2/'+name+'.test.cjs');

test('runtime: SHA-256 known vectors and segmented updates',()=>{
  assert.equal(crypto.createHash('sha256').update('').digest('hex'),'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(crypto.createHash('sha256').update('a').update('bc').digest('hex'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(crypto.createHash('sha256').update(Buffer.alloc(1000000,97)).digest('hex'),'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});
test('runtime: byte offsets, 64-bit signed data, UTF-8 and base64',()=>{
  const b=Buffer.alloc(40);b.writeBigUInt64LE(0xfedcba9876543210n,8);
  const sub=b.subarray(8,16);assert.equal(sub.toString('hex'),'1032547698badcfe');
  assert.equal(sub.readBigInt64LE(),-81985529216486896n);
  assert.equal(sub.toString('base64'),'EDJUdpi63P4=');
  assert.deepEqual(Buffer.from(sub.toString('base64'),'base64'),sub);
  const unicode='SmileBASIC 日本語 🎮';assert.equal(Buffer.from(unicode).toString(),unicode);
  assert.deepEqual(Buffer.alloc(8).fill(Buffer.from('abcd','hex')),Buffer.from('abcdabcdabcdabcd','hex'));
});
test('runtime: positioned file IO, stat, sync and recursive copy',async t=>{
  const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'elf2jb-io-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=await fs.promises.open(path.join(root,'data'),'wx+',0o600);
  const source=Buffer.from('0011223344556677','hex');
  assert.equal((await file.write(source,2,4,3)).bytesWritten,4);
  const out=Buffer.alloc(8,0xff);assert.equal((await file.read(out,1,6,1)).bytesRead,6);
  assert.equal(out.toString('hex'),'ff000022334455ff');
  await file.sync();assert.equal((await file.stat()).size,7);await file.close();
  fs.cpSync(root,root+'-copy',{recursive:true});t.after(()=>fs.rmSync(root+'-copy',{recursive:true,force:true}));
  assert.deepEqual(fs.readFileSync(path.join(root,'data')),fs.readFileSync(path.join(root+'-copy','data')));
});
test('runtime: isolated child module state, cwd, environment and IPC',async t=>{
  const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'elf2jb-worker-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'child.cjs'),"const fs=require('node:fs');process.send({cwd:process.cwd(),key:process.env.TEST_KEY});process.on('message',v=>{fs.writeFileSync('reply',v.text);console.log('done');process.exit(0);});");
  const child=spawn(process.execPath,[path.join(root,'child.cjs')],{cwd:root,env:{TEST_KEY:'isolated'},stdio:['ignore','pipe','pipe','ipc']});
  const [ready]=await once(child,'message');assert.equal(ready.cwd,root);assert.equal(ready.key,'isolated');
  const done=once(child,'close');child.send({text:'worker reply'});assert.equal((await done)[0],0);
  assert.equal(fs.readFileSync(path.join(root,'reply'),'utf8'),'worker reply');
  assert.equal(process.env.TEST_KEY,undefined);
});
test('runtime: UNIX domain sockets transport serialized endpoint requests',async t=>{
  const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'elf2jb-unix-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const address=path.join(root,'endpoint.sock');
  const server=net.createServer(s=>{s.on('error',()=>{});s.setEncoding('utf8');s.on('data',text=>s.end(text));});
  server.listen(address);await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const client=net.createConnection(address);client.on('error',()=>{});await once(client,'connect');
  let response='';client.setEncoding('utf8');client.on('data',data=>response+=data);
  const ended=once(client,'end');client.write('{"command":"status"}\n');await ended;
  assert.equal(response,'{"command":"status"}\n');
});
test('runtime: promisified execFile supports mount-inspection stages',async t=>{
  const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'elf2jb-exec-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=path.join(root,'stage.cjs');fs.writeFileSync(file,"console.log('stage output');console.error('stage diagnostic');");
  const exec=require('node:util').promisify(require('node:child_process').execFile);
  const result=await exec(process.execPath,[file],{timeout:2000});
  assert.equal(result.stdout,'stage output\n');assert.equal(result.stderr,'stage diagnostic\n');
  fs.writeFileSync(file,"process.exitCode=7;");
  await assert.rejects(exec(process.execPath,[file],{timeout:2000}),/exit code 7/);
});
test('browser: loader receives the exact helper once and fresh reports update status',async t=>{
  const {launchBrowser}=require('../runtime/browser-launch.cjs');
  const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'elf2jb-browser-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const expected=fs.readFileSync(path.join(__dirname,'../build/elf2jb-open-browser.elf'));
  let connections=0,received;
  const done=new Promise(resolve=>{
    const server=net.createServer(socket=>{
      connections++;const parts=[];socket.on('error',()=>{});
      socket.on('data',bytes=>parts.push(bytes));socket.on('end',()=>{received=Buffer.concat(parts);socket.end();resolve();});
    });
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    server.listen(0,'127.0.0.1');
    once(server,'listening').then(()=>{
      fs.writeFileSync(path.join(root,'browser-launch.json'),JSON.stringify({state:'launch-accepted',monotonicMs:0}));
      const status=launchBrowser({root,helper:path.join(__dirname,'../build/elf2jb-open-browser.elf'),port:server.address().port});
      t.browserStatus=status;
    });
  });
  await done;assert.deepEqual(received,expected);assert.equal(connections,1);
  assert.equal(t.browserStatus.state,'helper-sent','stale report must not count as a current launch');
  fs.writeFileSync(path.join(root,'browser-launch.json'),JSON.stringify({state:'launch-accepted',systemError:0,monotonicMs:_native.now()}));
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(t.browserStatus.state,'launch-accepted');assert.equal(connections,1);
});
test('browser: a refused loader connection is reported without terminating the host',async t=>{
  const {launchBrowser}=require('../runtime/browser-launch.cjs');
  const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'elf2jb-browser-refused-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const status=launchBrowser({root,helper:path.join(__dirname,'../build/elf2jb-open-browser.elf'),port,timeout:1000});
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(status.state,'loader-failed');assert.ok(status.error);
});
