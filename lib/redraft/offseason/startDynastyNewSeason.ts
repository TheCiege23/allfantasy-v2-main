/**
 * Start a dynasty league's next season.
 *
 * 🛑 YEAR TWO HAD EXACTLY ONE WAY TO BEGIN, AND IT WAS EASY TO MISS. The season `triggerKeeperOffseason`
 * creates is a `setup` shell, and the only writer that ever moved it to `active` was the rookie
 * draft completing (`syncCompletedDraftToRedraftSeason`). A league that never created its rookie
 * draft, or chose not to hold one, sat in `setup` forever — and the week roller, which runs over
 * running seasons only (`engineSeasonScope`), never scored a single week of it. Nothing said so.
 *
 * So there are now three ways in, and they share one activation:
 *
 *   rookie draft completes  → unchanged: `syncCompletedDraftToRedraftSeason` activates.
 *   commissioner            → `startDynastyNewSeason` (POST /api/leagues/[id]/season/start-new).
 *                             Activates through the draft path when the rookie draft is done, or
 *                             directly when the commissioner explicitly skips it.
 *   the sport's week 1      → `activateDynastyNewSeasonsAtKickoff`, from the week roller.
 *
 * 🛑 NONE OF THEM ACTIVATES WHILE A DRAFT IS OPEN. A rookie draft that exists but is not finished
 * (`pre_draft` through `paused`) would otherwise have its picks land on a season already being
 * scored. That draft must be run or removed first.
 *
 * ⚠ ONLY A SEASON THAT FOLLOWS A COMPLETED ONE. A dynasty league's FIRST season is built by its
 * startup draft; nothing here may start a season that has no carried rosters to play with.
 *
 * Every step is idempotent: the shell and carryover are (see their headers), activation is guarded
 * on `status = 'setup'`, and housekeeping re-runs to the same result.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { seasonSetupBlocked } from '@/lib/tournament/seasonNativeContract'
import { OPEN_DRAFT_SESSION_STATUSES, CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { ensureNextRedraftSeasonShell } from './ensureNextRedraftSeasonShell'
import { carryDynastyRostersForward, isDynastyFamilyLeague } from './carryDynastyRosters'
import {
  afterDynastyNewSeasonActivated,
  DYNASTY_ROLLOVER_METADATA_KEY,
  type RolloverHousekeepingResult,
} from './dynastyRolloverHousekeeping'
import { ensureScheduleForNewSeason, syncCompletedDraftToRedraftSeason } from '@/lib/redraft/finalizeDraftToRedraftSeason'
import { getPlatformEvents, EVENT } from '@/lib/events'
import { logAction } from '@/server/services/auditService'

const OPEN_DRAFT = [...OPEN_DRAFT_SESSION_STATUSES] as string[]

/**
 * League phases a new season may be started from. `offseason` is where finalize leaves a league;
 * `completed` is a finalize whose archive step failed; `pre_draft` is "Create next draft" having run
 * with that draft since gone. The drafted path lands in `post_draft`, so this does too.
 */
const STARTABLE_LIFECYCLE_STATES = new Set(['offseason', 'completed', 'pre_draft'])

/**
 * Next season's shell, plus every roster carried into it. Safe to call any number of times — the
 * repair for an offseason transition that did not finish.
 */
export async function ensureDynastyNextSeason(
  leagueId: string,
  completedSeasonId: string,
): Promise<{ id: string; season: number; playersCarried: number } | null> {
  const shell = await ensureNextRedraftSeasonShell(leagueId, completedSeasonId)
  if (!shell) return null
  const carried = await carryDynastyRostersForward(leagueId, completedSeasonId, shell.id)
  return { ...shell, playersCarried: carried.playersCopied }
}

type SeasonRow = { id: string; season: number; status: string; createdAt: Date; currentWeek: number }

const SEASON_SELECT = { id: true, season: true, status: true, createdAt: true, currentWeek: true } as const

/** Whether the newest draft is this season's rookie draft, and whether it is still open. */
async function rookieDraftState(
  leagueId: string,
  incoming: SeasonRow,
): Promise<'open' | 'complete' | 'none'> {
  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { status: true, createdAt: true },
  })
  if (!session) return 'none'
  if (OPEN_DRAFT.includes(session.status)) return 'open'
  // `createNextLeagueDraft` builds the shell before the draft, so this season's draft is never older.
  return session.createdAt >= incoming.createdAt ? 'complete' : 'none'
}

