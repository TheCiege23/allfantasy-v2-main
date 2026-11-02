import { randomInt } from 'node:crypto'
import type { Prisma, ZombieLeague, ZombieRoleWorkflow } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { lockItemLeague } from './beta2025ItemService'
import { combatTransaction } from './beta2025CombatTransaction'
import { ensureLeagueTeamRows } from './ZombieOwnerStatusService'
import { parseZombieSettlementSnapshot } from './weeklySettlementSnapshot'
import { betaCombatDeadline, betaCombatKind, BETA_AMBUSH_LIMIT, INITIAL_WHISPERER_OFFER_HOURS } from './beta2025CombatPolicy'
import { trustedZombieWeekStart } from './zombieWeekGameStart'

type Tx = Prisma.TransactionClient
type Candidate = { userId: string; rosterId: string; name: string; veteran: boolean }
type State = {
  policy: 'beta_2025'; candidates?: Candidate[]; index?: number;
  offers?: Array<{ userId: string; result: string; at: string }>;
  winnerRosterId?: string; loserRosterId?: string; eventId?: string;
  remaining?: number; granted?: number; used?: number; revived?: boolean;
}
function stateOf(row: ZombieRoleWorkflow): State {
  const state = row.state as unknown as State
  if (state?.policy !== 'beta_2025') throw new Error('This workflow requires commissioner review.')
  return state
}
async function privateNotice(tx: Tx, key: string, userId: string, leagueId: string, title: string, body: string) {
  await tx.platformNotification.upsert({ where: { sourceKey: key }, create: {
    sourceKey: key, userId, leagueId, type: 'zombie_role_decision', title, body,
    severity: 'high', meta: { leagueId, href: `/league/${leagueId}?view=zombie` },
  }, update: {} })
}
async function audit(tx: Tx, z: ZombieLeague, event: string, metadata: Record<string, unknown>) {
  await tx.zombieAuditLog.create({ data: { leagueId: z.leagueId, zombieLeagueId: z.id, eventType: event, metadata: toPrismaJsonInput({ policy: 'beta_2025', ...metadata }) } })
}
async function roleChat(tx: Tx, z: ZombieLeague, key: string, text: string) {
  const league = await tx.league.findUniqueOrThrow({ where: { id: z.leagueId }, select: { userId: true } })
  await tx.leagueChatMessage.upsert({ where: { id: key }, create: {
    id: key, leagueId: z.leagueId, userId: league.userId, type: 'host_announcement', message: text,
    metadata: { senderIsHost: true, contentType: 'host_announcement', zombieRoleWorkflow: true },
  }, update: {} })
}
async function appoint(tx: Tx, z: ZombieLeague, candidate: Candidate, budget: { remaining: number; granted: number; used: number }) {
  await tx.zombieLeagueTeam.update({ where: { leagueId_rosterId: { leagueId: z.leagueId, rosterId: candidate.rosterId } },
    data: { status: 'Whisperer', isWhisperer: true, weekBecameZombie: null, killedAtWeek: null, killedByRosterId: null,
      killedByUserId: null, revivedAt: null, ambushesRemaining: budget.remaining, ambushesUsed: budget.used } })
  const data = { userId: candidate.userId, displayName: candidate.name, selectionMode: 'beta_2025_offer',
    ambushesGranted: budget.granted, ambushesRemaining: budget.remaining, ambushesUsed: budget.used,
    wasDefeated: false, defeatedAtWeek: null, defeatedByUserId: null, isPubliclyRevealed: z.whispererIsPublic,
    activePowers: [], postDefeatRule: null }
  await tx.whispererRecord.upsert({ where: { zombieLeagueId: z.id }, create: { zombieLeagueId: z.id, ...data }, update: data })
}
async function defeated(tx: Tx, z: ZombieLeague, loserRosterId: string, winnerRosterId: string, week: number, winnerUserId: string) {
  await tx.zombieLeagueTeam.update({ where: { leagueId_rosterId: { leagueId: z.leagueId, rosterId: loserRosterId } }, data: {
    status: 'Zombie', isWhisperer: false, weekBecameZombie: week, killedAtWeek: week, killedByRosterId: winnerRosterId,
    killedByUserId: winnerUserId, revivedAt: null, ambushesRemaining: 0,
  } })
  await tx.whispererRecord.update({ where: { zombieLeagueId: z.id }, data: { wasDefeated: true, defeatedAtWeek: week,
    defeatedByUserId: winnerUserId, ambushesRemaining: 0, activePowers: [] } })
}

