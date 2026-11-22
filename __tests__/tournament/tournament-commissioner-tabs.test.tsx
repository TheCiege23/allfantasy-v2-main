/**
 * Every commissioner tab is reachable without a hidden sideways scroll (2026-11-09, tournament gaps audit item 1).
 * The 12 tabs sat in an `overflow-x-auto` row with no scroll cue: 3 were past the edge at 1440, 8 at 820 and 10 on a
 * phone, including Approvals and History. The row now wraps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { TournamentCommissionerDashboard } from '@/components/tournament/TournamentCommissionerDashboard'

vi.mock('next/link', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/tournament/t1/commissioner',
}))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => (dict.en as Record<string, string>)[k] ?? k
  const tInterpolate = (k: string, vars: Record<string, string | number>) =>
    Object.entries(vars).reduce((s, [a, b]) => s.replace(`{${a}}`, String(b)), t(k))
  return {
    useLanguage: () => ({ language: 'en', t, tInterpolate, setLanguage: () => {} }),
    useOptionalLanguage: () => ({ language: 'en', t, tInterpolate }),
  }
})

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ error: 'test' }) })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Tournament commissioner tabs', () => {
  it('render all twelve tabs in a row that wraps instead of scrolling sideways', () => {
    render(<TournamentCommissionerDashboard tournamentId="t1" />)
    const row = screen.getByTestId('tournament-commissioner-tab-overview').parentElement as HTMLElement
    expect(within(row).getAllByRole('button')).toHaveLength(12)
    expect(row.className).toMatch(/\bflex-wrap\b/)
    expect(row.className).not.toMatch(/overflow-x-(auto|scroll)/)
    for (const id of ['subscription', 'approvals', 'history']) {
      expect(within(row).getByTestId(`tournament-commissioner-tab-${id}`)).toBeTruthy()
    }
  })
})
