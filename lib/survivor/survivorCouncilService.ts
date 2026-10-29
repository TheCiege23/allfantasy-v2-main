import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizeSurvivorFoundationSettings, type SurvivorFoundationSettings } from './normalizeSurvivorSettings'
import {
  computeCouncilEligibility,
  type CouncilEligibility,
  type CouncilScopePlayer,
} from './survivorBallotEligibility'
import { getCouncilImmuneUserIds } from './survivorTribeImmunity'

/**
 * SURVIVOR COUNCIL + VOTE WINDOW SERVICE (canonical Phase 3).
 *
 * Opens a Elimination Council for the losing tribe (pre-merge) or all active players (post-merge),
 * manages the vote window lifecycle (scheduled → open → closed → revealed / cancelled), and
 * exposes the shared council context (scope, parsed idol plays, eligibility) used by the vote,
 * idol-resolution, tally, and state-sanitizer layers. Named to avoid the Windows case-insensitive
 * collision with the legacy `SurvivorTribalCouncilService.ts`.
 */

type CouncilDatabase = Pick<typeof prisma, 'league' | 'survivorPlayer' | 'survivorTribalCouncil' | 'survivorGameState'>

export type CouncilStatus = 'scheduled' | 'voting_open' | 'closed' | 'revealed' | 'cancelled' | 'tie_pending'

export interface IdolPlayRecord {
  idolId: string
  powerType: 'vote_shield' | 'extra_vote' | 'skip_tribal' | 'vote_steal'
  playerUserId: string
  playerRosterId: string
  /** vote_shield: protected roster (self). */
  protectedRosterId?: string
  /** extra_vote: the extra ballot target. */
  extraTargetUserId?: string
  extraTargetRosterId?: string
  /** vote_steal: this eligible manager's ballot is stamped Taken at the read. */
  stolenVoterUserId?: string
  stolenVoterRosterId?: string
  /** skip_tribal: whether the holder also forfeits their own vote. */
  forfeitsVote?: boolean
  playedAt: string
}

export interface CouncilContext {
  council: {
    id: string
    leagueId: string
    week: number
    /** Order within the week: a double-elimination week and each revote add one. */
    councilNumber: number
    phase: string
    status: string
    attendingTribeId: string | null
    votingOpensAt: Date | null
    votingDeadline: Date | null
    voteDeadlineAt: Date
    closedAt: Date | null
    isRevealed: boolean
    doesNotCountVoteIds: string[]
    idolsPlayed: IdolPlayRecord[]
    tiePlayerIds: string[]
  }
  settings: SurvivorFoundationSettings
  scopePlayers: CouncilScopePlayer[]
  eligibility: CouncilEligibility
  /** rosterId → userId for the scope (tally helper). */
  rosterToUser: Record<string, string>
  /** userId → rosterId for the scope. */
  userToRoster: Record<string, string>
  /** Publicly immune managers at this council (weekly necklace / challenge-won immunity). Never idol effects. */
  immuneUserIds?: string[]
}

function parseIdolPlays(raw: Prisma.JsonValue | null | undefined): IdolPlayRecord[] {
  if (!Array.isArray(raw)) return []
  const out: IdolPlayRecord[] = []
  for (const item of raw) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const r = item as Record<string, unknown>
      if (typeof r.idolId === 'string' && typeof r.powerType === 'string' && typeof r.playerUserId === 'string') {
        out.push(r as unknown as IdolPlayRecord)
      }
    }
  }
  return out
}

async function ensureConfigId(leagueId: string): Promise<string> {
  const existing = await prisma.survivorLeagueConfig.findUnique({ where: { leagueId }, select: { id: true } })
  if (existing) return existing.id
  const created = await prisma.survivorLeagueConfig.create({
    data: { leagueId, tribeCount: 4, tribeSize: 5, tribeFormation: 'random' },
    select: { id: true },
  })
  return created.id
}

async function loadSettings(leagueId: string, db: CouncilDatabase = prisma): Promise<SurvivorFoundationSettings> {
  const league = await db.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  return normalizeSurvivorFoundationSettings(
    league?.settings && typeof league.settings === 'object' ? (league.settings as Record<string, unknown>) : {},
  )
}