async function candidatesFor(tx: Tx, z: ZombieLeague): Promise<Candidate[]> {
  const rosters = await tx.roster.findMany({ where: { leagueId: z.leagueId }, select: { id: true, platformUserId: true } })
  const users = await tx.appUser.findMany({ where: { id: { in: rosters.map(r => r.platformUserId) } }, select: { id: true } })
  const registered = new Set(users.map(u => u.id))
  if (rosters.length !== z.teamCount || new Set(rosters.map(r => r.platformUserId)).size !== z.teamCount ||
      rosters.some(r => !registered.has(r.platformUserId))) throw new Error('Fill every seat with a distinct registered manager before the Whisperer draw.')
  const teams = await tx.zombieLeagueTeam.findMany({ where: { leagueId: z.leagueId } })
  return rosters.map(r => {
    const team = teams.find(t => t.rosterId === r.id)
    if (!team || team.status !== 'Survivor') throw new Error('The initial draw requires all teams to be Survivors.')
    return { userId: r.platformUserId, rosterId: r.id, name: team.fantasyTeamName || team.displayName || 'Manager', veteran: team.isVeteran }
  })
}
async function offerNext(tx: Tx, z: ZombieLeague, row: ZombieRoleWorkflow, state: State, now: Date) {
  let candidate = state.candidates?.[state.index ?? 0]
  while (candidate) {
    const roster = await tx.roster.findFirst({ where: { id: candidate.rosterId, leagueId: z.leagueId, platformUserId: candidate.userId } })
    const team = await tx.zombieLeagueTeam.findUnique({ where: { leagueId_rosterId: { leagueId: z.leagueId, rosterId: candidate.rosterId } } })
    const user = await tx.appUser.findUnique({ where: { id: candidate.userId }, select: { id: true } })
    if (roster && user && team?.status === 'Survivor') break
    state.offers = [...(state.offers ?? []), { userId: candidate.userId, result: 'ineligible', at: now.toISOString() }]
    state.index = (state.index ?? 0) + 1
    candidate = state.candidates?.[state.index]
  }
  if (!candidate) {
    await tx.zombieRoleWorkflow.update({ where: { id: row.id }, data: { status: 'review_required', actorUserId: null, deadlineAt: null, state: toPrismaJsonInput(state) } })
    const league = await tx.league.findUniqueOrThrow({ where: { id: z.leagueId }, select: { userId: true } })
    await privateNotice(tx, `${row.id}:exhausted:${state.index}`, league.userId, z.leagueId, 'Whisperer draw needs review',
      'Every eligible manager declined or timed out. Review the draw and nominate a consenting candidate; nobody has been assigned automatically.')
    return
  }
  const deadlineAt = new Date(now.getTime() + INITIAL_WHISPERER_OFFER_HOURS * 3_600_000)
  await tx.zombieRoleWorkflow.update({ where: { id: row.id }, data: { status: 'pending', actorUserId: candidate.userId, deadlineAt, state: toPrismaJsonInput(state) } })
  await privateNotice(tx, `${row.id}:offer:${state.index}`, candidate.userId, z.leagueId, 'Whisperer role offered',
    `You have 24 hours to accept or decline the Whisperer role. Open the Zombie tab before ${deadlineAt.toISOString()}.`)
}

