// @vitest-environment jsdom
/**
 * The league tabs' More menu in the reader's language (2026-10-06). It translates through
 * `coreUiCopy`, which had no entry for "Schedule", so a live Spanish check found that one tab English
 * among Spanish neighbours. This reads every tab in the menu and the summary, both ways.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: h.language, setLanguage: () => {}, t: (k: string) => k, tInterpolate: (k: string) => k }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch() {}, push() {}, replace() {}, refresh() {} }),
}))

import { LeagueTabs } from '@/components/core-app/LeagueTabs'

afterEach(() => {
  cleanup()
  h.language = 'en'
})

const menu = (language: 'en' | 'es') => {
  h.language = language
  const { container } = render(
    <LeagueTabs leagueId="L1" leagueName="Liga Prueba" activeKey="schedule" hasScoredWeek tradeSupported draftSupported compact />,
  )
  return {
    items: [...container.querySelectorAll('.af-lt-more-list a')].map((a) => a.textContent?.trim()),
    summary: container.querySelector('details.af-lt-more summary')?.textContent?.trim(),
  }
}

describe('league tabs — More menu', () => {
  it('reads Spanish, Schedule included', () => {
    const { items, summary } = menu('es')
    expect(items).toContain('Calendario')
    expect(summary).toContain('Calendario')
    // Tab names that are English words in a Spanish menu. "War Room" style product names aside, none.
    expect(items.filter((t) => /^(Schedule|Waivers|Standings|Outlook|Your week|My team|Moves)$/.test(t ?? ''))).toEqual([])
  })

  it('CONTROL — English is unchanged', () => {
    const { items, summary } = menu('en')
    expect(items).toContain('Schedule')
    expect(summary).toBe('More · Schedule')
  })
})
