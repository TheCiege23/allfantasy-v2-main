/**
 * The Commissioner Hub's schedule tools (owner's page review #17, Phase C3) — the database half of
 * ./customWeeks.ts.
 *
 * - `randomizeSchedule`: N draws (1–25). Every draw is posted to the league chat, one by one; the last
 *   becomes the schedule. Written through `generateNflRedraftScheduleForSeason`, so every regeneration rule
 *   applies unchanged: started weeks are kept, a mid-season rebuild needs the commissioner's confirmation,
 *   an archived league or a live draft refuses, and custom weeks keep their pairings.
 * - `setCustomWeek`: set one week's pairings by hand, or clear a week back to the generator's.
 * - `keepWeekAsCustom`: record a week's current rows as custom (after a swap on a custom week, or a
 *   Rivalry Week), so the next regeneration does not undo them.
 *
 * Only a regular-season week that has not started can change — the rule swaps and regeneration already use.
 */
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { logAction } from '@/server/services/auditService'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'
import { generateNflRedraftScheduleForSeason, type PersistedScheduleGenerationResult } from './resolveNflRedraftScheduleRuntime'
import { weekHasStarted } from './scheduleRegeneration'
import {
  MAX_SCHEDULE_RANDOMIZATIONS,
  checkCustomPairs,
  randomizeChatMessage,
  readCustomWeeks,
  shuffledOrders,
  withCustomWeek,
  type CustomPair,
} from './customWeeks'

type Refusal = { ok: false; status: number; code: string; message: string }

export async function randomizeSchedule(input: {
  seasonId: string
  times: number
  actorUserId: string
  confirmMidSeasonChange?: boolean
  random?: () => number
}): Promise<(Extract<PersistedScheduleGenerationResult, { ok: true }> & { times: number; posted: number }) | Refusal> {
  const times = Math.floor(Number(input.times))
  if (!Number.isFinite(times) || times < 1 || times > MAX_SCHEDULE_RANDOMIZATIONS) {
    return { ok: false, status: 400, code: 'BAD_TIMES', message: `Pick how many times to randomize, from 1 to ${MAX_SCHEDULE_RANDOMIZATIONS}.` }
  }
  const season = await prisma.redraftSeason.findUnique({
    where: { id: input.seasonId },
    select: { id: true, leagueId: true, rosters: { select: { id: true }, orderBy: { id: 'asc' } } },
  })
  if (!season) return { ok: false, status: 404, code: 'SEASON_NOT_FOUND', message: 'Season not found.' }

  const orders = shuffledOrders(season.rosters.map((r) => r.id), times, input.random)
  const generated = await generateNflRedraftScheduleForSeason({
    seasonId: season.id,
    regenerate: true,
    teamOrder: orders[orders.length - 1],
    previewOrders: orders,
    confirmMidSeasonChange: input.confirmMidSeasonChange === true,
    actorUserId: input.actorUserId,
  })
  if (!generated.ok) {
    return { ok: false, status: 409, code: generated.code, message: generated.message }
  }

  // Posted after the schedule is saved, so chat never shows a draw that did not happen. A failed post
  // costs that message and nothing else.
  const run = randomUUID()
  let posted = 0
  for (const [i, d] of (generated.draws ?? []).entries()) {
    const ok = await createLeagueChatMessage(
      season.leagueId,
      input.actorUserId,
      randomizeChatMessage({ draw: i + 1, times: orders.length, week: d.week, pairs: d.pairs }),
      {
        type: 'text',
        source: null,
        messageSubtype: 'commissioner_change',
        idempotencyKey: `schedule-randomize-${run}-${i + 1}`,
        metadata: { category: 'Schedule', randomizeTimes: orders.length, draw: i + 1, week: d.week, isSystemMessage: true },
      },
    ).then(Boolean).catch(() => false)
    if (ok) posted += 1
  }

  await logAction({
    leagueId: season.leagueId,
    userId: input.actorUserId,
    actionType: 'schedule_randomized',
    entityType: 'schedule',
    entityId: season.id,
    metadata: { times: orders.length, fromWeek: generated.regeneratedFromWeek, posted, customWeeksKept: generated.customWeeksKept ?? [] },
  }).catch(() => {})

  return { ...generated, times: orders.length, posted }
}

type WeekContext = {
  season: { id: string; leagueId: string; season: number }
  rosterIds: string[]
}

