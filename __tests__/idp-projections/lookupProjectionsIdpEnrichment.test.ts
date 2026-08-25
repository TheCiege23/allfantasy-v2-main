import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The enrichment seam in `lookupProjections`.
 *
 * These assert the SCOPING as hard as the output: an IDP enrichment that runs for a
 * non-IDP league, or that queries game logs for a lineup of wide receivers, is a
 * performance regression on every render of every league in the product.
 */

const fantasyProjectionFindMany = vi.fn()
const playerGameStatFindMany = vi.fn()
const teamTendencyFindMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    fantasyProjection: { findMany: fantasyProjectionFindMany, findFirst: vi.fn() },
    playerGameStat: { findMany: playerGameStatFindMany },
    teamTendencySeason: { findMany: teamTendencyFindMany },
  },
}))

const { lookupProjections } = await import('@/lib/core-app/playerProjections')
const { computeLeagueProjectedPoints } = await import('@/lib/projections/leagueScoring')

const IDP_SCORING = { tkl_solo: 2, tkl_ast: 1, sack: 4, int: 6, rec: 1 }
const OFFENSE_ONLY_SCORING = { rec: 1, pass_td: 4, rec_yd: 0.1 }

/** A vendor row as `import-projections` stores it: metadata outside, stat line at stats.stats. */
function vendorRow(playerId: string, position: string, inner: Record<string, number>) {
  return {
    playerId,
    projectedPoints: inner.pts_ppr ?? 0,
    stats: { name: playerId, position, team: 'CLE', stats: inner },
  }
}

function lbGames(playerId: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    playerId,
    season: 2026,
    weekOrRound: i + 1,
    opponent: 'IND',
    normalizedStatMap: { idp_tkl_solo: 5, idp_tkl_ast: 3 },
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  teamTendencyFindMany.mockResolvedValue([{ teamId: 'IND', secPerPlay: 27 }])
})

describe('lookupProjections — IDP enrichment scoping', () => {
  it('does not query game logs at all when the league does not score IDP', async () => {
    fantasyProjectionFindMany.mockResolvedValue([vendorRow('lb1', 'LB', { pts_ppr: 0.3 })])

    await lookupProjections(['lb1'], { season: '2026', week: 8 }, {
      scoringSettings: OFFENSE_ONLY_SCORING,
    })

    expect(playerGameStatFindMany).not.toHaveBeenCalled()
  })

  it('does not query game logs for an all-offense lineup in an IDP league', async () => {
    fantasyProjectionFindMany.mockResolvedValue([
      vendorRow('wr1', 'WR', { rec: 6, rec_yd: 78, pts_ppr: 13.8 }),
    ])

    await lookupProjections(['wr1'], { season: '2026', week: 8 }, {
      scoringSettings: IDP_SCORING,
    })

    expect(playerGameStatFindMany).not.toHaveBeenCalled()
  })

  it('leaves the vendor projection untouched when enrichment is not requested', async () => {
    fantasyProjectionFindMany.mockResolvedValue([vendorRow('lb1', 'LB', { pts_ppr: 0.3 })])

    const out = await lookupProjections(['lb1'], { season: '2026', week: 8 })
    expect(playerGameStatFindMany).not.toHaveBeenCalled()
    expect(out.get('lb1')!.componentStats).toEqual({ pts_ppr: 0.3 })
    expect(out.get('lb1')!.idpProjection).toBeUndefined()
  })
})

describe('lookupProjections — the linebacker finally gets priced', () => {
  it('turns an unscoreable defender into a real league number', async () => {
    fantasyProjectionFindMany.mockResolvedValue([vendorRow('lb1', 'LB', { pts_ppr: 0.3 })])
    playerGameStatFindMany.mockResolvedValue(lbGames('lb1', 6))

    const out = await lookupProjections(['lb1'], { season: '2026', week: 8 }, {
      scoringSettings: IDP_SCORING,
      opponentBySleeperId: new Map([['lb1', 'IND']]),
    })

    const p = out.get('lb1')!
    // The GENERIC number is untouched and still meaningless — that is not this feature's job.
    expect(p.projectedPoints).toBe(0.3)

    // Before: nothing to score. After: the league's own rules produce a real number.
    const scored = computeLeagueProjectedPoints(p.componentStats, IDP_SCORING)
    expect(scored).not.toBeNull()
    expect(scored!.points).toBeGreaterThan(12)

    expect(p.idpProjection?.basis).toBe('weighted_game_logs')
    expect(p.idpProjection?.notes.some((n) => n.includes('snap-count data'))).toBe(true)
  })

  it('never overwrites a defensive stat the vendor actually projected', async () => {
    // Sleeper's forward-looking payload sometimes does carry idp keys. A projection FOR the
    // week beats one inferred from completed games, so the vendor value must survive.
    fantasyProjectionFindMany.mockResolvedValue([
      vendorRow('lb1', 'LB', { pts_ppr: 0.3, idp_tkl_solo: 9.9 }),
    ])
    playerGameStatFindMany.mockResolvedValue(lbGames('lb1', 6))

    const out = await lookupProjections(['lb1'], { season: '2026', week: 8 }, {
      scoringSettings: IDP_SCORING,
    })

    const cs = out.get('lb1')!.componentStats!
    expect(cs.idp_tkl_solo).toBe(9.9)
    // ...while a key the vendor did NOT speak to is still filled in.
    expect(cs.idp_tkl_ast).toBeGreaterThan(0)
  })

  it('prices a defender the importer dropped for having no pts_ppr', async () => {
    // `fetchSleeperNflProjections` skips any player with no numeric pts_ppr, so this player
    // has no vendor row at all. He is still on someone's roster.
    fantasyProjectionFindMany.mockResolvedValue([])
    playerGameStatFindMany.mockResolvedValue(lbGames('lb1', 6))

    const out = await lookupProjections(['lb1'], { season: '2026', week: 8 }, {
      scoringSettings: IDP_SCORING,
      positionBySleeperId: new Map([['lb1', 'LB']]),
    })

    const p = out.get('lb1')
    expect(p).toBeDefined()
    expect(p!.projectedPoints).toBe(0)
    expect(computeLeagueProjectedPoints(p!.componentStats, IDP_SCORING)!.points).toBeGreaterThan(12)
  })

  it('degrades to the vendor projection when the enrichment query fails', async () => {
    fantasyProjectionFindMany.mockResolvedValue([vendorRow('lb1', 'LB', { pts_ppr: 0.3 })])
    playerGameStatFindMany.mockRejectedValue(new Error('connection reset'))

    const out = await lookupProjections(['lb1'], { season: '2026', week: 8 }, {
      scoringSettings: IDP_SCORING,
    })

    // The lineup must still render. An em dash is the pre-existing behaviour, not a crash.
    expect(out.get('lb1')!.projectedPoints).toBe(0.3)
    expect(out.get('lb1')!.idpProjection).toBeUndefined()
  })

  it('refuses rather than inventing a line for a defender with almost no history', async () => {
    fantasyProjectionFindMany.mockResolvedValue([vendorRow('lb1', 'LB', { pts_ppr: 0.3 })])
    playerGameStatFindMany.mockResolvedValue(lbGames('lb1', 1))

    const out = await lookupProjections(['lb1'], { season: '2026', week: 8 }, {
      scoringSettings: IDP_SCORING,
    })

    const p = out.get('lb1')!
    expect(p.idpProjection).toBeUndefined()
    // No defensive keys were added, so the league scoring path still correctly refuses.
    expect(computeLeagueProjectedPoints(p.componentStats, IDP_SCORING)).toBeNull()
  })
})
