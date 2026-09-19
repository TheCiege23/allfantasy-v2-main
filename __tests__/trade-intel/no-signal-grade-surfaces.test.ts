import { describe, expect, it, vi } from 'vitest'

import { realizedGradeDisplay, NO_SIGNAL_MARK } from '@/lib/trade-intel/gradeScale'

/*
 * 🛑 A "C" MEANS THE ENGINE HAS NO DATA, NOT THAT THE TRADE WAS AVERAGE.
 *
 * `letterFor` bands C as -40..40 and an ungraded trade nets exactly 0, so before a single point is
 * credited — preseason, a league still drafting, picks nobody has used — EVERY side of EVERY trade
 * grades C and the engine reports a tie. `hasNoSignal` exists for precisely this, and four surfaces
 * already call it (`sleeperTradeHistory`, `recentTrades`, `careerHistory`, `decisionReceipts`) plus
 * the grade email.
 *
 * Three did not, and they are the three where it costs most:
 *   - the share card, which prints the letter at 110px under "WHO WON THIS TRADE?" on an image
 *     built to be sent to a league chat;
 *   - the career card, whose trade résumé counted every empty trade as a C and a tie;
 *   - Chimmy's league grounding, which hands the letter to the model under a closing line calling
 *     these "the ONLY league-specific truths" and telling it to cite them.
 */

describe('realizedGradeDisplay', () => {
  it('shows the letter and the trail when points have been credited', () => {
    const out = realizedGradeDisplay({
      scored: true,
      currentGrade: 'B',
      initialGrade: 'C',
      trend: 'improving',
    })
    expect(out.mark).toBe('B')
    expect(out.caption).toBe('initial C · now B · improving')
  })

  it('refuses the letter when nothing has been credited', () => {
    const out = realizedGradeDisplay({
      scored: false,
      currentGrade: 'C',
      initialGrade: 'C',
      trend: 'steady',
    })
    expect(out.mark).toBe(NO_SIGNAL_MARK)
    expect(out.mark).not.toBe('C')
    expect(out.caption).toBe('too early to grade')
  })

  /*
   * ⚠ A BLANK IS NOT THE SAME ANSWER. An empty string reads as a loading state or a broken
   * render; the mark has to be something a reader recognises as "no verdict".
   */
  it('never renders an empty mark', () => {
    for (const scored of [true, false]) {
      const out = realizedGradeDisplay({ scored, currentGrade: 'F', initialGrade: 'F', trend: 'steady' })
      expect(out.mark.length).toBeGreaterThan(0)
      expect(out.caption.length).toBeGreaterThan(0)
    }
  })
})

/* ── The career résumé ───────────────────────────────────────────────────────────────────── */

const PRISMA = {
  userProfile: { findUnique: vi.fn(async () => ({ sleeperUserId: 'owner-1' })) },
  league: {
    findMany: vi.fn(async (args: { where?: { platform?: unknown } }) => {
      const platform = args?.where?.platform
      /* The Sleeper pass gets one league; the imported pass (`{ notIn: [...] }`) gets none. */
      if (platform === 'sleeper') {
        return [{ id: 'L1', name: 'Test League', platformLeagueId: '123' }]
      }
      return []
    }),
  },
  /* The card is cached in `sportsDataCache`; a cold cache is what exercises the builder. */
  sportsDataCache: {
    findUnique: vi.fn(async () => null),
    upsert: vi.fn(async () => null),
  },
}

vi.mock('@/lib/prisma', () => ({ prisma: PRISMA }))
vi.mock('@/lib/league-history/sleeperLeagueHistoryService', () => ({
  getSleeperLeagueHistory: vi.fn(async () => null),
}))
vi.mock('@/lib/league-history/sleeperH2HService', () => ({ getLeagueH2H: vi.fn(async () => null) }))
vi.mock('@/lib/league-history/importedFactsH2HService', () => ({
  getImportedLeagueH2H: vi.fn(async () => null),
}))
vi.mock('@/lib/draft-intel/draftReportService', () => ({ getDraftReport: vi.fn(async () => null) }))

