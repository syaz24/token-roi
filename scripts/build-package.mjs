/**
 * Produces the publishable artefact.
 *
 *   1. next build            -> .next/standalone (self-contained server)
 *   2. copy static + public  -> standalone expects these beside it
 *   3. drop better-sqlite3   -> see note below
 *   4. bundle dist/setup.cjs -> plain JS entry for bin/token-roi.cjs
 *
 * (3) matters: `next build` traces node_modules into .next/standalone, which
 * would bake THIS machine's compiled better-sqlite3 binary into the tarball and
 * break every other platform. Removing it lets Node resolve upward to the copy
 * npm installs on the user's own machine, for their own OS and Node ABI.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const SA = path.join(ROOT, '.next', 'standalone');

const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });

function step(msg) {
  console.log(`\n[1m▸ ${msg}[0m`);
}

step('Building Next standalone bundle');
run('npx', ['next', 'build']);

if (!fs.existsSync(SA)) {
  console.error('next build did not produce .next/standalone — is output:"standalone" set?');
  process.exit(1);
}

step('Copying static assets into the standalone tree');
fs.cpSync(path.join(ROOT, '.next', 'static'), path.join(SA, '.next', 'static'), { recursive: true });
if (fs.existsSync(path.join(ROOT, 'public'))) {
  fs.cpSync(path.join(ROOT, 'public'), path.join(SA, 'public'), {
    recursive: true,
    // favicon.svg is a ~2 MB traced raster and is deliberately not referenced
    // by the app (see the icons block in src/app/layout.tsx). Shipping it would
    // add 2 MB to every install for nothing.
    filter: (src) => path.basename(src) !== 'favicon.svg',
  });
}

step('Removing the platform-specific SQLite binary from the bundle');
for (const dir of ['better-sqlite3', 'bindings', 'prebuild-install', 'file-uri-to-path']) {
  const target = path.join(SA, 'node_modules', dir);
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`  removed node_modules/${dir}`);
  }
}

step('Bundling the CLI setup entry');
run('npx', [
  'esbuild',
  'src/cli/setup.ts',
  '--bundle',
  '--platform=node',
  '--target=node20',
  '--format=cjs',
  '--outfile=dist/setup.cjs',
  '--external:better-sqlite3',
  '--log-level=warning',
]);

step('Verifying the artefact');
const required = [
  '.next/standalone/server.js',
  '.next/standalone/.next/static',
  '.next/standalone/public/favicon.ico',
  'dist/setup.cjs',
  'bin/token-roi.cjs',
];
let ok = true;
for (const rel of required) {
  const exists = fs.existsSync(path.join(ROOT, rel));
  console.log(`  ${exists ? '[32m✓[0m' : '[31m✗[0m'} ${rel}`);
  if (!exists) ok = false;
}
if (fs.existsSync(path.join(SA, 'node_modules', 'better-sqlite3'))) {
  console.error('  [31m✗[0m better-sqlite3 is still bundled — it would break other platforms');
  ok = false;
}
if (!ok) process.exit(1);

const size = (p) => {
  let total = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name);
    total += e.isDirectory() ? size(f) : fs.statSync(f).size;
  }
  return total;
};
console.log(`\n  standalone bundle: ${(size(SA) / 1e6).toFixed(1)} MB`);
console.log('\n[32mPackage build complete.[0m Run `npm pack --dry-run` to inspect the tarball.\n');
