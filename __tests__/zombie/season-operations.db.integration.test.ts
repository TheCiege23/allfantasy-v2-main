// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { previewSeasonAccounting, approveSeasonAccounting, ownerRecoveryAction, governanceAction, readSeasonOperations, expireUniverseVotes, escalateOwnerContacts } from '@/lib/zombie/seasonOperations'
import { saveAcceptanceEvidence, sportAcceptanceEvidence } from '@/lib/zombie/acceptanceEvidence'
import { IPHONE_CHECKS } from '@/lib/zombie/acceptanceChecklist'
import { resolveLeagueMembership } from '@/lib/league-access'

const enabled = process.env.RUN_ZOMBIE_SEASON_DB === '1', users: string[] = [], leagues: string[] = [], universes: string[] = []
let approved = false
const clock = new Date('2026-11-03T12:00:00Z')
describe.skipIf(!enabled)('Zombie season operations in disposable PostgreSQL', () => {
  beforeAll(async () => {
    for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
      const url = new URL(process.env[key] ?? '')
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['zombie_release', 'allfantasy_ci'].includes(url.pathname.slice(1))) throw new Error('Explicit disposable loopback PostgreSQL required')
    }
    approved = true
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(clock)
    for (let i = 0; i < 6; i++) users.push((await prisma.appUser.create({ data: { username: `season-${randomUUID()}`, email: `${randomUUID()}@example.invalid` } })).id)
  })
  beforeEach(() => vi.setSystemTime(clock))
  afterAll(async () => {
    vi.useRealTimers()
    if (!approved) return
    await prisma.zombieOperationsRecord.deleteMany({ where: { OR: [{ scope: { in: [...leagues.map(l => `l:${l}`), ...universes.map(u => `u:${u}`)] } }, { actorUserId: { in: users } }] } })
    await prisma.platformNotification.deleteMany({ where: { userId: { in: users } } })
    await prisma.zombieTeamItem.deleteMany({ where: { userId: { in: users } } })
    await prisma.zombieLeagueTeam.deleteMany({ where: { leagueId: { in: leagues } } })
    await prisma.league.deleteMany({ where: { id: { in: leagues } } })
    await prisma.zombieUniverse.deleteMany({ where: { id: { in: universes } } })
    await prisma.appUser.deleteMany({ where: { id: { in: users } } })
    await prisma.$disconnect()
  })
  async function fixture(options: { universe?: boolean; weeks?: number; roles?: string[] } = {}) {
    const count = options.weeks ?? 1
    const universe = options.universe ? await prisma.zombieUniverse.create({ data: { name: 'Season QA universe', sport: 'NFL', commissionedByUserId: users[0], createdByUserId: users[0] } }) : null
    if (universe) universes.push(universe.id)
    const league = await prisma.league.create({ data: { userId: users[0], platformLeagueId: `season-qa-${randomUUID()}`, name: 'Season operations QA', platform: 'allfantasy', sport: 'NFL', leagueVariant: 'ZOMBIE', season: 2026, leagueSize: 4 } }); leagues.push(league.id)
    const z = await prisma.zombieLeague.create({ data: { leagueId: league.id, universeId: universe?.id, name: 'Season QA', sport: 'NFL', season: 2026, status: 'complete', totalWeeks: count, currentWeek: count + 1, isPaid: true } })
    await prisma.zombiePaidConfig.create({ data: { zombieLeagueId: z.id, buyInAmount: 25, totalCollected: 100, totalPot: 100, commissionerFeeRate: 0, paidUserIds: users.slice(0, 4) } })
    const season = await prisma.redraftSeason.create({ data: { leagueId: league.id, sport: 'NFL', season: 2026, totalWeeks: count, playoffStartWeek: count + 1, status: 'complete', currentWeek: count } })
    const rosters = []
    for (let i = 0; i < 4; i++) {
      const native = await prisma.redraftRoster.create({ data: { leagueId: league.id, seasonId: season.id, ownerId: users[i], ownerName: `Manager ${i}`, pointsFor: 100 + i } })
      const roster = await prisma.roster.create({ data: { leagueId: league.id, platformUserId: users[i], redraftRosterId: native.id, playerData: {} } }); rosters.push(roster)
      await prisma.zombieLeagueTeam.create({ data: { leagueId: league.id, rosterId: roster.id, zombieLeagueId: z.id, status: options.roles?.[i] ?? (i % 2 ? 'Zombie' : 'Survivor'), totalWinnings: 0 } })
      for (let week = 1; week <= count; week++) await prisma.zombieWeeklyWinnings.create({ data: { leagueId: league.id, zombieLeagueId: z.id, rosterId: roster.id, week, amount: 0, source: 'weekly_settlement_2025' } })
    }
    for (let week = 1; week <= count; week++) {
      await prisma.zombieWeeklyResolution.create({ data: { zombieLeagueId: z.id, week, status: 'complete', matchupResults: [], newZombies: [], resolvedAt: clock,
        settlementSnapshot: toPrismaJsonInput({ owners: rosters.map((r, i) => ({ rosterId: r.id, userId: users[i] })) }) } })
      for (let i = 0; i < 4; i += 2) await prisma.redraftMatchup.create({ data: { leagueId: league.id, seasonId: season.id, week, homeRosterId: rosters[i].redraftRosterId!, awayRosterId: rosters[i + 1].redraftRosterId!, status: 'final', homeScore: 100 + i, awayScore: 90 + i } })
    }
    return { league, z, season, rosters, universe }
  }
  const saved = (row: { payload: unknown }) => row.payload as { hash: string; plan: { blockers: string[]; leagues: Array<{ result: { owners: Array<{ amountCents: number }> } }> } }
  const approve = (f: Awaited<ReturnType<typeof fixture>>, r: Awaited<ReturnType<typeof previewSeasonAccounting>>) => approveSeasonAccounting(f.league.id, users[0], r.id, saved(r).hash, 'Reviewed recorded funding and every owner allocation')
  it('seals a real season source and records exactly one approval under concurrent retries', async () => {
    const f = await fixture(), r = await previewSeasonAccounting(f.league.id, users[0], {})
    expect(saved(r).plan.blockers).toEqual([])
    const receipts = await Promise.all([approve(f, r), approve(f, r)])
    expect(receipts[0].id).toBe(receipts[1].id)
    expect(await prisma.zombieOperationsRecord.count({ where: { scope: `l:${f.league.id}`, kind: 'accounting_close' } })).toBe(1)
    expect(saved(r).plan.leagues[0].result.owners.reduce((n, o) => n + o.amountCents, 0)).toBe(10_000)
  })
  it('rejects funding changes after review and a nonowner cannot read the private source', async () => {
    const f = await fixture(), r = await previewSeasonAccounting(f.league.id, users[0], {})
    await prisma.zombiePaidConfig.update({ where: { zombieLeagueId: f.z.id }, data: { totalCollected: 101 } })
    await expect(approve(f, r)).rejects.toThrow('Stale')
    await expect(previewSeasonAccounting(f.league.id, users[1], {})).rejects.toThrow('Head commissioner')
    const pack = await readSeasonOperations(f.league.id, users[1]); expect(pack.records.some(x => x.kind === 'accounting_review')).toBe(false)
  })
  it('refuses cross-universe approvals and unfinished or held seasons', async () => {
    const f = await fixture(), other = await fixture(), r = await previewSeasonAccounting(f.league.id, users[0], {})
    await expect(approveSeasonAccounting(other.league.id, users[0], r.id, saved(r).hash, 'Attempted wrong league accounting approval')).rejects.toThrow('different season')
    await prisma.zombieLeague.update({ where: { id: f.z.id }, data: { correctionHoldFromWeek: 1 } })
    const held = await previewSeasonAccounting(f.league.id, users[0], {}); expect(saved(held).plan.blockers.join(' ')).toContain('correction holds')
  })
  it('does not create refunds, transfers or payout-provider records when approving accounting', async () => {
    const f = await fixture(), r = await previewSeasonAccounting(f.league.id, users[0], {}); await approve(f, r)
    expect(await prisma.zombieExternalWeeklyPayout.count({ where: { zombieLeagueId: f.z.id } })).toBe(0)
    expect(await prisma.zombiePaidConfig.findUniqueOrThrow({ where: { zombieLeagueId: f.z.id } })).toMatchObject({ totalCollected: 100, totalPaidOut: 0 })
  })
  it('preserves a prior allocation and requires a new external reference for a changed approval', async () => {
    const f = await fixture(), first = await previewSeasonAccounting(f.league.id, users[0], {}); await approve(f, first)
    expect((await previewSeasonAccounting(f.league.id, users[0], {})).kind).toBe('accounting_close')
    await prisma.zombiePaidConfig.update({ where: { zombieLeagueId: f.z.id }, data: { totalCollected: 101 } })
    const blocked = await previewSeasonAccounting(f.league.id, users[0], {})
    expect(saved(blocked).plan.blockers.join(' ')).toContain('already approved allocation')
    await expect(approve(f, blocked)).rejects.toThrow('external reconciliation')
    const revised = await previewSeasonAccounting(f.league.id, users[0], { previousAllocationReference: 'external-reviewed-2026-11-03' })
    expect(saved(revised).plan.blockers).toEqual([]); await approve(f, revised)
    const history = await prisma.zombieOperationsRecord.findMany({ where: { scope: `l:${f.league.id}`, kind: 'accounting_history' } })
    expect(history).toHaveLength(1); expect(history[0].payload).toMatchObject({ previous: { hash: saved(first).hash } })
    expect((await previewSeasonAccounting(f.league.id, users[0], {})).kind).toBe('accounting_close')
  })
  it('carries the reconciled Alpha pot into the next season exactly once', async () => {
    const f = await fixture({ universe: true, roles: ['Zombie', 'Zombie', 'Zombie', 'Zombie'] })
    const alpha = await prisma.zombieUniverseLevel.create({ data: { universeId: f.universe!.id, name: 'Alpha', tierLabel: 'Alpha', rankOrder: 3 } })
    await prisma.zombieLeague.update({ where: { id: f.z.id }, data: { levelId: alpha.id, ultimateSurvivorPot: true } })
    const funding = { ultimateOpeningCents: 10_000, ultimateContributionsConfirmed: true, ultimateReference: 'Alpha-provider-record-2026' }
    const first = await previewSeasonAccounting(f.league.id, users[0], funding); expect(saved(first).plan.blockers).toEqual([]); await approve(f, first)
    expect((first.payload as { plan: { ultimate: unknown } }).plan.ultimate).toMatchObject({ contributionsCents: 2000, closingCents: 12_000 })
    const next = await fixture({ roles: ['Zombie', 'Zombie', 'Zombie', 'Zombie'] })
    await prisma.league.update({ where: { id: next.league.id }, data: { season: 2027 } })
    await prisma.redraftSeason.update({ where: { id: next.season.id }, data: { season: 2027 } })
    await prisma.zombieLeague.update({ where: { id: next.z.id }, data: { universeId: f.universe!.id, levelId: alpha.id, season: 2027, ultimateSurvivorPot: true } })
    const second = await previewSeasonAccounting(next.league.id, users[0], { ultimateContributionsConfirmed: true, ultimateReference: 'Alpha-provider-record-2027' })
    expect(saved(second).plan.blockers).toEqual([])
    expect((second.payload as { plan: { ultimate: unknown } }).plan.ultimate).toMatchObject({ openingCents: 12_000, contributionsCents: 2000, closingCents: 14_000 })
    await approve(next, second); await approve(next, second)
    expect(await prisma.zombieOperationsRecord.count({ where: { scope: `u:${f.universe!.id}`, season: 2027, kind: 'accounting_close' } })).toBe(1)
  })
  it('requires separate external-prize classification before approving a mixed ledger', async () => {
    const f = await fixture()
    await prisma.zombieExternalWeeklyPayout.create({ data: { zombieLeagueId: f.z.id, week: 1, winnerRosterId: f.rosters[0].id, amountCents: 1000, providerName: 'Other', recordedById: users[0] } })
    expect(saved(await previewSeasonAccounting(f.league.id, users[0], {})).plan.blockers.join(' ')).toContain('Confirm whether external')
    expect(saved(await previewSeasonAccounting(f.league.id, users[0], { externalWeeklyIncludedInLedger: false })).plan.blockers).toEqual([])
  })
  it('contacts once, waits 48 hours, and a continuing owner can prevent replacement', async () => {
    const f = await fixture({ weeks: 2 }); await prisma.zombieLeague.update({ where: { id: f.z.id }, data: { status: 'active', totalWeeks: 18 } })
    const input = { rosterId: f.rosters[1].id, reason: 'No active lineup; please confirm you are continuing' }
    await ownerRecoveryAction(f.league.id, users[0], 'contact', input); await ownerRecoveryAction(f.league.id, users[0], 'contact', input)
    expect(await prisma.platformNotification.count({ where: { leagueId: f.league.id, userId: users[1], type: 'zombie_owner_contact' } })).toBe(1)
    await expect(ownerRecoveryAction(f.league.id, users[0], 'replace', { ...input, newUserId: users[4] })).rejects.toThrow('48-hour')
    await ownerRecoveryAction(f.league.id, users[1], 'respond', { rosterId: f.rosters[1].id })
    vi.setSystemTime(new Date(clock.getTime() + 172_800_001))
    await expect(ownerRecoveryAction(f.league.id, users[0], 'replace', { ...input, newUserId: users[4] })).rejects.toThrow('48-hour')
  })
  it('transfers a late replacement atomically, preserves ownership history and retries once', async () => {
    const f = await fixture({ weeks: 10 }); await prisma.zombieLeague.update({ where: { id: f.z.id }, data: { status: 'active', totalWeeks: 18 } })
    await prisma.leagueTeam.create({ data: { leagueId: f.league.id, externalId: f.rosters[1].id, ownerName: 'Manager 1', teamName: 'Team 1', platformUserId: users[1], claimedByUserId: users[1], isCoCommissioner: true } })
    await prisma.redraftLeagueMember.create({ data: { leagueId: f.league.id, userId: users[1], role: 'MEMBER' } })
    const input = { rosterId: f.rosters[1].id, reason: 'No reply after the full participation notice window', newUserId: users[4] }
    await ownerRecoveryAction(f.league.id, users[0], 'contact', input); vi.setSystemTime(new Date(clock.getTime() + 172_800_001))
    await ownerRecoveryAction(f.league.id, users[0], 'replace', input); await ownerRecoveryAction(f.league.id, users[0], 'replace', input)
    expect(await prisma.roster.findUniqueOrThrow({ where: { id: f.rosters[1].id } })).toMatchObject({ platformUserId: users[4] })
    expect(await prisma.redraftRoster.findUniqueOrThrow({ where: { id: f.rosters[1].redraftRosterId! } })).toMatchObject({ ownerId: users[4] })
    expect(await resolveLeagueMembership(f.league.id, users[1])).toMatchObject({ ok: false, reason: 'not_member' })
    expect(await resolveLeagueMembership(f.league.id, users[4])).toMatchObject({ ok: true, access: { isCommissioner: false } })
    expect(await prisma.leagueTeam.findUniqueOrThrow({ where: { leagueId_externalId: { leagueId: f.league.id, externalId: f.rosters[1].id } } })).toMatchObject({ isCoCommissioner: false })
    const replacement = await prisma.zombieOperationsRecord.findMany({ where: { scope: `l:${f.league.id}`, kind: 'replacement' } })
    expect(replacement).toHaveLength(1); expect(replacement[0].payload).toMatchObject({ startWeek: 11, mustStartGamma: true, refundIssued: false })
    const history = await prisma.zombieOperationsRecord.findUniqueOrThrow({ where: { id: `stints:${f.league.id}:${f.rosters[1].id}:2026` } })
    expect(history.payload).toMatchObject({ stints: [{ userId: users[1], startWeek: 1, endWeek: 10 }, { userId: users[4], startWeek: 11, endWeek: null }] })
  })
  it('rejects an owner already seated elsewhere in the universe', async () => {
    const f = await fixture({ universe: true }); await prisma.zombieLeague.update({ where: { id: f.z.id }, data: { status: 'active', totalWeeks: 18 } })
    const input = { rosterId: f.rosters[1].id, reason: 'Participation notice followed by replacement review', newUserId: users[2] }
    await ownerRecoveryAction(f.league.id, users[0], 'contact', input); vi.setSystemTime(new Date(clock.getTime() + 172_800_001))
    await expect(ownerRecoveryAction(f.league.id, users[0], 'replace', input)).rejects.toThrow('one league')
  })
  it('rolls back every ownership and membership change if the final replacement receipt fails', async () => {
    const f = await fixture(); await prisma.zombieLeague.update({ where: { id: f.z.id }, data: { status: 'active', totalWeeks: 18 } })
    const input = { rosterId: f.rosters[1].id, reason: 'Participation has been reviewed after the full notice period', newUserId: users[4] }
    await ownerRecoveryAction(f.league.id, users[0], 'contact', input); vi.setSystemTime(new Date(clock.getTime() + 172_800_001))
    const fn = `qa_owner_${randomUUID().replaceAll('-', '')}`
    if (!/^[a-z0-9_]+$/.test(fn) || !/^[a-f0-9-]+$/.test(f.league.id)) throw new Error('Unsafe fixture identifier')
    await prisma.$executeRawUnsafe(`CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."kind" = 'replacement' AND NEW."scope" = 'l:${f.league.id}' THEN RAISE EXCEPTION 'QA owner receipt failure'; END IF; RETURN NEW; END $$`)
    try {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "${fn}" BEFORE INSERT ON zombie_operations_records FOR EACH ROW EXECUTE FUNCTION "${fn}"()`)
      await expect(ownerRecoveryAction(f.league.id, users[0], 'replace', input)).rejects.toThrow()
      expect(await prisma.roster.findUniqueOrThrow({ where: { id: f.rosters[1].id } })).toMatchObject({ platformUserId: users[1] })
      expect(await prisma.redraftRoster.findUniqueOrThrow({ where: { id: f.rosters[1].redraftRosterId! } })).toMatchObject({ ownerId: users[1] })
      expect(await prisma.zombieOperationsRecord.count({ where: { scope: `l:${f.league.id}`, kind: 'owner_stints' } })).toBe(0)
      expect(await prisma.redraftLeagueMember.count({ where: { leagueId: f.league.id, userId: users[4] } })).toBe(0)
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${fn}" ON zombie_operations_records`)
      await prisma.$executeRawUnsafe(`DROP FUNCTION "${fn}"()`)
    }
  })
  it('escalates an unanswered notice once without removing its owner', async () => {
    const f = await fixture(); await prisma.zombieLeague.update({ where: { id: f.z.id }, data: { status: 'active', totalWeeks: 18 } })
    await ownerRecoveryAction(f.league.id, users[0], 'contact', { rosterId: f.rosters[1].id, reason: 'Please confirm participation after a missed lineup' })
    vi.setSystemTime(new Date(clock.getTime() + 172_800_001)); await escalateOwnerContacts(); await escalateOwnerContacts()
    expect(await prisma.platformNotification.count({ where: { leagueId: f.league.id, type: 'zombie_owner_recovery' } })).toBe(1)
    expect(await prisma.roster.findUniqueOrThrow({ where: { id: f.rosters[1].id } })).toMatchObject({ platformUserId: users[1] })
  })
  it('opens a vote only after a distinct second, waits 24 hours, and excludes abstentions', async () => {
    const f = await fixture({ universe: true })
    const proposal = await governanceAction(f.league.id, users[0], 'propose', { title: 'Next season scoring', text: 'Review the scoring policy for the following season only.', denominator: 'votes_cast' })
    await expect(governanceAction(f.league.id, users[0], 'second', { proposalId: proposal.id })).rejects.toThrow('different owner')
    await governanceAction(f.league.id, users[1], 'second', { proposalId: proposal.id })
    for (let i = 0; i < 4; i++) await governanceAction(f.league.id, users[i], 'vote', { proposalId: proposal.id, choice: i === 3 ? 'abstain' : 'yes' })
    await expect(governanceAction(f.league.id, users[0], 'finalize', { proposalId: proposal.id })).rejects.toThrow('24-hour')
    vi.setSystemTime(new Date(clock.getTime() + 86_400_001)); await expireUniverseVotes()
    const result = await prisma.zombieOperationsRecord.findUniqueOrThrow({ where: { id: proposal.id } })
    expect(result.payload).toMatchObject({ status: 'passed_for_next_season', effectiveSeason: 2027, result: { yes: 3, no: 0, abstain: 1, counted: 3, passed: true } })
    await expect(governanceAction(f.league.id, users[1], 'vote', { proposalId: proposal.id, choice: 'no' })).rejects.toThrow('closed')
  })
  it('changes one ballot before close, refuses outsiders and does not change live league rules', async () => {
    const f = await fixture({ universe: true }), before = await prisma.league.findUniqueOrThrow({ where: { id: f.league.id } })
    const p = await governanceAction(f.league.id, users[0], 'propose', { title: 'Proposed future rule', text: 'A rule proposal that requires commissioner implementation next year.', denominator: 'votes_cast' })
    await governanceAction(f.league.id, users[1], 'second', { proposalId: p.id })
    await governanceAction(f.league.id, users[2], 'vote', { proposalId: p.id, choice: 'no' }); await governanceAction(f.league.id, users[2], 'vote', { proposalId: p.id, choice: 'yes' })
    expect(await prisma.zombieOperationsRecord.count({ where: { scope: `u:${f.universe!.id}`, kind: 'ballot' } })).toBe(1)
    await expect(governanceAction(f.league.id, users[5], 'vote', { proposalId: p.id, choice: 'yes' })).rejects.toThrow('membership')
    expect((await prisma.league.findUniqueOrThrow({ where: { id: f.league.id } })).settings).toEqual(before.settings)
  })
  it('records each manager consent without starting a draft and allows withdrawal', async () => {
    const f = await fixture()
    await saveAcceptanceEvidence(f.league.id, users[1], { type: 'consent', consents: true }); await saveAcceptanceEvidence(f.league.id, users[1], { type: 'consent', consents: false })
    expect(await prisma.zombieOperationsRecord.findUniqueOrThrow({ where: { id: `consent:${f.league.id}:2026:${users[1]}` } })).toMatchObject({ payload: { consents: false } })
    expect(await prisma.draftSession.count({ where: { leagueId: f.league.id } })).toBe(0)
  })
  it('will not infer a real-manager pass from a completed fixture or an incomplete iPhone checklist', async () => {
    const f = await fixture()
    await expect(saveAcceptanceEvidence(f.league.id, users[0], { type: 'real_week', week: 1, note: 'This fixture does not establish live manager acceptance.' })).rejects.toThrow('Two consenting')
    await expect(saveAcceptanceEvidence(f.league.id, users[1], { type: 'iphone', device: 'iPhone', ios: '20.0', note: 'Only a screenshot was checked, not a physical device.', checks: {} })).rejects.toThrow('every check')
  })
  it('reports all seven sports and invalidates calibration when its saved configuration changes', async () => {
    const f = await fixture(); await prisma.zombieLeagueConfig.create({ data: { leagueId: f.league.id } })
    await saveAcceptanceEvidence(f.league.id, users[0], { type: 'sport_calibration', note: 'Controlled fixture review of actual saved settings only.', providerCalendarReviewed: true, itemEffectsReviewed: true, thresholdsReviewed: true })
    let report = await sportAcceptanceEvidence(f.league.id, users[0])
    expect(report.map(r => r.sport)).toEqual(['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'])
    expect(report.find(r => r.sport === 'NFL')?.calibrationRecorded).toBe(true)
    await prisma.zombieLeagueConfig.update({ where: { leagueId: f.league.id }, data: { infectionLossToZombie: false } })
    report = await sportAcceptanceEvidence(f.league.id, users[0]); expect(report.find(r => r.sport === 'NFL')?.calibrationRecorded).toBe(false)
  })
  it('lets a later iPhone issue supersede an earlier pass without timestamp ambiguity', async () => {
    const f = await fixture(), checks = Object.fromEntries(IPHONE_CHECKS.map(k => [k, true]))
    const input = { type: 'iphone', device: 'iPhone controlled test', ios: 'test-only', note: 'Controlled test of attestation ordering, not physical acceptance.', checks }
    const first = await saveAcceptanceEvidence(f.league.id, users[1], input)
    const second = await saveAcceptanceEvidence(f.league.id, users[1], { ...input, checks: { ...checks, safeAreas: false } })
    expect(second.createdAt.getTime()).toBeGreaterThan(first.createdAt.getTime())
    expect((await sportAcceptanceEvidence(f.league.id, users[0])).find(r => r.sport === 'NFL')?.iphoneAccepted).toBe(false)
  })
})
