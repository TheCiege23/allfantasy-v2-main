#!/usr/bin/env node
/**
 * Guards the rule that `SportsPlayer` is never looked up BY SLEEPER ID without a `sport`.
 *
 * 🛑 SLEEPER NUMBERS EACH SPORT'S PLAYERS SEPARATELY, SO A SLEEPER ID IS NOT A PERSON.
 * `SportsPlayer` holds NFL 1466 Travis Kelce (TE) beside NBA 1466 JaVale McGee (C), NFL 4866
 * Saquon Barkley beside NBA 4866 AJ Dybantsa, NFL 4984 Josh Allen beside NBA 4984 Cameron
 * Corhen — every pair `source='sleeper'`. The table's unique key is (sport, externalId, source);
 * `sleeperId` is only INDEXED, never unique. So `where: { sleeperId: { in } }` with no `sport`
 * returns both people and whichever row the caller keeps last wins.
 *
 * That shipped (fixed in #4298): `lib/trade-market/formatMarkets.ts` and
 * `completedTradeObservations.ts` read across sports, the fresher NBA row won, every NFL market
 * book labelled Kelce "JaVale McGee / C", the trade grader refused him, and real trades were
 * emailed "Not graded".
 *
 * WHAT COUNTS AS SCOPED: the `where` the call actually sends names `sport` (literal key,
 * shorthand, or `sport: { in: [...] }`), or is built by `sleeperIdWhere(ids, sport)` with BOTH
 * arguments. A `where` given as an identifier is resolved to its `const x = {...}` in the same
 * file. A `where` the guard cannot read at all is reported as UNREADABLE rather than passed —
 * an unreadable clause is how a check that cannot fail gets written.
 *
 * WHAT IS NOT CHECKED, said so rather than implied: raw SQL (`$queryRaw` with `"sleeperId"`),
 * and reads of OTHER tables keyed by a Sleeper id. `PlayerIdentityMap.sleeperId` is globally
 * `@unique` and NBA ids live in `sleeperNbaId`, so it cannot return two people.
 *
 * Usage:
 *   node scripts/check-sleeper-id-sport-scope.mjs          # exit 1 on any unallowlisted site
 *   node scripts/check-sleeper-id-sport-scope.mjs --list   # also print allowlisted sites
 *
 * The test `__tests__/player-identity/sleeper-id-sport-scope-guard.test.ts` runs this on every `npm test`
 * and proves it fires on a planted violation.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Sites allowed to look up by Sleeper id with no sport. Keyed by repo-relative path; `count`
 * is how many unscoped calls that file may hold — a NEW one in the same file still fails.
 *
 * Every entry says why a cross-sport match cannot mislabel anyone. "It is a script" is not on
 * its own a reason: scripts write production rows too.
 */
export const ALLOWLIST = {
  /*
   * Not a lookup BY id: it enumerates every sport's players that HAVE a Sleeper id, for the
   * sitemap. The id is only used to de-duplicate, and that is `distinct: ['sport', 'sleeperId']`,
   * so NFL 1466 and NBA 1466 stay two URLs. Adding a sport would drop a sport from the sitemap.
   */
  'app/sitemap.xml/route.ts': { count: 1, reason: 'enumerates all sports; distinct is (sport, sleeperId)' },
}

export const ROOTS = ['lib', 'app', 'server', 'components', 'scripts']
const EXTS = ['.ts', '.tsx', '.mjs', '.js', '.cjs']
const METHODS = [
  'findMany',
  'findFirstOrThrow',
  'findFirst',
  'findUniqueOrThrow',
  'findUnique',
  'count',
  'groupBy',
  'aggregate',
  'updateMany',
  'deleteMany',
]
const callRe = (table) => new RegExp(`\\.${table}\\s*\\??\\.\\s*([A-Za-z]+)\\s*(?:\\?\\.)?\\s*\\(`, 'g')

function isTestPath(rel) {
  return (
    /(^|\/)__tests__\//.test(rel) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) ||
    /(^|\/)(e2e|tests)\//.test(rel)
  )
}

