/**
 * "Available in your leagues": the loader (claim link free, bid AF Pro, DB-first) and the section.
 */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  leagues: [] as Array<{ id: string; name: string; platform: string; platformLeagueId: string | null; season: number }>,
  facts: new Map<string, unknown>(),
  values: new Map<string, Map<string, { value: number; faabAnchor: number | null }>>(),
  room: [] as Array<{ leagueId: string; claims: number; median: number; p75: number }>,
  worldFacts: vi.fn(),
  valueMap: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => h.leagues.filter((l) => where.id.in.includes(l.id))) },
    $queryRaw: vi.fn(async () => h.room),
  },
}))
vi.mock('@/lib/decision-os/waiver/loader', () => ({ loadWaiverWorldFacts: h.worldFacts }))
vi.mock('@/lib/core-app/playerDepth', () => ({ loadLeagueValueMap: h.valueMap }))

import { BID_LEAGUE_CAP, loadFreeAgentBids } from '@/lib/core-app/freeAgentBids'
import { FreeAgentBids } from '@/components/core-app/player-finder/FreeAgentBids'

const faab = (budget: number, remaining: number | null, over: Record<string, unknown> = {}) => ({
  settings: { waiverType: 'faab', normalizedWaiverType: 'faab', faabBudget: budget },
  settingsKnown: true,
  faabRemaining: remaining,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.leagues = [
    { id: 'S1', name: 'KBFL', platform: 'sleeper', platformLeagueId: '1180000000000000000', season: 2026 },
    { id: 'R1', name: 'Rolling League', platform: 'sleeper', platformLeagueId: '1190000000000000000', season: 2026 },
    { id: 'F1', name: 'Flea', platform: 'fleaflicker', platformLeagueId: '206154', season: 2026 },
  ]
  h.facts = new Map<string, unknown>([
    ['S1', faab(100, 40)],
    ['R1', { settings: { waiverType: 'rolling', normalizedWaiverType: 'rolling', faabBudget: 100 }, settingsKnown: true, faabRemaining: null }],
    ['F1', faab(200, 200)],
  ])
  h.values = new Map([
    ['S1', new Map([['9001', { value: 2400, faabAnchor: 3000 }]])],
    ['R1', new Map([['9001', { value: 2400, faabAnchor: 3000 }]])],
    ['F1', new Map([['9001', { value: 2400, faabAnchor: 3000 }]])],
  ])
  h.room = [{ leagueId: 'S1', claims: 48, median: 5, p75: 9 }]
  h.worldFacts.mockImplementation(async (_u: string, id: string) => h.facts.get(id) ?? null)
  h.valueMap.mockImplementation(async (_ids: string[], leagueIds: string[]) => new Map(leagueIds.filter((id) => h.values.has(id)).map((id) => [id, h.values.get(id)!])))
})

const run = (includeBids = true, ids = ['S1', 'R1', 'F1']) =>
  loadFreeAgentBids({ userId: 'u1', sleeperId: '9001', freeLeagueIds: ids, includeBids })

describe('loadFreeAgentBids', () => {
  it('a FAAB league: the market bid capped at what you have left, the room beside it, a verified claim link', async () => {
    const { rows } = await run()
    const s1 = rows.find((r) => r.leagueId === 'S1')!
    // 2,400 / 3,000 of $100 = $80 → capped at 60% = $60 → capped at $40 left.
    expect(s1.bid).toEqual({ amount: 40, budget: 100, remaining: 40 })
    expect(s1.room).toEqual({ claims: 48, median: 5, p75: 9 })
    expect(s1.claim?.href).toContain('sleeper.com/leagues/1180000000000000000')
    expect(s1.note).toBeNull()
  })

  it('🛑 a waiver-priority league gets no bid, even when the settings carry a budget', async () => {
    const r1 = (await run()).rows.find((r) => r.leagueId === 'R1')!
    expect(r1.bid).toBeNull()
    expect(r1.note).toMatch(/waiver-priority/)
  })

  it('🛑 no settings row of its own (defaults only) — no bid', async () => {
    h.facts.set('S1', faab(100, 40, { settingsKnown: false }))
    const s1 = (await run()).rows.find((r) => r.leagueId === 'S1')!
    expect(s1.bid).toBeNull()
    expect(s1.note).toMatch(/not on file/)
  })

  it('a platform with no verified waiver screen gets no claim button — never a homepage', async () => {
    const f1 = (await run()).rows.find((r) => r.leagueId === 'F1')!
    expect(f1.claim).toBeNull()
  })

  it('🛑 a locked viewer gets the leagues and claim links, and NO bid or room — nothing is even computed', async () => {
    const out = await run(false)
    expect(out.bidsLocked).toBe(true)
    expect(out.rows.map((r) => r.bid)).toEqual([null, null, null])
    expect(out.rows.map((r) => r.room)).toEqual([null, null, null])
    expect(out.rows.find((r) => r.leagueId === 'S1')!.claim).not.toBeNull()
    expect(h.worldFacts).not.toHaveBeenCalled()
    expect(h.valueMap).not.toHaveBeenCalled()
  })

  it('bids for the first leagues only; the rest are listed and say why', async () => {
    h.leagues = Array.from({ length: BID_LEAGUE_CAP + 2 }, (_, i) => ({ id: `L${String(i).padStart(2, '0')}`, name: `League ${String(i).padStart(2, '0')}`, platform: 'sleeper', platformLeagueId: `${1180000000000000000 + i}`, season: 2026 }))
    for (const l of h.leagues) {
      h.facts.set(l.id, faab(100, 100))
      h.values.set(l.id, new Map([['9001', { value: 600, faabAnchor: 3000 }]]))
    }
    const { rows } = await run(true, h.leagues.map((l) => l.id))
    expect(rows).toHaveLength(BID_LEAGUE_CAP + 2)
    expect(rows.filter((r) => r.bid).length).toBe(BID_LEAGUE_CAP)
    expect(rows[BID_LEAGUE_CAP]!.note).toMatch(/at a time/)
  })
})

describe('FreeAgentBids section', () => {
  const access = { depth: 'player_depth', unlocked: false, label: 'Player depth', planName: 'AF Pro', preLaunchFree: false, startsAt: '2026-10-15T00:00:00.000Z' } as never

  it('names each league, its bid and the room, with the claim button', async () => {
    const data = await run()
    render(<FreeAgentBids data={data} playerName="Tank Dell" access={null} />)
    expect(screen.getByRole('heading', { name: 'Available in 3 of your leagues' })).toBeInTheDocument()
    expect(screen.getByText(/Bid ~\$40/)).toBeInTheDocument()
    expect(screen.getByText(/median \$5 · p75 \$9 \(48 claims\)/)).toBeInTheDocument()
    const claims = screen.getAllByRole('link', { name: 'Claim Dell in Sleeper' })
    expect(claims).toHaveLength(2) // KBFL and Rolling League; Flea has no verified waiver screen
    expect(claims[0]).toHaveAttribute('target', '_blank')
  })

  it('a locked viewer sees where he is available and the claim links, and the bid behind the lock', async () => {
    const data = await run(false)
    render(<FreeAgentBids data={data} playerName="Tank Dell" access={access} />)
    expect(screen.getAllByRole('link', { name: /Claim Dell in/ }).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Bid ~\$/)).toBeNull()
    expect(screen.getByTestId('core-lock-player_depth')).toBeInTheDocument()
  })
})
