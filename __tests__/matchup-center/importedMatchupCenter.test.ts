/**
 * Found live 2026-11-23: every imported league's Matchup tab said "No opponent, 0.0" because the
 * route read `TeamWeekResult`, which no importer writes. These pin the mapping from the stored week.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MatchupData } from '@/lib/core-app/matchup'
import { matchupCenterFromMatchupData, parseRecord } from '@/lib/matchup-center/importedMatchupCenter'

const cell = (over: Record<string, unknown>) => ({
  playerId: 'p', sleeperId: null, name: 'Player', position: 'QB', team: 'KC', sport: 'NFL', imageUrl: null,
  projected: 20, actual: null, empty: false, unavailable: null, gameState: 'upcoming', ...over,
})

function data(over: Partial<Record<keyof MatchupData, unknown>> = {}): MatchupData {
  return {
    league: { id: 'L', name: 'Peach Bowl', platform: 'sleeper', logoUrl: null, sourceLink: null, lineupLink: null },
    week: { available: true, data: { week: 11, season: 2026, isFinal: false } },
    teams: {
      available: true,
      data: {
        you: { teamName: '(F) SF TEP', ownerName: 'me', record: '6-4', isYou: true, avatarUrl: null },
        opponent: { teamName: 'Connor0488', ownerName: 'c', record: '8-2-1', isYou: false, avatarUrl: 'https://x/a.png' },
      },
    },
    sides: {
      available: true,
      data: {
        you: { teamName: '(F) SF TEP', ownerName: 'me', record: '6-4', points: 66.66, isYou: true, avatarUrl: null },
        opponent: { teamName: 'Connor0488', ownerName: 'c', record: '8-2-1', points: 184.04, isYou: false, avatarUrl: null },
      },
    },
    lineups: {
      available: true,
      data: [
        { slotLabel: 'QB', you: cell({ playerId: '4046', sleeperId: '4046', name: 'Patrick Mahomes', actual: 22.5, gameState: 'final' }), opponent: cell({ playerId: '6904', name: 'Jalen Hurts', actual: 30.1, gameState: 'final' }) },
        { slotLabel: 'FLEX', you: cell({ playerId: '9', name: 'Monday Guy', gameState: 'upcoming', kickoff: '2026-11-24T01:15:00Z', home: false, opponentClub: 'NYG' }), opponent: null },
      ],
    },
    identityNote: null,
    playerScoring: { available: false, reason: 'x' },
    winProbability: { available: true, data: { pWin: 0.02, projectedMargin: -100, confidence: 'high', detail: '' } },
    projectedFinal: { available: false, reason: 'x' },
    yetToPlay: { available: false, reason: 'x' },
    starterCounts: { upcoming: 1, live: 0, final: 2, unknown: 0 },
    starterCountsBySide: { you: { upcoming: 1, live: 0, final: 1, unknown: 0 }, opponent: { upcoming: 0, live: 0, final: 1, unknown: 0 } },
    ...over,
  } as unknown as MatchupData
}

const opts = { leagueId: 'L', sport: 'NFL', season: 2026, conceptOverlay: null }

describe('imported league Matchup tab', () => {
  it('shows the real opponent and the stored score', () => {
    const p = matchupCenterFromMatchupData(data(), opts)!
    expect(p.week).toBe(11)
    expect(p.left.teamName).toBe('(F) SF TEP')
    expect(p.right.teamName).toBe('Connor0488')
    expect(p.left.totalPoints).toBe(66.66)
    expect(p.right.totalPoints).toBe(184.04)
    expect(p.right.record).toEqual({ wins: 8, losses: 2, ties: 1 })
    expect(p.right.avatarUrl).toBe('https://x/a.png')
    expect(p.left.remainingStarters).toBe(1)
    expect(p.right.remainingStarters).toBe(0)
    expect(p.matchupStatus).toBe('live')
    expect(p.winProbabilityLeft).toBe(0.02)
  })

  it('keeps the two lineups aligned slot for slot, with an empty hole', () => {
    const p = matchupCenterFromMatchupData(data(), opts)!
    expect(p.left.starters.map((s) => s.name)).toEqual(['Patrick Mahomes', 'Monday Guy'])
    expect(p.right.starters.map((s) => s.name)).toEqual(['Jalen Hurts', 'Empty'])
    expect(p.left.starters[0]).toMatchObject({ playerId: '4046', currentPoints: 22.5, gameStatus: 'final', gameLabel: 'Final' })
    expect(p.left.starters[1]).toMatchObject({ opponent: 'NYG', outlook: { homeAway: 'away', kickoffTimeIso: '2026-11-24T01:15:00Z' } })
  })

  it('a finished week reads final; no fixture on file is no payload', () => {
    expect(matchupCenterFromMatchupData(data({ week: { available: true, data: { week: 10, season: 2026, isFinal: true } } }), opts)!.matchupStatus).toBe('final')
    expect(matchupCenterFromMatchupData(data({ teams: { available: false, reason: 'no fixture' } }), opts)).toBeNull()
  })

  it('parses records', () => {
    expect(parseRecord('7-3')).toEqual({ wins: 7, losses: 3, ties: 0 })
    expect(parseRecord(null)).toEqual({ wins: 0, losses: 0, ties: 0 })
  })

  it('the route sends an imported league through the stored week before the native-only read', () => {
    const src = readFileSync(resolve(__dirname, '../../server/services/matchupCenterService.ts'), 'utf8')
    const branch = src.indexOf('if (league.platformLeagueId && !isNativePlatform(league.platform))')
    expect(branch).toBeGreaterThan(-1)
    expect(src.indexOf('matchupCenterFromMatchupData(data,')).toBeGreaterThan(branch)
    expect(branch).toBeLessThan(src.indexOf('prisma.teamWeekResult.findUnique'))
  })
})
