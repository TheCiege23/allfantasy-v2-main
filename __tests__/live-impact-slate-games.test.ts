import { describe, expect, it } from 'vitest'
import { attachSlateGames, deriveImpact, playAgeLabel, starterStageCounts, starterStageDetail } from '@/lib/live/liveImpact'
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

describe('impact total — kept in the data, no longer the headline', () => {
  const two = [
    card('g1', 'A', 'B', { tieIns: [{ leagueId: 'L1', playerName: 'Ann', points: 5 }, { leagueId: 'L2', playerName: 'Ann', points: 4 }] }),
  ]
  it('still counts distinct leagues and sums the points from each', () => {
    const impact = deriveImpact(two, [], { onlyTheseGamesPlays: false })
    expect(impact).toMatchObject({ totalPoints: 9, liveLeagues: 2 })
  })
  it('counts the player ONCE as a live starter, however many leagues he starts in', () => {
    const sameAnn = two.map((g) => ({ ...g, tieIns: g.tieIns.map((t) => ({ ...t, playerId: 'ann' })) }))
    const impact = deriveImpact(sameAnn, [], { onlyTheseGamesPlays: false })
    expect(impact).toMatchObject({ livePlayers: 1, upcomingPlayers: 0, finishedPlayers: 0 })
  })
})

describe('starterStageCounts / starterStageDetail / playAgeLabel', () => {
  const tie = (playerId: string, isStarter = true) => ({
    leagueId: 'L1', leagueName: 'L1', playerId, playerName: playerId, position: 'WR', imageUrl: null, isStarter, points: 1,
  })
  const g = (isLive: boolean, completed: boolean, ids: ReturnType<typeof tie>[]) => ({ isLive, completed, tieIns: ids })

  it('buckets starters by their game, once each, and leaves the bench out', () => {
    const counts = starterStageCounts([
      g(true, false, [tie('a'), tie('b'), tie('bench', false)]),
      g(false, false, [tie('c'), tie('d')]),
      g(false, true, [tie('e')]),
    ])
    expect(counts).toEqual({ live: 2, upcoming: 2, finished: 1 })
  })

  it('a player in a live game is not also "still to play"', () => {
    expect(starterStageCounts([g(true, false, [tie('a')]), g(false, false, [tie('a')])])).toEqual({ live: 1, upcoming: 0, finished: 0 })
  })

  it('describes the rest of the slate', () => {
    expect(starterStageDetail({ livePlayers: 47, liveGames: 3, upcomingPlayers: 17, finishedPlayers: 140 })).toBe(
      'across 3 games · 17 still to play · 140 done',
    )
    expect(starterStageDetail({ livePlayers: 0, liveGames: 0, upcomingPlayers: 4, finishedPlayers: 0 })).toBe('4 still to play')
  })

  it('says how long ago a play happened, and nothing without a clock', () => {
    const now = Date.parse('2026-10-11T18:30:00Z')
    expect(playAgeLabel('2026-10-11T18:29:40Z', now)).toBe('just now')
    expect(playAgeLabel('2026-10-11T18:26:00Z', now)).toBe('4 min ago')
    expect(playAgeLabel('2026-10-11T16:00:00Z', now)).toBe('2 hr ago')
    expect(playAgeLabel('2026-10-11T18:26:00Z', null)).toBeNull()
    expect(playAgeLabel('not a date', now)).toBeNull()
  })
})
