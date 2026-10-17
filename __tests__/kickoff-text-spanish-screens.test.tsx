/**
 * The first-kickoff date on the bilingual /core screens — Your Week, Season Outlook, Rivalry Radar —
 * reads in the reader's language (2026-10-04). `kickoffDayLabel` pins en-US + Eastern so the server
 * paint and the browser re-render agree; `kickoffText` translates its fixed output at render.
 *
 * Like kickoff-text-spanish.test.tsx, these feed each screen a kickoff ISO for EVERY month and compare
 * against the formatter's REAL output — so a change to the formatter's English breaks this suite
 * rather than silently falling back to English.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/week',
  useSearchParams: () => new URLSearchParams(),
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import { kickoffText } from '@/lib/core-app/kickoffText'
import { kickoffDayLabel } from '@/lib/core-app/kickoffLabel'
import YourWeek from '@/components/core-app/screens/YourWeek'
import { SeasonOutlook } from '@/components/core-app/screens/SeasonOutlook'
import { RivalryRadar } from '@/components/core-app/screens/RivalryRadar'
import type { WeekBoard } from '@/lib/core-app/weekBoard'
import type { SeasonOutlook as SeasonOutlookData } from '@/lib/core-app/seasonOutlook'
import type { RivalryRadar as RivalryRadarData } from '@/lib/core-app/weekBoard'

const EN_MONTH = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d/

/** One FUTURE kickoff per month — 17:00Z, so the Eastern calendar day is the UTC one. */
const KICKOFFS = Array.from({ length: 12 }, (_, mo) => new Date(Date.UTC(2099, mo, 15, 17)).toISOString())

const week = (firstKickoffAt: string) =>
  ({
    season: 2099, week: 1, coinFlips: [], leaning: [], unprojected: [], eliminationWeeks: [],
    model: { basis: '', sampleSize: 0 }, withoutSchedule: 0, firstKickoffAt,
  }) as unknown as WeekBoard

const outlook = (firstKickoffAt: string) =>
  ({
    leagues: [], withheld: [], priorities: [], swingByLeague: {}, basis: '', runs: { reused: 0, computed: 0 },
    summary: { makingPlayoffs: 0, clinched: 0, onTheBubble: 0, onByePace: 0, bestTitle: null },
    firstKickoffAt,
  }) as unknown as SeasonOutlookData

const radar = (firstKickoffAt: string) =>
  ({
    season: 2099, week: 1, theyOwnYou: [], youOwnThem: [], even: [], oneToWatch: null,
    totals: { meetings: 0, seasons: 0, platforms: 0 }, firstKickoffAt,
  }) as unknown as RivalryRadarData

const SCREENS: Array<[string, (iso: string) => React.ReactElement]> = [
  ['Your Week', (iso) => <YourWeek data={week(iso)} rivalriesHref="/core/week?view=rivalries" />],
  ['Season Outlook', (iso) => <SeasonOutlook data={outlook(iso)} />],
  ['Rivalry Radar', (iso) => <RivalryRadar data={radar(iso)} weekHref="/core/week" />],
]

afterEach(() => {
  cleanup()
  lang.language = 'en'
})

describe.each(SCREENS)('%s — the preseason "first kickoff" date', (_name, screen) => {
  it('reads Spanish, day first, for every month', () => {
    lang.language = 'es'
    for (const iso of KICKOFFS) {
      const english = kickoffDayLabel(iso)!
      const spanish = kickoffText(english, 'es')
      expect(spanish, english).toMatch(/^15 (ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)$/)
      const { container, unmount } = render(screen(iso))
      const text = container.textContent ?? ''
      expect(text, english).toContain(spanish)
      expect(text, english).not.toMatch(EN_MONTH)
      unmount()
    }
  })

  it('stays English in English, and follows a live switch', () => {
    const iso = KICKOFFS[9]!
    const r = render(screen(iso))
    expect(r.container.textContent).toContain('first kickoff Oct 15')
    lang.language = 'es'
    r.rerender(screen(iso))
    expect(r.container.textContent).toContain('15 oct')
    expect(r.container.textContent).not.toMatch(EN_MONTH)
  })
})