function walk(dir, out = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      walk(full, out)
    } else if (EXTS.some((x) => e.name.endsWith(x))) {
      out.push(full)
    }
  }
  return out
}

/**
 * Blank out comments and string/template CONTENTS (keeping length, so offsets and line numbers
 * survive). Brackets inside a string or a comment otherwise derail bracket matching, and a
 * comment that merely MENTIONS `sleeperId` must not count as a filter.
 */
export function maskSource(src) {
  const out = src.split('')
  let i = 0
  const n = src.length
  const blank = (a, b) => {
    for (let k = a; k < b; k += 1) if (out[k] !== '\n') out[k] = ' '
  }
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') {
      const end = src.indexOf('\n', i)
      const stop = end < 0 ? n : end
      blank(i, stop)
      i = stop
    } else if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end < 0 ? n : end + 2
      blank(i, stop)
      i = stop
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1
      blank(i + 1, j)
      i = j + 1
    } else if (c === '`') {
      // Template: blank literal text, keep `${ ... }` expressions as code.
      let j = i + 1
      let litStart = j
      while (j < n && src[j] !== '`') {
        if (src[j] === '\\') {
          j += 2
          continue
        }
        if (src[j] === '$' && src[j + 1] === '{') {
          blank(litStart, j)
          let depth = 1
          j += 2
          while (j < n && depth > 0) {
            if (src[j] === '{') depth += 1
            else if (src[j] === '}') depth -= 1
            j += 1
          }
          litStart = j
          continue
        }
        j += 1
      }
      blank(litStart, j)
      i = j + 1
    } else {
      i += 1
    }
  }
  return out.join('')
}

