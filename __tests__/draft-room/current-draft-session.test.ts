/**
 * A league runs many drafts; only one may be OPEN at a time.
 *
 * `DraftSession.leagueId` carried `@unique` until 2026-09-24, which allowed ONE draft per league
 * EVER and is what blocked dynasty year two. Production enforced the same thing under another
 * name — `UNIQUE ("leagueId", "seasonYear")` with `seasonYear` always 0 — so the migration drops
 * both and replaces them with a partial unique index:
 *
 *     CREATE UNIQUE INDEX "draft_sessions_leagueId_open_key"
 *       ON "draft_sessions"("leagueId") WHERE "status" <> 'completed';
 *
 * Verified on real Postgres (the test DB, inside a rolled-back transaction): before the
 * migration a league whose draft is completed CANNOT start another (rejected by the seasonYear
 * key); after it, it can, and a second OPEN draft beside it is still rejected.
 *
 * These tests pin the code's side of that contract.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  COMPLETED_DRAFT_SESSION_STATUS,
  CURRENT_DRAFT_SESSION_ORDER,
  OPEN_DRAFT_SESSION_STATUSES,
  isDraftSessionOpen,
  openDraftSessionWhere,
} from '@/lib/draft-room/currentDraftSession'

const MIGRATION = path.join(
  process.cwd(),
  'prisma/migrations/20260924160000_draft_session_many_per_league/migration.sql',
)

describe('the current draft for a league', () => {
  it('is the newest, with id breaking a createdAt tie so the choice is deterministic', () => {
    expect(CURRENT_DRAFT_SESSION_ORDER).toEqual([{ createdAt: 'desc' }, { id: 'desc' }])
  })
})

describe('which drafts are open', () => {
  it('treats every non-terminal status the code writes as open', () => {
    for (const status of OPEN_DRAFT_SESSION_STATUSES) expect(isDraftSessionOpen(status)).toBe(true)
  })

  it('treats completed as the one terminal status', () => {
    expect(isDraftSessionOpen(COMPLETED_DRAFT_SESSION_STATUS)).toBe(false)
    expect(OPEN_DRAFT_SESSION_STATUSES).not.toContain(COMPLETED_DRAFT_SESSION_STATUS)
  })

  it('does not call a missing status open', () => {
    expect(isDraftSessionOpen(null)).toBe(false)
    expect(isDraftSessionOpen(undefined)).toBe(false)
  })

  it('scopes the open-draft filter to the league and excludes completed', () => {
    expect(openDraftSessionWhere('lg-1')).toEqual({
      leagueId: 'lg-1',
      status: { not: COMPLETED_DRAFT_SESSION_STATUS },
    })
  })
})

describe('the database and the code agree on what "open" means', () => {
  /*
   * Two definitions of one rule: the partial index's WHERE clause, and
   * COMPLETED_DRAFT_SESSION_STATUS. If a new terminal status were added only in code, the index
   * would still count those drafts as open and refuse the league's next draft — with nothing in
   * the application able to explain why.
   */
  const sql = fs.readFileSync(MIGRATION, 'utf8')

  it('keys the partial unique index on exactly the terminal status the code uses', () => {
    const m = sql.match(
      /CREATE UNIQUE INDEX[^;]*"draft_sessions_leagueId_open_key"[^;]*WHERE\s+"status"\s*<>\s*'([^']+)'/,
    )
    expect(m, 'partial unique index statement not found in the migration').not.toBeNull()
    expect(m![1]).toBe(COMPLETED_DRAFT_SESSION_STATUS)
  })

  it('creates the new index BEFORE dropping either old one', () => {
    // The CREATE is the only statement that can fail on data. Failing first means nothing has
    // been removed when it does.
    const create = sql.indexOf('CREATE UNIQUE INDEX')
    const dropKey = sql.indexOf('DROP INDEX IF EXISTS "draft_sessions_leagueId_key"')
    const dropSeason = sql.indexOf('DROP INDEX IF EXISTS "draft_sessions_leagueId_seasonYear_key"')
    expect(create).toBeGreaterThan(-1)
    expect(dropKey).toBeGreaterThan(create)
    expect(dropSeason).toBeGreaterThan(create)
  })

  it('drops production\'s copy of the constraint too, not only the one main\'s schema names', () => {
    // Production never had `draft_sessions_leagueId_key`; it enforced one-draft-per-league through
    // `draft_sessions_leagueId_seasonYear_key`. Dropping only the first fixes nothing there.
    expect(sql).toContain('DROP INDEX IF EXISTS "draft_sessions_leagueId_seasonYear_key"')
  })
})
