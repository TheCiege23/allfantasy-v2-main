/**
 * Dynasty My team on a phone (2026-11-24, the simplify pass): the age chip leads the game line instead of
 * sitting beside the name, and the dynasty age key folds into the closed "What the abbreviations mean"
 * row. Uses the harness fixture, so the screenshots and these assertions describe the same screen.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))

import { MyTeam } from '@/components/core-app/screens/MyTeam'
import { dynastyMyTeamFixture } from '@/app/e2e/dynasty-core/myteam/fixture'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 503 }))))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Dynasty My team — compact rows', () => {
  it('puts the age chip on the game line, never beside the name', () => {
    const { container } = render(<MyTeam data={dynastyMyTeamFixture({ markers: true })} />)
    const chips = [...container.querySelectorAll('.af-mt-row .af-mt-dyn')]
    expect(chips.length).toBeGreaterThan(0)
    expect(chips.every((c) => c.parentElement?.classList.contains('af-mt-player-meta'))).toBe(true)
    expect(container.querySelector('.af-mt-player-name .af-mt-dyn')).toBeNull()
  })

  it('folds the dynasty age key into the closed abbreviations row', () => {
    const { container } = render(<MyTeam data={dynastyMyTeamFixture({ markers: true })} />)
    const key = container.querySelector('[data-testid=dynasty-age-key]')
    expect(key).not.toBeNull()
    const fold = key!.closest('details.af-mt-key') as HTMLDetailsElement | null
    expect(fold).not.toBeNull()
    expect(fold!.open).toBe(false)
  })
})
