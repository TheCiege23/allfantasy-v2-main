/**
 * Imported league drafts → ADP samples.
 *
 * `SleeperHistoricalDraftSyncService` writes `DraftFact`; the ADP recompute reads `DraftPick`.
 * Nothing joined them, so importing a league with ten seasons of draft history contributed zero
 * ADP. These tests pin the three judgement calls in the bridge that would be wrong if "fixed":
 *
 *   - draftType is `imported`, never `snake` — DraftFact records no draft type and an auction is
 *     indistinguishable from a snake draft in this table.
 *   - teamCount is counted from round-1 facts, not read off `League.leagueSize` (today's size).
 *   - a player whose Sleeper id will not resolve is DROPPED, never given a placeholder name.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDraftFactFindMany = vi.hoisted(() => vi.fn().mockResolvedValue([] as unknown[]))
const mockLeagueFindMany = vi.hoisted(() => vi.fn().mockResolvedValue([] as unknown[]))
const mockIdentityFindMany = vi.hoisted(() => vi.fn().mockResolvedValue([] as unknown[]))
const mockSportsPlayerFindMany = vi.hoisted(() => vi.fn().mockResolvedValue([] as unknown[]))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftFact: { findMany: mockDraftFactFindMany },
    league: { findMany: mockLeagueFindMany },
    playerIdentityMap: { findMany: mockIdentityFindMany },
    sportsPlayer: { findMany: mockSportsPlayerFindMany },
  },
}))

import { collectDraftFactSamples } from '@/lib/adp/draftFactSamples'

const LEAGUE = { id: 'lg1', scoring: 'ppr', isDynasty: true, leagueVariant: null }

/** A complete 4-team, 2-round draft: 8 picks, round 1 carrying exactly 4. */
function fourTeamDraft(leagueId = 'lg1', season = 2024) {
  const out = []
  for (let pick = 1; pick <= 8; pick++) {
    out.push({
      leagueId,
      season,
      round: pick <= 4 ? 1 : 2,
      pickNumber: pick,
      playerId: `sleeper-${pick}`,
    })
  }
  return out
}

function identityRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    sleeperId: `sleeper-${i + 1}`,
    canonicalName: `Player ${i + 1}`,
    position: i % 2 === 0 ? 'WR' : 'RB',
  }))
}

beforeEach(() => {
  mockDraftFactFindMany.mockReset().mockResolvedValue([])
  mockLeagueFindMany.mockReset().mockResolvedValue([LEAGUE])
  mockIdentityFindMany.mockReset().mockResolvedValue([])
  mockSportsPlayerFindMany.mockReset().mockResolvedValue([])
})

describe('context derivation', () => {
  beforeEach(() => {
    mockDraftFactFindMany.mockResolvedValue(fourTeamDraft())
    mockIdentityFindMany.mockResolvedValue(identityRows(8))
  })

  it('records draftType as "imported" rather than assuming snake', async () => {
    const { picks } = await collectDraftFactSamples({ sport: 'NFL' })
    expect(picks).toHaveLength(8)
    for (const p of picks) expect(p.context.draftType).toBe('imported')
  })

  it('counts teams from round-1 facts, not from the league row', async () => {
    // League.leagueSize is deliberately never selected; the draft itself says 4.
    const { picks } = await collectDraftFactSamples({ sport: 'NFL' })
    for (const p of picks) expect(p.context.teamCount).toBe(4)
    const selected = mockLeagueFindMany.mock.calls[0]?.[0]?.select ?? {}
    expect(selected).not.toHaveProperty('leagueSize')
  })

  it('derives pick-in-round from the measured team count', async () => {
    const { picks } = await collectDraftFactSamples({ sport: 'NFL' })
    const byOverall = new Map(picks.map((p) => [p.overall, p]))
    expect(byOverall.get(1)?.roundPick).toBe(1)
    expect(byOverall.get(4)?.roundPick).toBe(4)
    expect(byOverall.get(5)?.roundPick).toBe(1) // wraps into round 2
  })

  it('takes leagueType and scoring from the league, and season from the fact', async () => {
    const { picks } = await collectDraftFactSamples({ sport: 'NFL' })
    expect(picks[0]!.context.leagueType).toBe('dynasty')
    expect(picks[0]!.context.scoringFormat).toBe('ppr')
    expect(picks[0]!.context.season).toBe('2024')
  })

  it('never stamps a pick time — the import date is not the draft date', async () => {
    const { picks } = await collectDraftFactSamples({ sport: 'NFL' })
    for (const p of picks) expect(p.pickedAt).toBeNull()
  })
})

