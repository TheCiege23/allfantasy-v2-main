import type { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { validateCurrentPoolOwnership } from '@/lib/league/player-pools/changeLayout'
import { checkPoolTransfers } from '@/lib/league/player-pools/ownership'
import { startingPoolLayout } from '@/lib/league/player-pools/policy'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const teamIds = ['A','B','C','D','E','F']
const settings = startingPoolLayout('division',3,2,teamIds)
const holdings = [{rosterId:'season-A',playerId:'qb'},{rosterId:'season-B',playerId:'qb'}]
function fixture(players = holdings, auctionState: unknown = null) {
  const boards = auctionState ? [{ auctionState, picks: [], slotOrder: [{rosterId:'r-A'}] }] : []
  return {
    league: { findUnique: async () => ({settings}) },
    leagueTeam: { findMany: async () => teamIds.map(id=>({id,externalId:'r-'+id})) },
    roster: { findMany: async () => teamIds.map(id=>({id:'r-'+id,platformUserId:'owner-'+id,redraftRosterId:'season-'+id})) },
    redraftRoster: { findMany: async () => teamIds.map(id=>({id:'season-'+id,ownerId:'owner-'+id})) },
    redraftSeason: { findFirst: async () => ({id:'season'}) },
    redraftRosterPlayer: { findMany: async () => players },
    draftSession: { findMany: async () => boards, updateMany: vi.fn() },
    $queryRaw: vi.fn(),
  } as unknown as Prisma.TransactionClient
}
const move = (from:string,to:string) => ({assetType:'player',playerId:'qb',fromRosterId:'season-'+from,toRosterId:'season-'+to})

describe('player-pool settlement and realignment',()=>{
  it('moves a copy within a division and into an empty division',async()=>{
    expect(await checkPoolTransfers('league',[move('A','D')],'season',fixture())).toBeNull()
    expect(await checkPoolTransfers('league',[move('A','C')],'season',fixture())).toBeNull()
  })
  it('refuses a destination that has a second copy, including a waiver acquisition',async()=>{
    expect(await checkPoolTransfers('league',[move('A','E')],'season',fixture())).toMatch(/already owned/)
    expect(await checkPoolTransfers('league',[{playerId:'qb',toRosterId:'season-E'}],'season',fixture())).toMatch(/already owned/)
  })
  it('evaluates both sides of a simultaneous exchange by franchise',async()=>{
    expect(await checkPoolTransfers('league',[move('A','E'),move('B','D')],'season',fixture())).toBeNull()
  })
  it('refuses to merge pools with duplicate holdings and keeps compatible layouts',async()=>{
    await expect(validateCurrentPoolOwnership(fixture(),'league',{player_pool_scope:'league'})).rejects.toThrow(/two owned copies/)
    await expect(validateCurrentPoolOwnership(fixture(),'league',settings)).resolves.toBeUndefined()
  })
  it('preserves a live bid when the commissioner moves a division',async()=>{
    const auction={nominationOrderIndex:0,currentBidderRosterId:'r-B',currentNomination:{playerName:'QA',playerId:'new'}}
    await expect(validateCurrentPoolOwnership(fixture([],auction),'league',settings)).rejects.toThrow(/winning bidder/)
  })
})

