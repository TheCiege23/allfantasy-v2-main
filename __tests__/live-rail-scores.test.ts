import { describe, expect, it, vi } from 'vitest'
import { livePoints, parseLiveMatchups, summarizeLiveScores } from '@/lib/core-app/liveRailScores'
import { discordOAuthConfigValid } from '@/lib/discord/oauth-config'
vi.mock('server-only', () => ({}))
import { currentSleeperWeek } from '@/lib/core-app/sleeperRailFeed'

const row = (id: number, points: number, matchup: number | null = id) => ({ roster_id: id, matchup_id: matchup, points })

describe('live league rail', () => {
  it('pairs on matchup_id, not row order or cached pointsAgainst', () => {
    expect(summarizeLiveScores([row(3, 99, 2), row(2, 28.7, 1), row(1, 10, 1)], '1')).toMatchObject({ yourScore: 10, opponentScore: 28.7, opponentRosterId: '2', unpaired: false })
  })
  it('honors commissioner overrides, including zero', () => {
    expect(livePoints({ ...row(1, 37), custom_points: 0 })).toBe(0)
    expect(livePoints({ ...row(1, 37), custom_points: -2 })).toBe(-2)
  })
  it('shows both zero scores without pretending they are missing', () => {
    expect(summarizeLiveScores([row(1, 0, 1), row(2, 0, 1)], '1')).toMatchObject({ yourScore: 0, opponentScore: 0, scored: true })
  })
  it('ranks on league points even when your own score is zero', () => {
    expect(summarizeLiveScores([row(1, 0), row(2, 21), row(3, -2)], '1')?.standing).toMatchObject({ rank: 2, outOf: 3, basis: 'points', overCut: 2 })
  })
  it('shares ranks for ties and identifies every tied-lowest roster', () => {
    const rows = [row(1, 8), row(2, 0), row(3, 0)]
    for (const id of ['2', '3']) expect(summarizeLiveScores(rows, id)?.standing).toMatchObject({ rank: 2, tied: true, overCut: null })
  })
  it('recomputes after downward corrections', () => {
    expect(summarizeLiveScores([row(1, 12), row(2, 10)], '1')?.standing?.rank).toBe(1)
    expect(summarizeLiveScores([row(1, 9), row(2, 10)], '1')?.standing?.rank).toBe(2)
  })
  it('rejects malformed and partial fields rather than ranking missing points as zero', () => {
    expect(parseLiveMatchups([row(1, 0), { roster_id: 2 }])).toBeNull()
    expect(parseLiveMatchups([row(1, 0), row(1, 1)])).toBeNull()
    expect(parseLiveMatchups([{ ...row(1, 0), points: '12' }])).toBeNull()
    expect(parseLiveMatchups([{ ...row(1, 0), custom_points: NaN }])).toBeNull()
    expect(parseLiveMatchups([row(1, -2)])).toHaveLength(1)
  })
  it('does not fabricate a matchup for an unknown roster', () => {
    expect(summarizeLiveScores([row(1, 0)], '9')).toBeNull()
  })
  it('retains the field race when a configured guillotine league has paired fixtures', () => {
    const result = summarizeLiveScores([row(1, 20, 1), row(2, 12, 1), row(3, 30, 2), row(4, 20, 2)], '1')
    expect(result?.standing).toBeNull()
    expect(result?.fieldStanding).toMatchObject({ rank: 2, placesAboveCut: 1, cutLine: 12, overCut: 8, tied: true })
  })
  it('uses the provider current week, not earliest zero-scoring DB fixture', () => {
    expect(currentSleeperWeek({ season: '2026', week: 2, season_type: 'regular' })).toEqual({ season: 2026, week: 2 })
    expect(currentSleeperWeek({ season: '2026', week: 1, season_type: 'pre' })).toBeNull()
    expect(currentSleeperWeek({ season: '2026', week: 0, season_type: 'regular' })).toBeNull()
  })
})

describe('Discord OAuth configuration', () => {
  it('accepts the verified public application and registered callback', () => {
    expect(discordOAuthConfigValid('1499502145039499344', 'https://www.allfantasy.ai/api/auth/discord/callback')).toBe(true)
  })
  it('rejects redacted IDs and unsafe callback URLs', () => {
    expect(discordOAuthConfigValid('[SENSITIVE]', 'https://www.allfantasy.ai/api/auth/discord/callback')).toBe(false)
    expect(discordOAuthConfigValid('1499502145039499344', 'javascript:alert(1)')).toBe(false)
    expect(discordOAuthConfigValid('1499502145039499344', 'https://user:password@example.com/callback')).toBe(false)
    expect(discordOAuthConfigValid('1499502145039499344', 'http://example.com/callback')).toBe(false)
  })
})
