import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ session: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), view: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('next/navigation', () => ({ redirect: (href: string) => { throw new Error(`REDIRECT ${href}`) } }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { playoffBracketEntry: { findUnique: mocks.findUnique }, playoffBracketPick: { findMany: mocks.findMany } } }))
vi.mock('@/lib/playoffs/playoffService', () => ({ getPlayoffBracketView: mocks.view }))
vi.mock('@/components/brackets/playoffs/PlayoffBracketShell', () => ({ default: () => null }))
vi.mock('@/components/brackets/playoffs/PlayoffBracketBoard', () => ({ default: () => null }))
vi.mock('@/components/brackets/BracketQuickNav', () => ({ default: () => null }))

import LeaguePage from '@/app/brackets/leagues/[leagueId]/page'
import SharedPage from '@/app/brackets/leagues/[leagueId]/entries/[entryId]/view/page'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue(null)
  mocks.findUnique.mockResolvedValue({ id: 'entry', challengeId: 'cup123', name: 'Example', challenge: { id: 'cup123', sport: 'nba_cup', ownerUserId: 'owner', config: { visibility: 'public' } } })
})

describe('bracket invitation routes', () => {
  it('sends an unsigned invite visitor to sign in and retains the destination', async () => {
    const callback = '/brackets/leagues/cup123?code=CUP12345'
    await expect(LeaguePage({ params: Promise.resolve({ leagueId: 'cup123' }), searchParams: Promise.resolve({ code: 'CUP12345' }) } as any)).rejects.toThrow(`REDIRECT /login?callbackUrl=${encodeURIComponent(callback)}`)
    expect(mocks.view).not.toHaveBeenCalled()
  })

  it('opens the league directly for an already signed-in invite visitor', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'participant' } })
    mocks.view.mockResolvedValue({ challenge: { id: 'cup123' } })
    const page = await LeaguePage({ params: Promise.resolve({ leagueId: 'cup123' }), searchParams: Promise.resolve({ code: 'CUP12345' }) } as any)
    expect(page).toBeTruthy()
    expect(mocks.view).toHaveBeenCalledWith(expect.objectContaining({ challengeId: 'cup123', user: { id: 'participant' } }))
  })

  it('sends an old shared-entry link to sign-in or the league without loading picks', async () => {
    const props = { params: Promise.resolve({ leagueId: 'cup123', entryId: 'entry' }) }
    await expect(SharedPage(props)).rejects.toThrow(`REDIRECT /login?callbackUrl=${encodeURIComponent('/brackets/leagues/cup123')}`)
    mocks.session.mockResolvedValue({ user: { id: 'participant' } })
    await expect(SharedPage(props)).rejects.toThrow('REDIRECT /brackets/leagues/cup123')
    expect(mocks.findMany).not.toHaveBeenCalled()
  })
})
