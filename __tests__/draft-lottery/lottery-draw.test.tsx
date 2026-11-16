/**
 * Draft lottery page (2026-11-15 redesign): odds, pick-by-pick reveal, final order, lock-in.
 * Only the commissioner can run or lock (the run route 403s everyone else).
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LotteryDraw } from '@/components/draft/LotteryDraw'

const eligible = [
  { rosterId: 'rz', displayName: 'Red Zone Rebels', rank: 7, wins: 7, losses: 7, oddsPercent: 15, weight: 1 },
  { rosterId: 'tp', displayName: 'Two-Point Try', rank: 10, wins: 3, losses: 11, oddsPercent: 35, weight: 4 },
  { rosterId: 'pp', displayName: 'Pocket Passers', rank: 8, wins: 5, losses: 9, oddsPercent: 20, weight: 2 },
  { rosterId: 'sf', displayName: 'Sunday Funday', rank: 9, wins: 4, losses: 10, oddsPercent: 30, weight: 3 },
]
const result = {
  lotteryDraws: [
    { pickSlot: 1, rosterId: 'pp', displayName: 'Pocket Passers', originalOrder: 3 },
    { pickSlot: 2, rosterId: 'tp', displayName: 'Two-Point Try', originalOrder: 1 },
    { pickSlot: 3, rosterId: 'sf', displayName: 'Sunday Funday', originalOrder: 2 },
    { pickSlot: 4, rosterId: 'rz', displayName: 'Red Zone Rebels', originalOrder: 4 },
  ],
  slotOrder: [
    { slot: 1, rosterId: 'pp', displayName: 'Pocket Passers' },
    { slot: 2, rosterId: 'tp', displayName: 'Two-Point Try' },
    { slot: 3, rosterId: 'sf', displayName: 'Sunday Funday' },
    { slot: 4, rosterId: 'rz', displayName: 'Red Zone Rebels' },
    { slot: 5, rosterId: 'ez', displayName: 'End Zone Elite' },
    { slot: 6, rosterId: 'gk', displayName: 'Gridiron Kings' },
  ],
  seed: 'lottery-seed-abc123',
  runAt: '2026-11-15T20:24:00.000Z',
}

function mockApi(opts: { locked?: boolean; runOk?: boolean } = {}) {
  const posts: Array<Record<string, unknown>> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      posts.push(body)
      if (opts.runOk === false) return new Response('{"error":"nope"}', { status: 400 })
      return new Response(JSON.stringify(result), { status: 200 })
    }
    return new Response(JSON.stringify({
      ok: true,
      state: { leagueName: 'Sunday League', currentUserRosterId: 'pp', teamCount: 6, slotOrder: [] },
      lotteryPreview: { eligible, playoffTeamCount: 2 },
      lottery: { pickCount: 4, locked: Boolean(opts.locked), lastResult: opts.locked ? result : null },
    }), { status: 200 })
  }))
  return posts
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('LotteryDraw', () => {
  it('shows members the odds, worst record first, and no button they cannot use', async () => {
    mockApi()
    render(<LotteryDraw draftId="d1" />)
    const odds = await screen.findByTestId('lottery-odds')
    const rows = within(odds).getAllByRole('listitem')
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'lottery-odds-row-tp', 'lottery-odds-row-sf', 'lottery-odds-row-pp', 'lottery-odds-row-rz',
    ])
    expect(screen.getByTestId('lottery-odds-row-pp')).toHaveTextContent('Pocket Passers· you')
    expect(screen.getByText(/These 4 teams are drawn for picks 1–4/)).toHaveTextContent('Picks 5–6 follow the standings.')
    expect(screen.getByTestId('lottery-waiting')).toBeInTheDocument()
    expect(screen.queryByTestId('lottery-run-button')).toBeNull()
  })

  it('lets the commissioner reveal pick by pick, last pick first, then lock the same draw in', async () => {
    const posts = mockApi()
    render(<LotteryDraw draftId="d1" isCommissioner />)
    fireEvent.click(await screen.findByTestId('lottery-run-button'))

    expect(await screen.findByTestId('lottery-reveal-team')).toHaveTextContent('Red Zone Rebels')
    expect(screen.getByTestId('lottery-reveal-stage')).toHaveTextContent('PICK 4')
    expect(screen.getByTestId('lottery-still-in')).toHaveTextContent('Still in for picks 1–3')
    expect(posts[0]).toEqual({ finalize: false })

    fireEvent.click(screen.getByTestId('lottery-reveal-next')) // pick 3
    expect(screen.getByTestId('lottery-reveal-team')).toHaveTextContent('Sunday Funday')
    expect(screen.getByTestId('lottery-reveal-stage')).toHaveTextContent('Record had them at pick 2 · down 1')
    fireEvent.click(screen.getByTestId('lottery-reveal-next')) // pick 2
    expect(screen.getByTestId('lottery-still-in')).toHaveTextContent('You’re getting the No. 1 pick.')
    fireEvent.click(screen.getByTestId('lottery-reveal-next')) // pick 1
    expect(screen.getByTestId('lottery-reveal-team')).toHaveTextContent('Pocket Passers')
    expect(screen.getByTestId('lottery-reveal-next')).toHaveTextContent('See the full order')
    fireEvent.click(screen.getByTestId('lottery-reveal-next'))

    expect(screen.getByTestId('lottery-order-row-1')).toHaveTextContent('↑ 2 · from 3rd')
    expect(screen.getByTestId('lottery-order-row-2')).toHaveTextContent('↓ 1 · from 1st')
    expect(screen.getByTestId('lottery-order-row-5')).toHaveTextContent('End Zone Elite')
    expect(screen.getByTestId('lottery-you')).toHaveTextContent('You got the No. 1 pick')
    expect(screen.getByTestId('lottery-you')).toHaveTextContent('Up from 3rd, on 20% odds.')

    fireEvent.click(screen.getByTestId('lottery-lock-button'))
    await waitFor(() => expect(screen.getByTestId('lottery-locked')).toBeInTheDocument())
    expect(posts[1]).toEqual({ finalize: true, seed: 'lottery-seed-abc123' })
    expect(screen.getByTestId('lottery-open-board')).toHaveAttribute('href', '/drafts/d1')
    expect(screen.queryByTestId('lottery-lock-button')).toBeNull()
  })

  it('can show the whole order at once', async () => {
    mockApi()
    render(<LotteryDraw draftId="d1" isCommissioner />)
    fireEvent.click(await screen.findByTestId('lottery-reveal-mode-all'))
    fireEvent.click(screen.getByTestId('lottery-run-button'))
    expect(await screen.findByTestId('lottery-order')).toBeInTheDocument()
    expect(screen.queryByTestId('lottery-reveal-stage')).toBeNull()
  })

  it('shows a locked order on a revisit instead of offering to run it again', async () => {
    mockApi({ locked: true })
    render(<LotteryDraw draftId="d1" isCommissioner />)
    expect(await screen.findByTestId('lottery-locked')).toBeInTheDocument()
    expect(screen.queryByTestId('lottery-run-button')).toBeNull()
    expect(screen.queryByTestId('lottery-lock-button')).toBeNull()
  })

  it('says so when the draw fails', async () => {
    mockApi({ runOk: false })
    render(<LotteryDraw draftId="d1" isCommissioner />)
    fireEvent.click(await screen.findByTestId('lottery-run-button'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t run the lottery')
    expect(screen.getByTestId('lottery-odds')).toBeInTheDocument()
  })
})
