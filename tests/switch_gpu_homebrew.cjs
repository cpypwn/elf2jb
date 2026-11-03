const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const childProcess = require('node:child_process');

function fixture(held) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elf2jb-gpu-'));
  const runs = path.join(root, 'upstream/runs');
  fs.mkdirSync(runs, {recursive: true});
  const runDirectory = fs.mkdtempSync(path.join(runs, 'switch2-'));
  for (const file of [
    'homebrew/gpu-runtime/homebrew-launcher/inspect-display.cjs',
    'homebrew/gpu-runtime/homebrew-launcher/shaders/showcase-catalog.bin',
    'homebrew/ps5-showcase/app.json'
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
    fs.writeFileSync(path.join(root, file), 'fixture');
  }
  fs.writeFileSync(path.join(runDirectory, 'connection.json'), JSON.stringify({
    addresses: {session: path.basename(runDirectory), target: 'switch2'}
  }));
  fs.writeFileSync(path.join(runDirectory, 'result.json'), JSON.stringify({
    verified: true,
    rpc: {mode: 'held', state: held ? 'listening' : 'closed'},
    fs: {verified: true, retainedEndpoint: {ready: true}}
  }));
  return {root, runDirectory, cleanup: () => fs.rmSync(root, {recursive: true, force: true})};
}

test('rejects a closed RPC session without changing the run', async () => {
  const f = fixture(false);
  try {
    const gpu = require('../runtime/switch-gpu-homebrew.cjs').start(f);
    await assert.rejects(gpu.ready, /no longer held/);
    assert.equal((await gpu.completed).state, 'failed');
    assert.equal((await gpu.stop()).state, 'failed');
    assert.equal(fs.existsSync(path.join(f.runDirectory, 'launcher-loop.stop')), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.runDirectory, 'result.json'))).rpc.state, 'closed');
  } finally { f.cleanup(); }
});

test('prepares the showcase, waits for a frame, and stops without closing RPC', async () => {
  const f = fixture(true);
  const originalSpawn = childProcess.spawn;
  const scripts = [];
  const timers = [];
  try {
    childProcess.spawn = (executable, args) => {
      const script = path.basename(args[0]);
      scripts.push(script);
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.exitCode = null;
      proc.kill = () => {
        proc.exitCode = 143;
        setImmediate(() => proc.emit('close', 143));
        return true;
      };
      if (script !== 'launcher-loop.cjs') {
        setImmediate(() => {proc.exitCode = 0; proc.emit('close', 0);});
        return proc;
      }
      const report = path.join(f.runDirectory, 'launcher-auto-loop.json');
      fs.writeFileSync(report, JSON.stringify({threadRunning: true, batches: [{status: 'continuous'}]}));
      fs.writeFileSync(path.join(f.runDirectory, 'app-runtime.json'), JSON.stringify({active: {id: 'ps5-showcase'}}));
      const timer = setInterval(() => {
        if (!fs.existsSync(path.join(f.runDirectory, 'launcher-loop.stop'))) return;
        clearInterval(timer);
        fs.writeFileSync(report, JSON.stringify({threadRunning: false, completed: new Date().toISOString()}));
        proc.exitCode = 0;
        proc.emit('close', 0);
      }, 10);
      timers.push(timer);
      return proc;
    };
    delete require.cache[require.resolve('../runtime/switch-gpu-homebrew.cjs')];
    const phases = [];
    const gpu = require('../runtime/switch-gpu-homebrew.cjs').start({...f, onStatus: update => phases.push(update.phase)});
    await gpu.ready;
    assert.equal(phases.at(-1), 'running');
    assert.equal((await gpu.stop()).state, 'stopped');
    assert.deepEqual(scripts, [
      'inspect-display.cjs', 'inspect-compatibility.cjs', 'inspect-input.cjs',
      'vulkan-copy.cjs', 'launcher.cjs', 'launcher-check.cjs', 'launcher-loop.cjs'
    ]);
    assert.equal(fs.existsSync(path.join(f.runDirectory, 'launcher-loop.stop')), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.runDirectory, 'result.json'))).rpc.state, 'listening');
  } finally {
    for (const timer of timers) clearInterval(timer);
    childProcess.spawn = originalSpawn;
    delete require.cache[require.resolve('../runtime/switch-gpu-homebrew.cjs')];
    f.cleanup();
  }
});
