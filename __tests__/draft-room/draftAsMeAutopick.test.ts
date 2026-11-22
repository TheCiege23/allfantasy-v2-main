/** Draft as me — the plan and commissioner switch, and the history it reads. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => ({
  league: vi.fn(),
  hasAccess: vi.fn(async () => ({ hasAccess: true })),
  pastPicks: vi.fn(),
  roster: vi.fn(async () => ({ platformUserId: 'manager-1' })),
  pref: vi.fn(async () => ({ enabled: false, mode: 'standard', isProEligible: false, updatedAt: null })),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: m.league }, roster: { findUnique: m.roster } } }))
vi.mock('@/lib/live-draft-engine/LiveDraftAutopickPreferenceService', () => ({ getViewerAutopickPreference: m.pref }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({ EntitlementResolver: class { resolveForUser = m.hasAccess } }))
vi.mock('@/lib/draft-room/managerHistoryReads', () => ({ loadManagerPastPicks: m.pastPicks }))

import { describeDraftStyle, tryDraftAsMePick } from '@/lib/draft-room/draftAsMeAutopick'

const history = Array.from({ length: 12 }, (_, i) => ({ overall: 20 + i * 10, adpAtPick: 26 + i * 10, position: i % 2 ? 'WR' : 'RB' }))
const board = [
  { playerName: 'A', position: 'RB', team: 'X', playerId: 'a', byeWeek: null, adp: 30 },
  { playerName: 'B', position: 'WR', team: 'X', playerId: 'b', byeWeek: null, adp: 36 },
  { playerName: 'C', position: 'QB', team: 'X', playerId: 'c', byeWeek: null, adp: 40 },
]
const args = { leagueId: 'L', rosterId: 'r1', overall: 30, board, ownPositions: [] as string[] }

beforeEach(() => {
  vi.clearAllMocks()
  m.league.mockResolvedValue({ userId: 'owner', settings: {} })
  m.hasAccess.mockResolvedValue({ hasAccess: true })
  m.pastPicks.mockResolvedValue(history)
})

describe('tryDraftAsMePick', () => {
  it('picks like the manager on the league owner\'s plan, and says why', async () => {
    const pick = await tryDraftAsMePick(args)
    // This manager reaches ~6 picks early on average, so at pick 30 they take the player at 36.
    expect(pick).toMatchObject({ playerName: 'B', reason: expect.stringContaining('6 picks before their ADP') })
    expect(m.hasAccess).toHaveBeenCalledWith('owner', 'commissioner_draft_as_me')
  })

  it('is off without the plan, when the commissioner switches it off, or without history', async () => {
    m.hasAccess.mockResolvedValueOnce({ hasAccess: false })
    expect(await tryDraftAsMePick(args)).toBeNull()
    m.league.mockResolvedValueOnce({ userId: 'owner', settings: { draft_as_me: false } })
    expect(await tryDraftAsMePick(args)).toBeNull()
    m.pastPicks.mockResolvedValueOnce(history.slice(0, 3))
    expect(await tryDraftAsMePick(args)).toBeNull()
  })
})

describe('a manager’s own "Draft like me" (AF Pro)', () => {
  const withSession = { ...args, draftSessionId: 'S' }

  it('picks like them even when the league has no AF Commissioner plan', async () => {
    m.hasAccess.mockResolvedValue({ hasAccess: false })
    m.pref.mockResolvedValue({ enabled: true, mode: 'draft_as_me', isProEligible: true, updatedAt: null })
    expect(await tryDraftAsMePick(withSession)).toMatchObject({ playerName: 'B' })
    expect(m.pref).toHaveBeenCalledWith('S', 'manager-1')
  })

  it('is off when they chose another mode, have auto-pick off, or the seat has no person', async () => {
    m.hasAccess.mockResolvedValue({ hasAccess: false })
    m.pref.mockResolvedValueOnce({ enabled: true, mode: 'ai_queue', isProEligible: true, updatedAt: null })
    expect(await tryDraftAsMePick(withSession)).toBeNull()
    m.pref.mockResolvedValueOnce({ enabled: false, mode: 'draft_as_me', isProEligible: true, updatedAt: null })
    expect(await tryDraftAsMePick(withSession)).toBeNull()
    m.roster.mockResolvedValueOnce({ platformUserId: 'orphan-x' })
    expect(await tryDraftAsMePick(withSession)).toBeNull()
  })
})

describe('describeDraftStyle', () => {
  it('reads as plain English', () => {
    expect(describeDraftStyle({ reachDelta: 7.4, positionShare: { RB: 0.6, WR: 0.4 }, sample: 12 })).toBe(
      'Picked the way you draft: you usually wait about 7 picks past ADP for value, and 60% of your picks are RBs.',
    )
  })
})

describe('a team Chimmy runs on autopilot (phase 7, 2026-10-29)', () => {
  it('drafts the way its owner did even when the league-wide switch is off and the plan check fails', async () => {
    m.hasAccess.mockResolvedValue({ hasAccess: false })
    m.league.mockResolvedValue({
      userId: 'owner',
      settings: { draft_as_me: false, af_managed_lineups: { r1: { since: '2026-10-01', byUserId: 'c', autopilot: { style: 'dynasty_owner', since: '2026-10-01', byUserId: 'c' } } } },
    })
    expect(await tryDraftAsMePick(args)).toMatchObject({ playerName: 'B' })
    // Another team in the same league is not on autopilot: the switch stays off for it.
    expect(await tryDraftAsMePick({ ...args, rosterId: 'r2' })).toBeNull()
  })
})

describe('Draft like me says where its style comes from (2026-11-21)', () => {
  const named = history.map((p, i) => ({ ...p, leagueName: i < 8 ? 'Alpha League' : 'Beta League' }))

  it('a pick\'s reason names how many of the manager\'s own picks, in how many drafts, and the latest', async () => {
    m.pastPicks.mockResolvedValue(named)
    const pick = await tryDraftAsMePick(args)
    expect(pick?.reason).toMatch(/Learned from 12 of your own picks in 2 past drafts \(latest: Alpha League\)\./)
  })

  it('with too little history it returns no pick and says why, through onNotEnoughHistory', async () => {
    m.pastPicks.mockResolvedValue(named.slice(0, 2))
    const notes: string[] = []
    expect(await tryDraftAsMePick({ ...args, onNotEnoughHistory: (r) => notes.push(r) })).toBeNull()
    expect(notes).toEqual([expect.stringMatching(/needs 10 of your own picks from past drafts and has 2/)])
  })
})

describe('reference helpers', async () => {
  const { describeStyleReference, describeNotEnoughHistory, styleReferenceOf, draftAsMeStatus } = await import('@/lib/draft-room/draftAsMeAutopick')

  it('styleReferenceOf keeps drafts newest first, once each', () => {
    expect(styleReferenceOf([{ leagueName: 'B' }, { leagueName: 'A' }, { leagueName: 'B' }, { leagueName: null }])).toEqual({
      ownPicks: 4,
      drafts: ['B', 'A', 'Unnamed league'],
    })
  })

  it('reads in plain words, singular and plural', () => {
    expect(describeStyleReference({ ownPicks: 1, drafts: ['A'] })).toBe('Learned from 1 of your own pick in 1 past draft (latest: A).')
    expect(describeNotEnoughHistory(2)).toMatch(/Auto-picks and commissioner picks do not count\./)
  })

  it('draftAsMeStatus: ready with a style, not ready without one', async () => {
    m.pastPicks.mockResolvedValueOnce(history.map((p) => ({ ...p, leagueName: 'Alpha League' })))
    expect(await draftAsMeStatus('L', 'r1')).toMatchObject({ ready: true, ownPicks: 12, needed: 10, summary: expect.stringContaining('Learned from 12') })
    m.pastPicks.mockResolvedValueOnce([])
    expect(await draftAsMeStatus('L', 'r1')).toMatchObject({ ready: false, ownPicks: 0, summary: expect.stringContaining('has 0') })
  })
})

describe('Draft like me says when it filled a roster need (2026-11-22)', () => {
  it('names the starting spot the pick filled', async () => {
    m.pastPicks.mockResolvedValue(history)
    const open = [{ slotName: 'WR', allowedPositions: ['WR'], count: 2 }]
    const pick = await tryDraftAsMePick({ ...args, ownPositions: ['RB', 'RB'], openStarters: open })
    expect(pick?.position).toBe('WR')
    expect(pick?.reason).toMatch(/Your roster still needed a WR to start\./)
  })
})
