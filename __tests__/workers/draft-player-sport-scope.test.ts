import { describe, it, expect, vi, beforeEach } from 'vitest'

/*
 * 2026-10-12: a draft's player id is resolved against `SportsPlayer` IN THE LEAGUE'S SPORT.
 * Production holds 18,731 `externalId`s in more than one sport and 372 `(sport, externalId)` pairs
 * with rows from several sources (NFL `2135` is a backfill "Josh Allen QB BUF" and rolling_insights'
 * Josh Hines-Allen). A database double that honours the `where` it is given — including the old
 * unscoped `findFirst` — so a lookup that forgets the sport gets exactly what production would hand it.
 */

type Row = {
  id: string; sport: string; externalId: string; source: string; name: string
  position: string | null; team: string | null; sleeperId: string | null; fetchedAt: Date
}
const ROWS: Row[] = [
  // Listed first so an unscoped lookup reaches the wrong sport's row before the right one.
  { id: 'nhl-4017', sport: 'NHL', externalId: '4017', source: 'rolling_insights', name: 'Hockey Center', position: 'C', team: 'BOS', sleeperId: null, fetchedAt: new Date('2026-10-10') },
  { id: 'nfl-ri-2135', sport: 'NFL', externalId: '2135', source: 'rolling_insights', name: 'Josh Hines-Allen', position: 'DE', team: 'JAX', sleeperId: null, fetchedAt: new Date('2026-10-11') },
  { id: 'nfl-bf-2135', sport: 'NFL', externalId: '2135', source: 'backfill', name: 'Josh Allen', position: 'QB', team: 'BUF', sleeperId: null, fetchedAt: new Date('2026-10-01') },
  { id: 'nfl-ri-6503', sport: 'NFL', externalId: '6503', source: 'rolling_insights', name: 'DeVonta Smith', position: 'WR', team: 'PHI', sleeperId: null, fetchedAt: new Date('2026-10-01') },
  { id: 'nfl-bf-6503', sport: 'NFL', externalId: '6503', source: 'backfill', name: 'DeVonta Smith', position: 'WR', team: 'PHI', sleeperId: '7525', fetchedAt: new Date('2026-09-01') },
]

const matches = (where: Record<string, any>) => (row: Row) =>
  (where.sport == null || row.sport === where.sport)
  && where.OR.some((c: Record<string, string>) => (c.id != null && row.id === c.id) || (c.externalId != null && row.externalId === c.externalId))

const h = vi.hoisted(() => ({
  nominate: vi.fn(), submitPick: vi.fn(), context: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: { findUnique: async () => null },
    devyPlayer: { findUnique: async () => null },
    league: { findUnique: async () => ({ settings: {} }) },
    sportsPlayer: {
      findMany: async ({ where }: { where: Record<string, any> }) => ROWS.filter(matches(where)),
      findFirst: async ({ where }: { where: Record<string, any> }) => ROWS.find(matches(where)) ?? null,
    },
  },
}))
vi.mock('@/lib/draft/resolve-draft-context', () => ({ assertLiveDraftContext: h.context }))
vi.mock('@/lib/live-draft-engine/auction/AuctionEngine', () => ({
  nominatePlayer: h.nominate, placeBid: vi.fn(), resolveAuctionWin: vi.fn(),
  getAuctionStateFromSession: vi.fn(), getBudgetsFromSession: vi.fn(),
}))
// The snake worker's other collaborators: only what `makePick` reaches before `submitPick`.
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: async () => true }))
vi.mock('@/lib/draft/draft-stream-store', () => ({ draftStreamStore: {} }))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({
  buildSessionSnapshot: async () => ({ currentPick: { rosterId: 'roster-1' } }),
  completeDraftSession: vi.fn(), pauseDraftSession: vi.fn(), resetTimer: vi.fn(),
  resumeDraftSession: vi.fn(), startDraftSession: vi.fn(),
}))
vi.mock('@/lib/live-draft-engine/PickSubmissionService', () => ({ submitPick: h.submitPick }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ getCurrentUserRosterIdForLeague: async () => 'roster-1' }))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({ getPlayerPoolForLeague: async () => [] }))
vi.mock('@/lib/draft-room/getResolvedDraftPoolForLeague', () => ({
  getResolvedDraftPoolForLeague: vi.fn(), normalizeDraftPoolNameForDedupe: vi.fn(),
}))
vi.mock('@/lib/draft-intelligence', () => ({ publishDraftIntelState: vi.fn() }))
vi.mock('@/lib/post-draft', () => ({ buildDeterministicPostDraftRecap: vi.fn() }))
vi.mock('@/lib/draft-room', () => ({ getRosterSlotLabelsForLeagueDraft: vi.fn() }))
vi.mock('@/lib/draft-room/draft-pool-eligible-positions', () => ({ draftPoolRowMatchesEligiblePositions: vi.fn() }))
vi.mock('@/lib/league/league-draft-template-payload', () => ({
  getDraftEligiblePositionsFromPayload: vi.fn(), getLeagueDraftTemplatePayload: vi.fn(),
}))
vi.mock('@/lib/draft-ai-engine', () => ({ runDraftAIAssist: vi.fn() }))
vi.mock('@/lib/workers/adp-blender', () => ({
  blendAdpRankings: vi.fn(), getAdpRankings: vi.fn(), setCustomAdpRankings: vi.fn(),
}))
vi.mock('@/lib/workers/lottery-engine', () => ({ assignDraftOrder: vi.fn(), runDraftLottery: vi.fn() }))

