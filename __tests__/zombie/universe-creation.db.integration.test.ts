// @vitest-environment node
/** Opt in with RUN_ZOMBIE_CREATION_DB=1 and explicit local DATABASE_URL + DIRECT_URL. */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { runPresetEngine } from '@/lib/league-creation/preset-engine/runPresetEngine'
import { createZombieUniverseInTransaction } from '@/lib/league-creation/canonical/createZombieUniverseInTransaction'
import { ensureRedraftSeason } from '@/lib/redraft/finalizeDraftToRedraftSeason'
import type { ValidatedCreateLeagueBody } from '@/lib/league-creation/canonical/validateCreateLeague'

const enabled = process.env.RUN_ZOMBIE_CREATION_DB === '1'
const prefix = `zombie-create-${randomUUID()}`
let userId = ''
const ids: string[] = []
const universeIds: string[] = []
const body: ValidatedCreateLeagueBody = {
  concept: 'zombie', sport: 'NFL', scoringPreset: 'fb_half_ppr', draftType: 'snake',
  teamCount: 20, leagueName: prefix, timezone: 'America/New_York', language: 'en',
  conceptSetup: { zombieLeagueCount: 6, visibility: 'private', zombie_whisperer_selection: 'veteran_priority' },
}

describe.skipIf(!enabled)('atomic Zombie universe creation in disposable PostgreSQL', () => {
  beforeAll(async () => {
    for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
      const url = new URL(process.env[name] ?? '')
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('This fixture requires a local disposable database.')
    }
    const user = await prisma.appUser.create({ data: { email: `${prefix}@example.invalid`, username: prefix } })
    userId = user.id
  })
  afterAll(async () => {
    if (ids.length) await prisma.league.deleteMany({ where: { id: { in: ids }, userId } })
    if (universeIds.length) await prisma.zombieUniverse.deleteMany({ where: { id: { in: universeIds }, commissionedByUserId: userId } })
    if (userId) await prisma.appUser.delete({ where: { id: userId } })
    await prisma.$disconnect()
  })

  it('creates six 20-manager leagues with matching rules, unique invites and one owned hub; no draft starts', async () => {
    const engine = runPresetEngine({ ...body, commissionerId: userId })
    const result = await prisma.$transaction(tx => createZombieUniverseInTransaction(tx, userId, body, engine), { timeout: 90000 })
    ids.push(...result.leagues.map(child => child.leagueId))
    universeIds.push(result.universeId)
    expect(ids).toHaveLength(6)
    const universe = await prisma.zombieUniverse.findUniqueOrThrow({ where: { id: result.universeId }, include: { levels: true, leagues: true } })
    expect(universe.commissionedByUserId).toBe(userId)
    expect(universe.leagues).toHaveLength(6)
    expect(universe.levels.map(level => level.leagueCount).sort()).toEqual([1, 2, 3])
    const snapshots: unknown[] = []
    const invites: string[] = []
    for (const id of ids) {
      const league = await prisma.league.findUniqueOrThrow({ where: { id } })
      expect(league).toMatchObject({ leagueSize: 20, sport: 'NFL', userId, leagueType: 'zombie', playoffTeams: 0 })
      expect(await prisma.leagueTeam.count({ where: { leagueId: id } })).toBe(20)
      expect(await prisma.leagueEntrySlot.count({ where: { leagueId: id } })).toBe(20)
      expect(await prisma.redraftLeagueMember.findFirst({ where: { leagueId: id, userId } })).toBeTruthy()
      const zombie = await prisma.zombieLeague.findUniqueOrThrow({ where: { leagueId: id } })
      expect(zombie).toMatchObject({ teamCount: 20, universeId: result.universeId, commissionerId: userId, totalWeeks: 18, season: league.season, status: 'setup' })
      expect(await prisma.zombieLeagueConfig.findUniqueOrThrow({ where: { leagueId: id } })).toMatchObject({ universeId: result.universeId, whispererSelection: 'veteran_priority' })
      const settings = league.settings as Record<string, unknown>
      const setup = settings.conceptSetup as Record<string, unknown>
      expect(setup).toMatchObject({ zombie_universe_id: result.universeId, zombieLeagueCount: 6, visibility: 'private' })
      const { zombie_level_id: _level, ...shared } = setup
      snapshots.push(shared)
      invites.push((await prisma.leagueInvite.findFirstOrThrow({ where: { leagueId: id } })).token)
      expect(await prisma.draftSession.findFirstOrThrow({ where: { leagueId: id } })).toMatchObject({ status: 'pre_draft', teamCount: 20 })
      const { season } = await ensureRedraftSeason(id)
      expect(season).toMatchObject({ totalWeeks: 18, playoffStartWeek: 19 })
    }
    for (const snapshot of snapshots) expect(snapshot).toEqual(snapshots[0])
    expect(new Set(invites).size).toBe(6)
  }, 120000)

  it('rolls back all shells, tiers and Zombie links if the fourth league fails', async () => {
    const engine = runPresetEngine({ ...body, commissionerId: userId })
    const failedName = `${prefix}-rollback`
    let attempts = 0
    await expect(prisma.$transaction(async tx => {
      const failing = new Proxy(tx, { get(target, key) {
        if (key !== 'league') return Reflect.get(target, key)
        return new Proxy(target.league, { get(delegate, method) {
          if (method !== 'create') return Reflect.get(delegate, method)
          return async (args: Parameters<typeof delegate.create>[0]) => {
            if (++attempts === 4) throw new Error('Synthetic fourth-league failure')
            return delegate.create(args)
          }
        } })
      } }) as Prisma.TransactionClient
      return createZombieUniverseInTransaction(failing, userId, { ...body, leagueName: failedName }, engine)
    }, { timeout: 90000 })).rejects.toThrow('Synthetic fourth-league failure')
    expect(attempts).toBe(4)
    expect(await prisma.league.count({ where: { userId, name: { startsWith: failedName } } })).toBe(0)
    expect(await prisma.zombieUniverse.count({ where: { commissionedByUserId: userId, name: failedName } })).toBe(0)
    expect(await prisma.zombieLeague.count({ where: { commissionerId: userId, name: { startsWith: failedName } } })).toBe(0)
  }, 120000)
})
