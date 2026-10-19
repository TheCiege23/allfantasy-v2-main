/**
 * Keeps each conference's REAL league (`TournamentLeague.leagueId`, created by ./conferenceLeagues)
 * in step with two things the commissioner sets on the tournament:
 *
 *   - DRAFT TIMES. `TournamentLeague.draftScheduledAt` is copied onto the league through
 *     `executeLeagueSettingsPatch` — the same server path a commissioner's own "draft date" save on a
 *     normal league runs (it writes `LeagueSettings.draftDateUtc` and pushes what the draft session
 *     needs). A league whose draft has started or finished is skipped and reported, never moved.
 *   - CO-COMMISSIONERS. Tournament staff whose grant carries `canEditSettings` become co-commissioners
 *     of every conference league: the league's own flag (`LeagueTeam.isCoCommissioner`) where they hold
 *     a team, and the league's tournament list (lib/league/tournamentCoCommissioners.ts) in every case,
 *     which `getLeagueRole` reads — so nobody is given a seat to get the rights. A grant removed on the
 *     tournament is removed from every league on the next sync.
 *
 * Both are idempotent reconciles: they compare what each league has with what the tournament says and
 * write only the difference, so a re-run writes nothing. Each league is its own unit; one failing is
 * reported and the rest carry on. An audit row is written only when something changed or failed.
 */
import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'
import { NOT_STARTED_DRAFT_STATUSES } from '@/lib/league/league-settings-draft-sync'
import { TOURNAMENT_CO_COMMISSIONERS_KEY, tournamentCoCommissionerIds } from '@/lib/league/tournamentCoCommissioners'

export type DraftTimeOutcome = {
  tournamentLeagueId: string
  name: string
  leagueId: string | null
  outcome: 'scheduled' | 'unchanged' | 'skipped_started' | 'not_ready' | 'failed'
  error?: string
}

export type CoCommissionerOutcome = {
  tournamentLeagueId: string
  name: string
  leagueId: string
  outcome: 'updated' | 'unchanged' | 'failed'
  added: number
  removed: number
  error?: string
}

async function auditSync(tournamentId: string, actorId: string, action: string, data: Record<string, unknown>) {
  await prisma.tournamentAuditLog.create({ data: {
    tournamentId, actorId, actorType: 'commissioner', action, targetType: 'tournament', targetId: tournamentId, data: data as Prisma.InputJsonValue,
  } })
}

async function patchError(res: Response): Promise<string> {
  const json = (await res.json().catch(() => null)) as { error?: unknown } | null
  return typeof json?.error === 'string' && json.error.length < 200 ? json.error : 'The league refused the draft time.'
}

/**
 * Copy each conference's tournament draft time onto its real league. `tournamentLeagueIds` limits it
 * to those conferences (setting one draft time); omitted, every conference with a time is checked.
 */
