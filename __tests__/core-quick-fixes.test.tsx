import { fireEvent, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/**
 * The /core "fix now" batch: Matchup on the phone bar, the language chip in the top bar,
 * System theme painted correctly by the server, and the undefined `--af-*` aliases.
 */

const nav = vi.hoisted(() => ({
  router: { push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {} },
}))
const lang = vi.hoisted(() => ({ setLanguage: vi.fn() }))

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
vi.mock('@/components/i18n/LanguageProviderClient', async (orig) => {
  const real = await orig<typeof import('@/components/i18n/LanguageProviderClient')>()
  return {
    ...real,
    useOptionalLanguage: () => ({ ...real.useOptionalLanguage(), language: 'en', setLanguage: lang.setLanguage }),
  }
})

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { resolveServerDataMode } from '@/lib/theme'

function barPaths(props: Record<string, unknown>): string[] {
  const { container } = render(
    <AfCoreShell active="home" leagues={[]} syncAge={{ label: 'just now', stale: false }} syncEligibleCount={0} {...props}>
      <div>screen</div>
    </AfCoreShell>,
  )
  return [...container.querySelectorAll('.af-tabbar a[href]')].map((a) => (a.getAttribute('href') ?? '').split('?')[0])
}

describe('phone bottom bar', () => {
  it('pins Matchup alongside Trades', () => {
    expect(barPaths({ selectedLeagueId: 'L1' })).toEqual(['/core', '/core/my-team', '/core/matchup', '/core/trades', '/core/live'])
  })

  it('fills Matchup\'s slot with Player Finder before the league has a scored week, keeping five', () => {
    // Your week is hidden too until a week is scored, so the unconditional stand-in takes it.
    expect(barPaths({ selectedLeagueId: 'L1', leagueHasScoredWeek: false })).toEqual([
      '/core',
      '/core/my-team',
      '/core/players',
      '/core/trades',
      '/core/live',
    ])
  })
})

describe('phone bottom bar, platform without trades', () => {
  it('fills the Trades slot with Your week', () => {
    expect(barPaths({ selectedLeagueId: 'L1', importCapabilities: { trades: false } })).toEqual([
      '/core',
      '/core/my-team',
      '/core/matchup',
      '/core/week',
      '/core/live',
    ])
  })
})

describe('language chip in the /core top bar', () => {
  it('switches language without leaving /core', () => {
    const { getAllByRole } = render(
      <AfCoreShell active="home" leagues={[]} syncAge={{ label: 'just now', stale: false }} syncEligibleCount={0}>
        <div>screen</div>
      </AfCoreShell>,
    )
    // Two copies by design: the top bar's, and the phone ↻ menu's (CSS shows exactly one per width).
    const chips = getAllByRole('button', { name: /^Language: English\. Switch to/ })
    expect(chips).toHaveLength(2)
    for (const chip of chips) {
      expect(chip.textContent).toBe('EN')
      lang.setLanguage.mockClear()
      fireEvent.click(chip)
      expect(lang.setLanguage).toHaveBeenCalledWith('es')
    }
  })
})

describe('resolveServerDataMode', () => {
  it('paints System from the last client-resolved value instead of always dark', () => {
    expect(resolveServerDataMode('system', 'light')).toBe('light')
    expect(resolveServerDataMode('system', 'dark')).toBe('dark')
  })

  it('falls back to the old resolution when the hint is missing or junk', () => {
    expect(resolveServerDataMode('system', undefined)).toBe('dark')
    expect(resolveServerDataMode('system', 'purple')).toBe('dark')
  })

  it('ignores the hint for an explicit theme', () => {
    expect(resolveServerDataMode('dark', 'light')).toBe('dark')
    expect(resolveServerDataMode('legacy', 'light')).toBe('legacy')
    expect(resolveServerDataMode('light', 'dark')).toBe('light')
  })
})

describe('--af-* aliases', () => {
  it('defines every --af-* colour name the core stylesheets read', () => {
    const css = readFileSync(resolve(__dirname, '../components/core-app/af-core.css'), 'utf8')
    for (const name of ['bg', 'surface', 'text', 'ink', 'text-dim', 'muted', 'faint', 'line', 'border', 'accent', 'good']) {
      expect(css).toMatch(new RegExp(`--af-${name}:\\s*var\\(--`))
    }
  })
})
