import { prisma } from '@/lib/prisma'
import { readClassJoinRequests } from '@/lib/class-rating/exceptions'
import { getOrphanAdoptionRequests } from '@/lib/orphan-marketplace/settings'
import { openDisputes, readDisputes } from '@/lib/disputes/disputeStore'
import type { WorkspaceTaskCandidate } from './taskSources'
import { isTracking, readDuesConfig } from '@/lib/dues/duesTracker'
import { isLeagueEntryFeeProcessingEnabled } from '@/lib/monetization/leagueEntryFeeKillSwitch'

/**
 * Commish Inbox detectors (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3.1): the rest of what waits on a
 * commissioner, added to the Commissioner Action Queue beside `operationalTasks.ts`. Same bar as the
 * detectors there — measured from stored rows, actionable, and each one clears itself when the
 * condition does (the key disappears from the next detection, so `reconcileLeagueTasks` closes it).
 *
 *   keepers    an open keeper session with teams still to submit; unresolved keeper conflicts
 *   alerts     open AI commissioner alerts (snoozed ones wait until the snooze ends)
 *   integrity  open integrity flags (duplicate managers, collusion signals)
 *   joins      division-gate join requests waiting on a decision
 *   adoptions  pending orphan-team adoption requests
 *   dues       teams that have not paid this season's dues (the league tracks dues)
 *   dues-claim managers who said "I paid" and are waiting for the commissioner to confirm
 *   rules      member rule proposals waiting for the commissioner's approval
 *   draft-time an open draft-time poll — everyone has answered, or it closes within a day
 *   payouts    payout requests waiting for approval — only while AllFantasy holds league money
 *   disputes   disputes filed on the dispute desk with no ruling yet (critical after 3 days)
 */

type Severity = 'critical' | 'elevated' | 'standard' | 'advisory'

