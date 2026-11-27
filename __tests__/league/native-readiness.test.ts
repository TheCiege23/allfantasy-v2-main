import { describe, expect, it, vi } from 'vitest'
// The registry loads each sport with a CommonJS require vitest cannot resolve; this is the same registry over ESM imports.
vi.mock('@/lib/roster-engine/RosterEngineRegistry', async () => (await import('../dynasty-sim/rosterRegistryEsm')).buildEsmRosterRegistryModule())
import { checkNativeReadiness } from '@/lib/league/nativeReadiness'
import { planImportedPlayerIdentity } from '@/lib/league-creation/canonical/importedIdentityPlan'

const NOW = new Date('2027-02-01T12:00:00Z')

type Opts = {
  platform?: string
  sport?: string
  status?: string | null
  lifecycleState?: string | null
  lastSyncedAt?: Date | null
  teams?: Array<Record<string, unknown>>
  rosters?: Array<Record<string, unknown>>
  identities?: Array<Record<string, unknown>>
  otherCopies?: number
  liveDraft?: boolean
  futurePicks?: Array<{ originalRosterId: string; currentOwnerId: string }>
  settings?: Record<string, unknown>
}

/** A plain Sleeper redraft layout, and scoring the commissioner already saved in AllFantasy (so it wins and is not re-checked). */
const SLEEPER_SETTINGS = {
  roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
  reserve_slots: 1,
  nfl_scoring_config: { presetKey: 'custom', source: 'CUSTOM', rules: {}, lastUpdatedBy: 'commish' },
}

const team = (n: number) => ({ id: `t${n}`, externalId: `seat-${n}`, platformUserId: `m${n}`, claimedByUserId: null, teamName: `Team ${n}`, ownerName: `Owner ${n}`, avatarUrl: null, isCommissioner: n === 1, isCoCommissioner: false })
const roster = (n: number, players: string[], extra: Record<string, unknown> = {}) => ({
  id: `r${n}`, platformUserId: `m${n}`, faabRemaining: null, waiverPriority: null,
  playerData: { source_provider: 'sleeper', source_team_id: `seat-${n}`, players, ...extra },
})
const identity = (id: string, name = `Name ${id}`) => ({ sleeperId: id, canonicalName: name, position: 'RB', currentTeam: 'KC' })

function db(o: Opts = {}) {
  const platform = o.platform ?? 'sleeper'
  const sport = o.sport ?? 'NFL'
  const league = {
    id: 'L', platform, platformLeagueId: 'p-1', season: 2026, sport, settings: o.settings ?? SLEEPER_SETTINGS, leagueType: 'redraft', taxiSlots: 0, irSlots: 0,
    status: o.status === undefined ? 'complete' : o.status, lifecycleState: o.lifecycleState ?? null,
    lastSyncedAt: o.lastSyncedAt === undefined ? new Date('2027-02-01T08:00:00Z') : o.lastSyncedAt,
  }
  return {
    league: { findUnique: vi.fn().mockResolvedValue(league), count: vi.fn().mockResolvedValue(o.otherCopies ?? 0) },
    leagueTeam: { findMany: vi.fn().mockResolvedValue(o.teams ?? [team(1), team(2)]) },
    roster: { findMany: vi.fn().mockResolvedValue(o.rosters ?? [roster(1, ['a']), roster(2, ['b'])]) },
    draftSession: { findFirst: vi.fn().mockResolvedValue(o.liveDraft ? { id: 'd' } : null) },
    futureDraftPick: { findMany: vi.fn().mockResolvedValue(o.futurePicks ?? []) },
    playerIdentityMap: { findMany: vi.fn().mockResolvedValue(o.identities ?? [identity('a'), identity('b')]) },
    player: { findMany: vi.fn().mockResolvedValue([]) },
  }
}
const codes = (report: Awaited<ReturnType<typeof checkNativeReadiness>>) => report?.items.map((i) => i.code)

