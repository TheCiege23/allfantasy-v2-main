// @vitest-environment node
/** RUN_ZOMBIE_COMBAT_DB=1 requires an explicitly named disposable local PostgreSQL database. */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { startBetaWhispererOffers, respondBetaRoleWorkflow, expireBetaRoleWorkflows, settleBetaCombat, reviewBetaVeterans } from '@/lib/zombie/beta2025RoleWorkflows'
import { settleBetaItems } from '@/lib/zombie/beta2025ItemSettlement'
import * as itemService from '@/lib/zombie/beta2025ItemService'
import { previewBetaAmbush, executeBetaAmbush } from '@/lib/zombie/beta2025Ambush'
import { handleWhispererDefeat } from '@/lib/zombie/whispererEngine'

const enabled = process.env.RUN_ZOMBIE_COMBAT_DB === '1'
const marker = `combat-qa-${randomUUID()}`
const users: string[] = [], leagues: string[] = []
const baseNow = new Date('2026-11-03T12:00:00Z')

describe.skipIf(!enabled)('2025 combat workflows in disposable PostgreSQL', () => {
  beforeAll(async () => {
    for (const name of ['DATABASE_URL', 'DIRECT_URL']) if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env[name] ?? '').hostname)) throw new Error('A disposable loopback database is required.')
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(baseNow)
    // Scoring refresh is tested separately; these cases exercise real workflow, inventory,
    // schedule, notification and audit transactions, not provider scoring calibration.
    vi.spyOn(itemService, 'refreshItemScores').mockResolvedValue(undefined)
    for (let i = 0; i < 6; i++) users.push((await prisma.appUser.create({ data: { username: `${marker}-${i}`, email: `${marker}-${i}@example.invalid` } })).id)
    await prisma.sportsGame.createMany({ data: [
      { sport: 'NFL', externalId: `${marker}-past`, homeTeam: 'KC', awayTeam: 'BAL', source: 'api_sports', season: 2026, seasonType: 'regular', week: 1, startTime: new Date('2026-10-29T23:00:00Z'), expiresAt: new Date('2027-01-01Z') },
      { sport: 'NFL', externalId: `${marker}-future`, homeTeam: 'PIT', awayTeam: 'CLE', source: 'api_sports', season: 2026, seasonType: 'regular', week: 1, startTime: new Date('2026-11-01T18:00:00Z'), expiresAt: new Date('2027-01-01Z') },
    ] })
  }, 60_000)
  beforeEach(() => vi.setSystemTime(baseNow))
  afterAll(async () => {
    if (leagues.length) {
      await prisma.zombieTeamItem.deleteMany({ where: { team: { leagueId: { in: leagues } } } })
      await prisma.zombieLeagueTeam.deleteMany({ where: { leagueId: { in: leagues } } })
      await prisma.zombieBashingEvent.deleteMany({ where: { leagueId: { in: leagues } } })
      await prisma.zombieMaulingEvent.deleteMany({ where: { leagueId: { in: leagues } } })
      await prisma.zombieAuditLog.deleteMany({ where: { leagueId: { in: leagues } } })
      await prisma.league.deleteMany({ where: { id: { in: leagues }, userId: users[0] } })
    }
    await prisma.sportsGame.deleteMany({ where: { externalId: { in: [`${marker}-past`, `${marker}-future`] } } })
    if (users.length) await prisma.appUser.deleteMany({ where: { id: { in: users }, username: { startsWith: marker } } })
    await prisma.$disconnect(); vi.restoreAllMocks(); vi.useRealTimers()
  }, 60_000)

  async function fixture(roles = ['Survivor', 'Survivor', 'Survivor', 'Survivor'], veterans: number[] = []) {
    const league = await prisma.league.create({ data: { userId: users[0], platform: 'manual', platformLeagueId: randomUUID(), name: marker, sport: 'NFL', leagueType: 'zombie' } })
    leagues.push(league.id)
    const z = await prisma.zombieLeague.create({ data: { leagueId: league.id, season: 2026, sport: 'NFL', status: 'active', currentWeek: 1, teamCount: roles.length, experienceMode: 'enhanced', whispererIsPublic: false } })
    const season = await prisma.redraftSeason.create({ data: { leagueId: league.id, season: 2026, sport: 'NFL', totalWeeks: 18, playoffStartWeek: 19, currentWeek: 1 } })
    const rosters = [], seasonRosters = [], teams = []
    for (let i = 0; i < roles.length; i++) {
      const native = await prisma.redraftRoster.create({ data: { leagueId: league.id, seasonId: season.id, ownerId: users[i], ownerName: `QA ${i}`, teamName: `Team ${i}` } })
      seasonRosters.push(native)
      const roster = await prisma.roster.create({ data: { leagueId: league.id, platformUserId: users[i], redraftRosterId: native.id, playerData: {} } })
      rosters.push(roster)
      teams.push(await prisma.zombieLeagueTeam.create({ data: { leagueId: league.id, zombieLeagueId: z.id, rosterId: roster.id, status: roles[i], isVeteran: veterans.includes(i), isWhisperer: roles[i] === 'Whisperer', fantasyTeamName: `Team ${i}`, weekBecameZombie: roles[i] === 'Zombie' ? 0 : null } }))
      if (roles[i] === 'Whisperer') await prisma.whispererRecord.create({ data: { zombieLeagueId: z.id, userId: users[i], displayName: `Team ${i}`, selectionMode: 'fixture', ambushesGranted: 2, ambushesUsed: 1, ambushesRemaining: 1 } })
    }
    const matches = []
    for (let i = 0; i < roles.length; i += 2) matches.push(await prisma.redraftMatchup.create({ data: { seasonId: season.id, leagueId: league.id, week: 1, homeRosterId: seasonRosters[i].id, awayRosterId: seasonRosters[i + 1].id } }))
    return { league, z, season, rosters, seasonRosters, teams, matches }
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>
  async function settled(f: Fixture, winnerScore = 100, loserScore = 40, extraSerum = false) {
    if (extraSerum) await prisma.zombieTeamItem.create({ data: { teamStatusId: f.teams[1].id, zombieLeagueId: f.z.id, userId: users[1], itemType: 'serum', itemLabel: 'Serum', acquiredAtWeek: 0 } })
    const teams = await prisma.zombieLeagueTeam.findMany({ where: { leagueId: f.league.id } })
    const items = await prisma.zombieTeamItem.findMany({ where: { zombieLeagueId: f.z.id } })
    const snapshot = JSON.parse(JSON.stringify({ version: 1, itemsPolicy: 'beta_2025', itemWeaponsEnabled: true, capturedAt: baseNow.toISOString(),
      owners: f.rosters.map((r, i) => ({ rosterId: r.id, userId: users[i] })), teams, items, whisperer: null, coWhisperers: [],
      config: { serumAwardHighScore: true, serumAwardOnBashMaul: true },
      rules: { bashingThreshold: 60, maulingThreshold: 60 }, winnings: { policy: 'beta_2025', openingByRoster: Object.fromEntries(f.rosters.map(r => [r.id, 10])) },
      itemMatchups: f.matches.map((m, i) => ({ matchupId: m.id, homeRosterId: f.rosters[i * 2].id, awayRosterId: f.rosters[i * 2 + 1].id,
        homeScore: i === 0 ? winnerScore : 300, awayScore: i === 0 ? loserScore : 299, homeBaseScore: i === 0 ? winnerScore : 300, awayBaseScore: i === 0 ? loserScore : 299, homeWeaponBonus: 0, awayWeaponBonus: 0 })) }))
    await prisma.zombieWeeklyResolution.create({ data: { zombieLeagueId: f.z.id, week: 1, status: 'resolving', matchupResults: [], newZombies: [], settlementSnapshot: toPrismaJsonInput(snapshot) } })
    await settleBetaItems(f.z.id, 1)
    await settleBetaCombat(f.z.id, 1)
    await prisma.zombieWeeklyResolution.update({ where: { zombieLeagueId_week: { zombieLeagueId: f.z.id, week: 1 } }, data: { status: 'complete', resolvedAt: baseNow } })
    return prisma.zombieRoleWorkflow.findFirst({ where: { zombieLeagueId: f.z.id, kind: { not: 'combat_receipt' } } })
  }

  it('persists an independent veteran-only order and advances declines without duplicate offers', async () => {
    const f = await fixture(undefined, [1, 3])
    await Promise.all([startBetaWhispererOffers(f.league.id), startBetaWhispererOffers(f.league.id)])
    const row = await prisma.zombieRoleWorkflow.findFirstOrThrow({ where: { zombieLeagueId: f.z.id } })
    const state = row.state as { candidates: Array<{ userId: string }>; index: number }
    expect(state.candidates.map(c => c.userId).sort()).toEqual([users[1], users[3]].sort())
    expect(await prisma.whispererRecord.findUnique({ where: { zombieLeagueId: f.z.id } })).toBeNull()
    await respondBetaRoleWorkflow(f.league.id, row.id, row.actorUserId!, 'decline', 0)
    await respondBetaRoleWorkflow(f.league.id, row.id, row.actorUserId!, 'decline', 0)
    const next = await prisma.zombieRoleWorkflow.findUniqueOrThrow({ where: { id: row.id } })
    expect(next.actorUserId).not.toBe(row.actorUserId)
    await Promise.all([respondBetaRoleWorkflow(f.league.id, row.id, next.actorUserId!, 'accept', 1), respondBetaRoleWorkflow(f.league.id, row.id, next.actorUserId!, 'accept', 1)])
    expect(await prisma.whispererRecord.findUniqueOrThrow({ where: { zombieLeagueId: f.z.id } })).toMatchObject({ userId: next.actorUserId, ambushesGranted: 2, ambushesRemaining: 2 })
    expect(await prisma.zombieLeagueTeam.count({ where: { leagueId: f.league.id, status: 'Whisperer' } })).toBe(1)
    expect(await prisma.platformNotification.count({ where: { leagueId: f.league.id, type: 'zombie_role_decision' } })).toBe(2)
  })

  it('records historical veteran eligibility before the draw and seals it once offers begin', async () => {
    const f = await fixture()
    await expect(reviewBetaVeterans(f.league.id, users[1], [users[2]], 'Completed the prior universe year')).rejects.toThrow('owner')
    await reviewBetaVeterans(f.league.id, users[0], [users[2]], 'Verified completed prior universe year')
    expect(await prisma.zombieLeagueTeam.findMany({ where: { leagueId: f.league.id, isVeteran: true } })).toHaveLength(1)
    expect(await prisma.zombieAuditLog.count({ where: { leagueId: f.league.id, eventType: 'whisperer_veteran_review' } })).toBe(1)
    await startBetaWhispererOffers(f.league.id)
    const offer = await prisma.zombieRoleWorkflow.findFirstOrThrow({ where: { zombieLeagueId: f.z.id } })
    expect(offer.actorUserId).toBe(users[2])
    await expect(reviewBetaVeterans(f.league.id, users[0], [users[1]], 'Change after viewing the order')).rejects.toThrow('sealed')
  })

  it('uses the completed draft season for an initial draw even when setup carried an old year', async () => {
    const f = await fixture()
    await prisma.zombieLeague.update({ where: { id: f.z.id }, data: { status: 'setup', season: 2025 } })
    await startBetaWhispererOffers(f.league.id, undefined, 2026)
    expect(await prisma.zombieRoleWorkflow.findUnique({ where: { id: `whisperer-offer:${f.z.id}:2026` } })).not.toBeNull()
    expect(await prisma.zombieLeague.findUniqueOrThrow({ where: { id: f.z.id } })).toMatchObject({ season: 2026, status: 'setup' })
  })

  it('blocks the legacy half-budget defeat path before it can mutate an NFL role', async () => {
    const f = await fixture(['Whisperer', 'Survivor', 'Survivor', 'Survivor'])
    await expect(handleWhispererDefeat(f.z.id, users[1], 1, users[0])).rejects.toThrow('sealed combat workflow')
    expect(await prisma.whispererRecord.findUniqueOrThrow({ where: { zombieLeagueId: f.z.id } })).toMatchObject({ wasDefeated: false, ambushesRemaining: 1 })
  })

  it('falls back to all managers only when no veterans exist; 24-hour expiry advances once', async () => {
    const f = await fixture()
    await startBetaWhispererOffers(f.league.id)
    const row = await prisma.zombieRoleWorkflow.findFirstOrThrow({ where: { zombieLeagueId: f.z.id } })
    expect((row.state as { candidates: unknown[] }).candidates).toHaveLength(4)
    expect(row.deadlineAt!.getTime() - baseNow.getTime()).toBe(24 * 3_600_000)
    vi.setSystemTime(new Date(baseNow.getTime() + 24 * 3_600_000))
    await expireBetaRoleWorkflows(); await expireBetaRoleWorkflows()
    const next = await prisma.zombieRoleWorkflow.findUniqueOrThrow({ where: { id: row.id } })
    expect((next.state as { index: number }).index).toBe(1)
    expect(next.deadlineAt!.getTime() - Date.now()).toBe(24 * 3_600_000)
  })

  it('sends an exhausted veteran draw to review and requires a reason and new consent for nomination', async () => {
    const f = await fixture(undefined, [1])
    await startBetaWhispererOffers(f.league.id)
    const row = await prisma.zombieRoleWorkflow.findFirstOrThrow({ where: { zombieLeagueId: f.z.id } })
    await respondBetaRoleWorkflow(f.league.id, row.id, users[1], 'decline', 0)
    expect(await prisma.zombieRoleWorkflow.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'review_required' })
    await expect(startBetaWhispererOffers(f.league.id, { actorId: users[2], nomineeId: users[2], reason: 'Reviewed volunteer' })).rejects.toThrow('owner')
    await startBetaWhispererOffers(f.league.id, { actorId: users[0], nomineeId: users[2], reason: 'Reviewed consenting volunteer' })
    expect(await prisma.whispererRecord.findUnique({ where: { zombieLeagueId: f.z.id } })).toBeNull()
    await respondBetaRoleWorkflow(f.league.id, row.id, users[2], 'accept', 1)
  })

  it.each(['spare', 'infect'])('Survivor bashing choice %s is atomic and repeatable', async decision => {
    const f = await fixture()
    const row = (await settled(f))!
    expect(row).toMatchObject({ kind: 'survivor_bash', deadlineAt: new Date('2026-11-05T02:00:00Z') })
    const itemCount = await prisma.zombieTeamItem.count({ where: { zombieLeagueId: f.z.id } })
    await Promise.all([respondBetaRoleWorkflow(f.league.id, row.id, users[0], decision), respondBetaRoleWorkflow(f.league.id, row.id, users[0], decision)])
    expect(await prisma.zombieLeagueTeam.findUniqueOrThrow({ where: { id: f.teams[1].id } })).toMatchObject({ status: decision === 'infect' ? 'Zombie' : 'Survivor' })
    expect(await prisma.zombieTeamItem.count({ where: { zombieLeagueId: f.z.id } })).toBe(itemCount)
    expect(await prisma.leagueChatMessage.count({ where: { id: `${row.id}:resolved` } })).toBe(1)
    await settleBetaCombat(f.z.id, 1)
    expect(await prisma.zombieBashingEvent.count({ where: { leagueId: f.league.id, week: 1 } })).toBe(1)
  })

  it.each(['spare', 'replace'])('Survivor bashing Whisperer: %s preserves the seasonal ambush budget', async decision => {
    const f = await fixture(['Survivor', 'Whisperer', 'Survivor', 'Survivor'])
    const row = (await settled(f))!
    expect(row.kind).toBe('whisperer_bash')
    await respondBetaRoleWorkflow(f.league.id, row.id, users[0], decision)
    const record = await prisma.whispererRecord.findUniqueOrThrow({ where: { zombieLeagueId: f.z.id } })
    expect(record).toMatchObject({ userId: decision === 'replace' ? users[0] : users[1], ambushesGranted: 2, ambushesUsed: 1, ambushesRemaining: 1 })
    expect(await prisma.zombieLeagueTeam.count({ where: { leagueId: f.league.id, status: 'Whisperer', isWhisperer: true } })).toBe(1)
    expect(await prisma.zombieLeagueTeam.findUniqueOrThrow({ where: { id: f.teams[1].id } })).toMatchObject({ status: decision === 'replace' ? 'Zombie' : 'Whisperer' })
  })

  it('defaults a bashing exactly at Wednesday 9 pm Eastern without allowing a late choice', async () => {
    const f = await fixture(['Survivor', 'Whisperer', 'Survivor', 'Survivor'])
    const row = (await settled(f))!
    vi.setSystemTime(row.deadlineAt!)
    await expect(respondBetaRoleWorkflow(f.league.id, row.id, users[0], 'replace')).rejects.toThrow('expired')
    await expireBetaRoleWorkflows()
    expect(await prisma.zombieBashingEvent.findUniqueOrThrow({ where: { id: (row.state as { eventId: string }).eventId } })).toMatchObject({ decisionMade: 'spare', defaultedToRule: true })
  })

  it('mauling without two serums ends the Whisperer role without choosing another Zombie', async () => {
    const f = await fixture(['Zombie', 'Whisperer', 'Survivor', 'Survivor'])
    const row = (await settled(f))!
    expect(row).toMatchObject({ kind: 'whisperer_maul', status: 'complete', decision: 'no_successor' })
    expect(await prisma.zombieLeagueTeam.count({ where: { leagueId: f.league.id, status: 'Whisperer' } })).toBe(0)
    expect(await prisma.whispererRecord.findUniqueOrThrow({ where: { zombieLeagueId: f.z.id } })).toMatchObject({ wasDefeated: true, ambushesRemaining: 0 })
  })

  it.each(['become_whisperer', 'decline'])('mauling with revival offers %s without a second serum debit', async decision => {
    const f = await fixture(['Zombie', 'Whisperer', 'Survivor', 'Survivor'])
    const row = (await settled(f, 100, 40, true))!
    expect(row.status).toBe('pending')
    expect(await prisma.zombieLeagueTeam.findUniqueOrThrow({ where: { id: f.teams[0].id } })).toMatchObject({ status: 'Survivor' })
    const spent = await prisma.zombieTeamItem.count({ where: { teamStatusId: f.teams[0].id, usedEffect: 'beta2025_revive', isUsed: true } })
    expect(spent).toBe(2)
    await respondBetaRoleWorkflow(f.league.id, row.id, users[0], decision)
    await respondBetaRoleWorkflow(f.league.id, row.id, users[0], decision)
    expect(await prisma.zombieTeamItem.count({ where: { teamStatusId: f.teams[0].id, usedEffect: 'beta2025_revive', isUsed: true } })).toBe(2)
    expect(await prisma.zombieLeagueTeam.findUniqueOrThrow({ where: { id: f.teams[0].id } })).toMatchObject({ status: decision === 'become_whisperer' ? 'Whisperer' : 'Survivor' })
    if (decision === 'become_whisperer') expect(await prisma.whispererRecord.findUniqueOrThrow({ where: { zombieLeagueId: f.z.id } })).toMatchObject({ userId: users[0], ambushesGranted: 2, ambushesUsed: 1, ambushesRemaining: 1 })
  })

  it('rejects another manager, another league and a correction-held decision', async () => {
    const f = await fixture(), foreign = await fixture()
    const row = (await settled(f))!
    await expect(respondBetaRoleWorkflow(f.league.id, row.id, users[1], 'infect')).rejects.toThrow('another manager')
    await expect(respondBetaRoleWorkflow(foreign.league.id, row.id, users[0], 'infect')).rejects.toThrow('another manager or league')
    await prisma.zombieWeeklyResolution.update({ where: { zombieLeagueId_week: { zombieLeagueId: f.z.id, week: 1 } }, data: { requiresStatCorrection: true } })
    await expect(respondBetaRoleWorkflow(f.league.id, row.id, users[0], 'infect')).rejects.toThrow('correction review')
    expect(await prisma.zombieRoleWorkflow.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'pending' })
  })

  it('rolls back role and decision writes when a later combat receipt update fails', async () => {
    const f = await fixture()
    const row = (await settled(f))!
    const original = row.state as Record<string, unknown>
    await prisma.zombieRoleWorkflow.update({ where: { id: row.id }, data: { state: toPrismaJsonInput({ ...original, eventId: 'missing-fixture-event' }) } })
    await expect(respondBetaRoleWorkflow(f.league.id, row.id, users[0], 'infect')).rejects.toThrow()
    expect(await prisma.zombieLeagueTeam.findUniqueOrThrow({ where: { id: f.teams[1].id } })).toMatchObject({ status: 'Survivor' })
    expect(await prisma.zombieRoleWorkflow.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'pending', decision: null })
    await prisma.zombieRoleWorkflow.update({ where: { id: row.id }, data: { state: toPrismaJsonInput(original) } })
    await respondBetaRoleWorkflow(f.league.id, row.id, users[0], 'infect')
  })

  it('defaults an unanswered revived mauler to no replacement Whisperer', async () => {
    const f = await fixture(['Zombie', 'Whisperer', 'Survivor', 'Survivor'])
    const row = (await settled(f, 100, 40, true))!
    vi.setSystemTime(row.deadlineAt!)
    await expireBetaRoleWorkflows(); await expireBetaRoleWorkflows()
    expect(await prisma.zombieRoleWorkflow.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'complete', decision: 'decline', decidedByUserId: null })
    expect(await prisma.zombieLeagueTeam.count({ where: { leagueId: f.league.id, status: 'Whisperer' } })).toBe(0)
  })

  it('remaps untouched matchups after another game started and charges a repeated request once', async () => {
    vi.setSystemTime(new Date('2026-10-30T12:00:00Z'))
    const f = await fixture(['Survivor', 'Survivor', 'Whisperer', 'Survivor', 'Survivor', 'Survivor'])
    for (let i = 0; i < 6; i++) await prisma.redraftRosterPlayer.create({ data: { rosterId: f.seasonRosters[i].id, playerId: `${marker}-${i}`, playerName: `Fixture ${i}`, sport: 'NFL', position: 'WR', team: i === 0 ? 'KC' : 'PIT', slotType: 'FLEX' } })
    const preview = await previewBetaAmbush(f.league.id, users[2])
    expect(preview.matches.find(m => m.id === f.matches[0].id)?.locked).toBe(true)
    const pairs = f.matches.map((m, i) => ({ homeRosterId: i === 1 ? f.seasonRosters[2].id : i === 2 ? f.seasonRosters[3].id : m.homeRosterId,
      awayRosterId: i === 1 ? f.seasonRosters[4].id : m.awayRosterId! }))
    const input = { leagueId: f.league.id, userId: users[2], week: 1, previewHash: preview.previewHash, requestId: randomUUID(), pairs }
    const results = await Promise.all([executeBetaAmbush(input), executeBetaAmbush(input)])
    expect(results.map(r => r.actionId)[0]).toBe(results[1].actionId)
    expect(await prisma.whispererRecord.findUniqueOrThrow({ where: { zombieLeagueId: f.z.id } })).toMatchObject({ ambushesRemaining: 0, ambushesUsed: 2 })
    expect(await prisma.redraftMatchup.findUniqueOrThrow({ where: { id: f.matches[0].id } })).toMatchObject({ homeRosterId: f.seasonRosters[0].id, awayRosterId: f.seasonRosters[1].id })
    expect(await prisma.zombieAmbushAction.count({ where: { zombieLeagueId: f.z.id } })).toBe(1)
    await expect(executeBetaAmbush({ ...input, pairs: [...pairs].reverse() })).rejects.toThrow('different ambush')
  })

  it('invalid remaps and missing/started starter times do not spend an ambush', async () => {
    vi.setSystemTime(new Date('2026-10-30T12:00:00Z'))
    const f = await fixture(['Whisperer', 'Survivor', 'Survivor', 'Survivor'])
    await prisma.redraftRosterPlayer.create({ data: { rosterId: f.seasonRosters[0].id, playerId: `${marker}-unknown`, playerName: 'Missing time', sport: 'NFL', position: 'WR', team: 'UNKNOWN', slotType: 'FLEX' } })
    const preview = await previewBetaAmbush(f.league.id, users[0])
    const pairs = [{ homeRosterId: f.seasonRosters[0].id, awayRosterId: f.seasonRosters[2].id }, { homeRosterId: f.seasonRosters[1].id, awayRosterId: f.seasonRosters[3].id }]
    await expect(executeBetaAmbush({ leagueId: f.league.id, userId: users[0], week: 1, requestId: randomUUID(), previewHash: preview.previewHash, pairs })).rejects.toThrow('locked')
    expect(await prisma.whispererRecord.findUniqueOrThrow({ where: { zombieLeagueId: f.z.id } })).toMatchObject({ ambushesRemaining: 1, ambushesUsed: 1 })
    expect(await prisma.zombieAmbushAction.count({ where: { zombieLeagueId: f.z.id } })).toBe(0)
  })

  it('rolls back the remap and ambush debit when the final chat receipt cannot be written', async () => {
    vi.setSystemTime(new Date('2026-10-30T12:00:00Z'))
    const f = await fixture(['Whisperer', 'Survivor', 'Survivor', 'Survivor'])
    const preview = await previewBetaAmbush(f.league.id, users[0]), requestId = randomUUID()
    const input = { leagueId: f.league.id, userId: users[0], week: 1, requestId, previewHash: preview.previewHash,
      pairs: [{ homeRosterId: f.seasonRosters[0].id, awayRosterId: f.seasonRosters[2].id }, { homeRosterId: f.seasonRosters[1].id, awayRosterId: f.seasonRosters[3].id }] }
    const noticeId = `ambush2025:${f.league.id}:${users[0]}:${requestId}:notice`
    await prisma.leagueChatMessage.create({ data: { id: noticeId, leagueId: f.league.id, userId: users[0], message: 'Fixture collision', type: 'host_announcement' } })
    await expect(executeBetaAmbush(input)).rejects.toThrow()
    expect(await prisma.whispererRecord.findUniqueOrThrow({ where: { zombieLeagueId: f.z.id } })).toMatchObject({ ambushesRemaining: 1, ambushesUsed: 1 })
    expect(await prisma.zombieAmbushAction.count({ where: { zombieLeagueId: f.z.id } })).toBe(0)
    expect(await prisma.redraftMatchup.findUniqueOrThrow({ where: { id: f.matches[0].id } })).toMatchObject({ homeRosterId: f.seasonRosters[0].id, awayRosterId: f.seasonRosters[1].id })
    await prisma.leagueChatMessage.delete({ where: { id: noticeId } })
    await executeBetaAmbush(input)
    expect(await prisma.whispererRecord.findUniqueOrThrow({ where: { zombieLeagueId: f.z.id } })).toMatchObject({ ambushesRemaining: 0, ambushesUsed: 2 })
  })
})
