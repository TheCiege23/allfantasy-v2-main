import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { __resetTradesPanelShare } from '@/components/core-app/screens/tradesPanelFetch'

/**
 * Item #5 on the real Trade Center: an asset with no value says WHY, and never shows a 0.
 *
 * Drives the real component. The rosters hook is mocked to supply data (its enablement has its own
 * test in roster-list-on-screen); `fetch` answers the draft restore and the analysis.
 */

const rosterData = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('@/components/core-app/screens/useLeagueRosters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/core-app/screens/useLeagueRosters')>()
  return { ...actual, useLeagueRosters: () => ({ data: rosterData.current, state: 'idle' }) }
})

import { TradeCenter } from '@/components/core-app/screens/TradeCenter'

const LEAGUE = { id: 'l1', name: 'Draft Junkies', format: 'Dynasty · PPR', teamCount: 12 }

const DEFENDER_REASON = { code: 'defender', label: "Our value feed doesn't price defenders" }

function player(id: string, name: string, position: string, value: number | null, extra: Record<string, unknown> = {}) {
  return { id, name, position, team: 'SF', value, imageUrl: null, byeWeek: null, injuryStatus: null, stock: null, stockDelta: null, ...extra }
}

function roster(rosterId: string, ownerName: string, players: unknown[]) {
  return {
    rosterId, platformUserId: `u-${rosterId}`, players, picks: [], teamExternalId: `t-${rosterId}`,
    ownerName, avatarUrl: null, wins: 0, losses: 0, ties: 0, faabRemaining: null,
  }
}

/** The draft the account returns, built the way the builder stores assets. */
const DRAFT = {
  give: [
    // A roster row that carried no reason (an older server, or a counter rebuilt by name).
    { kind: 'player', playerId: 'PHI', name: 'Philadelphia Eagles', position: 'DEF', team: 'PHI', value: null },
    { kind: 'faab', amount: 10 },
  ],
  get: [
    { kind: 'player', playerId: 'p1', name: 'DK Metcalf', position: 'WR', team: 'PIT', value: 1976 },
    // Picked off a roster with no round: the picker defaulted the round to 1.
    {
      kind: 'pick', year: 2027, round: 1, label: '2027 pick', pickId: 'pk-none', value: null,
      unpricedReason: { code: 'pick_without_round', label: 'No round on file, so the pick curve cannot place it' },
    },
  ],
}

/** What the analysis sends back for that deal. */
const ANALYSIS = {
  fairnessScore: 40,
  confidenceScore: 30,
  players: {
    give: [
      {
        name: 'Philadelphia Eagles', position: 'UNKNOWN', sport: 'NFL', marketValue: 0, pricedSource: 'unknown',
        unpriced: true, unpricedReason: { code: 'no_value_on_file', label: 'No feed, historical or draft value on file' },
      },
      { name: 'FAAB $10', position: 'FAAB', sport: 'NFL', marketValue: 180, pricedSource: 'faab' },
    ],
    get: [{ name: 'DK Metcalf', position: 'WR', sport: 'NFL', marketValue: 2004, pricedSource: 'fantasycalc' }],
  },
}

let original: typeof fetch
beforeEach(() => {
  __resetTradesPanelShare()
  rosterData.current = {
    rosters: [
      roster('r1', 'You', [
        player('p7', 'Brock Purdy', 'QB', 5100),
        player('lb1', 'Fred Warner', 'LB', null, { unpricedReason: DEFENDER_REASON }),
      ]),
      roster('r2', 'Matt Jones', [player('p1', 'DK Metcalf', 'WR', 1976)]),
    ],
    viewerRosterId: 'r1',
    viewerTeamRosterId: 'r1',
  }
  original = globalThis.fetch
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    const body =
      u.startsWith('/api/league/trades-panel') && (!init || !init.method || init.method === 'GET')
        ? { draft: { payload: DRAFT } }
        : u === '/api/trade-value/analyze'
          ? ANALYSIS
          : {}
    return { ok: true, json: async () => body } as Response
  }) as unknown as typeof fetch
})
afterEach(() => {
  globalThis.fetch = original
})

