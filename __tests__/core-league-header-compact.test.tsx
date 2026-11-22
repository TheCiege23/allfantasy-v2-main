import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import CoreLeagueContextBar from '@/components/core-app/CoreLeagueContextBar'
import { LeagueTabs } from '@/components/core-app/LeagueTabs'

/*
 * 🛑 THE LEAGUE HEADER WAS THE WHOLE FIRST SCREEN ON A PHONE (2026-11-05). Measured on allfantasy.ai
 * at 375px: a full-width "Open League" button and explainer, a tab row that wrapped, and a League
 * type select drawn for a type already confirmed. A confirmed type is now a chip that reopens the
 * editor; an unconfirmed one keeps the full control, because every trade grade is priced on it.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch() {}, push() {}, replace() {}, refresh() {} }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams('league=lg-1'),
}))

function stubFetch(payload: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))))
}

const bar = () => (
  <CoreLeagueContextBar
    leagueId="lg-1"
    leagueName="Its gonna be Maye 26"
    platform="sleeper"
    logoLetter="I"
    syncLabel="3m ago"
    syncStale={false}
    gameDayActive={false}
    surface="my-team"
    decisionSlot={null}
    recommendationSlot={null}
  />
)

afterEach(() => {
  vi.unstubAllGlobals()
  window.location.hash = ''
})

describe('league type in the header', () => {
  it('a confirmed type is a chip; the select stays out of the way until the chip is tapped', async () => {
    stubFetch({ canConfirm: true, storedType: 'redraft', confirmation: { type: 'redraft' } })
    const { container } = render(bar())
    const chip = await screen.findByRole('button', { name: /Redraft/ })
    const editor = container.querySelector('.af-lctx-type') as HTMLElement
    expect(editor.hidden).toBe(true)
    expect(chip.id).toBe('league-type')

    fireEvent.click(chip)
    expect(editor.hidden).toBe(false)
    expect(editor.id).toBe('league-type')
    expect(screen.queryByRole('button', { name: /Redraft/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(editor.hidden).toBe(true)
  })

  it('an unconfirmed type keeps the full control, open, with its confirm button', async () => {
    stubFetch({ canConfirm: true, storedType: 'redraft', confirmation: null })
    const { container } = render(bar())
    await screen.findByRole('button', { name: 'Confirm Redraft' })
    expect((container.querySelector('.af-lctx-type') as HTMLElement).hidden).toBe(false)
    expect(container.querySelector('button.af-lctx-typechip')).toBeNull()
  })

  it("a grade's #league-type link opens a confirmed type's editor", async () => {
    window.location.hash = '#league-type'
    stubFetch({ canConfirm: true, storedType: 'dynasty', confirmation: { type: 'dynasty' } })
    const { container } = render(bar())
    await waitFor(() => expect((container.querySelector('.af-lctx-type') as HTMLElement).hidden).toBe(false))
  })
})

describe('league tab row', () => {
  it('puts Open League in the tab row and prints its explainer only on the Overview', () => {
    const { container, rerender } = render(
      <LeagueTabs leagueId="L1" leagueName="Sunday" activeKey="my-team" platform="Sleeper" hasScoredWeek tradeSupported draftSupported compact />,
    )
    const open = screen.getByRole('link', { name: /Open League/ })
    expect(open.closest('.af-lt-compact')).not.toBeNull()
    expect(open.getAttribute('title')).toMatch(/Complete official moves in Sleeper/)
    expect(container.querySelector('.af-lt-workspace-note')).toBeNull()

    rerender(<LeagueTabs leagueId="L1" leagueName="Sunday" activeKey="home" platform="Sleeper" hasScoredWeek tradeSupported draftSupported compact />)
    expect(container.querySelector('.af-lt-workspace-note')?.textContent).toMatch(/Complete official moves in Sleeper/)
  })
})
