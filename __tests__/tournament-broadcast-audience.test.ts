// @vitest-environment node
/**
 * Guards who a tournament broadcast selects, and who it can actually reach.
 *
 * 🛑 A BROADCAST IN AN IMPORTED TOURNAMENT REACHES A MINORITY OF ITS AUDIENCE.
 * AllFantasy cannot post into Sleeper, and most of a 240-manager field has never
 * signed up here. Reporting "sent to everyone" when 30 of 240 got a notification
 * is how a commissioner stops chasing it and 200 managers miss the redraft.
 */
import { describe, it, expect } from 'vitest'
import {
  buildPasteBlocks,
  describeAudience,
  parseAudience,
  resolveAudience,
  serializeAudience,
} from '@/lib/tournament/broadcastAudience'
import type { BoardRow, StandingsBoard } from '@/lib/tournament/standingsBoard'

function row(over: Partial<BoardRow> & { displayName: string }): BoardRow {
  return {
    leagueParticipantId: `lp-${over.displayName}`,
    participantId: `p-${over.displayName}`,
    userId: `u-${over.displayName}`,
    wins: 5,
    losses: 4,
    ties: 0,
    pointsFor: 1000,
    pointsAgainst: 900,
    appUserId: null,
    leagueRank: 1,
    conferenceRank: 1,
    unmatched: false,
    matchedBy: 'platformUserId',
    standing: 'in',
    ...over,
  }
}

const BOARD: StandingsBoard = {
  tournamentId: 't1',
  name: 'KBI',
  roundNumber: 1,
  advancersPerLeague: 0,
  wildcardCount: 2,
  bubbleEnabled: true,
  bubbleSize: 1,
  tiebreakerMode: 'points_for',
  unmatchedTotal: 1,
  oldestUpdatedAt: null,
  conferences: [
    {
      id: 'cBlack',
      name: 'BLACK',
      colorHex: null,
      qualifyingCount: 2,
      conferencePoints: 3000,
      leagues: [
        {
          tournamentLeagueId: 'tlBeast',
          leagueId: 'lgA',
          name: 'BEAST',
          unmatchedCount: 1,
          unclaimedTeams: [],
          oldestUpdatedAt: null,
          rows: [
            row({ displayName: 'TyT1', appUserId: 'af-1', standing: 'in' }),
            row({ displayName: 'emmae', standing: 'bubble' }),
            row({ displayName: 'ghost', unmatched: true, standing: 'out', matchedBy: null }),
          ],
        },
        {
          tournamentLeagueId: 'tlGoat',
          leagueId: 'lgB',
          name: 'GOAT',
          unmatchedCount: 0,
          unclaimedTeams: [],
          oldestUpdatedAt: null,
          rows: [row({ displayName: 'RICO3', appUserId: 'af-2', standing: 'out' })],
        },
      ],
    },
    {
      id: 'cGold',
      name: 'GOLD',
      colorHex: null,
      qualifyingCount: 2,
      conferencePoints: 1200,
      leagues: [
        {
          tournamentLeagueId: 'tlGoldBeast',
          leagueId: 'lgC',
          name: 'GOLD BEAST',
          unmatchedCount: 0,
          unclaimedTeams: [],
          oldestUpdatedAt: null,
          rows: [row({ displayName: 'JustPuddy', standing: 'in' })],
        },
      ],
    },
  ],
}

describe('who a filter selects', () => {
  it('all takes every manager in every conference', () => {
    expect(resolveAudience(BOARD, { kind: 'all' }).members).toHaveLength(5)
  })

  it('a conference takes only its own leagues', () => {
    const out = resolveAudience(BOARD, { kind: 'conference', conferenceId: 'cGold' })
    expect(out.members.map((m) => m.displayName)).toEqual(['JustPuddy'])
  })

  it('a league takes only that league', () => {
    const out = resolveAudience(BOARD, { kind: 'league', tournamentLeagueId: 'tlGoat' })
    expect(out.members.map((m) => m.displayName)).toEqual(['RICO3'])
  })

  it('a standing takes that group across the whole tournament', () => {
    const out = resolveAudience(BOARD, { kind: 'standing', standing: 'in' })
    expect(out.members.map((m) => m.displayName)).toEqual(['TyT1', 'JustPuddy'])
  })

  /**
   * 🛑 AN UNMATCHED MANAGER IS NEVER IN A STANDING GROUP. Their record could not
   * be read, so telling them their season ended is a claim on evidence we do not
   * have. `unlinked` is how you address them deliberately.
   */
  it('never sweeps an unmatched manager into an elimination message', () => {
    const out = resolveAudience(BOARD, { kind: 'standing', standing: 'out' })
    expect(out.members.map((m) => m.displayName)).toEqual(['RICO3'])
    expect(out.members.some((m) => m.unmatched)).toBe(false)
  })

  it('unlinked selects exactly the unmatched managers', () => {
    const out = resolveAudience(BOARD, { kind: 'unlinked' })
    expect(out.members.map((m) => m.displayName)).toEqual(['ghost'])
  })
})

