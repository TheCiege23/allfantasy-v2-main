import { describe, expect, it } from 'vitest'
import { attachSlateGames, deriveImpact } from '@/lib/live/liveImpact'
import type { LiveGameCard, LivePlay } from '@/lib/live/liveScoresPage'
import type { PlayFeedItem } from '@/lib/live/playFeedPresentation'
import { liveViewUrl } from '@/components/core-app/screens/LiveScores'

type Tie = { leagueId: string; playerName: string; points: number | null }

function card(
  gameId: string,
  away: string,
  home: string,
  opts: { isLive?: boolean; completed?: boolean; startTime?: string; tieIns?: Tie[] } = {},
): LiveGameCard {
  const side = (abbrev: string) => ({
    abbrev, name: abbrev, logo: '', score: 0, record: null, linescores: [], hits: null, errors: null, leaders: [], shooting: null,
  })
  const tieIns = (opts.tieIns ?? []).map((t, i) => ({
    leagueId: t.leagueId,
    leagueName: `League ${t.leagueId}`,
    playerId: `p-${t.playerName}-${i}`,
    playerName: t.playerName,
    position: 'WR',
    imageUrl: null,
    isStarter: true,
    points: t.points,
  }))
  return {
    gameId, sport: 'NFL', week: 4, status: 'in', statusDetail: 'Q2', clockLabel: null,
    isLive: opts.isLive ?? true, completed: opts.completed ?? false,
    startTime: opts.startTime ?? '2026-09-27T17:00:00.000Z',
    home: side(home), away: side(away),
    winProbability: null, topPerformer: null, leaders: [], leadersArePregame: false,
    situation: null, venue: null, broadcast: null, espnDetail: true,
    tieIns, leaguesAffected: new Set(tieIns.map((t) => t.leagueId)).size,
  }
}

function play(id: string, playerName: string, team: string | null, detectedAt = '2026-09-27T18:00:00.000Z'): PlayFeedItem {
  return {
    // A Rolling Insights game id: it must never be what places the play.
    id, gameId: '20260927-16-32', type: 'TOUCHDOWN', playerName, sleeperId: null, team,
    teamLogoUrl: null, imageUrl: null, position: 'WR', headline: `${playerName} TD`, action: 'TD',
    yards: 20, detectedAt,
  }
}

describe('attachSlateGames', () => {
  const slate = [card('401', 'DAL', 'PHI'), card('402', 'KC', 'BUF')]

  it('places a play in the ESPN game by team, though its own gameId is a Rolling Insights id', () => {
    const [p] = attachSlateGames([play('a', 'A.J. Brown', 'PHI')], slate, 'NFL', new Map())
    expect(p!.slateGameId).toBe('401')
  })

  it('falls back to the rostered player\'s team when the feed sent none', () => {
    const [p] = attachSlateGames([play('a', 'Travis Kelce', null)], slate, 'NFL', new Map([['travis kelce', 'KC']]))
    expect(p!.slateGameId).toBe('402')
  })

  it('leaves a play unplaced when no team can be named — never guessed', () => {
    const [p] = attachSlateGames([play('a', 'Nobody Known', null)], slate, 'NFL', new Map())
    expect(p!.slateGameId).toBeNull()
  })

  it('does not attach last week\'s play to this week\'s game for the same team', () => {
    const [p] = attachSlateGames([play('a', 'A.J. Brown', 'PHI', '2026-09-20T18:00:00.000Z')], slate, 'NFL', new Map())
    expect(p!.slateGameId).toBeNull()
  })

  it('does not attach a play to a game that has not kicked off', () => {
    const pre = [card('403', 'NYG', 'WAS', { isLive: false })]
    const [p] = attachSlateGames([play('a', 'Terry McLaurin', 'WAS')], pre, 'NFL', new Map())
    expect(p!.slateGameId).toBeNull()
  })
})

describe('deriveImpact', () => {
  const slate = [
    card('401', 'DAL', 'PHI', { tieIns: [{ leagueId: 'L1', playerName: 'A.J. Brown', points: 12 }, { leagueId: 'L2', playerName: 'A.J. Brown', points: 10 }] }),
    card('402', 'KC', 'BUF', { tieIns: [{ leagueId: 'L2', playerName: 'Travis Kelce', points: 5 }] }),
  ]
  const plays: LivePlay[] = [
    { ...play('new', 'Travis Kelce', 'KC'), slateGameId: '402' },
    { ...play('old', 'A.J. Brown', 'PHI'), slateGameId: '401' },
    { ...play('x', 'Someone Else', 'NYJ'), slateGameId: null },
  ]

  it('finds Biggest mover on an ESPN slate — it was structurally absent before', () => {
    const impact = deriveImpact(slate, plays, { onlyTheseGamesPlays: false })
    // Newest first: Kelce's play is the newest one by a starter of yours.
    expect(impact.biggestMover?.playerName).toBe('Travis Kelce')
    expect(impact.biggestMover?.leagues).toEqual(['League L2'])
    // The cross-league panel keeps the whole feed.
    expect(impact.plays).toHaveLength(3)
    expect(impact.totalPoints).toBe(27)
  })

  it('scoped to one league, every number and the play list describe only that league', () => {
    // What the screen passes with a league held: games and tie-ins narrowed to L1.
    const l1 = slate
      .map((g) => ({ ...g, tieIns: g.tieIns.filter((t) => t.leagueId === 'L1') }))
      .filter((g) => g.tieIns.length > 0)
    const impact = deriveImpact(l1, plays, { onlyTheseGamesPlays: true })
    expect(impact.totalPoints).toBe(12)
    expect(impact.livePlayers).toBe(1)
    expect(impact.liveGames).toBe(1)
    expect(impact.plays.map((p) => p.id)).toEqual(['old'])
    expect(impact.biggestMover?.playerName).toBe('A.J. Brown')
    expect(impact.biggestMover?.leagues).toEqual(['League L1'])
  })

  it('does not name a bench or unrostered player as your mover', () => {
    const impact = deriveImpact(slate, [{ ...play('x', 'Jalen Hurts', 'PHI'), slateGameId: '401' }], { onlyTheseGamesPlays: false })
    expect(impact.biggestMover).toBeNull()
  })
})

describe('liveViewUrl', () => {
  it('writes the sport and keeps the league', () => {
    expect(liveViewUrl('https://allfantasy.ai/core/live?league=abc', 'NBA', 'my')).toBe('/core/live?league=abc&sport=NBA')
  })
  it('writes scope only when it is not the default', () => {
    expect(liveViewUrl('https://allfantasy.ai/core/live?sport=NFL&scope=all', 'NFL', 'my')).toBe('/core/live?sport=NFL')
    expect(liveViewUrl('https://allfantasy.ai/core/live?sport=NFL', 'NFL', 'all')).toBe('/core/live?sport=NFL&scope=all')
  })
})
