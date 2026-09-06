/**
 * 🛑 `enterRedraftOffseason` HAD ZERO CALLERS.
 *
 * Finalizing a season crowned the champion and set `League.lifecycleState =
 * 'completed'` — and stopped there. Nothing ever wrote the `LeagueSeason` /
 * `FranchiseSeason` archive snapshot, and nothing transitioned the league into
 * `offseason`. A finalized league just sat at `completed` forever.
 *
 * This pins the fix: first-time finalize now calls `enterRedraftOffseason`,
 * surfaces its result on the response, and — because the champion was already
 * crowned successfully — a failure in the archive step must not fail the
 * whole request or block the (separately fixed) keeper-offseason trigger.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const getServerSession = vi.fn()
const findUniqueRedraftSeason = vi.fn()
const findFirstLeague = vi.fn()
const findUniqueLeague = vi.fn()
const finalizeNflRedraftPlayoffRuntimeSeason = vi.fn()
const enterRedraftOffseason = vi.fn()
const triggerKeeperOffseason = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => getServerSession(...args) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findUnique: (...args: unknown[]) => findUniqueRedraftSeason(...args) },
    league: {
      findFirst: (...args: unknown[]) => findFirstLeague(...args),
      findUnique: (...args: unknown[]) => findUniqueLeague(...args),
    },
  },
}))
vi.mock('@/lib/playoff-runtime', () => ({
  finalizeNflRedraftPlayoffRuntimeSeason: (...args: unknown[]) => finalizeNflRedraftPlayoffRuntimeSeason(...args),
}))
vi.mock('@/lib/redraft/offseason/RedraftOffseasonService', () => ({
  enterRedraftOffseason: (...args: unknown[]) => enterRedraftOffseason(...args),
}))
vi.mock('@/lib/keeper/offseasonEngine', () => ({
  triggerKeeperOffseason: (...args: unknown[]) => triggerKeeperOffseason(...args),
}))

import { POST } from '@/app/api/redraft/seasons/finalize/route'

function request(body: unknown) {
  return { json: async () => body } as never
}

const finalizeSuccess = {
  ok: true,
  championRosterId: 'roster-1',
  runnerUpRosterId: 'roster-2',
  finalStandings: [],
  events: [],
  state: { teams: [{ rosterId: 'roster-1', ownerId: 'user-1', displayName: 'Champs' }] },
}

beforeEach(() => {
  vi.clearAllMocks()
  getServerSession.mockResolvedValue({ user: { id: 'commish-1' } })
  findUniqueRedraftSeason.mockResolvedValue({ leagueId: 'league-1' })
  findFirstLeague.mockResolvedValue({ userId: 'commish-1', teams: [] })
  triggerKeeperOffseason.mockResolvedValue(undefined)
})

describe('POST /api/redraft/seasons/finalize — offseason wiring', () => {
  it('enters offseason on first-time finalize and surfaces the snapshot id', async () => {
    finalizeNflRedraftPlayoffRuntimeSeason.mockResolvedValueOnce({ ...finalizeSuccess, alreadyFinalized: false })
    enterRedraftOffseason.mockResolvedValueOnce({ ok: true, snapshotId: 'snap-1', alreadyInOffseason: false })
    findUniqueLeague.mockResolvedValueOnce({ leagueType: 'redraft', isDynasty: false })

    const res = await POST(request({ seasonId: 'season-1' }))
    const body = await res.json()

    expect(enterRedraftOffseason).toHaveBeenCalledWith('season-1', 'commish-1')
    expect(body.offseasonEntered).toBe(true)
    expect(body.offseasonSnapshotId).toBe('snap-1')
  })

  it('does not enter offseason again when the season was already finalized', async () => {
    finalizeNflRedraftPlayoffRuntimeSeason.mockResolvedValueOnce({ ...finalizeSuccess, alreadyFinalized: true })

    const res = await POST(request({ seasonId: 'season-1' }))
    const body = await res.json()

    expect(enterRedraftOffseason).not.toHaveBeenCalled()
    expect(triggerKeeperOffseason).not.toHaveBeenCalled()
    expect(body.offseasonEntered).toBe(false)
    expect(body.offseasonSnapshotId).toBeNull()
  })

  it('still crowns the champion and still triggers the keeper offseason when the archive step fails', async () => {
    finalizeNflRedraftPlayoffRuntimeSeason.mockResolvedValueOnce({ ...finalizeSuccess, alreadyFinalized: false })
    enterRedraftOffseason.mockRejectedValueOnce(new Error('boom'))
    findUniqueLeague.mockResolvedValueOnce({ leagueType: 'dynasty', isDynasty: true })

    const res = await POST(request({ seasonId: 'season-1' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.championRosterId).toBe('roster-1')
    expect(body.offseasonEntered).toBe(false)
    expect(triggerKeeperOffseason).toHaveBeenCalledWith('league-1', 'season-1')
  })
})
