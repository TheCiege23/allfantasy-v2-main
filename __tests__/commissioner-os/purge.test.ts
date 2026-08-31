/**
 * Commissioner OS · T-009 — the purge job.
 *
 * "This path runs long after anyone last looked at it; the test is the only
 * thing that will catch a regression." That is the whole justification for
 * testing ordering as data rather than only end-to-end: the ordering is what
 * regresses, and an end-to-end test that needs a database is the one nobody
 * runs.
 *
 * The full-league purge against real Postgres is `purge.spec.ts`.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  LEAGUE_PURGE_BLOCKERS,
  PURGE_EXEMPT_MODELS,
  PURGE_RETENTION_DAYS,
  planLeaguePurge,
  purgeAuditDraft,
  purgeCutoff,
  purgeLeague,
  tenantPurgeFilter,
} from '@/lib/domain/purge'
import { createActorContext } from '@/lib/domain/actorContext'

const NOW = new Date('2026-08-31T12:00:00.000Z')

const ctx = () => {
  const r = createActorContext({
    userId: 'u1',
    actorLabel: 'Purge Job',
    tenantId: 't1',
  })
  if (!r.ok) throw new Error('bad fixture')
  return r.value
}

describe('T-009 · the ordered plan', () => {
  it('deletes the Restrict blockers BEFORE the league', () => {
    // The entire reason this is not just `DELETE FROM leagues`. Two relations
    // to League carry no onDelete, so Prisma defaults them to Restrict and they
    // abort the delete rather than cascading.
    const plan = planLeaguePurge().map((s) => s.model)
    expect(plan).toEqual(['TournamentLeague', 'LeagueManagerClaim', 'League'])
    for (const blocker of LEAGUE_PURGE_BLOCKERS) {
      expect(plan.indexOf(blocker)).toBeLessThan(plan.indexOf('League'))
    }
  })

  it('ends with League and nothing after it', () => {
    // 144 relations cascade from that one statement. Anything scheduled after
    // it would be operating on rows the database has already removed, which
    // reports success while doing nothing — the shape that hides a broken step.
    const plan = planLeaguePurge().map((s) => s.model)
    expect(plan[plan.length - 1]).toBe('League')
  })

  it('never touches an exempt model', () => {
    const plan = planLeaguePurge().map((s) => s.model)
    for (const exempt of PURGE_EXEMPT_MODELS) expect(plan).not.toContain(exempt)
  })

  it('does not delete the SetNull relations', () => {
    // ImportRun and PlatformNotification outlive the league with a null
    // leagueId. That is what SetNull means, and "this happened, to something
    // now gone" is a reasonable record to keep.
    const plan = planLeaguePurge().map((s) => s.model)
    expect(plan).not.toContain('ImportRun')
    expect(plan).not.toContain('PlatformNotification')
  })

  it('every step explains itself', () => {
    // This runs unattended for years. A step whose reason is empty is a step
    // nobody can evaluate when it starts failing.
    for (const step of planLeaguePurge()) expect(step.reason.length).toBeGreaterThan(20)
  })
})

describe('T-009 · execution', () => {
  it('executes the plan in order, scoping each delete correctly', async () => {
    const calls: Array<[string, Record<string, unknown>]> = []
    const deleteMany = vi.fn(async (model: string, where: Record<string, unknown>) => {
      calls.push([model, where])
      return 1
    })

    const r = await purgeLeague({ deleteMany }, 'l1')

    expect(r.ok).toBe(true)
    expect(calls).toEqual([
      ['TournamentLeague', { leagueId: 'l1' }],
      ['LeagueManagerClaim', { leagueId: 'l1' }],
      // The league itself is keyed on `id`, not `leagueId` — an easy and
      // completely silent mistake: `{ leagueId: 'l1' }` on the leagues table
      // matches nothing and reports a successful purge that deleted nothing.
      ['League', { id: 'l1' }],
    ])
  })

  it('reports what it deleted, per model', async () => {
    const deleteMany = vi.fn(async (model: string) => (model === 'League' ? 1 : 3))
    const r = await purgeLeague({ deleteMany }, 'l1')
    if (!r.ok) throw new Error('expected success')
    expect(r.value.deleted).toEqual([
      { model: 'TournamentLeague', rows: 3 },
      { model: 'LeagueManagerClaim', rows: 3 },
      { model: 'League', rows: 1 },
    ])
  })

  it('refuses an empty leagueId', async () => {
    // `deleteMany(model, { leagueId: '' })` matches nothing and reports success.
    // Harmless here — but the same shape with `{}` deletes the table, so the
    // guard belongs at the door.
    const deleteMany = vi.fn(async () => 0)
    const r = await purgeLeague({ deleteMany }, '')
    expect(r.ok).toBe(false)
    expect(deleteMany).not.toHaveBeenCalled()
  })

  it('stops at the first failure rather than continuing', async () => {
    // A blocker that fails to delete means the League delete below it will hit
    // the FK violation anyway. Continuing turns one clear error into two, and
    // the second is the less informative one.
    const deleteMany = vi.fn(async (model: string) => {
      if (model === 'TournamentLeague') throw new Error('permission denied for table')
      return 1
    })
    await expect(purgeLeague({ deleteMany }, 'l1')).rejects.toThrow(/permission denied/)
    expect(deleteMany).toHaveBeenCalledTimes(1)
  })
})

describe('T-009 · retention is config, not prose', () => {
  it('has a default for both kinds', () => {
    expect(PURGE_RETENTION_DAYS.tenant).toBeGreaterThan(0)
    expect(PURGE_RETENTION_DAYS.league).toBeGreaterThan(0)
  })

  it('computes a cutoff in the past', () => {
    const cutoff = purgeCutoff('tenant', NOW)
    expect(cutoff.getTime()).toBeLessThan(NOW.getTime())
    expect(NOW.getTime() - cutoff.getTime()).toBe(
      PURGE_RETENTION_DAYS.tenant * 24 * 60 * 60 * 1000,
    )
  })

  it('produces a valid date, never NaN', () => {
    // A malformed env value becoming NaN would make every comparison false, so
    // the purge would silently stop running while reporting success — a job
    // that does nothing looks identical to a job with nothing to do.
    expect(Number.isNaN(purgeCutoff('league', NOW).getTime())).toBe(false)
  })
})

describe('T-009 · tenant eligibility', () => {
  it('requires deletedAt AND honours purgeAfter', () => {
    // Both, not either. deletedAt says it was deleted; purgeAfter is the
    // explicit hold a contract or a legal request can extend. A purge honouring
    // only the first would ignore a legal hold.
    const filter = tenantPurgeFilter(NOW) as Record<string, any>
    expect(filter.deletedAt).toMatchObject({ not: null })
    expect(filter.OR).toEqual([{ purgeAfter: null }, { purgeAfter: { lte: NOW } }])
  })

  it('never matches a live tenant', () => {
    const filter = tenantPurgeFilter(NOW) as Record<string, any>
    // `deletedAt: { not: null }` is the clause that stops this filter being
    // "every tenant". If it is ever removed, the purge deletes the business.
    expect(filter.deletedAt.not).toBeNull()
    expect(filter.deletedAt.lte).toBeInstanceOf(Date)
  })
})

describe('T-009 · the purge audits itself', () => {
  it('records what was deleted and who ran it', () => {
    // The one path that destroys data. An unattributed run is the single audit
    // gap that cannot be reconstructed afterwards from anything else.
    const draft = purgeAuditDraft(ctx(), {
      leagueId: 'l1',
      deleted: [{ model: 'League', rows: 1 }],
    })
    expect(draft).toMatchObject({
      action: 'data.purgeLeague',
      resourceType: 'League',
      resourceId: 'l1',
      leagueId: 'l1',
    })
    expect((draft.metadata as any).deleted).toEqual([{ model: 'League', rows: 1 }])
    expect((draft.metadata as any).actor).toBe('Purge Job')
  })
})
