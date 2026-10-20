import { describe, expect, it } from 'vitest'
import { postseasonAlerts } from '@/lib/engagement-alerts/postseasonEvents'
import type { GameObservation } from '@/lib/engagement-alerts/gameEvents'
const now = Date.parse('2026-10-20T03:20:00Z')
const game: GameObservation = { gameId: 'g', homeTeam: 'TB', awayTeam: 'CLE', homeTeamId: '30', awayTeamId: '5', homeScore: 7, awayScore: 3, completed: true, status: 'STATUS_FINAL', statusDetail: 'Final', period: 9, clock: '', startTime: '2026-10-19T23:00:00Z', season: 2026, eventName: 'ALCS - Game 6', playoffSeries: { completed: true, winnerTeamId: '30' } }
describe('provider result milestones', () => {
  it('detects the observed ALCS clinch without news headlines', () => {
    expect(postseasonAlerts('MLB', game, now)[0]).toMatchObject({ type: 'postseason_clinch', title: 'MLB: TB clinches ALCS' })
  })
  it.each(['NBA','WNBA','NHL','NCAABASE','SOCCER'])('uses explicit completed series for %s', sport => {
    expect(postseasonAlerts(sport, {...game,eventName:'Conference Finals - Game 6'},now)).toHaveLength(1)
  })
  it.each(['NFL','NCAAF','NCAAB'])('accepts completed single elimination games for %s', sport => {
    expect(postseasonAlerts(sport,{...game,playoffSeries:undefined,eventName:'National Championship'},now)).toHaveLength(1)
  })
  it('never treats an ordinary series game, unknown winner, or stale result as a clinch', () => {
    expect(postseasonAlerts('MLB',{...game,playoffSeries:{completed:false,winnerTeamId:null}},now)).toEqual([])
    expect(postseasonAlerts('MLB',{...game,playoffSeries:{completed:true,winnerTeamId:'unknown'}},now)).toEqual([])
    expect(postseasonAlerts('MLB',{...game,startTime:'2026-10-16T23:00:00Z'},now)).toEqual([])
    expect(postseasonAlerts('MLB',{...game,completed:false},now)).toEqual([])
  })
})
