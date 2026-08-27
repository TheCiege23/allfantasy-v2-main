#!/usr/bin/env node
'use strict'

/**
 * Parse every stylesheet in the repo and fail on a syntax error.
 *
 * ⚠ WHY THIS EXISTS. On 2026-08-27 production could not build for ~15 minutes
 * across four consecutive deploys. The cause was two characters: the 38a suite
 * appended its rules to `af-core.css` and `af-core-shell.css` by reusing each
 * file's final `}` as its own closing brace, leaving `:root` and
 * `.af-nav-grouplabel` unterminated. Nothing in the repo parses CSS — not tsc,
 * not vitest, not eslint, not any `check-*` guard — so the first thing to read
 * those files was `next build` on Vercel, in production, after the push.
 *
 * The failure is also maximally confusing when it does land: postcss reports
 * "Unclosed block" at the line where the *unterminated rule opens*, which is
 * several hundred lines from the append that actually broke it, and points at a
 * rule that is visibly fine. Catching it here names the file before anyone
 * reads a stack trace out of a build log.
 *
 * Deliberately parse-only — this is a syntax gate, not a linter. It has no
 * opinion on ordering, naming, duplication or specificity, so it can never
 * fail on a stylistic judgement call and get itself disabled.
 *
 * Runs standalone (`npm run check:css`) and from `vercel-next-build.cjs` before
 * `next build`. Do not make it depend on git — Vercel's build container has no
 * `.git`, so a `git ls-files` version of this would silently check nothing.
 */

const fs = require('fs')
const path = require('path')
const postcss = require('postcss')

const repoRoot = path.resolve(__dirname, '..')

// Build output and vendored code are not ours to validate, and the dist dir in
// particular holds generated CSS that can legitimately be minified past what a
// strict parse likes. `_backup` is where vercel-next-build.cjs parks the files
// it temporarily excludes.
const SKIP_DIRS = new Set([
  'node_modules',
  'coverage',
  'playwright-report',
  'test-results',
  '_backup',
])

function shouldSkipDir(name) {
  // ⚠ SKIP EVERY DOT-DIRECTORY, and not just for tidiness. `.claude` alone
  // holds ~1,300 nested plugin/skill cache directories; walking it took this
  // guard from instant to >45s and made it useless as a pre-build gate. The
  // dot-dirs also cover the moving target that is the dist dir — it has been
  // `.next`, `.next-dev-3101` and `.next-coldtest-0826` — plus `.git`,
  // `.vercel`, `.turbo` and scratch repro dirs. No stylesheet the app imports
  // lives under one.
  return name.startsWith('.') || SKIP_DIRS.has(name)
}

function collectStylesheets(rootPath) {
  const found = []
  const stack = [rootPath]

  while (stack.length > 0) {
    const currentPath = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name)
      // Never follow a junction. This repo links node_modules into worktrees,
      // and a link pointing at an ancestor turns the walk into an infinite one.
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) stack.push(absolutePath)
        continue
      }
      if (entry.isFile() && entry.name.endsWith('.css')) found.push(absolutePath)
    }
  }

  return found.sort()
}

function checkCssSyntax() {
  const stylesheets = collectStylesheets(repoRoot)
  const failures = []

  for (const absolutePath of stylesheets) {
    const relativePath = path.relative(repoRoot, absolutePath).split(path.sep).join('/')
    let source
    try {
      source = fs.readFileSync(absolutePath, 'utf8')
    } catch (err) {
      failures.push({ file: relativePath, message: `could not be read (${err.message})` })
      continue
    }

    try {
      postcss.parse(source, { from: absolutePath })
    } catch (err) {
      // postcss puts the useful part in `reason`; `message` repeats the path.
      failures.push({
        file: relativePath,
        message: err.reason ?? err.message,
        line: err.line,
        column: err.column,
      })
    }
  }

  return { checked: stylesheets.length, failures }
}

function reportAndExit(prefix) {
  const { checked, failures } = checkCssSyntax()

  if (failures.length > 0) {
    console.error(`${prefix} FATAL: ${failures.length} stylesheet(s) will not parse:`)
    for (const failure of failures) {
      const where = failure.line ? `:${failure.line}:${failure.column ?? 1}` : ''
      console.error(`  - ${failure.file}${where} — ${failure.message}`)
    }
    console.error(
      `${prefix} "Unclosed block" points at where the rule OPENS, not where the brace is missing —`
    )
    console.error(`${prefix} look at the END of that rule, and at whatever was appended after it.`)
    return 1
  }

  console.log(`${prefix} CSS syntax guard: ${checked} stylesheet(s) parsed clean`)
  return 0
}

module.exports = { checkCssSyntax, reportAndExit }

if (require.main === module) {
  process.exit(reportAndExit('[check-css-syntax]'))
}
