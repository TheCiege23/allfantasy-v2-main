// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { captureZombieSettlementSnapshot } from '@/lib/zombie/weeklySettlementSnapshot'
import { betaItemBonus } from '@/lib/zombie/beta2025Items'
import { resolveWeeklyInfections } from '@/lib/zombie/infectionEngine'
import { settleBetaItems } from '@/lib/zombie/beta2025ItemSettlement'
import { settleBetaCombat, respondBetaRoleWorkflow } from '@/lib/zombie/beta2025RoleWorkflows'
import { settleWeeklyWinnings } from '@/lib/zombie/weeklyWinningsEngine'
import { prepareZombieCorrection, applyZombieCorrection, acknowledgeExternalCorrection, reconcileBetaCorrectionAutomatically } from '@/lib/zombie/beta2025CorrectionService'
import { previewBetaAmbush } from '@/lib/zombie/beta2025Ambush'
import { finishZombieCorrectionEffects } from '@/lib/zombie/correctionFollowup'
import { approveZombieWeeklyReport } from '@/lib/zombie/weeklyReportApproval'
import * as standings from '@/lib/redraft/standingsEngine'
import { assertLastStarterWindow } from '@/lib/zombie/beta2025ItemService'
import * as itemService from '@/lib/zombie/beta2025ItemService'
import { runWeeklyResolution } from '@/lib/zombie/weeklyResolutionEngine'
import { getZombieTradeRestriction } from '@/lib/zombie/zombieTradePolicy'
import { settleRedraftTradeAssets } from '@/lib/redraft/tradeSettlement'