import { nominateDraftPlayer } from '@/lib/workers/auction-engine'
import { DraftWorker } from '@/lib/workers/draft-worker'

beforeEach(() => {
  h.nominate.mockReset(); h.nominate.mockResolvedValue({ success: true })
  // Stop `makePick` right after the player is resolved; the pick input is what is under test.
  h.submitPick.mockReset(); h.submitPick.mockResolvedValue({ success: false, error: 'stop-here' })
  h.context.mockReset(); h.context.mockResolvedValue({ leagueId: 'league-1', sport: 'NFL' })
})

const nominated = () => h.nominate.mock.calls[0]?.[1]?.playerId ?? null
const picked = async (playerId: string) => {
  await new DraftWorker().makePick('draft-1', 'user-1', playerId).catch((e: Error) => {
    if (e.message !== 'stop-here' && e.message !== 'Player not found') throw e
  })
  return h.submitPick.mock.calls[0]?.[0]?.playerId ?? null
}

describe('auction nomination resolves a player in the league\'s sport only', () => {
  it('REGRESSION: an NFL league never nominates the NHL player of the same number', async () => {
    const res = await nominateDraftPlayer('draft-1', 'team-1', '4017')
    expect(nominated()).toBeNull()
    expect(res).toEqual({ success: false, error: 'Player not found for nomination' })
  })

  it('REGRESSION: refuses an externalId two sources name different men by, rather than guess', async () => {
    await nominateDraftPlayer('draft-1', 'team-1', '2135')
    expect(nominated()).toBeNull()
  })

  it('accepts an externalId whose source rows agree, and our own id outright', async () => {
    await nominateDraftPlayer('draft-1', 'team-1', '6503')
    expect(nominated()).toBe('nfl-bf-6503') // the row carrying a Sleeper id
    h.nominate.mockClear()
    await nominateDraftPlayer('draft-1', 'team-1', 'nfl-ri-2135')
    expect(nominated()).toBe('nfl-ri-2135')
  })

  it('the NHL league still finds its own player', async () => {
    h.context.mockResolvedValue({ leagueId: 'league-2', sport: 'NHL' })
    await nominateDraftPlayer('draft-1', 'team-1', '4017')
    expect(nominated()).toBe('nhl-4017')
  })
})

describe('snake pick resolves a player in the league\'s sport only', () => {
  it('REGRESSION: an NFL pick of a number is never filed as that number\'s NHL player', async () => {
    expect(await picked('4017')).toBeNull()
  })

  it('REGRESSION: refuses an externalId two sources disagree about', async () => {
    expect(await picked('2135')).toBeNull()
  })

  it('still resolves an agreeing externalId', async () => {
    expect(await picked('6503')).toBe('nfl-bf-6503')
  })
})
