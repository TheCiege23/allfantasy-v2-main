import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

/**
 * Item #9 — the phone trade builder: one team per step, sticky totals, a searchable asset sheet and
 * a persistent review control.
 *
 * Layout (what is hidden at which width) is CSS and was measured in real Chromium and WebKit at
 * 390px against a dev server; these pin the component contract that layout hangs off, plus the
 * stylesheet rules themselves.
 */

const rosterData = vi.hoisted(() => ({ current: null as unknown }))
const phone = vi.hoisted(() => ({ matches: false }))

vi.mock('@/components/core-app/screens/useLeagueRosters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/core-app/screens/useLeagueRosters')>()
  return { ...actual, useLeagueRosters: () => ({ data: rosterData.current, state: 'idle' }) }
})

import { TradeCenter } from '@/components/core-app/screens/TradeCenter'

const LEAGUE = { id: 'l1', name: 'Draft Junkies', format: 'Dynasty · PPR', teamCount: 12 }

function player(id: string, name: string, value: number) {
  return { id, name, position: 'WR', team: 'PIT', value, imageUrl: null, byeWeek: null, injuryStatus: null, stock: null, stockDelta: null }
}

function roster(rosterId: string, ownerName: string, players: unknown[]) {
  return {
    rosterId, platformUserId: `u-${rosterId}`, players, picks: [], teamExternalId: `t-${rosterId}`,
    ownerName, avatarUrl: null, wins: 0, losses: 0, ties: 0, faabRemaining: null,
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  phone.matches = false
  rosterData.current = {
    rosters: [
      roster('r1', 'You', [player('p1', 'DK Metcalf', 5000)]),
      roster('r2', 'Matt Jones', [player('p9', 'Christian McCaffrey', 7000)]),
    ],
    viewerRosterId: 'r1',
    viewerTeamRosterId: 'r1',
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === '(max-width: 720px)' ? phone.matches : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }),
  })
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const root = (c: HTMLElement) => c.querySelector('.af-tc') as HTMLElement
const primary = () => document.querySelector('.af-tc-stepbar-primary') as HTMLButtonElement
const chooseMatt = () =>
  fireEvent.click(
    [...document.querySelectorAll<HTMLButtonElement>('.af-tc-partner-chip')].find((b) => b.textContent === 'Matt Jones')!,
  )
const step = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('.af-tc-step')].find((b) => b.textContent?.includes(label))!

/*
 * 2026-09-24: the step labels became Offers / Send / Get / Review (four tabs share 390px), and the
 * inbox, value alerts and league history moved onto their own Offers step instead of rendering on
 * every step. Assertions below that changed say so where they changed.
 */
