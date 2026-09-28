import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The server half of /chimmy/chat: who may open it, what it loads for the panel, which URL params
 * it passes on — and that it renders WITHOUT the global app shell while the /chimmy landing keeps it.
 *
 * The page returns one element; its props are the whole contract with the client, so they are read
 * straight off it rather than rendered.
 */

const getServerSession = vi.hoisted(() => vi.fn())
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`)
  }),
)
const getDashboardLeagueListForUser = vi.hoisted(() => vi.fn())
const readChimmyPlanAllowance = vi.hoisted(() => vi.fn())
const recordProactiveOpen = vi.hoisted(() => vi.fn())

vi.mock('next-auth', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/dashboard/get-dashboard-league-list', () => ({ getDashboardLeagueListForUser }))
vi.mock('@/lib/chimmy/planAllowance', () => ({
  readChimmyPlanAllowance,
  planAllowanceMeta: (s: { planName: string; used: number; limit: number; resetsAt: string }, included: boolean) => ({
    included,
    planName: s.planName,
    used: s.used,
    limit: s.limit,
    resetsAt: s.resetsAt,
  }),
}))
vi.mock('@/lib/chimmy-alerts/recordProactiveOpen', () => ({ recordProactiveOpen }))
vi.mock('@/app/chimmy/chat/ChimmyChatPageClient', () => ({ ChimmyChatPageClient: function ChimmyChatPageClient() { return null } }))

// The landing's own reads.
vi.mock('@/components/navigation/ProductShellLayout', () => ({
  default: function ProductShellLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>
  },
}))
vi.mock('@/lib/chimmy-outcomes/learningStore', () => ({ readAdviceLearningSnapshot: vi.fn(async () => null) }))
vi.mock('@/app/chimmy/ChimmyLandingClient', () => ({ default: () => null }))
vi.mock('@/components/engagement/EngagementEventTracker', () => ({ default: () => null }))

import ChimmyChatPage from '@/app/chimmy/chat/page'
import ChimmyLandingPage from '@/app/chimmy/page'
import ProductShellLayout from '@/components/navigation/ProductShellLayout'
import { getTokenSpendRuleMatrixEntry } from '@/lib/tokens/pricing-matrix'

type ClientProps = {
  userId: string
  leagues: Array<Record<string, unknown>>
  tokenCost: number | null
  planAllowance: Record<string, unknown> | null
  prompt: string | null
  leagueId: string | null
  sport: string | null
}

async function openWith(sp: Record<string, string | string[] | undefined>) {
  const el = (await ChimmyChatPage({ searchParams: Promise.resolve(sp) })) as React.ReactElement<ClientProps>
  return el.props
}

beforeEach(() => {
  vi.clearAllMocks()
  getServerSession.mockResolvedValue({ user: { id: 'u1', email: 'me@example.com' } })
  getDashboardLeagueListForUser.mockResolvedValue({
    sleeperUserId: null,
    leagues: [
      { id: 'L2', name: 'Zombie Beta', platform: 'ESPN', isCommissioner: true, teamCount: 10 },
      { id: 'LEG', name: 'AF Legacy 2019', platform: 'sleeper', hasUnifiedRecord: false },
      { id: 'L1', name: 'KBFL', platform: 'sleeper', platformLeagueId: '1180', teamCount: 12 },
    ],
  })
  readChimmyPlanAllowance.mockResolvedValue(null)
  recordProactiveOpen.mockResolvedValue(undefined)
})

describe('/chimmy/chat on the server', () => {
  it('sends a signed-out visitor to sign in and back again, question, league and tag intact', async () => {
    getServerSession.mockResolvedValue(null)
    await expect(
      openWith({ prompt: 'Check my lineup', leagueId: 'L1', from: 'lineup_check_email' }),
    ).rejects.toThrow(
      `REDIRECT /login?callbackUrl=${encodeURIComponent('/chimmy/chat?prompt=Check+my+lineup&leagueId=L1&from=lineup_check_email')}`,
    )
    expect(getDashboardLeagueListForUser).not.toHaveBeenCalled()
    expect(recordProactiveOpen).not.toHaveBeenCalled()
  })

  it('hands the panel your played leagues, the real token price and the URL\'s question and league', async () => {
    const props = await openWith({ prompt: 'Check my lineup', leagueId: 'L1', sport: 'nba' })

    expect(getDashboardLeagueListForUser).toHaveBeenCalledWith('u1')
    expect(props.userId).toBe('u1')
    // Played leagues only (no AF Legacy snapshot), name-sorted, shaped like /core's drawer leagues.
    expect(props.leagues).toEqual([
      { id: 'L1', name: 'KBFL', platform: 'sleeper', platformLeagueId: '1180', isCommissioner: false, teamCount: 12 },
      { id: 'L2', name: 'Zombie Beta', platform: 'espn', platformLeagueId: null, isCommissioner: true, teamCount: 10 },
    ])
    expect(props.tokenCost).toBe(getTokenSpendRuleMatrixEntry('ai_chimmy_chat_message')?.tokenCost ?? null)
    expect(props.tokenCost).toEqual(expect.any(Number))
    expect(props.prompt).toBe('Check my lineup')
    expect(props.leagueId).toBe('L1')
    expect(props.sport).toBe('NBA')
    expect(props.planAllowance).toBeNull()
  })

  it('drops a ?sport= the app does not support', async () => {
    expect((await openWith({ sport: 'cricket' })).sport).toBeNull()
  })

  it('shows an AF Pro account its included answers instead of a price', async () => {
    readChimmyPlanAllowance.mockResolvedValue({ planName: 'AF Pro', limit: 100, used: 63, remaining: 37, resetsAt: '2026-09-26T00:00:00.000Z' })
    const props = await openWith({})
    expect(readChimmyPlanAllowance).toHaveBeenCalledWith({ userId: 'u1', email: 'me@example.com' })
    expect(props.planAllowance).toEqual({ included: true, planName: 'AF Pro', used: 63, limit: 100, resetsAt: '2026-09-26T00:00:00.000Z' })
  })

  it('still opens when the league read fails — on All leagues, with nothing to pick', async () => {
    getDashboardLeagueListForUser.mockRejectedValue(new Error('db down'))
    const props = await openWith({ leagueId: 'L1' })
    expect(props.leagues).toEqual([])
  })

  it('counts an open from a weekly Chimmy message, and only a known tag', async () => {
    await openWith({ from: 'waiver_check', leagueId: 'L1' })
    expect(recordProactiveOpen).toHaveBeenCalledWith({ from: 'waiver_check', leagueId: 'L1' })
    recordProactiveOpen.mockClear()
    await openWith({ from: 'somebody-typed-this' })
    expect(recordProactiveOpen).not.toHaveBeenCalled()
  })
})

describe('the global app shell wraps the /chimmy landing, not the chat', () => {
  it('no layout above /chimmy/chat puts the shell around it', () => {
    for (const dir of ['app/chimmy', 'app/chimmy/chat']) {
      for (const name of ['layout.tsx', 'layout.ts', 'layout.jsx', 'layout.js']) {
        const file = path.join(process.cwd(), dir, name)
        const src = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
        expect(src, `${dir}/${name}`).not.toMatch(/ProductShellLayout|GlobalAppShell/)
      }
    }
  })

  it('the landing page renders inside ProductShellLayout itself', async () => {
    const el = (await ChimmyLandingPage()) as React.ReactElement
    expect(el.type).toBe(ProductShellLayout)
  })
})
