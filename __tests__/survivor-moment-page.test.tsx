/**
 * survivor-core §4 MomentPage. The public page keeps the share-cards privacy rules (404 unless the
 * moment is final, published and share cards are on), shows the private-league state when public
 * moment pages are off (carrying nothing about the moment), and its scroll shows the names written
 * down and their order, never who voted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const m = vi.hoisted(() => ({
  db: {
    league: { findUnique: vi.fn() },
    survivorShareMoment: { findUnique: vi.fn(), findMany: vi.fn() },
    survivorTribalCouncil: { findUnique: vi.fn() },
    survivorTribe: { findMany: vi.fn() },
    survivorPlayer: { groupBy: vi.fn() },
    survivorVote: { findMany: vi.fn() },
  },
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('next/navigation', () => ({ notFound: m.notFound }))
vi.mock('@/lib/site-public-origin', () => ({ getPublicSiteOrigin: () => 'https://www.allfantasy.ai' }))

import { loadMomentPageData } from '@/lib/survivor/shareCards/momentPage'
import { momentCouncilIdFromDedupeKey, publicMomentScroll } from '@/lib/survivor/shareCards/momentPageModel'
import SurvivorMomentPage from '@/app/l/[leagueSlug]/moment/[momentId]/page'

const NOW = new Date('2026-10-18T12:00:00Z')
const momentRow = (over: Record<string, unknown> = {}) => ({
  id: 'm-out', leagueId: 'L1', type: 'out', week: 6, subjectUserId: 'u8', subjectRosterId: 'r8', dedupeKey: 'out:council-6',
  payload: { v: 1, displayName: 'Open Team 8', leagueName: 'Blah Survivor', sport: 'NFL', season: 2026, tribeName: 'Vela', crestPath: null, tally: '2–1', weeks: 6, points: 96.2, next: 'exile' },
  final: true, publishedAt: new Date('2026-10-17T00:00:00Z'), createdAt: new Date('2026-10-16T00:00:00Z'), ...over,
})
const council = (over: Record<string, unknown> = {}) => ({
  leagueId: 'L1', week: 6, isRevealed: true, revealStartsAt: new Date('2026-10-15T00:00:00Z'), revealStep: 3,
  revealSequence: [
    { type: 'vote', voterName: 'Secret Voter One', voterRosterId: 'r-voter-1', targetName: 'Open Team 8', status: 'counts' },
    { type: 'vote', voterName: 'Secret Voter Two', targetName: 'Open Team 4', status: 'blocked_by_idol' },
    { type: 'vote', voterName: 'Secret Voter Three', targetName: 'Open Team 8', status: 'counts' },
  ],
  ...over,
})

function settings(over: Record<string, unknown> = {}) {
  return { settings: { shareCardsEnabled: true, publicMomentPages: true, ...over }, sport: 'NFL', survivorRevealMode: 'all_at_once' }
}

beforeEach(() => {
  for (const model of Object.values(m.db)) for (const fn of Object.values(model)) (fn as ReturnType<typeof vi.fn>).mockReset()
  m.notFound.mockClear()
  m.db.survivorShareMoment.findUnique.mockImplementation(async (args: { select?: unknown }) => (args.select ? { dedupeKey: 'out:council-6' } : momentRow()))
  m.db.survivorShareMoment.findMany.mockResolvedValue([])
  m.db.league.findUnique.mockResolvedValue(settings())
  m.db.survivorTribalCouncil.findUnique.mockResolvedValue(council())
  m.db.survivorTribe.findMany.mockResolvedValue([
    { id: 't1', name: 'Vela', isMerged: false, colorHex: '#b8a8ff', logoUrl: null, catalogId: null, primaryColor: null, secondaryColor: null, _count: { members: 3 } },
    { id: 't2', name: 'Koa', isMerged: false, colorHex: '#7fd3de', logoUrl: null, catalogId: null, primaryColor: null, secondaryColor: null, _count: { members: 6 } },
  ])
  m.db.survivorPlayer.groupBy.mockResolvedValue([{ tribeId: 't1', _count: { _all: 3 } }])
})

describe('publicMomentScroll', () => {
  it('keeps names and order and drops every voter field', () => {
    const scroll = publicMomentScroll(council(), 'all_at_once', NOW)
    expect(scroll?.slips.map(s => [s.order, s.name, s.struck, s.stamp])).toEqual([[1, 'Open Team 8', false, null], [2, 'Open Team 4', true, 'Idol played'], [3, 'Open Team 8', false, null]])
    expect(JSON.stringify(scroll)).not.toMatch(/Secret Voter|r-voter-1|voter/i)
  })

  it('shows nothing before the read is complete', () => {
    expect(publicMomentScroll(council({ isRevealed: false }), 'all_at_once', NOW)).toBeNull()
    expect(publicMomentScroll(council({ revealStartsAt: new Date('2026-10-19T00:00:00Z') }), 'all_at_once', NOW)).toBeNull()
    expect(publicMomentScroll(council({ revealStep: 1 }), 'commissioner', NOW)).toBeNull()
  })

  it('reads the council id from out and idol dedupe keys only', () => {
    expect(momentCouncilIdFromDedupeKey('out:c1')).toBe('c1')
    expect(momentCouncilIdFromDedupeKey('idol:c2:idol-9')).toBe('c2')
    expect(momentCouncilIdFromDedupeKey('immunity:6:u1')).toBeNull()
  })
})

describe('loadMomentPageData', () => {
  it('404s when share cards are off, the moment is unpublished or not final, or the league does not match', async () => {
    m.db.league.findUnique.mockResolvedValue(settings({ shareCardsEnabled: false }))
    expect(await loadMomentPageData('L1', 'm-out', { now: NOW })).toBeNull()
    m.db.league.findUnique.mockResolvedValue(settings())
    m.db.survivorShareMoment.findUnique.mockResolvedValue(momentRow({ publishedAt: null }))
    expect(await loadMomentPageData('L1', 'm-out', { now: NOW })).toBeNull()
    m.db.survivorShareMoment.findUnique.mockResolvedValue(momentRow({ final: false }))
    expect(await loadMomentPageData('L1', 'm-out', { now: NOW })).toBeNull()
    m.db.survivorShareMoment.findUnique.mockResolvedValue(momentRow())
    expect(await loadMomentPageData('L2', 'm-out', { now: NOW })).toBeNull()
  })

  it('returns only the private state when public moment pages are off', async () => {
    m.db.league.findUnique.mockResolvedValue(settings({ publicMomentPages: false }))
    const data = await loadMomentPageData('L1', 'm-out', { now: NOW })
    expect(data).toEqual({ state: 'private' })
    expect(m.db.survivorTribalCouncil.findUnique).not.toHaveBeenCalled()
  })

  it('never reads ballots, and the council query selects no voter column', async () => {
    const data = await loadMomentPageData('L1', 'm-out', { now: NOW })
    expect(data?.state).toBe('public')
    expect(m.db.survivorVote.findMany).not.toHaveBeenCalled()
    const select = m.db.survivorTribalCouncil.findUnique.mock.calls[0][0].select
    expect(Object.keys(select).sort()).toEqual(['isRevealed', 'leagueId', 'revealSequence', 'revealStartsAt', 'revealStep', 'week'])
  })

  it('ignores a council from another league', async () => {
    m.db.survivorTribalCouncil.findUnique.mockResolvedValue(council({ leagueId: 'OTHER' }))
    const data = await loadMomentPageData('L1', 'm-out', { now: NOW })
    expect(data?.state === 'public' && data.scroll).toBeNull()
  })

  it('lists three more published moments from the same league, never this one', async () => {
    await loadMomentPageData('L1', 'm-out', { now: NOW })
    expect(m.db.survivorShareMoment.findMany.mock.calls[0][0]).toMatchObject({ where: { leagueId: 'L1', final: true, publishedAt: { not: null }, NOT: { id: 'm-out' } }, take: 3 })
  })
})

describe('the page', () => {
  const params = Promise.resolve({ leagueSlug: 'L1', momentId: 'm-out' })

  it('renders the hero, the scroll without voters, torches per tribe and the call to action', async () => {
    render(await SurvivorMomentPage({ params }))
    expect(screen.getByRole('heading', { level: 1, name: 'Open Team 8’s torch is out' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /Start a (Survivor )?league/ }).length).toBeGreaterThan(0)
    expect(screen.getByTestId('moment-scroll').textContent).toContain('Open Team 4')
    expect(document.body.textContent).not.toMatch(/Secret Voter/)
    expect(screen.getByLabelText('3 still in, 3 out')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
  })

  it('renders the private-league state with nothing about the moment', async () => {
    m.db.league.findUnique.mockResolvedValue(settings({ publicMomentPages: false }))
    render(await SurvivorMomentPage({ params }))
    expect(screen.getByText('This league is private')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Open Team 8|torch is out|Blah Survivor/)
  })

  it('404s when the moment is not public', async () => {
    m.db.survivorShareMoment.findUnique.mockResolvedValue(momentRow({ publishedAt: null }))
    await expect(SurvivorMomentPage({ params })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