describe('steps', () => {
  it('starts on "Send", with the step marked current', () => {
    const { container } = render(<TradeCenter league={LEAGUE} />)
    expect(root(container).getAttribute('data-mobile-step')).toBe('give')
    expect(step('Send').getAttribute('aria-current')).toBe('step')
    expect(step('Get').getAttribute('aria-current')).toBeNull()
  })

  it('moves between steps from the step bar', () => {
    const { container } = render(<TradeCenter league={LEAGUE} />)
    fireEvent.click(step('Get'))
    expect(root(container).getAttribute('data-mobile-step')).toBe('get')
    expect(step('Get').getAttribute('aria-current')).toBe('step')
    fireEvent.click(step('Review'))
    expect(root(container).getAttribute('data-mobile-step')).toBe('review')
    fireEvent.click(step('Offers'))
    expect(root(container).getAttribute('data-mobile-step')).toBe('offers')
  })

  it('🛑 a trade link (?trade=) lands on Offers, where that trade is', () => {
    window.history.replaceState(null, '', '/core/trades?league=l1&trade=tx-9')
    try {
      const { container } = render(<TradeCenter league={LEAGUE} />)
      expect(root(container).getAttribute('data-mobile-step')).toBe('offers')
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })

  it('tags every step-owned section, so the stylesheet can hide the rest', () => {
    const { container } = render(<TradeCenter league={LEAGUE} />)
    fireEvent.click(screen.getByLabelText('Add DK Metcalf'))
    const tag = (sel: string) => container.querySelector(sel)?.closest('[data-mstep]')?.getAttribute('data-mstep')

    expect(container.querySelector('.af-tc-builder')?.getAttribute('data-mstep')).toBe('give get')
    expect(container.querySelectorAll(".af-tc-team[data-mstep='give']")).toHaveLength(1)
    expect(container.querySelectorAll(".af-tc-team[data-mstep='get']")).toHaveLength(1)
    expect(tag('.af-tc-partner')).toBe('get')
    expect(tag('.af-tc-review')).toBe('review')
    expect(tag('.af-tc-actions')).toBe('review')
    expect(tag('.af-tc-balance')).toBe('review')
    // The finder's root reuses `.af-tc-dos`, so it is found through its wrapper, not its class.
    expect(container.querySelector(".af-tc-mstep-wrap[data-mstep='get'] .af-tc-dos")).not.toBeNull()
    // The inbox belongs to Offers. It used to be untagged and so rendered on every building step.
    expect(tag('.af-tc-inbox')).toBe('offers')
    expect(tag('.af-tc-draft')).toBe('offers review')
  })

  it('the league history, passed in, belongs to Offers too — not trailing every step', () => {
    const { container } = render(<TradeCenter league={LEAGUE} history={<section className="history-probe">History</section>} />)
    expect(container.querySelector('.history-probe')?.closest('[data-mstep]')?.getAttribute('data-mstep')).toBe('offers')
  })
})

describe('offers from the inbox', () => {
  it('loading a pending offer lands on Review, where both sides of it are visible', async () => {
    /*
     * ⚠ A DIFFERENT LEAGUE ID ON PURPOSE. `fetchTradesPanel` shares one read per league for 5s at
     * module scope, so reusing 'l1' would hand this test a response another test already cached.
     */
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/api/league/trades-panel')
        ? {
            ok: true,
            status: 200,
            json: async () => ({
              activeTrades: [],
              historyTrades: [],
              pending: { scanned: true, reason: null, platform: 'sleeper', leagueUrl: null, weeksUnanswered: 0 },
              pendingOffers: [
                {
                  transactionId: 'tx-1',
                  direction: 'incoming',
                  partnerName: 'Matt Jones',
                  proposedAt: null,
                  give: [{ playerId: '1', name: 'DK Metcalf', position: 'WR', team: 'PIT', isPick: false, pickYear: null, pickRound: null, faabAmount: null }],
                  get: [{ playerId: '9', name: 'Christian McCaffrey', position: 'RB', team: 'SF', isPick: false, pickYear: null, pickRound: null, faabAmount: null }],
                },
              ],
            }),
          }
        : { ok: false, status: 500, json: async () => ({}) },
    )
    const { container } = render(<TradeCenter league={{ ...LEAGUE, id: 'l2-inbox' }} />)
    const load = await screen.findByText('Load into builder')
    fireEvent.click(load)
    expect(root(container).getAttribute('data-mobile-step')).toBe('review')
    const review = container.querySelector('.af-tc-review')!.textContent
    expect(review).toContain('DK Metcalf')
    expect(review).toContain('Christian McCaffrey')
  })
})

