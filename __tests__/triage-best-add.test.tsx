import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'

import { Dash3ATriage, type TriageBookRow } from '@/components/core-app/screens/Dash3ATriage'
import { bestAddCtaText, bestAddFrom, bestAddHref } from '@/components/core-app/screens/TriageBestAdd'
import { fixAllSummary } from '@/components/core-app/screens/Dash3ATriageView'

const NOW = new Date('2026-10-16T13:00:00Z')

function row(over: Partial<TriageBookRow> = {}): TriageBookRow {
  return {
    initials: 'JL',
    name: 'Jeremiyah Love',
    sleeperId: '12500',
    imageUrl: null,
    leagues: [
      { id: 'g26', name: 'Guillotine League 26', platform: 'sleeper', imageUrl: null, slot: 'starter', bench: [{ name: 'Tyler Allgeier', position: 'RB', points: 11.2 }] },
    ],
    note: 'RB · Out',
    position: 'RB',
    team: 'ARI',
    sport: 'NFL',
    status: 'Out',
    exposure: '1 of 61',
    exposureCount: 1,
    exposureTotal: 61,
    startingIn: 1,
    reportedAt: null,
    reportedAgo: null,
    nextKickoffAt: null,
    tone: 'bad',
    ...over,
  }
}

/** The waiver-board asks only — the card's analytics beacon also goes through fetch in jsdom. */
const boardCalls = (m: ReturnType<typeof vi.fn>) =>
  m.mock.calls.map((c) => String((c as unknown[])[0])).filter((u) => u.includes('view=waiver-board'))

const okBoard = (candidates: unknown[]) => vi.fn(async (url: unknown) =>
  String(url).includes('view=waiver-board') ? new Response(JSON.stringify({ state: 'ok', candidates })) : new Response('{}'))

afterEach(() => vi.unstubAllGlobals())

describe('the free-agent button', () => {
  it('reads as the add, with what he is worth to your lineup', () => {
    const add = bestAddFrom({ state: 'ok', candidates: [{ sleeperId: '9493', name: 'Puka Nacua', position: 'WR', gain: 6.14 }] })
    expect(bestAddCtaText(add, 'G26', false)).toBe('Add Puka Nacua (WR, +6.1 pts) in G26')
    expect(bestAddCtaText(add, 'G26', true)).toBe('Añadir a Puka Nacua (WR, +6.1 pts) en G26')
    expect(bestAddHref('/core/waivers?league=g26', add, '12500')).toBe('/core/waivers?league=g26&player=9493&out=12500')
  })

  it('says nobody beats your lineup when the best gain is zero — not a fake add', () => {
    const add = bestAddFrom({ state: 'ok', candidates: [{ name: 'Nobody Useful', position: 'WR', gain: 0 }] })
    expect(add).toEqual({ kind: 'none' })
    expect(bestAddCtaText(add, 'G26', false)).toBe('No free agent beats your lineup in G26')
    expect(bestAddHref('/core/waivers?league=g26', add, '1')).toBe('/core/waivers?league=g26')
  })

  it('stays the plain search when the board could not be built', () => {
    expect(bestAddFrom({ state: 'no_projections', candidates: [] })).toBeNull()
    expect(bestAddCtaText(null, 'G26', false)).toBe('Find free agents in G26')
  })
})

describe('the triage card asks for the best add on demand', () => {
  it('fetches this league with the injured player priced at zero, and upgrades the button', async () => {
    const fetchMock = okBoard([{ sleeperId: '9493', name: 'Puka Nacua', position: 'WR', gain: 6.1 }])
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<Dash3ATriage book={[row()]} now={NOW} />)
    await waitFor(() => expect(container.textContent).toContain('Add Puka Nacua (WR, +6.1 pts) in Guillotine League 26'))
    const url = boardCalls(fetchMock)[0]
    expect(url).toContain('leagueId=g26')
    expect(url).toContain('unavailable=12500')
    const cta = [...container.querySelectorAll('.af-triage-cta')].find((a) => a.textContent?.startsWith('Add '))
    expect(cta?.getAttribute('href')).toBe('/core/waivers?league=g26&player=9493&out=12500')
  })

  it('caps the asks across the whole card, so the home never fans out', async () => {
    const fetchMock = okBoard([])
    vi.stubGlobal('fetch', fetchMock)
    const leagues = Array.from({ length: 6 }, (_, i) => ({ id: `cap${i}`, name: `League ${i}`, platform: 'sleeper', imageUrl: null, slot: 'starter' as const }))
    render(<Dash3ATriage book={[row({ leagues, startingIn: 6 })]} now={NOW} />)
    await waitFor(() => expect(boardCalls(fetchMock).length).toBeGreaterThan(0))
    expect(boardCalls(fetchMock).length).toBe(3)
  })

  it('asks nothing outside the NFL or without an id', () => {
    const fetchMock = okBoard([])
    vi.stubGlobal('fetch', fetchMock)
    render(<Dash3ATriage book={[row({ sport: 'NBA', name: 'A', leagues: [{ id: 'x1', name: 'X', platform: 'sleeper', imageUrl: null, slot: 'starter' }] }), row({ sleeperId: null, name: 'B', leagues: [{ id: 'x2', name: 'Y', platform: 'sleeper', imageUrl: null, slot: 'starter' }] })]} now={NOW} />)
    expect(boardCalls(fetchMock)).toEqual([])
  })
})

