import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

/*
 * 🛑 An imported league is renewed on its platform (2026-10-12). This banner showed to every commissioner
 * whose season was over, and renewing an imported Sleeper league moved the row a season forward while it
 * still pointed at last season's Sleeper league — every sync refused it after that.
 */

vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})
vi.mock('@/components/league-settings/RenewLeagueModal', () => ({ RenewLeagueModal: () => null }))

import { RenewLeagueBanner } from '@/components/league/RenewLeagueBanner'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ json: async () => ({}) })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const props = { leagueId: 'L1', currentSeason: 2026, isCommissioner: true, leagueStatus: 'complete' }

describe('RenewLeagueBanner', () => {
  it('[control] shows to the commissioner of a finished AllFantasy league', () => {
    const { container } = render(<RenewLeagueBanner {...props} platform="allfantasy" />)
    expect(container.textContent).not.toBe('')
    expect(fetchMock).toHaveBeenCalled()
  })

  it('never shows on an imported league, and never asks the renew endpoint', () => {
    for (const platform of ['sleeper', 'espn', 'yahoo']) {
      const { container } = render(<RenewLeagueBanner {...props} platform={platform} />)
      expect(container.textContent).toBe('')
      cleanup()
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
