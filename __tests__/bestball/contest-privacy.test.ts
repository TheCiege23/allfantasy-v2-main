import {beforeEach,describe,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const m=vi.hoisted(()=>({links:vi.fn(),session:vi.fn(),access:vi.fn(),contest:vi.fn(),list:vi.fn()}))
vi.mock('next-auth',()=>({getServerSession:m.session}))
vi.mock('@/lib/auth',()=>({authOptions:{}}))
vi.mock('@/lib/league/permissions',()=>({requireCommissionerOnly:vi.fn()}))
vi.mock('@/lib/live-draft-engine/auth',()=>({canAccessLeagueDraft:m.access}))
vi.mock('@/lib/prisma',()=>({prisma:{league:{findMany:m.links},bestBallContest:{findFirst:m.contest,findMany:m.list}}}))
import {GET} from '@/app/api/bestball/contest/route'
beforeEach(()=>{vi.clearAllMocks();m.links.mockResolvedValue([{id:'L'}]);m.session.mockResolvedValue({user:{id:'u'}});m.access.mockResolvedValue(true);m.contest.mockResolvedValue({id:'c',entries:[]});m.list.mockResolvedValue([])})
describe('Linked contest privacy',()=>{
 it('does not disclose a linked league contest anonymously',async()=>{
  m.session.mockResolvedValue(null)
  expect((await GET(new NextRequest('http://localhost/api/bestball/contest?contestId=c'))).status).toBe(401)
  expect(m.contest).not.toHaveBeenCalled()
 })
 it('refuses outsiders before loading drafted rosters',async()=>{
  m.access.mockResolvedValue(false)
  expect((await GET(new NextRequest('http://localhost/api/bestball/contest?contestId=c'))).status).toBe(403)
  expect(m.contest).not.toHaveBeenCalled()
 })
 it('allows a member of the linked league',async()=>{
  expect((await GET(new NextRequest('http://localhost/api/bestball/contest?contestId=c'))).status).toBe(200)
  expect(m.access).toHaveBeenCalledWith('L','u')
 })
 it('preserves standalone public contest details',async()=>{
  m.links.mockResolvedValue([])
  expect((await GET(new NextRequest('http://localhost/api/bestball/contest?contestId=c'))).status).toBe(200)
  expect(m.session).not.toHaveBeenCalled()
 })
 it('keeps league contest metadata out of the public discovery list',async()=>{
  await GET(new NextRequest('http://localhost/api/bestball/contest?sport=NFL'))
  expect(m.list.mock.calls[0][0].where).toEqual({sport:'NFL',leagues:{none:{}}})
 })
})