const enabled = process.env.RUN_ZOMBIE_RECOVERY_DB === '1', marker = `recovery-qa-${randomUUID()}`
const users: string[] = [], leagues: string[] = []
let databaseApproved = false
const now = new Date('2026-11-03T12:00:00Z')
describe.skipIf(!enabled)('2025 reviewed correction recovery in disposable PostgreSQL', () => {
  beforeAll(async () => {
    for (const name of ['DATABASE_URL', 'DIRECT_URL']) if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(process.env[name] ?? '').hostname)) throw new Error('Disposable loopback PostgreSQL required')
    for (const name of ['DATABASE_URL', 'DIRECT_URL']) if (!['zombie_release', 'allfantasy_ci'].includes(new URL(process.env[name]!).pathname.slice(1))) throw new Error('An explicitly approved disposable database name is required')
    databaseApproved = true
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now)
    // CI's db push creates tables but not PostgreSQL triggers. Install the exact
    // migration invariant only after the loopback guard above has passed.
    const migration = readFileSync(resolve('prisma/migrations/20261102070000_zombie_correction_reviews/migration.sql'), 'utf8')
    const fn = migration.split('-- REPORT_HOLD_FUNCTION')[1].split('-- REPORT_HOLD_TRIGGER')[0]
    const trigger = migration.split('-- REPORT_HOLD_TRIGGER')[1]
    await prisma.$executeRawUnsafe(fn)
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS zombie_weekly_report_correction_hold ON zombie_announcements')
    await prisma.$executeRawUnsafe(trigger)
    for (let i = 0; i < 4; i++) users.push((await prisma.appUser.create({ data: { username: `${marker}-${i}`, email: `${marker}-${i}@example.invalid` } })).id)
    await prisma.sportsGame.createMany({ data: [1, 2].map(week => ({ sport: 'NFL', source: 'api_sports', externalId: `${marker}-${week}`, season: 2026, seasonType: 'regular', week,
      homeTeam: 'KC', awayTeam: 'BAL', startTime: new Date(week === 1 ? '2026-10-29T23:00:00Z' : '2026-11-05T23:00:00Z'), expiresAt: new Date('2027-01-01Z') })) })
  })
  beforeEach(() => vi.setSystemTime(now))
  afterAll(async () => {
    if (!databaseApproved) return
    if (leagues.length) {
      await prisma.zombieTeamItem.deleteMany({ where: { team: { leagueId: { in: leagues } } } })
      await prisma.zombieLeagueTeam.deleteMany({ where: { leagueId: { in: leagues } } })
      await prisma.zombieBashingEvent.deleteMany({ where: { leagueId: { in: leagues } } })
      await prisma.zombieMaulingEvent.deleteMany({ where: { leagueId: { in: leagues } } })
      await prisma.zombieAuditLog.deleteMany({ where: { leagueId: { in: leagues } } })
      await prisma.league.deleteMany({ where: { id: { in: leagues }, userId: users[0] } })
    }
    await prisma.sportsGame.deleteMany({ where: { externalId: { in: [`${marker}-1`, `${marker}-2`] } } })
    if (users.length) await prisma.appUser.deleteMany({ where: { id: { in: users }, username: { startsWith: marker } } })
    await prisma.$disconnect(); vi.restoreAllMocks(); vi.useRealTimers()
  }, 60_000)
  async function fixture(roles = ['Survivor', 'Zombie', 'Whisperer', 'Survivor']) {
    const league = await prisma.league.create({ data: { name: marker, userId: users[0], platform: 'manual', platformLeagueId: randomUUID(), sport: 'NFL', leagueType: 'zombie' } })
    leagues.push(league.id)
    const z = await prisma.zombieLeague.create({ data: { leagueId: league.id, status: 'active', sport: 'NFL', season: 2026, teamCount: 4, currentWeek: 1, totalWeeks: 18, whispererAmbushCount: 2, whispererIsPublic: false } })
    await prisma.zombieLeagueConfig.create({ data: { leagueId: league.id } })
    const season = await prisma.redraftSeason.create({ data: { leagueId: league.id, season: 2026, sport: 'NFL', totalWeeks: 18, currentWeek: 1, playoffStartWeek: 19 } })
    const rosters = [], seasonRosters = [], teams = []
    for (let i = 0; i < 4; i++) {
      const rr = await prisma.redraftRoster.create({ data: { leagueId: league.id, seasonId: season.id, ownerId: users[i], ownerName: `Manager ${i}`, teamName: `Team ${i}` } }); seasonRosters.push(rr)
      const r = await prisma.roster.create({ data: { leagueId: league.id, platformUserId: users[i], redraftRosterId: rr.id, playerData: {} } }); rosters.push(r)
      teams.push(await prisma.zombieLeagueTeam.create({ data: { leagueId: league.id, zombieLeagueId: z.id, rosterId: r.id, status: roles[i], isWhisperer: roles[i] === 'Whisperer',
        ambushesRemaining: roles[i] === 'Whisperer' ? 1 : 0, ambushesUsed: roles[i] === 'Whisperer' ? 1 : 0, fantasyTeamName: `Team ${i}`, weekBecameZombie: roles[i] === 'Zombie' ? 0 : null } }))
      if (roles[i] === 'Whisperer') await prisma.whispererRecord.create({ data: { zombieLeagueId: z.id, userId: users[i], displayName: `Team ${i}`, selectionMode: 'fixture', ambushesGranted: 2, ambushesRemaining: 1, ambushesUsed: 1 } })
    }
    return { league, z, season, rosters, seasonRosters, teams }
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>
  async function settle(f: Fixture, bases = [100, 90, 80, 70], week = 1) {
    await prisma.zombieLeague.update({ where: { id: f.z.id }, data: { currentWeek: week } })
    const teams = await prisma.zombieLeagueTeam.findMany({ where: { leagueId: f.league.id }, include: { items: true } })
    const matches = []
    for (let i = 0; i < 4; i += 2) {
      const t = (index: number) => teams.find(t => t.rosterId === f.rosters[index].id)!
      const h = betaItemBonus(t(i).rosterId, t(i).status, t(i).items, week), a = betaItemBonus(t(i + 1).rosterId, t(i + 1).status, t(i + 1).items, week)
      matches.push(await prisma.redraftMatchup.create({ data: { seasonId: f.season.id, leagueId: f.league.id, week, homeRosterId: f.seasonRosters[i].id, awayRosterId: f.seasonRosters[i + 1].id,
        status: 'final', homeScore: bases[i] + h.bonus, awayScore: bases[i + 1] + a.bonus, lineupSnapshots: toPrismaJsonInput({ zombieItems: { policy: 'beta_2025', home: { ...h, frozen: true }, away: { ...a, frozen: true }, homeBaseScore: bases[i], awayBaseScore: bases[i + 1] }, redraftScoring: { isComplete: true } }) } }))
    }
    const snapshot = await captureZombieSettlementSnapshot(f.league.id, f.z.id, 'NFL', week, 2026)
    await prisma.zombieWeeklyResolution.create({ data: { zombieLeagueId: f.z.id, week, status: 'resolving', matchupResults: [], newZombies: [], settlementSnapshot: toPrismaJsonInput(snapshot) } })
    const infection = await resolveWeeklyInfections(f.z.id, week)
    await settleBetaItems(f.z.id, week); await settleBetaCombat(f.z.id, week)
    const winnings = await settleWeeklyWinnings({ leagueId: f.league.id, zombieLeagueId: f.z.id, sport: 'NFL', season: 2026, week, infected: infection.infected })
    const horde = await prisma.zombieLeagueTeam.count({ where: { leagueId: f.league.id, status: 'Zombie' } })
    await prisma.whispererRecord.update({ where: { zombieLeagueId: f.z.id }, data: { hordeSizeAtPeak: horde } })
    await prisma.zombieWeeklyResolution.update({ where: { zombieLeagueId_week: { zombieLeagueId: f.z.id, week } }, data: { status: 'complete', resolvedAt: now,
      matchupResults: matches.map(m => ({ homeUserId: m.homeRosterId, awayUserId: m.awayRosterId, homeScore: m.homeScore, awayScore: m.awayScore })), winningsDistribution: winnings?.distribution } })
    await prisma.zombieLeague.update({ where: { id: f.z.id }, data: { currentWeek: week + 1 } })
    return matches
  }
  async function change(matchId: string, homeBaseScore: number) {
    const m = await prisma.redraftMatchup.findUniqueOrThrow({ where: { id: matchId } })
    const snapshots = m.lineupSnapshots as { zombieItems: { home: { bonus: number } } }
    await prisma.redraftMatchup.update({ where: { id: matchId }, data: { homeScore: homeBaseScore + snapshots.zombieItems.home.bonus,
      lineupSnapshots: toPrismaJsonInput({ ...snapshots, zombieItems: { ...snapshots.zombieItems, homeBaseScore } }) } })
  }
  const approve = (f: Fixture, r: { id: string; sourceHash: string }) => applyZombieCorrection(f.league.id, r.id, r.sourceHash, users[0], 'Reviewed the corrected provider scores and all consequences')

  it('replays a changed winner, infection, inventory and winnings together and holds new ambushes', async () => {
    const f = await fixture(), matches = await settle(f)
    await change(matches[0].id, 50)
    const r = await prepareZombieCorrection(f.league.id, 1, users[0])
    expect(r.status, JSON.stringify(r.plan)).toBe('ready')
    await expect(previewBetaAmbush(f.league.id, users[2])).rejects.toThrow('recovery')
    await expect(prisma.$transaction(tx => assertLastStarterWindow(tx, { leagueId: f.league.id, userId: users[0], week: 2 }))).rejects.toThrow('recovery')
    expect(await getZombieTradeRestriction(f.league.id, [f.rosters[0].id, f.rosters[2].id])).toBe('zombie_correction_hold')
    await expect(prisma.$transaction(tx => settleRedraftTradeAssets(tx, { leagueId: f.league.id, proposerRosterId: f.seasonRosters[0].id, receiverRosterId: f.seasonRosters[2].id, assets: [] }))).rejects.toThrow('recovery')
    await expect(prisma.zombieAnnouncement.create({ data: { zombieLeagueId: f.z.id, week: 1, type: 'weekly_update', title: 'Stale queued sender', content: 'Old result', isPosted: true } })).rejects.toThrow('ZOMBIE_CORRECTION_REPORT_HOLD')
    await Promise.all([approve(f, r), approve(f, r)])
    expect(await prisma.zombieLeagueTeam.findUniqueOrThrow({ where: { id: f.teams[0].id } })).toMatchObject({ status: 'Zombie', totalWinnings: 0 })
    expect(await prisma.zombieLeague.findUniqueOrThrow({ where: { id: f.z.id } })).toMatchObject({ correctionHoldFromWeek: null })
    expect(await prisma.zombieCorrectionReview.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: 'applied', effectsPending: true })
    expect(await prisma.leagueChatMessage.count({ where: { id: `zombie-correction:${r.id}` } })).toBe(1)
    expect(await prisma.zombieInfectionEvent.count({ where: { zombieLeagueId: f.z.id, week: 1 } })).toBe(2)
  })
  it('rejects a stale score preview without changing inventory, winnings or roles', async () => {
    const f = await fixture(), matches = await settle(f)
    await change(matches[0].id, 50)
    const r = await prepareZombieCorrection(f.league.id, 1, users[0])
    await change(matches[0].id, 40)
    await expect(approve(f, r)).rejects.toThrow('STALE_PREVIEW')
    expect(await prisma.zombieLeagueTeam.findUniqueOrThrow({ where: { id: f.teams[0].id } })).toMatchObject({ status: 'Survivor', totalWinnings: 4 })
    expect(await prisma.zombieCorrectionReview.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: 'ready' })
  })
  it('requires a current external reconciliation reference and preserves the payout record', async () => {
    const f = await fixture(), matches = await settle(f)
    const payout = await prisma.zombieExternalWeeklyPayout.create({ data: { zombieLeagueId: f.z.id, week: 1, winnerRosterId: f.rosters[0].id, amountCents: 1000, providerName: 'Other', recordedById: users[0] } })
    await change(matches[0].id, 50)
    const blocked = await prepareZombieCorrection(f.league.id, 1, users[0])
    expect(blocked.status).toBe('blocked')
    await acknowledgeExternalCorrection(f.league.id, blocked.id, payout.id, users[0], 'Provider-ref-42', 'Reconciled the recorded external prize with the provider')
    const r = await prepareZombieCorrection(f.league.id, 1, users[0])
    expect(r.status, JSON.stringify(r.plan)).toBe('ready')
    await approve(f, r)
    expect(await prisma.zombieExternalWeeklyPayout.findUniqueOrThrow({ where: { id: payout.id } })).toMatchObject({ amountCents: 1000, winnerRosterId: f.rosters[0].id, status: 'recorded' })
  })
  it('replays dependent settled weeks from the corrected opening roles, items and balances', async () => {
    const f = await fixture(), first = await settle(f)
    await settle(f, [110, 105, 100, 90], 2)
    await change(first[0].id, 50)
    const r = await prepareZombieCorrection(f.league.id, 1, users[0])
    expect(r.status, JSON.stringify(r.plan)).toBe('ready')
    expect((r.plan as { summary: unknown[] }).summary).toHaveLength(2)
    await approve(f, r)
    const second = await prisma.zombieWeeklyResolution.findUniqueOrThrow({ where: { zombieLeagueId_week: { zombieLeagueId: f.z.id, week: 2 } } })
    expect(second.requiresStatCorrection).toBe(false)
    expect((second.settlementSnapshot as { teams: Array<{ rosterId: string; status: string }> }).teams.find(t => t.rosterId === f.rosters[0].id)?.status).toBe('Zombie')
  })
  it('restores the original Whisperer when a corrected result invalidates an accepted replacement', async () => {
    const f = await fixture(['Survivor', 'Whisperer', 'Survivor', 'Survivor']), matches = await settle(f, [120, 40, 90, 89])
    const choice = await prisma.zombieRoleWorkflow.findFirstOrThrow({ where: { zombieLeagueId: f.z.id, kind: 'whisperer_bash' } })
    await respondBetaRoleWorkflow(f.league.id, choice.id, users[0], 'replace')
    await change(matches[0].id, 10)
    const r = await prepareZombieCorrection(f.league.id, 1, users[0])
    expect(r.status, JSON.stringify(r.plan)).toBe('ready')
    await approve(f, r)
    expect(await prisma.whispererRecord.findUniqueOrThrow({ where: { zombieLeagueId: f.z.id } })).toMatchObject({ userId: users[1], wasDefeated: false, ambushesRemaining: 1 })
    expect(await prisma.zombieRoleWorkflow.findMany({ where: { zombieLeagueId: f.z.id, kind: 'whisperer_bash' } })).toHaveLength(0)
  })
  it('retains an eligible accepted replacement and its remaining budget across a score correction', async () => {
    const f = await fixture(['Survivor', 'Whisperer', 'Survivor', 'Survivor']), matches = await settle(f, [120, 40, 90, 89])
    const choice = await prisma.zombieRoleWorkflow.findFirstOrThrow({ where: { zombieLeagueId: f.z.id, kind: 'whisperer_bash' } })
    await respondBetaRoleWorkflow(f.league.id, choice.id, users[0], 'replace')
    await change(matches[0].id, 119)
    const r = await prepareZombieCorrection(f.league.id, 1, users[0])
    expect(r.status, JSON.stringify(r.plan)).toBe('ready'); await approve(f, r)
    expect(await prisma.whispererRecord.findUniqueOrThrow({ where: { zombieLeagueId: f.z.id } })).toMatchObject({ userId: users[0], wasDefeated: false, ambushesRemaining: 1, ambushesUsed: 1 })
  })
  it('blocks post-settlement item changes and refuses nonowner or cross-league approvals', async () => {
    const f = await fixture(), matches = await settle(f)
    await change(matches[0].id, 50)
    await prisma.zombieTeamItem.create({ data: { teamStatusId: f.teams[0].id, zombieLeagueId: f.z.id, userId: users[0], itemType: 'serum', itemLabel: 'Commissioner grant' } })
    const r = await prepareZombieCorrection(f.league.id, 1, users[0])
    expect(r.status).toBe('blocked')
    await expect(applyZombieCorrection(f.league.id, r.id, r.sourceHash, users[1], 'Unauthorized recovery attempt')).rejects.toThrow('OWNER_REQUIRED')
    const other = await fixture(); await settle(other)
    await expect(applyZombieCorrection(other.league.id, r.id, r.sourceHash, users[0], 'Wrong league recovery attempt')).rejects.toThrow('different league')
  })
  it('refreshes linked corrected reports without duplicate delivery and keeps hidden identities private', async () => {
    const f = await fixture(), matches = await settle(f)
    await change(matches[0].id, 50)
    const r = await prepareZombieCorrection(f.league.id, 1, users[0]); await approve(f, r)
    await prisma.zombieLeague.update({ where: { id: f.z.id }, data: { whispererIsPublic: true } })
    const updateStandings = standings.updateStandings
    const visibilityChange = vi.spyOn(standings, 'updateStandings').mockImplementationOnce(async (...args) => {
      await prisma.zombieLeague.update({ where: { id: f.z.id }, data: { whispererIsPublic: false } })
      return updateStandings(...args)
    })
    try { await finishZombieCorrectionEffects(r.id) } finally { visibilityChange.mockRestore() }
    await finishZombieCorrectionEffects(r.id)
    const ann = await prisma.zombieAnnouncement.findUniqueOrThrow({ where: { idempotencyKey: `zombie-weekly:${f.z.id}:1` } })
    expect(ann.content).toContain('CORRECTED HORDE REPORT'); expect(ann.content).not.toContain('Team 2')
    expect(await prisma.leagueChatMessage.count({ where: { zombieWeeklyAnnouncementId: ann.id } })).toBe(1)
    expect(await prisma.zombieCorrectionReview.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ effectsPending: false })
  })
  it('rolls back all game changes if the final approval receipt fails, then allows a clean retry', async () => {
    const f = await fixture(), matches = await settle(f); await change(matches[0].id, 50)
    const r = await prepareZombieCorrection(f.league.id, 1, users[0])
    const fn = `qa_recovery_${randomUUID().replaceAll('-', '')}`
    if (!/^[a-z0-9_]+$/.test(fn) || !/^[a-f0-9-]+$/.test(r.id)) throw new Error('Unsafe fixture identifier')
    await prisma.$executeRawUnsafe(`CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."id" = '${r.id}' AND NEW."status" = 'applied' THEN RAISE EXCEPTION 'QA recovery receipt failure'; END IF; RETURN NEW; END $$`)
    try {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "${fn}" BEFORE UPDATE ON "zombie_correction_reviews" FOR EACH ROW EXECUTE FUNCTION "${fn}"()`)
      await expect(approve(f, r)).rejects.toThrow()
      expect(await prisma.zombieLeagueTeam.findUniqueOrThrow({ where: { id: f.teams[0].id } })).toMatchObject({ status: 'Survivor', totalWinnings: 4 })
      expect(await prisma.zombieCorrectionReview.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: 'ready', appliedAt: null })
      expect(await prisma.leagueChatMessage.count({ where: { id: `zombie-correction:${r.id}` } })).toBe(0)
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${fn}" ON "zombie_correction_reviews"`)
      await prisma.$executeRawUnsafe(`DROP FUNCTION "${fn}"()`)
    }
    await approve(f, r)
    expect(await prisma.zombieLeagueTeam.findUniqueOrThrow({ where: { id: f.teams[0].id } })).toMatchObject({ status: 'Zombie' })
  })
  it('retains a durable retry when derived standings fail after the atomic correction', async () => {
    const f = await fixture(), matches = await settle(f); await change(matches[0].id, 50)
    const r = await prepareZombieCorrection(f.league.id, 1, users[0]); await approve(f, r)
    const failure = vi.spyOn(standings, 'updateStandings').mockRejectedValueOnce(new Error('Temporary standings failure'))
    await expect(finishZombieCorrectionEffects(r.id)).rejects.toThrow('Temporary standings failure')
    expect(await prisma.zombieCorrectionReview.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ effectsPending: true, status: 'applied' })
    failure.mockRestore(); await finishZombieCorrectionEffects(r.id)
    expect(await prisma.zombieCorrectionReview.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ effectsPending: false })
  })
  it('invalidates mauling succession and refunds its revival spend when the corrected margin no longer earns a maul', async () => {
    const f = await fixture(['Zombie', 'Whisperer', 'Survivor', 'Survivor'])
    await prisma.zombieTeamItem.create({ data: { teamStatusId: f.teams[1].id, zombieLeagueId: f.z.id, userId: users[1], itemType: 'serum', itemLabel: 'Serum', acquiredAtWeek: 0 } })
    const matches = await settle(f, [100, 40, 300, 299])
    const choice = await prisma.zombieRoleWorkflow.findFirstOrThrow({ where: { zombieLeagueId: f.z.id, kind: 'whisperer_maul' } })
    await respondBetaRoleWorkflow(f.league.id, choice.id, users[0], 'become_whisperer')
    await change(matches[0].id, 99)
    const r = await prepareZombieCorrection(f.league.id, 1, users[0]); expect(r.status, JSON.stringify(r.plan)).toBe('ready'); await approve(f, r)
    expect(await prisma.whispererRecord.findUniqueOrThrow({ where: { zombieLeagueId: f.z.id } })).toMatchObject({ userId: users[1], wasDefeated: false, ambushesRemaining: 1 })
    expect(await prisma.zombieLeagueTeam.findUniqueOrThrow({ where: { id: f.teams[0].id } })).toMatchObject({ status: 'Zombie' })
    expect(await prisma.zombieTeamItem.count({ where: { zombieLeagueId: f.z.id, usedEffect: 'beta2025_revive', usedAtWeek: 1 } })).toBe(0)
  })
  it('posts one linked weekly report under concurrent and repeated commissioner approvals', async () => {
    const f = await fixture(); await settle(f)
    await Promise.all([approveZombieWeeklyReport(f.league.id, 1), approveZombieWeeklyReport(f.league.id, 1)])
    await approveZombieWeeklyReport(f.league.id, 1)
    const ann = await prisma.zombieAnnouncement.findUniqueOrThrow({ where: { idempotencyKey: `zombie-weekly:${f.z.id}:1` } })
    expect(ann.isPosted).toBe(true)
    expect(await prisma.leagueChatMessage.count({ where: { zombieWeeklyAnnouncementId: ann.id } })).toBe(1)
  })
  it('automatically reconciles a score-only change with identical roles, items, choices and winnings', async () => {
    const f = await fixture(), matches = await settle(f); await change(matches[0].id, 101)
    expect(await reconcileBetaCorrectionAutomatically(f.league.id, 1, users[0])).toMatchObject({ requiresStatCorrection: false })
    expect(await prisma.zombieLeague.findUniqueOrThrow({ where: { id: f.z.id } })).toMatchObject({ correctionHoldFromWeek: null })
    expect(await prisma.zombieCorrectionReview.findFirstOrThrow({ where: { zombieLeagueId: f.z.id } })).toMatchObject({ status: 'applied' })
  })
  it('uses the original Wednesday spare default for a newly earned bashing whose deadline has passed', async () => {
    const f = await fixture(['Survivor', 'Survivor', 'Whisperer', 'Survivor']), matches = await settle(f, [80, 70, 65, 60])
    vi.setSystemTime(new Date('2026-11-06T12:00:00Z')); await change(matches[0].id, 140)
    const r = await prepareZombieCorrection(f.league.id, 1, users[0]); expect(r.status, JSON.stringify(r.plan)).toBe('ready'); await approve(f, r)
    expect(await prisma.zombieRoleWorkflow.findFirstOrThrow({ where: { zombieLeagueId: f.z.id, kind: 'survivor_bash' } })).toMatchObject({ status: 'complete', decision: 'spare' })
    expect(await prisma.zombieLeagueTeam.findUniqueOrThrow({ where: { id: f.teams[1].id } })).toMatchObject({ status: 'Survivor' })
  })
  it('does not let an older follow-up overwrite a newer correction, even at the same clock timestamp', async () => {
    const f = await fixture(), matches = await settle(f); await change(matches[0].id, 50)
    const first = await prepareZombieCorrection(f.league.id, 1, users[0]); await approve(f, first)
    await change(matches[0].id, 101)
    const second = await prepareZombieCorrection(f.league.id, 1, users[0]); expect(second.status, JSON.stringify(second.plan)).toBe('ready'); await approve(f, second)
    expect(await finishZombieCorrectionEffects(first.id)).toMatchObject({ superseded: true })
    await finishZombieCorrectionEffects(second.id)
    const ann = await prisma.zombieAnnouncement.findUniqueOrThrow({ where: { idempotencyKey: `zombie-weekly:${f.z.id}:1` } })
    expect(ann.content).toContain('101.00')
    expect(await prisma.zombieLeague.findUniqueOrThrow({ where: { id: f.z.id } })).toMatchObject({ latestCorrectionReviewId: second.id })
  })
  it('does not require a new payout review for a score-only change whose consequences are identical', async () => {
    const f = await fixture(), matches = await settle(f)
    await prisma.zombieExternalWeeklyPayout.create({ data: { zombieLeagueId: f.z.id, week: 1, winnerRosterId: f.rosters[0].id, amountCents: 1000, providerName: 'Other', recordedById: users[0] } })
    await change(matches[0].id, 101)
    expect(await reconcileBetaCorrectionAutomatically(f.league.id, 1, users[0])).toMatchObject({ requiresStatCorrection: false })
    expect(await prisma.zombieExternalWeeklyPayout.count({ where: { zombieLeagueId: f.z.id, amountCents: 1000 } })).toBe(1)
  })
  it('repairs an older unlinked manual report in place and preserves its original text in the review', async () => {
    const f = await fixture(), matches = await settle(f)
    await prisma.zombieAnnouncement.create({ data: { zombieLeagueId: f.z.id, week: 1, type: 'weekly_update', title: 'Manual report', content: 'Original manual outcome', isPosted: true } })
    const old = await prisma.leagueChatMessage.create({ data: { leagueId: f.league.id, userId: users[0], type: 'host_announcement', message: 'Original manual outcome', metadata: { zombieWeeklyUpdate: true, week: 1 } } })
    await change(matches[0].id, 50)
    const r = await prepareZombieCorrection(f.league.id, 1, users[0]); expect(r.status, JSON.stringify(r.plan)).toBe('ready'); await approve(f, r)
    await finishZombieCorrectionEffects(r.id)
    const repaired = await prisma.leagueChatMessage.findUniqueOrThrow({ where: { id: old.id } })
    expect(repaired.message).toContain('CORRECTED HORDE REPORT'); expect(repaired.zombieWeeklyAnnouncementId).not.toBeNull()
    expect((r.source as { chat: Array<{ id: string; message: string }> }).chat.find(m => m.id === old.id)?.message).toBe('Original manual outcome')
    expect(await prisma.leagueChatMessage.count({ where: { leagueId: f.league.id, metadata: { path: ['zombieWeeklyUpdate'], equals: true } } })).toBe(1)
  })
  it('does not invalidate a review for an updatedAt-only polling touch', async () => {
    const f = await fixture(), matches = await settle(f); await change(matches[0].id, 50)
    const r = await prepareZombieCorrection(f.league.id, 1, users[0]); expect(r.status).toBe('ready')
    await prisma.zombieLeague.update({ where: { id: f.z.id }, data: { updatedAt: new Date(now.getTime() + 60_000) } })
    await approve(f, r)
    expect(await prisma.zombieCorrectionReview.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: 'applied' })
  })
  it('does not introduce a recovery hold while a dependent settlement is in flight', async () => {
    const f = await fixture(), matches = await settle(f); await change(matches[0].id, 50)
    await prisma.zombieWeeklyResolution.create({ data: { zombieLeagueId: f.z.id, week: 2, status: 'resolving', matchupResults: [], newZombies: [] } })
    const r = await prepareZombieCorrection(f.league.id, 1, users[0])
    expect(r.status).toBe('blocked')
    expect((r.plan as { blockers: string[] }).blockers.join(' ')).toContain('unfinished settlement')
    expect(await prisma.zombieLeague.findUniqueOrThrow({ where: { id: f.z.id } })).toMatchObject({ correctionHoldFromWeek: null })
    await expect(approve(f, r)).rejects.toThrow('dependencies')
  })
  it('rechecks the league hold under lock when recovery starts after settlement readiness was read', async () => {
    const f = await fixture(), matches = await settle(f); await change(matches[0].id, 50)
    await prisma.redraftMatchup.create({ data: { leagueId: f.league.id, seasonId: f.season.id, week: 2, status: 'final', homeRosterId: f.seasonRosters[0].id, awayRosterId: f.seasonRosters[1].id } })
    const beginRecovery = vi.spyOn(itemService, 'refreshItemScores').mockImplementationOnce(async () => {
      const r = await prepareZombieCorrection(f.league.id, 1, users[0]); expect(r.status).toBe('ready')
    })
    try {
      expect(await runWeeklyResolution(f.z.id, 2)).toMatchObject({ skipped: true, reason: 'stat_correction_reconciliation_required' })
      expect(beginRecovery).toHaveBeenCalledOnce()
    }
    finally { beginRecovery.mockRestore() }
    expect(await prisma.zombieWeeklyResolution.findUnique({ where: { zombieLeagueId_week: { zombieLeagueId: f.z.id, week: 2 } } })).toBeNull()
  })
  it.each(['active', 'final'])('rebuilds the current %s period passive receipt and permits its live base score to advance during review', async status => {
    const f = await fixture(), matches = await settle(f)
    const t = await prisma.zombieLeagueTeam.findUniqueOrThrow({ where: { id: f.teams[0].id }, include: { items: true } })
    const home = betaItemBonus(t.rosterId, t.status, t.items, 2), away = betaItemBonus(f.rosters[1].id, 'Zombie', [], 2)
    const live = await prisma.redraftMatchup.create({ data: { seasonId: f.season.id, leagueId: f.league.id, week: 2, status, homeRosterId: f.seasonRosters[0].id, awayRosterId: f.seasonRosters[1].id,
      homeScore: 20 + home.bonus, awayScore: 15, lineupSnapshots: toPrismaJsonInput({ zombieItems: { policy: 'beta_2025', home: { ...home, frozen: true }, away: { ...away, frozen: true }, homeBaseScore: 20, awayBaseScore: 15 } }) } })
    if (status === 'final') await prisma.zombieWeeklyResolution.create({ data: { zombieLeagueId: f.z.id, week: 2, status: 'pending', matchupResults: [], newZombies: [] } })
    await change(matches[0].id, 50)
    const r = await prepareZombieCorrection(f.league.id, 1, users[0]); expect(r.status, JSON.stringify(r.plan)).toBe('ready')
    expect((r.plan as { liveWeeksToRefresh: number[] }).liveWeeksToRefresh).toEqual([2])
    await change(live.id, 25)
    await approve(f, r)
    const updated = await prisma.redraftMatchup.findUniqueOrThrow({ where: { id: live.id } })
    expect(updated.homeScore).toBe(25)
    expect((updated.lineupSnapshots as { zombieItems: { home: { bonus: number } } }).zombieItems.home.bonus).toBe(0)
  })
})
