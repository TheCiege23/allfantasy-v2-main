/**
 * The divisions tournament lifecycle: registration → placement → reveal →
 * regular season → commit seeding → advance rounds → championship.
 *
 * 🛑 EVERY IRREVERSIBLE STEP IS ONE GUARDED WRITE. Commits take a compare-and-set
 * on the row they change (status, `seedingCommittedAt IS NULL`, `roundsCommitted =
 * r − 1`), so a double click or two commissioners racing cannot apply a step
 * twice, and each writes the audit log. Seeds, winners and placements come from
 * the pure engine — this file only reads, checks and persists.
 *
 * ⚠ A missing score is never zero. Seeding is blocked while any regular-season
 * result is provisional; a round is blocked while any game lacks a final score.
 */
import 'server-only'
import { randomInt } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/tournament/tournamentPermissions'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { DivisionsOperationError, DIVISIONS_FORMAT, readDivisionsState, readRegistration, viewFromState, type DivisionsState } from './divisionsStore'
import { computeDivision, planRound, seedingBlockers, roundLabel, decideGame, bracketFromSeeds, type WeekScore } from './engine'
import { leagueDisplayName } from './identity'
import { placeEntrants, promotions, type PlacementEntrant } from './registration'
import { readWeekScores } from './weekScores'
import { sendMoment, postMomentToLeagueChats, type MomentRecipient } from './notify'

const ACTIVE = ['registered', 'waitlisted']
const hubHref = (id: string) => `/tournament-hub/${encodeURIComponent(id)}`

type Tx = Prisma.TransactionClient

async function audit(tx: Tx, tournamentId: string, actorId: string, action: string, data: Prisma.InputJsonValue, target?: { type: string; id: string }) {
  await tx.tournamentAuditLog.create({ data: { tournamentId, actorId, actorType: 'commissioner', action, targetType: target?.type ?? 'tournament', targetId: target?.id ?? tournamentId, data } })
}

/** Owner, or staff whose grant carries the capability. */
async function assertCan(tx: Tx, tournamentId: string, userId: string, capability: 'advance' | 'editSettings') {
  const shell = await tx.tournamentShell.findUnique({ where: { id: tournamentId } })
  if (!shell || shell.format !== DIVISIONS_FORMAT) throw new DivisionsOperationError('Tournament not found.', 404)
  if (shell.commissionerId === userId) return shell
  const grant = await tx.tournamentShellGrant.findUnique({ where: { tournamentId_userId: { tournamentId, userId } } })
  if (!can({ userId, commissionerId: shell.commissionerId, grant }, capability)) throw new DivisionsOperationError('Only the commissioner can do that.', 403)
  return shell
}

/** Compare-and-set on the shell's status. Throws when someone else moved it first. */
async function moveStatus(tx: Tx, tournamentId: string, from: string, to: string, data: Prisma.TournamentShellUpdateManyMutationInput = {}) {
  const r = await tx.tournamentShell.updateMany({ where: { id: tournamentId, status: from }, data: { ...data, status: to } })
  if (r.count !== 1) throw new DivisionsOperationError('The tournament changed. Reload and try again.', 409)
}

// ── registration ─────────────────────────────────────────────────────────────

export async function openRegistration(userId: string, tournamentId: string, input: { closesAt: string; allowPreference: boolean; allowGrouping: boolean }) {
  const closes = Date.parse(input.closesAt)
  if (!Number.isFinite(closes) || closes <= Date.now()) throw new DivisionsOperationError('Registration must close in the future.', 409)
  return prisma.$transaction(async tx => {
    const shell = await assertCan(tx, tournamentId, userId, 'editSettings')
    const registration = { closesAt: new Date(closes).toISOString(), allowPreference: input.allowPreference, allowGrouping: input.allowGrouping, entry: 'Free' }
    const formatSettings = { ...((shell.formatSettings ?? {}) as Record<string, unknown>), registration } as Prisma.InputJsonValue
    await moveStatus(tx, tournamentId, 'blueprint', 'registering', { formatSettings })
    await audit(tx, tournamentId, userId, 'divisions_registration_opened', registration)
    return { ok: true }
  })
}

async function capacityOf(tx: Tx, tournamentId: string) {
  const shell = await tx.tournamentShell.findUnique({ where: { id: tournamentId }, select: { maxParticipants: true } })
  return shell?.maxParticipants ?? 0
}