type ScopeLoad = { scopePlayers: CouncilScopePlayer[]; challengeImmuneUserIds: string[] }

/**
 * Active players in a council's scope: attending tribe (pre-merge) or all active (merge), plus the
 * managers among them holding immunity from a challenge win. The weekly necklace is read from its
 * own table for the council's week (getCouncilImmuneUserIds); every other immunity source is the
 * flag on the player, set by SurvivorEffectEngine when a challenge pays out and cleared at the
 * week flip.
 */
async function loadScopePlayers(leagueId: string, phase: string, attendingTribeId: string | null, db: CouncilDatabase = prisma): Promise<ScopeLoad> {
  // A surprise two-tribe week after the merge scopes the council to its attending tribe too.
  const where: Prisma.SurvivorPlayerWhereInput =
    (phase === 'pre_merge' || phase === 'revote' || phase === 'surprise') && attendingTribeId
      ? { leagueId, playerState: 'active', tribeId: attendingTribeId }
      : { leagueId, playerState: 'active' }
  const players = await db.survivorPlayer.findMany({
    where,
    select: { userId: true, displayName: true, redraftRosterId: true, tribeId: true, hasImmunityThisWeek: true, immunitySource: true },
    orderBy: { displayName: 'asc' },
  })
  const rows = players as Array<{ userId: string; displayName: string; redraftRosterId: string | null; tribeId: string | null; hasImmunityThisWeek?: boolean | null; immunitySource?: string | null }>
  return {
    scopePlayers: rows.map((p) => ({
      userId: p.userId,
      tribeId: p.tribeId,
      rosterId: p.redraftRosterId ?? p.userId,
      displayName: p.displayName,
    })),
    challengeImmuneUserIds: rows.filter((p) => p.hasImmunityThisWeek === true && p.immunitySource !== 'tribe_top_score').map((p) => p.userId),
  }
}

/** Build the eligibility view for a council given its idol plays + settings. */
export function buildCouncilContextParts(
  scopePlayers: CouncilScopePlayer[],
  idolsPlayed: IdolPlayRecord[],
  settings: SurvivorFoundationSettings,
  immuneUserId?: string | ReadonlyArray<string> | null,
): { eligibility: CouncilEligibility; rosterToUser: Record<string, string>; userToRoster: Record<string, string> } {
  const skipTribal = idolsPlayed.filter((p) => p.powerType === 'skip_tribal')
  const immune = typeof immuneUserId === 'string' ? [immuneUserId] : [...(immuneUserId ?? [])]
  const safeUserIds = [...skipTribal.map((p) => p.playerUserId), ...immune]
  const voteForfeitUserIds = skipTribal.filter((p) => p.forfeitsVote).map((p) => p.playerUserId)
  const eligibility = computeCouncilEligibility({
    scopePlayers,
    selfVotesAllowed: settings.selfVotesAllowed,
    safeUserIds,
    voteForfeitUserIds,
  })
  const rosterToUser: Record<string, string> = {}
  const userToRoster: Record<string, string> = {}
  for (const p of scopePlayers) {
    rosterToUser[p.rosterId] = p.userId
    userToRoster[p.userId] = p.rosterId
  }
  return { eligibility, rosterToUser, userToRoster }
}

/** A revote is limited to non-tied voters and the tied targets, regardless of self-vote settings. */
export function restrictCouncilToRevote(eligibility: CouncilEligibility, tiedUserIds: readonly string[]): CouncilEligibility {
  const tied = new Set(tiedUserIds)
  const voterUserIds = eligibility.voterUserIds.filter(userId => !tied.has(userId))
  const targetUserIds = eligibility.targetUserIds.filter(userId => tied.has(userId))
  return { voterUserIds, targetUserIds, targetsByVoter: Object.fromEntries(voterUserIds.map(userId => [userId, targetUserIds])) }
}

/** The current council that is not yet finalized (revealed/cancelled). */
export async function getActiveCouncil(leagueId: string, db: CouncilDatabase = prisma) {
  return db.survivorTribalCouncil.findFirst({
    where: { leagueId, isRevealed: false, status: { in: ['scheduled', 'voting_open', 'closed', 'tie_pending'] } },
    orderBy: [{ week: 'desc' }, { councilNumber: 'desc' }, { createdAt: 'desc' }],
  })
}

