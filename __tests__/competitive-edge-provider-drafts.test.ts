/**
 * Draft history for ESPN, MFL and Yahoo leagues in a manager's record (2026-11-23). The backfill files each pick
 * under the TEAM; each season's end-of-season roster snapshot names the PERSON who owned that team that season. A
 * pick is credited to that person — never to whoever holds the slot now — and a season with no person on file is
 * left out and named.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => ({ drafts: vi.fn(), snapshots: vi.fn(), resolve: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { draftFact: { findMany: db.drafts }, rosterSnapshot: { findMany: db.snapshots } },
}))
vi.mock('@/lib/decision-os/trade/tradePlayers', () => ({
  playerIdSpaceFor: ({ platform }: { platform: string }) => ({ provider: platform }),
  resolveTradePlayers: db.resolve,
}))

import {
  creditProviderDraftPicks,
  providerDraftSupport,
  readProviderDrafts,
  seasonOwnerFromSnapshot,
  seasonTeamOwners,
} from '@/lib/competitive-edge/providerManagerHistory'
import { buildManagerRecord } from '@/lib/competitive-edge/managerRecord'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'

const snap = (teamId: string, season: number, ownerId: string) => ({ teamId, season, rosterPlayers: [{ id: 'x', ownerId, rosterId: teamId }, { id: 'y', ownerId, rosterId: teamId }] })
const POS: Record<string, string> = { e1: 'RB', e2: 'WR', e3: 'RB', e4: 'QB', e5: 'RB', e6: 'TE' }

beforeEach(() => {
  vi.clearAllMocks()
  db.resolve.mockImplementation(async (ids: string[]) => new Map(ids.map((id) => [id, POS[id] ? { ok: true, name: id, position: POS[id] } : { ok: false, why: 'unresolved' }])))
})

describe('who owned a team that season', () => {
  it('ESPN: the SWID on the snapshot; the team-id fallback and a numeric slot are refused', () => {
    expect(seasonOwnerFromSnapshot('espn', '4', snap('4', 2024, '{SWID-A}').rosterPlayers)).toBe('{SWID-A}')
    expect(seasonOwnerFromSnapshot('espn', '4', snap('4', 2024, '4').rosterPlayers)).toBeNull()
    expect(seasonOwnerFromSnapshot('espn', '4', snap('4', 2024, '7').rosterPlayers)).toBeNull()
    expect(seasonOwnerFromSnapshot('espn', '4', [])).toBeNull()
  })

  it('MFL: the owner id; the franchise-id fallback is refused, padded or not', () => {
    expect(seasonOwnerFromSnapshot('mfl', '0003', snap('0003', 2023, '88213').rosterPlayers)).toBe('88213')
    expect(seasonOwnerFromSnapshot('mfl', '0003', snap('0003', 2023, '0003').rosterPlayers)).toBeNull()
    expect(seasonOwnerFromSnapshot('mfl', '0003', snap('0003', 2023, '3').rosterPlayers)).toBeNull()
  })

  it('Yahoo: the manager guid; the slot-like numeric manager_id and the team key are refused', () => {
    expect(seasonOwnerFromSnapshot('yahoo', '423.l.9.t.2', snap('423.l.9.t.2', 2023, 'GUIDABC').rosterPlayers)).toBe('GUIDABC')
    expect(seasonOwnerFromSnapshot('yahoo', '423.l.9.t.2', snap('423.l.9.t.2', 2023, '2').rosterPlayers)).toBeNull()
    expect(seasonOwnerFromSnapshot('yahoo', '423.l.9.t.2', snap('423.l.9.t.2', 2023, '423.l.9.t.2').rosterPlayers)).toBeNull()
  })

  it('a snapshot naming two different owners names nobody', () => {
    expect(seasonOwnerFromSnapshot('espn', '4', [{ ownerId: '{A}' }, { ownerId: '{B}' }])).toBeNull()
  })

  it('which platforms are read', () => {
    for (const p of ['espn', 'mfl', 'yahoo', 'ESPN']) expect(providerDraftSupport(p)).toBe(true)
    for (const p of ['fantrax', 'fleaflicker', 'sleeper']) expect(providerDraftSupport(p)).toBe(false)
  })
})

describe('crediting picks to the season’s owner', () => {
  it('🛑 ESPN: team 4 changed hands — each season’s picks go to that season’s owner, not to team 4’s owner now', () => {
    const owners = seasonTeamOwners('espn', [snap('4', 2024, '{SWID-A}'), snap('4', 2025, '{SWID-B}'), snap('6', 2025, '{SWID-A}')])
    const r = creditProviderDraftPicks(
      [
        { season: 2024, round: 1, playerId: 'e1', managerId: '4' },
        { season: 2025, round: 1, playerId: 'e2', managerId: '4' },
        { season: 2025, round: 2, playerId: 'e3', managerId: '6' },
      ],
      owners,
      (id) => POS[id] ?? null,
    )
    expect(r.picks).toEqual([
      { season: 2024, round: 1, position: 'RB', ownerSleeperId: '{SWID-A}' },
      { season: 2025, round: 1, position: 'WR', ownerSleeperId: '{SWID-B}' },
      { season: 2025, round: 2, position: 'RB', ownerSleeperId: '{SWID-A}' },
    ])
    expect(r.unattributedSeasons).toEqual([])
  })

  it('a season with no person on file is left out AND named — never credited', () => {
    const owners = seasonTeamOwners('mfl', [snap('0001', 2022, '0001'), snap('0001', 2023, '501')])
    const r = creditProviderDraftPicks(
      [
        { season: 2022, round: 1, playerId: 'e1', managerId: '0001' },
        { season: 2023, round: 1, playerId: 'e2', managerId: '0001' },
        { season: 2023, round: 2, playerId: 'e4', managerId: '0009' }, // a team with no snapshot that season
      ],
      owners,
      () => null,
    )
    expect(r.picks.map((p) => [p.season, p.ownerSleeperId])).toEqual([[2023, '501']])
    expect(r.unattributedSeasons).toEqual([2022, 2023])
  })
})

describe('readProviderDrafts', () => {
  it('ESPN: reads the picks and the season-end snapshots, and the record counts the person’s drafts', async () => {
    db.drafts.mockResolvedValue([
      { season: 2024, round: 1, playerId: 'e1', managerId: '4' },
      { season: 2024, round: 2, playerId: 'e3', managerId: '4' },
      { season: 2025, round: 1, playerId: 'e5', managerId: '6' },
      { season: 2025, round: 2, playerId: 'e6', managerId: '6' },
    ])
    db.snapshots.mockResolvedValue([snap('4', 2024, '{SWID-A}'), snap('6', 2025, '{SWID-A}')])
    const r = await readProviderDrafts({ id: 'E', sport: 'NFL', platform: 'espn' })
    expect(db.drafts).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'E', season: { not: null } } }))
    expect(db.snapshots).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'E', weekOrPeriod: 0, season: { not: null } } }))
    if (!r.available) throw new Error(r.reason)

    const rec = buildManagerRecord({
      manager: { name: 'Avery', teamExternalId: '6', ownerId: '{SWID-A}' },
      viewerOwnerId: null,
      trades: { available: false, reason: 'n/a' },
      waivers: { available: false, reason: 'n/a' },
      drafts: r,
    })
    if (!rec.drafts.available) throw new Error(rec.drafts.reason)
    expect(rec.drafts.data.drafts).toBe(2)
    expect(rec.drafts.data.picks).toBe(4)
    expect(rec.drafts.data.seasons).toEqual([2024, 2025])
    expect(rec.drafts.data.facts.map((f) => f.text).join(' ')).toMatch(/RB/)
  })

  it('no picks stored is a reason in words, not "never drafted"', async () => {
    db.drafts.mockResolvedValue([])
    db.snapshots.mockResolvedValue([])
    expect(await readProviderDrafts({ id: 'M', sport: 'NFL', platform: 'mfl' })).toEqual({
      available: false,
      reason: 'No MFL draft picks have been imported for this league yet.',
    })
  })

  it('picks stored but no season names an owner: a reason, not every manager at 0 drafts', async () => {
    db.drafts.mockResolvedValue([{ season: 2024, round: 1, playerId: 'e1', managerId: '423.l.9.t.2' }])
    db.snapshots.mockResolvedValue([snap('423.l.9.t.2', 2024, '2')])
    expect(await readProviderDrafts({ id: 'Y', sport: 'NFL', platform: 'yahoo' })).toEqual({
      available: false,
      reason: "Yahoo draft picks are on file, but who owned each team in those seasons wasn't recorded.",
    })
  })

  it('Fantrax and Fleaflicker keep their reason and read nothing', async () => {
    const f = await readProviderDrafts({ id: 'F', sport: 'NFL', platform: 'fantrax' })
    expect(!f.available && f.reason).toMatch(/^Fantrax doesn't give each team a person id/)
    const fl = await readProviderDrafts({ id: 'FL', sport: 'NFL', platform: 'fleaflicker' })
    expect(!fl.available && fl.reason).toBe("Fleaflicker draft picks aren't matched to the manager who made them yet.")
    expect(db.drafts).not.toHaveBeenCalled()
  })

  it('both new reasons read in Spanish', () => {
    expect(coreUiCopy('No MFL draft picks have been imported for this league yet.', 'es')).toBe('Todavía no se importaron selecciones del draft de MFL para esta liga.')
    expect(coreUiCopy("Yahoo draft picks are on file, but who owned each team in those seasons wasn't recorded.", 'es')).toBe(
      'Hay selecciones del draft de Yahoo registradas, pero no quedó registrado quién manejaba cada equipo en esas temporadas.',
    )
  })
})