/**
 * Activate a season that has no draft to complete. The commissioner's skip and the kickoff rule
 * both end here; the rookie-draft path has its own activation and is not routed through this.
 */
export async function activateDynastySeasonWithoutDraft(input: {
  leagueId: string
  season: SeasonRow
  sport: string
  totalWeeks: number
  playoffStartWeek: number
  medianGame: boolean
  actorUserId: string
  reason: 'commissioner_skipped_rookie_draft' | 'kickoff_without_rookie_draft'
  now: Date
}): Promise<{ activated: boolean; housekeeping: RolloverHousekeepingResult | null }> {
  const { leagueId, season, now } = input
  const activated = await prisma.redraftSeason.updateMany({
    where: { id: season.id, status: 'setup' },
    data: { status: 'active', currentWeek: Math.max(1, season.currentWeek ?? 0) },
  })
  if (activated.count === 0) return { activated: false, housekeeping: null }

  // The shell carries a schedule already; this only fills one in if that step was lost.
  await ensureScheduleForNewSeason({
    seasonId: season.id,
    leagueId,
    sport: input.sport,
    totalWeeks: input.totalWeeks,
    playoffStartWeek: input.playoffStartWeek,
    medianGame: input.medianGame,
  }).catch((error) => {
    console.warn('[start-dynasty-season] schedule repair skipped', { leagueId, seasonId: season.id, error: String(error) })
  })

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { lifecycleState: true, lifecycleMetadata: true },
  })
  const fromState = String(league?.lifecycleState ?? '')
  if (league && STARTABLE_LIFECYCLE_STATES.has(fromState)) {
    const meta =
      league.lifecycleMetadata && typeof league.lifecycleMetadata === 'object' && !Array.isArray(league.lifecycleMetadata)
        ? (league.lifecycleMetadata as Record<string, unknown>)
        : {}
    await prisma.league.update({
      where: { id: leagueId },
      data: {
        lifecycleState: 'post_draft',
        lifecycleMetadata: {
          ...meta,
          lastTransitionAt: now.toISOString(),
          lastTransitionFrom: fromState,
          newSeasonStarted: { seasonId: season.id, reason: input.reason },
        } as Prisma.InputJsonValue,
      },
    })
  }

  await logAction({
    leagueId,
    userId: input.actorUserId,
    actionType: 'season_new_started',
    entityType: 'redraft_season',
    entityId: season.id,
    beforeState: { status: 'setup', lifecycleState: fromState },
    afterState: { status: 'active', reason: input.reason, season: season.season },
  }).catch(() => null)

  await getPlatformEvents()
    .emit(EVENT.SEASON_ACTIVATED, {
      leagueId,
      seasonId: season.id,
      sport: input.sport ?? null,
      leagueConcept: 'redraft',
      actor: { type: 'system' },
      idempotencyKey: `season.activated:${season.id}`,
      source: 'engine:dynasty-new-season',
      subjects: [{ kind: 'season', id: season.id }],
      payload: { seasonId: season.id, season: season.season },
    })
    .catch(() => null)

  const housekeeping = await afterDynastyNewSeasonActivated(leagueId, season.id, now).catch((error) => {
    console.error('[start-dynasty-season] housekeeping failed', { leagueId, seasonId: season.id, error })
    return null
  })
  return { activated: true, housekeeping }
}

export type StartNewSeasonCode =
  | 'LEAGUE_NOT_FOUND'
  | 'TOURNAMENT_RULES_FROZEN'
  | 'NOT_DYNASTY'
  | 'NO_SEASON'
  | 'NOT_YEAR_TWO'
  | 'SEASON_IN_PROGRESS'
  | 'ROOKIE_DRAFT_IN_PROGRESS'
  | 'ROOKIE_DRAFT_NOT_DONE'
  | 'ACTIVATION_FAILED'

export type StartNewSeasonResult =
  | {
      ok: true
      seasonId: string
      season: number
      /** `already_active` is the idempotent re-run: nothing was changed. */
      via: 'rookie_draft' | 'skipped_rookie_draft' | 'already_active'
      playersCarried: number
      housekeeping: RolloverHousekeepingResult | null
    }
  | { ok: false; code: StartNewSeasonCode; message: string }

function storedHousekeeping(meta: unknown, seasonId: string): RolloverHousekeepingResult | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
  const value = (meta as Record<string, unknown>)[DYNASTY_ROLLOVER_METADATA_KEY] as RolloverHousekeepingResult | undefined
  return value && value.seasonId === seasonId ? value : null
}