describe('the persistent control', () => {
  /*
   * 2026-09-24: on a building step it points at the side still missing, and analyses once neither
   * is. It used to say "Review trade" on both building steps, which sent a manager to Review only
   * to be told "Add what you get" and sent back — two wasted taps per deal.
   */
  it('on an empty deal it points at the other side, and is not a dead button', () => {
    render(<TradeCenter league={LEAGUE} />)
    expect(primary().textContent).toBe('Next: what you get')
    expect(primary().disabled).toBe(false)
  })

  it('🛑 after adding what you send, it goes to what you GET — not to a Review that sends you back', () => {
    const { container } = render(<TradeCenter league={LEAGUE} />)
    fireEvent.click(screen.getByLabelText('Add DK Metcalf'))
    expect(primary().textContent).toBe('Next: what you get')
    fireEvent.click(primary())
    expect(root(container).getAttribute('data-mobile-step')).toBe('get')
  })

  it('on the step whose side is empty while the other is filled, it says what to add and waits', () => {
    render(<TradeCenter league={LEAGUE} />)
    fireEvent.click(step('Get'))
    chooseMatt()
    fireEvent.click(screen.getByLabelText('Add Christian McCaffrey'))
    fireEvent.click(step('Send'))
    expect(primary().textContent).toBe('Add what you send')
    expect(primary().disabled).toBe(true)
  })

  it('🛑 with both sides filled, one tap from a building step goes to Review AND starts the analysis', async () => {
    const { container } = render(<TradeCenter league={LEAGUE} />)
    fireEvent.click(screen.getByLabelText('Add DK Metcalf'))
    fireEvent.click(step('Get'))
    chooseMatt()
    fireEvent.click(screen.getByLabelText('Add Christian McCaffrey'))
    expect(primary().textContent).toBe('Analyze trade')
    await act(async () => {
      fireEvent.click(primary())
    })
    expect(root(container).getAttribute('data-mobile-step')).toBe('review')
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/trade-value/analyze'))).toBe(true)
  })

  it('🛑 on Review with an empty side, sends you to that side instead of to an analysis that will refuse', () => {
    const { container } = render(<TradeCenter league={LEAGUE} />)
    fireEvent.click(screen.getByLabelText('Add DK Metcalf'))
    fireEvent.click(step('Review'))
    expect(primary().textContent).toBe('Add what you get')
    fireEvent.click(primary())
    expect(root(container).getAttribute('data-mobile-step')).toBe('get')
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/trade-value/analyze'))).toBe(false)
  })

  it('🛑 …and the other way round: only what you GET added sends you to "Send"', () => {
    const { container } = render(<TradeCenter league={LEAGUE} />)
    fireEvent.click(step('Get'))
    chooseMatt()
    fireEvent.click(screen.getByLabelText('Add Christian McCaffrey'))
    fireEvent.click(step('Review'))
    expect(primary().textContent).toBe('Add what you send')
    fireEvent.click(primary())
    expect(root(container).getAttribute('data-mobile-step')).toBe('give')
  })

  it('on Offers it starts a deal, or returns to the one in progress', () => {
    const { container } = render(<TradeCenter league={LEAGUE} />)
    fireEvent.click(step('Offers'))
    expect(primary().textContent).toBe('Build a trade')
    fireEvent.click(primary())
    expect(root(container).getAttribute('data-mobile-step')).toBe('give')
    fireEvent.click(screen.getByLabelText('Add DK Metcalf'))
    fireEvent.click(step('Offers'))
    expect(primary().textContent).toBe('Back to your trade')
  })

  it('analyses from Review once both sides hold something', async () => {
    render(<TradeCenter league={LEAGUE} />)
    fireEvent.click(screen.getByLabelText('Add DK Metcalf'))
    fireEvent.click(step('Get'))
    chooseMatt()
    fireEvent.click(screen.getByLabelText('Add Christian McCaffrey'))
    fireEvent.click(step('Review'))
    expect(primary().textContent).toBe('Analyze trade')
    await act(async () => {
      fireEvent.click(primary())
    })
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/trade-value/analyze'))
    expect(call).toBeTruthy()
    const body = JSON.parse(String((call![1] as RequestInit).body))
    expect(body.sideGive.map((a: { name: string }) => a.name)).toEqual(['DK Metcalf'])
    expect(body.sideGet.map((a: { name: string }) => a.name)).toEqual(['Christian McCaffrey'])
  })
})

/** Both sides filled, partner chosen, analysis answered with `answer`. */
async function analyzedDeal(answer: () => Promise<unknown>) {
  fetchMock.mockImplementation(async (url: string) =>
    String(url).includes('/api/trade-value/analyze')
      ? answer()
      : { ok: false, status: 500, json: async () => ({}) },
  )
  const utils = render(<TradeCenter league={{ ...LEAGUE, id: `l-${Math.random()}` }} />)
  fireEvent.click(screen.getByLabelText('Add DK Metcalf'))
  fireEvent.click(step('Get'))
  chooseMatt()
  fireEvent.click(screen.getByLabelText('Add Christian McCaffrey'))
  await act(async () => {
    fireEvent.click(primary())
  })
  return utils
}

const VERDICT = {
  ok: true,
  status: 200,
  json: async () => ({ percentDiff: 12, fairnessScore: 60, labels: { fairnessLabel: 'Slight win', confidenceLabel: 'Medium' } }),
}

