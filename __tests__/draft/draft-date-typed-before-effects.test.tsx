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
import { afterAll, afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'

/*
 * The delayed setImmediate, with its own bookkeeping so the file can end cleanly:
 *   - `pending` counts callbacks still waiting, so afterAll can wait for ZERO rather than for a guessed duration
 *   - a callback that fires after jsdom is gone is SKIPPED: it is a React flush with nothing left to render into,
 *     and running it is exactly the CI failure — "ReferenceError: window is not defined" thrown from this wrapper
 *     (stack: Timeout._onTimeout here → scheduler performWorkUntilDeadline → react-dom), an unhandled error that
 *     fails the whole shard while every test passes
 *   - the real setImmediate is put back when the file ends
 */
const flush = vi.hoisted(() => {
  const realSetTimeout = globalThis.setTimeout
  const realSetImmediate = globalThis.setImmediate
  const state = { pending: 0, skipped: 0, realSetImmediate }
  ;(globalThis as any).setImmediate = (fn: (...a: unknown[]) => void, ...args: unknown[]) => {
    state.pending++
    return realSetTimeout(() => {
      state.pending--
      if (typeof window === 'undefined') { state.skipped++; return }
      fn(...args)
    }, 30)
  }
  return state
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

/*
 * ⚠ DRAIN THE DELAYED FLUSHES BEFORE THE FILE ENDS. Every setImmediate above lands 30ms later, so the unmount in
 * the last `cleanup()` can leave React's scheduler a callback queued after the last test. The first version of this
 * waited a fixed ~500ms and hoped; a flush queued late on a loaded runner outlived it (a red 1/4 shard reported
 * "window is not defined" from this file once in seven runs on main). Now: wait until nothing is pending — each
 * flush can queue the next, so this loops — bounded so a runaway scheduler cannot hang the file, then restore the
 * real setImmediate. Anything still in flight after that is caught by the `window` guard in the wrapper.
 */
afterAll(async () => {
  const deadline = Date.now() + 5000
  while (flush.pending > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 40))
  ;(globalThis as any).setImmediate = flush.realSetImmediate
})

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
