#!/usr/bin/env node
/**
 * Guards the rule that `SportsPlayer.externalId` is never filtered without `source`.
 *
 * ⚠ `externalId` IS FOUR ID NAMESPACES IN ONE COLUMN AND THE FORMAT DOES NOT SEPARATE THEM.
 * Measured on production 2026-08-27: `rolling_insights` writes 113,669 bare numerics, `cfbd`
 * 5,226, `api_football` 737 and `backfill` 261, while `sleeper` writes `sleeper:*` and
 * `thesportsdb` writes `tsdb_*`. Only `source` says which space a row is in.
 *
 * The spaces collide: 42,032 bare-numeric ids also exist as a Sleeper id, and 42,031 of those
 * are a DIFFERENT PERSON. So an `externalId` filter with no `source` can silently return the
 * wrong player, and has twice — `getPlayerDataForSurface` served 211 players another player's
 * photograph, and `sleeperPlayerCrosswalk` bound strangers' names, positions and teams into AI
 * grounding blocks.
 *
 * ⚠ THIS IS A RATCHET, NOT A CLEAN GATE. There are pre-existing violations and they are
 * reported rather than hidden. The count may go DOWN freely; it may not go UP. Fixing one means
 * lowering BASELINE in the same commit, which is what stops the number drifting back.
 *
 * To fix a site rather than baseline it, use `lib/player-identity/externalIdNamespace.ts`:
 * `sleeperIdWhere(ids, sport)` for Sleeper ids — they belong against the `sleeperId` COLUMN,
 * never `externalId` — and `providerIdWhere(source, ids, sport)` for a provider's own ids.
 */

import fs from 'node:fs'
import path from 'node:path'

/**
 * Sites that filter `externalId` with no `source`, as of 2026-08-27.
 *
 * Lower this when you fix one. Never raise it: a new unscoped filter is the bug this exists to
 * catch, and there is a safe helper for every legitimate case.
 */
const BASELINE = 37

const ROOTS = ['lib', 'app', 'components', 'scripts']
const METHODS = [
  'findMany',
  'findFirst',
  'findUnique',
  'count',
  'updateMany',
  'deleteMany',
  'upsert',
  'update',
  'create',
  'aggregate',
  'groupBy',
]
const NEEDLE = '.sportsPlayer.'

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
    } else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) {
      out.push(full)
    }
  }
  return out
}

/** The whole `prisma.sportsPlayer.<method>( ... )` call, by bracket matching. */
function callBlock(src, openParen) {
  let depth = 0
  for (let i = openParen; i < src.length; i += 1) {
    const c = src[i]
    if (c === '(' || c === '[' || c === '{') depth += 1
    else if (c === ')' || c === ']' || c === '}') {
      depth -= 1
      if (depth === 0) return src.slice(openParen, i + 1)
    }
  }
  return src.slice(openParen)
}

const violations = []

for (const root of ROOTS) {
  for (const file of walk(root)) {
    let src
    try {
      src = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (!src.includes(NEEDLE)) continue

    let from = 0
    for (;;) {
      const at = src.indexOf(NEEDLE, from)
      if (at < 0) break
      from = at + 1

      const after = src.slice(at + NEEDLE.length, at + NEEDLE.length + 20)
      const method = METHODS.find((m) => after.startsWith(m))
      if (!method) continue

      const open = src.indexOf('(', at)
      if (open < 0) continue
      const block = callBlock(src, open)

      /*
       * ⚠ ONLY THE `where` CLAUSE COUNTS, AND CHECKING THE WHOLE CALL GETS THIS WRONG.
       * Every one of these queries also SELECTS `externalId`, so a naive substring test flags
       * `externalId: true` in the projection and reports a file that was just fixed. Isolate the
       * where clause and read only that.
       */
      const whereAt = block.indexOf('where:')
      if (whereAt < 0) continue

      /*
       * ⚠ THE BRACE MUST BE THE VERY NEXT TOKEN, OR THIS READS THE `select` AS THE `where`.
       * When the clause is built by a helper — `where: sleeperIdWhere(ids, sport)` — the next
       * `{` in the call belongs to `select`, and every one of these queries selects
       * `externalId`. Grabbing it flagged a site that had just been fixed BY the helper this
       * guard recommends, which is the most misleading failure it could produce. A clause the
       * guard cannot read as an object literal is left alone: helpers are the safe path.
       */
      const afterWhere = block.slice(whereAt + 'where:'.length)
      const lead = afterWhere.length - afterWhere.trimStart().length
      if (afterWhere.trimStart()[0] !== '{') continue
      const braceAt = whereAt + 'where:'.length + lead
      const where = callBlock(block, braceAt)
      if (!where.includes('externalId:')) continue
      if (where.includes('source')) continue

      /*
       * A literal namespace PREFIX in the value is scoping too, and stricter than `source`.
       * An externalId compared against a sleeper:-prefixed value can only ever match a
       * Sleeper-sourced row, which is exactly the discipline this guard asks for. Without this
       * it flags the helper written to fix the bug, which is the wrong lesson for the next reader.
       */
      if (where.includes('sleeper:') || where.includes('tsdb_')) continue

      violations.push({
        file: file.split(path.sep).join('/'),
        line: src.slice(0, at).split('\n').length,
        method,
      })
    }
  }
}

const count = violations.length
const header = `externalId namespace guard: ${count} unscoped filter(s), baseline ${BASELINE}`

if (count > BASELINE) {
  console.error(header)
  console.error('')
  console.error('An `externalId` filter with no `source` can match a different player entirely.')
  console.error('Use lib/player-identity/externalIdNamespace.ts:')
  console.error('  sleeperIdWhere(ids, sport)            for Sleeper ids (queries the sleeperId column)')
  console.error('  providerIdWhere(source, ids, sport)   for a provider id, scoped to that provider')
  console.error('')
  for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.method}`)
  console.error('')
  console.error(`FAIL: ${count} > ${BASELINE}. Fix the new site, or justify raising BASELINE.`)
  process.exit(1)
}

/* `--list` prints the remaining sites on a pass, so the backlog is inspectable without
   having to break the build to see it. */
if (process.argv.includes('--list')) {
  console.log(header)
  for (const v of violations) console.log(`  ${v.file}:${v.line}  ${v.method}`)
  process.exit(0)
}

if (count < BASELINE) {
  console.log(header)
  console.log(`Good — ${BASELINE - count} fewer than baseline. Lower BASELINE to ${count} in this commit.`)
  process.exit(0)
}

console.log(header)
process.exit(0)