/** Index just past the bracket that closes the one at `open`, or -1. */
function closeOf(masked, open) {
  let depth = 0
  for (let i = open; i < masked.length; i += 1) {
    const c = masked[i]
    if (c === '(' || c === '[' || c === '{') depth += 1
    else if (c === ')' || c === ']' || c === '}') {
      depth -= 1
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/** The `where` value at the TOP level of the call's first object argument, as source text. */
function topLevelWhere(masked, open) {
  const close = closeOf(masked, open)
  if (close < 0) return { kind: 'unreadable' }
  const inner = masked.slice(open + 1, close - 1)
  const lead = inner.length - inner.trimStart().length
  if (inner.trimStart()[0] !== '{') {
    // findMany(args) — the whole argument is a variable.
    const ident = inner.trim().match(/^([A-Za-z_$][\w$]*)\s*$/)
    return ident ? { kind: 'argIdent', name: ident[1] } : { kind: 'unreadable' }
  }
  const objOpen = open + 1 + lead
  const objClose = closeOf(masked, objOpen)
  let depth = 0
  for (let i = objOpen; i < objClose; i += 1) {
    const c = masked[i]
    if (c === '(' || c === '[' || c === '{') depth += 1
    else if (c === ')' || c === ']' || c === '}') depth -= 1
    else if (depth === 1 && masked.startsWith('where', i) && !/[\w$]/.test(masked[i - 1] ?? '')) {
      let j = i + 'where'.length
      while (/\s/.test(masked[j])) j += 1
      if (masked[j] === ',' || masked[j] === '}') return { kind: 'ident', name: 'where' } // shorthand
      if (masked[j] !== ':') continue
      j += 1
      while (/\s/.test(masked[j])) j += 1
      if (masked[j] === '{') return { kind: 'object', text: masked.slice(j, closeOf(masked, j)) }
      const rest = masked.slice(j, objClose - 1)
      const ident = rest.match(/^([A-Za-z_$][\w$]*)\s*(?:,|$)/)
      if (ident) return { kind: 'ident', name: ident[1] }
      // Anything else — a ternary, a helper call — is read as the expression text up to the
      // next top-level comma, and classified like a literal.
      return { kind: 'expr', text: splitTopLevel(rest)[0] ?? '' }
    }
  }
  return { kind: 'none' }
}

function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let cur = ''
  for (const c of text) {
    if (c === '(' || c === '[' || c === '{') depth += 1
    else if (c === ')' || c === ']' || c === '}') depth -= 1
    if (c === ',' && depth === 0) {
      parts.push(cur.trim())
      cur = ''
    } else cur += c
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

/** Resolve `name` to the nearest preceding `name = {...}` / `name: T = {...}` object literal. */
function resolveIdent(masked, name, before) {
  const re = new RegExp(`(?:const|let|var)\\s+${name.replace(/\$/g, '\\$')}\\s*(?::[^=]{1,200})?=\\s*\\{`, 'g')
  let best = -1
  let m
  while ((m = re.exec(masked)) && m.index < before) best = m.index + m[0].length - 1
  if (best < 0) return null
  return masked.slice(best, closeOf(masked, best))
}

const SLEEPER_KEY = /(?:^|[{,\s])sleeperId\s*[:,}]/
const SPORT_KEY = /(?:^|[{,\s])sport\s*[:,}]/
const HELPER_RE = /\b(sleeperIdWhere|ourIdOrSleeperIdWhere)\s*\(/g
/** A sport argument that is really "no sport". */
const NO_SPORT_ARG = /^undefined$|\?\?\s*undefined$/

/** Text of the expression assigned to `name` (`const name = <expr>`) before `before`, or null. */
function declaredExpr(masked, name, before) {
  const re = new RegExp(`(?:const|let|var)\\s+${name.replace(/\$/g, '\\$')}\\s*(?::[^=]{1,200})?=`, 'g')
  let at = -1
  let m
  while ((m = re.exec(masked)) && m.index < before) at = m.index + m[0].length
  if (at < 0) return null
  let depth = 0
  for (let i = at; i < masked.length; i += 1) {
    const c = masked[i]
    if (c === '(' || c === '[' || c === '{') depth += 1
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return masked.slice(at, i)
      depth -= 1
    } else if (depth === 0 && c === ';') return masked.slice(at, i)
    else if (depth === 0 && c === '\n' && masked.slice(at, i).trim()) {
      // A newline ends the statement unless the next line visibly continues it.
      const next = masked.slice(i + 1).match(/^\s*(\S)/)
      if (!next || !/[?:.|&+*,]/.test(next[1])) return masked.slice(at, i)
    }
  }
  return masked.slice(at)
}

/**
 * Classify one where clause's source text.
 *
 * `...ident` spreads are resolved one level to their declarations — `...sportScope` where
 * `const sportScope = league.sport ? { sport: ... } : {}` is scoped. The two Sleeper-id helpers
 * count as a sleeperId filter, scoped only when handed a real second (sport) argument.
 *
 * ⚠ A CONDITIONAL SPREAD — `...(sport ? { sport } : {})` — PASSES. The guard reads source, not
 * runtime values; whether `sport` can be empty there is the caller's contract (a `League.sport`
 * is a non-null enum, so `league.sport ? …` is always taken). That is a stated limit, not a gap
 * nobody noticed.
 */
function classifyWhereText(text, masked = '', before = 0) {
  let full = text
  for (const sm of text.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)\b(?!\s*[.(\[])/g)) {
    const expr = declaredExpr(masked, sm[1], before)
    if (expr) full += '\n' + expr
  }
  let helperSleeper = false
  let helperUnscoped = false
  HELPER_RE.lastIndex = 0
  let hm
  while ((hm = HELPER_RE.exec(full))) {
    const pOpen = hm.index + hm[0].length - 1
    const close = closeOf(full, pOpen)
    const args = splitTopLevel(full.slice(pOpen + 1, close < 0 ? undefined : close - 1))
    helperSleeper = true
    if (args.length < 2 || NO_SPORT_ARG.test(args[1])) helperUnscoped = true
  }
  // `sleeperIdsBySportWhere` builds one (sport, sleeperId) arm per sport and drops sport-less ones:
  // scoped by construction.
  if (/\bsleeperIdsBySportWhere\s*\(/.test(full) && !SLEEPER_KEY.test(text)) return 'scoped'
  const literal = SLEEPER_KEY.test(full)
  if (!literal && !helperSleeper) return 'not-sleeper'
  if (SPORT_KEY.test(full)) return 'scoped'
  if (!literal && !helperUnscoped) return 'scoped'
  return 'unscoped'
}

/**
 * Scan source text. Returns every `sportsPlayer` call whose where is keyed by `sleeperId` and is
 * not provably sport-scoped. Exported so the test can feed it a planted violation.
 */
export function scanSource(src, file = '<memory>', table = 'sportsPlayer') {
  const masked = maskSource(src)
  const found = []
  const re = callRe(table)
  let m
  while ((m = re.exec(masked))) {
    const method = m[1]
    if (!METHODS.includes(method)) continue
    const open = m.index + m[0].length - 1
    const line = masked.slice(0, m.index).split('\n').length
    let w = topLevelWhere(masked, open)
    if (w.kind === 'argIdent') {
      const obj = resolveIdent(masked, w.name, m.index)
      if (!obj) {
        found.push({ file, line, method, status: 'unreadable' })
        continue
      }
      w = topLevelWhere('(' + obj + ')', 0)
    }
    let status
    if (w.kind === 'none') continue
    if (w.kind === 'object' || w.kind === 'expr') status = classifyWhereText(w.text, masked, m.index)
    else if (w.kind === 'ident') {
      const expr = declaredExpr(masked, w.name, m.index)
      // A where handed in from elsewhere: unreadable only if this file filters on sleeperId at all.
      if (expr == null) status = /[{,\s]sleeperId\s*:/.test(masked) ? 'unreadable' : 'not-sleeper'
      else status = classifyWhereText(expr, masked, m.index)
    } else status = 'unreadable'
    if (status === 'unscoped' || status === 'unreadable') found.push({ file, line, method, status })
  }
  return found
}

export function scanRepo(repoRoot, table = 'sportsPlayer') {
  const all = []
  for (const root of ROOTS) {
    for (const full of walk(path.join(repoRoot, root))) {
      const rel = path.relative(repoRoot, full).split(path.sep).join('/')
      if (isTestPath(rel)) continue
      let src
      try {
        src = fs.readFileSync(full, 'utf8')
      } catch {
        continue
      }
      if (!src.includes(table)) continue
      all.push(...scanSource(src, rel, table))
    }
  }
  return all
}

/** Split findings into allowlisted and violations, honouring per-file counts. */
export function applyAllowlist(findings, allowlist = ALLOWLIST) {
  const byFile = new Map()
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, [])
    byFile.get(f.file).push(f)
  }
  const allowed = []
  const violations = []
  const stale = []
  for (const [file, list] of byFile) {
    const entry = allowlist[file]
    const cap = entry ? entry.count : 0
    allowed.push(...list.slice(0, cap).map((f) => ({ ...f, reason: entry?.reason })))
    violations.push(...list.slice(cap))
    if (entry && list.length < cap) stale.push({ file, allowed: cap, found: list.length })
  }
  for (const file of Object.keys(allowlist)) {
    if (!byFile.has(file)) stale.push({ file, allowed: allowlist[file].count, found: 0 })
  }
  return { allowed, violations, stale }
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const findings = scanRepo(repoRoot)
  const { allowed, violations, stale } = applyAllowlist(findings)
  const header = `sleeperId sport-scope guard: ${violations.length} violation(s), ${allowed.length} allowlisted`
  if (process.argv.includes('--list')) {
    console.log(header)
    for (const a of allowed) console.log(`  allowed  ${a.file}:${a.line}  ${a.method}`)
  }
  if (stale.length) {
    for (const s of stale) console.log(`  stale allowlist: ${s.file} allows ${s.allowed}, found ${s.found} — lower it`)
  }
  if (violations.length) {
    console.error(header)
    console.error('')
    console.error('A SportsPlayer read keyed by sleeperId with no `sport` can return another sport\'s player')
    console.error('under the same id (NFL 1466 Travis Kelce / NBA 1466 JaVale McGee). Add the sport the caller')
    console.error('means — sleeperIdWhere(ids, sport) — or justify an ALLOWLIST entry.')
    console.error('')
    for (const v of violations) console.error(`  ${v.status.padEnd(10)} ${v.file}:${v.line}  ${v.method}`)
    process.exit(1)
  }
  if (!process.argv.includes('--list')) console.log(header)
  process.exit(stale.length ? 1 : 0)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
