import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

/**
 * The trade builder as a calculator (2026-10-31): both sides on one screen, each led by a labelled
 * total and a search control, a sticky balance bar that grades the deal, and everything that is not
 * the deal folded below it. Replaces the four-step phone flow (Offers / Send / Get / Review).
 *
 * Layout (what is hidden at which width) is CSS; these pin the component contract that layout
 * hangs off, plus the stylesheet rules themselves.
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

const primary = () => document.querySelector('.af-tc-stepbar-primary') as HTMLButtonElement
const chooseMatt = () =>
  fireEvent.click(
    [...document.querySelectorAll<HTMLButtonElement>('.af-tc-partner-chip')].find((b) => b.textContent === 'Matt Jones')!,
  )
const side = (c: HTMLElement, s: 'give' | 'get') => c.querySelector(`.af-tc-team[data-side='${s}']`) as HTMLElement
const analyzeCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/trade-value/analyze'))
/** True when `a` comes before `b` in document order. */
const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('the calculator layout', () => {
  it('shows both sides at once, each led by its label and total, with no step tabs', () => {
    const { container } = render(<TradeCenter league={LEAGUE} />)
    expect(side(container, 'give').querySelector('.af-tc-side-bar')!.textContent).toBe('You send—')
    expect(side(container, 'get').querySelector('.af-tc-side-bar')!.textContent).toBe('You get—')
    expect(container.querySelector('.af-tc-step')).toBeNull()
    expect(container.querySelector('[data-mobile-step]')).toBeNull()
    expect(container.querySelector('[data-mstep]')).toBeNull()
  })

  it('each side adds through a search control, named for whose roster it searches', () => {
    const { container } = render(<TradeCenter league={LEAGUE} />)
    chooseMatt()
    expect(side(container, 'give').querySelector('.af-tc-add')!.textContent).toContain('Search your players, picks or FAAB')
    expect(side(container, 'get').querySelector('.af-tc-add')!.textContent).toContain('Search their players or picks')
  })

  it('🛑 the deal comes first: trade ideas and offers fold BELOW the builder', () => {
    const { container } = render(<TradeCenter league={LEAGUE} />)
    const builder = container.querySelector('.af-tc-builder')!
    const ideas = container.querySelector('details.af-tc-ideas')!
    const offers = container.querySelector('details.af-tc-offers')!
    expect(before(builder, ideas)).toBe(true)
    expect(before(builder, offers)).toBe(true)
    // Closed by default — one line each until opened.
    expect(ideas.hasAttribute('open')).toBe(false)
    expect(offers.hasAttribute('open')).toBe(false)
    // What used to sit above the builder now lives inside the offers fold.
    expect(offers.querySelector('.af-tc-inbox')).not.toBeNull()
    expect(offers.querySelector('.af-tc-legend')).not.toBeNull()
    // The partner chips stay above the builder: the "You get" side is empty until one is chosen.
    expect(before(container.querySelector('.af-tc-partner')!, builder)).toBe(true)
  })

  it('🛑 a trade link (?trade=) opens the offers fold, where that trade is', async () => {
    window.history.replaceState(null, '', '/core/trades?league=l1&trade=tx-9')
    try {
      const { container } = render(<TradeCenter league={LEAGUE} />)
      await waitFor(() => expect(container.querySelector('details.af-tc-offers')!.hasAttribute('open')).toBe(true))
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })

  it('the league history follows the builder', () => {
    const { container } = render(<TradeCenter league={LEAGUE} history={<section className="history-probe">History</section>} />)
    const history = container.querySelector('.history-probe')!
    expect(before(container.querySelector('.af-tc-builder')!, history)).toBe(true)
  })
})

describe('offers from the inbox', () => {
  it('loading a pending offer puts both sides of it in the builder', async () => {
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
    fireEvent.click(await screen.findByText('Load into builder'))
    expect(side(container, 'give').textContent).toContain('DK Metcalf')
    expect(side(container, 'get').textContent).toContain('Christian McCaffrey')
  })

  it('badges the fold with the number of offers waiting on this manager', async () => {
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
    const { container } = render(<TradeCenter league={{ ...LEAGUE, id: 'l3-badge' }} />)
    // One incoming offer; the outgoing one is not waiting on you. Counted while the fold is closed.
    await waitFor(() =>
      expect(container.querySelector('.af-tc-offers > summary .af-tc-fold-badge')?.textContent).toBe('1 waiting on you'),
    )
  })
})

describe('the balance bar button', () => {
  it('on an empty deal it opens the "You get" search, and is not a dead button', () => {
    const { container } = render(<TradeCenter league={LEAGUE} />)
    expect(primary().textContent).toBe('Add what you get')
    expect(primary().disabled).toBe(false)
    fireEvent.click(primary())
    expect(side(container, 'get').querySelector('.af-tc-picker')).not.toBeNull()
  })

  it('🛑 with only what you send added, it asks for what you get — never an analysis that will refuse', () => {
    render(<TradeCenter league={LEAGUE} />)
    fireEvent.click(screen.getByLabelText('Add DK Metcalf'))
    expect(primary().textContent).toBe('Add what you get')
    fireEvent.click(primary())
    expect(analyzeCalls()).toHaveLength(0)
  })

  it('🛑 …and the other way round: only what you GET added opens your own search', () => {
    const { container } = render(<TradeCenter league={LEAGUE} />)
    chooseMatt()
    fireEvent.click(screen.getByLabelText('Add Christian McCaffrey'))
    expect(primary().textContent).toBe('Add what you send')
    fireEvent.click(primary())
    expect(side(container, 'give').querySelector('.af-tc-picker')).not.toBeNull()
    expect(analyzeCalls()).toHaveLength(0)
  })

  it('grades once both sides hold something, sending each side to the right place', async () => {
    render(<TradeCenter league={LEAGUE} />)
    fireEvent.click(screen.getByLabelText('Add DK Metcalf'))
    chooseMatt()
    fireEvent.click(screen.getByLabelText('Add Christian McCaffrey'))
    expect(primary().textContent).toBe('Grade with AF')
    await act(async () => {
      fireEvent.click(primary())
    })
    expect(analyzeCalls()).toHaveLength(1)
    const body = JSON.parse(String((analyzeCalls()[0]![1] as RequestInit).body))
    expect(body.sideGive.map((a: { name: string }) => a.name)).toEqual(['DK Metcalf'])
    expect(body.sideGet.map((a: { name: string }) => a.name)).toEqual(['Christian McCaffrey'])
  })
})

describe('what grading sends', () => {
  it('🛑 never sends the AllFantasy projection to the verdict — it is display only', async () => {
    rosterData.current = {
      rosters: [
        roster('r1', 'You', [{ ...player('p1', 'DK Metcalf', 5000), afProjection: 14.2 }]),
        roster('r2', 'Matt Jones', [{ ...player('p9', 'Christian McCaffrey', 7000), afProjection: 19.8 }]),
      ],
      viewerRosterId: 'r1',
      viewerTeamRosterId: 'r1',
    }
    render(<TradeCenter league={LEAGUE} />)
    fireEvent.click(screen.getByLabelText('Add DK Metcalf'))
    chooseMatt()
    fireEvent.click(screen.getByLabelText('Add Christian McCaffrey'))
    await act(async () => {
      fireEvent.click(primary())
    })
    const raw = String((analyzeCalls()[0]![1] as RequestInit).body)
    // The positive control: the players ARE in the request, so an absent key is a real absence.
    expect(raw).toContain('DK Metcalf')
    expect(raw).not.toContain('afProjection')
    expect(raw).not.toContain('14.2')
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
  it('adding an asset after grading clears the verdict — it described the old deal', async () => {
    // A second player on your roster, so there is something left to add after the analysis.
    const data = rosterData.current as { rosters: Array<{ players: unknown[] }> }
    data.rosters[0]!.players.push(player('p2', 'George Pickens', 4000))
    const { container } = await analyzedDeal(async () => VERDICT)
    expect(container.querySelector('.af-tc-verdict:not(.af-tc-verdict--pending)')).not.toBeNull()
    expect(primary().textContent).toBe('Grade again')
    fireEvent.click(screen.getByLabelText('Add George Pickens'))
    expect(container.querySelector('.af-tc-verdict:not(.af-tc-verdict--pending)')).toBeNull()
  })

  it('removing an asset clears it too', async () => {
    const { container } = await analyzedDeal(async () => VERDICT)
    fireEvent.click(side(container, 'give').querySelector<HTMLButtonElement>('.af-tc-remove')!)
    expect(container.querySelector('.af-tc-verdict:not(.af-tc-verdict--pending)')).toBeNull()
  })

  it('while grading runs, the verdict slot says so and the button cannot fire twice', async () => {
    const { container } = await analyzedDeal(() => new Promise(() => {}))
    const pending = container.querySelector('.af-tc-verdict--pending')
    expect(pending).not.toBeNull()
    expect(pending!.getAttribute('aria-busy')).toBe('true')
    expect(primary().textContent).toBe('Grading…')
    expect(primary().disabled).toBe(true)
  })
})

describe('sticky totals and the meter', () => {
  it('shows priced totals, "You get" first, and an em dash — never 0 — for an empty side', () => {
    const { container } = render(<TradeCenter league={LEAGUE} />)
    const totals = () => container.querySelector('.af-tc-stepbar-totals')!.textContent
    expect(totals()).toBe('Get —Send —')
    fireEvent.click(screen.getByLabelText('Add DK Metcalf'))
    expect(totals()).toBe('Get —Send 5,000')
    chooseMatt()
    fireEvent.click(screen.getByLabelText('Add Christian McCaffrey'))
    expect(totals()).toBe('Get 7,000Send 5,000+2,000')
    expect(container.querySelector('.af-tc-stepbar-delta')?.getAttribute('data-tone')).toBe('good')
  })

  it('draws no meter until both sides are priced — half a comparison is not a lean', () => {
    const { container } = render(<TradeCenter league={LEAGUE} />)
    fireEvent.click(screen.getByLabelText('Add DK Metcalf'))
    expect(container.querySelector('.af-tc-meter')).toBeNull()
  })

  it('fills with the GET share and says which way the deal leans', () => {
    const { container } = render(<TradeCenter league={LEAGUE} />)
    fireEvent.click(screen.getByLabelText('Add DK Metcalf'))
    chooseMatt()
    fireEvent.click(screen.getByLabelText('Add Christian McCaffrey'))
    const meter = container.querySelector('.af-tc-meter')!
    // 7,000 of 12,000 is 58% — past the middle, so in your favour, and 29% apart is not "even".
    expect((meter.querySelector('.af-tc-meter-fill') as HTMLElement).style.width).toBe('58%')
    expect(meter.getAttribute('data-tone')).toBe('good')
    expect(meter.querySelector('.af-tc-meter-label')!.textContent).toBe('Leans your way')
  })

  it('calls a deal within 5% even rather than naming a winner over rounding noise', () => {
    const data = rosterData.current as { rosters: Array<{ players: unknown[] }> }
    data.rosters[1]!.players = [player('p9', 'Christian McCaffrey', 5200)]
    const { container } = render(<TradeCenter league={LEAGUE} />)
    fireEvent.click(screen.getByLabelText('Add DK Metcalf'))
    chooseMatt()
    fireEvent.click(screen.getByLabelText('Add Christian McCaffrey'))
    expect(container.querySelector('.af-tc-meter')!.getAttribute('data-tone')).toBe('even')
    expect(container.querySelector('.af-tc-meter-label')!.textContent).toBe('Even trade')
  })
})

describe('the asset sheet', () => {
  it('on a phone, opens the picker as a modal sheet on <body>, not inside the card', () => {
    phone.matches = true
    const { container } = render(<TradeCenter league={LEAGUE} />)
    const add = side(container, 'give').querySelector<HTMLButtonElement>('.af-tc-add')!
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

  it('🛑 the balance bar button opens the same sheet, and focus returns to it on close', () => {
    vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
      return (this.isConnected ? [{}] : []) as unknown as DOMRectList
    })
    phone.matches = true
    render(<TradeCenter league={LEAGUE} />)
    const button = primary()
    button.focus()
    fireEvent.click(button)
    expect(document.body.querySelector('.af-tc-sheet')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.body.querySelector('.af-tc-sheet')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('🛑 Escape closes it and focus returns to the control that opened it', () => {
    /*
     * jsdom lays nothing out, so `getClientRects()` is always empty and the containment hook would
     * treat every element as unfocusable. Connected = visible here.
     */
    vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
      return (this.isConnected ? [{}] : []) as unknown as DOMRectList
    })
    phone.matches = true
    const { container } = render(<TradeCenter league={LEAGUE} />)
    const add = side(container, 'give').querySelector<HTMLButtonElement>('.af-tc-add')!
    add.focus()
    fireEvent.click(add)
    expect(document.body.querySelector('.af-tc-sheet')).not.toBeNull()
    // The picker's autoFocus moved focus into the sheet's search.
    expect(document.activeElement?.classList.contains('af-tc-input')).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.body.querySelector('.af-tc-sheet')).toBeNull()
    expect(document.activeElement).toBe(add)
  })

  it('picking an asset closes the sheet and adds it to the right side', () => {
    phone.matches = true
    const { container } = render(<TradeCenter league={LEAGUE} />)
    fireEvent.click(side(container, 'give').querySelector<HTMLButtonElement>('.af-tc-add')!)
    const sheet = document.body.querySelector('.af-tc-sheet') as HTMLElement
    const row = [...sheet.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.getAttribute('aria-label') === 'Add DK Metcalf',
    )!
    fireEvent.click(row)
    expect(document.body.querySelector('.af-tc-sheet')).toBeNull()
    expect(side(container, 'give').querySelector('.af-tc-row-name')?.textContent).toBe('DK Metcalf')
  })

  it("🛑 each side's picker offers its OWN roster's picks", () => {
    const pick = (pickId: string, label: string) => ({ pickId, season: 2027, round: 1, label, itemType: 'future_pick', value: 900 })
    const data = rosterData.current as { rosters: Array<{ picks: unknown[] }> }
    data.rosters[0]!.picks = [pick('mine', 'My 2027 1st')]
    data.rosters[1]!.picks = [pick('theirs', 'Their 2027 1st')]
    phone.matches = true
    const { container } = render(<TradeCenter league={LEAGUE} />)
    chooseMatt()

    const openPicks = (s: 'give' | 'get') => {
      fireEvent.click(side(container, s).querySelector<HTMLButtonElement>('.af-tc-add')!)
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
    const add = side(container, 'give').querySelector<HTMLButtonElement>('.af-tc-add')!
    expect(add.getAttribute('aria-haspopup')).toBeNull()
    fireEvent.click(add)
    expect(document.body.querySelector('.af-tc-sheet')).toBeNull()
    expect(side(container, 'give').querySelector('.af-tc-picker')).not.toBeNull()
  })
})

describe('stylesheet', () => {
  const CSS = readFileSync(resolve(process.cwd(), 'components/core-app/af-trade-center.css'), 'utf8').replace(/\r\n/g, '\n')
  const tail = CSS.slice(CSS.indexOf('Phone builder: balance bar, asset sheet'))

  /** The body of the top-level `@media (max-width: 720px)` block that contains `needle`, balanced on braces. */
  function phoneBlockWith(src: string, needle: string): string {
    let from = src.length
    for (;;) {
      const start = src.lastIndexOf('@media (max-width: 720px) {', from)
      if (start < 0) return ''
      let depth = 0
      for (let i = src.indexOf('{', start); i < src.length; i++) {
        if (src[i] === '{') depth++
        else if (src[i] === '}' && --depth === 0) {
          const block = src.slice(start, i + 1)
          if (block.includes(needle)) return block
          break
        }
      }
      from = start - 1
    }
  }

  it('[control] the scan found the section and a balanced phone block holding the bar', () => {
    expect(tail.length).toBeGreaterThan(1000)
    expect(phoneBlockWith(CSS, '.af-tc-stepbar {')).toContain('position: sticky')
  })

  it('hides the balance bar at every width by default, and keeps the wrappers boxless', () => {
    expect(tail).toMatch(/\.af-tc-stepbar,\n\.af-tc-step-anchor \{\n  display: none;/)
    expect(tail).toMatch(/\.af-tc-mstep-wrap,\n\.af-tc-sheet-root \{\n  display: contents;/)
  })

  it('🛑 `.af-tc-review` is not hidden: it is the send panel\'s review box, not a phone summary', () => {
    expect(CSS).not.toMatch(/\.af-tc-review,\n[^{]*\{\n  display: none;/)
  })

  it('🛑 the balance bar sticks to the TOP inside the phone block — the bottom belongs to the shell', () => {
    const block = phoneBlockWith(CSS, '.af-tc-stepbar {')
    /*
     * Below the safe-area inset, not at a bare 6px: in the home-screen app the shell paints a fixed
     * strip over the status bar (z 70), and a bar stuck at 6px slid under it (2026-09-24).
     */
    expect(block).toMatch(/\.af-tc-stepbar \{\n    position: sticky;\n    top: calc\(6px \+ env\(safe-area-inset-top, 0px\)\);/)
    expect(block).not.toMatch(/\.af-tc-stepbar \{[^}]*bottom:/)
  })

  it('no per-step hiding survives the steps', () => {
    expect(CSS).not.toContain('data-mobile-step')
    expect(CSS).not.toContain('[data-mstep]')
  })

  it('on a phone, "You get" is ordered above "You send"', () => {
    expect(phoneBlockWith(CSS, "[data-side='get']")).toMatch(/\.af-tc-builder \.af-tc-team\[data-side='get'\] \{\n    order: -1;/)
  })

  it('🛑 the action row is not sticky to the bottom', () => {
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
