import { prisma } from '@/lib/prisma'
import { readClassJoinRequests } from '@/lib/class-rating/exceptions'
import { getOrphanAdoptionRequests } from '@/lib/orphan-marketplace/settings'
import type { WorkspaceTaskCandidate } from './taskSources'

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
 *   dues       teams that have not paid this season's dues (dues tracker on)
 *   payouts    payout requests waiting for approval
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

  const dues = asRecord(asRecord(input.settings).dues_tracker)
  if (dues.enabled === true && input.teams.length > 0) {
    const entries = new Map((Array.isArray(dues.entries) ? dues.entries : []).map((e) => [String(asRecord(e).teamId), asRecord(e)]))
    const unpaid = input.teams.filter((t) => {
      const e = entries.get(t.id)
      return !(e && (e.paid === true || (Array.isArray(e.paidSeasons) && e.paidSeasons.map(Number).includes(input.season))))
    })
    if (unpaid.length > 0) add(`operational:dues:${input.season}:v1`, 'League dues are unpaid', `${unpaid.length} of ${input.teams.length} teams have not paid ${input.season} dues: ${unpaid.slice(0, 4).map((t) => t.teamName ?? 'Unnamed team').join(', ')}${unpaid.length > 4 ? ', …' : ''}.`, settingsHref, 'standard')
  }

  for (const p of input.payouts) add(`operational:payout:${p.id}:v1`, 'Payout request awaits approval', 'A league payout request is waiting for commissioner approval.', settingsHref)

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
