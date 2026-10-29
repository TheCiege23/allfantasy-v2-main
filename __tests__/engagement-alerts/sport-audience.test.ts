import { expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(async()=>[{uid:'member'}]), userProfile:{findMany:vi.fn(async()=>[{userId:'interest'}])}, teamFollow:{findMany:vi.fn(async()=>[{userId:'follower'},{userId:'member'}])} }))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/prisma',()=>({prisma:db}))
import { listSportsAlertAudience } from '@/lib/notifications/sportAudience'
it('unites league membership, selected interests, and follows without duplicate recipients', async()=>{
  expect(await listSportsAlertAudience('MLB')).toEqual(['member','interest','follower'])
  expect(db.userProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{preferredSports:{array_contains:['MLB']}}}))
  expect(db.teamFollow.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{sport:'MLB'}}))
})
