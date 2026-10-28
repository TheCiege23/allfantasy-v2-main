/**
 * Chimmy autopilot (AF Commissioner, owner decisions 2026-10-26): the paid upgrade of inactive manager
 * mode. Lineup management stays free; autopilot adds a playing style — dynasty owner by default — and
 * a team on autopilot takes no trade offers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const m = vi.hoisted(() => {
  const state = { settings: {} as Record<string, unknown>, platform: 'allfantasy', ownerHasPlan: true }
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
      league: { findUnique: vi.fn(async () => ({ platform: state.platform, settings: state.settings, userId: 'league-owner' })) },
      roster: { findFirst: vi.fn() },
    },
    elevated: vi.fn(async () => true),
    log: vi.fn(async () => ({ id: 'a' })),
    resolveForUser: vi.fn(async () => ({ hasAccess: state.ownerHasPlan })),
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: m.elevated }))
vi.mock('@/server/services/auditService', () => ({ logAction: m.log }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    resolveForUser = m.resolveForUser
  },
}))
vi.mock('@/lib/commissioner-hub/managerHealth', () => ({ getLeagueManagerHealth: vi.fn() }))
vi.mock('@/lib/roster-lineup-engine/lineupLockService', () => ({ resolveFullLineupLockContext: vi.fn() }))
vi.mock('@/lib/roster-lineup-engine/lineupService', () => ({ persistRosterLineupWithEngine: vi.fn() }))
vi.mock('@/lib/player-data/getNormalizedPlayerData', () => ({ getNormalizedPlayerData: vi.fn() }))

import {
  AUTOPILOT_OFF_ACTION,
  AUTOPILOT_ON_ACTION,
  isOwnerOnAutopilot,
  DRAFT_AS_ME_ACTION,
  setChimmyAutopilot,
  setDraftAsMe,
  setInactiveManagerMode,
} from '@/lib/inactive-manager/inactiveManagerService'
import { autopilotRosterIds, readManagedLineups } from '@/lib/inactive-manager/inactiveManagerMode'

const entry = (id: string) => ((m.state.settings.af_managed_lineups ?? {}) as Record<string, Record<string, unknown>>)[id]

beforeEach(() => {
  vi.clearAllMocks()
  m.state.settings = { other: 1 }
  m.state.platform = 'allfantasy'
  m.state.ownerHasPlan = true
  m.elevated.mockResolvedValue(true)
  m.prisma.roster.findFirst.mockResolvedValue({ id: 'r1' })
})

describe('setChimmyAutopilot', () => {
  it('defaults to playing like a dynasty owner, turns lineup management on too, and logs it', async () => {
    expect(await setChimmyAutopilot('L', 'commish', 'r1', undefined)).toMatchObject({ ok: true, style: 'dynasty_owner' })
    expect(entry('r1')).toMatchObject({ byUserId: 'commish', autopilot: { style: 'dynasty_owner', byUserId: 'commish' } })
    expect(m.state.settings.other).toBe(1)
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ actionType: AUTOPILOT_ON_ACTION, entityId: 'r1', metadata: { rosterId: 'r1', style: 'dynasty_owner' } }))
  })

  it('checks the LEAGUE OWNER\'s AF Commissioner plan and refuses without it', async () => {
    m.state.ownerHasPlan = false
    expect(await setChimmyAutopilot('L', 'co-commish', 'r1', 'win_now')).toMatchObject({ ok: false, status: 402 })
    expect(m.resolveForUser).toHaveBeenCalledWith('league-owner', 'commissioner_chimmy_autopilot')
    expect(entry('r1')).toBeUndefined()
  })

  it('is commissioner-only and rejects an unknown style', async () => {
    m.elevated.mockResolvedValueOnce(false)
    expect(await setChimmyAutopilot('L', 'member', 'r1', 'win_now')).toMatchObject({ ok: false, status: 403 })
    expect(await setChimmyAutopilot('L', 'commish', 'r1', 'tank')).toMatchObject({ ok: false, status: 400 })
  })

  it('changes the style, and turning it off keeps free lineup management running', async () => {
    await setChimmyAutopilot('L', 'commish', 'r1', 'dynasty_owner')
    await setChimmyAutopilot('L', 'commish', 'r1', 'rebuild')
    expect(entry('r1')).toMatchObject({ autopilot: { style: 'rebuild' } })
    expect(await setChimmyAutopilot('L', 'commish', 'r1', null)).toMatchObject({ ok: true, style: null })
    expect(entry('r1')).toBeDefined()
    expect(entry('r1')).not.toHaveProperty('autopilot')
    expect(m.log).toHaveBeenLastCalledWith(expect.objectContaining({ actionType: AUTOPILOT_OFF_ACTION }))
  })

  it('turning autopilot off needs no plan, so a lapsed subscription never strands a team on it', async () => {
    await setChimmyAutopilot('L', 'commish', 'r1', 'win_now')
    m.state.ownerHasPlan = false
    expect(await setChimmyAutopilot('L', 'commish', 'r1', null)).toMatchObject({ ok: true })
  })

  it('switching lineup management on again does not wipe autopilot', async () => {
    await setChimmyAutopilot('L', 'commish', 'r1', 'win_now')
    await setInactiveManagerMode('L', 'commish', 'r1', true)
    expect(entry('r1')).toMatchObject({ autopilot: { style: 'win_now' } })
  })
})

describe('readManagedLineups keeps autopilot', () => {
  it('round-trips the style and lists autopilot teams', () => {
    const managed = readManagedLineups({
      af_managed_lineups: {
        r1: { since: 's', byUserId: 'c', autopilot: { style: 'rebuild', since: 's', byUserId: 'c' } },
        r2: { since: 's', byUserId: 'c' },
        r3: { since: 's', byUserId: 'c', autopilot: { style: 'nonsense', since: 's', byUserId: 'c' } },
      },
    })
    expect(managed.r1.autopilot?.style).toBe('rebuild')
    expect(managed.r3.autopilot?.style).toBe('dynasty_owner')
    expect(autopilotRosterIds(managed)).toEqual(['r1', 'r3'])
  })
})

describe('isOwnerOnAutopilot (the trade guard)', () => {
  it('is true only for the owner of a team on autopilot', async () => {
    m.state.settings = { af_managed_lineups: { r1: { since: 's', byUserId: 'c', autopilot: { style: 'dynasty_owner', since: 's', byUserId: 'c' } } } }
    m.prisma.roster.findFirst.mockResolvedValueOnce({ id: 'r1' })
    expect(await isOwnerOnAutopilot('L', 'orphan-r1')).toBe(true)
    expect(m.prisma.roster.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'L', id: { in: ['r1'] }, platformUserId: 'orphan-r1' } }))
  })

  it('makes no roster query when no team is on autopilot', async () => {
    m.state.settings = { af_managed_lineups: { r1: { since: 's', byUserId: 'c' } } }
    expect(await isOwnerOnAutopilot('L', 'someone')).toBe(false)
    expect(m.prisma.roster.findFirst).not.toHaveBeenCalled()
  })
})

describe('setDraftAsMe (the commissioner switch)', () => {
  const tx = () => m.tx
  beforeEach(() => {
    m.prisma.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn({ ...tx(), league: { ...tx().league, findUnique: vi.fn(async () => ({ settings: m.state.settings })) } }))
  })

  it('turns it off without needing the plan, keeps other settings, and logs it', async () => {
    m.state.ownerHasPlan = false
    expect(await setDraftAsMe('L', 'commish', false)).toEqual({ ok: true, on: false })
    expect(m.state.settings).toMatchObject({ other: 1, draft_as_me: false })
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ actionType: DRAFT_AS_ME_ACTION, metadata: { on: false } }))
  })

  it('turning it on needs the league owner\'s AF Commissioner plan', async () => {
    m.state.settings = { draft_as_me: false }
    m.state.ownerHasPlan = false
    expect(await setDraftAsMe('L', 'commish', true)).toMatchObject({ ok: false, status: 402 })
    m.state.ownerHasPlan = true
    expect(await setDraftAsMe('L', 'commish', true)).toEqual({ ok: true, on: true })
    expect(m.state.settings).toMatchObject({ draft_as_me: true })
  })

  it('is commissioner-only and needs a yes or no', async () => {
    m.elevated.mockResolvedValueOnce(false)
    expect(await setDraftAsMe('L', 'member', false)).toMatchObject({ ok: false, status: 403 })
    expect(await setDraftAsMe('L', 'commish', 'yes')).toMatchObject({ ok: false, status: 400 })
  })
})
