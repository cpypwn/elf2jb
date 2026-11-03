const fs = require('node:fs/promises');
const path = require('node:path');

function runDirectory(error, runsRoot) {
  const match = /(?:^|\n)Details: ([^\n]+)/.exec(String(error?.message || ''));
  if (!match) return null;
  const directory = path.resolve(match[1].trim());
  if (path.dirname(directory) !== path.resolve(runsRoot) ||
      !/^switch2-[A-Za-z0-9_-]+$/.test(path.basename(directory))) return null;
  return directory;
}

async function tail(file, maximum = 16384) {
  const handle = await fs.open(file, 'r');
  try {
    const {size} = await handle.stat();
    const bytes = Buffer.alloc(Math.min(size, maximum));
    const {bytesRead} = await handle.read(bytes, 0, bytes.length, size - bytes.length);
    return bytes.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

async function inspectFailure(error, runsRoot) {
  const directory = runDirectory(error, runsRoot);
  if (!directory) return null;
  const details = {directory};
  try {
    const pipeline = JSON.parse(await fs.readFile(path.join(directory, 'switch2/pipeline.json'), 'utf8'));
    const failed = pipeline.stages?.findLast(stage => stage.status === 'failed');
    if (failed) {
      details.stage = failed.name;
      details.stageError = String(failed.error || '').split('\n').slice(0, 8).join('\n');
    }
    if (pipeline.error) details.pipelineError = String(pipeline.error).split('\n').slice(0, 8).join('\n');
  } catch (readError) {
    if (readError.code === 'ENOENT') return null;
    details.pipelineReadError = readError.message;
  }
  if (details.stage !== 'FS read, write and restoration') return details;
  try {
    const log = await tail(path.join(directory, 'switch2/acquisition.log'));
    details.acquisitionTail = log.split('\n').filter(Boolean).slice(-16)
      .map(line => line.slice(0, 500)).join('\n');
  } catch (readError) {
    details.acquisitionReadError = readError.message;
  }
  try {
    const reports = (await fs.readdir(path.join(directory, 'switch2/memory')))
      .filter(name => /^reserved-gap-[0-9]+\.json$/.test(name)).sort();
    if (reports.length) details.probeReport = path.join(directory, 'switch2/memory', reports.at(-1));
  } catch (readError) {
    details.probeReadError = readError.message;
  }
  return details;
}

module.exports = {runDirectory, inspectFailure};
