#!/usr/bin/env node
/**
 * NFL redraft launch gate — runs non-destructive checks in sequence.
 * Does NOT run database resets or migrations.
 *
 * Covers: lineup locks, score sync, standings, waivers, trades, playoffs,
 * and draft-room/session tests scoped to the redraft product surface
 * (everything under __tests__/redraft/ plus any top-level __tests__/*.test.ts(x)
 * with "redraft" anywhere in the filename — this also catches the gNN
 * ticket-numbered suites, e.g. g32-nfl-redraft-home-dashboard.test.tsx,
 * g46b-nfl-redraft-player-media-metadata.test.ts).
 *
 * Two modes:
 *   --runtime  Vitest only — "is NFL redraft behavior safe?" (green today)
 *   --strict   Prisma validate + full `tsc --noEmit` + runtime — blocked until
 *              repo-wide TypeScript debt is cleaned up (unrelated to redraft)
 *
 * Usage (from repo root):
 *   node scripts/redraft-launch-gate.mjs --runtime
 *   node scripts/redraft-launch-gate.mjs --strict
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const mode = process.argv.includes('--strict') ? 'strict' : 'runtime'

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

function collectRedraftTestFiles() {
  const testsDir = join(root, '__tests__')
  const files = []

  for (const name of readdirSync(testsDir)) {
    if (!/\.test\.tsx?$/.test(name)) continue
    if (name.includes('redraft')) {
      files.push(`__tests__/${name}`)
    }
  }

  const redraftSubdir = join(testsDir, 'redraft')
  for (const name of readdirSync(redraftSubdir)) {
    if (!/\.test\.tsx?$/.test(name)) continue
    files.push(`__tests__/redraft/${name}`)
  }

  return files.sort()
}

function runRuntimeGate() {
  const files = collectRedraftTestFiles()
  console.log(`— Vitest (${files.length} redraft test files) —`)
  run('npx', ['vitest', 'run', ...files])
  console.log('\nNFL redraft launch gate (runtime): OK')
}

if (mode === 'strict') {
  console.log('— Prisma validate —')
  run('npx', ['prisma', 'validate'])

  console.log('— TypeScript (repo-wide) —')
  run('npm', ['run', 'typecheck'])

  runRuntimeGate()
  console.log('NFL redraft launch gate (strict): OK')
} else {
  runRuntimeGate()
}
