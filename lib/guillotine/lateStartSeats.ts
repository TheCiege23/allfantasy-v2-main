/**
 * Late-start native guillotine leagues: how many seats the remaining season can eliminate, what the
 * scheduled draft does when the league is not full, and the one safe way to remove unclaimed seats.
 *
 * The math is in `lateStartSeatMath.ts` (pure, client-safe). This file reads Postgres only.
 *
 * Scheduled draft at `LeagueSettings.draftDateUtc` (driven by `startScheduledSurvivorDrafts`):
 *   - every seat the schedule supports is claimed -> start (removing unclaimed seats down to the
 *     supported count first, if that is what makes it full);
 *   - otherwise roll the draft one week (same weekday and ET wall-clock time), shrink the league to
 *     the seat count the NEW date supports, and tell the commissioner once;
 *   - never remove a claimed seat; if more seats are claimed than can be chopped, the claimed count
 *     wins and the commissioner is warned;
 *   - under 4 seats the league cannot start, and rolling only makes it worse, so it waits and the
 *     commissioner is told.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getGuillotineConfig, DEFAULT_END_WEEK_BY_SPORT } from '@/lib/guillotine/GuillotineLeagueConfig'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { countSeatsHeldByPeople } from '@/lib/league/leagueSeats'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import {
  dailySportWeekForInstant,
  resolveDailySportSeasonStart,
  resolveDailySportWeekWindow,
} from '@/lib/season-week/dailySportSeasonStarts'
import { sportHasWeekSignal, toScheduleSportKey } from '@/lib/season-week/sportWeekSignal'
import { normalizeSeasonType } from '@/lib/scores/gameScoreProviders'
import {
  decideGuillotineSeats,
  formatDraftTimeEt,
  GUILLOTINE_MIN_TEAMS,
  guillotineChopWindow,
  rollDraftDateOneWeek,
  type GuillotineChopWindow,
  type GuillotineSeatDecision,
  type GuillotineSeatSummary,
} from './lateStartSeatMath'

/**
 * The fantasy week `at` falls in (0 = before week 1), or null when the app cannot tell.
 *
 * Daily sports (NBA Tue–Mon ET, NHL, MLB, NCAAB, soccer gameweeks) use the same calendar the stat
 * sync and finalizer use. Week-numbered sports (NFL, NCAAF) read the committed schedule: the
 * highest regular-season week that has kicked off by `at`.
 */
export async function guillotineFantasyWeekAt(sport: string, season: number, at: Date): Promise<number | null> {
  const key = toScheduleSportKey(sport)
  if (!sportHasWeekSignal(key)) {
    if (!resolveDailySportSeasonStart(key, season)) return null
    const week = dailySportWeekForInstant(key, season, at)
    if (week != null) return week
    // Before the opener, or inside a soccer international break: the weeks that have fully ended.
    let ended = 0
    for (let w = 1; w <= 60; w++) {
      const window = resolveDailySportWeekWindow(key, season, w)
      if (!window || window.end.getTime() > at.getTime()) break
      ended = w
    }
    return ended
  }
  const rows = await prisma.sportsGame.findMany({
    where: { sport: key, season },
    select: { week: true, seasonType: true, startTime: true },
  })
  const regular = rows.filter((r) => normalizeSeasonType(r.seasonType) === 'regular' && r.week != null && r.startTime)
  if (regular.length === 0) return null
  let week = 0
  for (const r of regular) {
    if (r.startTime!.getTime() <= at.getTime() && (r.week ?? 0) > week) week = r.week ?? 0
  }
  return week
}

export type GuillotineSeatState = {
  leagueId: string
  leagueName: string | null
  commissionerId: string | null
  sport: string
  season: number
  configuredSize: number
  claimed: number
  draftAt: Date | null
  timezone: string
  eliminationStartWeek: number
  eliminationEndWeek: number
  teamsPerChop: number
}

