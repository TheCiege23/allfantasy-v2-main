// @vitest-environment jsdom
/**
 * Pirate after the 2026-11-24 visual audit (DB-free harness at /e2e/pirate-league/*):
 * 1. After the lock the deck still said "Lock your players · lock up to 3" over tappable rows and "Locks close"
 *    beside a time already past.
 * 2. The commissioner's review sat open on the commissioner's OWN claim, between "Send claim" and the lock list;
 *    a score-change reversal form filled a steal card.
 * 3. One thing, several words: lock / protect / unprotected, "ask for a player back" / "Send counteroffer".
 * 4. Over the roster limit: a grey paragraph and no way to act.
 * 5. Each rule said two or three times; "Open claims 0" above "No open claims".
 * 6. Three stat tiles stacked full width on a phone before anything you can do.
 * 7. A cancelled claim was only in the commissioner's card; members never saw why.
 * 8. Rules page: "(hours)" in every label, "Allowed: 1–72", "Protected players".
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/league/L',
  useSearchParams: () => new URLSearchParams(),
}))

import { PirateHome } from '@/components/pirate/PirateHome'
import { PirateRulesEditor } from '@/components/league-settings/home/PirateRulesEditor'

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8')
const pl = (id: string, name: string, pos: string, slot: string) => ({ id, playerId: id, playerName: name, position: pos, team: 'X', slotType: slot })
const ROSTERS = [
  { id: 'me', ownerId: 'u1', ownerName: 'You', teamName: 'Black Pearl Ballers', players: [pl('p1', 'Josh Allen', 'QB', 'starter'), pl('p2', 'Garrett Wilson', 'WR', 'starter'), pl('p3', 'Christian Watson', 'WR', 'ir'), pl('p4', 'Jaylen Waddle', 'WR', 'bench')] },
  { id: 'rival', ownerId: 'u2', ownerName: 'Morgan', teamName: 'Davy Jones Lockers', players: [pl('q1', 'Lamar Jackson', 'QB', 'starter'), pl('q7', 'DK Metcalf', 'WR', 'bench')] },
  { id: 'other', ownerId: 'u3', ownerName: 'Sam', teamName: 'Jolly Rogers', players: [pl('o1', 'Jalen Hurts', 'QB', 'starter')] },
]
const claim = (over: Record<string, unknown>) => ({
  id: 'c', week: 6, winnerRosterId: 'me', loserRosterId: 'rival', playerId: null, offeredPlayerId: null, counterPlayerId: null, status: 'awaiting_selection',
  deadlineAt: null, selectionDeadlineAt: '2026-11-24T20:00:00Z', overflowGraceUntil: null, transferredAt: null, resolutionNote: null, scoreCorrectionNeedsReversal: false, ...over,
})
function data(claims: unknown[], extra: Record<string, unknown> = {}) {
  return {
    league: { id: 'L', name: 'Plunder Bay', sport: 'NFL', rosterLimit: 10 },
    rules: { protectionLimit: 3, claimHours: 24, selectionHours: 24, overflowGraceHours: 24, playoffClaims: false },
    season: { playoffStartWeek: 15 }, week: 7, lockAt: '2026-11-26T18:00:00Z', canEditProtections: true, myRosterId: 'me',
    rosters: ROSTERS, protections: [{ rosterId: 'me', week: 7, playerIds: ['p1'], status: 'active', voidReason: null }],
    lineupRulings: [], lineupPreviews: {}, lineupEvidence: {}, claims, ...extra,
  }
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function deck(payload: unknown, commissioner = true) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }))
  const { container } = render(<PirateHome leagueId="L" isCommissioner={commissioner} />)
  await screen.findByTestId('pirate-protection-deck')
  return container
}

describe('1. After the lock, a record — not an invitation', () => {
  it('"Your locks this week", only the locked players, nothing to tap, "Locks closed"', async () => {
    await deck(data([], { canEditProtections: false, lockAt: '2026-11-22T18:00:00Z' }))
    const deckEl = screen.getByTestId('pirate-protection-deck')
    expect(within(deckEl).getByRole('heading').textContent).toBe('Your locks this week')
    expect(deckEl.textContent).not.toMatch(/Lock up to|unused locks/)
    expect(deckEl.querySelectorAll('button')).toHaveLength(0)
    expect(screen.getByTestId('pirate-locked-p1')).toBeTruthy()
    expect(screen.queryByTestId('pirate-locked-p2')).toBeNull()
    expect(screen.getByTestId('pirate-stats').textContent).toMatch(/Locks closed/)
  })
  it('before the lock it is still the picker', async () => {
    await deck(data([]))
    expect(within(screen.getByTestId('pirate-protection-deck')).getByRole('heading').textContent).toBe('Lock your players')
    expect(screen.getAllByRole('button', { name: /^(Lock|Unlock) / }).length).toBe(4)
  })
})

describe('2. Commissioner tools stay out of the way', () => {
  it('folded on the commissioner’s own flagged claim, with a "needs a look" summary', async () => {
    await deck(data([claim({})], { lineupPreviews: { c: { issues: ['TE slot empty at lock'], reason: 'No tight end started.' } } }))
    const review = screen.getByTestId('pirate-commish-review-c') as HTMLDetailsElement
    expect(review.open).toBe(false)
    expect(review.querySelector('summary')?.textContent).toMatch(/needs a look/)
  })
  it('a score-change reversal is folded behind one line on the steal card', async () => {
    await deck(data([claim({ status: 'transferred', playerId: 'q7', scoreCorrectionNeedsReversal: true })]))
    const rev = screen.getByTestId('pirate-reversal-c') as HTMLDetailsElement
    expect(rev.tagName).toBe('DETAILS')
    expect(rev.open).toBe(false)
  })
})

describe('3. One word for one thing', () => {
  it('the deck says lock and "ask for a player back" throughout', async () => {
    const el = await deck(data([claim({ winnerRosterId: 'other', loserRosterId: 'me', status: 'pending', playerId: 'p2', deadlineAt: '2026-11-25T20:00:00Z' })]))
    expect(el.textContent).not.toMatch(/protect|counteroffer|Accept counter/i)
    expect(screen.getByRole('button', { name: 'Ask for this player' })).toBeTruthy()
  })
  it('the rules page uses the deck’s words', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rules: data([]).rules }) }))
    const { container } = render(<PirateRulesEditor leagueId="L" />)
    await screen.findByLabelText('Locks per team')
    expect(container.textContent).not.toMatch(/protect|unprotected|counter/i)
  })
})

describe('4. Over the roster limit: a warning with the way out', () => {
  it('says the count once and links to My team', async () => {
    const big = ROSTERS.map((r) => r.id === 'me' ? { ...r, players: [...r.players, ...Array.from({ length: 7 }, (_, i) => pl(`x${i}`, `Extra ${i}`, 'RB', 'bench'))] } : r)
    await deck(data([], { rosters: big }))
    const note = screen.getByTestId('pirate-roster-overflow')
    expect(note.textContent).toMatch(/You have 11 players and room for 10\. Free 1 spot/)
    expect(within(note).getByRole('link', { name: 'Free a spot' }).getAttribute('href')).toBe('/league/L?tab=roster')
    expect(note.className).toMatch(/pr-alert/)
  })
})

describe('5–6. Each rule once; two tiles, two to a row', () => {
  it('no "Open claims" tile; the lock limit is said in one place; tiles sit two to a row on a phone', async () => {
    const el = await deck(data([]))
    const stats = screen.getByTestId('pirate-stats')
    expect(stats.className.split(/\s+/)).toContain('grid-cols-2')
    expect(stats.children).toHaveLength(2)
    expect(el.textContent).not.toMatch(/Open claims/)
    expect(el.textContent?.match(/\b3 locks per team|Lock up to 3/g) ?? []).toEqual([])
    expect(el.textContent).toMatch(/1 of 3/)
  })
})

describe('7. Everyone sees a cancelled claim', () => {
  it('a member sees why a claim was cancelled', async () => {
    await deck(data([claim({ status: 'void', resolutionNote: 'Matchup was a tie after a stat correction.' })]), false)
    expect(screen.getByTestId('pirate-cancelled-claims').textContent).toMatch(/Week 6: Matchup was a tie/)
  })
})

describe('8. Rules page', () => {
  it('the unit sits beside each number; ranges in words', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rules: data([]).rules }) }))
    const { container } = render(<PirateRulesEditor leagueId="L" />)
    await screen.findByLabelText('Time to pick a player')
    expect(container.textContent).not.toMatch(/\(hours\)|Allowed:/)
    expect(container.textContent).toMatch(/1 to 72 hours/)
    expect(read('components/league-settings/home/PirateRulesEditor.tsx')).toMatch(/<span className="pr-muted text-sm font-normal">\{unit\}<\/span>/)
  })
})
