import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The /core home hides both main-column cards (routine, matchups) by default and passes `issues`
 * as null, so the main column of Dashboard3A's two-column body was empty while the side cards were
 * on. Measured 2026-11-12 at 1440px: a 528px blank column beside the 360px side cards. With nothing
 * in the main column the body now drops it (`data-no-main`) and the side cards take the width.
 */
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: 'en' }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch() {}, push() {}, replace() {}, refresh() {} }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/geo/useGeoRestriction', () => ({ useGeoRestriction: () => ({ loading: true, isPaidBlocked: false }) }))
vi.mock('@/components/values/ValuesPageLink', () => ({ ValuesPageLink: () => null }))
vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))

import Dashboard3A, { type Dashboard3ASlots } from '@/components/core-app/screens/Dashboard3A'

afterEach(cleanup)

const card = (name: string) => <section data-testid={`card-${name}`}>{name}</section>

function slots(main: boolean): Dashboard3ASlots {
  return {
    routine: main ? card('routine') : null,
    issues: null,
    matchups: main ? card('matchups') : null,
    chimmy: card('chimmy'),
    career: card('career'),
    rivals: card('rivals'),
    portfolioChart: null,
    exposure: null,
    following: null,
    receipts: null,
    leagues: card('leagues'),
  }
}

function body(main: boolean, side: Array<'chimmy' | 'career' | 'rivals'>, mainOrder: Array<'routine' | 'issues' | 'matchups'>) {
  const { container } = render(<Dashboard3A slots={slots(main)} order={{ main: mainOrder, side, stack: [] }} />)
  return container.querySelector('.af3a-body') as HTMLElement
}

describe('Dashboard3A body columns', () => {
  it('drops the main column when every main card is hidden, as on the default /core home', () => {
    // The home passes `issues` in the order with a null slot; routine and matchups were left out as hidden.
    const el = body(false, ['chimmy', 'career', 'rivals'], ['issues'])
    expect(el.hasAttribute('data-no-main')).toBe(true)
    expect(el.querySelector('.af3a-col-main')!.children).toHaveLength(0)
    expect(el.querySelectorAll('.af3a-col-side [data-testid^="card-"]')).toHaveLength(3)
  })

  it('keeps both columns when the main column has a card', () => {
    const el = body(true, ['chimmy', 'career', 'rivals'], ['routine', 'issues', 'matchups'])
    expect(el.hasAttribute('data-no-main')).toBe(false)
    expect(el.querySelectorAll('.af3a-col-main [data-testid^="card-"]')).toHaveLength(2)
  })

  it('uses the existing single-column rule when the side is empty, not the new one', () => {
    const el = body(true, [], ['routine', 'matchups'])
    expect(el.hasAttribute('data-no-side')).toBe(true)
    expect(el.hasAttribute('data-no-main')).toBe(false)
  })
})