/** Native guillotine leagues only; null for everything else (callers then behave as before). */
export async function loadGuillotineSeatState(leagueId: string): Promise<GuillotineSeatState | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true, name: true, userId: true, sport: true, season: true, leagueSize: true, platform: true,
      guillotineMode: true, leagueVariant: true, survivorMode: true,
    },
  })
  if (!league) return null
  const guillotine = league.guillotineMode === true || league.leagueVariant === 'guillotine'
  if (!guillotine || league.survivorMode === true) return null
  if (resolveWriteAuthority(league.platform) !== 'NATIVE') return null
  const config = await getGuillotineConfig(leagueId)
  if (!config) return null
  const [settings, claimed, rosterCount] = await Promise.all([
    prisma.leagueSettings.findUnique({ where: { leagueId }, select: { draftDateUtc: true, timezone: true } }),
    countSeatsHeldByPeople(prisma as unknown as Prisma.TransactionClient, leagueId),
    league.leagueSize == null ? prisma.roster.count({ where: { leagueId } }) : Promise.resolve(0),
  ])
  const sport = String(league.sport)
  return {
    leagueId,
    leagueName: league.name ?? null,
    commissionerId: league.userId ?? null,
    sport,
    season: Number(league.season),
    configuredSize: league.leagueSize ?? rosterCount,
    claimed,
    draftAt: settings?.draftDateUtc ?? null,
    timezone: settings?.timezone || 'America/New_York',
    eliminationStartWeek: config.eliminationStartWeek,
    eliminationEndWeek: config.eliminationEndWeek ?? DEFAULT_END_WEEK_BY_SPORT[sport as keyof typeof DEFAULT_END_WEEK_BY_SPORT] ?? 18,
    teamsPerChop: config.teamsPerChop,
  }
}

/**
 * Seats if the draft happens at `at`. An unknown week counts as before week 1 — the configured first
 * chop week then bounds the count, which is the rule as it stood before late starts existed.
 */
export async function guillotineSeatsAt(
  state: GuillotineSeatState,
  at: Date,
  configuredSize = state.configuredSize,
): Promise<{ window: GuillotineChopWindow; decision: GuillotineSeatDecision; weekKnown: boolean }> {
  const week = await guillotineFantasyWeekAt(state.sport, state.season, at)
  const window = guillotineChopWindow({
    eliminationStartWeek: state.eliminationStartWeek,
    eliminationEndWeek: state.eliminationEndWeek,
    teamsPerChop: state.teamsPerChop,
    draftWeek: week ?? 0,
  })
  const decision = decideGuillotineSeats({ configuredSize, claimed: state.claimed, maxTeams: window.maxTeams })
  return { window, decision, weekKnown: week != null }
}

/** For the league page and the invite page. Null for every league that is not native guillotine. */
export async function resolveGuillotineSeatSummary(leagueId: string, now: Date = new Date()): Promise<GuillotineSeatSummary | null> {
  const state = await loadGuillotineSeatState(leagueId)
  if (!state) return null
  const draftAt = state.draftAt && state.draftAt.getTime() > now.getTime() ? state.draftAt : null
  const here = await guillotineSeatsAt(state, draftAt ?? now)
  let ifNotFull: GuillotineSeatSummary['ifNotFull'] = null
  if (draftAt && state.claimed < here.decision.seats) {
    const next = rollDraftDateOneWeek(draftAt, state.timezone)
    const then = await guillotineSeatsAt(state, next, here.decision.seats)
    ifNotFull = { draftAt: next.toISOString(), seats: then.decision.seats }
  }
  return {
    claimed: state.claimed,
    seats: here.decision.seats,
    draftAt: draftAt?.toISOString() ?? null,
    ifNotFull,
    belowFloor: here.decision.belowFloor,
    claimedExceedsSupported: here.decision.claimedExceedsSupported,
  }
}

/** The seat count the commissioner join alert should report: the seats the schedule supports. */
export async function resolveGuillotineEffectiveSeats(leagueId: string, now: Date = new Date()): Promise<number | null> {
  return (await resolveGuillotineSeatSummary(leagueId, now))?.seats ?? null
}