/** The commissioner's "Start new season". */
export async function startDynastyNewSeason(
  leagueId: string,
  actorUserId: string,
  opts: { skipRookieDraft?: boolean; now?: Date } = {},
): Promise<StartNewSeasonResult> {
  const now = opts.now ?? new Date()
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, leagueType: true, isDynasty: true, settings: true, lifecycleMetadata: true },
  })
  if (!league) return { ok: false, code: 'LEAGUE_NOT_FOUND', message: 'League not found.' }
  if (seasonSetupBlocked(league.settings)) {
    return { ok: false, code: 'TOURNAMENT_RULES_FROZEN', message: 'This league’s season is managed by its tournament.' }
  }
  if (!isDynastyFamilyLeague(league)) {
    return { ok: false, code: 'NOT_DYNASTY', message: 'Only dynasty leagues carry their rosters into a new season. Create next season’s draft instead.' }
  }

  const seasons = await prisma.redraftSeason.findMany({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    take: 2,
    select: SEASON_SELECT,
  })
  const latest = seasons[0]
  if (!latest) return { ok: false, code: 'NO_SEASON', message: 'This league has no season yet.' }

  let incoming: SeasonRow
  let playersCarried = 0
  if (latest.status === 'complete') {
    const next = await ensureDynastyNextSeason(leagueId, latest.id)
    if (!next) return { ok: false, code: 'NO_SEASON', message: 'Next season could not be created.' }
    playersCarried = next.playersCarried
    const row = await prisma.redraftSeason.findUnique({ where: { id: next.id }, select: SEASON_SELECT })
    if (!row) return { ok: false, code: 'NO_SEASON', message: 'Next season could not be created.' }
    incoming = row
  } else if (seasons[1]?.status !== 'complete') {
    return latest.status === 'setup'
      ? { ok: false, code: 'NOT_YEAR_TWO', message: 'A league’s first season starts when its startup draft completes.' }
      : { ok: false, code: 'SEASON_IN_PROGRESS', message: 'This season is still being played. Finalize it first.' }
  } else if (latest.status === 'setup') {
    incoming = latest
    // Carryover is idempotent, so this repairs a transition that never finished it.
    playersCarried = (await carryDynastyRostersForward(leagueId, seasons[1].id, latest.id)).playersCopied
  } else {
    return {
      ok: true,
      seasonId: latest.id,
      season: latest.season,
      via: 'already_active',
      playersCarried: 0,
      housekeeping: storedHousekeeping(league.lifecycleMetadata, latest.id),
    }
  }

  const draft = await rookieDraftState(leagueId, incoming)
  if (draft === 'open') {
    return {
      ok: false,
      code: 'ROOKIE_DRAFT_IN_PROGRESS',
      message: 'The rookie draft is not finished. Complete it before the new season starts.',
    }
  }

  if (draft === 'complete') {
    // The season should already be active; this re-runs the draft's own activation if it was lost.
    await syncCompletedDraftToRedraftSeason(leagueId)
    const after = await prisma.redraftSeason.findUnique({ where: { id: incoming.id }, select: { status: true } })
    if (after?.status === 'setup' || !after) {
      return { ok: false, code: 'ACTIVATION_FAILED', message: 'The rookie draft is complete but the season could not be activated.' }
    }
    const refreshed = await prisma.league.findUnique({ where: { id: leagueId }, select: { lifecycleMetadata: true } })
    return {
      ok: true,
      seasonId: incoming.id,
      season: incoming.season,
      via: 'rookie_draft',
      playersCarried,
      housekeeping: storedHousekeeping(refreshed?.lifecycleMetadata, incoming.id),
    }
  }

  if (!opts.skipRookieDraft) {
    return {
      ok: false,
      code: 'ROOKIE_DRAFT_NOT_DONE',
      message: 'No rookie draft has been held for this season. Create and run it, or start the season without one.',
    }
  }

  const shape = await prisma.redraftSeason.findUnique({
    where: { id: incoming.id },
    select: { sport: true, totalWeeks: true, playoffStartWeek: true, medianGame: true },
  })
  if (!shape) return { ok: false, code: 'NO_SEASON', message: 'Next season could not be found.' }
  const { housekeeping } = await activateDynastySeasonWithoutDraft({
    leagueId,
    season: incoming,
    sport: shape.sport,
    totalWeeks: shape.totalWeeks,
    playoffStartWeek: shape.playoffStartWeek,
    medianGame: shape.medianGame,
    actorUserId,
    reason: 'commissioner_skipped_rookie_draft',
    now,
  })
  const after = await prisma.redraftSeason.findUnique({ where: { id: incoming.id }, select: { status: true } })
  if (!after || after.status === 'setup') {
    return { ok: false, code: 'ACTIVATION_FAILED', message: 'The season could not be activated.' }
  }
  return {
    ok: true,
    seasonId: incoming.id,
    season: incoming.season,
    via: 'skipped_rookie_draft',
    playersCarried,
    housekeeping,
  }
}

