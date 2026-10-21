import { describe, it, expect } from 'vitest'
import { gameStateAlerts, isCloseLateGame, gamePlayAlerts, type GameObservation } from '@/lib/engagement-alerts/gameEvents'
import { allowsLeagueSms } from '@/lib/notifications/channelPolicy'
import type { LiveGameDetail } from '@/lib/live/espnGameSummary'
const game = (patch: Partial<GameObservation> = {}): GameObservation => ({ gameId: '12345', homeTeam: 'Home', awayTeam: 'Away', homeScore: 10, awayScore: 7, status: 'STATUS_IN_PROGRESS', statusDetail: 'Q2', period: 2, clock: '8:00', completed: false, ...patch })
describe('game engagement events', () => {
  it('does not send historical events on bootstrap or invent missing scores', () => {
    expect(gameStateAlerts('NFL', null, game({ completed: true }))).toEqual([])
    expect(gameStateAlerts('NFL', game(), game({ homeScore: null, completed: true }))).toEqual([])
  })
  it('detects halftime and final independently of scores changing', () => {
    expect(gameStateAlerts('NBA', game(), game({ status: 'STATUS_HALFTIME' }))[0]?.type).toBe('game_halftime')
    expect(gameStateAlerts('NHL', game(), game({ completed: true }))[0]?.type).toBe('game_final')
    expect(gameStateAlerts('NBA', game({ completed: true }), game({ completed: true }))).toEqual([])
  })
  it.each([
    ['NFL', 4, '4:00', 7, true], ['NBA', 4, '2:00', 5, true], ['NBA', 4, '6:00', 2, false], ['NBA', 4, '0:38.5', 2, true], ['NCAAB', 2, '38.5', 2, true],
    ['NCAAB', 2, '1:00', 3, true], ['NHL', 3, '1:00', 1, true], ['MLB', 8, '', 1, true],
    ['SOCCER', 2, '85', 1, true], ['NCAAF', 3, '1:00', 3, false],
  ])('applies %s late-game rules', (sport, period, clock, gap, expected) => {
    expect(isCloseLateGame(sport as string, game({ period: period as number, clock: clock as string, homeScore: gap as number, awayScore: 0 }))).toBe(expected)
  })
  it('keeps distinct scoring plays while collapsing duplicate observations of one play', () => {
    const d = { sport: 'WNBA', scoringPlays: [{ id: 'a', text: 'Three pointer' }], drives: [], hockey: null,
      basketball: { plays: [{ id: 'a', text: 'Three pointer', scoring: true }, { id: 'b', text: 'Layup', scoring: true }] } } as unknown as LiveGameDetail
    expect(gamePlayAlerts(d).map(p => p.key)).toEqual(['play:a', 'play:b'])
  })
  it('recovers halftime scores from period lines when polling resumes in the second half', () => {
    const events = gameStateAlerts('NBA', game({ period: 2 }), game({ period: 3, homeScore: 65, awayScore: 60, homeLinescores: [25, 30, 10], awayLinescores: [20, 32, 8] }))
    expect(events[0]).toMatchObject({ type: 'game_halftime', body: 'Away 52 — Home 55' })
  })
  it('detects 20+ yard plays without using cumulative yardage', () => {
    const d = { sport: 'NCAAF', scoringPlays: [], drives: [{ plays: [{ id: 'long', text: '25 yard reception', statYardage: 25, scoring: false }, { id: 'short', text: '5 yard rush', statYardage: 5, scoring: false }] }] } as unknown as LiveGameDetail
    expect(gamePlayAlerts(d).map(p => p.key)).toEqual(['play:long'])
  })
  it('allows SMS only for league operations with league context', () => {
    expect(allowsLeagueSms('draft_alerts', 'league')).toBe(true)
    expect(allowsLeagueSms('draft_alerts')).toBe(false)
    for (const category of ['injury_alerts', 'lineup_alerts', 'performance_alerts', 'ai_alerts', 'matchup_results'] as const) expect(allowsLeagueSms(category, 'league')).toBe(false)
  })
})

 describe('NBA/NHL interval notification policy', () => {
  it.each(['NBA','NHL'])('suppresses all %s per-play alerts including fallback scores', sport => {
    expect(gamePlayAlerts({sport,scoringPlays:[{id:'1',text:'Score'}],drives:[],basketball:{plays:[{id:'2',text:'Steal',type:'steal'}]},hockey:{plays:[{id:'3',text:'Goal',scoring:true}]}} as unknown as LiveGameDetail)).toEqual([])
  })
  it.each(['NBA','NHL'])('summarizes %s interval scores at the boundary and on the next period', sport => {
    const end=game({period:1,clock:'0:00',homeScore:25,awayScore:20,statusDetail:'End of period'})
    expect(gameStateAlerts(sport,game({period:1}),end)).toContainEqual(expect.objectContaining({key:'interval:1',type:'game_period_end',body:'Away 20 — Home 25'}))
    expect(gameStateAlerts(sport,end,game({period:2,homeLinescores:[25,3],awayLinescores:[20,2]}))).toContainEqual(expect.objectContaining({key:'interval:1',body:'Away 20 — Home 25'}))
  })
  it('does not emit a quarter summary during play or duplicate NBA halftime',()=>{
    expect(gameStateAlerts('NBA',game({period:1}),game({period:1}))).toEqual([])
    expect(gameStateAlerts('NBA',game(),game({status:'STATUS_HALFTIME',clock:'0:00'})).map(e=>e.type)).toEqual(['game_halftime'])
  })
 })
