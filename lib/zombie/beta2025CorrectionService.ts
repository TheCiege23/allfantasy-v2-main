import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { combatTransaction } from './beta2025CombatTransaction'
import { lockItemLeague } from './beta2025ItemService'
import { betaCombatDeadline } from './beta2025CombatPolicy'
import { trustedZombieWeekStart } from './zombieWeekGameStart'
import { parseZombieSettlementSnapshot, type ZombieSettlementSnapshotV1 as Snapshot } from './weeklySettlementSnapshot'
import { readBetaItemMatchup } from './beta2025ItemSettlement'
import { betaItemBonus } from './beta2025Items'
import { correctionHash, correctionStateShape, planBetaCorrection, type CorrectionPlan, type CorrectionWeekInput, type RecordedChoice, type ReplayItem, type ReplayWhisperer } from './beta2025CorrectionPlan'

type Tx = Prisma.TransactionClient
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value))
export class ZombieRecoveryError extends Error {}
const teamState = (t: Snapshot['teams'][number]): Snapshot['teams'][number] => ({ id: t.id, rosterId: t.rosterId, status: t.status,
  weekBecameZombie: t.weekBecameZombie, killedByRosterId: t.killedByRosterId, revivedAt: t.revivedAt ? String(t.revivedAt) : null,
  ambushesRemaining: t.ambushesRemaining, ambushesUsed: t.ambushesUsed, infectionCount: t.infectionCount, isWhisperer: t.isWhisperer,
  killedAtWeek: t.killedAtWeek, killedByUserId: t.killedByUserId, survivorWinStreak: t.survivorWinStreak, zombieAttacksSurvived: t.zombieAttacksSurvived })
const itemState = (i: ReplayItem): ReplayItem => ({ id: i.id, teamStatusId: i.teamStatusId, userId: i.userId, itemType: i.itemType, itemLabel: i.itemLabel,
  isUsed: i.isUsed, isExpired: i.isExpired, activationState: i.activationState, activatesAtWeek: i.activatesAtWeek, usedAtWeek: i.usedAtWeek,
  usedOnUserId: i.usedOnUserId, usedEffect: i.usedEffect, acquiredAtWeek: i.acquiredAtWeek, awardKey: i.awardKey, acquiredReason: i.acquiredReason })

