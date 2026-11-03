const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');

const STAGES = [
  ['homebrew-launcher/inspect-display.cjs'],
  ['homebrew-launcher/inspect-compatibility.cjs'],
  ['homebrew-launcher/inspect-input.cjs'],
  ['homebrew-launcher/vulkan-copy.cjs', 'display'],
  ['homebrew-launcher/launcher.cjs', 'auto'],
  ['homebrew-launcher/launcher-check.cjs', 'auto']
];

function start({runDirectory, root, onStatus = () => {}}) {
  const packageRoot = path.resolve(root);
  const directory = path.resolve(runDirectory);
  const vendor = path.join(packageRoot, 'homebrew/gpu-runtime');
  const apps = path.join(packageRoot, 'homebrew');
  const stopFile = path.join(directory, 'launcher-loop.stop');
  const reportFile = path.join(directory, 'launcher-auto-loop.json');
  let child;
  let activeFinished;
  let stopRequested = false;
  let done = false;
  let readySettled = false;
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  ready.catch(() => {});

  function report(phase, message, error) {
    try { onStatus({phase, message, ...(error ? {error: String(error)} : {})}); }
    catch (ignored) { console.log('Showcase status callback failed: ' + ignored); }
  }
  function settleReady(error) {
    if (readySettled) return;
    readySettled = true;
    if (error) readyReject(error);
    else readyResolve();
  }
  function live() {
    try {
      const result = JSON.parse(fs.readFileSync(path.join(directory, 'result.json'), 'utf8'));
      const connection = JSON.parse(fs.readFileSync(path.join(directory, 'connection.json'), 'utf8'));
      return result.verified === true && result.rpc?.mode === 'held' &&
        result.rpc?.state === 'listening' && result.fs?.verified === true &&
        result.fs?.retainedEndpoint?.ready === true &&
        connection.addresses?.session === path.basename(directory) &&
        connection.addresses?.target === 'switch2';
    } catch { return false; }
  }
  function preflight() {
    const runs = path.join(packageRoot, 'upstream/runs') + '/';
    if (!directory.startsWith(runs) || !path.basename(directory).startsWith('switch2-'))
      throw Error('Showcase requires a run from this package');
    if (!live()) throw Error('The Switch RPC session is no longer held');
    if (!fs.existsSync(path.join(vendor, STAGES[0][0])) ||
        !fs.existsSync(path.join(apps, 'ps5-showcase/app.json')) ||
        !fs.existsSync(path.join(vendor, 'homebrew-launcher/shaders/showcase-catalog.bin')))
      throw Error('Bundled Switch GPU runtime or showcase app is missing');
    if (fs.existsSync(reportFile) || fs.existsSync(stopFile))
      throw Error('The Switch GPU runtime was already used in this RPC session');
  }
  function launch(script, args = []) {
    const env = {...process.env, HB_APPS_DIR: apps, HB_AUTO_APP: '1'};
    const proc = spawn(process.execPath, [path.join(vendor, script), directory, ...args],
      {cwd: vendor, env, stdio: ['ignore', 'pipe', 'pipe']});
    child = proc;
    let tail = '';
    function output(data) {
      tail = (tail + data.toString()).slice(-8192);
    }
    proc.stdout.on('data', output);
    proc.stderr.on('data', output);
    let done = false;
    const finished = new Promise((resolve, reject) => {
      proc.once('error', error => {
        if (done) return;
        done = true;
        reject(error);
      });
      proc.once('close', code => {
        if (done) return;
        done = true;
        if (child === proc) child = null;
        if (code === 0) resolve({tail});
        else reject(Error(script + ' exited with ' + code + ': ' + tail.slice(-1800)));
      });
    });
    activeFinished = finished;
    finished.catch(() => {});
    return {proc, finished};
  }
  async function waitForFrame(proc, finished) {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      if (stopRequested) throw Error('Showcase launch stopped');
      if (!live()) throw Error('The held Switch RPC session ended');
      try {
        const loop = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
        const app = JSON.parse(fs.readFileSync(path.join(directory, 'app-runtime.json'), 'utf8'));
        if (app.active?.id === 'ps5-showcase' && loop.threadRunning === true &&
            Array.isArray(loop.batches) && loop.batches.length > 0) return;
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
      if (proc.exitCode !== null) {
        await finished;
        throw Error('The graphics loop ended before the showcase rendered a frame');
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error('The Switch GPU showcase did not confirm a rendered frame');
  }

  const completed = (async () => {
    try {
      preflight();
      for (const [script, ...args] of STAGES) {
        if (stopRequested) throw Error('Showcase launch stopped');
        if (!live()) throw Error('The held Switch RPC session ended');
        report('preparing', 'Preparing ' + script);
        await launch(script, args).finished;
      }
      if (stopRequested) throw Error('Showcase launch stopped');
      report('preparing', 'Starting the Switch GPU showcase');
      const loop = launch('homebrew-launcher/launcher-loop.cjs', ['auto']);
      await waitForFrame(loop.proc, loop.finished);
      report('running', 'The animated greeting is running on the Switch');
      settleReady();
      await loop.finished;
      const proof = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      if (!stopRequested || !proof.completed || proof.threadRunning !== false)
        throw Error('The graphics loop stopped without a verified shutdown');
      report('stopped', 'The Switch GPU showcase stopped');
      return {state: 'stopped'};
    } catch (error) {
      settleReady(error);
      if (child) child.kill('SIGTERM');
      if (activeFinished) await Promise.race([
        activeFinished.catch(() => {}),
        new Promise(resolve => setTimeout(resolve, 10000))
      ]);
      report('failed', error.message, error.message);
      return {state: 'failed', error: error.message};
    } finally {
      done = true;
      if (fs.existsSync(stopFile)) {
        try { fs.unlinkSync(stopFile); } catch (ignored) {}
      }
    }
  })();

  function stop() {
    if (done) return completed;
    if (!stopRequested) {
      stopRequested = true;
      report('stopping', 'Stopping the Switch GPU showcase');
      try { fs.writeFileSync(stopFile, 'stop\n', {flag: 'wx', mode: 0o600}); }
      catch (error) { if (error.code !== 'EEXIST') console.log('Showcase stop marker failed: ' + error); }
      if (child && !fs.existsSync(reportFile)) child.kill('SIGTERM');
    }
    return completed;
  }
  return {ready, completed, stop};
}

module.exports = {start};
