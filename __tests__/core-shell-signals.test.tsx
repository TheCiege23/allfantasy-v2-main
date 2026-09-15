import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/**
 * Shell signals — the chrome a /core screen publishes up to a shell that has already painted.
 *
 * WHY THIS SUITE RENDERS THE REAL SHELL. The shell now renders before the screen's loaders
 * finish, so four pieces of chrome (tab badges, the week label, Chimmy's home signals, the Live
 * count) reach it by publication instead of props. A unit test of the merge function alone
 * would stay green if AfCoreShell stopped reading the merged props, or if the provider were
 * mounted somewhere the screen cannot reach. So the badge and the week label are asserted where
 * a user sees them, in the rendered nav and topbar — and asserted GONE when the screen that
 * published them unmounts, which is the half a merge test cannot see.
 */

const nav = vi.hoisted(() => ({
  // One router object for the file — see core-admin-nav.test.tsx for the render loop a
  // fresh object per useRouter() call causes.
  router: { push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {} },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/core-app/comms/CommsDock', () => ({ default: () => null }))
vi.mock('@/components/core-app/SyncNowButton', () => ({ default: () => null }))
vi.mock('@/components/core-app/GeoRestrictionNotice', () => ({ GeoRestrictionNotice: () => null }))
vi.mock('@/components/core-app/AfCrest', () => ({ AfCrest: () => null }))
vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { PublishShellSignals, withPublishedSignals } from '@/components/core-app/shellSignals'

function shell(children: React.ReactNode, props: Record<string, unknown> = {}) {
  return (
    <AfCoreShell active="home" leagues={[]} syncAge={{ label: 'just now', stale: false }} syncEligibleCount={0} {...props}>
      {children}
    </AfCoreShell>
  )
}

function tradesNavText(): string {
  const link = screen.getAllByRole('link').find((a) => /trades/i.test(a.textContent ?? ''))
  return link?.textContent ?? ''
}

describe('withPublishedSignals — the merge rule', () => {
  const base = {
    weekLabel: null as string | null,
    urgencyBadges: undefined as { trades?: number | null } | null | undefined,
    liveGameCount: 2 as number | null,
    comms: { leagues: [], homeSignals: undefined as string | null | undefined },
  }

  it('leaves the shell alone when nothing has been published', () => {
    expect(withPublishedSignals(base, null)).toBe(base)
  })

  it('treats undefined as "this screen says nothing" and null as a real value', () => {
    const merged = withPublishedSignals(base, { weekLabel: 'Week 5', urgencyBadges: null })
    expect(merged.weekLabel).toBe('Week 5')
    expect(merged.urgencyBadges).toBeNull()
    // Not published: the shell's own activity-snapshot count stands.
    expect(merged.liveGameCount).toBe(2)
  })

  it('lays homeSignals into comms, and never invents a comms block', () => {
    expect(withPublishedSignals(base, { homeSignals: 'h1' }).comms?.homeSignals).toBe('h1')
    expect(withPublishedSignals({ ...base, comms: null }, { homeSignals: 'h1' }).comms).toBeNull()
  })
})

describe('PublishShellSignals through the real AfCoreShell', () => {
  it('shows what the screen published, and removes it when that screen unmounts', async () => {
    const view = render(shell(<div>home screen</div>))
    expect(screen.queryByText('Week 5')).toBeNull()
    const before = tradesNavText()
    expect(before).not.toContain('3')

    await act(async () => {
      view.rerender(
        shell(
          <>
            <PublishShellSignals weekLabel="Week 5" urgencyBadges={{ trades: 3 }} />
            <div>home screen</div>
          </>,
        ),
      )
    })
    expect(screen.getByText('Week 5')).toBeTruthy()
    expect(tradesNavText()).toContain('3')

    // Navigating to a screen that publishes nothing must not carry the home's chrome with it.
    await act(async () => {
      view.rerender(shell(<div>trades screen</div>))
    })
    expect(screen.queryByText('Week 5')).toBeNull()
    expect(tradesNavText()).not.toContain('3')
  })

  it('lets the Live screen replace the shell’s own count, and restores it after', async () => {
    const liveBadge = () => screen.getAllByRole('link').find((a) => /live/i.test(a.textContent ?? ''))?.textContent ?? ''
    const view = render(shell(<div />, { liveGameCount: 2 }))
    expect(liveBadge()).toContain('2')

    await act(async () => {
      view.rerender(shell(<PublishShellSignals liveGameCount={7} />, { liveGameCount: 2 }))
    })
    expect(liveBadge()).toContain('7')

    await act(async () => {
      view.rerender(shell(<div />, { liveGameCount: 2 }))
    })
    expect(liveBadge()).toContain('2')
  })
})
