/**
 * Turns each placed conference league (`TournamentLeague`) into a REAL app league: created through
 * the normal create-league pipeline, its placed entrants seated, a draft waiting in `pre_draft`.
 *
 * Reused, never re-implemented:
 *   - league + teams + open seats + the pre-draft `DraftSession` — `validateCreatePayload` +
 *     `executeCanonicalLeagueCreation`, exactly what `POST /api/leagues` runs (./conferenceLeagueSettings
 *     maps the tournament's rules onto that body);
 *   - seats — `assignLeagueSeat` / `releaseLeagueSeat`, the one writer for who holds a team;
 *   - draft order labels — `buildSlotOrderForLeague`, as `autoMaterializeDraftForLeague` uses it;
 *   - a scoring label the create preset cannot express alone — `saveLeagueNflScoringConfig`, the
 *     league scoring settings writer.
 *
 * 🛑 THE LINK IS THE GUARD. `TournamentLeague.leagueId` (already `@unique`) is written the moment a
 * league exists, so a re-run never creates a second league for a conference. Before that, a
 * compare-and-set to `status: 'provisioning'` stops two runs creating one at the same time; a claim
 * older than CLAIM_STALE_MS is treated as a crashed run and may be taken again.
 *
 * Each conference is its own unit: one failing is recorded and the rest carry on, and the next run
 * picks up exactly the conferences that are not `ready`. Every run writes ONE audit row with each
 * conference's outcome, which the control screen shows. No provider is called anywhere here.
 */
import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
import { executeCanonicalLeagueCreation } from '@/lib/league-creation/canonical/executeCanonicalLeagueCreation'
import { assignLeagueSeat, releaseLeagueSeat } from '@/lib/league/leagueSeats'
import { buildSlotOrderForLeague } from '@/lib/live-draft-engine/DraftSessionService'
import { saveLeagueNflScoringConfig } from '@/lib/nfl-scoring/NflScoringConfigService'
import { buildFullNflScoringConfig } from '@/lib/nfl-scoring/NflScoringPresets'
import { conferenceLeagueCreateBody, type ConferenceLeaguePlan } from './conferenceLeagueSettings'
import { readSettings } from './divisionsStore'
import { divisionsRulesLabels } from './rules'
import { syncConferenceCoCommissioners, syncConferenceDraftTimes, type CoCommissionerOutcome, type DraftTimeOutcome } from './conferenceLeagueSync'

export const CLAIM_STALE_MS = 10 * 60_000
export const CONFERENCE_LEAGUE_READY = 'ready'
const PROVISIONING = 'provisioning'

export type ConferenceLeagueOutcome = {
  tournamentLeagueId: string
  name: string
  outcome: 'created' | 'ready' | 'failed' | 'busy' | 'pending'
  leagueId: string | null
  error?: string
}

export type ProvisionResult = { outcomes: ConferenceLeagueOutcome[]; complete: boolean; coCommissioners?: CoCommissionerOutcome[]; draftTimes?: DraftTimeOutcome[] }

/**
 * After leagues are created: hand the tournament's co-commissioners and any draft time already set
 * down to them. Both are idempotent reconciles, and a failure here never undoes the setup itself.
 */
async function syncNewLeagues(tournamentId: string, actorId: string) {
  const coCommissioners = await syncConferenceCoCommissioners(tournamentId, actorId).catch(e => {
    console.warn('[tournament/divisions] co-commissioner sync did not run', e instanceof Error ? e.message : 'unknown error')
    return undefined
  })
  const draftTimes = await syncConferenceDraftTimes(tournamentId, actorId).catch(e => {
    console.warn('[tournament/divisions] draft time sync did not run', e instanceof Error ? e.message : 'unknown error')
    return undefined
  })
  return { coCommissioners, draftTimes }
}

type Member = { userId: string; draftSlot: number | null }

class ProvisionStepError extends Error {}

const safeMessage = (e: unknown) => (e instanceof ProvisionStepError ? e.message : 'League setup failed. Try again.')

