#!/usr/bin/env node
/* Package the Claude/Cowork plugin: a flat zip with .claude-plugin/ and skills/ at
 * the root, plus the docs and examples the skill reads at runtime.
 *   node scripts/build-plugin.mjs [outDir]     → <outDir>/protoreel-<version>.plugin
 *
 * Deliberately NOT shipped: bin/, src/ and package.json. claude.ai-hosted plugins
 * are rejected outright if they contain a top-level bin/ — those entries go on PATH
 * on the CLI without appearing on the admin approval surface, so the validator
 * refuses them. It doesn't cost anything here: since 0.1.0 the engine is on npm, and
 * the skill installs `protoreel` in the user's working directory and calls it with
 * npx. Shipping a second copy inside the plugin would only risk the two drifting.
 */
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = createRequire(import.meta.url)('../package.json');
const outDir = path.resolve(process.argv[2] || path.join(root, 'dist'));
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `protoreel-${version}.plugin`);
fs.rmSync(out, { force: true });

const include = ['.claude-plugin', 'skills', 'docs', 'examples', 'README.md', 'LICENSE', 'CONTRIBUTING.md', 'CHANGELOG.md']
  .filter(p => fs.existsSync(path.join(root, p)));
execFileSync('zip', ['-q', '-r', out, ...include, '-x', '*.DS_Store'], { cwd: root, stdio: 'inherit' });

// Guard the constraint rather than trusting the list above to stay correct.
const listed = execFileSync('unzip', ['-Z1', out], { encoding: 'utf8' }).split('\n');
const banned = listed.filter(p => /^(bin|src)\//.test(p) || p === 'package.json');
if (banned.length) {
  fs.rmSync(out, { force: true });
  console.error('build aborted — a claude.ai-hosted plugin may not ship these:\n  ' + banned.join('\n  '));
  process.exit(1);
}
console.log(path.relative(process.cwd(), out), (fs.statSync(out).size / 1024).toFixed(0) + ' KB');