/** One-time historical eligibility review, before the independently randomized offer order is sealed. */
export async function reviewBetaVeterans(leagueId: string, actorId: string, userIds: string[], reason: string) {
  if (reason.trim().length < 8 || userIds.length > 20 || new Set(userIds).size !== userIds.length) throw new Error('Record a historical eligibility review reason and distinct managers.')
  return combatTransaction(async tx => {
    await lockItemLeague(tx, leagueId)
    const z = await tx.zombieLeague.findUniqueOrThrow({ where: { leagueId }, include: { league: { select: { userId: true } } } })
    if (z.sport !== 'NFL' || z.league.userId !== actorId || !['setup', 'registering', 'active', 'in_progress'].includes(z.status)) throw new Error('Only the league owner can review eligibility before the draw.')
    if (await tx.whispererRecord.findUnique({ where: { zombieLeagueId: z.id } }) || await tx.zombieRoleWorkflow.findFirst({ where: { zombieLeagueId: z.id, kind: 'initial_offer' } })) throw new Error('Eligibility is sealed once offers begin.')
    const rosters = await tx.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } })
    if (userIds.some(id => !rosters.some(r => r.platformUserId === id))) throw new Error('Every reviewed manager must belong to this league.')
    const before = await tx.zombieLeagueTeam.findMany({ where: { leagueId }, select: { rosterId: true, isVeteran: true } })
    await tx.zombieLeagueTeam.updateMany({ where: { leagueId }, data: { isVeteran: false } })
    for (const roster of rosters) await tx.zombieLeagueTeam.upsert({ where: { leagueId_rosterId: { leagueId, rosterId: roster.id } },
      create: { leagueId, zombieLeagueId: z.id, rosterId: roster.id, status: 'Survivor', isVeteran: userIds.includes(roster.platformUserId) },
      update: { isVeteran: userIds.includes(roster.platformUserId) } })
    await audit(tx, z, 'whisperer_veteran_review', { actorId, reason: reason.trim(), before, veteranUserIds: userIds, qualification: 'one_complete_prior_universe_year' })
    return { ok: true }
  })
}

/** Independently randomized, durable veteran-first offers. Existing assignments are never redrawn. */
export async function startBetaWhispererOffers(leagueId: string, override?: { actorId: string; nomineeId: string; reason: string }, draftSeason?: number) {
  const z = await prisma.zombieLeague.findUniqueOrThrow({ where: { leagueId } })
  if (z.sport !== 'NFL' || !['setup', 'registering', 'active', 'in_progress'].includes(z.status)) throw new Error('This is not an available 2025 NFL draw.')
  await ensureLeagueTeamRows(leagueId, z.id)
  return combatTransaction(async tx => {
    await lockItemLeague(tx, leagueId)
    let live = await tx.zombieLeague.findUniqueOrThrow({ where: { leagueId } })
    if (draftSeason != null && live.season !== draftSeason) {
      if (!['setup', 'registering'].includes(live.status)) throw new Error('An active draw cannot change its season.')
      live = await tx.zombieLeague.update({ where: { id: live.id }, data: { season: draftSeason } })
    }
    const existingRole = await tx.whispererRecord.findUnique({ where: { zombieLeagueId: live.id } })
    if (existingRole) return { alreadyAssigned: true }
    const id = `whisperer-offer:${live.id}:${live.season}`
    const existing = await tx.zombieRoleWorkflow.findUnique({ where: { id } })
    if (existing && !override) return { workflowId: existing.id, status: existing.status }
    const candidates = await candidatesFor(tx, live)
    if (override) {
      const league = await tx.league.findUniqueOrThrow({ where: { id: leagueId }, select: { userId: true } })
      if (league.userId !== override.actorId || existing?.status !== 'review_required' || override.reason.trim().length < 8) throw new Error('The owner must review an exhausted draw and record a reason before nominating someone.')
      const nominee = candidates.find(c => c.userId === override.nomineeId)
      if (!nominee) throw new Error('Nominee must be a registered manager in this league.')
      const state = stateOf(existing)
      state.candidates = [...(state.candidates ?? []), nominee]
      await offerNext(tx, live, existing, state, new Date())
      await audit(tx, live, 'whisperer_offer_nomination', { workflowId: id, nomineeId: nominee.userId, actorId: override.actorId, reason: override.reason.trim() })
      return { workflowId: id, status: 'pending' }
    }
    for (let i = candidates.length - 1; i > 0; i--) { const j = randomInt(i + 1); [candidates[i], candidates[j]] = [candidates[j], candidates[i]] }
    const veterans = candidates.filter(c => c.veteran)
    const eligible = veterans.length ? veterans : candidates
    const state: State = { policy: 'beta_2025', candidates: eligible, index: 0, offers: [] }
    const row = await tx.zombieRoleWorkflow.create({ data: { id, zombieLeagueId: live.id, kind: 'initial_offer', state: toPrismaJsonInput(state) } })
    await audit(tx, live, 'whisperer_draw', { workflowId: id, randomizedOrder: candidates.map(c => c.userId), eligibleOrder: eligible.map(c => c.userId), independentOfDraftOrder: true })
    await offerNext(tx, live, row, state, new Date())
    return { workflowId: id, status: 'pending' }
  })
}