describe('🛑 the verdict always belongs to the deal on screen', () => {
  it('adding an asset after analysing clears the verdict — it described the old deal', async () => {
    // A second player on your roster, so there is something left to add after the analysis.
    const data = rosterData.current as { rosters: Array<{ players: unknown[] }> }
    data.rosters[0]!.players.push(player('p2', 'George Pickens', 4000))
    const { container } = await analyzedDeal(async () => VERDICT)
    expect(container.querySelector('.af-tc-verdict:not(.af-tc-verdict--pending)')).not.toBeNull()
    fireEvent.click(step('Send'))
    fireEvent.click(screen.getByLabelText('Add George Pickens'))
    expect(container.querySelector('.af-tc-verdict:not(.af-tc-verdict--pending)')).toBeNull()
  })

  it('removing an asset clears it too', async () => {
    const { container } = await analyzedDeal(async () => VERDICT)
    fireEvent.click(step('Send'))
    fireEvent.click(container.querySelector<HTMLButtonElement>(".af-tc-team[data-mstep='give'] .af-tc-remove")!)
    expect(container.querySelector('.af-tc-verdict:not(.af-tc-verdict--pending)')).toBeNull()
  })

  it('while the analysis runs, the verdict slot says so instead of sitting empty', async () => {
    const { container } = await analyzedDeal(() => new Promise(() => {}))
    const pending = container.querySelector('.af-tc-verdict--pending')
    expect(pending).not.toBeNull()
    expect(pending!.getAttribute('aria-busy')).toBe('true')
    expect(pending!.getAttribute('data-mstep')).toBe('review')
  })
})

describe('the Offers tab', () => {
  it('badges the number of offers waiting on this manager', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/api/league/trades-panel')
        ? {
            ok: true,
            status: 200,
            json: async () => ({
              activeTrades: [],
              historyTrades: [],
              pending: { scanned: true, reason: null, platform: 'sleeper', leagueUrl: null, weeksUnanswered: 0 },
              pendingOffers: [
                { transactionId: 'in-1', direction: 'incoming', partnerName: 'Matt Jones', proposedAt: null, give: [], get: [] },
                { transactionId: 'out-1', direction: 'outgoing', partnerName: 'Matt Jones', proposedAt: null, give: [], get: [] },
              ],
            }),
          }
        : { ok: false, status: 500, json: async () => ({}) },
    )
    render(<TradeCenter league={{ ...LEAGUE, id: 'l3-badge' }} />)
    // One incoming offer; the outgoing one is not waiting on you.
    await waitFor(() => expect(step('Offers').querySelector('.af-tc-step-count')?.textContent).toBe('1'))
  })
})

describe('sticky totals', () => {
  it('shows priced totals and the signed difference, and an em dash — never 0 — for an empty side', () => {
    const { container } = render(<TradeCenter league={LEAGUE} />)
    const totals = () => container.querySelector('.af-tc-stepbar-totals')!.textContent
    expect(totals()).toBe('Send —Get —')
    fireEvent.click(screen.getByLabelText('Add DK Metcalf'))
    expect(totals()).toBe('Send 5,000Get —')
    chooseMatt()
    fireEvent.click(screen.getByLabelText('Add Christian McCaffrey'))
    expect(totals()).toBe('Send 5,000Get 7,000+2,000')
    expect(container.querySelector('.af-tc-stepbar-delta')?.getAttribute('data-tone')).toBe('good')
  })
})

describe('review summary', () => {
  it('restates both sides with an Edit control per side', () => {
    const { container } = render(<TradeCenter league={LEAGUE} />)
    fireEvent.click(screen.getByLabelText('Add DK Metcalf'))
    const review = container.querySelector('.af-tc-review')!
    expect(review.textContent).toContain('DK Metcalf')
    expect(review.textContent).toContain('5,000')
    const edits = [...review.querySelectorAll<HTMLButtonElement>('.af-tc-review-edit')]
    expect(edits).toHaveLength(2)
    fireEvent.click(step('Review'))
    fireEvent.click(edits[1]!)
    expect(root(container).getAttribute('data-mobile-step')).toBe('get')
  })
})

