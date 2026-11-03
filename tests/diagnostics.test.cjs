const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {runDirectory, inspectFailure} = require('../runtime/run-diagnostics.cjs');

test('stage failure details are taken only from the named run', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elf2jb-diagnostics-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const run = path.join(root, 'switch2-test');
  fs.mkdirSync(path.join(run, 'switch2/memory'), {recursive: true});
  fs.writeFileSync(path.join(run, 'switch2/pipeline.json'), JSON.stringify({
    stages: [{name: 'FS read, write and restoration', status: 'failed', error: 'Error: sample failure\n  at probe'}],
    error: 'Error: sample failure\n  at pipeline'
  }));
  fs.writeFileSync(path.join(run, 'switch2/acquisition.log'), 'x'.repeat(20000) + '\nError: probe failed\n');
  fs.writeFileSync(path.join(run, 'switch2/memory/reserved-gap-123.json'), '{}');
  const error = Error('The run stopped.\nDetails: ' + run);
  const details = await inspectFailure(error, root);
  assert.equal(details.directory, run);
  assert.equal(details.stage, 'FS read, write and restoration');
  assert.match(details.stageError, /sample failure/);
  assert.match(details.acquisitionTail, /probe failed/);
  assert.equal(details.probeReport, path.join(run, 'switch2/memory/reserved-gap-123.json'));
  assert.equal(runDirectory(Error('Details: ' + path.join(root, '../outside')), root), null);
});

test('pre-pipeline failures do not add empty stage diagnostics', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elf2jb-diagnostics-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const run = path.join(root, 'switch2-empty');
  fs.mkdirSync(run);
  const details = await inspectFailure(Error('failure\nDetails: ' + run), root);
  assert.equal(details, null);
});
