#!/usr/bin/env node
/* Package the Claude/Cowork plugin: a flat zip with .claude-plugin/ and skills/ at
 * the root, plus the CLI, docs and examples so the skill can read them at runtime.
 *   node scripts/build-plugin.mjs [outDir]     → <outDir>/protoreel-<version>.plugin
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

const include = ['.claude-plugin', 'skills', 'bin', 'src', 'docs', 'examples', 'package.json', 'README.md', 'LICENSE', 'CONTRIBUTING.md', 'CHANGELOG.md']
  .filter(p => fs.existsSync(path.join(root, p)));
execFileSync('zip', ['-q', '-r', out, ...include, '-x', '*.DS_Store'], { cwd: root, stdio: 'inherit' });
console.log(path.relative(process.cwd(), out), (fs.statSync(out).size / 1024).toFixed(0) + ' KB');
