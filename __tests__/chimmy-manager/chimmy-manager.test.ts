/**
 * Chimmy as a manager (owner decision 2026-10-31): a commissioner hands up to 4 teams per league to
 * Chimmy — empty seats or absent managers' teams, any league or draft type AllFantasy runs. Chimmy
 * drafts them and runs them all season, and steps off when a real manager takes the team.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const m = vi.hoisted(() => {
  const state = { settings: {} as Record<string, unknown>, ownerHasPlan: true }
  const tx = {
    $queryRaw: vi.fn(async () => []),
    league: {
      findUnique: vi.fn(async () => ({ settings: state.settings })),
      update: vi.fn(async ({ data }: { data: { settings: Record<string, unknown> } }) => { state.settings = data.settings; return {} }),
    },
  }
  return {
    state,
    tx,
    prisma: {
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      league: { findUnique: vi.fn(async () => ({ platform: 'allfantasy', settings: state.settings, userId: 'league-owner' })) },
      roster: { findFirst: vi.fn(), findMany: vi.fn(async () => []) },
    },
    elevated: vi.fn(async () => true),
    log: vi.fn(async () => ({ id: 'a' })),
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: m.elevated }))
vi.mock('@/server/services/auditService', () => ({ logAction: m.log }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    resolveForUser = vi.fn(async () => ({ hasAccess: m.state.ownerHasPlan }))
  },
}))
vi.mock('@/lib/commissioner-hub/managerHealth', () => ({ getLeagueManagerHealth: vi.fn() }))
vi.mock('@/lib/roster-lineup-engine/lineupLockService', () => ({ resolveFullLineupLockContext: vi.fn() }))
vi.mock('@/lib/roster-lineup-engine/lineupService', () => ({ persistRosterLineupWithEngine: vi.fn() }))
vi.mock('@/lib/player-data/getNormalizedPlayerData', () => ({ getNormalizedPlayerData: vi.fn() }))

import { applyChimmyAutopilot, setChimmyAutopilot } from '@/lib/inactive-manager/inactiveManagerService'
import {
  autopilotRosterIds,
  CHIMMY_MANAGER_LIMIT,
  chimmyManagerLimitReached,
  isChimmyRunning,
  readManagedLineups,
  type ManagedLineups,
} from '@/lib/inactive-manager/inactiveManagerMode'
import { isAutopilotRoster } from '@/lib/live-draft-engine/instantAutopick'
import { draftAssignmentChimmyChanges, seasonStyleForDraftStyle } from '@/lib/commissioner-ai-draft-manager/chimmySeason'

const managed = () => readManagedLineups(m.state.settings)

beforeEach(() => {
  vi.clearAllMocks()
  m.state.settings = {}
  m.state.ownerHasPlan = true
  m.elevated.mockResolvedValue(true)
  m.prisma.roster.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, platformUserId: `orphan-${where.id}` }))
})

describe('handing teams to Chimmy', () => {
  it('takes an empty seat, stamped with the empty seat as its owner', async () => {
    expect(await setChimmyAutopilot('L', 'commish', 'r1', undefined)).toMatchObject({ ok: true, style: 'dynasty_owner' })
    expect(managed().r1).toMatchObject({ ownerUserId: 'orphan-r1', autopilot: { style: 'dynasty_owner' } })
  })

  it(`runs at most ${CHIMMY_MANAGER_LIMIT} teams in a league`, async () => {
    for (const id of ['r1', 'r2', 'r3', 'r4']) expect((await setChimmyAutopilot('L', 'commish', id, undefined)).ok).toBe(true)
    const fifth = await setChimmyAutopilot('L', 'commish', 'r5', undefined)
    expect(fifth).toMatchObject({ ok: false, status: 409 })
    expect(autopilotRosterIds(managed()).sort()).toEqual(['r1', 'r2', 'r3', 'r4'])
    // A team Chimmy already runs can still change style at the limit, and freeing a team frees a place.
    expect(await setChimmyAutopilot('L', 'commish', 'r2', 'win_now')).toMatchObject({ ok: true, style: 'win_now' })
    expect((await setChimmyAutopilot('L', 'commish', 'r1', null)).ok).toBe(true)
    expect((await setChimmyAutopilot('L', 'commish', 'r5', 'rebuild')).ok).toBe(true)
  })

  it('only a commissioner may hand teams over; the internal switch skips that check for callers that did it', async () => {
    m.elevated.mockResolvedValue(false)
    expect(await setChimmyAutopilot('L', 'manager', 'r1', undefined)).toMatchObject({ ok: false, status: 403 })
    expect(await applyChimmyAutopilot('L', 'commish', 'r1', undefined)).toMatchObject({ ok: true })
  })

  it('still needs the league owner\'s AF Commissioner plan', async () => {
    m.state.ownerHasPlan = false
    expect(await applyChimmyAutopilot('L', 'commish', 'r1', undefined)).toMatchObject({ ok: false, status: 402 })
  })
})

describe('a real manager takes the team', () => {
  const entries: ManagedLineups = { r1: { since: 's', byUserId: 'c', ownerUserId: 'orphan-r1', autopilot: { style: 'dynasty_owner', since: 's', byUserId: 'c' } } }

  it('Chimmy stops running it the moment the owner changes, before any sweep', () => {
    expect(isChimmyRunning(entries, 'r1', 'orphan-r1')).toBe(true)
    expect(isChimmyRunning(entries, 'r1', 'real-user')).toBe(false)
    expect(isAutopilotRoster({ af_managed_lineups: entries }, 'r1', 'orphan-r1')).toBe(true)
    expect(isAutopilotRoster({ af_managed_lineups: entries }, 'r1', 'real-user')).toBe(false)
  })

  it('the limit counts teams, and a team already Chimmy\'s never counts against itself', () => {
    const four: ManagedLineups = Object.fromEntries(['a', 'b', 'c', 'd'].map((id) => [id, { ...entries.r1 }]))
    expect(chimmyManagerLimitReached(four, 'e')).toBe(true)
    expect(chimmyManagerLimitReached(four, 'a')).toBe(false)
  })
})

describe('the draft room hands its AI teams to Chimmy for the season', () => {
  it('every active draft assignment becomes a Chimmy team; one switched off here is taken back', () => {
    const before = [
      { rosterId: 'r1', active: true, aiStyle: 'BPA' as const },
      { rosterId: 'r2', active: true, aiStyle: 'NEEDS' as const },
    ]
    const after = [
      { rosterId: 'r1', active: true, aiStyle: 'BPA' as const },
      { rosterId: 'r2', active: false, aiStyle: 'NEEDS' as const },
      { rosterId: 'r3', active: true, aiStyle: 'YOUTH' as const },
    ]
    expect(draftAssignmentChimmyChanges(before, after)).toEqual([
      { rosterId: 'r1', style: 'dynasty_owner' },
      { rosterId: 'r3', style: 'rebuild' },
      { rosterId: 'r2', style: null },
    ])
  })

  it('a team never assigned in the draft room is left alone', () => {
    expect(draftAssignmentChimmyChanges([], [])).toEqual([])
    expect(seasonStyleForDraftStyle('STARS_AND_SCRUBS')).toBe('dynasty_owner')
  })
})

import { draftAiSaveMessage } from '@/lib/commissioner-ai-draft-manager/chimmySeason'

describe('the draft room says what happened to the season', () => {
  it('confirms Chimmy runs the teams, or names why one could not be handed over', () => {
    expect(draftAiSaveMessage([{ rosterId: 'a', ok: true }])).toBe('Saved. Chimmy drafts these teams and runs them all season.')
    expect(draftAiSaveMessage([])).toBe('Saved.')
    expect(draftAiSaveMessage(undefined)).toBe('Saved.')
    expect(draftAiSaveMessage([
      { rosterId: 'a', ok: true },
      { rosterId: 'b', ok: false, error: 'Chimmy can run up to 4 teams in a league. Take Chimmy off a team first.' },
    ])).toBe('Saved. Chimmy will run 1 of them all season. 1 team could not be handed to Chimmy for the season: Chimmy can run up to 4 teams in a league. Take Chimmy off a team first.')
    expect(draftAiSaveMessage([{ rosterId: 'a', ok: false, error: 'Chimmy autopilot is part of the AF Commissioner plan.' }]))
      .toBe('Saved. Chimmy will draft these teams. 1 team could not be handed to Chimmy for the season: Chimmy autopilot is part of the AF Commissioner plan.')
  })
})
