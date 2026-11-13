/**
 * /import/<platform> pages for a platform that is OFF in provider-ui-config must read as "coming
 * soon" everywhere a visitor or a crawler looks: <title>, description, h1, intro, and the FAQ that is
 * published as FAQPage structured data. A disclaimer above live copy was not enough — the FAQ told
 * Google "Can I import one Yahoo league by ID? Yes." about a path that refuses every request.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.doUnmock('@/lib/league-import/provider-ui-config')
  vi.resetModules()
})

describe('platform landing copy follows availability', () => {
  it('Yahoo (coming soon) renders the coming-soon block, with no claim that import works', async () => {
    const { getPlatformLandingForDisplay } = await import('@/lib/league-import/platformLandingCopy')
    const yahoo = getPlatformLandingForDisplay('yahoo')!
    expect(yahoo.heading).toMatch(/coming soon/i)
    expect(yahoo.title).toMatch(/coming soon/i)
    expect(yahoo.description).toMatch(/waiting on Yahoo/i)
    const faqText = yahoo.faq.map((f) => `${f.q} ${f.a}`).join(' ')
    expect(faqText).not.toMatch(/by ID instead/i)
    expect(faqText).toMatch(/approves/i)
  })

  it('a live platform keeps its live copy untouched', async () => {
    const { getPlatformLanding, getPlatformLandingForDisplay } = await import('@/lib/league-import/platformLandingCopy')
    expect(getPlatformLandingForDisplay('sleeper')).toEqual(getPlatformLanding('sleeper'))
  })

  it('once Yahoo is live, its live copy comes back with no code change', async () => {
    vi.doMock('@/lib/league-import/provider-ui-config', async (importActual) => ({
      ...(await importActual<typeof import('@/lib/league-import/provider-ui-config')>()),
      isImportProviderAvailable: () => true,
    }))
    const { getPlatformLandingForDisplay } = await import('@/lib/league-import/platformLandingCopy')
    expect(getPlatformLandingForDisplay('yahoo')!.heading).toBe('Import your Yahoo league')
  })
})
