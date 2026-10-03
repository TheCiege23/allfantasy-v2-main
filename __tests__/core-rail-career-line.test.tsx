import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Career stats in the rail (`lib/core-app/railCareerChannel.ts`): the Career screen publishes
 * "23-11 · 2 titles" per league and the shell shows it under that league's name — only while
 * published, and matched on the league's own name.
 */

// One router object for the life of the suite — see core-rail-active-league.test.tsx.
const nav = vi.hoisted(() => ({
  router: { push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {} },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/core/career',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/core-app/comms/CommsDock', () => ({ default: () => null }))
vi.mock('@/components/core-app/SyncNowButton', () => ({ default: () => null }))
vi.mock('@/components/core-app/GeoRestrictionNotice', () => ({ GeoRestrictionNotice: () => null }))
vi.mock('@/components/core-app/AfCrest', () => ({ AfCrest: () => null }))
vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { publishRailCareerLines } from '@/lib/core-app/railCareerChannel'

const LEAGUES = [
  { id: 'l1', name: 'Dynasty Dragons', platform: 'sleeper', mark: 'DD' },
  { id: 'l2', name: 'Office Redraft', platform: 'espn', mark: 'OR' },
]

const shell = () => (
  <AfCoreShell
    active="career"
    leagues={LEAGUES as never}
    syncAge={{ label: 'just now', stale: false }}
    syncEligibleCount={0}
  >
    <div>screen</div>
  </AfCoreShell>
)

afterEach(() => publishRailCareerLines(null))

describe('rail career line', () => {
  it('shows nothing until the Career screen publishes', () => {
    render(shell())
    expect(screen.queryByText(/23-11/)).toBeNull()
  })

  it('shows lines published BEFORE the shell mounted (a child’s effects run first)', () => {
    publishRailCareerLines({ 'dynasty dragons': '23-11 · 2 titles' })
    render(shell())
    expect(screen.getByText('23-11 · 2 titles')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Dynasty Dragons on sleeper, your career here 23-11 · 2 titles/ })).toBeTruthy()
  })

  it('follows updates, matches only by the league’s name, and clears when Career leaves', () => {
    render(shell())
    act(() => publishRailCareerLines({ 'office redraft': '9-5', 'some other league': '1-0' }))
    expect(screen.getByText('9-5')).toBeTruthy()
    expect(screen.queryByText('1-0')).toBeNull()
    act(() => publishRailCareerLines(null))
    expect(screen.queryByText('9-5')).toBeNull()
  })
})
