// @vitest-environment jsdom
/**
 * /signup hides the App Store / Google Play badges for a friend who came through a commissioner's
 * Partner Code link (/with/CODE → /signup?code=CODE). The code attaches only at a web signup, so a
 * badge that moved the signup into the app would cost the commissioner the referral.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

let search = new URLSearchParams()
vi.mock('next-auth/react', () => ({ signIn: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => search,
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('@/lib/auth/SocialProviderResolver', () => ({ isSocialProviderEnabled: () => false }))
vi.mock('@/lib/platform/isTrustedWebActivity', () => ({ isTrustedWebActivity: () => false }))

import { AuthV4 } from '@/components/core-app/screens/AuthV4'

afterEach(() => {
  cleanup()
  search = new URLSearchParams()
})

describe('sign-up store badges and Partner Codes', () => {
  it('shows the badges on a plain /signup', async () => {
    render(<AuthV4 mode="signup" />)
    expect(await screen.findByTestId('signup-store-badges')).toBeTruthy()
  })

  it('hides them when the friend arrived with a partner code', async () => {
    search = new URLSearchParams('code=TheCiege')
    render(<AuthV4 mode="signup" />)
    await screen.findByPlaceholderText('Your name') // the form has rendered
    expect(screen.queryByTestId('signup-store-badges')).toBeNull()
  })
})