async function collect(tx: Tx, leagueId: string, fromWeek: number, actorId: string) {
  const z = await tx.zombieLeague.findUniqueOrThrow({ where: { leagueId }, include: { league: { select: { userId: true } } } })
  if (z.league.userId !== actorId) throw new ZombieRecoveryError('OWNER_REQUIRED')
  if (z.sport !== 'NFL') throw new ZombieRecoveryError('2025 NFL recovery is required; other sports keep their existing correction workflow.')
  if (!Number.isInteger(fromWeek) || fromWeek < 1 || fromWeek > 18) throw new ZombieRecoveryError('Choose a valid NFL week.')
  const season = await tx.redraftSeason.findFirstOrThrow({ where: { leagueId, season: z.season } })
  const [resolutions, teams, items, whisperer, coWhisperers, rosters, seasonRosters, matches, ledger, choices, payouts, announcements, acknowledgements, earlierHolds] = await Promise.all([
    tx.zombieWeeklyResolution.findMany({ where: { zombieLeagueId: z.id, week: { gte: fromWeek } }, orderBy: { week: 'asc' }, take: 19 }),
    tx.zombieLeagueTeam.findMany({ where: { leagueId }, orderBy: { id: 'asc' } }),
    tx.zombieTeamItem.findMany({ where: { zombieLeagueId: z.id }, orderBy: { id: 'asc' } }),
    tx.whispererRecord.findUnique({ where: { zombieLeagueId: z.id } }),
    tx.zombieCoWhisperer.findMany({ where: { zombieLeagueId: z.id }, orderBy: { id: 'asc' } }),
    tx.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true, redraftRosterId: true }, orderBy: { id: 'asc' } }),
    tx.redraftRoster.findMany({ where: { seasonId: season.id }, orderBy: { id: 'asc' } }),
    tx.redraftMatchup.findMany({ where: { seasonId: season.id, week: { gte: fromWeek } }, orderBy: [{ week: 'asc' }, { id: 'asc' }] }),
    tx.zombieWeeklyWinnings.findMany({ where: { leagueId }, orderBy: [{ week: 'asc' }, { rosterId: 'asc' }] }),
    tx.zombieRoleWorkflow.findMany({ where: { zombieLeagueId: z.id, week: { gte: fromWeek } }, orderBy: { id: 'asc' } }),
    tx.zombieExternalWeeklyPayout.findMany({ where: { zombieLeagueId: z.id, week: { gte: fromWeek } }, orderBy: { week: 'asc' } }),
    tx.zombieAnnouncement.findMany({ where: { zombieLeagueId: z.id, week: { gte: fromWeek } }, orderBy: { id: 'asc' } }),
    tx.zombieAuditLog.findMany({ where: { leagueId, eventType: 'external_correction_reconciled' }, orderBy: { id: 'asc' } }),
    tx.zombieWeeklyResolution.count({ where: { zombieLeagueId: z.id, week: { lt: fromWeek }, OR: [{ requiresStatCorrection: true }, { status: { not: 'complete' } }] } }),
  ])
  const chat = await tx.leagueChatMessage.findMany({ where: { leagueId, OR: [
    { zombieWeeklyAnnouncementId: { in: announcements.map(a => a.id) } },
    { id: { startsWith: `choice:${z.id}:` } },
    { AND: [{ metadata: { path: ['zombieWeeklyUpdate'], equals: true } }, { metadata: { path: ['week'], gte: fromWeek } }] },
  ] }, orderBy: { id: 'asc' } })
  const [infectionEvents, infectionLogs, bashings, maulings] = await Promise.all([
    tx.zombieInfectionEvent.findMany({ where: { zombieLeagueId: z.id, week: { gte: fromWeek } }, orderBy: { id: 'asc' } }),
    tx.zombieInfectionLog.findMany({ where: { leagueId, week: { gte: fromWeek } }, orderBy: { id: 'asc' } }),
    tx.zombieBashingEvent.findMany({ where: { leagueId, week: { gte: fromWeek } }, orderBy: { id: 'asc' } }),
    tx.zombieMaulingEvent.findMany({ where: { leagueId, week: { gte: fromWeek } }, orderBy: { id: 'asc' } }),
  ])
  const clocks = []
  for (const r of resolutions) clocks.push({ week: r.week, kickoff: (await trustedZombieWeekStart('NFL', z.season, r.week, tx))?.toISOString() ?? null })
  return json({ z, season, resolutions, teams, items, whisperer, coWhisperers, rosters, seasonRosters, matches, ledger, choices, payouts, announcements, chat, clocks, acknowledgements, earlierHolds, infectionEvents, infectionLogs, bashings, maulings })
}
type Source = Awaited<ReturnType<typeof collect>>
type SavedPlan = CorrectionPlan & { externalReviews: Array<{ payoutId: string; week: number; key: string }>; safeAutomatic: boolean; liveWeeksToRefresh: number[] }
const reviewedSourceHash = (source: Source, plan: SavedPlan) => correctionHash({
  // A polling job touching only @updatedAt does not change a reviewed consequence.
  // All business values and original timestamps remain in the saved before-state.
  source: JSON.parse(JSON.stringify({ ...source,
    teams: source.teams.map(t => ({ ...teamState(json(t) as unknown as Snapshot['teams'][number]), totalWinnings: t.totalWinnings, weeklyWinnings: t.weeklyWinnings })),
    seasonRosters: source.seasonRosters.map(r => ({ id: r.id, ownerId: r.ownerId, teamName: r.teamName })),
    matches: source.matches.map(m => ({ id: m.id, week: m.week, homeRosterId: m.homeRosterId, awayRosterId: m.awayRosterId, isMedianMatchup: m.isMedianMatchup,
      ...(plan.weeks.some(w => w.week === m.week) ? { status: m.status, homeScore: m.homeScore, awayScore: m.awayScore, zombieItems: (m.lineupSnapshots as { zombieItems?: unknown } | null)?.zombieItems } : {}) })),
  }, (key, value) => key === 'updatedAt' ? undefined : value)),
  deadlines: plan.weeks.flatMap(w => w.choices.map(c => [c.id, c.status, c.decision])),
})

