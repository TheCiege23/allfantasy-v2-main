import { describe, expect, it } from 'vitest'
import { poolOf, poolSetupError, picksInPool, readPlayerPoolScope, startingPoolLayout, teamPoolResolver } from '@/lib/league/player-pools/policy'

describe('franchise player pools', () => {
  const teams = Array.from({length:250},(_,i)=>'team-'+i)
  it('keeps old leagues in a single pool', () => {
    expect(readPlayerPoolScope({})).toBe('league')
    expect(poolOf(null,teams[0])).toBe(poolOf(null,teams[1]))
  })
  it.each(['division','conference'] as const)('keeps only picks made in the receiving %s', scope => {
    const layout=startingPoolLayout(scope,25,10,teams)
    const group=teamPoolResolver(layout)
    const pools=Object.fromEntries(teams.map(id=>[id,group(id)]))
    const picked=teams.map(rosterId=>({rosterId,playerId:'same-athlete'}))
    const own=picksInPool(picked,pools,teams[0])
    expect(own.length).toBe(scope==='division'?10:30)
    expect(own.every(p=>pools[p.rosterId]===pools[teams[0]])).toBe(true)
    expect(()=>poolOf(pools,'missing')).toThrow()
    expect(()=>group('unassigned')).toThrow()
  })
  it('rejects an incomplete conference map',()=>{
    expect(poolSetupError('conference',3,[0,1],12)).toMatch(/division/)
    expect(poolSetupError('conference',3,[0,0,0],12)).toMatch(/division/)
    expect(poolSetupError('division',30,[],12)).toMatch(/teams/)
  })
})