async function editableWeek(seasonId: string, week: number, now: Date): Promise<WeekContext | Refusal> {
  const season = await prisma.redraftSeason.findUnique({
    where: { id: seasonId },
    select: {
      id: true, leagueId: true, sport: true, season: true, currentWeek: true, playoffStartWeek: true,
      rosters: { select: { id: true } },
      schedule: { select: { week: true, status: true, homeScore: true, awayScore: true } },
    },
  })
  if (!season) return { ok: false, status: 404, code: 'SEASON_NOT_FOUND', message: 'Season not found.' }
  if (!Number.isInteger(week) || week < 1 || week >= season.playoffStartWeek) {
    return { ok: false, status: 400, code: 'NOT_REGULAR_SEASON', message: 'Only regular-season weeks can be edited here.' }
  }
  if (weekHasStarted(week, { currentWeek: season.currentWeek, sport: season.sport, seasonYear: season.season, now, persisted: season.schedule })) {
    return { ok: false, status: 409, code: 'WEEK_STARTED', message: `Week ${week} has already started, so its matchups can no longer change.` }
  }
  return { season: { id: season.id, leagueId: season.leagueId, season: season.season }, rosterIds: season.rosters.map((r) => r.id) }
}

/** Read-modify-write of `League.settings` inside the caller's transaction. */
async function writeCustomWeek(
  tx: Pick<typeof prisma, 'league'>,
  leagueId: string,
  seasonYear: number,
  week: number,
  pairs: CustomPair[] | null,
) {
  const league = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  await tx.league.update({ where: { id: leagueId }, data: { settings: withCustomWeek(league?.settings, seasonYear, week, pairs) as object } })
}

export async function setCustomWeek(input: {
  seasonId: string
  week: number
  /** The week's pairings; `null` clears the week back to the generator's (its rows stay until the next rebuild). */
  pairs: CustomPair[] | null
  actorUserId: string
  now?: Date
}): Promise<{ ok: true; week: number; cleared: boolean } | Refusal> {
  const ctx = await editableWeek(input.seasonId, Math.floor(input.week), input.now ?? new Date())
  if ('ok' in ctx) return ctx
  const week = Math.floor(input.week)

  if (input.pairs === null) {
    await prisma.$transaction(async (tx) => writeCustomWeek(tx, ctx.season.leagueId, ctx.season.season, week, null))
    await logAction({
      leagueId: ctx.season.leagueId, userId: input.actorUserId, actionType: 'schedule_custom_week_cleared',
      entityType: 'schedule', entityId: ctx.season.id, metadata: { week },
    }).catch(() => {})
    return { ok: true, week, cleared: true }
  }

  const check = checkCustomPairs(input.pairs, ctx.rosterIds)
  if (!check.ok) return { ok: false, status: 400, code: check.code, message: check.message }

  const before = await prisma.redraftMatchup.findMany({
    where: { seasonId: ctx.season.id, week, type: 'regular', isMedianMatchup: false },
    select: { homeRosterId: true, awayRosterId: true },
  })
  await prisma.$transaction(async (tx) => {
    await tx.redraftMatchup.deleteMany({ where: { seasonId: ctx.season.id, week, type: 'regular', isMedianMatchup: false } })
    await tx.redraftMatchup.createMany({
      data: input.pairs!.map((p) => ({
        seasonId: ctx.season.id,
        leagueId: ctx.season.leagueId,
        week,
        type: 'regular',
        homeRosterId: p.home,
        awayRosterId: p.away,
        isMedianMatchup: false,
        status: 'scheduled',
      })),
    })
    await writeCustomWeek(tx, ctx.season.leagueId, ctx.season.season, week, input.pairs)
  })
  await logAction({
    leagueId: ctx.season.leagueId, userId: input.actorUserId, actionType: 'schedule_custom_week',
    entityType: 'schedule', entityId: ctx.season.id, beforeState: before, afterState: input.pairs,
    metadata: { week },
  }).catch(() => {})
  return { ok: true, week, cleared: false }
}

/**
 * Keep a week's current rows as its custom pairings. `onlyIfCustom`: update a week that is already custom
 * (a swap inside it) and leave the rest alone. Best effort — the edit itself is already saved.
 */
export async function keepWeekAsCustom(input: { seasonId: string; week: number; onlyIfCustom?: boolean }): Promise<boolean> {
  try {
    const season = await prisma.redraftSeason.findUnique({
      where: { id: input.seasonId },
      select: { id: true, leagueId: true, season: true, league: { select: { settings: true } } },
    })
    if (!season) return false
    if (input.onlyIfCustom && !readCustomWeeks(season.league.settings, season.season)[input.week]) return false
    const rows = await prisma.redraftMatchup.findMany({
      where: { seasonId: season.id, week: input.week, type: 'regular', isMedianMatchup: false },
      select: { homeRosterId: true, awayRosterId: true },
      orderBy: { id: 'asc' },
    })
    if (!rows.length) return false
    const pairs = rows.map((r) => ({ home: r.homeRosterId, away: r.awayRosterId }))
    await prisma.$transaction(async (tx) => writeCustomWeek(tx, season.leagueId, season.season, input.week, pairs))
    return true
  } catch {
    return false
  }
}
