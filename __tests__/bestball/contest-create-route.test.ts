import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const h = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), league: vi.fn(), create: vi.fn(), link: vi.fn(), transaction: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerOnly: h.permission }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: h.league }, $transaction: h.transaction } }))
import { POST } from '@/app/api/bestball/contest/route'
const request = (extra: Record<string,unknown> = {}) => new NextRequest('http://localhost/api/bestball/contest', { method: 'POST', body: JSON.stringify({ leagueId:'league-a', name:'Test contest', ...extra }) })
beforeEach(() => {
  vi.resetAllMocks()
  h.session.mockResolvedValue({ user:{id:'commissioner'} })
  h.permission.mockResolvedValue(undefined)
  h.league.mockResolvedValue({sport:'NBA'})
  h.create.mockResolvedValue({id:'contest-a'})
  h.link.mockResolvedValue({count:1})
  h.transaction.mockImplementation(callback => callback({bestBallContest:{create:h.create},league:{updateMany:h.link}}))
})
describe('best-ball contest creation keeps its league link', () => {
  it('links the created contest and preserves its sport and score reset choice', async () => {
    expect((await POST(request({resetBetweenRounds:true}))).status).toBe(200)
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({sport:'NBA',resetBetweenRounds:true})}))
    expect(h.link).toHaveBeenCalledWith({where:{id:'league-a',bbContestId:null},data:{bbContestId:'contest-a'}})
  })
  it('refuses overwriting a previously linked contest', async () => {
    h.link.mockResolvedValue({count:0})
    expect((await POST(request())).status).toBe(409)
  })
  it('refuses a sport mismatch before creating a contest', async () => {
    expect((await POST(request({sport:'NFL'}))).status).toBe(400)
    expect(h.create).not.toHaveBeenCalled()
  })
  it.each([{podSize:0},{rounds:1.5},{advancersPerPod:0},{podSize:4,advancersPerPod:5}])('refuses invalid contest sizes %s', async settings => {
    expect((await POST(request(settings))).status).toBe(400)
    expect(h.create).not.toHaveBeenCalled()
  })
})
