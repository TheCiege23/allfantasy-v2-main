// @vitest-environment jsdom
/**
 * The shared SEO-lander footer (/chimmy, /tools/*, /sports/*, /tools-hub, /manager-compare)
 * offered "Sign in" to people who were already signed in. It now shows it only to a signed-out
 * reader. "Signed in" is the same test app/page.tsx uses — a real user id — so a session object
 * without one (expired cookie, OAuth before the id is attached) still gets the link.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const useSession = vi.fn()
vi.mock('next-auth/react', () => ({ useSession: () => useSession() }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (k: string) => k }) }))
vi.mock('@/components/i18n/LanguageToggle', () => ({ default: () => null }))

import SeoLandingFooter from '@/components/landing/SeoLandingFooter'

afterEach(() => {
  cleanup()
  useSession.mockReset()
})

const signInLink = () => screen.queryByText('common.signIn')

describe('SeoLandingFooter — Sign in', () => {
  it('is shown to a signed-out reader', () => {
    useSession.mockReturnValue({ data: null, status: 'unauthenticated' })
    render(<SeoLandingFooter />)
    expect(signInLink()).not.toBeNull()
  })

  it('is hidden from a signed-in reader, who still has Dashboard in the footer', () => {
    useSession.mockReturnValue({ data: { user: { id: 'u_1' } }, status: 'authenticated' })
    render(<SeoLandingFooter />)
    expect(signInLink()).toBeNull()
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toBeNull()
  })

  it('stays for a session with no user id — that reader cannot reach the dashboard', () => {
    useSession.mockReturnValue({ data: { user: { email: 'x@example.com' } }, status: 'authenticated' })
    render(<SeoLandingFooter />)
    expect(signInLink()).not.toBeNull()
  })

  it('does not crash outside a SessionProvider (useSession returns undefined)', () => {
    useSession.mockReturnValue(undefined)
    render(<SeoLandingFooter />)
    expect(signInLink()).not.toBeNull()
  })
})
