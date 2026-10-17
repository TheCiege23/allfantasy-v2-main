import { describe, it, expect } from 'vitest'
import { liveWorkspace, playBelongsToGame } from '@/lib/live/liveWorkspace'
import { canonicalPlayGames } from '@/lib/live/canonicalPlayGames'
import { leagueCalendar } from '@/lib/core-app/leagueCalendar'
import { automaticLineup } from '@/lib/core-app/teamWorkspace'
import type { LiveGameCard } from '@/lib/live/liveScoresPage'
import type { PlayFeedItem } from '@/lib/live/playFeedPresentation'

const game = { gameId:'espn-1', sport:'NFL', espnDetail:true, startTime:'2026-10-04T17:00:00Z', isLive:true, completed:false, home:{abbrev:'KC'}, away:{abbrev:'BUF'}, tieIns:[{leagueId:'a', leagueName:'Alpha',playerId:'p',playerName:'Player',points:10},{leagueId:'b',leagueName:'Beta',playerId:'p',playerName:'Player',points:20}] } as LiveGameCard
const play = { gameId:'ri-9',id:'td-1',sleeperId:'p',playerName:'Player',team:'KC',type:'TOUCHDOWN',detectedAt:'2026-10-04T17:20:00Z' } as PlayFeedItem

describe('live workspace scope and identities', () => {
  it('cannot compare vendor raw IDs or infer a game only from the player', () => {
    expect(playBelongsToGame(play, game)).toBe(false)
    expect(playBelongsToGame({...play, gameId:game.gameId}, game)).toBe(false)
  })
  it('maps a unique club/date fixture across vendors and scopes every league contribution', () => {
    const plays = canonicalPlayGames([play],[game],[{externalId:'ri-9',homeTeam:'KC',awayTeam:'BUF',startTime:game.startTime}])
    const a=liveWorkspace([game],plays,'a')
    expect(a.impact.totalPoints).toBe(10)
    expect(a.impact.biggestMover?.leagues).toEqual(['Alpha'])
    expect(a.leagues.map(l=>l.id)).toEqual(['a'])
    expect(liveWorkspace([game],plays,null).impact.totalPoints).toBe(30)
  })
  it('does not attach a highlight from a previous meeting or an ambiguous fixture', () => {
    expect(canonicalPlayGames([play],[game],[{externalId:'ri-9',homeTeam:'KC',awayTeam:'BUF',startTime:'2026-09-01T17:00:00Z'}])[0].canonicalGameId).toBeNull()
    expect(canonicalPlayGames([play],[game,{...game,gameId:'other'}],[{externalId:'ri-9',homeTeam:'KC',awayTeam:'BUF',startTime:game.startTime}])[0].canonicalGameId).toBeNull()
  })
  it('separates completed points, missing live scores, and remaining player counts', () => {
    const result=liveWorkspace([game,{...game,gameId:'final',isLive:false,completed:true},{...game,gameId:'next',isLive:false,completed:false},{...game,gameId:'missing',tieIns:[{...game.tieIns[0],points:null}]}],[],'a')
    expect(result.leagues[0]).toMatchObject({live:10,completed:10,remaining:1,missing:1})
  })
})
describe('league rules rather than guessed defaults', () => {
  it('recognizes automatic scoring independently of dynasty and treats zero as false', () => {
    expect(automaticLineup('dynasty',{best_ball:1})).toBe(true)
    expect(automaticLineup('redraft',{best_ball:'0'})).toBe(false)
    expect(automaticLineup('Best Ball')).toBe(true)
  })
  it('keeps week deadlines separate from exact dates and invents no missing event', () => {
    expect(leagueCalendar({})).toEqual([])
    expect(leagueCalendar({trade_deadline:9})[0]).toMatchObject({at:null,when:'Week 9'})
    expect(leagueCalendar({draft_start:1791133200})[0].at).toBe('2026-10-04T17:00:00.000Z')
  })
})
