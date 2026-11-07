/**
 * 🛑 A DATE TYPED BEFORE REACT FLUSHES ITS EFFECTS MUST SURVIVE THEM.
 *
 * DateField used to re-sync its typed text in a useEffect keyed on the saved value. A passive
 * effect also fires once on MOUNT, on a later tick — so anything typed before that tick was
 * erased, and an invalid date's error vanished with it. On a loaded CI runner the test typed
 * first: `draft-settings-panel.test.tsx` went red on main 6 times in one week with the input
 * dumped as value="" right after "02/30/2027" was entered.
 *
 * This file reproduces that ordering on purpose. React's scheduler flushes passive effects via
 * setImmediate in Node; delaying it 30ms puts the test's typing before the mount effect every
 * time. Against the old effect this fails 5 of 5; the during-render sync passes.
 */
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'

vi.hoisted(() => {
  const realSetTimeout = globalThis.setTimeout
  ;(globalThis as any).setImmediate = (fn: (...a: unknown[]) => void, ...args: unknown[]) =>
    realSetTimeout(() => fn(...args), 30)
})

vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict.en[k] ?? k
  return { useLanguage: () => ({ language: 'en', t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: 'en', t }) }
})

import { DraftSettingsCommissionerPanel } from '@/components/league-settings/DraftSettingsCommissionerPanel'

const SETTINGS = {
  isCommissioner: true,
  hasAfCommissionerSub: false,
  config: { draft_type: 'snake', rounds: 15, timer_seconds: 90 },
  teams: [],
  computedRounds: { rounds: 14, rosterSpots: 14, countsTaxiAndDevy: false },
}

afterEach(() => { vi.unstubAllGlobals(); cleanup() })

it('keeps an invalid typed date, and its error, when the mount effects flush late', { repeats: 4 }, async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    String(url).includes('rookie-draft-order')
      ? { ok: false, status: 400, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => SETTINGS }))
  const r = render(<DraftSettingsCommissionerPanel leagueId="l1" />)
  const date = (await r.findByLabelText('Date')) as HTMLInputElement
  fireEvent.change(date, { target: { value: '02/30/2027' } })
  fireEvent.blur(date)
  await r.findByText('Enter a real date, like MM/DD/YYYY.')
  expect(date.value).toBe('02/30/2027')
})