export type GuillotineScheduledPlan =
  | { action: 'start'; seats: number; claimed: number; shrinkTo: number | null; claimedExceedsSupported: boolean; supportedSeats: number }
  | { action: 'roll'; from: Date; to: Date; seats: number; claimed: number; previousSeats: number }
  | { action: 'blocked_floor'; seats: number; claimed: number }

/** What the scheduled draft should do for this league at its due time. Pure given the state. */
export async function planGuillotineScheduledDraft(state: GuillotineSeatState): Promise<GuillotineScheduledPlan | null> {
  if (!state.draftAt) return null
  const { decision } = await guillotineSeatsAt(state, state.draftAt)
  if (decision.belowFloor) return { action: 'blocked_floor', seats: decision.seats, claimed: state.claimed }
  if (state.claimed >= decision.seats) {
    return {
      action: 'start',
      seats: decision.seats,
      claimed: state.claimed,
      shrinkTo: decision.seats < state.configuredSize ? decision.seats : null,
      claimedExceedsSupported: decision.claimedExceedsSupported,
      supportedSeats: decision.supportedSeats,
    }
  }
  const to = rollDraftDateOneWeek(state.draftAt, state.timezone)
  const next = await guillotineSeatsAt(state, to, decision.seats)
  if (next.decision.belowFloor) return { action: 'blocked_floor', seats: decision.seats, claimed: state.claimed }
  return { action: 'roll', from: state.draftAt, to, seats: next.decision.seats, claimed: state.claimed, previousSeats: state.configuredSize }
}

export type RemoveSeatsResult =
  | { ok: true; removed: string[]; leagueSize: number }
  | { ok: false; reason: 'not_pre_draft' | 'draft_has_picks' | 'would_drop_claimed' }

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/**
 * Shrink a native league to `target` seats by deleting UNCLAIMED seats, highest seat number first.
 *
 * Pre-draft only: the current draft session must be `pre_draft` with zero picks. A seat is unclaimed
 * when its roster's owner is not a person (`open-slot-*` / `orphan-*`) AND its team row has no
 * `claimedByUserId`. Never removes a claimed seat: when fewer unclaimed seats exist than needed, it
 * refuses rather than shrinking part way.
 *
 * Keeps every seat record in step (see `lib/league/leagueSeats.ts`): Roster, LeagueTeam,
 * LeagueEntrySlot (renumbered so the seats stay 1..N), RedraftLeagueMember.teamNumber,
 * DraftSession.slotOrder/teamCount, LeagueSettings.draftOrderSlots and League.leagueSize — the last
 * being what the join route and both invite previews check capacity against.
 */
