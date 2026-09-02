/**
 * Commissioner OS · T-101b cannot be applied before its preconditions.
 *
 * 🛑 THE MIGRATION SAYS "DO NOT APPLY THIS YET" IN A COMMENT. THAT IS NOT A
 * MECHANISM. This session has now watched a comment fail to prevent the thing it
 * warned about four separate times — placeholders pasted as passwords twice, a
 * "point DATABASE_URL at a non-prod DB" header that no gate enforced, and a
 * `LEAGUE_PURGE_BLOCKERS` list whose accompanying unit test agreed with it
 * because both were written from the same belief. Prose does not stop anyone.
 *
 * ─── WHAT GOES WRONG, AND IN WHICH DIRECTION ─────────────────────────────────
 *
 * T-101b drops `leagues.tenantId`'s database DEFAULT. Prisma implements a scalar
 * `@default` IN THE DATABASE and omits the column on insert, so while
 * `schema.prisma` still carries `@default("allfantasy")` the generated client
 * emits INSERTs with no tenantId and relies on Postgres to fill it. Drop the
 * database default under that client and every one of those inserts becomes a
 * NOT NULL violation: league creation and every import path, immediately.
 *
 * The two halves must move together, and the failure is asymmetric — leaving the
 * default in place costs correctness later, dropping it early costs availability
 * now. So this test guards the second, which is the one that pages someone.
 *
 * ⚠ IT IS DELIBERATELY NOT A TEST OF THE MIGRATION'S CONTENTS. It asserts
 * REACHABILITY: `prisma migrate deploy` reads the DIRECTORY, not git and not
 * intent, so the only question that matters is whether the file is somewhere the
 * deploy command will find it. prisma/migrations-pending/README.md exists for
 * exactly this reason.
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(__dirname, '..', '..')
const DEPLOY_DIR = path.join(REPO, 'prisma', 'migrations')
const PARKED_DIR = path.join(REPO, 'prisma', 'migrations-pending')
const SCHEMA = path.join(REPO, 'prisma', 'schema.prisma')

/**
 * `@default("allfantasy")` on **League**.tenantId — precondition 2, inverted.
 *
 * 🛑 SCOPED TO THE `model League` BLOCK, AND THE FIRST VERSION WAS NOT.
 * It searched the whole file for `tenantId String @default("allfantasy")`, which
 * FIVE OTHER MODELS also carry (TradeExecutionSnapshot, DomainEvent,
 * AuditFeedEntry, IntelligenceLeagueSnapshot and its History — they predate this
 * work and are why T-101 had to seed the bootstrap tenant with that literal id).
 * So removing League's default left five matches, the predicate stayed true, and
 * the guard reported success while measuring the wrong five models.
 *
 * Caught only because the control asserted its own mutation had applied: the
 * file changed, the default count went 6 → 5, and the test stayed green anyway.
 * Without that assertion this would have read as "the control did not fire" and
 * been written off as a bad regex in the control rather than a bug in the guard.
 */
function schemaStillHasLeagueDefault(): boolean {
  const src = readFileSync(SCHEMA, 'utf8')
  const block = /^model League \{[\s\S]*?^\}/m.exec(src)
  if (!block) throw new Error('model League not found in schema.prisma — this guard is blind')
  return /tenantId\s+String\s+@default\("allfantasy"\)/.test(block[0])
}

function dirsMatching(dir: string, needle: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((d) => d.toLowerCase().includes(needle))
}

describe('T-101b · the drop-default migration is not reachable before its preconditions', () => {
  it('the guard can see the schema at all (positive control)', () => {
    // Without this, a renamed field or a reformat would make the regex match
    // nothing, `schemaStillHasLeagueDefault()` return false, and the guard below
    // silently stop guarding — passing for the rest of the project's life.
    const src = readFileSync(SCHEMA, 'utf8')
    expect(src).toMatch(/model League \{/)
    expect(src).toMatch(/tenantId/)
  })

  it('🛑 t101b is NOT in prisma/migrations/ while schema.prisma still defaults tenantId', () => {
    if (!schemaStillHasLeagueDefault()) {
      // The default is gone, so precondition 2 is met and this guard no longer
      // applies. It does not silently pass: it asserts the OTHER half instead,
      // because a schema with no default and a migration still parked means
      // inserts are relying on a database default that is about to be dropped by
      // a file nobody has run.
      expect(
        dirsMatching(PARKED_DIR, 't101b').length,
        'League.tenantId no longer has @default, so T-101b should have been applied and moved out of migrations-pending/.',
      ).toBe(0)
      return
    }

    const reachable = dirsMatching(DEPLOY_DIR, 't101b')
    expect(
      reachable,
      [
        'T-101b is in prisma/migrations/ — the deploy path — while schema.prisma still',
        'has @default("allfantasy") on League.tenantId.',
        '',
        'Prisma implements a scalar @default IN THE DATABASE and omits the column on',
        'insert. Dropping the column default under that client makes every league',
        'INSERT a NOT NULL violation: league creation and every import path, at once.',
        '',
        'Order: (1) every league write passes an explicit tenantId, (2) remove the',
        '@default from schema.prisma, (3) then apply this migration.',
      ].join('\n'),
    ).toEqual([])
  })

  it('t101b is parked where migrate deploy cannot reach it', () => {
    // The positive half. If someone deletes the migration rather than moving it,
    // the guard above passes vacuously — nothing in the deploy path, nothing to
    // find. This asserts it still exists somewhere.
    expect(dirsMatching(PARKED_DIR, 't101b').length + dirsMatching(DEPLOY_DIR, 't101b').length)
      .toBeGreaterThan(0)
  })

  it('the deploy-path check can actually see migrations (positive control)', () => {
    // `dirsMatching` returning [] for a mistyped path would make the guard
    // above pass forever. Prove the directory is real and populated.
    expect(existsSync(DEPLOY_DIR)).toBe(true)
    expect(readdirSync(DEPLOY_DIR).length).toBeGreaterThan(100)
  })
})