function build(source: Source, fromWeek: number, now: Date): SavedPlan {
  const blockers: string[] = [], weeks: CorrectionWeekInput[] = []
  const root = source.resolutions.find(r => r.week === fromWeek)
  if (!root || root.status !== 'complete') blockers.push('The source week must have completed settlement. An active or interrupted settlement must finish before stat-correction replay.')
  if (source.earlierHolds) blockers.push('Resolve earlier held weeks first so opening winnings and roles have one authoritative history.')
  if (source.z.correctionHoldFromWeek != null && source.z.correctionHoldFromWeek < fromWeek) blockers.push(`Finish the existing recovery from Week ${source.z.correctionHoldFromWeek} before approving a later week.`)
  if (source.coWhisperers.length) blockers.push('2025 NFL recovery requires one Whisperer seat; legacy co-Whisperers require policy review.')
  const powers = source.whisperer?.activePowers
  if (powers && (Array.isArray(powers) ? powers.length > 0 : typeof powers === 'object' && Object.keys(powers).length > 0)) blockers.push('Legacy Whisperer powers require policy review before a 2025 correction can replace their state.')
  if (source.ledger.some(r => r.source !== 'weekly_settlement_2025')) blockers.push('A winnings ledger row uses an older rules policy. Reconcile that policy before the 2025 replay.')
  for (const r of source.resolutions) {
    if (r.status !== 'complete') { if (r.week !== fromWeek && !(r.status === 'pending' && !r.settlementSnapshot)) blockers.push(`Week ${r.week} has an unfinished settlement.`); continue }
    const snapshot = parseZombieSettlementSnapshot(r.settlementSnapshot)
    const kickoff = source.clocks.find(c => c.week === r.week)?.kickoff
    if (!snapshot?.winnings || !snapshot.itemMatchups || snapshot.itemsPolicy !== 'beta_2025' || !kickoff || !r.resolvedAt) { blockers.push(`Week ${r.week} needs its sealed 2025 snapshot, settlement timestamp and trusted scoring calendar.`); continue }
    if (snapshot.whisperer && snapshot.whisperer.ambushesGranted !== 2) blockers.push(`Week ${r.week} carries a legacy Whisperer budget; review that policy before 2025 replay.`)
    if (snapshot.teams.some(t => !['Survivor', 'Zombie', 'Whisperer'].includes(t.status))) blockers.push(`Week ${r.week} carries a noncanonical team role; review that policy before 2025 replay.`)
    snapshot.teams = snapshot.teams.map(teamState); snapshot.items = snapshot.items.map(itemState)
    const oldRosterIds = new Set(snapshot.owners.map(o => `${o.rosterId}:${o.userId}`))
    if (source.rosters.length !== oldRosterIds.size || source.rosters.some(o => !oldRosterIds.has(`${o.id}:${o.platformUserId}`))) blockers.push(`Week ${r.week} has changed ownership; reconcile replacement-manager history first.`)
    const currentMatches = source.matches.filter(m => m.week === r.week && !m.isMedianMatchup)
    if (currentMatches.length * 2 !== snapshot.teams.length || currentMatches.length !== snapshot.itemMatchups.length || currentMatches.some(m => !m.awayRosterId || !['final', 'complete', 'completed'].includes(m.status))) { blockers.push(`Week ${r.week} needs the complete finalized matchup field.`); continue }
    const toRoster = (id: string) => source.rosters.find(o => o.redraftRosterId === id)?.id ?? source.rosters.find(o => o.platformUserId === source.seasonRosters.find(s => s.id === id)?.ownerId)?.id
    try {
      const matches = currentMatches.map(m => {
        const home = toRoster(m.homeRosterId), away = toRoster(m.awayRosterId!)
        const old = snapshot.itemMatchups!.find(o => o.matchupId === m.id)
        if (!home || !away || old?.homeRosterId !== home || old.awayRosterId !== away) throw new Error('The saved matchup pairing changed.')
        return readBetaItemMatchup({ matchupId: m.id, homeRosterId: home, awayRosterId: away, homeScore: m.homeScore, awayScore: m.awayScore, lineupSnapshots: m.lineupSnapshots })
      })
      weeks.push({ week: r.week, snapshot, matches, deadlineAt: betaCombatDeadline(new Date(kickoff)).toISOString(), settledAt: new Date(r.resolvedAt).toISOString() })
    } catch { blockers.push(`Week ${r.week} needs valid item score receipts and unchanged pairings; rescore it before preparing another review.`) }
  }
  const plan = planBetaCorrection({ zombieLeagueId: source.z.id, weeks, choices: json(source.choices) as unknown as RecordedChoice[], catalog: source.items.map(itemState),
    fallbackWhispererUser: source.whisperer?.userId ?? '', now: now.toISOString() })
  plan.blockers.push(...blockers)
  for (const w of plan.original) {
    if (Object.entries(w.distribution).some(([id, amount]) => source.ledger.find(r => r.week === w.week && r.rosterId === id)?.amount !== amount)) {
      plan.blockers.push(`Week ${w.week} winnings no longer match its original sealed settlement. Reconcile that ledger discrepancy first.`)
    }
  }
  const lastOriginal = plan.original.at(-1)
  if (lastOriginal && root?.status === 'complete') {
    const currentWhisperer = source.whisperer as unknown as ReplayWhisperer | null
    if (correctionHash(correctionStateShape(lastOriginal.teams, lastOriginal.items, lastOriginal.whisperer)) !== correctionHash(correctionStateShape(source.teams.map(t => teamState(json(t) as unknown as Snapshot['teams'][number])), source.items.map(itemState), currentWhisperer))) {
      plan.blockers.push('Current roles or inventory contain post-settlement actions or an unverified state change. Review the affected trade, item use, ambush or commissioner override before replay; those actions will not be silently erased.')
    }
  }
  if (root && weeks[0]?.snapshot.winnings) {
    for (const [id, opening] of Object.entries(weeks[0].snapshot.winnings.openingByRoster)) {
      const actual = source.ledger.filter(r => r.week < fromWeek && r.rosterId === id).reduce((n, r) => n + r.amount, 0)
      if (Math.abs(actual - opening) > .005) { plan.blockers.push('The sealed opening winnings differ from the earlier ledger. Resolve that earlier correction first.'); break }
    }
  }
  const consequencesUnchanged = plan.weeks.length === plan.original.length && plan.weeks.every((w, i) => {
    const old = plan.original[i]
    return correctionHash(correctionStateShape(w.teams, w.items, w.whisperer)) === correctionHash(correctionStateShape(old.teams, old.items, old.whisperer)) &&
      correctionHash(w.distribution) === correctionHash(old.distribution) && correctionHash(w.infections) === correctionHash(old.infections) &&
      correctionHash(w.choices.map(c => [c.kind, c.actorUserId, c.targetUserId, c.decision])) === correctionHash(old.choices.map(c => [c.kind, c.actorUserId, c.targetUserId, c.decision]))
  })
  const externalReviews = source.payouts.map(p => ({ payoutId: p.id, week: p.week, key: correctionHash({ payout: p, scores: weeks.map(w => ({ week: w.week, matches: w.matches })) }) }))
    .filter(p => !consequencesUnchanged && !source.acknowledgements.some(a => (a.metadata as { key?: string } | null)?.key === p.key))
  for (const p of externalReviews) plan.blockers.push(`Week ${p.week} has an external payout record. Record its external reconciliation reference before approval; this tool never moves money.`)
  plan.blockers = [...new Set(plan.blockers)]
  const safeAutomatic = !plan.blockers.length && consequencesUnchanged
  const throughWeek = plan.weeks.at(-1)?.week ?? fromWeek
  const liveWeek = Math.max(source.z.currentWeek, source.season.currentWeek)
  const liveWeeksToRefresh = liveWeek > throughWeek && !source.resolutions.some(r => r.week === liveWeek && r.status === 'complete') && source.matches.some(m => m.week === liveWeek) ? [liveWeek] : []
  return { ...plan, externalReviews, safeAutomatic, liveWeeksToRefresh }
}