const gradesMock = vi.fn()
vi.mock('@/lib/trade-intel/sleeperTradeGradeService', async () => {
  const actual = await vi.importActual<typeof import('@/lib/trade-intel/sleeperTradeGradeService')>(
    '@/lib/trade-intel/sleeperTradeGradeService',
  )
  return { ...actual, getTradeGrades: gradesMock }
})

/** One side of a trade where nothing has been credited — every asset scores 0. */
function emptySide(rosterId: number, ownerId: string) {
  return {
    rosterId,
    ownerId,
    managerName: `Manager ${rosterId}`,
    teamName: null,
    avatar: null,
    playersIn: [{ name: 'Rookie A', creditedBySeason: {} }],
    playersOut: [{ name: 'Rookie B', creditedBySeason: {} }],
    picksIn: [],
    picksOut: [],
    seasonNets: [{ season: '2026', net: 0, partial: false }],
    cumulativeNet: 0,
    initialGrade: 'C' as const,
    currentGrade: 'C' as const,
    trend: 'steady' as const,
  }
}

/** The same shape, but with real credited points on one side. */
function scoredSide(rosterId: number, ownerId: string, credited: number, grade: 'A' | 'F') {
  return {
    ...emptySide(rosterId, ownerId),
    playersIn: [{ name: 'Starter', creditedBySeason: { '2026': credited } }],
    seasonNets: [{ season: '2026', net: credited, partial: false }],
    cumulativeNet: credited,
    initialGrade: grade,
    currentGrade: grade,
  }
}

function payload(trades: unknown[]) {
  return {
    version: 2,
    fetchedAt: new Date().toISOString(),
    staleAsOf: null,
    sleeperLeagueId: '123',
    seasonsScanned: ['2026'],
    currentSeasonPartial: true,
    gradeScale: { description: '', thresholds: [], tieBand: 60 },
    contextNotes: [],
    trades,
    missing: [],
  }
}

describe('the career card trade résumé', () => {
  it('does not count a trade with nothing credited as a C, or as a tie', async () => {
    gradesMock.mockResolvedValue(
      payload([
        {
          id: 't-empty',
          season: '2026',
          week: 1,
          createdIso: new Date().toISOString(),
          multiTeam: false,
          /* The engine reports a tie for net 0 — which is the other half of the trap. */
          tie: true,
          hasPendingPicks: false,
          sides: [emptySide(1, 'owner-1'), emptySide(2, 'owner-2')],
        },
      ]),
    )

    const { getCareerCard } = await import('@/lib/dashboard-intel/careerCardService')
    const card = await getCareerCard('user-1')

    expect(card).not.toBeNull()
    expect(card!.trades.grades.C).toBe(0)
    expect(card!.trades.graded).toBe(0)
    expect(card!.trades.ties).toBe(0)
    /* ⚠ Counted, not dropped — the card must not quietly disagree with the league's trade list. */
    expect(card!.trades.notYetGraded).toBe(1)
  })

  /*
   * ⚠ THE CONTROL IN THE OTHER DIRECTION. A fix that simply stopped counting trades would pass the
   * test above and destroy the feature. A real graded trade must still land on the résumé.
   */
  it('still counts a trade that has produced points', async () => {
    gradesMock.mockResolvedValue(
      payload([
        {
          id: 't-scored',
          season: '2026',
          week: 3,
          createdIso: new Date().toISOString(),
          multiTeam: false,
          tie: false,
          hasPendingPicks: false,
          sides: [scoredSide(1, 'owner-1', 180, 'A'), scoredSide(2, 'owner-2', 0, 'F')],
        },
      ]),
    )

    const { getCareerCard } = await import('@/lib/dashboard-intel/careerCardService')
    const card = await getCareerCard('user-1')

    expect(card!.trades.graded).toBe(1)
    expect(card!.trades.grades.A).toBe(1)
    expect(card!.trades.notYetGraded).toBe(0)
  })
})
