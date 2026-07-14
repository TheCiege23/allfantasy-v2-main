#!/usr/bin/env node
/**
 * Lightweight dev launcher for staging verification.
 *
 * Why this exists: the default `npm run dev` runs `npx -y node@20 …` twice,
 * which re-resolves/downloads the Node-20 wrapper on every start. On a cold npx
 * cache (or constrained network) that intermittently HANGS at "Starting…" — the
 * exact failure that blocked browser/cron verification. This launcher:
 *   - uses the Node already on PATH (no `npx node@20` download),
 *   - skips the pre-clean step,
 *   - binds 127.0.0.1 on a fixed port,
 * so `next dev` boots deterministically.
 *
 *   npm run dev:staging-lite            # port 3010
 *   PORT=3000 npm run dev:staging-lite  # custom port
 *
 * NOTE: the project pins Node 20 for Next 14.2.35. This launcher runs whatever
 * Node is on PATH and warns if it is not 20.x — if dev fails to boot under a
 * different major, run `nvm use 20` (or install Node 20) first.
 */
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor !== 20) {
  console.warn(
    `[dev:staging-lite] Node ${process.versions.node} detected; this project pins Node 20 for Next 14.2.35.\n` +
      `[dev:staging-lite] If the server fails to boot, switch to Node 20 (e.g. \`nvm use 20\`) and re-run.`,
  )
}

const port = process.env.PORT || '3010'
process.env.AF_NEXT_DIST_DIR = process.env.AF_NEXT_DIST_DIR || '.next-dev-local'
process.env.NODE_OPTIONS = process.env.NODE_OPTIONS || '--max-old-space-size=4096'

const nextBin = path.join('node_modules', 'next', 'dist', 'bin', 'next')
if (!fs.existsSync(nextBin)) {
  console.error(`[dev:staging-lite] ${nextBin} not found — run \`npm install\` first.`)
  process.exit(1)
}

console.log(`[dev:staging-lite] starting next dev on http://127.0.0.1:${port} (no npx, no clean)`)
const child = spawn(process.execPath, [nextBin, 'dev', '-p', port, '--hostname', '127.0.0.1'], {
  stdio: 'inherit',
  env: process.env,
})
child.on('exit', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
  console.error('[dev:staging-lite] failed to launch next dev:', err.message)
  process.exit(1)
})