export async function prepareZombieCorrection(leagueId: string, fromWeek: number, actorId: string) {
  return combatTransaction(async tx => {
    await lockItemLeague(tx, leagueId)
    let source = await collect(tx, leagueId, fromWeek, actorId)
    // An in-flight settlement must finish before we introduce a new hold. Its
    // checkpoint is visible under the same league lock used to start settlement.
    const settling = source.resolutions.some(r => r.status !== 'complete' && !(r.status === 'pending' && !r.settlementSnapshot))
    if (!settling && source.resolutions.find(r => r.week === fromWeek)?.status === 'complete' && (source.z.correctionHoldFromWeek == null || source.z.correctionHoldFromWeek > fromWeek)) {
      await tx.zombieLeague.update({ where: { id: source.z.id }, data: { correctionHoldFromWeek: fromWeek } })
      source = await collect(tx, leagueId, fromWeek, actorId)
    }
    const plan = build(source, fromWeek, new Date())
    // Crossing a choice deadline invalidates the review even without another database write.
    const sourceHash = reviewedSourceHash(source, plan)
    return tx.zombieCorrectionReview.upsert({ where: { zombieLeagueId_fromWeek_sourceHash: { zombieLeagueId: source.z.id, fromWeek, sourceHash } },
      create: { zombieLeagueId: source.z.id, fromWeek, sourceHash, source: toPrismaJsonInput(source), plan: toPrismaJsonInput(plan), requestedByUserId: actorId, status: plan.blockers.length ? 'blocked' : 'ready' }, update: {} })
  })
}