/** Called after item loot/revival, using the sealed PRE-infection roles and scores. */
export async function settleBetaCombat(zombieLeagueId: string, week: number) {
  return combatTransaction(async tx => {
    const z = await tx.zombieLeague.findUniqueOrThrow({ where: { id: zombieLeagueId } })
    if (z.sport !== 'NFL') return
    await lockItemLeague(tx, z.leagueId)
    const receiptId = `combat:${z.id}:${week}`
    if (await tx.zombieRoleWorkflow.findUnique({ where: { id: receiptId } })) return
    const resolution = await tx.zombieWeeklyResolution.findUniqueOrThrow({ where: { zombieLeagueId_week: { zombieLeagueId, week } } })
    const snapshot = parseZombieSettlementSnapshot(resolution.settlementSnapshot)
    const items = resolution.itemEvents as { policy?: string; complete?: boolean; revivedRosterIds?: string[] } | null
    if (snapshot?.itemsPolicy !== 'beta_2025' || !snapshot.itemMatchups || items?.policy !== 'beta_2025' || !items.complete) throw new Error('Complete the sealed 2025 item settlement before combat.')
    const kickoff = await trustedZombieWeekStart('NFL', z.season, week, tx)
    if (!kickoff) throw new Error('The saved scoring calendar is required for the combat deadline.')
    const deadline = betaCombatDeadline(kickoff)
    for (const match of snapshot.itemMatchups) {
      if (match.homeScore === match.awayScore) continue
      const homeWins = match.homeScore > match.awayScore
      const winnerRosterId = homeWins ? match.homeRosterId : match.awayRosterId
      const loserRosterId = homeWins ? match.awayRosterId : match.homeRosterId
      const winner = snapshot.teams.find(t => t.rosterId === winnerRosterId)
      const loser = snapshot.teams.find(t => t.rosterId === loserRosterId)
      const winnerId = snapshot.owners.find(o => o.rosterId === winnerRosterId)?.userId
      const loserId = snapshot.owners.find(o => o.rosterId === loserRosterId)?.userId
      if (!winner || !loser || !winnerId || !loserId) throw new Error('Combat owners are missing from the sealed snapshot.')
      const margin = Math.round(Math.abs(match.homeScore - match.awayScore) * 100) / 100
      if (margin < 60 || !['Survivor', 'Zombie'].includes(winner.status)) continue
      const kind = betaCombatKind(winner.status as 'Survivor' | 'Zombie', loser.status as 'Survivor' | 'Zombie' | 'Whisperer', margin)
      const eventId = `combat-event:${z.id}:${week}:${match.matchupId}`
      const winScore = homeWins ? match.homeScore : match.awayScore
      const loseScore = homeWins ? match.awayScore : match.homeScore
      if (winner.status === 'Survivor') {
        await tx.zombieBashingEvent.create({ data: { id: eventId, leagueId: z.leagueId, week, winnerUserId: winnerId, loserUserId: loserId,
          winnerStatus: winner.status, loserStatus: loser.status, winnerScore: winScore, loserScore: loseScore, margin,
          bashingType: `survivor_bashes_${loser.status.toLowerCase()}`, requiresDecision: Boolean(kind), decisionDeadline: kind ? deadline : null,
          serumAwarded: loser.status === 'Zombie', resolvedAt: kind ? null : new Date() } })
      } else {
        await tx.zombieMaulingEvent.create({ data: { id: eventId, leagueId: z.leagueId, week, maulerUserId: winnerId, victimUserId: loserId,
          maulerStatus: winner.status, victimStatus: loser.status, maulerScore: winScore, victimScore: loseScore, margin,
          maulingType: `zombie_mauls_${loser.status.toLowerCase()}`, lootMultiplier: 1, serumAutoAwarded: true, resolvedAt: kind ? null : new Date() } })
      }
      if (!kind) continue
      const old = loser.status === 'Whisperer' ? await tx.whispererRecord.findUnique({ where: { zombieLeagueId } }) : null
      if (loser.status === 'Whisperer' && (!old || old.userId !== loserId || old.wasDefeated)) throw new Error('Whisperer succession requires review of the current role.')
      const revived = items.revivedRosterIds?.includes(winnerRosterId) === true
      const state: State = { policy: 'beta_2025', eventId, winnerRosterId, loserRosterId,
        remaining: old?.ambushesRemaining ?? 0, granted: old?.ambushesGranted ?? 0, used: old?.ambushesUsed ?? 0, revived }
      const id = `choice:${z.id}:${week}:${match.matchupId}`
      const eligible = kind !== 'whisperer_maul' || revived
      if (kind === 'whisperer_maul') await defeated(tx, z, loserRosterId, winnerRosterId, week, winnerId)
      await tx.zombieRoleWorkflow.create({ data: { id, zombieLeagueId, week, kind, actorUserId: winnerId, targetUserId: loserId,
        deadlineAt: eligible ? deadline : null, status: eligible ? 'pending' : 'complete', decision: eligible ? null : 'no_successor',
        decidedAt: eligible ? null : new Date(), state: toPrismaJsonInput(state) } })
      if (eligible) await privateNotice(tx, `${id}:choice`, winnerId, z.leagueId, 'Combat decision available',
        kind === 'survivor_bash' ? `Spare or infect your opponent before ${deadline.toISOString()}. No response means spare.` :
        kind === 'whisperer_bash' ? `Spare the Whisperer or replace them with their ${state.remaining} remaining ambushes before ${deadline.toISOString()}. No response means spare.` :
        `You revived after mauling the Whisperer. Become Whisperer with ${state.remaining} remaining ambushes or remain a Survivor. Respond by ${deadline.toISOString()}; no response leaves the seat vacant.`)
      if (kind === 'whisperer_maul') await roleChat(tx, z, `${id}:fallen`, 'The Whisperer was mauled and joined the Horde. Succession follows the 2025 revival rule.')
      if (kind === 'whisperer_maul' && !eligible) await tx.zombieMaulingEvent.update({ where: { id: eventId }, data: { resolvedAt: new Date() } })
      await audit(tx, z, 'combat_decision_created', { workflowId: id, kind, week, winnerId, loserId, deadlineAt: eligible ? deadline.toISOString() : null, ...state })
    }
    await tx.zombieRoleWorkflow.create({ data: { id: receiptId, zombieLeagueId, week, kind: 'combat_receipt', status: 'complete', state: { policy: 'beta_2025' } } })
  })
}