/** The most recent council regardless of status (used by post-reveal admin actions). */
export async function getLatestCouncil(leagueId: string) {
  return prisma.survivorTribalCouncil.findFirst({
    where: { leagueId },
    orderBy: [{ week: 'desc' }, { councilNumber: 'desc' }, { createdAt: 'desc' }],
  })
}

/** Load full shared context for a council id (or the active council if id omitted). */
export async function loadCouncilContext(leagueId: string, councilId?: string, db: CouncilDatabase = prisma): Promise<CouncilContext | null> {
  const council = councilId
    ? await db.survivorTribalCouncil.findFirst({ where: { id: councilId, leagueId } })
    : await getActiveCouncil(leagueId, db)
  if (!council) return null
  const settings = await loadSettings(leagueId, db)
  const idolsPlayed = parseIdolPlays(council.idolsPlayed)
  const { scopePlayers, challengeImmuneUserIds } = await loadScopePlayers(leagueId, council.phase, council.attendingTribeId, db)
  const game = await db.survivorGameState.findUnique({ where: { leagueId }, select: { immunePlayerId: true } })
  const scopeIds = new Set(scopePlayers.map((p) => p.userId))
  const necklaces = await getCouncilImmuneUserIds(leagueId, council.week, council.phase === 'merge' ? null : council.attendingTribeId)
  const immuneUserIds = [...new Set([...(game?.immunePlayerId ? [game.immunePlayerId] : []), ...necklaces, ...challengeImmuneUserIds])].filter((id) => scopeIds.has(id))
  const parts = buildCouncilContextParts(scopePlayers, idolsPlayed, settings, immuneUserIds)
  const { rosterToUser, userToRoster } = parts
  const eligibility = council.phase === 'revote' ? restrictCouncilToRevote(parts.eligibility, council.tiePlayerIds) : parts.eligibility
  return {
    council: {
      id: council.id,
      leagueId,
      week: council.week,
      councilNumber: council.councilNumber,
      phase: council.phase,
      status: council.status,
      attendingTribeId: council.attendingTribeId,
      votingOpensAt: council.votingOpensAt,
      votingDeadline: council.votingDeadline,
      voteDeadlineAt: council.voteDeadlineAt,
      closedAt: council.closedAt,
      isRevealed: council.isRevealed,
      doesNotCountVoteIds: council.doesNotCountVoteIds ?? [],
      idolsPlayed,
      tiePlayerIds: council.tiePlayerIds,
    },
    settings,
    scopePlayers,
    eligibility,
    rosterToUser,
    userToRoster,
    immuneUserIds,
  }
}

export type OpenTribalOutcome =
  | { ok: true; created: boolean; councilId: string; status: CouncilStatus; phase: string; week: number; voterCount: number }
  | { ok: false; status: 400 | 409 | 422; code: string; error: string }

export interface OpenTribalOptions {
  attendingTribeId?: string | null
  week?: number
  votingOpensAt?: Date | null
  voteDeadlineAt?: Date | null
  actorUserId?: string
  /**
   * `surprise`: a post-merge two-tribe week (survivorSurpriseTribes.ts). The council keeps the
   * attending-tribe scope of a pre-merge council while the season stays merged.
   */
  scope?: 'surprise'
}

/**
 * Open a Elimination Council. Pre-merge requires `attendingTribeId` (the losing tribe — there is no
 * challenge engine yet, so the commissioner/host designates it). Post-merge attends all active
 * players. Idempotent: an existing non-finalized council is returned unchanged.
 */
