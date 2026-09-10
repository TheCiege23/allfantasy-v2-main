#!/usr/bin/env node
/**
 * Every League read under `lib/core-app/` must go through `loadLeagueFor`.
 *
 * 🛑 WHY A GUARD AND NOT A CODE REVIEW. `?league=` is one query parameter driving
 * a dozen loaders, and twelve of them independently wrote
 * `prisma.league.findUnique({ where: { id: leagueId } })` with no `userId`
 * clause, then used `userId` only to locate the viewer's own team. A signed-in
 * non-member got the whole screen. Measured 2026-09-10 with two real sessions,
 * counting occurrences of another user's real league name in the HTML:
 *
 *   /core 0   /core/my-team 1   /core/matchup 2
 *   /core/standings 2   /core/trades 5   /core/waivers 2      (all HTTP 200)
 *
 * Gating them one at a time is what produced that table in the first place: each
 * fix was correct and the set was not, and the thirteenth loader is the one that
 * forgets. The chokepoint only holds if something refuses the ungated form, so
 * this refuses it.
 *
 * THE RULE. Under `lib/core-app/`, a line matching `prisma.league.find*` is a
 * violation unless the file is `loadLeagueFor.ts` itself, or the line carries an
 * exemption marker:
 *
 *   // core-app-league-read: <reason>
 *
 * on the same line or within the three lines above it.
 *
 * ⚠ THE MARKER IS NOT AN ALLOWLIST ENTRY AND IS NOT INVISIBLE. Every exemption
 * is printed on every run, with its reason, so the set of ungated reads is a
 * number somebody has to look at rather than a thing that quietly grows. An
 * exemption whose reason does not say what gates it instead is the next bug.
 *
 * Run:  node scripts/check-core-app-league-reads.mjs
 *       node scripts/check-core-app-league-reads.mjs --changed   (staged/HEAD diff only)
 *
 * Exit 1 on any unexempted read.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = process.cwd()
const SCAN_DIR = join(ROOT, 'lib', 'core-app')

/** The one file allowed to read a League row directly. It is the gate. */
const GATE_FILE = join('lib', 'core-app', 'loadLeagueFor.ts')

/**
 * Per-file counts of ungated reads that already existed when this guard landed.
 *
 * ⚠ A BASELINE, NOT AN ALLOWLIST, AND KEYED ON FILE RATHER THAN LINE. Sixteen
 * ungated reads predate this guard and cannot all be traced in one change; a
 * per-line marker would have meant writing sixteen justifications I had not
 * verified, which is worse than counting them honestly. Line numbers drift on
 * every edit, so the key is the file and the value is how many it is allowed to
 * have. Adding one to a listed file fails. Adding a new file fails. The number
 * can only go down, and `--update-baseline` refuses to raise it.
 */
const BASELINE_FILE = join(ROOT, 'scripts', 'core-app-league-read-baseline.json')

const READ_PATTERN = /prisma\s*\.\s*league\s*\n?\s*\.\s*(findUnique|findFirst|findMany)/
const MARKER = /core-app-league-read:\s*(.+)$/
const MARKER_LOOKBACK = 3

function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full))
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/**
 * ⚠ COMMENTS AND STRINGS ARE STRIPPED FIRST, AND THAT IS LOAD-BEARING HERE.
 * `loadLeagueFor.ts`'s own docblock quotes `prisma.league.findUnique` while
 * explaining why nobody else may write it, and this file does too. A raw scan
 * flags the prose that documents the rule instead of a violation of it — the
 * same trap `league-dashboard-honesty-gates.test.ts` records.
 */
