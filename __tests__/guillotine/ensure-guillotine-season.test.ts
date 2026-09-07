/**
 * The guillotine season shell, and the post-draft hook that now creates it.
 *
 * 🛑 `guillotine_seasons` HOLDS ZERO ROWS IN PRODUCTION against 12 guillotine
 * leagues. The config is written in the create transaction; the SEASON — which
 * the elimination engine, chop audit, survival log and waiver-release engine all
 * hang off — was only ever created by a commissioner POSTing to
 * `/api/guillotine/season` by hand, and nobody ever did.
 *
 * `guillotineChopAudit.ts` already recorded the consequence and the rule:
 * every function there keys off a `GuillotineSeason`, reports
 * `no_guillotine_season`, and deliberately does NOT create the row as a side
 * effect of a chop ("a chop that silently materialises season state is hard to
 * reason about afterwards"). This creates it at a known, deliberate point
 * instead — post-draft, beside the sync that produces its dependency.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const isGuillotineLeague = vi.fn()
const redraftSeasonFindFirst = vi.fn()
const guillotineSeasonFindFirst = vi.fn()
const guillotineSeasonCreate = vi.fn()
const redraftRosterCount = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findFirst: (...a: unknown[]) => redraftSeasonFindFirst(...a) },
    guillotineSeason: {
      findFirst: (...a: unknown[]) => guillotineSeasonFindFirst(...a),
      create: (...a: unknown[]) => guillotineSeasonCreate(...a),
    },
    redraftRoster: { count: (...a: unknown[]) => redraftRosterCount(...a) },
  },
}))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({
  isGuillotineLeague: (...a: unknown[]) => isGuillotineLeague(...a),
}))

import { ensureGuillotineSeason } from '@/lib/guillotine/ensureGuillotineSeason'

const REDRAFT_SEASON = { id: 'rs1', sport: 'NFL', season: 2026 }

beforeEach(() => {
  vi.clearAllMocks()
  isGuillotineLeague.mockResolvedValue(true)
  redraftSeasonFindFirst.mockResolvedValue(REDRAFT_SEASON)
  guillotineSeasonFindFirst.mockResolvedValue(null)
  redraftRosterCount.mockResolvedValue(12)
  guillotineSeasonCreate.mockResolvedValue({ id: 'gs1' })
})

describe('ensureGuillotineSeason', () => {
  it('creates the season from the RedraftSeason it is keyed to', async () => {
    const result = await ensureGuillotineSeason({ leagueId: 'lg1', redraftSeasonId: 'rs1' })

    expect(result).toEqual({ ok: true, created: true, seasonId: 'gs1' })
    expect(guillotineSeasonCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leagueId: 'lg1',
          redraftSeasonId: 'rs1',
          // ⚠ Sport and season come from the RedraftSeason, never from a caller.
          // The old route accepted overrides that defaulted to these values,
          // which let a guillotine season disagree with the season it is keyed
          // to — and every downstream engine reads this copy as authoritative.
          sport: 'NFL',
          season: 2026,
          totalTeamsStarted: 12,
          currentTeamsActive: 12,
          currentScoringPeriod: 0,
        }),
      }),
    )
  })

  it('is idempotent — the post-draft hook is throttled, not locked', async () => {
    guillotineSeasonFindFirst.mockResolvedValue({ id: 'existing' })
    const result = await ensureGuillotineSeason({ leagueId: 'lg1', redraftSeasonId: 'rs1' })
    expect(result).toEqual({ ok: true, created: false, seasonId: 'existing' })
    expect(guillotineSeasonCreate).not.toHaveBeenCalled()
  })

  it('refuses to build a season that starts with zero teams', async () => {
    // 🛑 THE GUARD THAT MATTERS. `totalTeamsStarted` is the number the chop line
    // counts down from. A season created with 0 eliminates nobody and reports
    // itself healthy forever — worse than having no season row at all, which at
    // least makes the audit say `no_guillotine_season` out loud.
    redraftRosterCount.mockResolvedValue(0)
    const result = await ensureGuillotineSeason({ leagueId: 'lg1', redraftSeasonId: 'rs1' })
    expect(result).toEqual({ ok: false, reason: 'NO_ROSTERS' })
    expect(guillotineSeasonCreate).not.toHaveBeenCalled()
  })

  it('does nothing for a league that is not guillotine', async () => {
    isGuillotineLeague.mockResolvedValue(false)
    const result = await ensureGuillotineSeason({ leagueId: 'lg1', redraftSeasonId: 'rs1' })
    expect(result).toEqual({ ok: false, reason: 'NOT_GUILLOTINE' })
    expect(redraftSeasonFindFirst).not.toHaveBeenCalled()
  })

  it('refuses a RedraftSeason belonging to another league', async () => {
    // The lookup is scoped by leagueId, so a mismatched pair reads as missing.
    redraftSeasonFindFirst.mockResolvedValue(null)
    const result = await ensureGuillotineSeason({ leagueId: 'lg1', redraftSeasonId: 'rs-other' })
    expect(result).toEqual({ ok: false, reason: 'REDRAFT_SEASON_NOT_FOUND' })
  })

  it('resolves a lost unique race to the winner rather than throwing', async () => {
    // `redraftSeasonId` is @unique and the read-then-create window is real.
    guillotineSeasonCreate.mockRejectedValueOnce(new Error('unique constraint'))
    guillotineSeasonFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'theirs' })

    const result = await ensureGuillotineSeason({ leagueId: 'lg1', redraftSeasonId: 'rs1' })
    expect(result).toEqual({ ok: true, created: false, seasonId: 'theirs' })
  })
})