describe('the asset sheet', () => {
  it('on a phone, opens the picker as a modal sheet on <body>, not inside the card', () => {
    phone.matches = true
    const { container } = render(<TradeCenter league={LEAGUE} />)
    const add = container.querySelector<HTMLButtonElement>(".af-tc-team[data-mstep='give'] .af-tc-add")!
    expect(add.getAttribute('aria-haspopup')).toBe('dialog')
    fireEvent.click(add)

    const sheet = document.body.querySelector('.af-tc-sheet')
    expect(sheet).not.toBeNull()
    expect(container.contains(sheet)).toBe(false)
    expect(sheet!.getAttribute('role')).toBe('dialog')
    expect(sheet!.getAttribute('aria-modal')).toBe('true')
    // The tokens must reach it: the portal wrapper carries both scopes.
    // classList, not className: `toContain('af-tc')` would match inside 'af-tc-sheet-root'.
    const wrapper = sheet!.closest('.af-tc-sheet-root')!
    expect(wrapper.classList.contains('af-core')).toBe(true)
    expect(wrapper.classList.contains('af-tc')).toBe(true)
    // Searchable: the picker's input is inside the sheet, and the button stayed in the card.
    expect(sheet!.querySelector('.af-tc-input')).not.toBeNull()
    expect(container.querySelector('.af-tc-team .af-tc-picker')).toBeNull()
    expect(container.contains(add)).toBe(true)
  })

  it('🛑 Escape closes it and focus returns to the button that opened it', () => {
    /*
     * jsdom lays nothing out, so `getClientRects()` is always empty and the containment hook would
     * treat every element as unfocusable. Connected = visible here; real layout was covered in
     * Chromium and WebKit at 390px, where this same sequence ended on `.af-tc-add`.
     */
    vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
      return (this.isConnected ? [{}] : []) as unknown as DOMRectList
    })
    phone.matches = true
    const { container } = render(<TradeCenter league={LEAGUE} />)
    const add = container.querySelector<HTMLButtonElement>(".af-tc-team[data-mstep='give'] .af-tc-add")!
    add.focus()
    fireEvent.click(add)
    expect(document.body.querySelector('.af-tc-sheet')).not.toBeNull()
    // The picker's autoFocus moved focus into the sheet — the case the hook's own capture misses.
    expect(document.activeElement?.classList.contains('af-tc-input')).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.body.querySelector('.af-tc-sheet')).toBeNull()
    expect(document.activeElement).toBe(add)
  })

  it('picking an asset closes the sheet and adds it to the right side', () => {
    phone.matches = true
    const { container } = render(<TradeCenter league={LEAGUE} />)
    fireEvent.click(container.querySelector<HTMLButtonElement>(".af-tc-team[data-mstep='give'] .af-tc-add")!)
    const sheet = document.body.querySelector('.af-tc-sheet') as HTMLElement
    const row = [...sheet.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.getAttribute('aria-label') === 'Add DK Metcalf',
    )!
    fireEvent.click(row)
    expect(document.body.querySelector('.af-tc-sheet')).toBeNull()
    expect(container.querySelector(".af-tc-team[data-mstep='give'] .af-tc-row-name")?.textContent).toBe('DK Metcalf')
  })

  it("🛑 each side's picker offers its OWN roster's picks, in the sheet as inline", () => {
    /*
     * The picker props were extracted into one `renderPicker(side)` so the inline and sheet
     * placements share them. A slip there offers a manager a pick they do not hold, which the
     * engine only refuses at send — so this is asserted through the rendered picker, not source.
     */
    const pick = (pickId: string, label: string) => ({ pickId, season: 2027, round: 1, label, itemType: 'future_pick', value: 900 })
    const data = rosterData.current as { rosters: Array<{ picks: unknown[] }> }
    data.rosters[0]!.picks = [pick('mine', 'My 2027 1st')]
    data.rosters[1]!.picks = [pick('theirs', 'Their 2027 1st')]
    phone.matches = true
    const { container } = render(<TradeCenter league={LEAGUE} />)
    chooseMatt()

    const openPicks = (side: 'give' | 'get') => {
      fireEvent.click(container.querySelector<HTMLButtonElement>(`.af-tc-team[data-mstep='${side}'] .af-tc-add`)!)
      const sheet = document.body.querySelector('.af-tc-sheet') as HTMLElement
      fireEvent.click([...sheet.querySelectorAll<HTMLButtonElement>('.af-tc-picker-tab')].find((b) => b.textContent === 'Pick')!)
      const text = sheet.textContent ?? ''
      fireEvent.keyDown(document, { key: 'Escape' })
      return text
    }
    const give = openPicks('give')
    expect(give).toContain('My 2027 1st')
    expect(give).not.toContain('Their 2027 1st')
    const get = openPicks('get')
    expect(get).toContain('Their 2027 1st')
    expect(get).not.toContain('My 2027 1st')
  })

  it('on a desktop, keeps the picker inline and opens no sheet', () => {
    phone.matches = false
    const { container } = render(<TradeCenter league={LEAGUE} />)
    const add = container.querySelector<HTMLButtonElement>(".af-tc-team[data-mstep='give'] .af-tc-add")!
    expect(add.getAttribute('aria-haspopup')).toBeNull()
    fireEvent.click(add)
    expect(document.body.querySelector('.af-tc-sheet')).toBeNull()
    expect(container.querySelector(".af-tc-team[data-mstep='give'] .af-tc-picker")).not.toBeNull()
  })
})

