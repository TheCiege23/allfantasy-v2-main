import { beforeEach, describe, expect, it, vi } from 'vitest'
import TokensPage from '@/app/tokens/page'

const { getServerSession, redirect } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  redirect: vi.fn((href: string) => { throw new Error(href) }),
}))

vi.mock('next-auth', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/components/core-app/screens/TokenCentreV4', () => ({ TokenCentreV4: () => null }))

describe('token page sign-in', () => {
  beforeEach(() => {
    getServerSession.mockResolvedValue(null)
    redirect.mockClear()
  })

  it('preserves the Starter offer and review context through sign-in', async () => {
    const searchParams = Promise.resolve({
      ruleCode: 'ai_trade_analyzer_full_review',
      offer: 'starter',
      from: 'lock_trade_evaluator',
      example: ['a&b', 'c=d'],
    })
    await expect(TokensPage({ searchParams })).rejects.toThrow('/login')
    const login = new URL(redirect.mock.calls[0]![0], 'https://www.allfantasy.ai')
    const callback = new URL(login.searchParams.get('callbackUrl')!, login.origin)

    expect(callback.pathname).toBe('/tokens')
    expect(callback.searchParams.get('offer')).toBe('starter')
    expect(callback.searchParams.get('ruleCode')).toBe('ai_trade_analyzer_full_review')
    expect(callback.searchParams.get('from')).toBe('lock_trade_evaluator')
    expect(callback.searchParams.getAll('example')).toEqual(['a&b', 'c=d'])
  })

  it('returns a visitor to the general Tokens page when there is no offer', async () => {
    await expect(TokensPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('/login')
    expect(redirect).toHaveBeenCalledWith('/login?callbackUrl=%2Ftokens')
  })

  it('renders the catalog for a signed-in user', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'user-1' } })

    const page = await TokensPage({ searchParams: Promise.resolve({ offer: 'starter' }) })

    expect(redirect).not.toHaveBeenCalled()
    expect(page.props.packs).toContainEqual({
      sku: 'af_tokens_5',
      tokenAmount: 250,
      amountUsd: 4.99,
    })
  })
})