async function finishChoice(tx: Tx, z: ZombieLeague, row: ZombieRoleWorkflow, decision: string, actor: string | null, defaulted: boolean) {
  const state = stateOf(row)
  const allowed = row.kind === 'survivor_bash' ? ['spare', 'infect'] : row.kind === 'whisperer_bash' ? ['spare', 'replace'] : ['decline', 'become_whisperer']
  if (!allowed.includes(decision)) throw new Error('That decision is not available for this combat event.')
  const resolution = await tx.zombieWeeklyResolution.findUnique({ where: { zombieLeagueId_week: { zombieLeagueId: z.id, week: row.week! } } })
  if (resolution?.status !== 'complete' || resolution.requiresStatCorrection) throw new Error('This week must finish settlement and correction review before the choice can resolve.')
  const winner = await tx.zombieLeagueTeam.findUniqueOrThrow({ where: { leagueId_rosterId: { leagueId: z.leagueId, rosterId: state.winnerRosterId! } } })
  const loser = await tx.zombieLeagueTeam.findUniqueOrThrow({ where: { leagueId_rosterId: { leagueId: z.leagueId, rosterId: state.loserRosterId! } } })
  if (['infect', 'replace', 'become_whisperer'].includes(decision)) {
    if (winner.status !== 'Survivor') throw new Error('The winning manager is no longer an eligible Survivor; commissioner review is required.')
    if (decision === 'infect') {
      if (loser.status !== 'Survivor') throw new Error('The target role changed; commissioner review is required.')
      await tx.zombieLeagueTeam.update({ where: { id: loser.id }, data: { status: 'Zombie', isWhisperer: false, weekBecameZombie: row.week,
        killedAtWeek: row.week, killedByRosterId: winner.rosterId, killedByUserId: row.actorUserId, revivedAt: null } })
    } else {
      const record = await tx.whispererRecord.findUniqueOrThrow({ where: { zombieLeagueId: z.id } })
      if (record.userId !== row.targetUserId || (decision === 'replace' ? record.wasDefeated || loser.status !== 'Whisperer' : !record.wasDefeated || loser.status !== 'Zombie' || !state.revived)) throw new Error('The Whisperer seat changed; commissioner review is required.')
      if (decision === 'replace') {
        // Read the CURRENT balance: an intervening legal ambush must never be refunded.
        state.remaining = record.ambushesRemaining; state.granted = record.ambushesGranted; state.used = record.ambushesUsed
        await defeated(tx, z, loser.rosterId, winner.rosterId, row.week!, row.actorUserId!)
      }
      await appoint(tx, z, { userId: row.actorUserId!, rosterId: winner.rosterId, name: winner.fantasyTeamName || winner.displayName || 'The Whisperer', veteran: winner.isVeteran },
        { remaining: state.remaining!, granted: state.granted!, used: state.used! })
    }
  }
  await tx.zombieRoleWorkflow.update({ where: { id: row.id }, data: { status: 'complete', decision, decidedByUserId: actor,
    decidedAt: new Date(), state: toPrismaJsonInput(state) } })
  if (row.kind === 'survivor_bash' || row.kind === 'whisperer_bash') await tx.zombieBashingEvent.update({ where: { id: state.eventId! }, data: {
    decisionMade: decision, decisionMadeAt: new Date(), defaultedToRule: defaulted, resolvedAt: new Date(),
  } })
  else await tx.zombieMaulingEvent.update({ where: { id: state.eventId! }, data: {
    newWhispererTriggered: decision === 'become_whisperer', newWhispererUserId: decision === 'become_whisperer' ? row.actorUserId : null, resolvedAt: new Date(),
  } })
  await audit(tx, z, 'combat_decision', { workflowId: row.id, week: row.week, decision, actor, defaulted, remainingAmbushes: state.remaining })
  await roleChat(tx, z, `${row.id}:resolved`, decision === 'infect' ? 'A bashing decision turned a Survivor into a Zombie.' :
    decision === 'replace' || decision === 'become_whisperer' ? 'A new Whisperer accepted the role and inherited the remaining seasonal ambushes.' :
    row.kind === 'whisperer_maul' ? 'The succession choice closed. No replacement Whisperer will be chosen this season.' : 'The bashing decision closed: the losing team was spared.')
}

