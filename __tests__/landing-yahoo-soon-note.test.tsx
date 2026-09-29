// @vitest-environment jsdom
/**
 * The live homepage is LandingV4 (app/page.tsx renders it). Its "Connects to" strip already reads
 * lib/league-import/provider-ui-config.ts, so Sleeper, ESPN, Fantrax, MFL and Fleaflicker show as
 * live and Yahoo as "soon". What a visitor could not see was WHY Yahoo is soon: AllFantasy is
 * waiting on Yahoo to approve its Fantasy Sports API access. That reason is now stated, in both
 * locales, and only for as long as the config keeps Yahoo off.
 *
 * (components/landing/journey/PlatformImportPicker.tsx, which advertised Underdog and League
 * Tycoon, is not rendered anywhere live — it is reached only through LandingPageClient, which no
 * route imports.)
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LANDING_LANGS } from '@/lib/i18n/landing-copy'

async function render(lang: 'en' | 'es') {
  const { LandingV4 } = await import('@/components/core-app/screens/LandingV4')
  const html = renderToStaticMarkup(<LandingV4 lang={lang} launch={null} />)
  return new DOMParser().parseFromString(html, 'text/html')
}

afterEach(() => {
  vi.doUnmock('@/lib/league-import/provider-ui-config')
  vi.resetModules()
})

describe('landing: Yahoo is coming soon, and says why', () => {
  it.each(LANDING_LANGS)('%s: the strip marks Yahoo soon, states the approval wait, and names no unsupported platform', async (lang) => {
    const doc = await render(lang)
    const connects = doc.querySelector('.af-lp-connects')
    // Positive control: this is the strip, and it lists the five live platforms.
    expect(connects).not.toBeNull()
    const states = Object.fromEntries(
      [...connects!.querySelectorAll('.af-lp-connect')].map((el) => [el.firstChild?.textContent, el.getAttribute('data-state')]),
    )
    expect(states).toEqual({ Sleeper: 'live', ESPN: 'live', Yahoo: 'soon', Fantrax: 'live', MFL: 'live', Fleaflicker: 'live' })

    const note = connects!.querySelector('.af-lp-soon-note[data-provider="yahoo"]')
    expect(note?.textContent).toMatch(/Yahoo/)
    expect(note?.textContent).toMatch(lang === 'es' ? /aprueb/ : /approve/)

    expect(doc.body.textContent).not.toMatch(/Underdog|League Tycoon|\bCBS\b/)
  })

  it('the note follows the config: once Yahoo is switched on it is live and the note is gone', async () => {
    // Before the flip the note is there, so its absence below is caused by the flag.
    expect((await render('en')).querySelector('.af-lp-soon-note')).not.toBeNull()
    vi.resetModules()
    vi.doMock('@/lib/league-import/provider-ui-config', async (importOriginal) => {
      const real = await importOriginal<typeof import('@/lib/league-import/provider-ui-config')>()
      return {
        ...real,
        IMPORT_PROVIDER_UI_OPTIONS: real.IMPORT_PROVIDER_UI_OPTIONS.map((o) =>
          o.provider === 'yahoo' ? { ...o, available: true } : o,
        ),
      }
    })
    const doc = await render('en')
    const yahoo = [...doc.querySelectorAll('.af-lp-connect')].find((el) => el.firstChild?.textContent === 'Yahoo')
    expect(yahoo?.getAttribute('data-state')).toBe('live')
    expect(doc.querySelector('.af-lp-soon-note')).toBeNull()
  })
})
