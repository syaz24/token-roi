#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Project Token ROI launcher.
 *
 * Boots the bundled Next standalone server on the loopback interface, applies
 * migrations, indexes verified local sources, and opens a browser.
 *
 * Everything stays on this machine: the server binds to 127.0.0.1 and the app
 * makes no outbound requests.
 */

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DEFAULT_PORT = 4783;
const HOST = '127.0.0.1';

const c = {
  dim: (s) => `[2m${s}[0m`,
  bold: (s) => `[1m${s}[0m`,
  red: (s) => `[31m${s}[0m`,
  yellow: (s) => `[33m${s}[0m`,
  green: (s) => `[32m${s}[0m`,
  violet: (s) => `[35m${s}[0m`,
};

function parseArgs(argv) {
  const opts = { port: DEFAULT_PORT, open: true, scanOnly: false, db: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--version' || a === '-v') opts.version = true;
    else if (a === '--no-open') opts.open = false;
    else if (a === '--scan') opts.scanOnly = true;
    // Track whether the port was chosen deliberately: an explicit --port that
    // is busy should fail loudly, while the default may quietly move up.
    else if (a === '--port' || a === '-p') {
      opts.port = Number(argv[++i]);
      opts.portExplicit = true;
    } else if (a.startsWith('--port=')) {
      opts.port = Number(a.slice(7));
      opts.portExplicit = true;
    }
    else if (a === '--db') opts.db = argv[++i];
    else if (a.startsWith('--db=')) opts.db = a.slice(5);
    else {
      console.error(c.red(`Unknown option: ${a}`));
      opts.help = true;
    }
  }
  return opts;
}

function help() {
  const { version } = require(path.join(ROOT, 'package.json'));
  console.log(`
${c.bold('Project Token ROI')} ${c.dim(`v${version}`)}
Local-first analytics for AI coding-agent token spend.

${c.bold('Usage')}
  npx token-roi [options]

${c.bold('Options')}
  -p, --port <n>   Port to serve on            ${c.dim(`(default ${DEFAULT_PORT})`)}
      --db <path>  Database file to use        ${c.dim('(default ~/.project-token-roi/token-roi.db)')}
      --scan       Index sources, print a report, then exit
      --no-open    Do not open a browser
  -v, --version    Print version
  -h, --help       Show this help

${c.bold('Notes')}
  The server binds to ${HOST} only and makes no outbound network requests.
  Your AI history files are read-only; nothing is modified or uploaded.
`);
}

/** better-sqlite3 is native. Fail early with something actionable. */
function checkNativeModule() {
  try {
    require('better-sqlite3');
    return true;
  } catch (err) {
    const major = Number(process.versions.node.split('.')[0]);
    const lts = major % 2 === 0;
    console.error(`
${c.red('Could not load the SQLite engine (better-sqlite3).')}

${c.dim(String(err && err.message).split('\n')[0])}

This is a native module. It ships prebuilt binaries for ${c.bold('Node 20 and 22 LTS')};
on other releases it must compile from source, which needs a C++ toolchain.

You are running ${c.bold(`Node ${process.versions.node}`)}${lts ? '' : c.yellow(' (not an LTS release)')}.

${c.bold('Try, in order:')}
  1. ${c.violet('npm rebuild better-sqlite3 --foreground-scripts')}
  2. If npm blocked the install script:  ${c.violet('npm approve-scripts')}
  3. Switch to Node 20 or 22 LTS and re-run.  ${c.dim('(nvm install 22 && nvm use 22)')}
`);
    return false;
  }
}

function openBrowser(url) {
  const cmd =
    process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref();
  } catch {
    /* opening a browser is a convenience, never a hard failure */
  }
}

/** Is something already listening on this port? */
function portInUse(port) {
  const net = require('node:net');
  return new Promise((resolve) => {
    const probe = net
      .createServer()
      .once('error', (e) => resolve(e.code === 'EADDRINUSE'))
      .once('listening', () => probe.close(() => resolve(false)))
      .listen(port, HOST);
  });
}

/** First free port at or after `from`, so a busy port is never a dead end. */
async function findFreePort(from, attempts = 20) {
  for (let p = from; p < from + attempts; p++) {
    if (!(await portInUse(p))) return p;
  }
  return null;
}

/**
 * If the desired port is taken it is usually another copy of this app, or a dev
 * server. Say so plainly and move to the next free port rather than dying with
 * an EADDRINUSE stack trace.
 */
async function resolvePort(requested, wasExplicit) {
  if (!(await portInUse(requested))) return requested;

  if (wasExplicit) {
    console.error(
      `\n${c.red(`Port ${requested} is already in use.`)}\n` +
        c.dim('  Another copy of this app, or a dev server, is probably running.\n') +
        c.dim(`  Stop it, or choose another port:  `) +
        c.violet(`npx token-roi --port ${requested + 1}`) +
        '\n',
    );
    process.exit(1);
  }

  const free = await findFreePort(requested + 1);
  if (free == null) {
    console.error(c.red(`\nPorts ${requested}-${requested + 20} are all in use.\n`));
    process.exit(1);
  }
  console.log(
    `${c.yellow(`Port ${requested} is in use`)} ${c.dim('(another copy of this app, or a dev server)')}\n` +
      `${c.dim('Using')} ${c.violet(String(free))} ${c.dim('instead.')}`,
  );
  return free;
}

async function waitForServer(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const pkg = require(path.join(ROOT, 'package.json'));

  if (opts.version) return console.log(pkg.version);
  if (opts.help) return help();

  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) {
    console.error(c.red(`Node 20 or newer is required. You are running ${process.versions.node}.`));
    process.exit(1);
  }

  if (opts.db) process.env.TOKEN_ROI_DB = path.resolve(opts.db);
  if (!checkNativeModule()) process.exit(1);

  // Migrations and seeding are safe to repeat.
  const { runMigrations } = require(path.join(ROOT, 'dist/setup.cjs'));
  const { dbFile } = runMigrations();

  if (opts.scanOnly) {
    const { scanAll } = require(path.join(ROOT, 'dist/setup.cjs'));
    await scanAll();
    return;
  }

  const server = path.join(ROOT, '.next', 'standalone', 'server.js');
  if (!fs.existsSync(server)) {
    console.error(
      c.red('This package is missing its production build.') +
        `\nExpected: ${server}\n` +
        c.dim('If you are running from a git clone, use `npm run dev` instead.\n'),
    );
    process.exit(1);
  }

  console.log(`
${c.bold('Project Token ROI')} ${c.dim(`v${pkg.version}`)}
${c.dim('Database:')} ${dbFile}`);

  const port = await resolvePort(opts.port, opts.portExplicit);
  const url = `http://${HOST}:${port}`;
  console.log(`${c.dim('Starting on')} ${c.violet(url)} ${c.dim('(loopback only)')}\n`);

  const child = spawn(process.execPath, [server], {
    cwd: path.join(ROOT, '.next', 'standalone'),
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      HOSTNAME: HOST,
      PORT: String(port),
      NODE_ENV: 'production',
    },
  });

  child.on('exit', (code) => process.exit(code ?? 0));
  const shutdown = () => {
    child.kill();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (await waitForServer(url)) {
    console.log(
      `${c.green('Ready.')} ${c.dim('Indexing your local AI history on first load — this can take a few seconds.')}\n` +
        `${c.dim('Press Ctrl+C to stop.')}\n`,
    );
    if (opts.open) openBrowser(url);
  } else {
    console.error(c.red(`Server did not become ready at ${url}.`));
  }
}

main().catch((err) => {
  console.error(c.red(String((err && err.stack) || err)));
  process.exit(1);
});
