/**
 * A dynasty league's completed draft must produce season tables, like every other format.
 *
 * 🛑 THE GATE SAID `isRedraft` AND MEANT "EVERYTHING EXCEPT DYNASTY". `RedraftSeason` is the
 * generic season shell — guillotine reaches this same sync and `ensureGuillotineSeason` builds
 * on what it produces — and tournament, survivor, zombie, salary-cap and keeper all passed
 * through the `isDynasty === false` arm. Dynasty was the only format turned away, so a dynasty
 * league finished its draft and got no season, no rosters and no schedule. Nothing to score,
 * and nothing said why.
 *
 * Production 2026-09-24: 165 dynasty leagues, every one an IMPORT whose season came from
 * materialization. Zero created natively — the wizard could not submit one either, which is the
 * other half of this change.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  draftSession: { findFirst(...a: unknown[]) { return (this as any).findUnique(...a) }, findUnique: vi.fn() },
  redraftSeason: { findFirst: vi.fn(), create: vi.fn() },
  redraftRoster: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  redraftRosterPlayer: { findFirst: vi.fn(), create: vi.fn() },
  redraftMatchup: { findMany: vi.fn(), createMany: vi.fn() },
  roster: { findUnique: vi.fn(), findMany: vi.fn() },
  leagueTeam: { findMany: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

beforeEach(() => {
  vi.clearAllMocks()
  // No completed draft: the run stops right after the gate, which is all these assert.
  prismaMock.draftSession.findUnique.mockResolvedValue(null)
})

async function run(leagueId = 'league-1') {
  const { syncCompletedDraftToRedraftSeason } = await import('@/lib/redraft/finalizeDraftToRedraftSeason')
  return syncCompletedDraftToRedraftSeason(leagueId)
}

describe('syncCompletedDraftToRedraftSeason — which formats it serves', () => {
  it('does not turn a dynasty league away', async () => {
    prismaMock.league.findUnique.mockResolvedValue({ id: 'league-1' })

    const summary = await run()

    // It reached the draft lookup, which is the step after the old gate.
    expect(prismaMock.draftSession.findUnique).toHaveBeenCalled()
    expect(summary.reason).not.toBe('not_redraft_league')
    expect(summary.reason).toBe('draft_session_not_found')
  })

  /**
   * ⚠ A LEAGUE-TYPE-PARAMETERISED TEST WOULD BE THEATRE HERE, SO THERE ISN'T ONE. The sync no
   * longer reads `leagueType` or `isDynasty` at all, so looping over format names and asserting
   * each one passes would assert nothing — every iteration exercises identical code. What is
   * worth pinning is that the columns are no longer fetched, because fetching them is the first
   * step back toward a gate that singles a format out.
   */
  it('no longer asks the database what format the league is', async () => {
    prismaMock.league.findUnique.mockResolvedValue({ id: 'league-1' })

    await run()

    const select = prismaMock.league.findUnique.mock.calls[0]?.[0]?.select ?? {}
    expect(select).toEqual({ id: true })
  })

  it('still refuses a league that does not exist', async () => {
    prismaMock.league.findUnique.mockResolvedValue(null)

    const summary = await run('nope')

    expect(summary.reason).toBe('league_not_found')
    expect(prismaMock.draftSession.findUnique).not.toHaveBeenCalled()
  })
})