describe('reachable versus not', () => {
  it('splits the audience into accounts it can notify and handles to paste', () => {
    const out = resolveAudience(BOARD, { kind: 'all' })
    expect(out.reachableUserIds.sort()).toEqual(['af-1', 'af-2'])
    expect(out.unreachable.map((m) => m.displayName)).toEqual(['emmae', 'ghost', 'JustPuddy'])
  })

  /** ⚠ One notification per account, not per entry. */
  it('does not message the same account twice', () => {
    const board: StandingsBoard = {
      ...BOARD,
      conferences: [
        {
          ...BOARD.conferences[0],
          leagues: [
            {
              ...BOARD.conferences[0].leagues[0],
              rows: [
                row({ displayName: 'A', appUserId: 'af-1' }),
                row({ displayName: 'B', appUserId: 'af-1' }),
              ],
            },
          ],
        },
      ],
    }
    expect(resolveAudience(board, { kind: 'all' }).reachableUserIds).toEqual(['af-1'])
  })
})

describe('the paste blocks', () => {
  /**
   * ⚠ GROUPED BY LEAGUE, because that is how the destination is organised. One
   * flat list of 200 handles cannot be pasted into anything.
   */
  it('produces one block per league, each with its own handles', () => {
    const { unreachable } = resolveAudience(BOARD, { kind: 'all' })
    const blocks = buildPasteBlocks('Redraft opens Tuesday.', unreachable)
    expect(blocks.map((b) => b.leagueName)).toEqual(['BEAST', 'GOLD BEAST'])
    expect(blocks[0].text).toBe('Redraft opens Tuesday.\n\n@emmae @ghost')
    expect(blocks[0].handleCount).toBe(2)
  })

  it('is empty when everyone selected has an account', () => {
    const { unreachable } = resolveAudience(BOARD, { kind: 'league', tournamentLeagueId: 'tlGoat' })
    expect(buildPasteBlocks('hi', unreachable)).toEqual([])
  })
})

describe('the stored audience string', () => {
  it('round-trips every kind', () => {
    const cases = [
      { kind: 'all' as const },
      { kind: 'conference' as const, conferenceId: 'cBlack' },
      { kind: 'league' as const, tournamentLeagueId: 'tlBeast' },
      { kind: 'standing' as const, standing: 'bubble' as const },
      { kind: 'unlinked' as const },
    ]
    for (const c of cases) {
      expect(parseAudience(serializeAudience(c))).toEqual(c)
    }
  })

  /**
   * 🛑 AN UNRECOGNISED AUDIENCE IS NOT "EVERYONE". Defaulting a typo — or an
   * audience written by a newer version — to `all` sends a message meant for
   * eight eliminated managers to all 240.
   */
  it('refuses anything it does not recognise instead of widening to all', () => {
    for (const bad of ['', 'everyone', 'standing:', 'standing:winners', 'conference:', 'league:', ':x']) {
      expect(parseAudience(bad)).toBeNull()
    }
  })
})

describe('the confirm-step summary', () => {
  it('names the conference and league rather than an id', () => {
    expect(describeAudience(BOARD, { kind: 'conference', conferenceId: 'cGold' })).toContain('GOLD')
    expect(describeAudience(BOARD, { kind: 'league', tournamentLeagueId: 'tlBeast' })).toContain(
      'BEAST',
    )
  })

  it('says plainly who a standing group is', () => {
    expect(describeAudience(BOARD, { kind: 'standing', standing: 'out' })).toContain('eliminated')
  })
})
