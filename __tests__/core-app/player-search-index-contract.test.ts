import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * 🛑 AN INDEX CONTRACT, PINNED IN SOURCE BECAUSE NOTHING ELSE CAN SEE IT BREAK.
 *
 * Every player-name search in the product matches case-insensitively against `SportsPlayer`,
 * and `SportsPlayer_name_idx` — a plain `btree(name)` — can serve none of them. Measured
 * 2026-09-19 against the test endpoint (138,048 rows): each pass is a Seq Scan reading 4,369
 * blocks, and `searchPlayersCatalog` issues up to four of them per search.
 *
 * `supabase_ensure_sportsplayer_name_trgm.sql` proposes the gin/trgm index that fixes it
 * (71 ms -> 1 ms on the widest pass, measured in a transaction that was rolled back). A
 * trigram index is usable ONLY while the pattern is matched against the BARE column, so:
 *
 *   - wrapping it (`lower(name)`, an expression in `$queryRaw`, a `::text` cast) returns the
 *     plan to a sequential scan;
 *   - and NOTHING FAILS WHEN THAT HAPPENS. No test goes red, no type changes, the results are
 *     identical. The search simply costs a table scan again, silently, forever.
 *
 * ⚠ THIS IS A SOURCE ASSERTION AND THAT IS A DELIBERATE, NARROW CHOICE. The real property —
 * "the planner chose an index scan" — needs a database with the index on it, and the index is
 * not applied. What CAN be pinned here is the shape the proposal depends on, so the SQL file
 * and the code cannot drift apart unnoticed. The repo already pins contracts this way
 * (`trade-surface-refresh-contract.test.ts`, `yahoo-pending-offers.test.ts`).
 */

const root = process.cwd()
const finderSource = readFileSync(join(root, 'lib/core-app/playerFinder.ts'), 'utf8')
const proposal = readFileSync(join(root, 'supabase_ensure_sportsplayer_name_trgm.sql'), 'utf8')

/**
 * ⚠ COMMENTS ARE STRIPPED BEFORE THE CODE ASSERTIONS RUN, AND THE FIRST VERSION OF THIS FILE
 * FAILED FOR WANT OF IT — on the comment in `playerFinder.ts` that WARNS against `lower(name)`.
 * A guard that trips on the prose describing the thing it forbids is not a guard; it just
 * makes the warning unwriteable.
 */
const finder = finderSource
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ')

describe('the player-name search keeps the shape a trigram index can serve', () => {
  it('matches against the bare column, never a wrapped expression', () => {
    /*
     * Prisma cannot wrap a column itself, so the realistic regression is raw SQL introduced
     * beside these queries. Either form below defeats the index.
     */
    expect(finder).not.toMatch(/lower\s*\(\s*"?name"?\s*\)/i)
    expect(finder).not.toMatch(/upper\s*\(\s*"?name"?\s*\)/i)
    expect(finder).not.toMatch(/\$queryRaw/)
  })

  it('still asks case-insensitively, which is what makes the plain btree useless', () => {
    /*
     * If this ever goes case-SENSITIVE the existing `btree(name)` becomes usable and the
     * proposal is moot — but the results change too, so it is a product decision rather than
     * a tidy-up. Pinning it means that decision cannot be made by accident.
     */
    expect(finder).toMatch(/mode:\s*'insensitive'/)
  })

  /* This one reads the ORIGINAL source: the pointer lives in a comment, which is the point. */
  it('names the proposal where someone editing the query will see it', () => {
    expect(finderSource).toContain('supabase_ensure_sportsplayer_name_trgm.sql')
  })
})

describe('the proposal itself stays applicable', () => {
  it('creates the index CONCURRENTLY, because the ingestion crons write to this table', () => {
    expect(proposal).toMatch(/CREATE INDEX CONCURRENTLY IF NOT EXISTS/)
  })

  it('requires the extension it depends on', () => {
    expect(proposal).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_trgm/)
  })

  /*
   * ⚠ THE ONE THAT WOULD COST AN OUTAGE IF IT WERE DROPPED. `CREATE INDEX CONCURRENTLY` is
   * rejected inside a transaction block, and every GUI client that wraps a script in
   * BEGIN/COMMIT will fail it. The warning is the difference between "this did not run" and
   * a confusing error at 2am.
   */
  it('warns that it must not be run inside a transaction', () => {
    expect(proposal).toMatch(/OUTSIDE A TRANSACTION/)
  })

  it('is not a Prisma migration, and says so', () => {
    expect(proposal).toMatch(/NOT A PRISMA MIGRATION/)
  })
})