describe('the rest of the card', () => {
  it('shows bench cover with this week\'s points, and the chain with what it gains', () => {
    vi.stubGlobal('fetch', okBoard([]))
    const r = row({
      leagues: [
        {
          id: 'g26', name: 'G26', platform: 'sleeper', imageUrl: null, slot: 'starter',
          bench: [{ name: 'Tyler Allgeier', position: 'RB', points: 9 }],
          cover: { move: 'Tony Pollard', toSlot: 'RB', fromSlot: 'FLEX', fill: 'Darnell Washington', fillPoints: 11.4, gain: 2.4 },
        },
      ],
    })
    const { container } = render(<Dash3ATriage book={[r]} now={NOW} />)
    expect(container.textContent).toContain('swap in Tyler Allgeier (9.0) · or move Tony Pollard to RB, start Darnell Washington at FLEX (+2.4 pts)')
  })

  it('hands off to the platform\'s lineup screen where it can', () => {
    vi.stubGlobal('fetch', okBoard([]))
    const r = row({ leagues: [{ id: 'g26', name: 'G26', platform: 'sleeper', imageUrl: null, slot: 'starter', fixHref: 'https://sleeper.com/leagues/1/team' }] })
    const { container } = render(<Dash3ATriage book={[r]} now={NOW} />)
    const fix = container.querySelector('.af-triage-cta--fix')
    expect(fix?.getAttribute('href')).toBe('https://sleeper.com/leagues/1/team')
    expect(fix?.getAttribute('target')).toBe('_blank')
    expect(fix?.textContent).toBe('Set lineup in Sleeper · G26')
  })

  it('adds a Questionable starter as a game-time call with a safe pivot — bounded, after the Out rows', () => {
    vi.stubGlobal('fetch', okBoard([]))
    const kickoff = new Date(NOW.getTime() + 5 * 3600_000).toISOString()
    const q = (name: string) => row({ name, status: 'Questionable', tone: 'warn', nextKickoffAt: kickoff })
    const { container } = render(<Dash3ATriage book={[row(), q('Q One'), q('Q Two'), q('Q Three')]} now={NOW} />)
    const text = container.textContent ?? ''
    expect(text).toContain('safe pivot: Tyler Allgeier (11.2)')
    expect(text).toContain("Game-time call")
    expect(text).toContain('Q Two')
    expect(text).not.toContain('Q Three')
    const names = [...container.querySelectorAll('.af-triage-name')].map((n) => n.textContent)
    expect(names[0]).toContain('Jeremiyah Love')
  })

  it('leaves out a Questionable starter whose game has started', () => {
    vi.stubGlobal('fetch', okBoard([]))
    const past = new Date(NOW.getTime() - 3600_000).toISOString()
    const { container } = render(<Dash3ATriage book={[row({ name: 'Late', status: 'Questionable', tone: 'warn', nextKickoffAt: past })]} now={NOW} />)
    expect(container.textContent ?? '').not.toContain('Late')
  })

  it('sums the whole job in one line', () => {
    const rows = [
      { tone: 'bad', leagues: [{ slot: 'starter', bench: ['A'] }, { slot: 'starter', bench: [] }, { slot: 'bench', bench: [] }] },
    ] as never
    expect(fixAllSummary(rows, false)).toBe('2 lineups to fix · 1 with bench cover · 1 needs a pickup')
  })
})

describe('AF Pro gate (founder decision 2026-10-17)', () => {
  const kickoff = new Date(NOW.getTime() + 5 * 3600_000).toISOString()
  const q = row({ name: 'Q Player', status: 'Questionable', tone: 'warn', nextKickoffAt: kickoff })

  it('without Pro: no best-add lookup, no game-time calls, one upgrade line — swap tips stay free', () => {
    const fetchMock = okBoard([{ sleeperId: '9493', name: 'Puka Nacua', position: 'WR', gain: 6.1 }])
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<Dash3ATriage book={[row(), q]} now={NOW} pro={{ unlocked: false, upgradePath: '/upgrade?plan=pro' }} />)
    expect(boardCalls(fetchMock)).toEqual([])
    const text = container.textContent ?? ''
    expect(text).not.toContain('Q Player')
    expect(text).toContain('swap in Tyler Allgeier (11.2)')
    expect(container.querySelector('.af-triage-upsell')?.getAttribute('href')).toBe('/upgrade?plan=pro')
  })

  it('with Pro, or when the plan could not be read, everything shows', async () => {
    for (const pro of [{ unlocked: true, upgradePath: '/upgrade?plan=pro' }, null]) {
      const fetchMock = okBoard([{ sleeperId: '9493', name: 'Puka Nacua', position: 'WR', gain: 6.1 }])
      vi.stubGlobal('fetch', fetchMock)
      const { container, unmount } = render(<Dash3ATriage book={[row({ leagues: [{ id: `p${pro ? 1 : 2}`, name: 'G', platform: 'sleeper', imageUrl: null, slot: 'starter' }] }), q]} now={NOW} pro={pro} />)
      await waitFor(() => expect(boardCalls(fetchMock).length).toBe(1))
      expect(container.textContent).toContain('Q Player')
      expect(container.querySelector('.af-triage-upsell')).toBeNull()
      unmount()
    }
  })
})