export async function respondBetaRoleWorkflow(leagueId: string, workflowId: string, userId: string, decision: string, offerIndex?: number) {
  return combatTransaction(async tx => {
    await lockItemLeague(tx, leagueId)
    const z = await tx.zombieLeague.findUniqueOrThrow({ where: { leagueId } })
    const row = await tx.zombieRoleWorkflow.findUniqueOrThrow({ where: { id: workflowId } })
    if (z.sport !== 'NFL' || row.zombieLeagueId !== z.id) throw new Error('This decision belongs to another manager or league.')
    if (row.kind === 'initial_offer') {
      const state = stateOf(row)
      if (!Number.isInteger(offerIndex)) throw new Error('Review the current offer before responding.')
      const previousResponse = state.offers?.[offerIndex!]
      if (previousResponse?.userId === userId && previousResponse.result === decision) return { ok: true, alreadyResolved: true }
      if (offerIndex !== state.index) throw new Error('The offer changed. Refresh before responding.')
    }
    if (row.actorUserId !== userId) throw new Error('This decision belongs to another manager or league.')
    if (row.status === 'complete' && row.decision === decision && row.decidedByUserId === userId) return { ok: true, alreadyResolved: true }
    if (row.status !== 'pending' || !row.deadlineAt || row.deadlineAt.getTime() <= Date.now()) throw new Error('This decision is closed or expired. Refresh the Zombie tab.')
    if (row.kind === 'initial_offer') {
      if (!['accept', 'decline'].includes(decision)) throw new Error('Choose accept or decline.')
      const state = stateOf(row), candidate = state.candidates?.[state.index ?? 0]
      if (candidate?.userId !== userId) throw new Error('Offer order changed; refresh before responding.')
      if (await tx.whispererRecord.findUnique({ where: { zombieLeagueId: z.id } })) throw new Error('The Whisperer has already been assigned.')
      state.offers = [...(state.offers ?? []), { userId, result: decision, at: new Date().toISOString() }]
      if (decision === 'accept') {
        const team = await tx.zombieLeagueTeam.findUniqueOrThrow({ where: { leagueId_rosterId: { leagueId, rosterId: candidate.rosterId } } })
        const roster = await tx.roster.findUniqueOrThrow({ where: { id: candidate.rosterId } })
        if (team.status !== 'Survivor' || roster.platformUserId !== userId) throw new Error('The offered roster changed; commissioner review is required.')
        await appoint(tx, z, candidate, { remaining: BETA_AMBUSH_LIMIT, granted: BETA_AMBUSH_LIMIT, used: 0 })
        await tx.zombieRoleWorkflow.update({ where: { id: row.id }, data: { status: 'complete', decision, decidedByUserId: userId, decidedAt: new Date(), state: toPrismaJsonInput(state) } })
        await roleChat(tx, z, `${row.id}:accepted`, 'The Whisperer offer has been accepted. The infection begins.')
      } else { state.index = (state.index ?? 0) + 1; await offerNext(tx, z, row, state, new Date()) }
      await audit(tx, z, 'whisperer_offer_response', { workflowId, userId, decision })
    } else await finishChoice(tx, z, row, decision, userId, false)
    return { ok: true }
  })
}