/** Desired holder of each seat: members in draft-slot order, a missing or clashing slot takes the next free one. */
export function seatPlan(members: Member[], seats: number): Map<number, string> {
  const plan = new Map<number, string>()
  const sorted = [...members].sort((a, b) => (a.draftSlot ?? Infinity) - (b.draftSlot ?? Infinity) || (a.userId < b.userId ? -1 : 1))
  const rest: Member[] = []
  for (const m of sorted) {
    if (m.draftSlot && m.draftSlot <= seats && !plan.has(m.draftSlot)) plan.set(m.draftSlot, m.userId)
    else rest.push(m)
  }
  let slot = 1
  for (const m of rest) {
    while (plan.has(slot)) slot++
    if (slot > seats) throw new ProvisionStepError('More members than seats in this league.')
    plan.set(slot, m.userId)
  }
  return plan
}

/**
 * Seat every member in their slot's team. The commissioner holds seat 1 after creation; when that
 * seat belongs to someone else it is released first (they stay commissioner, with no team).
 * Idempotent: a seat already held by its member is left alone.
 */
async function seatMembers(tx: Prisma.TransactionClient, leagueId: string, commissionerId: string, members: Member[]) {
  const slots = await tx.leagueEntrySlot.findMany({ where: { leagueId }, orderBy: { slotNumber: 'asc' }, select: { slotNumber: true, rosterId: true } })
  const rosters = await tx.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } })
  const holder = new Map(rosters.map(r => [r.id, r.platformUserId]))
  const plan = seatPlan(members, slots.length)
  const people = new Set([commissionerId, ...members.map(m => m.userId)])
  for (const s of slots) {
    const current = s.rosterId ? holder.get(s.rosterId) : undefined
    if (s.rosterId && current && people.has(current) && plan.get(s.slotNumber) !== current) {
      const r = await releaseLeagueSeat(tx, { leagueId, rosterId: s.rosterId })
      if (!r.ok) throw new ProvisionStepError('A league seat could not be cleared.')
    }
  }
  for (const s of slots) {
    const userId = plan.get(s.slotNumber)
    if (!userId) continue
    if (!s.rosterId) throw new ProvisionStepError('The league is missing a team for a seat.')
    const r = await assignLeagueSeat(tx, { leagueId, rosterId: s.rosterId, userId })
    if (!r.ok) throw new ProvisionStepError(`A member could not be seated (${r.code}).`)
  }
}

/** The pre-draft order's names and open flags, rebuilt from who now holds each seat. */
async function refreshDraftOrder(leagueId: string) {
  const session = await prisma.draftSession.findFirst({ where: { leagueId, status: 'pre_draft' }, orderBy: { createdAt: 'desc' }, select: { id: true, teamCount: true } })
  if (!session) throw new ProvisionStepError('The league has no draft waiting to be scheduled.')
  const order = await buildSlotOrderForLeague(leagueId)
  if (order.length !== session.teamCount) return
  await prisma.draftSession.updateMany({ where: { id: session.id, status: 'pre_draft' }, data: { slotOrder: order as unknown as Prisma.InputJsonValue, version: { increment: 1 } } })
}

async function applyScoringOverride(leagueId: string, plan: ConferenceLeaguePlan, commissionerId: string) {
  if (!plan.scoringOverride) return
  const rules = buildFullNflScoringConfig(plan.scoringOverride.presetKey)
  if (plan.scoringOverride.tePremiumPoints != null) rules.te_premium = plan.scoringOverride.tePremiumPoints
  await saveLeagueNflScoringConfig(leagueId, { presetKey: plan.scoringOverride.presetKey, rules, userId: commissionerId })
}

async function createLeague(commissionerId: string, body: unknown): Promise<string> {
  const valid = validateCreatePayload(body)
  if (!valid.ok) throw new ProvisionStepError(`The league settings were refused: ${valid.error}`)
  const result = await executeCanonicalLeagueCreation({ appUserId: commissionerId, body: valid.data })
  if (!result.ok) throw new ProvisionStepError(`The league could not be created: ${result.response.error}`)
  return result.response.league.id
}

/**
 * Create, seat and link every conference league of a placed divisions tournament that is not ready
 * yet. Safe to call repeatedly. Stops starting new conferences after `budgetMs`; the rest come back
 * as `pending` for the next call.
 */