export async function syncConferenceDraftTimes(tournamentId: string, actorId: string, opts: { tournamentLeagueIds?: string[] } = {}): Promise<DraftTimeOutcome[]> {
  const shell = await prisma.tournamentShell.findUnique({ where: { id: tournamentId }, select: { commissionerId: true } })
  if (!shell) return []
  const rows = await prisma.tournamentLeague.findMany({
    where: { tournamentId, draftScheduledAt: { not: null }, ...(opts.tournamentLeagueIds ? { id: { in: opts.tournamentLeagueIds } } : {}) },
    orderBy: { leagueNumber: 'asc' },
    select: { id: true, name: true, leagueId: true, draftScheduledAt: true },
  })
  const outcomes: DraftTimeOutcome[] = []
  for (const row of rows) {
    const base = { tournamentLeagueId: row.id, name: row.name, leagueId: row.leagueId }
    const at = row.draftScheduledAt
    if (!at) continue
    // Not created yet: provisioning applies the time when it creates the league.
    if (!row.leagueId) { outcomes.push({ ...base, outcome: 'not_ready' }); continue }
    try {
      const session = await prisma.draftSession.findFirst({ where: { leagueId: row.leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER, select: { status: true } })
      if (session && !NOT_STARTED_DRAFT_STATUSES.has(session.status)) { outcomes.push({ ...base, outcome: 'skipped_started' }); continue }
      const ls = await prisma.leagueSettings.findUnique({ where: { leagueId: row.leagueId }, select: { draftDateUtc: true } })
      if (ls?.draftDateUtc && ls.draftDateUtc.getTime() === at.getTime()) { outcomes.push({ ...base, outcome: 'unchanged' }); continue }
      // The league's commissioner is the tournament owner; the tournament route has already checked
      // that the actor may change tournament settings.
      const res = await executeLeagueSettingsPatch(shell.commissionerId, { leagueId: row.leagueId, draftDateUtc: at.toISOString() })
      if (!res.ok) { outcomes.push({ ...base, outcome: 'failed', error: await patchError(res) }); continue }
      outcomes.push({ ...base, outcome: 'scheduled' })
    } catch (e) {
      console.warn('[tournament/divisions] draft time sync failed', row.id, e instanceof Error ? e.message : 'unknown error')
      outcomes.push({ ...base, outcome: 'failed', error: 'The draft time could not be set on this league. Try again.' })
    }
  }
  if (outcomes.some(o => o.outcome !== 'unchanged')) {
    await auditSync(tournamentId, actorId, 'divisions_draft_times_synced', {
      leagues: outcomes.map(o => ({ tournamentLeagueId: o.tournamentLeagueId, league: o.name, outcome: o.outcome, error: o.error ?? null })),
    })
  }
  return outcomes
}

/** The user ids that should be co-commissioner of every conference league: staff who may change settings. */
async function tournamentCoCommissioners(tournamentId: string, ownerId: string): Promise<Set<string>> {
  const grants = await prisma.tournamentShellGrant.findMany({ where: { tournamentId, canEditSettings: true }, select: { userId: true } })
  return new Set(grants.map(g => g.userId).filter(id => id !== ownerId))
}

async function reconcileLeague(tx: Prisma.TransactionClient, leagueId: string, desired: Set<string>) {
  const league = await tx.league.findUnique({ where: { id: leagueId }, select: { userId: true, settings: true } })
  if (!league) throw new Error('league missing')
  const want = new Set([...desired].filter(id => id !== league.userId))
  const current = new Set(tournamentCoCommissionerIds(league.settings))
  const added = [...want].filter(id => !current.has(id))
  const removed = [...current].filter(id => !want.has(id))
  const people = [...new Set([...want, ...current])]
  let flags = 0
  if (people.length) {
    const teams = await tx.leagueTeam.findMany({ where: { leagueId, claimedByUserId: { in: people } }, select: { id: true, claimedByUserId: true, isCommissioner: true, isCoCommissioner: true } })
    for (const t of teams) {
      if (t.isCommissioner || !t.claimedByUserId) continue
      const should = want.has(t.claimedByUserId)
      // Only a flag this tournament granted is taken away; one the league set itself is left alone.
      if (should && !t.isCoCommissioner) { await tx.leagueTeam.update({ where: { id: t.id }, data: { isCoCommissioner: true } }); flags++ }
      else if (!should && current.has(t.claimedByUserId) && t.isCoCommissioner) { await tx.leagueTeam.update({ where: { id: t.id }, data: { isCoCommissioner: false } }); flags++ }
    }
  }
  if (added.length || removed.length) {
    const settings = league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings) ? (league.settings as Record<string, unknown>) : {}
    await tx.league.update({ where: { id: leagueId }, data: { settings: { ...settings, [TOURNAMENT_CO_COMMISSIONERS_KEY]: [...want].sort() } as Prisma.InputJsonValue } })
  }
  return { added: added.length, removed: removed.length, changed: added.length > 0 || removed.length > 0 || flags > 0 }
}

/** Make every linked conference league's co-commissioners match the tournament's. Safe to call repeatedly. */
export async function syncConferenceCoCommissioners(tournamentId: string, actorId: string): Promise<CoCommissionerOutcome[]> {
  const shell = await prisma.tournamentShell.findUnique({ where: { id: tournamentId }, select: { commissionerId: true } })
  if (!shell) return []
  const desired = await tournamentCoCommissioners(tournamentId, shell.commissionerId)
  const rows = await prisma.tournamentLeague.findMany({ where: { tournamentId, leagueId: { not: null } }, orderBy: { leagueNumber: 'asc' }, select: { id: true, name: true, leagueId: true } })
  const outcomes: CoCommissionerOutcome[] = []
  for (const row of rows) {
    const leagueId = row.leagueId
    if (!leagueId) continue
    const base = { tournamentLeagueId: row.id, name: row.name, leagueId }
    try {
      const r = await prisma.$transaction(tx => reconcileLeague(tx, leagueId, desired))
      outcomes.push({ ...base, outcome: r.changed ? 'updated' : 'unchanged', added: r.added, removed: r.removed })
    } catch (e) {
      console.warn('[tournament/divisions] co-commissioner sync failed', row.id, e instanceof Error ? e.message : 'unknown error')
      outcomes.push({ ...base, outcome: 'failed', added: 0, removed: 0, error: 'Co-commissioners could not be updated on this league. Try again.' })
    }
  }
  if (outcomes.some(o => o.outcome !== 'unchanged')) {
    await auditSync(tournamentId, actorId, 'divisions_co_commissioners_synced', {
      coCommissioners: desired.size,
      leagues: outcomes.map(o => ({ tournamentLeagueId: o.tournamentLeagueId, league: o.name, outcome: o.outcome, added: o.added, removed: o.removed, error: o.error ?? null })),
    })
  }
  return outcomes
}
