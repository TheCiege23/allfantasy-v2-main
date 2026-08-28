#!/usr/bin/env node
/**
 * Copy the tracked hooks in `.githooks/` into this repo's active hooks directory.
 *
 * WHY A COPY RATHER THAN `core.hooksPath=.githooks`
 * This repo already sets `core.hooksPath` to an absolute path
 * (`<primary>/.git/hooks`), and the ~70 worktrees SHARE that config, which is
 * what makes one install cover all of them. Repointing hooksPath at `.githooks`
 * would silently orphan the existing `post-merge` hook that lives in the current
 * directory. Copying adds a hook without touching that arrangement.
 *
 * Only files present in `.githooks/` are written. Anything already in the hooks
 * directory and not tracked here is left alone.
 */

import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const src = join(root, '.githooks')

if (!existsSync(src)) {
  console.error(`hooks:install — no .githooks/ at ${src}; nothing to do.`)
  process.exit(0)
}

// Honour an explicit hooksPath; fall back to the shared common dir so this is
// correct from inside a worktree, where `.git` is a file, not a directory.
let dest
try {
  dest = execFileSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' }).trim()
} catch {
  dest = ''
}
if (!dest) {
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim()
  dest = join(resolve(root, common), 'hooks')
}
mkdirSync(dest, { recursive: true })

let installed = 0
let unchanged = 0
for (const name of readdirSync(src)) {
  const from = join(src, name)
  const to = join(dest, name)

  // 🛑 WRITE LF, ALWAYS. `core.autocrlf` is true on the Windows checkouts this
  // repo runs from, so a tracked `#!/bin/sh` hook arrives with CRLF. A CRLF
  // shebang is `/bin/sh\r` to the kernel: it fails with "bad interpreter" on
  // macOS and Linux, and a pre-push hook that cannot execute makes git ABORT
  // THE PUSH. That turns a cost guard into a deploy outage -- the exact failure
  // the guard is written to avoid. Git Bash happens to tolerate it, which is
  // why this would have shipped unnoticed from here.
  const body = readFileSync(from, 'utf8').replace(/\r\n/g, '\n')

  if (existsSync(to) && readFileSync(to, 'utf8') === body) {
    unchanged++
    continue
  }
  writeFileSync(to, body, 'utf8')
  try {
    chmodSync(to, 0o755) // No-op on Windows; required everywhere else.
  } catch {}
  console.log(`hooks:install — installed ${name}`)
  installed++
}

console.log(
  `hooks:install — ${installed} installed, ${unchanged} already current, into ${dest}`,
)