describe('identity resolution', () => {
  it('drops an unresolvable Sleeper id instead of naming it', async () => {
    mockDraftFactFindMany.mockResolvedValue(fourTeamDraft())
    mockIdentityFindMany.mockResolvedValue(identityRows(8).slice(0, 6))

    const result = await collectDraftFactSamples({ sport: 'NFL' })
    expect(result.picks).toHaveLength(6)
    expect(result.skippedUnresolvedPlayer).toBe(2)
    // No placeholder key: every kept pick has a real name and position.
    for (const p of result.picks) {
      expect(p.playerName.trim()).not.toBe('')
      expect(p.position.trim()).not.toBe('')
    }
  })

  it('falls back to SportsPlayer when the identity map has not caught up', async () => {
    mockDraftFactFindMany.mockResolvedValue(fourTeamDraft())
    mockIdentityFindMany.mockResolvedValue(identityRows(8).slice(0, 6))
    mockSportsPlayerFindMany.mockResolvedValue([
      { sleeperId: 'sleeper-7', name: 'Late Addition', position: 'TE' },
      { sleeperId: 'sleeper-8', name: 'Also Late', position: 'QB' },
    ])

    const result = await collectDraftFactSamples({ sport: 'NFL' })
    expect(result.picks).toHaveLength(8)
    expect(result.skippedUnresolvedPlayer).toBe(0)
    // The fallback is only asked about the ids the canonical map missed.
    expect(mockSportsPlayerFindMany.mock.calls[0]?.[0]?.where?.sleeperId?.in).toEqual([
      'sleeper-7',
      'sleeper-8',
    ])
  })

  it('rejects an identity row missing a position rather than defaulting one', async () => {
    mockDraftFactFindMany.mockResolvedValue(fourTeamDraft())
    mockIdentityFindMany.mockResolvedValue([
      ...identityRows(8).slice(0, 7),
      { sleeperId: 'sleeper-8', canonicalName: 'No Position', position: null },
    ])

    const result = await collectDraftFactSamples({ sport: 'NFL' })
    expect(result.picks).toHaveLength(7)
    expect(result.skippedUnresolvedPlayer).toBe(1)
  })
})

describe('groups that cannot be described are skipped, not guessed', () => {
  it('skips a draft with no round-1 facts', async () => {
    mockDraftFactFindMany.mockResolvedValue([
      { leagueId: 'lg1', season: 2024, round: 2, pickNumber: 5, playerId: 'sleeper-1' },
      { leagueId: 'lg1', season: 2024, round: 2, pickNumber: 6, playerId: 'sleeper-2' },
    ])
    mockIdentityFindMany.mockResolvedValue(identityRows(2))

    const result = await collectDraftFactSamples({ sport: 'NFL' })
    expect(result.picks).toHaveLength(0)
    expect(result.skippedNoTeamCount).toBe(2)
  })

  it('skips facts whose league row is gone', async () => {
    mockDraftFactFindMany.mockResolvedValue(fourTeamDraft('orphan-league'))
    mockLeagueFindMany.mockResolvedValue([])
    mockIdentityFindMany.mockResolvedValue(identityRows(8))

    const result = await collectDraftFactSamples({ sport: 'NFL' })
    expect(result.picks).toHaveLength(0)
    expect(result.skippedNoLeague).toBe(8)
  })

  it('keeps two seasons of the same league on separate boards', async () => {
    mockDraftFactFindMany.mockResolvedValue([
      ...fourTeamDraft('lg1', 2023),
      ...fourTeamDraft('lg1', 2024),
    ])
    mockIdentityFindMany.mockResolvedValue(identityRows(8))

    const result = await collectDraftFactSamples({ sport: 'NFL' })
    expect(result.draftsCovered).toBe(2)
    expect(new Set(result.picks.map((p) => p.context.season))).toEqual(new Set(['2023', '2024']))
  })
})

describe('scoping', () => {
  it('passes the season through to the query when one is given', async () => {
    await collectDraftFactSamples({ sport: 'NFL', season: '2024' })
    expect(mockDraftFactFindMany.mock.calls[0]?.[0]?.where).toMatchObject({
      sport: 'NFL',
      season: 2024,
    })
  })

  it('omits the season filter when none is given', async () => {
    await collectDraftFactSamples({ sport: 'NFL' })
    expect(mockDraftFactFindMany.mock.calls[0]?.[0]?.where).not.toHaveProperty('season')
  })
})
