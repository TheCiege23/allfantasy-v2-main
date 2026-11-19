/**
 * Kickoff times in the reader's language (2026-10-03). The formatters pin en-US + Eastern so the
 * server paint and the browser re-render agree; `kickoffText` translates their fixed output at
 * render. These feed it the formatters' REAL output — every weekday, every month — so a change to a
 * formatter's English breaks this suite rather than silently falling back to English.
 */
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import { kickoffText, weekdayEs } from '@/lib/core-app/kickoffText'
import { reportedLabel } from '@/lib/core-app/injuryReport'
import { kickoffClock } from '@/lib/core-app/lineupLock'
import { kickoffDayLabel } from '@/lib/core-app/kickoffLabel'
import { formatLockLabel } from '@/lib/core-app/lockLabel'
import { MyTeam } from '@/components/core-app/screens/MyTeam'
import type { LineupPlayer, MyTeamData } from '@/lib/core-app/myTeam'

const EN_DAY = /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/
const EN_MONTH = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/

describe('kickoffText, on the formatters’ real output', () => {
  it('every weekday kickoffClock writes', () => {
    // 2026-10-04 is a Sunday; 17:00Z is 1:00p ET.
    for (let i = 0; i < 7; i++) {
      const clock = kickoffClock(new Date(Date.UTC(2026, 9, 4 + i, 17)).toISOString())
      const es = kickoffText(clock, 'es')
      expect(es, clock).not.toMatch(EN_DAY)
      expect(es, clock).toMatch(/^(dom|lun|mar|mié|jue|vie|sáb) 1:00p ET$/)
    }
  })

  it('weekdayEs: every lone weekday the formatters write — kickoffClock’s, and reportedLabel’s date-only "reported Sun"', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 7; i++) {
      // A date-only report (UTC midnight) is the one place a weekday stands alone, with no clock for kickoffText.
      const iso = new Date(Date.UTC(2026, 9, 4 + i)).toISOString()
      const reported = reportedLabel(iso, iso)!
      const day = reported.replace(/^reported /, '')
      const fromClock = kickoffClock(new Date(Date.UTC(2026, 9, 4 + i, 17)).toISOString()).split(' ')[0]!
      expect(day, reported).toBe(fromClock)
      const es = weekdayEs(day)
      expect(es, day).toMatch(/^(dom|lun|mar|mié|jue|vie|sáb)$/)
      // ...and it agrees with kickoffText on the same weekday, so the two cannot drift apart.
      expect(`${es} 1:00p ET`).toBe(kickoffText(`${day} 1:00p ET`, 'es'))
      seen.add(es)
    }
    expect(seen.size).toBe(7)
    expect(weekdayEs('Sunday')).toBe('Sunday') // anything else passes through
  })

  it('every month kickoffDayLabel writes — day first in Spanish', () => {
    for (let mo = 0; mo < 12; mo++) {
      const day = kickoffDayLabel(new Date(Date.UTC(2026, mo, 15, 17)).toISOString())!
      const es = kickoffText(day, 'es')
      expect(es, day).not.toMatch(EN_MONTH)
      expect(es, day).toMatch(/^15 (ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)$/)
    }
  })

  it('the server-built gameContext form — weekday, month/day, clock — swaps to day/month', () => {
    // myTeam.ts formatKickoff: weekday + numeric month/day spliced into kickoffClock's output.
    expect(kickoffText('DEN vs MIA · Thu 10/1 8:15p ET', 'es')).toBe('DEN vs MIA · jue 1/10 8:15p ET')
    expect(kickoffText('Sun 9/13 1:00p ET', 'es')).toBe('dom 13/9 1:00p ET')
  })

  it('formatLockLabel’s distant date and "Locked"', () => {
    const now = Date.UTC(2026, 9, 4, 12)
    const distant = formatLockLabel(Date.UTC(2026, 9, 20, 17), now)
    expect(distant.distant).toBe(true)
    expect(kickoffText(distant.text, 'es')).toBe('20 oct')
    expect(kickoffText(formatLockLabel(now - 1000, now).text, 'es')).toBe('Bloqueado')
    // A countdown reads the same in Spanish and is left alone.
    expect(kickoffText(formatLockLabel(now + 3 * 86_400_000 + 4 * 3_600_000, now).text, 'es')).toBe('3d 4h')
  })

  it('leaves English, unknown text and words that only look like a day alone', () => {
    expect(kickoffText('Sun 1:00p ET', 'en')).toBe('Sun 1:00p ET')
    expect(kickoffText('Sunday league', 'es')).toBe('Sunday league')
    expect(kickoffText('March Madness', 'es')).toBe('March Madness')
    expect(kickoffText(null, 'es')).toBeNull()
  })
})

const player = (over: Partial<LineupPlayer> = {}): LineupPlayer => ({
  sleeperId: 'p1', name: 'Bo Nix', position: 'QB', team: 'DEN', sport: 'NFL', imageUrl: null,
  gameContext: 'DEN vs MIA · Thu 10/1 8:15p ET', kickoff: new Date('2099-10-01T00:15:00Z'),
  preseason: false, venue: null, injuryStatus: null, ruledOut: false, projectedPoints: 19.8,
  afProjectedPoints: 22.4, afEngineProjectedPoints: 21.1, indoors: false, weather: null, market: null, onBye: false, ...over,
})
const data = {
  league: { id: 'l1', name: 'KBFL', platform: 'sleeper', format: 'dynasty', sourceLink: null },
  team: { available: false, reason: 'n/a' },
  starters: { available: true, data: [{ slotLabel: 'QB', benchCheck: null, player: player(), empty: false, unresolvedId: null }] },
  bench: { available: true, data: [player({ sleeperId: 'b1', gameContext: null })] },
  ir: { available: false, reason: 'n/a' }, taxi: { available: false, reason: 'n/a' },
  lock: { available: false, reason: 'n/a' },
  projections: { available: false, reason: 'n/a' }, projectionBasis: { notes: [], scoringKnown: false },
  nextMatchup: { available: false, reason: 'n/a' }, upcomingByes: [],
  rosterGrade: { available: false, reason: 'n/a' }, liveScore: { available: false, reason: 'n/a' },
} as unknown as MyTeamData

describe('My Team rows, in Spanish', () => {
  it('the server-built kickoff, and the no-game fallback — and back to English live', () => {
    lang.language = 'es'
    const r = render(<MyTeam data={data} />)
    const when = () => [...r.container.querySelectorAll('.af-mt-when')].map((e) => e.textContent)
    expect(when()).toEqual(['jue 1/10 8:15p ET'])
    expect(r.container.textContent).toContain('no se encontró partido esta semana')
    lang.language = 'en'
    r.rerender(<MyTeam data={data} />)
    expect(when()).toEqual(['Thu 10/1 8:15p ET'])
    expect(r.container.textContent).toContain('no game found for this week')
  })
})
