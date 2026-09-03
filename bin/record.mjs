#!/usr/bin/env node
/* protoreel CLI — thin wrapper over src/recorder.js.
 *
 *   protoreel <walkthrough.config.mjs> [name]     record; outputs land in config.outDir
 *   protoreel inspect <walkthrough.config.mjs>    list interactive elements (selectors) on the page
 *   protoreel --help | --version
 */
import { createRequire } from 'module';
import path from 'path';
import { pathToFileURL } from 'url';
import { record, inspect } from '../src/recorder.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const usage = `protoreel ${version} — deterministic 60fps click-through videos of HTML prototypes

Usage:
  protoreel <config.mjs> [name]      record the walkthrough in <config.mjs>; files go to config.outDir
  protoreel inspect <config.mjs>     print the page's interactive elements (real selectors) as JSON
  protoreel --help | --version

The config is an ES module: settings plus an async walkthrough({ tap, drag, hold, ... }) function.
Start from examples/walkthrough.config.example.mjs. Relative paths resolve against the config file.
Needs Google Chrome and ffmpeg. Docs: https://github.com/seq000/protoreel`;

async function loadConfig(p) {
  if (!p) throw new Error('missing config path\n\n' + usage);
  const abs = path.resolve(p);
  const mod = await import(pathToFileURL(abs).href);
  const config = mod.default || mod.config || mod;
  return { config, configDir: path.dirname(abs) };
}

const argv = process.argv.slice(2);
try {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    console.log(usage);
  } else if (argv.includes('--version') || argv.includes('-v')) {
    console.log(version);
  } else if (argv[0] === 'inspect') {
    const { config, configDir } = await loadConfig(argv[1]);
    const list = await inspect(config, { configDir });
    console.log(JSON.stringify(list, null, 2));
  } else {
    const { config, configDir } = await loadConfig(argv[0]);
    await record(config, { configDir, name: argv[1] });
  }
} catch (e) {
  console.error('protoreel:', e.message);
  process.exit(1);
}
