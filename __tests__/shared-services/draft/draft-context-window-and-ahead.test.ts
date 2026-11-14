import { describe, expect, it, vi } from 'vitest'

/*
 * The draft context carries the specifics of THIS draft (2026-11-14): the tournament stage's
 * scoring weeks, schedule-derived byes, and the teams picking before the user's next turn —
 * found by draft slot, so it works for a draft mirrored from Sleeper.
 */

const tournamentLeagueFindUnique = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: { tournamentLeague: { findUnique: tournamentLeagueFindUnique } } }))

import {
  assembleEngineInputFromPicks,
  resolveDraftScoringWindow,
  teamsAheadFromPicks,
} from '@/lib/shared-services/draft/DraftContextAssembler'

describe('resolveDraftScoringWindow', () => {
  it('reads the tournament round’s weeks and names the stage', async () => {
    tournamentLeagueFindUnique.mockResolvedValue({ round: { roundNumber: 2, weekStart: 11, weekEnd: 12 }, tournament: { name: 'KBI' } })
    expect(await resolveDraftScoringWindow('league-1')).toEqual({ startWeek: 11, endWeek: 12, label: 'KBI round 2' })
  })

  it('is null for a season-long league and on a read failure', async () => {
    tournamentLeagueFindUnique.mockResolvedValue(null)
    expect(await resolveDraftScoringWindow('league-1')).toBeNull()
    tournamentLeagueFindUnique.mockRejectedValue(new Error('down'))
    expect(await resolveDraftScoringWindow('league-1')).toBeNull()
  })
})

describe('byes from the schedule', () => {
  it('fills each available player’s and rostered player’s bye from their team', () => {
    const out = assembleEngineInputFromPicks({
      picksSoFar: [{ rosterId: 'me', position: 'QB', team: 'BUF', byeWeek: null, playerName: 'Josh Allen' }],
      targetRosterId: 'me',
      adpEntries: [
        { playerName: 'Bye Played', position: 'WR', team: 'KC', adp: 40 },
        { playerName: 'No Team', position: 'WR', team: null, adp: 41 },
      ],
      poolByKey: new Map(),
      rosterSlots: ['QB', 'WR'],
      round: 4,
      pick: 1,
      totalTeams: 16,
      sport: 'NFL',
      isDynasty: false,
      isSF: false,
      mode: 'needs',
      byeByTeam: new Map([['KC', 10], ['BUF', 7]]),
      scoringWindow: { startWeek: 11, endWeek: 12 },
    })
    expect(out.engineInput.available.map((p) => p.byeWeek)).toEqual([10, null])
    expect(out.engineInput.teamRoster[0]?.byeWeek).toBe(7)
    expect(out.engineInput.scoringWindow).toEqual({ startWeek: 11, endWeek: 12 })
  })
})

describe('teamsAheadFromPicks', () => {
  // 4-team snake. Me = slot 4 (picks 4, 5, 12, …). On the clock: overall 6 (slot 3).
  const picks = [
    { rosterId: 's1', slot: 1, overall: 1, position: 'RB' },
    { rosterId: 's2', slot: 2, overall: 2, position: 'WR' },
    { rosterId: 's3', slot: 3, overall: 3, position: 'QB' },
    { rosterId: 'sleeper-me', slot: 4, overall: 4, position: 'RB' },
    { rosterId: 'sleeper-me', slot: 4, overall: 5, position: 'WR' },
  ]

  it('lists the slots picking before my next turn, by draft slot', () => {
    const ahead = teamsAheadFromPicks({ picks, ownIds: new Set(['sleeper-me']), currentOverall: 6, totalTeams: 4, snake: true })
    // Picks 6, 7, 8 (slots 3, 2, 1) then 9 (slot 1)… my next is 12: slots 3, 2, 1 in order.
    expect(ahead).toEqual([['QB'], ['WR'], ['RB']])
  })

  it('is empty when I have no pick yet to anchor my slot', () => {
    expect(teamsAheadFromPicks({ picks, ownIds: new Set(['nobody']), currentOverall: 6, totalTeams: 4, snake: true })).toEqual([])
  })
})