export async function removeUnclaimedGuillotineSeats(
  tx: Prisma.TransactionClient,
  leagueId: string,
  target: number,
): Promise<RemoveSeatsResult> {
  const session = await tx.draftSession.findFirst({
    where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { id: true, status: true, slotOrder: true },
  })
  if (session && session.status !== 'pre_draft') return { ok: false, reason: 'not_pre_draft' }
  if (session && (await tx.draftPick.count({ where: { sessionId: session.id } })) > 0) {
    return { ok: false, reason: 'draft_has_picks' }
  }

  const [rosters, teams, slots] = await Promise.all([
    tx.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } }),
    tx.leagueTeam.findMany({ where: { leagueId }, select: { id: true, externalId: true, claimedByUserId: true } }),
    tx.leagueEntrySlot.findMany({ where: { leagueId }, select: { id: true, slotNumber: true, rosterId: true } }),
  ])
  const ownerIds = [...new Set(rosters.map((r) => r.platformUserId).filter(Boolean))]
  const people = new Set(
    ownerIds.length ? (await tx.appUser.findMany({ where: { id: { in: ownerIds } }, select: { id: true } })).map((u) => u.id) : [],
  )
  const teamByRoster = new Map(teams.map((t) => [t.externalId, t]))
  const slotByRoster = new Map(slots.filter((s) => s.rosterId).map((s) => [s.rosterId as string, s]))

  const excess = rosters.length - target
  if (excess <= 0) {
    await tx.league.update({ where: { id: leagueId }, data: { leagueSize: Math.max(target, rosters.length) } })
    return { ok: true, removed: [], leagueSize: Math.max(target, rosters.length) }
  }
  const unclaimed = rosters
    .filter((r) => !people.has(r.platformUserId) && !teamByRoster.get(r.id)?.claimedByUserId)
    .sort((a, b) => (slotByRoster.get(b.id)?.slotNumber ?? Infinity) - (slotByRoster.get(a.id)?.slotNumber ?? Infinity))
  if (unclaimed.length < excess) return { ok: false, reason: 'would_drop_claimed' }

  const remove = unclaimed.slice(0, excess)
  const removeIds = new Set(remove.map((r) => r.id))
  const removeOwners = new Set(remove.map((r) => r.platformUserId))
  const ids = [...removeIds]

  await tx.leagueTeam.deleteMany({ where: { leagueId, externalId: { in: ids } } })
  await tx.leagueEntrySlot.deleteMany({ where: { leagueId, rosterId: { in: ids } } })
  await tx.roster.deleteMany({ where: { leagueId, id: { in: ids } } })

  // Keep seat numbers 1..N: a kept seat numbered above N takes a number a removed seat freed.
  const kept = slots.filter((s) => !s.rosterId || !removeIds.has(s.rosterId))
  const used = new Set(kept.map((s) => s.slotNumber))
  const free: number[] = []
  for (let n = 1; n <= target; n++) if (!used.has(n)) free.push(n)
  for (const s of kept.filter((k) => k.slotNumber > target).sort((a, b) => a.slotNumber - b.slotNumber)) {
    const next = free.shift()
    if (next == null) break
    await tx.leagueEntrySlot.update({ where: { id: s.id }, data: { slotNumber: next } })
    await tx.redraftLeagueMember.updateMany({ where: { leagueId, teamNumber: s.slotNumber }, data: { teamNumber: next } })
  }

  if (session) {
    const order = Array.isArray(session.slotOrder) ? session.slotOrder : []
    const nextOrder = order
      .filter((e) => !removeIds.has(String(asRecord(e).rosterId ?? '')))
      .map((e, i) => ({ ...asRecord(e), slot: i + 1 }))
    await tx.draftSession.update({
      where: { id: session.id },
      data: { teamCount: target, slotOrder: nextOrder as Prisma.InputJsonValue },
    })
  }

  const ls = await tx.leagueSettings.findUnique({ where: { leagueId }, select: { draftOrderSlots: true } })
  if (ls && Array.isArray(ls.draftOrderSlots)) {
    const nextSlots = (ls.draftOrderSlots as unknown[])
      .filter((e) => {
        const owner = String(asRecord(e).ownerId ?? '')
        return !removeIds.has(owner) && !removeOwners.has(owner)
      })
      .map((e, i) => ({ ...asRecord(e), slot: i + 1 }))
    await tx.leagueSettings.update({ where: { leagueId }, data: { draftOrderSlots: nextSlots as Prisma.InputJsonValue } })
  }

  await tx.league.update({ where: { id: leagueId }, data: { leagueSize: target } })
  return { ok: true, removed: ids, leagueSize: target }
}

async function notifyCommissionerOnce(
  state: GuillotineSeatState,
  args: { type: string; dedupeKey: string; title: string; body: string; severity: 'low' | 'medium' | 'high' },
): Promise<boolean> {
  if (!state.commissionerId) return false
  const sourceKey = `${args.dedupeKey}:${state.commissionerId}`
  const prior = await prisma.platformNotification.findUnique({ where: { sourceKey }, select: { id: true } }).catch(() => null)
  if (prior) return false
  const { dispatchNotification } = await import('@/lib/notifications/NotificationDispatcher')
  await dispatchNotification({
    userIds: [state.commissionerId],
    category: 'commissioner_alerts',
    type: args.type,
    title: args.title,
    body: args.body,
    actionHref: `/league/${state.leagueId}`,
    actionLabel: 'Open league',
    leagueId: state.leagueId,
    severity: args.severity,
    dedupePrefix: args.dedupeKey,
  })
  return true
}

export type GuillotineHoldOutcome = 'rolled' | 'blocked' | 'raced'

