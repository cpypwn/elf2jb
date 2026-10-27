/* SPDX-License-Identifier: GPL-3.0-or-later
 * Deliberately scoped Node API compatibility for the pinned ns2jb host.
 * Each stage has its own interpreter, module cache, environment and event loop.
 */
'use strict';
const N = _native;
const utf8 = s => {
  const out = [];
  for (let i=0;i<s.length;i++) {
    let c=s.charCodeAt(i);
    if(c>=0xd800&&c<=0xdbff) {const d=s.charCodeAt(i+1);if(d>=0xdc00&&d<=0xdfff){c=0x10000+((c-0xd800)<<10)+d-0xdc00;i++;}else c=0xfffd;}
    else if(c>=0xdc00&&c<=0xdfff)c=0xfffd;
    if(c<128)out.push(c);else if(c<2048)out.push(0xc0|(c>>6),0x80|(c&63));
    else if(c<65536)out.push(0xe0|(c>>12),0x80|((c>>6)&63),0x80|(c&63));
    else out.push(0xf0|(c>>18),0x80|((c>>12)&63),0x80|((c>>6)&63),0x80|(c&63));
  }
  return out;
};
const decode = bytes => {
  let out='';
  for(let i=0;i<bytes.length;) {
    const a=bytes[i++]; if(a<128){out+=String.fromCharCode(a);continue;}
    const n=a>=0xc2&&a<=0xdf?1:a>=0xe0&&a<=0xef?2:a>=0xf0&&a<=0xf4?3:0;
    if(!n||i+n>bytes.length){out+='\ufffd';continue;}
    let c=a&((1<<(6-n))-1),ok=true;
    for(let j=0;j<n;j++)if((bytes[i+j]&0xc0)!==0x80)ok=false;
    if(!ok){out+='\ufffd';continue;}
    for(let j=0;j<n;j++)c=(c<<6)|(bytes[i+j]&63);
    if(c<(n===1?128:n===2?2048:65536)||c>0x10ffff||(c>=0xd800&&c<=0xdfff)){out+='\ufffd';continue;}
    i+=n;out+=String.fromCodePoint(c);
  }
  return out;
};
const b64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
class Buffer extends Uint8Array {
  static alloc(size,fill=0,encoding) {if(!Number.isInteger(size)||size<0||size>0x20000000)throw RangeError('Buffer size');const b=new Buffer(size);if(fill!==0)b.fill(fill,0,size,encoding);return b;}
  static allocUnsafe(size){return this.alloc(size);}
  static from(value,encoding,byteLength){
    if(typeof value==='string') {
      if(encoding==='hex'){const out=[];for(let i=0;i+1<value.length;i+=2){if(!/^[0-9a-f]{2}$/i.test(value.slice(i,i+2)))break;out.push(parseInt(value.slice(i,i+2),16));}return new Buffer(out);}
      if(encoding==='base64'){const out=[];let acc=0,bits=0;for(const c of value.replace(/-/g,'+').replace(/_/g,'/')){const v=b64.indexOf(c);if(v<0)continue;acc=(acc<<6)|v;bits+=6;if(bits>=8){bits-=8;out.push((acc>>bits)&255);}}return new Buffer(out);}
      if(encoding==='ascii'||encoding==='latin1'||encoding==='binary')return new Buffer(Array.from(value,c=>c.charCodeAt(0)&255));
      if(encoding&&encoding!=='utf8'&&encoding!=='utf-8')throw Error('Unsupported encoding '+encoding);
      return new Buffer(utf8(value));
    }
    if(value instanceof ArrayBuffer)return new Buffer(value,encoding,byteLength);
    return new Buffer(value);
  }
  static isBuffer(v){return v instanceof Buffer;}
  static byteLength(s,encoding){return Buffer.from(s,encoding).length;}
  static concat(parts,total=parts.reduce((n,p)=>n+p.length,0)){const out=Buffer.alloc(total);let at=0;for(const p of parts){out.set(p.subarray(0,Math.max(0,total-at)),at);at+=p.length;if(at>=total)break;}return out;}
  toString(encoding='utf8',start=0,end=this.length){
    const b=this.subarray(start,end);
    if(encoding==='hex'){let s='';for(const v of b)s+=v.toString(16).padStart(2,'0');return s;}
    if(encoding==='base64'){let s='';for(let i=0;i<b.length;i+=3){const n=(b[i]<<16)|((b[i+1]||0)<<8)|(b[i+2]||0);s+=b64[(n>>>18)&63]+b64[(n>>>12)&63]+(i+1<b.length?b64[(n>>>6)&63]:'=')+(i+2<b.length?b64[n&63]:'=');}return s;}
    if(encoding==='ascii'||encoding==='latin1'||encoding==='binary'){let s='';for(const v of b)s+=String.fromCharCode(encoding==='ascii'?v&127:v);return s;}
    if(encoding!=='utf8'&&encoding!=='utf-8')throw Error('Unsupported encoding '+encoding);
    return decode(b);
  }
  equals(other){return other.length===this.length&&this.every((v,i)=>v===other[i]);}
  toJSON(){return {type:'Buffer',data:Array.from(this)};}
  subarray(start,end){const a=super.subarray(start,end);return new Buffer(a.buffer,a.byteOffset,a.byteLength);}
  slice(start,end){return this.subarray(start,end);}
  copy(target,targetStart=0,sourceStart=0,sourceEnd=this.length){const p=this.subarray(sourceStart,Math.min(sourceEnd,sourceStart+target.length-targetStart));target.set(p,targetStart);return p.length;}
  fill(value,start=0,end=this.length,encoding){if(typeof value==='number')return super.fill(value,start,end);const p=Buffer.isBuffer(value)?value:Buffer.from(value,encoding);if(!p.length)throw Error('Empty fill');for(let i=start;i<end;i++)this[i]=p[(i-start)%p.length];return this;}
  write(value,offset=0,length=this.length-offset,encoding='utf8'){if(typeof length==='string'){encoding=length;length=this.length-offset;}const b=Buffer.from(value,encoding).subarray(0,length);if(offset<0||offset+b.length>this.length)throw RangeError('write bounds');this.set(b,offset);return b.length;}
  indexOf(value,start=0,encoding){if(typeof value==='number')return super.indexOf(value,start);const p=typeof value==='string'?Buffer.from(value,encoding):value;for(let i=Math.max(0,start);i+p.length<=this.length;i++){let match=true;for(let j=0;j<p.length;j++)if(this[i+j]!==p[j]){match=false;break;}if(match)return i;}return -1;}
  includes(value,start,encoding){return this.indexOf(value,start,encoding)>=0;}
  _view(){return new DataView(this.buffer,this.byteOffset,this.byteLength);}
  readUInt16LE(at=0){return this._view().getUint16(at,true);}
  readUInt32LE(at=0){return this._view().getUint32(at,true);}
  readInt32LE(at=0){return this._view().getInt32(at,true);}
  readBigUInt64LE(at=0){return this._view().getBigUint64(at,true);}
  readBigInt64LE(at=0){return this._view().getBigInt64(at,true);}
  writeUInt16LE(n,at=0){if(n<0||n>65535)throw RangeError('uint16');this._view().setUint16(at,n,true);return at+2;}
  writeUInt32LE(n,at=0){if(n<0||n>0xffffffff)throw RangeError('uint32');this._view().setUint32(at,n,true);return at+4;}
  writeInt32LE(n,at=0){if(n< -0x80000000||n>0x7fffffff)throw RangeError('int32');this._view().setInt32(at,n,true);return at+4;}
  writeBigUInt64LE(n,at=0){if(n<0n||n>0xffffffffffffffffn)throw RangeError('uint64');this._view().setBigUint64(at,n,true);return at+8;}
  writeBigInt64LE(n,at=0){if(n<-(1n<<63n)||n>=(1n<<63n))throw RangeError('int64');this._view().setBigInt64(at,n,true);return at+8;}
}
globalThis.Buffer=Buffer;
class EventEmitter {
  constructor(){this._events=new Map();}
  on(event,fn){const list=this._events.get(event)||[];list.push(fn);this._events.set(event,list);return this;}
  addListener(event,fn){return this.on(event,fn);}
  once(event,fn){const once=(...args)=>{this.off(event,once);fn(...args);};once.original=fn;return this.on(event,once);}
  off(event,fn){const a=this._events.get(event)||[];this._events.set(event,a.filter(x=>x!==fn&&x.original!==fn));return this;}
  removeListener(e,f){return this.off(e,f);}
  removeAllListeners(e){if(e===undefined)this._events.clear();else this._events.delete(e);return this;}
  listenerCount(e){return (this._events.get(e)||[]).length;}
  emit(e,...args){const list=[...(this._events.get(e)||[])];if(e==='error'&&!list.length)throw args[0];for(const f of list)f(...args);return !!list.length;}
}
const timers=new Set();
const nowMs=()=>N.now();
function timer(fn,ms,repeat,args){const t={fn,ms:Math.max(1,Number(ms)||1),at:nowMs()+Math.max(1,Number(ms)||1),repeat,args,referenced:true,unref(){this.referenced=false;return this;},ref(){this.referenced=true;return this;}};timers.add(t);return t;}
globalThis.setTimeout=(fn,ms,...args)=>timer(fn,ms,false,args);
globalThis.setInterval=(fn,ms,...args)=>timer(fn,ms,true,args);
globalThis.setImmediate=(fn,...args)=>timer(fn,0,false,args);
globalThis.clearTimeout=globalThis.clearInterval=globalThis.clearImmediate=t=>timers.delete(t);
const once=(emitter,event)=>new Promise((resolve,reject)=>{const ok=(...a)=>{emitter.off('error',fail);resolve(a);};const fail=e=>{emitter.off(event,ok);reject(e);};emitter.once(event,ok);if(event!=='error')emitter.once('error',fail);});
const inspect=v=>typeof v==='string'?v:v instanceof Error?String(v)+'\n'+(v.stack||''):typeof v==='bigint'?v+'n':JSON.stringify(v,(_,x)=>typeof x==='bigint'?x+'n':x);
globalThis.console={log:(...args)=>N.print(args.map(inspect).join(' ')+'\n',1),error:(...args)=>N.print(args.map(inspect).join(' ')+'\n',2),warn:(...args)=>N.print(args.map(inspect).join(' ')+'\n',2)};
const process=new EventEmitter();globalThis.process=process;
process.argv=['elf2jb',__entry,...JSON.parse(__argumentsJSON)];process.execPath='elf2jb';process.pid=__workerId;process.exitCode=0;
process.env=JSON.parse(__environmentJSON);process.cwd=()=>__cwd;
process.stdin=new EventEmitter();process.stdin.isTTY=false;process.stdout=new EventEmitter();process.stdout.write=s=>N.print(String(s),1);
process.stderr={write:s=>N.print(String(s),2)};process.exit=code=>{globalThis.__exit=code||0;};process.nextTick=(f,...a)=>Promise.resolve().then(()=>f(...a));
if(__hasParent){process.connected=true;process.send=value=>N.message(0,3,JSON.stringify(value));}
const path={
  isAbsolute:p=>p.startsWith('/'),
  normalize(p){const absolute=p.startsWith('/'),out=[];for(const part of p.split('/'))if(part&&part!=='.'){if(part==='..'&&out.length&&out[out.length-1]!=='..')out.pop();else if(part!=='..'||!absolute)out.push(part);}return (absolute?'/':'')+out.join('/')||'.';},
  join(...p){return this.normalize(p.filter(Boolean).join('/'));},
  resolve(...p){let result='';for(const part of p){if(this.isAbsolute(part))result=part;else result+='/'+part;}return this.normalize(result.startsWith('/')?result:this.join(__cwd,result));},
  dirname(p){p=this.normalize(p);if(p==='/')return '/';const at=p.lastIndexOf('/');return at<0?'.':at===0?'/':p.slice(0,at);},
  basename(p){return p.replace(/\/+$/,'').split('/').pop();},
  relative(from,to){const a=path.resolve(from).split('/').filter(Boolean),b=path.resolve(to).split('/').filter(Boolean);let i=0;while(i<a.length&&i<b.length&&a[i]===b[i])i++;return [...a.slice(i).map(()=>'..'),...b.slice(i)].join('/');},
};
// Resolve relative paths against this interpreter's cwd, never process-wide chdir.
path.resolve=function(...parts){let result=__cwd;for(const part of parts)if(part)result=part.startsWith('/')?part:result+'/'+part;return path.normalize(result);};
const abs=p=>{const resolved=path.resolve(String(p));return __platform==='ps5'&&resolved.startsWith('/tmp/')?'/data/elf2jb/tmp/'+resolved.slice(5):resolved;};
const wrapStat=s=>Object.assign(s,{isDirectory:()=>s.kind===1,isFile:()=>s.kind===2,isSymbolicLink:()=>s.kind===3});
const flags=N.flags;
const flagBits=value=>{if(typeof value==='number')return value;const table={r:flags.O_RDONLY,'r+':flags.O_RDWR,w:flags.O_WRONLY|flags.O_CREAT|flags.O_TRUNC,'w+':flags.O_RDWR|flags.O_CREAT|flags.O_TRUNC,wx:flags.O_WRONLY|flags.O_CREAT|flags.O_EXCL,'wx+':flags.O_RDWR|flags.O_CREAT|flags.O_EXCL,a:flags.O_WRONLY|flags.O_CREAT|flags.O_APPEND};if(!(value in table))throw Error('Unsupported open flag '+value);return table[value];};
const writeBytes=(fd,bytes,offset=0,length=bytes.length-offset,position=-1)=>N.io(fd,1,bytes.buffer,bytes.byteOffset+offset,length,position);
const fs={
  readFileSync(p,encoding){const b=Buffer.from(N.readFile(abs(p)));return encoding?b.toString(typeof encoding==='string'?encoding:encoding.encoding):b;},
  writeFileSync(p,data,opts={}){if(typeof opts==='string')opts={encoding:opts};const b=Buffer.isBuffer(data)?data:Buffer.from(data,opts.encoding);const fd=N.fs('open',abs(p),flagBits(opts.flag||'w'),opts.mode??0o666);try{let at=0;while(at<b.length){const n=writeBytes(fd,b,at);if(!n)throw Error('Short file write');at+=n;}}finally{N.fs('close',fd);}},
  appendFileSync(p,data,opts={}){return this.writeFileSync(p,data,{...opts,flag:'a'});},
  existsSync(p){try{N.fs('stat',abs(p));return true;}catch{return false;}},
  statSync:p=>wrapStat(N.fs('stat',abs(p))),lstatSync:p=>wrapStat(N.fs('lstat',abs(p))),
  mkdirSync(p,opts={}){p=abs(p);if(opts.recursive){let current='';for(const part of p.split('/').filter(Boolean)){current+='/'+part;try{N.fs('mkdir',current,opts.mode??0o777);}catch(e){if(e.code!=='EEXIST'||!fs.statSync(current).isDirectory())throw e;}}}else N.fs('mkdir',p,typeof opts==='number'?opts:opts.mode??0o777);},
  readdirSync(p,opts={}){const names=N.fs('readdir',abs(p));return opts.withFileTypes?names.map(name=>Object.assign(fs.lstatSync(path.join(abs(p),name)),{name})):names;},
  mkdtempSync(prefix){return N.fs('mkdtemp',abs(prefix)+'XXXXXX');},
  rmSync(p,opts={}){try{const s=fs.lstatSync(p);if(s.isDirectory()){if(!opts.recursive)throw Error('recursive removal required');for(const name of fs.readdirSync(p))fs.rmSync(path.join(abs(p),name),opts);N.fs('rmdir',abs(p));}else N.fs('unlink',abs(p));}catch(e){if(!opts.force||e.code!=='ENOENT')throw e;}},
  unlinkSync:p=>N.fs('unlink',abs(p)),rmdirSync:p=>N.fs('rmdir',abs(p)),chmodSync:(p,mode)=>N.fs('chmod',abs(p),mode),
  renameSync:(a,b)=>N.fs('rename',abs(a),abs(b)),linkSync:(a,b)=>N.fs('link',abs(a),abs(b)),
  symlinkSync:(a,b)=>N.fs('symlink',abs(a),abs(b)),
  copyFileSync(a,b){fs.writeFileSync(b,fs.readFileSync(a));},
  cpSync(a,b,opts={}){if(fs.lstatSync(a).isDirectory()){if(!opts.recursive)throw Error('recursive copy required');fs.mkdirSync(b,{recursive:true,mode:0o700});for(const name of fs.readdirSync(a))fs.cpSync(path.join(abs(a),name),path.join(abs(b),name),opts);}else fs.copyFileSync(a,b);},
};
const fsp={};for(const name of ['readFile','writeFile','appendFile','stat','lstat','mkdir','readdir','mkdtemp','rm','unlink','rmdir','chmod','rename','link','copyFile','cp'])fsp[name]=async(...args)=>fs[name+'Sync'](...args);
fsp.statfs=async p=>N.fs('statfs',abs(p));
fsp.open=async(p,flag,mode=0o666)=>{const fd=N.fs('open',abs(p),flagBits(flag),mode);return {fd,async close(){N.fs('close',fd);},async stat(){return wrapStat(N.fs('fstat',fd));},async read(b,offset=0,len=b.length-offset,position=-1){return {bytesRead:N.io(fd,0,b.buffer,b.byteOffset+offset,len,position),buffer:b};},async write(b,offset=0,len=b.length-offset,position=-1){return {bytesWritten:writeBytes(fd,b,offset,len,position),buffer:b};},async sync(){N.fs('sync',fd);}};};
fs.promises=fsp;
if(__platform==='ps5')fs.mkdirSync('/data/elf2jb/tmp',{recursive:true,mode:0o700});
class Stream extends EventEmitter {
  pipe(target,opts={}){this.on('data',b=>target.write(b));if(opts.end!==false)this.on('end',()=>target.end());return target;}
}
fs.createWriteStream=(p,opts={})=>{
  const stream=new Stream();stream.destroyed=false;
  setImmediate(()=>{try{stream.fd=opts.fd??N.fs('open',abs(p),flagBits(opts.flags||'w'),opts.mode??0o666);stream.emit('open',stream.fd);}catch(e){stream.destroyed=true;stream.emit('error',e);}});
  // fd-backed streams are immediately writable, matching Node's usage here.
  if(opts.fd!==undefined)stream.fd=opts.fd;
  const waiting=[];
  stream.write=data=>{try{if(stream.fd===undefined){waiting.push(data);return true;}const b=Buffer.isBuffer(data)?data:Buffer.from(data);let at=0;while(at<b.length){const n=writeBytes(stream.fd,b,at);if(!n)throw Error('Short stream write');at+=n;}return true;}catch(e){stream.destroyed=true;stream.emit('error',e);return false;}};
  stream.on('open',()=>{for(const data of waiting)stream.write(data);waiting.length=0;});
  stream.end=fn=>{if(stream.fd!==undefined&&opts.autoClose!==false){N.fs('close',stream.fd);stream.fd=undefined;}stream.destroyed=true;setImmediate(()=>{stream.emit('finish');if(fn)fn();});return stream;};
  return stream;
};
const crypto={
  randomBytes:n=>Buffer.from(N.random(n)),
  randomInt(a,b){if(b===undefined){b=a;a=0;}const range=b-a;if(!Number.isSafeInteger(range)||range<1||range>0x100000000)throw RangeError('randomInt range');const limit=0x100000000-(0x100000000%range);let n;do{n=crypto.randomBytes(4).readUInt32LE();}while(n>=limit);return a+n%range;},
  createHash(name){if(name!=='sha256')throw Error('Only sha256 is supported');const parts=[];return {update(data,encoding){parts.push(Buffer.isBuffer(data)?Buffer.from(data):Buffer.from(data,encoding));return this;},digest(encoding){const b=Buffer.from(N.sha256(Buffer.concat(parts).buffer));return encoding?b.toString(encoding):b;}};},
};
const sockets=new Set(),servers=new Set();
class Socket extends Stream {
  constructor(fd=null,connecting=false){super();this.fd=fd;this.connecting=connecting;this.destroyed=false;this.writableEnded=false;this.out=[];this.encoding=null;this.timeout=0;this.last=nowMs();this.ended=false;this.reference=true;sockets.add(this);}
  setNoDelay(){return this;}
  setEncoding(encoding){this.encoding=encoding;return this;}
  setTimeout(ms,fn){this.timeout=ms;if(fn)this.on('timeout',fn);this.last=nowMs();return this;}
  unref(){this.reference=false;return this;}
  write(data,encoding,fn){if(typeof encoding==='function')fn=encoding;const b=Buffer.isBuffer(data)?Buffer.from(data):Buffer.from(data,typeof encoding==='string'?encoding:undefined);if(this.destroyed){if(fn)setImmediate(()=>fn(Error('Socket closed')));return false;}this.out.push({b,at:0,fn});return true;}
  end(data){if(data!==undefined)this.write(data);this.writableEnded=true;return this;}
  destroy(error){if(this.destroyed)return this;this.destroyed=true;sockets.delete(this);if(this.fd!==null)N.socket('close',this.fd);for(const out of this.out)if(out.fn)setImmediate(()=>out.fn(error||Error('Socket closed')));this.out=[];setImmediate(()=>{if(error)this.emit('error',error);this.emit('close',!!error);});return this;}
  _tick(){if(this.destroyed)return;try{
    if(this.connecting){if(!N.socket('connected',this.fd))return;this.connecting=false;this.emit('connect');}
    for(let count=0;this.out.length&&count<16;count++){const out=this.out[0];const n=N.socket('send',this.fd,out.b.buffer,out.b.byteOffset+out.at,out.b.length-out.at);if(!n&&out.b.length>out.at)break;out.at+=n;this.last=nowMs();if(out.at===out.b.length){this.out.shift();if(out.fn)out.fn();}}
    if(this.writableEnded&&!this.out.length&&!this.sentEnd){this.sentEnd=true;N.socket('shutdown',this.fd);}
    for(let count=0;count<16&&!this.destroyed&&!this.ended;count++){const raw=N.socket('recv',this.fd);if(raw===null)break;const b=Buffer.from(raw);this.last=nowMs();if(!b.length){this.ended=true;this.emit('end');if(!this.destroyed)this.end();break;}this.emit('data',this.encoding?b.toString(this.encoding):b);}
    if(this.ended&&this.sentEnd&&!this.out.length)this.destroy();
    if(this.timeout&&nowMs()-this.last>=this.timeout){this.last=nowMs();this.emit('timeout');}
  }catch(e){this.destroy(e);}}
}
class Server extends EventEmitter {
  constructor(fn){super();if(fn)this.on('connection',fn);this.fd=null;this.listening=false;this.clients=new Set();}
  listen(port,host,fn){if(typeof host==='function'){fn=host;host=undefined;}if(fn)this.once('listening',fn);setImmediate(()=>{try{this.local=typeof port==='string';this.host=this.local?port:host||'0.0.0.0';this.fd=N.socket('listen',this.host,this.local?-1:port);this.listening=true;servers.add(this);this.emit('listening');}catch(e){this.emit('error',e);}});return this;}
  address(){return this.local?this.host:{address:this.host,family:'IPv4',port:N.socket('port',this.fd)};}
  close(fn){if(fn)this.once('close',fn);if(this.listening){N.socket('close',this.fd);this.listening=false;servers.delete(this);}this.closing=true;this._closed();return this;}
  _closed(){if(this.closing&&!this.clients.size&&!this.closeEmitted){this.closeEmitted=true;setImmediate(()=>this.emit('close'));}}
  closeAllConnections(){for(const s of this.clients)s.destroy();}
  _tick(){if(!this.listening)return;for(let i=0;i<8;i++){let fd;try{fd=N.socket('accept',this.fd);}catch(e){this.emit('error',e);return;}if(fd===null)break;const socket=new Socket(fd);this.clients.add(socket);socket.once('close',()=>{this.clients.delete(socket);this._closed();});this.emit('connection',socket);}}
}
const net={isIPv4:s=>typeof s==='string'&&s.split('.').length===4&&s.split('.').every(x=>/^(0|[1-9][0-9]{0,2})$/.test(x)&&+x<=255),createServer:fn=>new Server(fn),
  createConnection(port,host,fn){if(typeof host==='function'){fn=host;host=undefined;}const local=typeof port==='string';const s=new Socket(null,true);if(fn)s.once('connect',fn);setImmediate(()=>{try{s.fd=N.socket('connect',local?port:host||'127.0.0.1',local?-1:port);}catch(e){s.destroy(e);}});return s;},
};
const http={
  createServer(handler){const server=net.createServer(socket=>{
    let bytes=Buffer.alloc(0),handled=false;
    socket.on('error',()=>{});
    socket.on('data',b=>{if(handled)return;bytes=Buffer.concat([bytes,b]);if(bytes.length>4*1024*1024){socket.destroy();return;}
      const at=bytes.indexOf('\r\n\r\n');if(at<0)return;const header=bytes.toString('utf8',0,at),lines=header.split('\r\n');const [method,url]=lines.shift().split(' ');const headers={};
      for(const line of lines){const at=line.indexOf(':');if(at>0)headers[line.slice(0,at).toLowerCase()]=line.slice(at+1).trim();}
      if(headers['transfer-encoding']){socket.destroy(Error('Chunked HTTP requests are unsupported'));return;}
      const length=Number(headers['content-length']||0);if(!Number.isSafeInteger(length)||length<0||length>2*1024*1024){socket.destroy();return;}if(bytes.length<at+4+length)return;
      handled=true;const body=bytes.subarray(at+4,at+4+length);const req={method,url,headers,async *[Symbol.asyncIterator](){if(body.length)yield body;}};
      const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;return this;},writeHead(code,h={}){this.statusCode=code;Object.assign(this.headers,h);return this;},end(value=''){const b=Buffer.isBuffer(value)?value:Buffer.from(value);const h={...this.headers,'Content-Length':b.length,Connection:'close'};socket.write(`HTTP/1.1 ${this.statusCode} ${this.statusCode===200?'OK':'Error'}\r\n`+Object.entries(h).map(([k,v])=>k+': '+v+'\r\n').join('')+'\r\n');socket.end(b);}};
      Promise.resolve(handler(req,res)).catch(e=>{if(!socket.writableEnded)res.writeHead(500).end(JSON.stringify({error:e.message}));});
    });
  });return server;},
  request(opts,callback){const req=new EventEmitter();let timeout,parts=[];req.setTimeout=(ms,fn)=>{timeout={ms,fn};return req;};let socket;
    req.destroy=e=>{if(socket)socket.destroy(e);else if(e)req.emit('error',e);};req.write=data=>parts.push(Buffer.isBuffer(data)?data:Buffer.from(data));
    req.end=data=>{if(data!==undefined)req.write(data);const body=Buffer.concat(parts);socket=net.createConnection(opts.port,opts.host||opts.hostname||'127.0.0.1');
      if(timeout)socket.setTimeout(timeout.ms,timeout.fn);socket.on('error',e=>req.emit('error',e));let bytes=Buffer.alloc(0),response=null,length=null,received=0;
      socket.on('connect',()=>{const headers={...(opts.headers||{}),'Content-Length':body.length,Connection:'close'};socket.write(`${opts.method||'GET'} ${opts.path||'/'} HTTP/1.1\r\nHost: ${opts.host||'127.0.0.1'}\r\n`+Object.entries(headers).map(([k,v])=>k+': '+v+'\r\n').join('')+'\r\n');socket.write(body);});
      const deliver=b=>{if(!b.length)return;received+=b.length;if(length!==null&&received>length){req.destroy(Error('HTTP response exceeded Content-Length'));return;}response.emit('data',b);};
      socket.on('data',b=>{if(response){deliver(b);return;}bytes=Buffer.concat([bytes,b]);const at=bytes.indexOf('\r\n\r\n');if(at<0){if(bytes.length>65536)req.destroy(Error('HTTP headers too large'));return;}const lines=bytes.toString('utf8',0,at).split('\r\n');response=new Stream();response.statusCode=Number(lines.shift().split(' ')[1]);response.headers={};for(const line of lines){const i=line.indexOf(':');if(i>0)response.headers[line.slice(0,i).toLowerCase()]=line.slice(i+1).trim();}if(response.headers['transfer-encoding']){req.destroy(Error('Chunked HTTP responses are unsupported'));return;}if(response.headers['content-length']!==undefined)length=Number(response.headers['content-length']);callback(response);deliver(bytes.subarray(at+4));bytes=Buffer.alloc(0);});
      socket.on('end',()=>{if(!response)req.emit('error',Error('Incomplete HTTP response'));else if(length!==null&&received!==length)response.emit('error',Error('Truncated HTTP response'));else response.emit('end');});
      return req;};return req;},
};
const children=new Map();
const childProcess={spawn(executable,args,opts={}){if(executable!==process.execPath)throw Error('External programs are not supported by the PS5 host');const child=new EventEmitter();child.stdout=new Stream();child.stderr=new Stream();child.exitCode=null;child.connected=!!opts.stdio?.includes('ipc');let id;
    try{id=N.spawn(abs(args[0]),JSON.stringify(args.slice(1)),opts.cwd?abs(opts.cwd):__cwd,JSON.stringify(opts.env||process.env));}catch(e){setImmediate(()=>child.emit('error',e));return child;}
    child.pid=id;child._stdio=opts.stdio;children.set(id,child);child.send=value=>{if(!child.connected)throw Error('Child IPC is closed');N.message(id,3,JSON.stringify(value));};child.kill=(signal='SIGTERM')=>{N.message(id,signal==='SIGKILL'?9:15,'');return true;};return child;
}};
childProcess.execFile=(executable,args,opts,callback)=>{
  if(typeof opts==='function'){callback=opts;opts={};}opts=opts||{};
  const child=childProcess.spawn(executable,args,{...opts,stdio:['ignore','pipe','pipe']});
  let stdout=[],stderr=[],size=0,failure,timeout;
  const collect=target=>data=>{size+=data.length;if(size>(opts.maxBuffer??1024*1024)){failure=Error('execFile output exceeded maxBuffer');child.kill('SIGKILL');}else target.push(data);};
  child.stdout.on('data',collect(stdout));child.stderr.on('data',collect(stderr));
  if(opts.timeout)timeout=setTimeout(()=>{failure=Error('execFile timed out');child.kill('SIGTERM');},opts.timeout);
  let called=false;
  const finish=(error)=>{if(called)return;called=true;clearTimeout(timeout);if(callback)callback(error,Buffer.concat(stdout).toString(opts.encoding||'utf8'),Buffer.concat(stderr).toString(opts.encoding||'utf8'));};
  child.on('error',finish);child.on('close',code=>{if(code&&!failure){failure=Error('Child stage failed with exit code '+code);failure.code=code;}finish(failure);});
  return child;
};
const promisify=fn=>{if(typeof fn!=='function')throw TypeError('promisify requires a function');return (...args)=>new Promise((resolve,reject)=>fn(...args,(error,...values)=>error?reject(error):resolve(fn===childProcess.execFile?{stdout:values[0],stderr:values[1]}:values[0])));};
const readline={createInterface({input}){const lines=new EventEmitter();let buffer='';input.on('data',b=>{buffer+=String(b);let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i).replace(/\r$/,'');buffer=buffer.slice(i+1);lines.emit('line',line);}});input.on('end',()=>{if(buffer)lines.emit('line',buffer);lines.emit('close');});lines.close=()=>lines.emit('close');return lines;}};
const equality=(a,b)=>{if(Object.is(a,b))return true;if(a instanceof Uint8Array||b instanceof Uint8Array)return a instanceof Uint8Array&&b instanceof Uint8Array&&a.length===b.length&&a.every((v,i)=>v===b[i]);if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;const ak=Object.keys(a),bk=Object.keys(b);return ak.length===bk.length&&ak.every(k=>Object.hasOwn(b,k)&&equality(a[k],b[k]));};
const assert=(ok,message='Assertion failed')=>{if(!ok)throw Error(message);};
Object.assign(assert,{ok:assert,equal:(a,b,m)=>assert(a===b,m||`Expected ${inspect(a)} === ${inspect(b)}`),strictEqual:(a,b,m)=>assert.equal(a,b,m),notEqual:(a,b,m)=>assert(a!==b,m),deepEqual:(a,b,m)=>assert(equality(a,b),m||`Values differ: ${inspect(a)} / ${inspect(b)}`),deepStrictEqual:(a,b,m)=>assert.deepEqual(a,b,m),match:(a,re)=>assert(re.test(a),`Pattern ${re} did not match ${a}`),throws(fn,re){let caught;try{fn();}catch(e){caught=e;}assert(caught,'Expected exception');if(re)assert(re instanceof RegExp?re.test(String(caught)):caught instanceof re,`Unexpected exception ${caught}`);},async rejects(fn,re){let caught;try{await (typeof fn==='function'?fn():fn);}catch(e){caught=e;}assert(caught,'Expected rejection');if(re)assert(re instanceof RegExp?re.test(String(caught)):caught instanceof re,`Unexpected rejection ${caught}`);}});
const tests=[];function test(name,fn){tests.push([name,fn]);}
const builtins={
  'node:fs':fs,'node:fs/promises':fsp,'node:path':path,'node:net':net,'node:http':http,
  'node:crypto':crypto,'node:events':{EventEmitter,once},'node:child_process':childProcess,
  'node:readline':readline,
  'node:readline/promises':{createInterface(){throw Error('Interactive terminal unavailable; configure the PS5 LAN IPv4 address');}},
  'node:os':{tmpdir:()=>__platform==='ps5'?'/data/elf2jb/tmp':'/tmp',networkInterfaces:()=>({lan:[{family:'IPv4',internal:false,netmask:'255.255.255.0',address:N.lan()}]})},
  'node:perf_hooks':{performance:{now:nowMs}},'node:assert/strict':assert,'node:test':test,
  'node:buffer':{Buffer,isUtf8:b=>Buffer.from(b.toString()).equals(b)},
  'node:util':{isDeepStrictEqual:equality,inspect,promisify},
};
const cache=new Map();let mainModule;
function load(request,parent=__entry,isMain=false){
  if(request.startsWith('node:')){if(!(request in builtins))throw Error('Unsupported builtin '+request);return builtins[request];}
  let file=path.isAbsolute(request)?path.normalize(request):path.join(path.dirname(parent),request);
  if(cache.has(file))return cache.get(file).exports;
  const module={exports:{},filename:file};cache.set(file,module);if(isMain)mainModule=module;
  if(file.endsWith('.json')){module.exports=JSON.parse(fs.readFileSync(file,'utf8'));return module.exports;}
  const source=fs.readFileSync(file,'utf8').replace(/^#![^\n]*\n/,'\n');
  const require=request=>load(request,file);require.main=mainModule;require.resolve=request=>path.join(path.dirname(file),request);
  const fn=(0,eval)('(function(require,module,exports,__filename,__dirname){\n'+source+'\n})\n//# sourceURL='+file);
  fn(require,module,module.exports,file,path.dirname(file));return module.exports;
}
globalThis.__require=load;
const unhandled=new Map();globalThis.__rejection=(promise,reason,handled)=>{if(handled)unhandled.delete(promise);else unhandled.set(promise,{reason,at:nowMs()});};
globalThis.__tick=()=>{
  for(const row of N.events()){
    const [id,kind,data]=row;
    if(id===0){if(kind===3)process.emit('message',JSON.parse(data));else if(kind===4){if(process.listenerCount(data))process.emit(data);else globalThis.__exit=143;}continue;}
    const child=children.get(id);if(!child)continue;
    if(kind===0){child.exitCode=data;child.connected=false;child.stdout.emit('end');child.stderr.emit('end');child.emit('exit',data,null);child.emit('close',data,null);children.delete(id);}
    else if(kind===3)child.emit('message',JSON.parse(data));
    else {const fd=child._stdio?.[kind];if(typeof fd==='number'){const b=Buffer.from(data);let at=0;while(at<b.length)at+=writeBytes(fd,b,at);}else (kind===1?child.stdout:child.stderr).emit('data',Buffer.from(data));}
  }
  const now=nowMs();for(const t of [...timers])if(timers.has(t)&&t.at<=now){if(t.repeat)t.at=now+t.ms;else timers.delete(t);t.fn(...t.args);}
  for(const server of [...servers])server._tick();
  for(const socket of [...sockets])if(socket.fd!==null)socket._tick();
  for(const {reason,at} of unhandled.values())if(now-at>250)throw reason;
  return children.size||servers.size||[...sockets].some(s=>s.reference)||[...timers].some(t=>t.referenced)||(process.connected&&process.listenerCount('message'))||unhandled.size;
};
try{
  load(__entry,__entry,true);
  if(tests.length)(async()=>{let failed=0;for(const [name,fn] of tests){const after=[];try{let watchdog;await Promise.race([fn({after:f=>after.push(f)}),new Promise((_,reject)=>{watchdog=setTimeout(()=>reject(Error('Test deadline exceeded: '+name)),30000);})]).finally(()=>clearTimeout(watchdog));console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name,e);}finally{for(const f of after.reverse())await f();}}console.log(`${tests.length-failed}/${tests.length} tests passed`);process.exitCode=failed?1:0;})();
}catch(e){console.error(e);process.exitCode=1;}