export async function provisionConferenceLeagues(tournamentId: string, actorId: string, opts: { budgetMs?: number } = {}): Promise<ProvisionResult> {
  const started = Date.now()
  const budget = opts.budgetMs ?? 45_000
  const shell = await prisma.tournamentShell.findUnique({ where: { id: tournamentId }, select: { id: true, format: true, status: true, sport: true, commissionerId: true, formatSettings: true } })
  if (!shell || shell.format !== 'divisions' || !['placed', 'live', 'complete'].includes(shell.status)) return { outcomes: [], complete: false }
  const sport = readSettings(shell.formatSettings, shell.sport).sport
  const rules = divisionsRulesLabels(sport, shell.formatSettings)
  const leagues = await prisma.tournamentLeague.findMany({
    where: { tournamentId, divisionId: { not: null }, conferenceId: { not: null } },
    orderBy: { leagueNumber: 'asc' },
    select: { id: true, name: true, leagueId: true, status: true, teamSlots: true, participants: { select: { userId: true, draftSlot: true } } },
  })

  const outcomes: ConferenceLeagueOutcome[] = []
  for (const tl of leagues) {
    const base = { tournamentLeagueId: tl.id, name: tl.name }
    if (tl.leagueId && tl.status === CONFERENCE_LEAGUE_READY) { outcomes.push({ ...base, outcome: 'ready', leagueId: tl.leagueId }); continue }
    if (Date.now() - started > budget) { outcomes.push({ ...base, outcome: 'pending', leagueId: tl.leagueId }); continue }

    let leagueId = tl.leagueId
    try {
      const { plan, body } = conferenceLeagueCreateBody(sport, rules, { name: tl.name, teamCount: tl.teamSlots })
      if (!leagueId) {
        const claim = await prisma.tournamentLeague.updateMany({
          where: { id: tl.id, leagueId: null, OR: [{ status: { not: PROVISIONING } }, { updatedAt: { lt: new Date(Date.now() - CLAIM_STALE_MS) } }] },
          data: { status: PROVISIONING },
        })
        if (claim.count !== 1) { outcomes.push({ ...base, outcome: 'busy', leagueId: null }); continue }
        const created = await createLeague(shell.commissionerId, body)
        const linked = await prisma.tournamentLeague.updateMany({ where: { id: tl.id, leagueId: null }, data: { leagueId: created } })
        if (linked.count !== 1) throw new ProvisionStepError('Another run linked this conference first.')
        leagueId = created
      }
      const id = leagueId
      await prisma.$transaction(tx => seatMembers(tx, id, shell.commissionerId, tl.participants), { maxWait: 10_000, timeout: 30_000 })
      await refreshDraftOrder(id)
      await applyScoringOverride(id, plan, shell.commissionerId)
      await prisma.tournamentLeague.update({ where: { id: tl.id }, data: { status: CONFERENCE_LEAGUE_READY, currentTeamCount: tl.participants.length } })
      outcomes.push({ ...base, outcome: 'created', leagueId: id })
    } catch (e) {
      console.warn('[tournament/divisions] conference league setup failed', tl.id, e instanceof Error ? e.message : 'unknown error')
      // An unlinked claim is handed back at once so a retry need not wait out the stale window.
      if (!leagueId) await prisma.tournamentLeague.updateMany({ where: { id: tl.id, leagueId: null, status: PROVISIONING }, data: { status: 'forming' } }).catch(() => undefined)
      outcomes.push({ ...base, outcome: 'failed', leagueId, error: e instanceof Error && e.name === 'ConferenceLeagueRulesError' ? e.message : safeMessage(e) })
    }
  }

  const complete = outcomes.length > 0 && outcomes.every(o => o.outcome === 'created' || o.outcome === 'ready')
  const counts = Object.fromEntries((['created', 'ready', 'failed', 'busy', 'pending'] as const).map(k => [k, outcomes.filter(o => o.outcome === k).length]))
  await prisma.tournamentAuditLog.create({ data: {
    tournamentId, actorId, actorType: 'commissioner', action: 'divisions_conference_leagues_provisioned', targetType: 'tournament', targetId: tournamentId,
    data: { complete, counts, problems: outcomes.filter(o => o.outcome === 'failed' || o.outcome === 'busy').map(o => ({ league: o.name, outcome: o.outcome, error: o.error ?? null })) } as Prisma.InputJsonValue,
  } })
  const synced = outcomes.some(o => o.outcome === 'created') ? await syncNewLeagues(tournamentId, actorId) : {}
  return { outcomes, complete, ...synced }
}