describe('checkNativeReadiness', () => {
  it('reports a clean offseason import as ready and writes nothing', async () => {
    const report = await checkNativeReadiness(db() as never, 'L', NOW)
    expect(report).toMatchObject({ status: 'ready', platformLabel: 'Sleeper', teamCount: 2, playerCount: 2, items: [] })
    // Read-only by construction: the mock has no create/update/delete delegates, so any write would throw.
  })

  it('says nothing for a native league', async () => {
    expect(await checkNativeReadiness(db({ platform: 'manual' }) as never, 'L', NOW)).toMatchObject({ status: 'native', items: [] })
  })

  it('lists every blocker at once instead of stopping at the first', async () => {
    const report = await checkNativeReadiness(db({
      otherCopies: 2, liveDraft: true, status: 'in_season',
      teams: [team(1), team(2), team(3)],
      rosters: [roster(1, ['a', 'x']), roster(2, ['b', 'a'])],
      identities: [identity('a'), identity('b')],
      futurePicks: [{ originalRosterId: 'seat-1', currentOwnerId: 'seat-9' }],
    }) as never, 'L', NOW)
    expect(report?.status).toBe('blocked')
    expect(codes(report)).toEqual(['duplicate_copies', 'provider_draft_live', 'season_in_progress', 'team_without_roster',
      'duplicate_ownership', 'unmatched_players', 'unmapped_future_picks'])
    expect(report?.items.find((i) => i.code === 'team_without_roster')?.names).toEqual(['Team 3'])
    expect(report?.items[0]?.title).toBe('2 other copies of this league are on AllFantasy')
  })

  it('names unmatched players by the name the provider gave them, and caps the list', async () => {
    const ids = Array.from({ length: 11 }, (_, i) => `p${i}`)
    const metadata = Object.fromEntries(ids.map((id) => [id, { name: `Rookie ${id}` }]))
    const report = await checkNativeReadiness(db({
      teams: [team(1)], rosters: [roster(1, ids, { player_metadata: metadata })], identities: [],
    }) as never, 'L', NOW)
    const item = report?.items.find((i) => i.code === 'unmatched_players')
    expect(item?.title).toBe('11 players aren’t matched to AllFantasy yet')
    expect(item?.names).toHaveLength(8)
    expect(item?.names?.[0]).toBe('Rookie p0')
    expect(item?.more).toBe(3)
  })

  it('treats a stale sync as a heads-up, not a blocker', async () => {
    const report = await checkNativeReadiness(db({ lastSyncedAt: new Date('2027-01-28T12:00:00Z') }) as never, 'L', NOW)
    expect(report?.status).toBe('ready')
    expect(report?.items).toEqual([expect.objectContaining({ code: 'stale_sync', severity: 'heads_up', title: 'Last refreshed from Sleeper 4 days ago' })])
  })

  it('does not count a finished season as in progress, whatever the lifecycle says', async () => {
    expect(codes(await checkNativeReadiness(db({ status: 'complete', lifecycleState: 'in_season' }) as never, 'L', NOW))).toEqual([])
    expect(codes(await checkNativeReadiness(db({ status: null, lifecycleState: 'in_season' }) as never, 'L', NOW))).toEqual(['season_in_progress'])
  })

  it('reports MLB scoring that cannot convert, but does not demand the weekly-lineup confirmation', async () => {
    const report = await checkNativeReadiness(db({ platform: 'fantrax', sport: 'MLB' }) as never, 'L', NOW)
    expect(codes(report)).toContain('scoring_unconvertible')
    expect(report?.items.map((i) => i.action).join(' ')).not.toMatch(/Confirm weekly lineups/)
  })
})

describe('the planner refuses on exactly what readiness lists', () => {
  it('turns unmatched players into the same refusal the carryover has always given', async () => {
    const tx = { playerIdentityMap: { findMany: vi.fn().mockResolvedValue([]) }, player: { findMany: vi.fn().mockResolvedValue([]) } }
    await expect(planImportedPlayerIdentity(tx as never, {
      sport: 'NFL', platform: 'sleeper', teams: [team(1)] as never, rosters: [roster(1, ['a', 'b'])] as never,
    })).rejects.toThrow('2 imported player IDs cannot be verified for a native league. Refresh player identities before carrying rosters over.')
  })
  it('still refuses an ambiguous id by name, before any fallback lookup', async () => {
    // Two identity rows mapping one ESPN id to different native ids.
    const tx = {
      playerIdentityMap: { findMany: vi.fn().mockResolvedValue([
        { espnId: 'e1', sleeperId: 's1', canonicalName: 'One', position: 'RB', currentTeam: null },
        { espnId: 'e1', sleeperId: 's2', canonicalName: 'Two', position: 'RB', currentTeam: null },
      ]) },
      player: { findMany: vi.fn().mockResolvedValue([]) },
    }
    await expect(planImportedPlayerIdentity(tx as never, {
      sport: 'NFL', platform: 'espn', teams: [team(1)] as never, rosters: [roster(1, ['e1'])] as never,
    })).rejects.toThrow('Ambiguous imported player identity e1.')
    expect(tx.player.findMany).not.toHaveBeenCalled()
  })
})

describe('the native settings a switch would write', () => {
  it('blocks when the roster layout cannot be read, and says how to fix it', async () => {
    const report = await checkNativeReadiness(db({ settings: { nfl_scoring_config: SLEEPER_SETTINGS.nfl_scoring_config } }) as never, 'L', NOW)
    expect(report?.status).toBe('blocked')
    expect(report?.items).toEqual([expect.objectContaining({ code: 'roster_unreadable', severity: 'blocker', action: expect.stringMatching(/Settings → Roster/) })])
  })

  it('is unblocked by a roster layout the commissioner saved in AllFantasy', async () => {
    const settings = { nfl_scoring_config: SLEEPER_SETTINGS.nfl_scoring_config, roster: { updatedBy: 'commish', auditLog: [{ action: 'updated' }] } }
    expect(await checkNativeReadiness(db({ settings }) as never, 'L', NOW)).toMatchObject({ status: 'ready', items: [] })
  })

  it("warns, without blocking, when the provider's scoring will not carry over", async () => {
    const { nfl_scoring_config: _saved, ...settings } = SLEEPER_SETTINGS
    const report = await checkNativeReadiness(db({ settings }) as never, 'L', NOW)
    expect(report?.status).toBe('ready')
    expect(report?.items).toEqual([expect.objectContaining({ code: 'scoring_not_carried', severity: 'heads_up' })])
  })
})
