import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import { ValuesPageLink } from '@/components/values/ValuesPageLink'

/**
 * The four eligibility rules for the values link, one test each.
 *
 * 🛑 THE FOURTH IS THE ONE THAT MATTERS. A league starting neither defenders nor kickers must
 * render NO ELEMENT — not a disabled link, not an empty card. A permanent link on every screen
 * is noise that trains people to ignore the surface, and the page genuinely has nothing to say
 * to that manager.
 */

vi.mock('next/link', () => ({
  default: ({ children, href, className, ...rest }: Record<string, unknown> & { children: React.ReactNode }) => (
    <a href={href as string} className={className as string} {...rest}>
      {children}
    </a>
  ),
}))

const mount = (payload: unknown, props: Record<string, unknown> = {}, ok = true) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => payload })),
  )
  return render(<ValuesPageLink {...props} />)
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('ValuesPageLink eligibility rules', () => {
  it('offers BOTH when the league has IDP and kickers', async () => {
    mount({ hasIdp: true, hasKicker: true, eligible: true }, { leagueId: 'L1' })
    await waitFor(() => expect(screen.getByTestId('values-page-link')).toBeInTheDocument())
    /* The phrase appears in both the heading and the body line, so assert the heading. */
    expect(screen.getByText(/^how we value defenders and kickers$/i)).toBeInTheDocument()
  })

  it('offers DEFENDERS ONLY when the league has IDP but no kicker', async () => {
    mount({ hasIdp: true, hasKicker: false, eligible: true }, { leagueId: 'L1' })
    await waitFor(() => expect(screen.getByTestId('values-page-link')).toBeInTheDocument())
    expect(screen.getByText(/^how we value defenders$/i)).toBeInTheDocument()
    expect(screen.getByTestId('values-page-link').textContent).not.toMatch(/kicker/i)
  })

  it('offers KICKERS ONLY when the league has a kicker but no IDP', async () => {
    mount({ hasIdp: false, hasKicker: true, eligible: true }, { leagueId: 'L1' })
    await waitFor(() => expect(screen.getByTestId('values-page-link')).toBeInTheDocument())
    expect(screen.getByText(/^how we value kickers$/i)).toBeInTheDocument()
    expect(screen.getByTestId('values-page-link').textContent).not.toMatch(/defender/i)
  })

  it('renders NOTHING when the league has neither', async () => {
    const { container } = mount({ hasIdp: false, hasKicker: false, eligible: false }, { leagueId: 'L1' })
    await waitFor(() => expect(container.firstChild).toBeNull())
    expect(screen.queryByTestId('values-page-link')).not.toBeInTheDocument()
  })
})

describe('ValuesPageLink scope and resilience', () => {
  /**
   * ⚠ /core IS NOT A LEAGUE. Omitting leagueId must ask the USER-scoped question, or a manager
   * whose only IDP league is not the selected one would never see the link.
   */
  it('asks the user-scoped question when no leagueId is given', async () => {
    mount({ hasIdp: true, hasKicker: false, eligible: true })
    await waitFor(() => expect(screen.getByTestId('values-page-link')).toBeInTheDocument())
    const url = String((globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])
    expect(url).toContain('view=value-eligibility')
    expect(url).not.toContain('leagueId=')
  })

  it('asks the league-scoped question when a leagueId is given', async () => {
    mount({ hasIdp: true, hasKicker: true, eligible: true }, { leagueId: 'L9' })
    await waitFor(() => expect(screen.getByTestId('values-page-link')).toBeInTheDocument())
    const url = String((globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])
    expect(url).toContain('leagueId=L9')
    expect(url).toContain('view=value-eligibility')
  })

  /** It must ride the existing endpoint — the repo is at Vercel's route ceiling. */
  it('reads the existing idp/players route rather than a new one', async () => {
    mount({ hasIdp: true, hasKicker: true, eligible: true })
    await waitFor(() => expect(screen.getByTestId('values-page-link')).toBeInTheDocument())
    const url = String((globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])
    expect(url).toContain('/api/idp/players')
  })

  it('points at the values page', async () => {
    mount({ hasIdp: false, hasKicker: true, eligible: true }, { leagueId: 'L1' })
    await waitFor(() => expect(screen.getByTestId('values-page-link')).toBeInTheDocument())
    expect(screen.getByTestId('values-page-link')).toHaveAttribute('href', '/player-values')
  })

  it('renders nothing rather than breaking the page when the lookup fails', async () => {
    const { container } = mount({ error: 'boom' }, { leagueId: 'L1' }, false)
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('renders nothing while loading', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { container } = render(<ValuesPageLink leagueId="L1" />)
    expect(container.firstChild).toBeNull()
  })

  /** The compact variant follows the SAME rules — only the markup differs. */
  it('honours the rules in compact mode too', async () => {
    const { container, rerender } = mount(
      { hasIdp: false, hasKicker: false, eligible: false },
      { compact: true, className: 'af3a-tool' },
    )
    await waitFor(() => expect(container.firstChild).toBeNull())

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ hasIdp: true, hasKicker: true, eligible: true }) })),
    )
    rerender(<ValuesPageLink compact className="af3a-tool" leagueId="L2" />)
    await waitFor(() => expect(screen.getByTestId('values-page-link')).toBeInTheDocument())
    expect(screen.getByTestId('values-page-link')).toHaveClass('af3a-tool')
  })
})