export type InboxConditionInput = {
  leagueId: string
  season: number
  keeperSessions: Array<{ id: string; deadline: Date; totalTeams: number; teamsSubmitted: number; conflictsDetected: unknown; conflictsResolved: boolean }>
  alerts: Array<{ alertId: string; headline: string; summary: string | null; severity: string; snoozedUntil: Date | null }>
  integrity: Array<{ id: string; flagType: string; severity: string | null; summary: string | null }>
  settings: unknown
  teams: Array<{ id: string; teamName: string | null }>
  payouts: Array<{ id: string }>
  /** Whether AllFantasy holds league money (lib/monetization/leagueEntryFeeKillSwitch.ts). Defaults to the live switch. */
  moneyHoldingEnabled?: boolean
}

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const level = (s: string | null | undefined): Severity => (s === 'critical' || s === 'high' ? 'critical' : s === 'low' ? 'standard' : 'elevated')
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function detectInboxConditions(input: InboxConditionInput, now: Date): WorkspaceTaskCandidate[] {
  const tasks: WorkspaceTaskCandidate[] = [], id = encodeURIComponent(input.leagueId)
  const settingsHref = `/league/${id}?view=settings`
  const add = (sourceKey: string, title: string, description: string, href: string, priority: Severity = 'elevated', dueAt?: Date) =>
    tasks.push({ sourceKey, title, description, priority, automationCandidate: false, dueAt, relatedLinks: [{ label: 'Review league', moduleId: 'settings', href }] })

  for (const s of input.keeperSessions) {
    const missing = Math.max(0, s.totalTeams - s.teamsSubmitted)
    if (missing > 0) {
      const soon = s.deadline.getTime() - now.getTime() <= 48 * 3600_000
      add(`operational:keepers:${s.id}:v1`, 'Keeper picks are missing', `${missing} of ${s.totalTeams} teams have not submitted keepers. Picks lock at the deadline; teams that miss it follow the league's missed-deadline rule.`, settingsHref, soon ? 'critical' : 'elevated', s.deadline)
    }
    const conflicts = Array.isArray(s.conflictsDetected) ? s.conflictsDetected.length : 0
    if (conflicts > 0 && !s.conflictsResolved) add(`operational:keeper-conflicts:${s.id}:v1`, 'Keeper conflicts need a ruling', `${plural(conflicts, 'team')} kept two players who cost the same round. Resolve them before keepers lock.`, settingsHref, 'critical', s.deadline)
  }

  for (const a of input.alerts) {
    if (a.snoozedUntil && a.snoozedUntil.getTime() > now.getTime()) continue
    add(`operational:alert:${a.alertId}:v1`, a.headline, a.summary ?? 'An AI commissioner alert is open for this league.', settingsHref, level(a.severity))
  }

  for (const f of input.integrity) add(`operational:integrity:${f.id}:v1`, 'Integrity flag to review', f.summary ?? `An open ${f.flagType.replace(/_/g, ' ')} flag needs a commissioner decision.`, settingsHref, level(f.severity))

  const joins = readClassJoinRequests(input.settings)
  if (joins.length > 0) add('operational:join-requests:v1', 'Join requests are waiting', `${plural(joins.length, 'manager')} asked to join outside the league's division. Approve or decline each request.`, settingsHref)

  const adoptions = getOrphanAdoptionRequests(input.settings).filter((r) => r.status === 'pending')
  for (const r of adoptions) add(`operational:adoption:${r.id}:v1`, 'Orphan team adoption request', `${r.requesterName} asked to take over an open team. Approve or reject the request.`, settingsHref)

  /*
   * ⚠ THROUGH THE TRACKER'S OWN RULES. This gated on `dues_tracker.enabled === true`, a switch the dues
   * panel never showed, so no league that tracked dues ever got the task. `isTracking` counts a league
   * with an amount set, as the tracker itself does.
   */
  const dues = readDuesConfig(asRecord(input.settings).dues_tracker)
  if (isTracking(dues) && input.teams.length > 0) {
    const entries = new Map(dues.entries.map((e) => [e.teamId, e]))
    const paidThisSeason = (teamId: string) => {
      const e = entries.get(teamId)
      return Boolean(e && (e.paid || e.paidSeasons.includes(input.season)))
    }
    const unpaid = input.teams.filter((t) => !paidThisSeason(t.id))
    if (unpaid.length > 0) add(`operational:dues:${input.season}:v1`, 'League dues are unpaid', `${unpaid.length} of ${input.teams.length} teams have not paid ${input.season} dues: ${unpaid.slice(0, 4).map((t) => t.teamName ?? 'Unnamed team').join(', ')}${unpaid.length > 4 ? ', …' : ''}.`, settingsHref, 'standard')
    // "I paid" is a claim; confirming it is the commissioner's job, and a claim nobody confirms reads as ignored.
    const claims = input.teams.filter((t) => !paidThisSeason(t.id) && entries.get(t.id)?.selfReportedAt)
    if (claims.length > 0) add(`operational:dues-claims:${input.season}:v1`, 'Managers say they paid dues', `${claims.slice(0, 4).map((t) => t.teamName ?? 'A team').join(', ')}${claims.length > 4 ? ', …' : ''} ${claims.length === 1 ? 'says it' : 'say they'} paid. Confirm it in the dues tracker once the money has arrived.`, settingsHref, 'elevated')
  }

  // Member rule proposals (lib/constitution): nothing reaches the league vote until the commissioner acts.
  const amendments = Array.isArray(asRecord(input.settings).constitution_amendments) ? (asRecord(input.settings).constitution_amendments as unknown[]) : []
  for (const raw of amendments) {
    const a = asRecord(raw)
    if (a.status !== 'pending_approval' || typeof a.id !== 'string') continue
    add(`operational:amendment-pending:${a.id}:v1`, 'A rule change is waiting for you', `A member proposed “${typeof a.title === 'string' ? a.title : 'a rule change'}”. Approve it to open the league vote, or decline it with a reason.`, `/league/${id}/constitution`, 'elevated')
  }

  // An open draft-time poll (lib/draft-schedule): ready to lock once it closes soon.
  const poll = asRecord(asRecord(input.settings).draft_schedule_poll)
  if (poll.status === 'open' && typeof poll.closesAt === 'string' && typeof poll.id === 'string') {
    const closes = Date.parse(poll.closesAt)
    if (Number.isFinite(closes) && closes - now.getTime() <= 24 * 3600_000) {
      add(`operational:draft-time-poll:${poll.id}:v1`, 'Lock a draft time', closes <= now.getTime() ? 'The draft-time poll has closed. Lock the time most managers can make.' : 'The draft-time poll closes within a day. Lock the time most managers can make.', settingsHref, closes <= now.getTime() ? 'critical' : 'elevated', new Date(closes))
    }
  }

  // While AllFantasy holds no league money every payout route refuses, so a payout task could not be acted on.
  if (input.moneyHoldingEnabled ?? isLeagueEntryFeeProcessingEnabled()) for (const p of input.payouts) add(`operational:payout:${p.id}:v1`, 'Payout request awaits approval', 'A league payout request is waiting for commissioner approval.', settingsHref)

  for (const d of openDisputes(readDisputes(input.settings))) {
    const stale = now.getTime() - Date.parse(d.createdAt) >= 3 * 86_400_000
    add(`operational:dispute:${d.id}:v1`, 'A dispute needs your ruling', `${d.filedByName ?? 'A manager'} filed “${d.subject}”. Rule on it from the dispute desk.`, `/league/${id}/disputes`, stale ? 'critical' : 'elevated')
  }

  return tasks
}

export async function readInboxTasks(leagueId: string, league: { season: number; settings: unknown }, now: Date): Promise<WorkspaceTaskCandidate[]> {
  // Failed reads throw, like the operational reads: reconciliation must not close findings it could not re-check.
  const [keeperSessions, alerts, integrity, teams, payouts] = await Promise.all([
    prisma.keeperSelectionSession.findMany({ where: { leagueId, status: 'open' }, select: { id: true, deadline: true, totalTeams: true, teamsSubmitted: true, conflictsDetected: true, conflictsResolved: true } }),
    prisma.aiCommissionerAlert.findMany({ where: { leagueId, status: 'open' }, select: { alertId: true, headline: true, summary: true, severity: true, snoozedUntil: true } }),
    prisma.integrityFlag.findMany({ where: { leagueId, status: 'open' }, select: { id: true, flagType: true, severity: true, summary: true } }),
    prisma.leagueTeam.findMany({ where: { leagueId }, select: { id: true, teamName: true } }),
    prisma.payoutRequest.findMany({ where: { leagueId, status: 'pending_approval' }, select: { id: true } }),
  ])
  return detectInboxConditions({ leagueId, season: league.season, keeperSessions, alerts, integrity, settings: league.settings, teams, payouts }, now)
}
