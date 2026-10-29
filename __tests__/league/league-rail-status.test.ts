import { describe, expect, it } from 'vitest'
import { adjacentLeagueId, leagueRailStatus, unreadBadgeText } from '@/lib/league/leagueRailStatus'
import { tallyLeagueUnread } from '@/lib/chat-core/leagueUnreadTally'
import type { RailMatchupSummary } from '@/components/core-app/AfCoreShell'

const h2h = (yourScore: number, opponentScore: number, scored = true): RailMatchupSummary => ({
  week: 5,
  yourTeam: 'Mine',
  yourAvatarUrl: null,
  yourScore,
  opponentTeam: 'Theirs',
  opponentAvatarUrl: null,
  opponentScore,
  scored,
})

describe('leagueRailStatus (handoff §2 ring + record line)', () => {
  it('rings amber and groups under "Needs you" before the draft, whatever the scoreboard says', () => {
    expect(leagueRailStatus({ m: h2h(10, 0), phase: 'Setup', weekLabel: 'Setup' })).toMatchObject({ tone: 'needs', mini: 'SETUP', group: 'needs' })
    expect(leagueRailStatus({ m: null, phase: 'Draft', weekLabel: 'Draft' })).toMatchObject({ tone: 'needs', mini: 'DRAFT' })
  })

  it('rings green when winning and red when losing, with the score in the mono line', () => {
    expect(leagueRailStatus({ m: h2h(88.4, 71.2), phase: 'Regular season', weekLabel: 'Wk 5' })).toEqual({
      tone: 'good', mini: '88–71', line: 'Winning · Wk 5', group: 'live',
    })
    expect(leagueRailStatus({ m: h2h(62, 80), phase: 'Regular season', weekLabel: 'Wk 5' })).toMatchObject({ tone: 'bad', mini: '62–80', line: 'Losing · Wk 5' })
  })

  it('draws no ring for a tied or unplayed week', () => {
    expect(leagueRailStatus({ m: h2h(50, 50), phase: 'Regular season', weekLabel: 'Wk 5' }).tone).toBeNull()
    const unplayed = leagueRailStatus({ m: h2h(0, 0, false), phase: 'Regular season', weekLabel: 'Wk 5' })
    expect(unplayed).toMatchObject({ tone: null, mini: 'WK 5', group: 'other' })
  })

  it('reads a field race (elimination standing) as over / at the cut, with an ordinal place', () => {
    const base = { ...h2h(0, 0), opponentTeam: null, unpaired: true }
    const safe = leagueRailStatus({ m: { ...base, standing: { rank: 8, outOf: 14, overCut: 35.9, basis: 'points', placesAboveCut: 6, cutLine: 90, elimination: true } }, phase: 'Regular season', weekLabel: 'Wk 5' })
    expect(safe).toMatchObject({ tone: 'good', mini: '8TH', line: '+35.9 over the cut' })
    const cut = leagueRailStatus({ m: { ...base, standing: { rank: 14, outOf: 14, overCut: null, basis: 'points', placesAboveCut: 0, cutLine: 90, elimination: true } }, phase: 'Regular season', weekLabel: 'Wk 5' })
    expect(cut).toMatchObject({ tone: 'bad', mini: '14TH' })
  })

  it('never returns an empty mono line', () => {
    expect(leagueRailStatus({ m: undefined, phase: 'Offseason', weekLabel: 'Offseason' }).mini).toBe('OFF')
  })
})

describe('unreadBadgeText / adjacentLeagueId', () => {
  it('prints nothing at zero and caps at 99+', () => {
    expect(unreadBadgeText(0)).toBeNull()
    expect(unreadBadgeText(undefined)).toBeNull()
    expect(unreadBadgeText(3)).toBe('3')
    expect(unreadBadgeText(140)).toBe('99+')
  })

  it('steps through leagues with wrap-around for the phone ‹ › arrows', () => {
    expect(adjacentLeagueId(['a', 'b', 'c'], 'a', -1)).toBe('c')
    expect(adjacentLeagueId(['a', 'b', 'c'], 'c', 1)).toBe('a')
    expect(adjacentLeagueId(['a'], 'a', 1)).toBeNull()
  })
})

describe('tallyLeagueUnread (per-league badge = the bubble’s own count)', () => {
  const at = (m: number) => new Date(Date.UTC(2026, 9, 18, 12, m))
  it('splits the league count per league and skips rows older than the read mark', () => {
    const t = tallyLeagueUnread(
      [
        { leagueId: 'L1', createdAt: at(10), mentionedUserIds: ['u1'] },
        { leagueId: 'L1', createdAt: at(1), mentionedUserIds: [] },
        { leagueId: 'L2', createdAt: at(30), mentionedUserIds: [] },
        { leagueId: 'L2', createdAt: at(31), mentionedUserIds: [] },
      ],
      new Map([['L1', at(5)]]),
      'u1',
    )
    expect(t).toEqual({ count: 3, mentions: 1, byLeague: { L1: 1, L2: 2 } })
  })
})