export async function joinTournament(userId: string, tournamentId: string, input: { preference: 0 | 1 | null; ref: string | null }) {
  return prisma.$transaction(async tx => {
    const shell = await tx.tournamentShell.findUnique({ where: { id: tournamentId } })
    if (!shell || shell.format !== DIVISIONS_FORMAT) throw new DivisionsOperationError('Tournament not found.', 404)
    const registration = readRegistration(shell.formatSettings)
    if (shell.status !== 'registering' || (registration.closesAt && Date.parse(registration.closesAt) <= Date.now())) throw new DivisionsOperationError('Registration is closed. You can follow the tournament instead.', 409)
    // Serialise joins on the shell row so two last-spot joins cannot both get in.
    const locked = await tx.tournamentShell.updateMany({ where: { id: tournamentId, updatedAt: shell.updatedAt }, data: { updatedAt: new Date(Math.max(Date.now(), shell.updatedAt.getTime() + 1)) } })
    if (locked.count !== 1) throw new DivisionsOperationError('Registration is busy. Please try again.', 409)
    const existing = await tx.tournamentParticipant.findUnique({ where: { tournamentId_userId: { tournamentId, userId } } })
    if (existing && ACTIVE.includes(existing.status)) return { status: existing.status, participantId: existing.id }
    if (existing?.status === 'removed') throw new DivisionsOperationError('The commissioner removed this entry.', 403)
    const registered = await tx.tournamentParticipant.count({ where: { tournamentId, status: 'registered' } })
    const status = registered < shell.maxParticipants ? 'registered' : 'waitlisted'
    const user = await tx.appUser.findUnique({ where: { id: userId }, select: { displayName: true, username: true, avatarUrl: true } })
    if (!user) throw new DivisionsOperationError('Account not found.', 404)
    let invitedByUserId: string | null = null
    if (input.ref) {
      const inviter = await tx.appUser.findFirst({ where: { username: { equals: input.ref, mode: 'insensitive' } }, select: { id: true } })
      if (inviter && inviter.id !== userId) {
        const member = await tx.tournamentParticipant.findUnique({ where: { tournamentId_userId: { tournamentId, userId: inviter.id } }, select: { status: true } })
        if (member && ACTIVE.includes(member.status)) invitedByUserId = inviter.id
      }
    }
    const now = new Date()
    const data = {
      status, displayName: user.displayName || user.username || 'Manager', avatarUrl: user.avatarUrl,
      divisionPreference: registration.allowPreference && input.preference !== null ? input.preference + 1 : null,
      queuedAt: status === 'waitlisted' ? now : null, invitedByUserId,
    }
    const entrant = existing
      ? await tx.tournamentParticipant.update({ where: { id: existing.id }, data })
      : await tx.tournamentParticipant.create({ data: { tournamentId, userId, ...data } })
    await tx.tournamentShell.update({ where: { id: tournamentId }, data: { currentParticipantCount: registered + (status === 'registered' ? 1 : 0) } })
    await audit(tx, tournamentId, userId, 'divisions_entry_joined', { status, preference: data.divisionPreference, invited: Boolean(invitedByUserId) }, { type: 'participant', id: entrant.id })
    return { status, participantId: entrant.id }
  })
}

/** Leave before registration closes. A freed spot goes to the front of the waitlist, who is told. */
export async function leaveTournament(userId: string, tournamentId: string) {
  const promoted = await prisma.$transaction(async tx => {
    const shell = await tx.tournamentShell.findUnique({ where: { id: tournamentId } })
    if (!shell || shell.format !== DIVISIONS_FORMAT) throw new DivisionsOperationError('Tournament not found.', 404)
    if (shell.status !== 'registering') throw new DivisionsOperationError('Entries lock when registration closes.', 409)
    const entrant = await tx.tournamentParticipant.findUnique({ where: { tournamentId_userId: { tournamentId, userId } } })
    if (!entrant || !ACTIVE.includes(entrant.status)) return []
    await tx.tournamentParticipant.update({ where: { id: entrant.id }, data: { status: 'withdrawn', queuedAt: null } })
    await audit(tx, tournamentId, userId, 'divisions_entry_withdrawn', { from: entrant.status }, { type: 'participant', id: entrant.id })
    const registered = await tx.tournamentParticipant.count({ where: { tournamentId, status: 'registered' } })
    const queue = await tx.tournamentParticipant.findMany({ where: { tournamentId, status: 'waitlisted' }, select: { id: true, userId: true, queuedAt: true } })
    const next = promotions(queue.map(q => ({ ...q, queuedAt: q.queuedAt ?? new Date(0) })), (await capacityOf(tx, tournamentId)) - registered)
    for (const p of next) {
      await tx.tournamentParticipant.update({ where: { id: p.id }, data: { status: 'registered', queuedAt: null } })
      await audit(tx, tournamentId, userId, 'divisions_waitlist_promoted', {}, { type: 'participant', id: p.id })
    }
    await tx.tournamentShell.update({ where: { id: tournamentId }, data: { currentParticipantCount: registered + next.length } })
    return next.map(p => p.userId)
  })
  if (promoted.length) {
    try {
      await dispatchNotification({ userIds: promoted, category: 'league_announcements', type: 'tournament_waitlist_promoted', title: 'A spot opened — you’re in', body: 'You moved off the waitlist. You’ll be placed in a league when registration closes.', actionHref: hubHref(tournamentId) + '/join', skipChannels: { sms: true } })
    } catch { console.warn('[tournament/divisions] waitlist promotion notice failed') }
  }
  return { ok: true }
}