describe('stylesheet', () => {
  const CSS = readFileSync(resolve(process.cwd(), 'components/core-app/af-trade-center.css'), 'utf8').replace(/\r\n/g, '\n')
  const tail = CSS.slice(CSS.indexOf('Phone builder: step bar, review, asset sheet'))

  /** The body of the LAST top-level `@media (max-width: 720px)` block, balanced on braces. */
  function lastPhoneBlock(src: string): string {
    const start = src.lastIndexOf('@media (max-width: 720px) {')
    let depth = 0
    for (let i = src.indexOf('{', start); i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1)
    }
    return ''
  }

  it('[control] the scan found the new section and a balanced phone block', () => {
    expect(tail.length).toBeGreaterThan(1000)
    expect(lastPhoneBlock(CSS)).toContain('.af-tc-stepbar')
  })

  it('hides the step bar and summary at every width by default, and keeps the wrappers boxless', () => {
    expect(tail).toMatch(/\.af-tc-stepbar,\n\.af-tc-review,\n\.af-tc-step-anchor \{\n  display: none;/)
    expect(tail).toMatch(/\.af-tc-mstep-wrap,\n\.af-tc-sheet-root \{\n  display: contents;/)
  })

  it('🛑 the step bar sticks to the TOP inside the phone block — the bottom belongs to the shell', () => {
    const block = lastPhoneBlock(CSS)
    /*
     * Below the safe-area inset, not at a bare 6px: in the home-screen app the shell paints a fixed
     * strip over the status bar (z 70), and a bar stuck at 6px slid under it (2026-09-24).
     */
    expect(block).toMatch(/\.af-tc-stepbar \{\n    position: sticky;\n    top: calc\(6px \+ env\(safe-area-inset-top, 0px\)\);/)
    expect(block).not.toMatch(/\.af-tc-stepbar \{[^}]*bottom:/)
  })

  it('hides every section not tagged for the current step, inside the phone block only', () => {
    const block = lastPhoneBlock(CSS)
    for (const s of ['offers', 'give', 'get', 'review']) {
      expect(block).toContain(`.af-tc[data-mobile-step='${s}'] [data-mstep]:not([data-mstep~='${s}'])`)
    }
    // Outside the block, no step hiding exists — so desktop can never lose a section.
    expect(CSS.replace(block, '')).not.toContain('[data-mstep]:not(')
  })

  it('🛑 the action row is no longer sticky to the bottom', () => {
    const rule = CSS.match(/  \.af-tc-actions \{\n([^}]*)\}/)
    expect(rule).not.toBeNull()
    expect(rule![1]).not.toContain('position: sticky')
    expect(rule![1]).not.toContain('bottom: 0')
  })

  it('the primary button out-specifies `.af-core .af-btn` rather than tying with it', () => {
    expect(tail).toContain('.af-core .af-tc-stepbar .af-tc-stepbar-primary {')
  })

  it('the sheet stacks above the shell chrome and below the player card', () => {
    const z = Number(tail.match(/\.af-tc-sheet-scrim \{[^}]*z-index: (\d+)/)?.[1])
    expect(z).toBeGreaterThan(60)
    expect(z).toBeLessThan(1200)
  })
})