export async function acknowledgeExternalCorrection(leagueId: string, reviewId: string, payoutId: string, actorId: string, reference: string, note: string) {
  if (reference.trim().length < 3 || reference.length > 160 || note.trim().length < 12 || note.length > 2000) throw new ZombieRecoveryError('Record the external reconciliation reference and a meaningful review note.')
  return combatTransaction(async tx => {
    await lockItemLeague(tx, leagueId)
    const z = await tx.zombieLeague.findUniqueOrThrow({ where: { leagueId }, include: { league: { select: { userId: true } } } })
    if (z.league.userId !== actorId) throw new ZombieRecoveryError('OWNER_REQUIRED')
    const review = await tx.zombieCorrectionReview.findUniqueOrThrow({ where: { id: reviewId } })
    if (review.zombieLeagueId !== z.id || review.status === 'applied') throw new ZombieRecoveryError('Choose an unapplied review in this league.')
    const requirement = (review.plan as unknown as SavedPlan).externalReviews.find(p => p.payoutId === payoutId)
    if (!requirement) throw new ZombieRecoveryError('This payout is not an external-review requirement of that preview.')
    const id = `external-correction:${z.id}:${requirement.key}`
    await tx.zombieAuditLog.upsert({ where: { id }, create: { id, leagueId, zombieLeagueId: z.id, eventType: 'external_correction_reconciled', metadata: { key: requirement.key,
      reviewId, payoutId, actorId, reference: reference.trim(), note: note.trim(), externalPaymentUnchanged: true } }, update: {} })
    return { ok: true, refreshRequired: true }
  })
}

export async function applyZombieCorrection(leagueId: string, reviewId: string, expectedHash: string, actorId: string, reason: string, automatic = false) {
  if (reason.trim().length < 12 || reason.length > 2000) throw new ZombieRecoveryError('Record a meaningful correction approval reason.')
  const result = await combatTransaction(async tx => {
    await lockItemLeague(tx, leagueId)
    const saved = await tx.zombieCorrectionReview.findUniqueOrThrow({ where: { id: reviewId } })
    const source = await collect(tx, leagueId, saved.fromWeek, actorId)
    if (saved.zombieLeagueId !== source.z.id || saved.sourceHash !== expectedHash) throw new ZombieRecoveryError('This reviewed correction belongs to a different league or preview.')
    if (saved.status === 'applied') return { reviewId, repeated: true }
    const plan = build(source, saved.fromWeek, new Date())
    const hash = reviewedSourceHash(source, plan)
    if (hash !== expectedHash) throw new ZombieRecoveryError('STALE_PREVIEW: scores, ownership, inventory, decisions or reports changed. Prepare a fresh review.')
    if (plan.blockers.length || !plan.weeks.length || (automatic && !plan.safeAutomatic)) throw new ZombieRecoveryError('This review still has dependencies requiring commissioner attention.')
    await materialize(tx, source, plan, reviewId, actorId)
    await tx.zombieLeague.update({ where: { id: source.z.id }, data: { correctionHoldFromWeek: null, latestCorrectionReviewId: reviewId } })
    await tx.zombieCorrectionReview.update({ where: { id: reviewId }, data: { status: 'applied', approvedByUserId: actorId, reason: reason.trim(), appliedAt: new Date(), effectsPending: true } })
    await tx.zombieAuditLog.create({ data: { leagueId, zombieLeagueId: source.z.id, eventType: 'stat_correction_applied', metadata: { reviewId, fromWeek: saved.fromWeek,
      throughWeek: plan.weeks.at(-1)!.week, sourceHash: expectedHash, actorId, automatic, reason: reason.trim() } } })
    return { reviewId, repeated: false }
  }, 60_000)
  return { ...result, effectsPending: true }
}

