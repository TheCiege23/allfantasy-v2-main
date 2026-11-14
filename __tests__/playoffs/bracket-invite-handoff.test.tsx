import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const state = vi.hoisted(() => ({ query: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => state.query,
}))
vi.mock('next-auth/react', () => ({ signIn: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }))
vi.mock('@/lib/auth/SocialProviderResolver', () => ({ isSocialProviderEnabled: () => false }))
vi.mock('@/lib/platform/isTrustedWebActivity', () => ({ isTrustedWebActivity: () => false }))

import { AuthV4 } from '@/components/core-app/screens/AuthV4'
import { bracketInviteUrl } from '@/lib/brackets/inviteUrl'

afterEach(() => { cleanup(); vi.restoreAllMocks(); state.query = new URLSearchParams() })

describe('bracket invite handoff', () => {
  it('keeps the league and invite code when switching between sign in and sign up', async () => {
    const callback = '/brackets/leagues/cup123?code=CUP12345'
    state.query = new URLSearchParams({ callbackUrl: callback })
    const { unmount } = render(<AuthV4 mode="signin" />)
    expect(await screen.findByRole('link', { name: 'Sign up' })).toHaveAttribute('href', `/signup?callbackUrl=${encodeURIComponent(callback)}`)
    unmount()
    render(<AuthV4 mode="signup" />)
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', `/login?callbackUrl=${encodeURIComponent(callback)}`)
  })

  it('does not carry an external callback through the auth switch', async () => {
    state.query = new URLSearchParams({ callbackUrl: 'https://example.org' })
    render(<AuthV4 mode="signin" />)
    expect(await screen.findByRole('link', { name: 'Sign up' })).not.toHaveAttribute('href', expect.stringContaining('example.org'))
  })

  it('offers Google Play and website sign-in on Android bracket invitations', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14)')
    state.query = new URLSearchParams({ callbackUrl: '/brackets/leagues/cup123?code=CUP12345' })
    render(<AuthV4 mode="signin" />)
    expect(await screen.findByRole('link', { name: 'Get it on Google Play' })).toHaveAttribute('href', 'https://play.google.com/store/apps/details?id=ai.allfantasy.app')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('keeps iPhone visitors on the website without an Android download prompt', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')
    state.query = new URLSearchParams({ callbackUrl: '/brackets/leagues/cup123?code=CUP12345' })
    render(<AuthV4 mode="signin" />)
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Get it on Google Play' })).not.toBeInTheDocument()
  })

  it('uses the canonical production host and preserves the invite code', () => {
    expect(bracketInviteUrl('https://allfantasy.ai', 'cup123', 'CUP12345')).toBe('https://www.allfantasy.ai/brackets/leagues/cup123?code=CUP12345')
    expect(bracketInviteUrl('https://qa.example.test', 'cup123', 'CUP12345')).toBe('https://qa.example.test/brackets/leagues/cup123?code=CUP12345')
  })
})