/** Closed registration: follow as a spectator. */
export async function followTournament(userId: string, tournamentId: string) {
  const shell = await prisma.tournamentShell.findUnique({ where: { id: tournamentId }, select: { format: true } })
  if (shell?.format !== DIVISIONS_FORMAT) throw new DivisionsOperationError('Tournament not found.', 404)
  const existing = await prisma.tournamentParticipant.findUnique({ where: { tournamentId_userId: { tournamentId, userId } } })
  if (existing) return { status: existing.status }
  const user = await prisma.appUser.findUnique({ where: { id: userId }, select: { displayName: true, username: true } })
  await prisma.tournamentParticipant.create({ data: { tournamentId, userId, status: 'following', displayName: user?.displayName || user?.username || 'Fan' } })
  return { status: 'following' }
}

export async function markRevealSeen(userId: string, tournamentId: string) {
  await prisma.tournamentParticipant.updateMany({ where: { tournamentId, userId, revealSeenAt: null }, data: { revealSeenAt: new Date() } })
  return { ok: true }
}

// ── placement ────────────────────────────────────────────────────────────────

/**
 * Close registration and place every registered entrant into a conference league.
 * Deterministic for its seed; the seed and the placement summary are audited.
 */
export async function closeAndPlace(userId: string, tournamentId: string) {
  const seed = randomInt(1, 2 ** 31 - 1)
  const placed = await prisma.$transaction(async tx => {
    const shell = await assertCan(tx, tournamentId, userId, 'editSettings')
    const state = await tx.tournamentShell.findUnique({ where: { id: tournamentId }, include: { divisions: { orderBy: { divisionNumber: 'asc' } }, conferences: { orderBy: { conferenceNumber: 'asc' } } } })
    if (!state || state.divisions.length !== 2 || !state.conferences.length) throw new DivisionsOperationError('Name both divisions and the conferences first.', 409)
    const registration = readRegistration(shell.formatSettings)
    const settings = (shell.formatSettings ?? {}) as { teamsPerConference?: number; seasonLength?: number; autoBids?: number; wildcardSpots?: number }
    const teamsPerConference = settings.teamsPerConference ?? shell.teamsPerLeague
    const entrants = await tx.tournamentParticipant.findMany({ where: { tournamentId, status: 'registered' }, select: { id: true, userId: true, displayName: true, divisionPreference: true, invitedByUserId: true } })
    if (entrants.length < 4) throw new DivisionsOperationError('At least four entrants are needed to place leagues.', 409)
    const byUser = new Map(entrants.map(e => [e.userId, e.id]))
    const placement = placeEntrants({
      entrants: entrants.map((e): PlacementEntrant => ({ id: e.id, preference: e.divisionPreference === 1 ? 0 : e.divisionPreference === 2 ? 1 : null, invitedBy: e.invitedByUserId ? byUser.get(e.invitedByUserId) ?? null : null })),
      conferences: state.conferences.length, teamsPerConference, allowPreference: registration.allowPreference, allowGrouping: registration.allowGrouping, seed,
    })
    await moveStatus(tx, tournamentId, 'registering', 'placed', { currentParticipantCount: entrants.length })
    const lastRegularWeek = (settings.seasonLength ?? 18) - 1 - Math.log2((settings.autoBids ?? 52) + (settings.wildcardSpots ?? 12))
    const round = await tx.tournamentRound.upsert({
      where: { tournamentId_roundNumber: { tournamentId, roundNumber: 1 } },
      create: { tournamentId, roundNumber: 1, roundType: 'conference_season', roundLabel: 'Regular season', weekStart: 1, weekEnd: lastRegularWeek, status: 'active' },
      update: {},
    })
    const out: Array<{ tournamentLeagueId: string; name: string; division: string; members: Array<{ participantId: string; userId: string }> }> = []
    let n = 0
    for (const league of placement.leagues) {
      const division = state.divisions[league.division]!, conference = state.conferences[league.conference]!
      const name = leagueDisplayName(conference.name, division.name)
      const row = await tx.tournamentLeague.create({ data: {
        tournamentId, roundId: round.id, conferenceId: conference.id, divisionId: division.id, name,
        slug: `${conference.slug}-${division.divisionNumber}`, leagueNumber: ++n, teamSlots: teamsPerConference,
        currentTeamCount: league.members.length, status: 'forming', advancersCount: 0,
      } })
      const members = league.members.map(id => entrants.find(e => e.id === id)!)
      for (const [slot, m] of members.entries()) {
        await tx.tournamentLeagueParticipant.create({ data: { tournamentLeagueId: row.id, participantId: m.id, userId: m.userId, draftSlot: slot + 1 } })
        await tx.tournamentParticipant.update({ where: { id: m.id }, data: { currentConferenceId: conference.id, originalConferenceId: conference.id, currentLeagueId: row.id } })
      }
      out.push({ tournamentLeagueId: row.id, name, division: division.name, members: members.map(m => ({ participantId: m.id, userId: m.userId })) })
    }
    await audit(tx, tournamentId, userId, 'divisions_leagues_placed', { ...placement.log, leagues: placement.leagues.map(l => ({ division: l.division, conference: l.conference, size: l.members.length })) })
    return { name: shell.name, leagues: out }
  })
  const recipients: MomentRecipient[] = placed.leagues.flatMap(l => l.members.map(m => ({ userId: m.userId, href: hubHref(tournamentId) + '/reveal', ctx: { tournament: placed.name, league: l.name, division: l.division, teams: l.members.length } })))
  await sendMoment(tournamentId, 'league_revealed', recipients)
  return { leagues: placed.leagues.length, seed }
}

