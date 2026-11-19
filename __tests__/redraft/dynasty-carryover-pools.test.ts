import { describe, expect, it, vi } from 'vitest'
import { startingPoolLayout } from '@/lib/league/player-pools/policy'
import { carryDynastyRostersForward } from '@/lib/redraft/offseason/carryDynastyRosters'

const prisma = vi.hoisted(() => ({league:{findUnique:vi.fn()},$transaction:vi.fn()}))
vi.mock('@/lib/prisma', () => ({prisma}))

describe('dynasty renewal with separate player pools', () => {
  it('carries both franchises’ copies, then preserves a cross-pool trade and an offseason drop on replay', async () => {
    const teams = ['a','b','c','d','e','f']
    const settings = startingPoolLayout('division',3,2,teams)
    const incoming: Array<{id:string,rosterId:string,playerId:string,droppedAt?:Date}> = []
    const athlete = {playerId:'qb',playerName:'Quarterback',position:'QB',sport:'NFL',team:'BUF',slotType:'QB',acquisitionType:'drafted'}
    const findLeague = async () => ({settings})
    const tx = {
      $queryRaw:vi.fn(),league:{findUnique:findLeague},
      leagueTeam:{findMany:async()=>teams.map(id=>({id,externalId:'roster-'+id}))},
      roster:{findMany:async()=>teams.map(id=>({id:'roster-'+id,platformUserId:id,redraftRosterId:'new-'+id}))},
      redraftRoster:{findMany:async({where}:{where:{seasonId:string}})=>teams.map((id,i)=>({
        id:where.seasonId+'-'+id,ownerId:id,players:where.seasonId==='old' ? (i<2?[athlete]:[]) : incoming.filter(p=>p.rosterId==='new-'+id),
      }))},
      redraftRosterPlayer:{createMany:async({data}:{data:typeof incoming})=>incoming.push(...data)},
    }
    prisma.league.findUnique.mockImplementation(findLeague)
    prisma.$transaction.mockImplementation(run=>run(tx))
    expect((await carryDynastyRostersForward('L','old','new')).playersCopied).toBe(2)
    expect(new Set(incoming.map(p=>p.id)).size).toBe(2)
    expect(incoming.map(p=>p.rosterId).sort()).toEqual(['new-a','new-b'])
    incoming.find(p=>p.rosterId==='new-b')!.droppedAt=new Date()
    incoming.find(p=>p.rosterId==='new-a')!.rosterId='new-b'
    expect(await carryDynastyRostersForward('L','old','new')).toMatchObject({playersCopied:0,playersAlreadyPresent:2})
    expect(incoming.filter(p=>!p.droppedAt).map(p=>p.rosterId)).toEqual(['new-b'])
  })
})