export async function expireBetaRoleWorkflows() {
  const due = await prisma.zombieRoleWorkflow.findMany({ where: { status: 'pending', deadlineAt: { lte: new Date() } }, select: { id: true, zombieLeagueId: true }, orderBy: { deadlineAt: 'asc' }, take: 100 })
  const errors: string[] = []
  for (const item of due) {
    try {
      await combatTransaction(async tx => {
        const z = await tx.zombieLeague.findUniqueOrThrow({ where: { id: item.zombieLeagueId } })
        await lockItemLeague(tx, z.leagueId)
        const row = await tx.zombieRoleWorkflow.findUniqueOrThrow({ where: { id: item.id } })
        if (row.status !== 'pending' || !row.deadlineAt || row.deadlineAt.getTime() > Date.now()) return
        if (row.kind === 'initial_offer') {
          const state = stateOf(row)
          state.offers = [...(state.offers ?? []), { userId: row.actorUserId!, result: 'expired', at: new Date().toISOString() }]
          state.index = (state.index ?? 0) + 1
          await audit(tx, z, 'whisperer_offer_expired', { workflowId: row.id, userId: row.actorUserId })
          await offerNext(tx, z, row, state, new Date())
        } else await finishChoice(tx, z, row, row.kind === 'whisperer_maul' ? 'decline' : 'spare', null, true)
      })
    } catch { errors.push(`role workflow ${item.id}: pending retry or commissioner review`) }
  }
  return errors
}

export async function betaWhispererSelectionPending(zombieLeagueId: string) {
  return Boolean(await prisma.zombieRoleWorkflow.findFirst({ where: { zombieLeagueId, kind: 'initial_offer', status: { in: ['pending', 'review_required'] } }, select: { id: true } }))
}
