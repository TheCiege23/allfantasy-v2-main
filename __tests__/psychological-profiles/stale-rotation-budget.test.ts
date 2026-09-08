/**
 * The stale-league rotation drains under a wall-clock budget.
 *
 * ── WHY THIS MATTERS, MEASURED IN PRODUCTION 2026-09-08 ─────────────────────
 *
 * `refreshStaleLeagueProfiles` was capped at a fixed `maxLeagues: 3`, so the psych rotation
 * moved 3-13 leagues/day against 287 — a ~36-day cycle, with 66 team-carrying leagues (769
 * managers) never profiled at all. The ordering (never-profiled first, then stalest) was
 * always correct; the cap was the constraint, and it spent a 240s budget doing three leagues.
 *
 * `lib/cron/runBudget.ts` prescribes exactly this pairing in its own header. These tests pin
 * the half that was missing, plus two properties that are easy to get wrong and silent when
 * wrong:
 *
 *   1. The result must report the leagues actually REACHED, not the leagues PICKED. Returning
 *      `picked` would make the cron log claim coverage the database does not have.
 *   2. A league whose profiling THROWS must still count as reached. It sorts first (never
 *      profiled), so counting it as unreached would re-pick it forever and wedge the head of
 *      the rotation on every run.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  draftGroupBy: vi.fn(),
  profileGroupBy: vi.fn(),
  leagueFindUnique: vi.fn(),
  runEngine: vi.fn(),
  backfill: vi.fn(),
  ingest: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftFact: { groupBy: h.draftGroupBy },
    managerPsychProfile: { groupBy: h.profileGroupBy },
    league: { findUnique: h.leagueFindUnique },
  },
}))

vi.mock('@/lib/psychological-profiles/PsychologicalProfileEngine', () => ({
  runPsychologicalProfileEngine: h.runEngine,
}))
vi.mock('@/lib/psychological-profiles/TransactionFactBackfill', () => ({
  backfillTransactionFactsFromTradeHistory: h.backfill,
}))
vi.mock('@/lib/psychological-profiles/SleeperTradeFactIngest', () => ({
  ingestSleeperTradeFacts: h.ingest,
}))
vi.mock('@/lib/league-runtime/leagueFormat', () => ({ deriveLeagueFormat: () => 'redraft' }))
vi.mock('@/lib/sport-scope', () => ({ normalizeToSupportedSport: (s: string) => s ?? 'NFL' }))

import { refreshStaleLeagueProfiles } from '@/lib/psychological-profiles/ProfileRefreshService'

/** Ten candidate leagues, none ever profiled, so all sort to the front. */
const CANDIDATES = Array.from({ length: 10 }, (_, i) => ({ leagueId: `lg${i}`, _count: { _all: 5 } }))

beforeEach(() => {
  vi.resetAllMocks()
  h.draftGroupBy.mockResolvedValue(CANDIDATES)
  h.profileGroupBy.mockResolvedValue([])
  h.backfill.mockResolvedValue({})
  h.ingest.mockResolvedValue({})
  h.runEngine.mockResolvedValue({})
  h.leagueFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
    id: where.id,
    sport: 'NFL',
    season: 2026,
    teams: [{ id: 't1', externalId: 'e1', ownerName: 'Owner' }],
  }))
})

/** A budget that reports exhausted only after `n` checks. */
function budgetAfter(n: number) {
  let checks = 0
  return {
    exhausted: () => {
      checks += 1
      return checks > n
    },
  }
}

describe('the rotation still behaves as before when no budget is passed', () => {
  it('defaults to three leagues and does not report an early stop', async () => {
    const r = await refreshStaleLeagueProfiles()

    expect(r.leagueIds).toHaveLength(3)
    expect(r.leaguesProfiled).toBe(3)
    expect(r.stoppedEarly).toBe(false)
    expect(r.deferred).toBe(0)
  })
})

describe('the budget stops the rotation between leagues', () => {
  it('stops when the budget is spent and reports what it deferred', async () => {
    // Budget allows 4 checks, so 4 leagues run and the 5th check stops it.
    const r = await refreshStaleLeagueProfiles({ maxLeagues: 10, budget: budgetAfter(4) })

    expect(r.leaguesProfiled).toBe(4)
    expect(r.stoppedEarly).toBe(true)
    expect(r.deferred).toBe(6)
    expect(r.leagueIds).toHaveLength(4)
  })

  it('reports the leagues REACHED, never the leagues picked', async () => {
    const r = await refreshStaleLeagueProfiles({ maxLeagues: 10, budget: budgetAfter(2) })

    /*
     * The load-bearing assertion. `picked` is 10; returning it would tell the cron log that ten
     * leagues were covered when two were, and the coverage line on Scout would disagree with
     * the cron that is supposed to feed it.
     */
    expect(r.leagueIds).toEqual(['lg0', 'lg1'])
    expect(r.leagueIds).not.toContain('lg9')
    expect(r.deferred).toBe(8)
  })

  it('drains far more than the old fixed three when the budget allows', async () => {
    const r = await refreshStaleLeagueProfiles({ maxLeagues: 10, budget: { exhausted: () => false } })

    expect(r.leaguesProfiled).toBe(10)
    expect(r.stoppedEarly).toBe(false)
  })
})

describe('a league that throws cannot wedge the head of the rotation', () => {
  it('counts a failing league as reached so it is not re-picked forever', async () => {
    h.leagueFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === 'lg0') throw new Error('boom')
      return {
        id: where.id,
        sport: 'NFL',
        season: 2026,
        teams: [{ id: 't1', externalId: 'e1', ownerName: 'Owner' }],
      }
    })

    const r = await refreshStaleLeagueProfiles({ maxLeagues: 3 })

    // It threw, so it is not in `results` — but it IS reached, and reported as such.
    expect(r.leaguesProfiled).toBe(2)
    expect(r.leagueIds).toContain('lg0')
    expect(r.leagueIds).toHaveLength(3)
    expect(r.deferred).toBe(0)
  })
})

describe('the enrichment helpers are told how many leagues to cover', () => {
  it('passes maxLeagues so neither silently truncates at its own default', async () => {
    await refreshStaleLeagueProfiles({ maxLeagues: 10, budget: { exhausted: () => false } })

    /*
     * `ingestSleeperTradeFacts` defaults to a 25-league take. Harmless while `picked` was 3;
     * once the rotation drains, an omitted cap would profile the tail from un-enriched data
     * with nothing reporting a shortfall.
     */
    expect(h.ingest).toHaveBeenCalledWith(expect.objectContaining({ maxLeagues: 10 }))
    expect(h.backfill).toHaveBeenCalledWith(expect.objectContaining({ maxLeagues: 10 }))
  })
})