/** The commissioner sets a league's draft time; its members hear about it at once. */
export async function setDraftTime(userId: string, tournamentId: string, tournamentLeagueId: string, at: string) {
  const when = Date.parse(at)
  if (!Number.isFinite(when) || when <= Date.now()) throw new DivisionsOperationError('Pick a draft time in the future.', 409)
  const league = await prisma.$transaction(async tx => {
    await assertCan(tx, tournamentId, userId, 'editSettings')
    const row = await tx.tournamentLeague.findFirst({ where: { id: tournamentLeagueId, tournamentId }, include: { participants: { select: { userId: true } }, division: { select: { name: true } } } })
    if (!row) throw new DivisionsOperationError('League not found.', 404)
    await tx.tournamentLeague.update({ where: { id: row.id }, data: { draftScheduledAt: new Date(when) } })
    await audit(tx, tournamentId, userId, 'divisions_draft_scheduled', { at: new Date(when).toISOString() }, { type: 'tournament_league', id: row.id })
    return row
  })
  const shell = await prisma.tournamentShell.findUnique({ where: { id: tournamentId }, select: { name: true, commissionerId: true } })
  const draftAt = new Date(when).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' })
  const ctx = { tournament: shell?.name ?? 'Your tournament', league: league.name, division: league.division?.name, draftAt }
  await sendMoment(tournamentId, 'draft_scheduled', league.participants.map(p => ({ userId: p.userId, href: hubHref(tournamentId), ctx })))
  if (league.leagueId && shell) await postMomentToLeagueChats('draft_scheduled', [{ leagueId: league.leagueId, postedBy: shell.commissionerId, ctx, key: `${league.id}_${when}` }])
  return { ok: true }
}

// ── control: seeding ─────────────────────────────────────────────────────────

export type ControlView = Awaited<ReturnType<typeof loadControl>>