export type KickoffActivationOutcome = {
  seasonId: string
  leagueId: string
  action: 'activated' | 'held'
  detail: string
}

/**
 * The week roller's half: a dynasty league's next season starts when its sport's week 1 does, so
 * a league that never held (or never created) a rookie draft is still played and scored.
 *
 * The rule, chosen to be the safest one that cannot leave a season stranded:
 *   - the sport's week 1 has begun (the same resolver the roller advances on says not preseason);
 *   - no draft is open — an unfinished rookie draft always holds the season;
 *   - the season follows a completed one in a native dynasty-family league.
 * A finished rookie draft activates through its own path; otherwise the season starts with the
 * carried rosters, exactly as if the commissioner had skipped the draft.
 */
export async function activateDynastyNewSeasonsAtKickoff(options: {
  now: Date
  limit: number
  actorUserId: string
  resolveWeek: (seasonId: string) => Promise<{ ok: boolean; phase?: string; reason?: string }>
  nativePlatforms: readonly string[]
}): Promise<KickoffActivationOutcome[]> {
  const candidates = await prisma.redraftSeason.findMany({
    where: {
      status: 'setup',
      league: {
        platform: { in: [...options.nativePlatforms] },
        OR: [
          { isDynasty: true },
          ...['dynasty', 'devy', 'c2c'].map((t) => ({ leagueType: { equals: t, mode: 'insensitive' as const } })),
        ],
      },
    },
    select: {
      ...SEASON_SELECT,
      leagueId: true,
      sport: true,
      totalWeeks: true,
      playoffStartWeek: true,
      medianGame: true,
      league: { select: { settings: true, leagueType: true, isDynasty: true } },
    },
    take: options.limit,
  })

  const outcomes: KickoffActivationOutcome[] = []
  for (const c of candidates) {
    const held = (detail: string) => outcomes.push({ seasonId: c.id, leagueId: c.leagueId, action: 'held', detail })
    try {
      if (!c.league || !isDynastyFamilyLeague(c.league) || seasonSetupBlocked(c.league.settings)) {
        held('not_dynasty')
        continue
      }
      const prior = await prisma.redraftSeason.findFirst({
        where: { leagueId: c.leagueId, status: 'complete', NOT: { id: c.id }, createdAt: { lt: c.createdAt } },
        select: { id: true },
      })
      if (!prior) {
        held('first_season')
        continue
      }
      const draft = await rookieDraftState(c.leagueId, c)
      if (draft === 'open') {
        held('ROOKIE_DRAFT_IN_PROGRESS')
        continue
      }
      const week = await options.resolveWeek(c.id)
      if (!week.ok) {
        held(`WEEK_UNRESOLVED:${week.reason ?? 'unknown'}`)
        continue
      }
      if (week.phase === 'preseason') {
        held('PRESEASON')
        continue
      }
      if (draft === 'complete') {
        await syncCompletedDraftToRedraftSeason(c.leagueId)
        outcomes.push({ seasonId: c.id, leagueId: c.leagueId, action: 'activated', detail: 'rookie_draft' })
        continue
      }
      const done = await activateDynastySeasonWithoutDraft({
        leagueId: c.leagueId,
        season: c,
        sport: c.sport,
        totalWeeks: c.totalWeeks,
        playoffStartWeek: c.playoffStartWeek,
        medianGame: c.medianGame,
        actorUserId: options.actorUserId,
        reason: 'kickoff_without_rookie_draft',
        now: options.now,
      })
      if (done.activated) outcomes.push({ seasonId: c.id, leagueId: c.leagueId, action: 'activated', detail: 'kickoff' })
      else held('already_activated')
    } catch (error) {
      held(`error:${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return outcomes
}
