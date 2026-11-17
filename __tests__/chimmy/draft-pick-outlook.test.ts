import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * `get_draft_pick_outlook` (AF Pro, 2026-11-16): which of the viewer's targets are likely gone before
 * their next pick. Targets = their queue + the Draft OS shortlist, priced by the room's own rankings.
 */

const h = vi.hoisted(() => ({
  session: vi.fn(),
  picks: vi.fn(),
  queue: vi.fn(async () => null),
  team: vi.fn(async () => null),
  profile: vi.fn(async () => null),
  viewerRoster: vi.fn(),
  context: vi.fn(),
  rankings: vi.fn(),
  managersAhead: vi.fn(async () => null),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findFirst: h.session },
    draftPick: { findMany: h.picks },
    draftQueue: { findUnique: h.queue },
    leagueTeam: { findFirst: h.team },
    userProfile: { findUnique: h.profile },
  },
}))
vi.mock('@/lib/live-draft-engine/auth', () => ({ getCurrentUserRosterIdForLeague: h.viewerRoster }))
vi.mock('@/lib/shared-services/draft/DraftContextAssembler', () => ({ buildDraftDecisionContext: h.context }))
vi.mock('@/lib/draft-helper/RecommendationEngine', () => ({ computeDraftPlayerRankings: h.rankings }))
vi.mock('@/lib/competitive-edge/liveDraftManagers', () => ({ loadManagersAhead: h.managersAhead }))

import { buildDraftPickOutlook } from '@/lib/chimmy/tools/draftPickOutlook'
import { executeChimmyTool } from '@/lib/chimmy/tools/chimmyTools'

// 12 teams, snake. Viewer in slot 6: picks 6, 19, 30 …
const SLOTS = Array.from({ length: 12 }, (_, i) => ({ slot: i + 1, rosterId: `roster-${i + 1}`, displayName: `Manager ${i + 1}` }))
const SESSION = { id: 's1', status: 'in_progress', draftType: 'snake', rounds: 15, teamCount: 12, thirdRoundReversal: false, slotOrder: SLOTS, sleeperDraftId: null }

const row = (name: string, position: string, adp: number, totalScore: number, adpIsReal = true) => ({ player: { name, position, team: 'XX' }, adp, adpIsReal, totalScore })

beforeEach(() => {
  vi.clearAllMocks()
  h.session.mockResolvedValue(SESSION)
  // 20 picks made: next overall 21, the viewer's next is 30 (round 3, snake back to slot 6).
  h.picks.mockResolvedValue(Array.from({ length: 20 }, (_, i) => ({ playerName: `Taken ${i + 1}` })))
  h.viewerRoster.mockResolvedValue('roster-6')
  h.context.mockResolvedValue({ engineInput: { marker: true } })
  h.rankings.mockReturnValue({
    scored: [
      row('Jaylen Waddle', 'WR', 22.4, 80),
      row('Zay Flowers', 'WR', 41, 60),
      row('Sam LaPorta', 'TE', 29, 75),
      row('No Market Guy', 'RB', 41, 10, false),
    ],
    openAhead: [{ position: 'TE', teams: 6, of: 8 }],
  })
  h.queue.mockResolvedValue({ order: [{ playerName: 'Jaylen Waddle', position: 'WR' }, { playerName: 'Taken 3', position: 'RB' }, { playerName: 'Unknown Rookie', position: 'WR' }] } as never)
})

describe('buildDraftPickOutlook', () => {
  it('judges their queue first, then the Draft OS shortlist, against their next pick', async () => {
    const out = await buildDraftPickOutlook('lg1', 'u1')
    expect(out).toContain("PICK OUTLOOK (AF Pro): this user's next pick is 3.06, 9 picks away.")
    expect(out).toContain('Likely GONE before their pick: Jaylen Waddle (WR, ADP 22.4, queued).')
    expect(out).toContain('Toss-up: Sam LaPorta (TE, ADP 29).')
    expect(out).toContain('Likely still THERE: Zay Flowers (WR, ADP 41).')
    // Queued but not in the room's pool: no ADP, no judgement. The synthetic-ADP player is not judged either.
    expect(out).toContain('No market ADP (cannot judge): Unknown Rookie (WR, queued); No Market Guy (RB).')
    // Drafted players leave the queue.
    expect(out).not.toContain('Taken 3')
    expect(out).toContain('9 picks before your next turn: 6 of 8 still need a starting TE.')
    expect(h.context).toHaveBeenCalledWith({ leagueId: 'lg1', rosterId: 'roster-6' })
  })

  it('adds league history only when the plan shows it', async () => {
    h.managersAhead.mockResolvedValueOnce({ managers: [{ name: 'Manager 7', slot: 7, thisDraft: '', history: ['First-round RB in 3 of 4 drafts.'] }], history: 'shown' } as never)
    expect(await buildDraftPickOutlook('lg1', 'u1')).toContain('Manager 7: First-round RB in 3 of 4 drafts.')
    h.managersAhead.mockResolvedValueOnce({ managers: [{ name: 'Manager 7', slot: 7, thisDraft: '', history: [] }], history: 'locked' } as never)
    expect(await buildDraftPickOutlook('lg1', 'u1')).not.toContain('League history')
  })

  it('says there is nothing to judge when the viewer is on the clock now', async () => {
    h.picks.mockResolvedValue(Array.from({ length: 5 }, (_, i) => ({ playerName: `Taken ${i + 1}` })))
    expect(await buildDraftPickOutlook('lg1', 'u1')).toMatch(/^THIS USER IS ON THE CLOCK NOW/)
    expect(h.rankings).not.toHaveBeenCalled()
  })

  it('does not apply to an auction, a paused draft, or a draft that is not running', async () => {
    h.session.mockResolvedValueOnce({ ...SESSION, draftType: 'auction' })
    expect(await buildDraftPickOutlook('lg1', 'u1')).toMatch(/AUCTION/)
    h.session.mockResolvedValueOnce({ ...SESSION, status: 'paused' })
    expect(await buildDraftPickOutlook('lg1', 'u1')).toMatch(/PAUSED/)
    h.session.mockResolvedValueOnce({ ...SESSION, status: 'completed' })
    expect(await buildDraftPickOutlook('lg1', 'u1')).toMatch(/over/)
    expect(h.rankings).not.toHaveBeenCalled()
  })

  it('never guesses a slot it cannot match', async () => {
    h.viewerRoster.mockResolvedValue(null)
    expect(await buildDraftPickOutlook('lg1', 'u1')).toMatch(/could not be matched to a draft slot/)
  })

  it('still judges nothing it has no ADP for when the rankings fail', async () => {
    h.context.mockRejectedValue(new Error('pool too large'))
    const out = await buildDraftPickOutlook('lg1', 'u1')
    expect(out).toContain('No market ADP (cannot judge): Jaylen Waddle (WR, queued); Unknown Rookie (WR, queued).')
    expect(out).not.toContain('Likely GONE')
    expect(out).toMatch(/outlook is partial/)
  })
})

describe('the tool is AF Pro', () => {
  it('refuses a free user before reading anything, and records it for the upgrade button', async () => {
    const ctx = { leagueId: 'lg1', userId: 'u1', depth: 'free' as const, proToolsRefused: [] as string[] }
    const out = await executeChimmyTool('get_draft_pick_outlook', {}, ctx)
    expect(out).toMatch(/^NOT RUN: who's likely gone before your pick is an AF Pro feature/)
    expect(ctx.proToolsRefused).toEqual(['get_draft_pick_outlook'])
    expect(h.session).not.toHaveBeenCalled()
  })
})