export async function loadControl(userId: string, tournamentId: string) {
  const access = await prisma.$transaction(async tx => assertCan(tx, tournamentId, userId, 'advance').catch(() => null))
  if (!access) return null
  const state = await readDivisionsState(tournamentId)
  if (!state) return null
  const view = viewFromState(state, null)
  const audits = await prisma.tournamentAuditLog.findMany({ where: { tournamentId, action: { startsWith: 'divisions_' } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 30, select: { id: true, action: true, actorType: true, createdAt: true, data: true } })
  const confirmations = new Set(audits.filter(a => a.action === 'divisions_corrections_closed').map(a => (a.data as { week?: number } | null)?.week))
  const registration = await prisma.tournamentParticipant.groupBy({ by: ['status'], where: { tournamentId }, _count: { _all: true } })
  const preview = await previewRound(state)
  const slim = (e: { id: string; name: string; seedLine: number; region: string } | null) => (e ? { id: e.id, name: e.name, seedLine: e.seedLine, region: e.region } : null)
  const roundPreview = !preview ? null : preview.kind === 'division'
    ? { round: preview.round, week: preview.week, label: preview.label, kind: 'division' as const, blockers: [...new Set(preview.plans.flatMap(p => p.blockers))], divisions: preview.plans.map(p => ({ needsReview: p.needsReview, games: p.games.map(g => ({ key: g.key, a: slim(g.a), b: slim(g.b), scoreA: g.scoreA, scoreB: g.scoreB, winnerId: g.winner?.id ?? null, decidedBy: g.decidedBy })) })) }
    : { round: preview.round, week: preview.week, label: preview.label, kind: 'championship' as const, blockers: preview.champs.some(c => !c) ? ['Both division finals must be decided first.'] : [], champs: preview.champs.map(c => slim(c)), scores: preview.champs.map(c => (c ? preview.scores.get(c.id) ?? null : null)) }
  return { roundPreview, view, state: { status: state.shell.status, registration: state.registration, capacity: state.shell.maxParticipants }, seeding: seedingChecklist(state, confirmations), rounds: roundChecklist(state, view, confirmations), audits: audits.map(a => ({ id: a.id, action: a.action, at: a.createdAt.toISOString(), data: a.data })), counts: Object.fromEntries(registration.map(r => [r.status, r._count._all])) as Record<string, number>, leagues: state.leagues.map(l => ({ id: l.id, name: l.name, draftAt: l.draftScheduledAt?.toISOString() ?? null, teams: l.participants.length })) }
}

function seedingChecklist(state: NonNullable<DivisionsState>, confirmations: Set<number | undefined>) {
  const week = state.calendar.seedingLocksAfter
  const blockers: string[] = []
  const provisional = seedingBlockers(state.teams)
  const results = state.teams.length
  const ties = ([0, 1] as const).flatMap(d => {
    const teams = state.teams.filter(t => t.divisionIndex === d)
    const r = computeDivision(teams, state.settings)
    return r.reviewTies.map(id => ({ division: d, id, name: teams.find(t => t.id === id)?.name ?? '' }))
  })
  if (!results) blockers.push('No teams are placed yet.')
  blockers.push(...provisional)
  if (!confirmations.has(week)) blockers.push('Confirm the stat-correction window has closed.')
  if (ties.length) blockers.push(`${ties.length} tie${ties.length === 1 ? '' : 's'} on a line need a commissioner call.`)
  const committed = state.committed.every(Boolean)
  return { week, results, provisional: provisional.length === 0, correctionsClosed: confirmations.has(week), ties, committed, blockers: committed ? [] : blockers }
}

function roundChecklist(state: NonNullable<DivisionsState>, view: ReturnType<typeof viewFromState>, confirmations: Set<number | undefined>) {
  const done = state.committed[0]?.roundsCommitted ?? 0
  const total = state.calendar.weeks.length
  const next = done + 1
  const week = state.calendar.weeks[next - 1]
  return { committedRounds: done, nextRound: next <= total ? next : null, nextWeek: week?.week ?? null, nextLabel: week?.label ?? null, correctionsClosed: week ? confirmations.has(week.week) : false, championship: view.championship }
}

/** Record the commissioner's confirmation that a week's stat corrections are closed. */
export async function confirmCorrectionsClosed(userId: string, tournamentId: string, week: number) {
  await prisma.$transaction(async tx => {
    await assertCan(tx, tournamentId, userId, 'advance')
    await audit(tx, tournamentId, userId, 'divisions_corrections_closed', { week })
  })
  return { ok: true }
}

/** Tiebreaker 4: the commissioner orders teams nothing else separates. Higher number wins. */
export async function callTies(userId: string, tournamentId: string, calls: Record<string, number>) {
  await prisma.$transaction(async tx => {
    await assertCan(tx, tournamentId, userId, 'advance')
    const div = await tx.tournamentDivision.findFirst({ where: { tournamentId, seedingCommittedAt: { not: null } } })
    if (div) throw new DivisionsOperationError('Seeding is already committed.', 409)
    const prev = await tx.tournamentAuditLog.findFirst({ where: { tournamentId, action: 'divisions_tie_calls' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
    const merged = { ...(((prev?.data as { calls?: Record<string, number> } | null)?.calls) ?? {}), ...calls }
    await audit(tx, tournamentId, userId, 'divisions_tie_calls', { calls: merged })
  })
  return { ok: true }
}

export async function commitSeeding(userId: string, tournamentId: string) {
  const state = await readDivisionsState(tournamentId)
  if (!state) throw new DivisionsOperationError('Tournament not found.', 404)
  const audits = await prisma.tournamentAuditLog.findMany({ where: { tournamentId, action: 'divisions_corrections_closed' }, select: { data: true } })
  const checklist = seedingChecklist(state, new Set(audits.map(a => (a.data as { week?: number } | null)?.week)))
  if (checklist.committed) throw new DivisionsOperationError('Seeding is already committed.', 409)
  if (checklist.blockers.length) throw new DivisionsOperationError(checklist.blockers.join(' '), 409)
  const results = ([0, 1] as const).map(d => computeDivision(state.teams.filter(t => t.divisionIndex === d), state.settings))
  if (results.some(r => !r.seeded)) throw new DivisionsOperationError('Each division needs enough teams to fill its bracket.', 409)
  await prisma.$transaction(async tx => {
    await assertCan(tx, tournamentId, userId, 'advance')
    for (const [d, r] of results.entries()) {
      const div = state.shell.divisions[d]!
      const w = await tx.tournamentDivision.updateMany({ where: { id: div.id, seedingCommittedAt: null }, data: { seeding: r.seeded as unknown as Prisma.InputJsonValue, seedingCommittedAt: new Date(), bracketState: { scores: {}, overrides: {}, roundsCommitted: 0 } } })
      if (w.count !== 1) throw new DivisionsOperationError('Seeding was committed by someone else. Reload.', 409)
      const inField = new Set(r.seeded!.map(s => s.id))
      const ids = r.ranked.map(t => t.id)
      await tx.tournamentLeagueParticipant.updateMany({ where: { id: { in: ids.filter(id => inField.has(id)) } }, data: { advancementStatus: 'bracket' } })
      await tx.tournamentLeagueParticipant.updateMany({ where: { id: { in: ids.filter(id => !inField.has(id)) } }, data: { advancementStatus: 'eliminated' } })
      const tiebreaks = r.ranked.filter(t => t.tiebreak && t.tiebreak !== 'points').map(t => ({ rank: t.rank, team: t.name, by: t.tiebreak }))
      await audit(tx, tournamentId, userId, 'divisions_seeding_committed', { division: div.name, field: r.seeded!.length, tiebreaks })
    }
    await moveStatus(tx, tournamentId, 'placed', 'live')
  })
  // Notifications after the commit, never inside it.
  const name = state.shell.name
  const href = hubHref(tournamentId)
  const userOf = new Map(state.teams.map(t => [t.id, t.userId ?? null]))
  const made: MomentRecipient[] = [], wild: MomentRecipient[] = [], out: MomentRecipient[] = []
  results.forEach((r, d) => {
    const division = state.identity.divisions[d].name
    for (const s of r.seeded!) {
      const u = userOf.get(s.id); if (!u) continue
      ;(s.bid === 'wildcard' ? wild : made).push({ userId: u, href, ctx: { tournament: name, division, seedLine: s.seedLine, week: state.calendar.bracketStartWeek } })
    }
    for (const t of r.ranked) {
      if (r.seeded!.some(s => s.id === t.id)) continue
      const u = userOf.get(t.id); if (u) out.push({ userId: u, href, ctx: { tournament: name, division, rank: t.rank } })
    }
  })
  await sendMoment(tournamentId, 'made_the_cut', made)
  await sendMoment(tournamentId, 'wildcard_clinched', wild)
  await sendMoment(tournamentId, 'eliminated', out)
  return { ok: true }
}

/** One week before seeding: everyone in either wildcard pool hears where the line is. */
export async function notifyBubble(userId: string, tournamentId: string) {
  const state = await readDivisionsState(tournamentId)
  if (!state) throw new DivisionsOperationError('Tournament not found.', 404)
  await prisma.$transaction(async tx => {
    await assertCan(tx, tournamentId, userId, 'advance')
    const sent = await tx.tournamentAuditLog.findFirst({ where: { tournamentId, action: 'divisions_bubble_notified' } })
    if (sent) throw new DivisionsOperationError('Bubble alerts were already sent.', 409)
    await audit(tx, tournamentId, userId, 'divisions_bubble_notified', {})
  })
  const recipients: MomentRecipient[] = []
  for (const d of [0, 1] as const) {
    const r = computeDivision(state.teams.filter(t => t.divisionIndex === d), state.settings)
    for (const e of r.pool.entries) {
      const u = state.teams.find(t => t.id === e.id)?.userId
      if (u) recipients.push({ userId: u, href: hubHref(tournamentId), ctx: { tournament: state.shell.name, division: state.identity.divisions[d].name, rank: e.divisionRank, line: r.pool.lineToBeat ?? 0, week: state.calendar.seedingLocksAfter } })
    }
  }
  return sendMoment(tournamentId, 'on_the_bubble', recipients)
}

// ── control: rounds ──────────────────────────────────────────────────────────

async function weekScoresFor(state: NonNullable<DivisionsState>, week: number): Promise<Map<string, WeekScore>> {
  return readWeekScores(state.leagues.map(l => ({ leagueId: l.leagueId, participants: l.participants })), week)
}

/** Preview of the next round from stored scores; the same plan `advanceRound` commits. */
export async function previewRound(state: NonNullable<DivisionsState>) {
  const done = state.committed[0]?.roundsCommitted ?? 0
  const round = done + 1
  const divisionRounds = state.calendar.weeks.length - 1
  const week = state.calendar.weeks[round - 1]
  if (!week || !state.committed[0] || !state.committed[1]) return null
  const scores = await weekScoresFor(state, week.week)
  if (round <= divisionRounds) {
    const plans = state.committed.map(c => planRound(bracketFromSeeds(c!.seeded, c!.scores, c!.overrides), round, scores, c!.overrides))
    return { round, week: week.week, label: week.label, kind: 'division' as const, plans }
  }
  const champs = state.committed.map(c => bracketFromSeeds(c!.seeded, c!.scores, c!.overrides).at(-1)?.[0]?.winner ?? null)
  return { round, week: week.week, label: 'Championship', kind: 'championship' as const, champs, scores }
}

export async function advanceRound(userId: string, tournamentId: string, expectRound: number, overrides: Record<string, string> = {}) {
  const state = await readDivisionsState(tournamentId)
  if (!state) throw new DivisionsOperationError('Tournament not found.', 404)
  const preview = await previewRound(state)
  if (!preview) throw new DivisionsOperationError('Commit seeding before advancing a round.', 409)
  if (preview.round !== expectRound) throw new DivisionsOperationError('That round was already advanced. Reload.', 409)
  const confirmed = await prisma.tournamentAuditLog.findFirst({ where: { tournamentId, action: 'divisions_corrections_closed', data: { path: ['week'], equals: preview.week } } })
  if (!confirmed) throw new DivisionsOperationError('Confirm the stat-correction window has closed for week ' + preview.week + '.', 409)
  const name = state.shell.name
  const href = hubHref(tournamentId)
  const userOf = new Map(state.teams.map(t => [t.id, t.userId ?? null]))

  if (preview.kind === 'division') {
    const scores = await weekScoresFor(state, preview.week)
    const plans = state.committed.map(c => planRound(bracketFromSeeds(c!.seeded, c!.scores, { ...c!.overrides, ...overrides }), preview.round, scores, { ...c!.overrides, ...overrides }))
    const blockers = plans.flatMap(p => p.blockers)
    if (blockers.length) throw new DivisionsOperationError(blockers.join(' '), 409)
    await prisma.$transaction(async tx => {
      await assertCan(tx, tournamentId, userId, 'advance')
      for (const [d, plan] of plans.entries()) {
        const c = state.committed[d]!
        const div = state.shell.divisions[d]!
        const next = { scores: { ...c.scores, ...plan.scores }, overrides: { ...c.overrides, ...Object.fromEntries(Object.entries(overrides).filter(([k]) => plan.needsReview.includes(k) || plan.games.some(g => g.key === k))) }, roundsCommitted: preview.round }
        const w = await tx.tournamentDivision.updateMany({ where: { id: div.id, bracketState: { path: ['roundsCommitted'], equals: preview.round - 1 } }, data: { bracketState: next as unknown as Prisma.InputJsonValue } })
        if (w.count !== 1) throw new DivisionsOperationError('That round was already advanced. Reload.', 409)
        const losers = plan.games.map(g => (g.winner && g.a && g.b ? (g.winner.id === g.a.id ? g.b.id : g.a.id) : null)).filter((x): x is string => Boolean(x))
        await tx.tournamentLeagueParticipant.updateMany({ where: { id: { in: losers } }, data: { advancementStatus: 'eliminated' } })
        const tied = plan.games.filter(g => g.decidedBy && g.decidedBy !== 'score').map(g => ({ game: g.key, by: g.decidedBy, winner: g.winner?.name }))
        await audit(tx, tournamentId, userId, 'divisions_round_advanced', { division: div.name, round: preview.round, week: preview.week, label: preview.label, games: plan.games.length, tied })
      }
    })
    const nextLabel = roundLabel((state.settings.autoBids + state.settings.wildcardSpots) / 2 ** preview.round)
    const isDivisionFinal = preview.round === state.calendar.weeks.length - 1
    const made: MomentRecipient[] = [], out: MomentRecipient[] = []
    plans.forEach((plan, d) => {
      for (const g of plan.games) {
        if (!g.winner || !g.a || !g.b) continue
        const loser = g.winner.id === g.a.id ? g.b : g.a
        const wu = userOf.get(g.winner.id), lu = userOf.get(loser.id)
        const ctx = { tournament: name, division: state.identity.divisions[d].name, round: preview.label, nextRound: isDivisionFinal ? 'Championship' : nextLabel }
        if (wu) made.push({ userId: wu, href, ctx })
        if (lu) out.push({ userId: lu, href, ctx })
      }
    })
    await sendMoment(tournamentId, 'made_the_cut', made)
    await sendMoment(tournamentId, 'eliminated', out)
    return { ok: true, round: preview.round }
  }

  // Championship: Division A champion v Division B champion.
  const [a, b] = preview.champs
  if (!a || !b) throw new DivisionsOperationError('Both division finals must be decided first.', 409)
  const sa = preview.scores.get(a.id), sb = preview.scores.get(b.id)
  if (!sa || !sb) throw new DivisionsOperationError('A championship score is missing.', 409)
  if (!sa.final || !sb.final) throw new DivisionsOperationError('The championship scores are not final yet.', 409)
  const decided = decideGame(a, b, sa.points, sb.points)
  const override = overrides['championship']
  const winner = decided.decidedBy === 'review' ? (override === a.id ? a : override === b.id ? b : null) : decided.winner
  if (!winner) throw new DivisionsOperationError('The championship is tied on everything. Choose the winner.', 409)
  await prisma.$transaction(async tx => {
    await assertCan(tx, tournamentId, userId, 'advance')
    await moveStatus(tx, tournamentId, 'live', 'complete')
    await audit(tx, tournamentId, userId, 'divisions_championship_committed', { score: { a: sa.points, b: sb.points }, override: decided.decidedBy === 'review' ? winner.id : undefined, winner: winner.name, by: decided.decidedBy })
  })
  const loser = winner.id === a.id ? b : a
  const wu = userOf.get(winner.id), lu = userOf.get(loser.id)
  if (wu) await sendMoment(tournamentId, 'champion', [{ userId: wu, href: `/tournament-trophy/${encodeURIComponent(tournamentId)}?entry=${encodeURIComponent(winner.id)}`, ctx: { tournament: name, opponent: loser.name } }])
  if (lu) await sendMoment(tournamentId, 'eliminated', [{ userId: lu, href, ctx: { tournament: name, round: 'Championship' } }])
  return { ok: true, round: preview.round }
}

/** Public trophy page data: the full hub view, with no viewer. */
export async function loadTrophy(tournamentId: string) {
  const state = await readDivisionsState(tournamentId)
  if (!state || !state.committed.every(Boolean)) return null
  return viewFromState(state, null)
}

// ── join + reveal views ──────────────────────────────────────────────────────

export type JoinView = NonNullable<Awaited<ReturnType<typeof loadJoinView>>>

/** The invite landing page. Signed-in viewers only; a personal link's inviter is shown by name. */
export async function loadJoinView(userId: string, tournamentId: string, ref: string | null) {
  const shell = await prisma.tournamentShell.findUnique({ where: { id: tournamentId }, include: { divisions: { orderBy: { divisionNumber: 'asc' } }, conferences: { orderBy: { conferenceNumber: 'asc' } } } })
  if (!shell || shell.format !== DIVISIONS_FORMAT || shell.status === 'blueprint') return null
  const state = await readDivisionsState(tournamentId)
  if (!state) return null
  const me = await prisma.tournamentParticipant.findUnique({ where: { tournamentId_userId: { tournamentId, userId } }, select: { id: true, status: true, queuedAt: true, divisionPreference: true, currentLeagueId: true, revealSeenAt: true } })
  const registered = await prisma.tournamentParticipant.count({ where: { tournamentId, status: 'registered' } })
  const queue = me?.status === 'waitlisted' || shell.status === 'registering' ? await prisma.tournamentParticipant.findMany({ where: { tournamentId, status: 'waitlisted' }, select: { id: true, queuedAt: true } }) : []
  const ordered = queue.map(q => ({ id: q.id, queuedAt: q.queuedAt ?? new Date(0) }))
  const position = me?.status === 'waitlisted' ? ordered.sort((a, b) => a.queuedAt.getTime() - b.queuedAt.getTime() || (a.id < b.id ? -1 : 1)).findIndex(q => q.id === me.id) + 1 : null
  const commissioner = await prisma.appUser.findUnique({ where: { id: shell.commissionerId }, select: { displayName: true, username: true } })
  const leaguesRun = await prisma.league.count({ where: { userId: shell.commissionerId } })
  const inviter = ref ? await prisma.appUser.findFirst({ where: { username: { equals: ref, mode: 'insensitive' } }, select: { displayName: true, username: true } }) : null
  const myLeague = me?.currentLeagueId ? state.leagues.find(l => l.id === me.currentLeagueId) ?? null : null
  const myLeagueIndex = myLeague ? { division: state.shell.divisions.findIndex(d => d.id === myLeague.divisionId) as 0 | 1, conference: state.shell.conferences.findIndex(c => c.id === myLeague.conferenceId) } : null
  return {
    tournamentId, name: shell.name, phase: shell.status, sport: state.settings.sport, settings: state.settings, calendar: state.calendar,
    rules: state.rules, identity: state.identity, registration: state.registration, capacity: shell.maxParticipants, registered, waitlist: queue.length,
    me: me ? { status: me.status, waitlistPosition: position, preference: me.divisionPreference, revealSeen: Boolean(me.revealSeenAt) } : null,
    myLeague: myLeague && myLeagueIndex ? { name: myLeague.name, draftAt: myLeague.draftScheduledAt?.toISOString() ?? null, leagueId: myLeague.leagueId, ...myLeagueIndex } : null,
    commissioner: { name: commissioner?.displayName || commissioner?.username || 'Commissioner', leaguesRun },
    invitedBy: inviter ? inviter.displayName || inviter.username : (commissioner?.displayName || commissioner?.username || null),
  }
}

export type RevealView = NonNullable<Awaited<ReturnType<typeof loadReveal>>>

export async function loadReveal(userId: string, tournamentId: string) {
  const state = await readDivisionsState(tournamentId)
  if (!state || !['placed', 'live', 'complete'].includes(state.shell.status)) return null
  const me = await prisma.tournamentParticipant.findUnique({ where: { tournamentId_userId: { tournamentId, userId } }, select: { id: true, currentLeagueId: true, revealSeenAt: true } })
  const league = me?.currentLeagueId ? state.leagues.find(l => l.id === me.currentLeagueId) : null
  if (!me || !league) return null
  const division = state.shell.divisions.findIndex(d => d.id === league.divisionId) as 0 | 1
  const conference = state.shell.conferences.findIndex(c => c.id === league.conferenceId)
  return {
    tournamentId, tournament: state.shell.name, identity: state.identity, settings: state.settings, division, conference, conferences: state.identity.conferences.length,
    league: { name: league.name, teams: league.participants.length, draftAt: league.draftScheduledAt?.toISOString() ?? null, leagueId: league.leagueId },
    mates: league.participants.map(p => ({ id: p.id, name: p.participant.displayName, isMe: p.userId === userId })).sort((a, b) => Number(b.isMe) - Number(a.isMe)),
    seen: Boolean(me.revealSeenAt),
  }
}