/** A row IN THE DEAL — not the roster list, whose rows are buttons. */
function dealRow(name: string): HTMLElement {
  const rows = [...document.querySelectorAll<HTMLElement>('div.af-tc-row[data-kind]')]
  const row = rows.find((r) => r.querySelector('.af-tc-row-name')?.textContent === name)
  if (!row) throw new Error(`no deal row for ${name}`)
  return row
}
const valueOf = (row: HTMLElement) => row.querySelector('.af-tc-row-value')?.textContent

async function restore() {
  fireEvent.click(screen.getByText('Restore draft'))
  await waitFor(() => expect(dealRow('Philadelphia Eagles')).toBeTruthy())
}

describe('🛑 a player added from the roster says why he has no value', () => {
  it('shows the tag AND the reason, and counts him as unpriced', () => {
    render(<TradeCenter league={LEAGUE} />)
    fireEvent.click(screen.getByLabelText('Add Fred Warner'))
    const row = dealRow('Fred Warner')
    expect(row.textContent).toContain('Unpriced')
    expect(row.textContent).toContain("Our value feed doesn't price defenders")
    expect(valueOf(row)).toBe('—')
    expect(document.body.textContent).toContain('1 unpriced')
  })

  it('[control] a priced player shows his value and no reason', () => {
    render(<TradeCenter league={LEAGUE} />)
    fireEvent.click(screen.getByLabelText('Add Brock Purdy'))
    const row = dealRow('Brock Purdy')
    expect(valueOf(row)).toBe((5100).toLocaleString())
    expect(row.querySelector('.af-tc-unpriced-why')).toBeNull()
    expect(row.textContent).not.toContain('Unpriced')
  })

  it('the roster list carries the reason on the dash, for a tooltip and a screen reader', () => {
    render(<TradeCenter league={LEAGUE} />)
    const listRow = screen.getByLabelText('Add Fred Warner')
    const dash = listRow.querySelector('[data-unpriced="true"]')
    expect(dash?.getAttribute('title')).toBe("No value: Our value feed doesn't price defenders")
  })
})

describe('before Analyze', () => {
  it('FAAB and a player carried in without a lookup say the analysis will price them', async () => {
    render(<TradeCenter league={LEAGUE} />)
    await restore()
    expect(dealRow('$10 FAAB').textContent).toContain('Priced when you analyze the trade')
    expect(dealRow('Philadelphia Eagles').textContent).toContain('Priced when you analyze the trade')
  })

  it('⚠ FAAB is not tagged "Unpriced" — it is waiting, not missing', async () => {
    render(<TradeCenter league={LEAGUE} />)
    await restore()
    expect(dealRow('$10 FAAB').querySelector('.af-tc-tag')).toBeNull()
    expect(valueOf(dealRow('$10 FAAB'))).toBe('—')
  })

  it('🛑 a pick the route could not place stays unpriced — not a first-rounder', async () => {
    /*
     * The picker defaults a missing round to 1. Pricing that default showed a pick with no round
     * at a full first-round value.
     */
    render(<TradeCenter league={LEAGUE} />)
    await restore()
    const row = dealRow('2027 pick')
    expect(valueOf(row)).toBe('—')
    expect(row.textContent).toContain('No round on file')
    expect(row.textContent).toContain('Unpriced')
  })
})