function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))
    .replace(/`(?:[^`\\]|\\[\s\S])*`/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/'(?:[^'\\\n]|\\.)*'/g, (m) => ' '.repeat(m.length))
    .replace(/"(?:[^"\\\n]|\\.)*"/g, (m) => ' '.repeat(m.length))
}

/**
 * The `where:` clause of the read starting at `start`, and nothing else.
 *
 * Brace-balanced from the `where:` token so a nested filter is captured whole
 * and the following `select:` never is — `select` routinely names `userId`-ish
 * columns, and counting those as scoping would clear every ungated read in the
 * directory.
 */
function whereClause(lines, start) {
  const text = lines.slice(start, start + 14).join('\n')
  const at = text.indexOf('where:')
  if (at === -1) return null
  const open = text.indexOf('{', at)
  if (open === -1) return null
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(open, i + 1)
    }
  }
  return text.slice(open)
}

function changedFiles() {
  try {
    const out = execSync('git diff --name-only HEAD', { encoding: 'utf8' })
    return new Set(
      out
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => l.split('/').join(sep)),
    )
  } catch {
    return null
  }
}

function main() {
  const onlyChanged = process.argv.includes('--changed')
  const changed = onlyChanged ? changedFiles() : null

  const violations = []
  const exemptions = []
  const scoped = []

  for (const file of sourceFiles(SCAN_DIR)) {
    const rel = relative(ROOT, file)
    if (rel === GATE_FILE) continue
    if (changed && !changed.has(rel)) continue

    const raw = readFileSync(file, 'utf8')
    const stripped = stripCommentsAndStrings(raw)
    const rawLines = raw.split(/\r?\n/)
    const lines = stripped.split(/\r?\n/)

    for (let i = 0; i < lines.length; i += 1) {
      /*
       * ⚠ THE READ IS ANCHORED ON THE LINE THAT NAMES `prisma.league`, NOT ON
       * ANY LINE THE PATTERN HAPPENS TO SPAN. Joining line i with i+1 to catch a
       * `prisma.league\n  .findUnique(` chain made the pattern true for BOTH
       * lines, so every chained read was reported twice — once against itself and
       * once against the unrelated line above it (a function signature, a
       * comment). A duplicate finding pointing at the wrong line is how a real
       * one gets dismissed as noise.
       */
      if (!/prisma\s*\.\s*league\s*$|prisma\s*\.\s*league\s*\./.test(lines[i])) continue
      const probe = lines[i] + '\n' + (lines[i + 1] ?? '')
      if (!READ_PATTERN.test(probe)) continue

      /*
       * A read whose own `where` already names the viewer is scoped by
       * construction — `findMany({ where: { userId } })` over the caller's own
       * leagues cannot return someone else's. Those need no gate and no marker;
       * requiring one would make the guard noisy enough to be ignored, which is
       * the failure mode that matters most for a guard.
       *
       * 🛑 ONLY THE `where` CLAUSE COUNTS, AND THE FIRST VERSION GOT THIS WRONG IN
       * THE DANGEROUS DIRECTION. It tested an eight-line window from the read,
       * which swallowed whatever happened to sit nearby — so a planted
       * `findUnique({ where: { id: leagueId } })` placed just above
       * `export async function getWaiversData(leagueId: string, userId: string)`
       * was cleared as "scoped" by the `userId` in the SIGNATURE. The guard
       * reported OK on the exact violation it exists to catch, and only the
       * positive control found it. Scoping is a property of the query, so only
       * the query is read.
       */
      const clause = whereClause(lines, i)
      if (clause && /\b(userId|claimedByUserId|platformUserId|creatorId)\b/.test(clause)) {
        scoped.push({ where: `${rel}:${i + 1}` })
        continue
      }

      let reason = null
      for (let back = 0; back <= MARKER_LOOKBACK && i - back >= 0; back += 1) {
        const m = MARKER.exec(rawLines[i - back])
        if (m) {
          reason = m[1].replace(/\*\/\s*$/, '').trim()
          break
        }
      }

      const where = `${rel}:${i + 1}`
      if (reason) exemptions.push({ where, reason })
      else violations.push({ where, line: rawLines[i].trim() })
    }
  }

  if (scoped.length) {
    console.log(`
${scoped.length} League read(s) already scoped inline by userId (no gate needed):`)
    for (const s2 of scoped) console.log(`  ${s2.where}`)
  }

  if (exemptions.length) {
    console.log(`\n${exemptions.length} exempted League read(s) under lib/core-app/:`)
    for (const e of exemptions) console.log(`  ${e.where}\n      ${e.reason}`)
  }

  // Per-file counts of what is ungated right now.
  const counts = {}
  for (const v of violations) {
    const f = v.where.split(':')[0].split(sep).join('/')
    counts[f] = (counts[f] ?? 0) + 1
  }

  const baseline = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) : {}

  if (process.argv.includes('--update-baseline')) {
    const next = {}
    let raised = null
    for (const [f, n] of Object.entries(counts)) {
      const was = baseline[f]
      if (was != null && n > was) raised = `${f}: ${was} -> ${n}`
      next[f] = was != null ? Math.min(was, n) : n
    }
    if (raised) {
      console.error(`\nREFUSING to raise the baseline (${raised}).`)
      console.error('It only ratchets down. Gate the new read instead.\n')
      process.exit(1)
    }
    writeFileSync(BASELINE_FILE, JSON.stringify(next, null, 2) + '\n')
    const written = Object.values(next).reduce((a, b) => a + b, 0)
    console.log(`\nBaseline written: ${Object.keys(next).length} file(s), ${written} read(s).`)
    return
  }

  const regressions = []
  for (const [f, n] of Object.entries(counts)) {
    const allowed = baseline[f] ?? 0
    if (n > allowed) regressions.push({ f, n, allowed })
  }

  if (regressions.length) {
    console.error(`\n${regressions.length} file(s) gained an ungated League read:\n`)
    for (const r of regressions) {
      console.error(`  ${r.f}   ${r.allowed} allowed, ${r.n} found`)
      for (const v of violations) {
        if (v.where.split(':')[0].split(sep).join('/') === r.f) {
          console.error(`      ${v.where}   ${v.line}`)
        }
      }
    }
    console.error(
      '\nEvery League read here must go through loadLeagueFor(userId, leagueId, select),' +
        '\nwhich refuses a non-member before the row is read. If a read genuinely cannot' +
        '\nuse it, mark the line:\n' +
        '\n  // core-app-league-read: <what gates this instead>\n',
    )
    process.exit(1)
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const allowedTotal = Object.values(baseline).reduce((a, b) => a + b, 0)
  console.log(
    `\nOK — no NEW ungated League reads under lib/core-app/.` +
      `\n  ${total} pre-existing ungated read(s) against a baseline of ${allowedTotal}.` +
      `${exemptions.length ? ` ${exemptions.length} exempted by marker.` : ''}` +
      `\n  ⚠ Those ${total} are debt, not approval — same defect shape, untraced.`,
  )
}

main()
