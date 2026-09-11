import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import BehaviorProfilesPanel from '@/components/app/settings/BehaviorProfilesPanel'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('replaces profile browsing with an honest Competitive Edge entry without fetching profiles', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  render(<BehaviorProfilesPanel leagueId="L" />)
  expect(screen.getByRole('heading', { name: 'Competitive Edge' })).toBeTruthy()
  expect(screen.getByText(/No acceptance prediction is available here yet/)).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Open league decisions' }).getAttribute('href')).toBe('/app/league/L')
  expect(screen.queryByText('Risk tolerance')).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})