export async function openTribalCouncil(leagueId: string, opts: OpenTribalOptions = {}): Promise<OpenTribalOutcome> {
  const existing = await getActiveCouncil(leagueId)
  if (existing) {
    const ctx = await loadCouncilContext(leagueId, existing.id)
    return {
      ok: true,
      created: false,
      councilId: existing.id,
      status: existing.status as CouncilStatus,
      phase: existing.phase,
      week: existing.week,
      voterCount: ctx?.eligibility.voterUserIds.length ?? 0,
    }
  }

  const settings = await loadSettings(leagueId)
  const gameState = await prisma.survivorGameState.findUnique({ where: { leagueId } })
  const activePlayerCount =
    gameState?.activePlayerCount ?? (await prisma.survivorPlayer.count({ where: { leagueId, playerState: 'active' } }))
  const mergedPhase = gameState?.phase === 'merge' || gameState?.phase === 'post_merge' || Boolean(gameState?.mergeTriggeredAt)
  const atOrBelowMerge = activePlayerCount <= settings.mergeActivePlayerCount
  const phase = opts.scope === 'surprise' ? 'surprise' : mergedPhase || atOrBelowMerge ? 'merge' : 'pre_merge'

  if ((phase === 'pre_merge' || phase === 'surprise') && !opts.attendingTribeId) {
    return { ok: false, status: 422, code: 'attending_tribe_required', error: 'Pre-merge Elimination Council requires the attending (losing) tribe.' }
  }
  if (opts.attendingTribeId) {
    const tribe = await prisma.survivorTribe.findFirst({ where: { id: opts.attendingTribeId, leagueId }, select: { id: true } })
    if (!tribe) return { ok: false, status: 400, code: 'unknown_tribe', error: 'Attending tribe not found in this league.' }
  }

  const { scopePlayers, challengeImmuneUserIds } = await loadScopePlayers(leagueId, phase, opts.attendingTribeId ?? null)
  if (scopePlayers.length < 2) {
    return { ok: false, status: 422, code: 'insufficient_players', error: 'Need at least two active players to open a council.' }
  }

  const week = Number.isFinite(opts.week) ? Number(opts.week) : gameState?.currentWeek ?? 1
  const configId = await ensureConfigId(leagueId)
  const now = new Date()
  const opensAt = opts.votingOpensAt ?? now
  const deadline =
    opts.voteDeadlineAt ?? new Date(opensAt.getTime() + Math.max(1, settings.voteCloseOffset) * 60 * 60 * 1000)
  const status: CouncilStatus = opensAt.getTime() <= now.getTime() ? 'voting_open' : 'scheduled'

  // The next free number for the week. A count would collide once a revote (which takes a number
  // of its own) sits between two councils of a double-elimination week.
  const councilNumber =
    ((await prisma.survivorTribalCouncil.aggregate({ where: { leagueId, configId, week }, _max: { councilNumber: true } }))._max.councilNumber ?? 0) + 1

  const necklaces = await getCouncilImmuneUserIds(leagueId, week, phase === 'merge' ? null : opts.attendingTribeId ?? null)
  const { eligibility } = buildCouncilContextParts(scopePlayers, [], settings, [...(gameState?.immunePlayerId ? [gameState.immunePlayerId] : []), ...necklaces, ...challengeImmuneUserIds])

  const council = await prisma.survivorTribalCouncil.create({
    data: {
      leagueId,
      configId,
      week,
      councilNumber,
      phase,
      attendingTribeId: opts.attendingTribeId ?? null,
      status,
      votingOpensAt: opensAt,
      votingDeadline: deadline,
      voteDeadlineAt: deadline,
      isRevealed: false,
      auditLog: { openedBy: opts.actorUserId ?? null, openedAt: now.toISOString(), scope: phase, eligibleVoters: eligibility.voterUserIds.length },
    },
    select: { id: true },
  })

  await prisma.survivorGameState.upsert({
    where: { leagueId },
    create: {
      leagueId,
      phase,
      currentWeek: week,
      activeCouncilId: council.id,
      tribalOpenedAt: now,
      tribalDeadline: deadline,
      needsTribalLock: true,
      activePlayerCount,
      totalTribalCouncils: 1,
    },
    update: {
      activeCouncilId: council.id,
      tribalOpenedAt: now,
      tribalDeadline: deadline,
      needsTribalLock: true,
      totalTribalCouncils: { increment: 1 },
    },
  })

  await prisma.survivorAuditEntry.create({
    data: {
      leagueId,
      week,
      category: 'tribal',
      action: 'council_opened',
      actorUserId: opts.actorUserId ?? null,
      relatedEntityId: council.id,
      relatedEntityType: 'council',
      data: { phase, attendingTribeId: opts.attendingTribeId ?? null, eligibleVoters: eligibility.voterUserIds.length, deadline: deadline.toISOString() },
      isVisibleToCommissioner: true,
      isVisibleToPublic: true,
    },
  })

  return { ok: true, created: true, councilId: council.id, status, phase, week, voterCount: eligibility.voterUserIds.length }
}

