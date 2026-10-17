// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { mathStatus, simulateSeason, readMilestones } from '@/lib/core-app/outlookSim'
import { leagueSimHash } from '@/lib/core-app/seasonOutlookSims'
import { describeTeamOutlook } from '@/lib/core-app/outlookCopy'
const profile={mu:100,sigma:10,n:4}
describe('final tied games in playoff modeling',()=>{
  it('requires a status proof for clinched or eliminated wording',()=>{
    expect(describeTeamOutlook({modelled:true,playoffPct:99.9},4,4)).toBe('Very likely in — not mathematically clinched')
    expect(describeTeamOutlook({modelled:true,playoffPct:.4},4,4)).toBe('Long shot — probability is not elimination')
    expect(describeTeamOutlook({modelled:true,playoffPct:99.9,status:'clinched'},4,4)).toBe('Clinched — playing for seeding')
  })
  const sim={teams:[{rosterId:'a',wins:2,losses:0,ties:2,pointsFor:50,profile},{rosterId:'b',wins:2,losses:1,ties:1,pointsFor:500,profile}],remaining:[],playoffTeams:1,byeTeams:0}
  it('counts final ties in modeled standings before points-for tiebreaks',()=>{
    const out=simulateSeason(sim,{iterations:50,seed:3})
    expect(out.counts.a.playoff).toBe(50)
    expect(out.counts.b.playoff).toBe(0)
    expect(mathStatus(sim,'a')).toBe('clinched')
    expect(mathStatus(sim,'b')).toBe('eliminated')
    expect(readMilestones(out,sim,'a')?.totalGames).toBe(4)
  })
  it('invalidates a stored simulation when a tie count changes',()=>{
    expect(leagueSimHash(sim,1)).not.toBe(leagueSimHash({...sim,teams:sim.teams.map(t=>({...t,ties:0}))},1))
  })
})
