import { describe, expect, it, vi } from 'vitest'

import { loadIdpPlayerCard } from '@/lib/idp-projections/idpPlayerCard'

/**
 * The card replaces a modal that rendered a hash of the player id as a box score.
 *
 * These cover the two ways that failure could come back: a number appearing without a row behind
 * it, and a row being counted when we cannot tell its blank from its zero.
 */

vi.mock('@/lib/waivers/recentFormProjection', () => ({
  projectFromRecentForm: async () => new Map(),
}))

const SCORING = { tkl_solo: 1, tkl_ast: 0.5, sack: 4, int: 6 }

function fakePrisma(opts: {
  league?: unknown
  rows?: Array<{ weekOrRound: number; normalizedStatMap: unknown }>
}) {
  return {
    league: {
      findUnique: async () => opts.league ?? null,
      findFirst: async () => null,
    },
    playerGameStat: { findMany: async () => opts.rows ?? [] },
  } as never
}

/** Scoring lives nested inside `League.settings`; there is no `scoringSettings` column. */
const leagueWith = (scoring: unknown) => ({ id: 'lg', settings: { scoring_settings: scoring } })

const args = { leagueId: 'lg', playerId: 'p1', season: 2025 }

describe('loadIdpPlayerCard', () => {
  it('refuses when the league has no scoring settings rather than printing zeroes', async () => {
    const card = await loadIdpPlayerCard({
      ...args,
      prisma: fakePrisma({ league: { id: 'lg', settings: null } }),
    })
    expect(card.state).toBe('no-scoring')
    expect(card.seasonPoints).toBeNull()
    expect(card.stats).toEqual([])
  })

  it('says so when the player has no game rows', async () => {
    const card = await loadIdpPlayerCard({
      ...args,
      prisma: fakePrisma({
        league: leagueWith(SCORING),
        rows: [],
      }),
    })
    expect(card.state).toBe('no-games')
    expect(card.notes[0]).toContain('No 2025 game rows')
  })

  it('totals only games carrying a defensive snap count', async () => {
    const card = await loadIdpPlayerCard({
      ...args,
      prisma: fakePrisma({
        league: leagueWith(SCORING),
        rows: [
          { weekOrRound: 1, normalizedStatMap: { def_snp: 40, idp_tkl_solo: 5, idp_sack: 1 } },
          { weekOrRound: 2, normalizedStatMap: { def_snp: 30, idp_tkl_solo: 3 } },
          // No snap count: a blank cannot be told from a zero, so this game is not counted.
          { weekOrRound: 3, normalizedStatMap: { idp_tkl_solo: 99 } },
        ],
      }),
    })

    expect(card.state).toBe('ok')
    expect(card.games).toBe(2)
    const solo = card.stats.find((s) => s.key === 'tkl_solo')
    expect(solo?.total).toBe(8)
    expect(solo?.perGame).toBe(4)
  })

  it('drops a stat no counted game carries instead of reporting it as zero', async () => {
    const card = await loadIdpPlayerCard({
      ...args,
      prisma: fakePrisma({
        league: leagueWith(SCORING),
        rows: [{ weekOrRound: 1, normalizedStatMap: { def_snp: 40, idp_tkl_solo: 5 } }],
      }),
    })
    expect(card.stats.find((s) => s.key === 'tkl_solo')?.total).toBe(5)
    expect(card.stats.find((s) => s.key === 'int')).toBeUndefined()
  })

  it('takes the larger of the two defensive-touchdown spellings rather than summing them', async () => {
    const card = await loadIdpPlayerCard({
      ...args,
      prisma: fakePrisma({
        league: leagueWith(SCORING),
        rows: [
          {
            weekOrRound: 1,
            normalizedStatMap: {
              def_snp: 40,
              idp_def_td: 1,
              idp_defensive_touchdown: 1,
            },
          },
        ],
      }),
    })
    expect(card.stats.find((s) => s.key === 'def_td')?.total).toBe(1)
  })

  it('prices each week with league scoring and leaves an unpriceable week null', async () => {
    const card = await loadIdpPlayerCard({
      ...args,
      prisma: fakePrisma({
        league: leagueWith(SCORING),
        rows: [
          { weekOrRound: 1, normalizedStatMap: { def_snp: 40, idp_tkl_solo: 5 } },
          // Nothing this league prices — null, not 0.0.
          { weekOrRound: 2, normalizedStatMap: { def_snp: 40, def_kr_yd: 22 } },
        ],
      }),
    })

    expect(card.weeks.find((w) => w.week === 1)?.points).toBe(5)
    expect(card.weeks.find((w) => w.week === 2)?.points).toBeNull()
    expect(card.seasonPoints).toEqual({ total: 5, perGame: 5, games: 1 })
  })

  it('never returns a matchup grade or an opponent rank', async () => {
    const card = await loadIdpPlayerCard({
      ...args,
      prisma: fakePrisma({
        league: leagueWith(SCORING),
        rows: [{ weekOrRound: 1, normalizedStatMap: { def_snp: 40, idp_tkl_solo: 5 } }],
      }),
    })
    const serialized = JSON.stringify(card)
    expect(serialized).not.toMatch(/Favorable|Tough/)
    expect(card.notes.join(' ')).toContain('No matchup grade')
  })
})
