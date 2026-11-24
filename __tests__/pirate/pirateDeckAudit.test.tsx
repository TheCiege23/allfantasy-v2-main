/**
 * Pirate Deck audit fixes (2026-11-22, pirate audit items 1 and 3–8).
 *
 * 1 light mode: the deck was hard-coded dark; light mode turned its text dark on navy.
 * 3 a claim you must act on sat under your whole roster (~1,950px down on a phone).
 * 4 commissioner review (a ~70-word rule, evidence box, five controls) was open on every claim card.
 * 5 claim cards read "Week 6 · pending" and "Winner → Loser", and plunder could print a raw player id.
 * 6 a second, differently-labelled rules editor lived on the deck; the one in Settings is the editor now.
 * 7 slot types printed raw ("starter", "ir"), and "Still editable" / "League schedule time".
 * 8 the banner repeated the league name the page header already shows.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

import { PirateHome } from '@/components/pirate/PirateHome'

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
const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('Pirate Deck reads in light mode (1)', () => {
  it('scopes itself and uses no class the global light-mode rule rewrites, nor a fixed colour', async () => {
    const el = await deck(data([claim({})]))
    expect(el.firstElementChild?.classList.contains('pr')).toBe(true)
    const offenders = Array.from(el.querySelectorAll('*')).map((n) => n.getAttribute('class') ?? '')
      .filter((c) => /text-white|text-slate|bg-\[#|from-\[#|via-\[#|to-\[#|bg-black|text-amber|bg-amber|text-cyan|text-emerald|bg-emerald|text-rose|text-red|bg-red|accent-amber/.test(c))
    expect(offenders).toEqual([])
  })
})

describe('A claim you must act on comes first (3)', () => {
  it('puts the claim board above the protection deck while you have a pick to make', async () => {
    await deck(data([claim({})]))
    expect(before(screen.getByTestId('pirate-claim-board'), screen.getByTestId('pirate-protection-deck'))).toBe(true)
  })
  it('keeps the protection deck first when no claim needs you', async () => {
    await deck(data([claim({ winnerRosterId: 'other', loserRosterId: 'rival' })]))
    expect(before(screen.getByTestId('pirate-protection-deck'), screen.getByTestId('pirate-claim-board'))).toBe(true)
  })
})

describe('Commissioner review folds away until it is needed (4)', () => {
  it('is closed on a claim with nothing flagged', async () => {
    await deck(data([claim({ winnerRosterId: 'other', status: 'pending', playerId: 'q7', deadlineAt: '2026-11-25T20:00:00Z' })]))
    const review = screen.getByTestId('pirate-commish-review-c') as HTMLDetailsElement
    expect(review.tagName).toBe('DETAILS')
    expect(review.open).toBe(false)
  })
  it('opens itself when the losing lineup is flagged on another team’s claim', async () => {
    await deck(data([claim({ winnerRosterId: 'other' })], { lineupPreviews: { c: { issues: ['TE slot empty at lock'], reason: 'No tight end started.' } } }))
    expect((screen.getByTestId('pirate-commish-review-c') as HTMLDetailsElement).open).toBe(true)
  })
  it('stays folded on the commissioner’s own claim, and says it needs a look (2026-11-24)', async () => {
    await deck(data([claim({})], { lineupPreviews: { c: { issues: ['TE slot empty at lock'], reason: 'No tight end started.' } } }))
    const review = screen.getByTestId('pirate-commish-review-c') as HTMLDetailsElement
    expect(review.open).toBe(false)
    expect(review.querySelector('summary')?.textContent).toBe('Commissioner review · needs a look')
  })
})

describe('Claim cards say what is happening (5)', () => {
  it('tells the losing manager who is taking whom', async () => {
    await deck(data([claim({ winnerRosterId: 'other', loserRosterId: 'me', status: 'pending', playerId: 'p2', deadlineAt: '2026-11-25T20:00:00Z' })]), false)
    const card = screen.getByTestId('pirate-claim-c')
    expect(card.textContent).toMatch(/Jolly Rogers is taking Garrett Wilson from you/)
    expect(card.textContent).toMatch(/Waiting for your answer/)
    expect(card.textContent).not.toMatch(/→|\bpending\b|awaiting selection/i)
  })
  it('tells the winner to pick', async () => {
    await deck(data([claim({})]), false)
    expect(screen.getByTestId('pirate-claim-c').textContent).toMatch(/You beat Davy Jones Lockers\. Pick one unlocked player/)
  })
  it('names a plundered player even after he has left the winner’s roster', async () => {
    const el = await deck(data([claim({ status: 'transferred', playerId: 'q7', selectionDeadlineAt: null })]))
    const plunder = within(el).getByTestId('pirate-plunder')
    expect(plunder.textContent).toMatch(/DK Metcalf/)
    expect(plunder.textContent).not.toMatch(/\bq7\b/)
  })
})

describe('One rules editor (6)', () => {
  it('sends the commissioner to Settings instead of a second editor on the deck', async () => {
    await deck(data([]))
    expect(screen.queryByRole('button', { name: 'Save Pirate rules' })).toBeNull()
    expect(screen.getByRole('link', { name: /Change Pirate rules/ }).getAttribute('href')).toBe('/league/L?tab=settings')
  })
})

describe('Plain words and one headline (7, 8)', () => {
  it('prints slot types as words and drops the code-like status lines', async () => {
    const el = await deck(data([]))
    expect(within(screen.getByTestId('pirate-protection-deck')).getByText(/WR · X · IR/)).toBeTruthy()
    expect(el.textContent).not.toMatch(/· starter|· ir\b|Still editable|League schedule time/)
  })
  it('does not repeat the league name as a second headline', async () => {
    await deck(data([]))
    expect(screen.queryByRole('heading', { name: 'Plunder Bay' })).toBeNull()
  })
})