async function materialize(tx: Tx, source: Source, plan: SavedPlan, reviewId: string, actorId: string) {
  const z = source.z, weekIds = plan.weeks.map(w => w.week), last = plan.weeks.at(-1)!
  const owner = (id: string) => source.rosters.find(r => r.id === id)!.platformUserId
  await tx.zombieInfectionLog.deleteMany({ where: { leagueId: z.leagueId, week: { in: weekIds } } })
  await tx.zombieInfectionEvent.deleteMany({ where: { zombieLeagueId: z.id, week: { in: weekIds } } })
  await tx.zombieBashingEvent.deleteMany({ where: { leagueId: z.leagueId, week: { in: weekIds } } })
  await tx.zombieMaulingEvent.deleteMany({ where: { leagueId: z.leagueId, week: { in: weekIds } } })
  await tx.zombieRoleWorkflow.deleteMany({ where: { zombieLeagueId: z.id, week: { in: weekIds } } })
  for (const old of source.chat.filter(m => m.id.startsWith(`choice:${z.id}:`))) {
    if (!weekIds.some(w => old.id.startsWith(`choice:${z.id}:${w}:`))) continue
    await tx.leagueChatMessage.update({ where: { id: old.id }, data: { message: 'This combat notice was superseded by a reviewed stat correction. See the updated week report.', metadata: { senderIsHost: true, contentType: 'host_announcement', supersededByCorrection: reviewId } } })
  }
  const keepIds = last.items.map(i => i.id)
  await tx.zombieTeamItem.deleteMany({ where: { zombieLeagueId: z.id, id: { notIn: keepIds }, acquiredAtWeek: { gte: weekIds[0] }, awardKey: { startsWith: `item2025:${z.id}:` } } })
  for (const i of last.items) {
    const { id, ...data } = i
    await tx.zombieTeamItem.upsert({ where: { id }, create: { id, zombieLeagueId: z.id, ...data }, update: data })
  }
  for (const t of last.teams) {
    const { id, rosterId, revivedAt, ...data } = t
    const existingRevival = source.teams.find(old => old.id === id)?.revivedAt
    await tx.zombieLeagueTeam.update({ where: { id }, data: { ...data, revivedAt: revivedAt ? new Date(existingRevival ?? revivedAt) : null,
      weeklyWinnings: last.distribution[rosterId] ?? 0, totalWinnings: last.totals[rosterId] ?? 0 } })
  }
  if (last.whisperer) {
    const { id, ...w } = last.whisperer
    const name = source.teams.find(t => owner(t.rosterId) === w.userId)
    await tx.whispererRecord.update({ where: { id }, data: { ...w, displayName: name?.fantasyTeamName || name?.displayName || 'Whisperer',
      selectionMode: 'beta_2025_reviewed_correction', activePowers: [], postDefeatRule: null } })
  }
  for (const w of plan.weeks) {
    for (const m of w.matches) {
      const raw = source.matches.find(r => r.id === m.matchupId)!
      const snapshots = (raw.lineupSnapshots ?? {}) as Record<string, unknown>
      const bonusFor = (id: string) => { const t = w.snapshot.teams.find(t => t.rosterId === id)!; return { ...betaItemBonus(id, t.status, w.snapshot.items.filter(i => i.teamStatusId === t.id), w.week, w.snapshot.itemWeaponsEnabled), frozen: true } }
      const itemReceipt = w.week === weekIds[0] ? (snapshots.zombieItems as Record<string, unknown>) : { policy: 'beta_2025', home: bonusFor(m.homeRosterId), away: bonusFor(m.awayRosterId) }
      await tx.redraftMatchup.update({ where: { id: raw.id }, data: { homeScore: m.homeScore, awayScore: m.awayScore,
        lineupSnapshots: toPrismaJsonInput({ ...snapshots, zombieItems: { ...itemReceipt, homeBaseScore: m.homeBaseScore, awayBaseScore: m.awayBaseScore }, zombieCorrectionReviewId: reviewId }) } })
      if (m.homeScore === m.awayScore) continue
      const homeWon = m.homeScore > m.awayScore, winId = homeWon ? m.homeRosterId : m.awayRosterId, loseId = homeWon ? m.awayRosterId : m.homeRosterId
      const win = w.snapshot.teams.find(t => t.rosterId === winId)!, lose = w.snapshot.teams.find(t => t.rosterId === loseId)!
      const margin = Math.round(Math.abs(m.homeScore - m.awayScore) * 100) / 100
      if (margin < 60 || !['Survivor', 'Zombie'].includes(win.status)) continue
      const eventId = `combat-event:${z.id}:${w.week}:${m.matchupId}`, choice = w.choices.find(c => c.winnerRosterId === winId && c.loserRosterId === loseId)
      if (win.status === 'Survivor') await tx.zombieBashingEvent.create({ data: { id: eventId, leagueId: z.leagueId, week: w.week, winnerUserId: owner(winId), loserUserId: owner(loseId), winnerStatus: win.status, loserStatus: lose.status,
        winnerScore: Math.max(m.homeScore, m.awayScore), loserScore: Math.min(m.homeScore, m.awayScore), margin, bashingType: `survivor_bashes_${lose.status.toLowerCase()}`, serumAwarded: lose.status === 'Zombie', requiresDecision: Boolean(choice), decisionDeadline: choice ? new Date(choice.deadlineAt) : null,
        decisionMade: choice?.decision, decisionMadeAt: choice?.decision ? new Date() : null, defaultedToRule: Boolean(choice?.decision && !choice.retained), resolvedAt: !choice || choice.decision ? new Date() : null } })
      else await tx.zombieMaulingEvent.create({ data: { id: eventId, leagueId: z.leagueId, week: w.week, maulerUserId: owner(winId), victimUserId: owner(loseId), maulerStatus: win.status, victimStatus: lose.status,
        maulerScore: Math.max(m.homeScore, m.awayScore), victimScore: Math.min(m.homeScore, m.awayScore), margin, maulingType: `zombie_mauls_${lose.status.toLowerCase()}`, lootMultiplier: 1, serumAutoAwarded: true,
        newWhispererTriggered: choice?.decision === 'become_whisperer', newWhispererUserId: choice?.decision === 'become_whisperer' ? owner(winId) : null, resolvedAt: !choice || choice.decision ? new Date() : null } })
    }
    for (const i of w.infections) {
      const m = w.matches.find(m => m.matchupId === i.matchupId)!, infectorScore = i.infectorRosterId === m.homeRosterId ? m.homeScore : m.awayScore, victimScore = i.victimRosterId === m.homeRosterId ? m.homeScore : m.awayScore
      await tx.zombieInfectionLog.create({ data: { leagueId: z.leagueId, week: w.week, survivorRosterId: i.victimRosterId, infectedByRosterId: i.infectorRosterId } })
      const transfer = Math.max(0, -(w.distribution[i.victimRosterId] ?? 0))
      await tx.zombieInfectionEvent.create({ data: { zombieLeagueId: z.id, week: w.week, infectorUserId: owner(i.infectorRosterId), victimUserId: owner(i.victimRosterId), infectorStatus: w.snapshot.teams.find(t => t.rosterId === i.infectorRosterId)!.status,
        infectorName: source.teams.find(t => t.rosterId === i.infectorRosterId)?.fantasyTeamName || 'Manager', victimName: source.teams.find(t => t.rosterId === i.victimRosterId)?.fantasyTeamName || 'Manager',
        victimPriorStatus: 'survivor', victimNewStatus: 'zombie', infectorScore, victimScore, scoreDifference: infectorScore - victimScore, winningsTransferred: transfer, isStatCorrected: true, correctedAt: new Date() } })
    }
    for (const c of w.choices) {
      const prior = source.choices.find(p => p.id === c.id && c.retained)
      await tx.zombieRoleWorkflow.create({ data: { id: c.id, zombieLeagueId: z.id, week: w.week, kind: c.kind, actorUserId: c.actorUserId, targetUserId: c.targetUserId,
        status: c.status, decision: c.decision, deadlineAt: new Date(c.deadlineAt), decidedAt: prior?.decidedAt ?? (c.decision ? new Date() : null), decidedByUserId: c.retained ? prior?.decidedByUserId : null,
        state: toPrismaJsonInput({ policy: 'beta_2025', eventId: `combat-event:${z.id}:${w.week}:${w.matches.find(m => [m.homeRosterId, m.awayRosterId].includes(c.winnerRosterId))!.matchupId}`,
          winnerRosterId: c.winnerRosterId, loserRosterId: c.loserRosterId, remaining: c.remaining, granted: c.granted, used: c.used, revived: c.revived, correctionReviewId: reviewId }) } })
    }
    await tx.zombieRoleWorkflow.create({ data: { id: `combat:${z.id}:${w.week}`, zombieLeagueId: z.id, week: w.week, kind: 'combat_receipt', status: 'complete', state: { policy: 'beta_2025', correctionReviewId: reviewId } } })
    for (const [rosterId, amount] of Object.entries(w.distribution)) await tx.zombieWeeklyWinnings.upsert({ where: { leagueId_rosterId_week: { leagueId: z.leagueId, rosterId, week: w.week } },
      create: { leagueId: z.leagueId, zombieLeagueId: z.id, rosterId, week: w.week, amount, source: 'weekly_settlement_2025' }, update: { amount, source: 'weekly_settlement_2025' } })
    const results = w.matches.map(m => { const raw = source.matches.find(r => r.id === m.matchupId)!; return { homeUserId: raw.homeRosterId, awayUserId: raw.awayRosterId, homeScore: m.homeScore, awayScore: m.awayScore,
      outcome: m.homeScore === m.awayScore ? 'tie' : m.homeScore > m.awayScore ? 'home' : 'away', winnerScore: Math.max(m.homeScore, m.awayScore), loserScore: Math.min(m.homeScore, m.awayScore) } })
    await tx.zombieWeeklyResolution.update({ where: { zombieLeagueId_week: { zombieLeagueId: z.id, week: w.week } }, data: { requiresStatCorrection: false,
      matchupResults: toPrismaJsonInput(results), settlementSnapshot: toPrismaJsonInput(w.snapshot), itemEvents: toPrismaJsonInput(w.itemEvents),
      serumAwards: toPrismaJsonInput((w.itemEvents as { awards: Array<{ itemType: string }> }).awards.filter(a => a.itemType === 'serum')),
      weaponAwards: toPrismaJsonInput((w.itemEvents as { awards: Array<{ itemType: string }> }).awards.filter(a => a.itemType.startsWith('weapon_'))),
      newZombies: w.infections.map(i => owner(i.victimRosterId)), infectionCount: w.infections.length, hordeSize: w.teams.filter(t => t.status === 'Zombie').length,
      survivorCount: w.teams.filter(t => t.status === 'Survivor').length, winningsDistribution: toPrismaJsonInput(w.distribution), weeklyWinningsPool: Object.values(w.distribution).reduce((a, n) => a + n, 0), resolvedAt: new Date() } })
    // A queued report cannot continue to advertise the superseded outcome.
    await tx.zombieAnnouncement.updateMany({ where: { zombieLeagueId: z.id, week: w.week, type: 'weekly_update', isPosted: false }, data: { scheduledFor: null, content: 'A reviewed stat correction was applied. The refreshed report is pending.' } })
  }
  // Rebuild unconsumed passive bonuses before lifting the hold. An ensuing legal
  // trade then freezes the corrected receipt rather than the superseded inventory.
  for (const raw of source.matches.filter(m => plan.liveWeeksToRefresh.includes(m.week) && m.awayRosterId)) {
    const snapshots = (raw.lineupSnapshots ?? {}) as Record<string, unknown>
    const old = snapshots.zombieItems as { homeBaseScore?: number; awayBaseScore?: number; home?: { frozen?: boolean }; away?: { frozen?: boolean } } | undefined
    const side = (redraftId: string, frozen = false) => {
      const seat = source.rosters.find(r => r.redraftRosterId === redraftId) ?? source.rosters.find(r => r.platformUserId === source.seasonRosters.find(s => s.id === redraftId)?.ownerId)
      const team = last.teams.find(t => t.rosterId === seat?.id)
      if (!team) throw new ZombieRecoveryError('The live scoring roster changed during recovery.')
      return { ...betaItemBonus(team.rosterId, team.status, last.items.filter(i => i.teamStatusId === team.id), raw.week, last.snapshot.itemWeaponsEnabled), frozen }
    }
    const home = side(raw.homeRosterId, old?.home?.frozen), away = side(raw.awayRosterId!, old?.away?.frozen)
    await tx.redraftMatchup.update({ where: { id: raw.id }, data: {
      ...(typeof old?.homeBaseScore === 'number' ? { homeScore: Math.round((old.homeBaseScore + home.bonus) * 100) / 100 } : {}),
      ...(typeof old?.awayBaseScore === 'number' ? { awayScore: Math.round((old.awayBaseScore + away.bonus) * 100) / 100 } : {}),
      lineupSnapshots: toPrismaJsonInput({ ...snapshots, zombieItems: { ...old, policy: 'beta_2025', home, away }, zombieCorrectionReviewId: reviewId }) } })
  }
  for (const t of last.teams) await tx.platformNotification.upsert({ where: { sourceKey: `zombie-correction:${reviewId}:${owner(t.rosterId)}` },
    create: { sourceKey: `zombie-correction:${reviewId}:${owner(t.rosterId)}`, leagueId: z.leagueId, userId: owner(t.rosterId), type: 'zombie_stat_correction', severity: 'high',
      title: 'Zombie stat correction applied', body: `Your current role is ${t.status}. Your cumulative winnings are ${last.totals[t.rosterId] ?? 0}. Review the corrected reports and any pending combat choice.`, meta: { leagueId: z.leagueId, reviewId, href: `/league/${z.leagueId}?view=zombie` } }, update: {} })
  await tx.leagueChatMessage.upsert({ where: { id: `zombie-correction:${reviewId}` }, create: { id: `zombie-correction:${reviewId}`, leagueId: z.leagueId, userId: actorId, type: 'host_announcement',
    message: `A reviewed stat correction updated weeks ${weekIds[0]}–${last.week}. Scores, inventory, roles and winnings were reconciled together. Updated reports are being prepared.`, metadata: { senderIsHost: true, contentType: 'host_announcement', zombieCorrectionReviewId: reviewId } }, update: {} })
}

export async function reconcileBetaCorrectionAutomatically(leagueId: string, week: number, ownerId: string) {
  const review = await prepareZombieCorrection(leagueId, week, ownerId)
  if (!(review.plan as unknown as SavedPlan).safeAutomatic) return null
  await applyZombieCorrection(leagueId, review.id, review.sourceHash, ownerId, 'Automatic correction: all roles, item effects, combat choices and winnings are unchanged.', true)
  return prisma.zombieWeeklyResolution.findUnique({ where: { zombieLeagueId_week: { zombieLeagueId: review.zombieLeagueId, week } } })
}
