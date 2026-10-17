/**
 * The /core home's "?" (Dashboard3A) is the shared InfoTip, filled from the home topic dictionary
 * (2026-10-03, the owner's one-explainer ruling).
 *
 * Dashboard3A carried a local `Help` — a CSS hover/focus `<span data-help>` with no accessible name,
 * which a phone could not reliably open and a screen reader could not name. Each of its eight spots
 * is now `<TopicTip topic=… />`: a real button, named for its term, opening a native popover.
 *
 * Also pinned, per InfoTip's own rules: no tip sits inside a link, a button or anything carrying a
 * `title` (the native tooltip would pop over the open popover).
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, within } from '@testing-library/react'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: 'en' }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch() {}, push() {}, replace() {}, refresh() {} }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/geo/useGeoRestriction', () => ({ useGeoRestriction: () => ({ loading: true, isPaidBlocked: false }) }))
vi.mock('@/components/values/ValuesPageLink', () => ({ ValuesPageLink: () => null }))

import {
  Dashboard3A,
  Dash3ACareer,
  Dash3AExposure,
  Dash3AFollowing,
  Dash3AIssues,
  Dash3AReceipts,
  Dash3ARivals,
  Dash3ARoutine,
} from '@/components/core-app/screens/Dashboard3A'
import { HELP_TOPICS, type HelpTopic } from '@/lib/core-app/helpTopics'
import type { WeeklyRoutineData } from '@/lib/core-app/weeklyRoutine'
import type { DecisionReceiptsData } from '@/lib/core-app/decisionReceipts'

afterEach(cleanup)

const routine: WeeklyRoutineData = {
  today: 'waivers',
  todayLabel: 'Wednesday',
  steps: [{ key: 'waivers', day: 'Wed', title: 'Waivers', href: '/core/waivers', today: true, state: 'open', summary: null }],
  recap: null,
  awards: [],
  upsets: [],
}
const receipts = { trades: [], tooEarly: 1, uncoveredLeagues: 0 } as unknown as DecisionReceiptsData

const SPOTS: Array<{ name: string; topic: string; ui: React.ReactElement }> = [
  { name: 'topbar READ-ONLY', topic: 'readOnly', ui: <Dashboard3A slots={{} as never} /> },
  { name: 'Your week', topic: 'yourWeekRoutine', ui: <Dash3ARoutine routine={routine} /> },
  { name: 'Outstanding issues', topic: 'outstandingIssues', ui: <Dash3AIssues issues={[]} /> },
  { name: 'Your career', topic: 'homeCareer', ui: <Dash3ACareer career={null} /> },
  { name: 'Rivalry radar', topic: 'homeRivalryRadar', ui: <Dash3ARivals rivals={null} /> },
  { name: 'Portfolio & exposure', topic: 'homeExposure', ui: <Dash3AExposure exposure={null} /> },
  {
    name: 'Following',
    topic: 'homeFollowing',
    ui: <Dash3AFollowing following={{ rows: [], total: 0, statusCoverage: 'ok' }} />,
  },
  { name: 'Receipts', topic: 'homeReceipts', ui: <Dash3AReceipts receipts={receipts} /> },
]

describe('the /core home explains itself through the shared InfoTip', () => {
  for (const spot of SPOTS) {
    it(`${spot.name}: no data-help badge, one .af-info-tip named for "${spot.topic}"`, () => {
      const { container } = render(spot.ui)
      expect(container.querySelectorAll('[data-help], [data-help-body]')).toHaveLength(0)

      const t = (HELP_TOPICS as Record<string, HelpTopic>)[spot.topic]
      expect(t, `topic ${spot.topic} is registered`).toBeDefined()
      const btn = within(container).getByRole('button', { name: `What “${t.en.title}” means` })
      expect(btn.className).toContain('af-info-tip')

      // InfoTip's placement rules.
      expect(btn.parentElement?.closest('[title]'), 'no title= on any ancestor').toBeNull()
      expect(btn.closest('a'), 'never inside a link').toBeNull()
      expect(btn.parentElement?.closest('button'), 'never inside a button').toBeNull()
      const labelled = btn.closest('[aria-labelledby]')
      if (labelled) {
        const heading = container.querySelector(`#${CSS.escape(labelled.getAttribute('aria-labelledby')!)}`)
        expect(heading?.contains(btn), 'beside, never inside, the labelling heading').toBe(false)
      }
    })
  }

  it('the whole dashboard renders no data-help markup at all', () => {
    const { container } = render(<Dashboard3A slots={{} as never} />)
    expect(container.querySelectorAll('[data-help], [data-help-body], [data-help-left]')).toHaveLength(0)
  })

  it('the rivalry topic carries the tie rule from #2005', () => {
    const t = (HELP_TOPICS as Record<string, HelpTopic>).homeRivalryRadar
    expect(t?.en.body).toContain('W–L–T only when there is one')
    expect(t?.en.body).toMatch(/tie, never a loss/)
  })
})
