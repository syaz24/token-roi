# Publishing

The published artefact is a **prebuilt Next standalone server** plus a small
plain-JS launcher. Users never run a build; `npx token-roi` downloads the
tarball and starts the server.

## What ships

| Path | Purpose |
|---|---|
| `bin/token-roi.cjs` | Launcher: preflight checks, migrations, spawns the server, opens a browser |
| `dist/setup.cjs` | esbuild bundle of the migration/scan entry, so the CLI needs no TypeScript at runtime |
| `.next/standalone/` | Self-contained production server, including `public/` and `.next/static` |
| `README.md`, `LICENSE` | |

Controlled by the `files` whitelist in `package.json`. The whitelist takes
precedence over `.gitignore`, which is why `.next/standalone` ships even though
`.next/` is git-ignored — verify with `npm pack --dry-run` after any change.

## The one non-obvious step

`next build` traces `node_modules` into `.next/standalone`, which would bake
**this machine's compiled `better-sqlite3` binary** into the tarball and break
every other platform and Node ABI.

`scripts/build-package.mjs` therefore deletes `better-sqlite3` (and `bindings`,
`prebuild-install`, `file-uri-to-path`) from the standalone tree. Node then
resolves upward from `.next/standalone/server.js` to the copy npm installs into
the package's own `node_modules` — built for the user's platform. The build
script fails loudly if the module is still present.

This is why `better-sqlite3` is the package's **only** runtime dependency.
Everything else (Next, React, Recharts, Drizzle, Zod…) is bundled into the
standalone output or into `dist/setup.cjs`, and lives in `devDependencies`.

## Native module reality

`better-sqlite3` publishes prebuilt binaries for **Node 20 and 22 LTS**. On
odd-numbered releases (21, 23, 25…) there is no prebuild, so npm compiles from
source: slow, and it needs a C++ toolchain. The launcher detects a failed load
and prints the fix rather than a stack trace.

## Release

```bash
npm run build:package     # build + verify the artefact
npm pack --dry-run        # inspect contents and size
npm publish               # runs build:package again via prepublishOnly
```

Then publish the alias so `npx project-roi` also works:

```bash
cd npm-alias/project-roi
# keep the token-roi dependency range in step with the version just published
npm publish
```

## Checklist

- [ ] `npm run typecheck`, `npm test`, `npm run test:e2e` all pass
- [ ] `npm run build:package` reports every artefact present
- [ ] `node bin/token-roi.cjs --help` and `--version` work
- [ ] `node bin/token-roi.cjs --scan --db ./tmp.db` indexes real sources
- [ ] `node bin/token-roi.cjs --port 4791 --no-open --db ./tmp.db` serves HTTP 200
- [ ] `npm pack --dry-run` shows no stray source, database or test files
- [ ] Version bumped in both `package.json` and `npm-alias/project-roi/package.json`