export type CloseWindowOutcome =
  | { ok: true; councilId: string; status: CouncilStatus; lateVotesFlagged: number }
  | { ok: false; status: 400 | 404 | 409; code: string; error: string }

/** Close the vote window: lock the council, flag any post-deadline ballots per the late policy. */
export async function closeVoteWindow(leagueId: string, councilId: string, actorUserId?: string): Promise<CloseWindowOutcome> {
  return prisma.$transaction(async (tx): Promise<CloseWindowOutcome> => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-setup:${leagueId}`}, 0))::text`
    const game = await tx.survivorGameState.findUnique({ where: { leagueId }, select: { pausedSnapshot: true } })
    if (game?.pausedSnapshot != null) return { ok: false, status: 409, code: 'league_paused', error: 'The league is paused.' }
    const council = await tx.survivorTribalCouncil.findFirst({ where: { id: councilId, leagueId } })
    if (!council) return { ok: false, status: 404, code: 'not_found', error: 'Council not found.' }
    if (council.isRevealed) return { ok: false, status: 409, code: 'already_revealed', error: 'Council already revealed.' }
    if (council.status === 'closed' || council.status === 'tie_pending') {
      const late = await tx.survivorVote.count({ where: { councilId, isLateVote: true } })
      return { ok: true, councilId, status: 'closed', lateVotesFlagged: late }
    }

    const settings = await loadSettings(leagueId, tx)
    if (!['voting_open', 'voting_closed'].includes(council.status)) return { ok: false, status: 409, code: 'not_open', error: 'Voting is not open.' }
    const now = new Date()
    const closedEarly = now < council.voteDeadlineAt
    const deadline = new Date(Math.min(now.getTime(), council.voteDeadlineAt.getTime()))
    const lateVotes = await tx.survivorVote.findMany({
      where: { councilId, submittedAt: { gt: deadline } },
      select: { id: true },
    })
    const lateIds = (lateVotes as Array<{ id: string }>).map((v) => v.id)
    if (lateIds.length) {
      await tx.survivorVote.updateMany({
        where: { id: { in: lateIds } },
        data: { isLateVote: true, doesNotCount: !settings.lateVotesAllowed },
      })
    }

    await tx.survivorTribalCouncil.update({ where: { id: councilId }, data: { status: 'closed', closedAt: now, voteDeadlineAt: deadline, votingDeadline: deadline } })
    await tx.survivorAuditEntry.create({
      data: {
        leagueId,
        week: council.week,
        category: 'tribal',
        action: 'council_closed',
        actorUserId: actorUserId ?? null,
        relatedEntityId: councilId,
        relatedEntityType: 'council',
        data: { closedEarly, lateVotesFlagged: lateIds.length, lateVotesAllowed: settings.lateVotesAllowed },
        isVisibleToCommissioner: true,
        isVisibleToPublic: true,
      },
    })
    return { ok: true, councilId, status: 'closed', lateVotesFlagged: lateIds.length }
  })
}

/** Cancel a council (commissioner/host). Voids the window; no elimination occurs. */
export async function cancelCouncil(leagueId: string, councilId: string, actorUserId?: string): Promise<{ ok: boolean }> {
  const council = await prisma.survivorTribalCouncil.findFirst({ where: { id: councilId, leagueId }, select: { id: true, isRevealed: true, week: true } })
  if (!council || council.isRevealed) return { ok: false }
  await prisma.survivorTribalCouncil.update({ where: { id: councilId }, data: { status: 'cancelled', closedAt: new Date() } })
  await prisma.survivorGameState.updateMany({ where: { leagueId, activeCouncilId: councilId }, data: { activeCouncilId: null, needsTribalLock: false } })
  await prisma.survivorAuditEntry.create({
    data: { leagueId, week: council.week, category: 'tribal', action: 'council_cancelled', actorUserId: actorUserId ?? null, relatedEntityId: councilId, relatedEntityType: 'council', data: {}, isVisibleToCommissioner: true, isVisibleToPublic: true },
  })
  return { ok: true }
}
