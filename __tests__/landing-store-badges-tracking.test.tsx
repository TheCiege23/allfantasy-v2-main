import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/lib/platform/isTrustedWebActivity', () => ({ isTrustedWebActivity: () => false }))

import { LandingStoreBadges } from '@/components/core-app/screens/LandingStoreBadges'

/** Only our badge events — the dataLayer is shared with everything else on the page. */
function badgeEvents() {
  return (window.dataLayer ?? []).filter((e) => e.event === 'app_store_badge_click')
}

beforeEach(() => {
  window.dataLayer = []
})
afterEach(() => {
  cleanup()
  delete window.dataLayer
})

describe('store badge taps are tracked', () => {
  it.each([
    ['landing', 'landing-store-apple', 'app_store'],
    ['landing', 'landing-store-google', 'google_play'],
    ['commissioners', 'landing-store-apple', 'app_store'],
    ['signup', 'landing-store-google', 'google_play'],
  ] as const)('%s: tapping %s pushes store=%s', (page, testId, store) => {
    render(<LandingStoreBadges page={page} />)
    expect(badgeEvents()).toHaveLength(0) // nothing fires on render
    fireEvent.click(screen.getByTestId(testId))
    const events = badgeEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ event: 'app_store_badge_click', store, page })
    expect(typeof events[0].event_id).toBe('string')
  })

  it('each tap is its own event', () => {
    render(<LandingStoreBadges page="landing" />)
    fireEvent.click(screen.getByTestId('landing-store-apple'))
    fireEvent.click(screen.getByTestId('landing-store-google'))
    expect(badgeEvents().map((e) => e.store)).toEqual(['app_store', 'google_play'])
  })
})