/**
 * The scheduled draft is not full: roll it a week and shrink to the seats the new date supports, or
 * — when no later date can reach the floor of 4 — leave it where it is and say why. Run inside the
 * draft control lock. The roll is a conditional write on the date we read, so two ticks (or two
 * worker replicas) roll it once and notify once.
 */
export async function holdGuillotineScheduledDraft(
  state: GuillotineSeatState,
  plan: Extract<GuillotineScheduledPlan, { action: 'roll' | 'blocked_floor' }>,
): Promise<GuillotineHoldOutcome> {
  const leagueName = state.leagueName?.trim() || 'your Guilly league'
  if (plan.action === 'blocked_floor') {
    await notifyCommissionerOnce(state, {
      type: 'guillotine_draft_below_floor',
      dedupeKey: `guillotine_draft_below_floor:${state.leagueId}:${state.draftAt?.toISOString() ?? 'none'}`,
      title: `${leagueName} cannot start yet`,
      body: `${state.claimed}/${plan.seats} spots filled. A Guilly league needs at least ${GUILLOTINE_MIN_TEAMS} teams that can still be chopped before the last chop week, so the draft is on hold. Fill the open spots and it starts on the next check.`,
      severity: 'high',
    })
    return 'blocked'
  }

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const moved = await tx.leagueSettings.updateMany({
      where: { leagueId: state.leagueId, draftDateUtc: plan.from },
      data: { draftDateUtc: plan.to },
    })
    if (moved.count !== 1) return null
    if (plan.seats >= state.configuredSize) return { leagueSize: state.configuredSize }
    const removed = await removeUnclaimedGuillotineSeats(tx, state.leagueId, plan.seats)
    if (!removed.ok) {
      console.warn('[guillotine-late-start] seats not reduced on roll', JSON.stringify({ leagueId: state.leagueId, reason: removed.reason }))
      return { leagueSize: state.configuredSize }
    }
    return { leagueSize: removed.leagueSize }
  })
  if (!result) return 'raced'

  const seatsNote = result.leagueSize < state.configuredSize ? ` Seats now ${result.leagueSize}.` : ''
  await notifyCommissionerOnce(state, {
    type: 'guillotine_draft_rolled',
    dedupeKey: `guillotine_draft_rolled:${state.leagueId}:${plan.to.toISOString()}`,
    title: `${leagueName}: draft moved a week`,
    body: `Draft moved to ${formatDraftTimeEt(plan.to)}: ${state.claimed}/${state.configuredSize} filled.${seatsNote}`,
    severity: 'medium',
  }).catch((err) => {
    console.warn('[guillotine-late-start] roll alert failed', { leagueId: state.leagueId, error: err instanceof Error ? err.message : String(err) })
  })
  return 'rolled'
}

/**
 * The league is full at its supported seat count: drop the unclaimed seats above it so the draft
 * starts with no empty seat. Run inside the draft control lock, immediately before the start.
 */
export async function prepareGuillotineSeatsForStart(
  state: GuillotineSeatState,
  plan: Extract<GuillotineScheduledPlan, { action: 'start' }>,
): Promise<RemoveSeatsResult | null> {
  let result: RemoveSeatsResult | null = null
  if (plan.shrinkTo != null) {
    const target = plan.shrinkTo
    result = await prisma.$transaction((tx: Prisma.TransactionClient) => removeUnclaimedGuillotineSeats(tx, state.leagueId, target))
    if (!result.ok) return result
  }
  if (plan.claimedExceedsSupported) {
    await notifyCommissionerOnce(state, {
      type: 'guillotine_claimed_exceeds_chops',
      dedupeKey: `guillotine_claimed_exceeds_chops:${state.leagueId}`,
      title: `${state.leagueName?.trim() || 'Your Guilly league'} has more teams than chops left`,
      body: `${plan.claimed} teams are claimed but only ${plan.supportedSeats} can be played down to one by the last chop week. Every claimed team stays; the season will end with more than one team standing unless the chop settings change.`,
      severity: 'high',
    }).catch(() => false)
  }
  return result
}
