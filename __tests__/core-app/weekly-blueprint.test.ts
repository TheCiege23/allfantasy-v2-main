// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildWeeklyBlueprint, matchupCloseness, weeklyBrief } from '@/lib/core-app/weeklyBlueprint'
import type { MyTeamPulse, MyTeamRow } from '@/lib/core-app/myTeamPulse'
import type { WeekBoard } from '@/lib/core-app/weekBoard'
import type { SeasonOutlook } from '@/lib/core-app/seasonOutlook'
const board = { coinFlips: [], leaning: [], unprojected: [] } as unknown as WeekBoard
const row = (id: string, more: Partial<MyTeamRow> = {}) => ({ leagueId:id, leagueName:id, season:2026, week:4, severity:1, questionable:0, unresolved:0, lockAt:null, ...more }) as MyTeamRow
const build = (rows: MyTeamRow[], focusLeagueId?: string) => buildWeeklyBlueprint({ name:'Alex', leagues:rows.map(r => ({id:r.leagueId,name:r.leagueName,sport:'NBA'})), board, pulse:{needs:rows,set:[]} as unknown as MyTeamPulse, outlook:null, focusLeagueId, now:new Date('2026-10-04T12:00:00Z') })
describe('verified weekly priorities', () => {
  it('pairs featured matchup odds by league identity and season, regardless of model order', () => {
    const cards = [{leagueId:'A',leagueName:'Same name',season:2026,week:5,opponent:{name:'Bulldogs'}},{leagueId:'B',leagueName:'Same name',season:2026,week:4,opponent:{name:'Paid'}}]
    const outlook = {leagues:[{leagueId:'B',leagueName:'Same name',season:2026,you:{modelled:true,playoffPct:99.7}},{leagueId:'A',leagueName:'Same name',season:2026,you:{modelled:true,playoffPct:43}}],swingByLeague:{}} as unknown as SeasonOutlook
    const input = {leagues:[{id:'A'},{id:'B'}],board:{...board,coinFlips:cards} as unknown as WeekBoard,pulse:null,outlook,now:new Date('2026-10-05')}
    expect(buildWeeklyBlueprint(input)).toMatchObject({matchup:{leagueId:'A',opponent:'Bulldogs'},playoff:{leagueId:'A',probability:43}})
    expect(buildWeeklyBlueprint({...input,outlook:{...outlook,leagues:outlook.leagues.filter(l=>l.leagueId==='B')}}).playoff).toBeUndefined()
    expect(buildWeeklyBlueprint({...input,outlook:{...outlook,leagues:[{...outlook.leagues[1],season:2025}]}}).playoff).toBeUndefined()
  })
  it('excludes locked and automatic lineup actions and keeps at most three priorities', () => {
    const out=build([row('locked',{locked:true}),row('auto',{bestBall:true}),row('A'),row('B'),row('C'),row('D')])
    expect(out.actions.map(a=>a.leagueId)).toEqual(['A','B','C'])
    expect(out.actionCount).toBe(4)
  })
  it('scopes all actions to the selected league', () => expect(build([row('A'),row('B')],'B').actions.map(a=>a.leagueId)).toEqual(['B']))
  it('requests refresh for unresolved data instead of claiming a lineup fault', () => {
    const out=build([row('A',{unresolved:1,severity:8,lockAt:'2026-10-05T12:00:00Z'})])
    expect(out.actions[0]).toMatchObject({kind:'sync',gameAt:null,href:'/core/league-sync?league=A'})
  })
  it('orders future game times and never treats kickoff as a proven lineup lock', () => {
    const out=build([row('late',{lockAt:'2026-10-06T12:00:00Z'}),row('soon',{lockAt:'2026-10-05T12:00:00Z'})])
    expect(out.actions[0].leagueId).toBe('soon')
    expect(out.actions[0].gameAt).toBe('2026-10-05T12:00:00.000Z')
  })
  it('copies only known facts in English and Spanish', () => {
    const out=build([row('A')]); out.matchup={opponent:'Sam',period:4,leagueName:'A'}; out.playoff={probability:3.5,leagueName:'A'}
    expect(weeklyBrief(out)).toContain('facing Sam')
    expect(weeklyBrief(out)).toContain('Estimated playoff probability in A: 3.5%')
    expect(weeklyBrief(out,true)).toContain('Probabilidad estimada')
    expect(weeklyBrief(build([row('A')]))).not.toContain('playoff probability')
  })
})
describe('cross-sport closeness', () => {
  it('is invariant to scoring units even below one point', () => {
    const small=matchupCloseness({live:{you:.02,them:.03,margin:-.01}})
    expect(small).toBeCloseTo(matchupCloseness({live:{you:20,them:30,margin:-10}}))
    expect(matchupCloseness({live:{you:0,them:0,margin:0}})).toBe(0)
  })
  it('puts a close deficit ahead of a blowout deficit', () => expect(matchupCloseness({live:{you:90,them:100,margin:-10}})).toBeLessThan(matchupCloseness({live:{you:10,them:100,margin:-90}})))
})
