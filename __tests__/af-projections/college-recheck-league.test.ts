// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { resolveCollegeRecheckLeague } from '@/lib/af-projections/collegeRecheckLeague'

const db = vi.hoisted(() => ({
  fantraxLeague: { findMany: vi.fn() },
  league: { findMany: vi.fn(), findUniqueOrThrow: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const binding = { sourceLeagueId: 'fantrax-source', userId: 'owner', tenantId: 'tenant', season: 2026 }
const config = { NCAAB: 'removed-af-id', fantraxImports: { NCAAB: binding } }
const current = { id: 'replacement-league', sport: 'NCAAB', platform: 'fantrax', season: 2026 }

beforeEach(() => {
  vi.resetAllMocks()
  db.fantraxLeague.findMany.mockResolvedValue([{ id: 'new-snapshot' }])
  db.league.findMany.mockResolvedValue([current])
})

it('follows the same Fantrax source across re-imports and keeps the owner, tenant, sport and season', async () => {
  expect(await resolveCollegeRecheckLeague(config, 'NCAAB')).toEqual(current)
  expect(db.fantraxLeague.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { sourceLeagueId: 'fantrax-source', appUserId: 'owner', season: 2026 },
  }))
  expect(db.league.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
    platformLeagueId: { in: ['new-snapshot'] }, sport: 'NCAAB', platform: 'fantrax', season: 2026,
    tenantId: 'tenant', userId: 'owner',
  } }))
  expect(db.league.findUniqueOrThrow).not.toHaveBeenCalled()
})

it('refuses to select an ambiguous replacement', async () => {
  db.league.findMany.mockResolvedValue([current, { ...current, id: 'other' }])
  await expect(resolveCollegeRecheckLeague(config, 'NCAAB')).rejects.toThrow('expected one monitored Fantrax league, found 2')
})

it('supports the original league-ID configuration', async () => {
  db.league.findUniqueOrThrow.mockResolvedValue(current)
  expect(await resolveCollegeRecheckLeague({ NCAAB: current.id }, 'NCAAB')).toEqual(current)
})
