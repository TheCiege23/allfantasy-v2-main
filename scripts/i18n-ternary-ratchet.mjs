#!/usr/bin/env node
/**
 * Ratchet for inline English/Spanish ternaries in /core.
 *
 * Counts `language === 'es'`, `lang === 'es'` and `es ? …` / `spanish ? …` per file under
 * components/core-app and lib/core-app. New code should put its strings in a message catalog
 * (lib/i18n/messages.ts) instead, so a third language is one block per catalog rather than an edit
 * to every ternary.
 *
 *   node scripts/i18n-ternary-ratchet.mjs           # check: fail if any file's count rose
 *   node scripts/i18n-ternary-ratchet.mjs --update  # rewrite the baseline after migrating a file
 *
 * __tests__/core-app/i18n-ternary-ratchet.test.ts runs the same check in the unit suite.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// A string, not `new URL(...)`: under jsdom tests the global URL is jsdom's, which fileURLToPath rejects.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const BASELINE_PATH = join(ROOT, 'scripts', 'i18n-ternary-baseline.json')
const DIRS = ['components/core-app', 'lib/core-app']
export const TERNARY = /(?:\blanguage === 'es'|\blang === 'es'|\bes \?|\bspanish \?)/g

export function countTernaries() {
  const counts = {}
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(name)) {
        const n = (readFileSync(p, 'utf8').match(TERNARY) ?? []).length
        if (n > 0) counts[relative(ROOT, p).split('\\').join('/')] = n
      }
    }
  }
  for (const d of DIRS) walk(join(ROOT, d))
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

/** Files whose count is above the baseline (a new file counts against a baseline of 0). */
export function regressions(current, baseline) {
  return Object.entries(current)
    .filter(([f, n]) => n > (baseline[f] ?? 0))
    .map(([f, n]) => ({ file: f, now: n, baseline: baseline[f] ?? 0 }))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const current = countTernaries()
  if (process.argv.includes('--update')) {
    writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + '\n')
    const total = Object.values(current).reduce((a, b) => a + b, 0)
    console.log(`baseline written: ${total} ternaries in ${Object.keys(current).length} files`)
  } else {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    const bad = regressions(current, baseline)
    if (bad.length) {
      for (const r of bad) console.error(`${r.file}: ${r.baseline} -> ${r.now} inline language ternaries`)
      console.error('Put new strings in a message catalog (lib/i18n/messages.ts) instead.')
      process.exit(1)
    }
    console.log('no new inline language ternaries')
  }
}