describe('🛑 after Analyze', () => {
  async function analyzed() {
    render(<TradeCenter league={LEAGUE} />)
    await restore()
    fireEvent.click(screen.getByText('Analyze this trade'))
    await waitFor(() => expect(valueOf(dealRow('DK Metcalf'))).toBe((2004).toLocaleString()))
  }

  it('🛑 an engine line flagged unpriced shows a dash, never its placeholder 0', async () => {
    await analyzed()
    const row = dealRow('Philadelphia Eagles')
    expect(valueOf(row)).toBe('—')
    expect(valueOf(row)).not.toBe('0')
    expect(row.textContent).toContain('Unpriced')
  })

  it('explains it from the asset\'s own position, not the engine\'s "UNKNOWN"', async () => {
    await analyzed()
    expect(dealRow('Philadelphia Eagles').textContent).toContain("Our value feed doesn't price team defenses")
  })

  it('🛑 FAAB shows the price the analysis gave it (user decision, 2026-09-16)', async () => {
    // The analysis names the line `FAAB $10`; the builder labels it `$10 FAAB`. Nothing matched.
    await analyzed()
    const row = dealRow('$10 FAAB')
    expect(valueOf(row)).toBe('180')
    expect(row.querySelector('.af-tc-unpriced-why')).toBeNull()
  })

  it('counts only the unpriced defense on its side now that FAAB is priced', async () => {
    await analyzed()
    const notes = [...document.querySelectorAll('.af-tc-builder .af-tc-total-note')].map((n) => n.textContent)
    // Give side: the Eagles (the engine found nothing). Before this change the Eagles read "0" and
    // were not counted, while the FAAB line was.
    expect(notes).toContain(' · 1 unpriced')
  })

  it('the side total includes the FAAB value the verdict used', async () => {
    await analyzed()
    const totals = [...document.querySelectorAll('.af-tc-builder .af-tc-total b')].map((b) => b.textContent)
    expect(totals).toContain((180).toLocaleString())
  })
})

describe('🛑 a pick with no round is left out of the VERDICT, not only the row', () => {
  /*
   * The picker builds every pick with a round (`round: p.round ?? 1`), and the analysis request used
   * to carry that default — so the verdict valued a pick with no round as a first-rounder while
   * its row said "Unpriced".
   */
  type Body = { sideGive: Array<{ kind: string; round?: number }>; sideGet: Array<{ kind: string; round?: number }> }
  const analyzeBodies = (): Body[] =>
    (globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit | undefined]> } }).mock.calls
      .filter(([u]) => String(u) === '/api/trade-value/analyze')
      .map(([, init]) => JSON.parse(String(init?.body)) as Body)
  const draft = DRAFT as unknown as { get: unknown[] }

  it('does not send it to the analysis', async () => {
    render(<TradeCenter league={LEAGUE} />)
    await restore()
    fireEvent.click(screen.getByText('Analyze this trade'))
    await waitFor(() => expect(analyzeBodies()).toHaveLength(1))
    const body = analyzeBodies()[0]!
    expect(body.sideGet).toEqual([{ kind: 'player', playerId: 'p1', name: 'DK Metcalf' }])
    // [control] the rest of the deal goes through untouched.
    expect(body.sideGive.map((a) => a.kind)).toEqual(['player', 'faab'])
  })

  it('[control] a pick whose round is known IS sent', async () => {
    const saved = draft.get
    draft.get = [saved[0], { kind: 'pick', year: 2027, round: 2, label: '2027 2nd', pickId: 'pk-2', value: 900 }]
    try {
      render(<TradeCenter league={LEAGUE} />)
      await restore()
      fireEvent.click(screen.getByText('Analyze this trade'))
      await waitFor(() => expect(analyzeBodies()).toHaveLength(1))
      expect(analyzeBodies()[0]!.sideGet.some((a) => a.kind === 'pick' && a.round === 2)).toBe(true)
    } finally {
      draft.get = saved
    }
  })

  it('says on the row that the verdict leaves it out', async () => {
    render(<TradeCenter league={LEAGUE} />)
    await restore()
    expect(dealRow('2027 pick').textContent).toContain('left out of the verdict')
  })

  it('a side holding only such a pick is explained, and nothing is sent', async () => {
    const saved = draft.get
    draft.get = [saved[1]]
    try {
      render(<TradeCenter league={LEAGUE} />)
      await restore()
      fireEvent.click(screen.getByText('Analyze this trade'))
      await waitFor(() =>
        expect(document.body.textContent).toContain('Nothing on one side can be valued'),
      )
      expect(analyzeBodies()).toHaveLength(0)
    } finally {
      draft.get = saved
    }
  })
})
