/**
 * Commissioner automation recipes — the sender (Commissioner Hub, brief item 8).
 *
 * Posts the reminders and announcements a commissioner switched on in the hub:
 * lineup reminders, inactivity warnings, voting-deadline reminders and the
 * playoff announcement. What to post is decided by `dueRecipeMessages`
 * (`lib/core-app/commissioner/recipes.ts`); this file only reads the facts it
 * needs, writes the messages, and records that it did.
 *
 * 🛑 OFF UNTIL SOMEONE TURNS IT ON. Nothing is sent unless the
 * `commissioner_recipes_send_enabled` platform toggle reads true. Saving a
 * switch in the hub records the commissioner's choice; it never posts on its
 * own. That keeps the decision to start messaging real leagues with the person
 * who runs the platform, and the hub says so while the toggle is off.
 *
 * ── Where it runs ─────────────────────────────────────────────────────────
 *
 * Inside `/api/cron/commissioner-workspace-refresh` (daily, 08:40 UTC), after the
 * task scan and the reports. The schedule registry is at its 60-entry cap, and
 * the rule in this repo is to fold new work into an existing scheduled route
 * rather than add one. 08:40 UTC is before every NFL kickoff, which is when a
 * game-day lineup reminder is worth sending.
 *
 * ── Never twice ───────────────────────────────────────────────────────────
 *
 * Two layers. Each league's run is an automation job keyed per league per UTC
 * day, so a second fire the same day is a `skipped` row. And each message has a
 * `windowKey` (the game day, the week, the poll, the season) recorded in
 * `sportsDataCache` once posted — the same pattern the weekly recap uses — so a
 * retry after a partial failure re-sends only what did not go out.
 */

import { runAutomationJob } from '@/lib/automation/engine'
import { buildIdempotencyKey, hashIdempotencyKey } from '@/lib/automation/idempotency'
import { RetryableAutomationError, toErrorMessage } from '@/lib/automation/errors'
import { withAutomationLock } from '@/lib/automation/locks'
import type { AutomationResult } from '@/lib/automation/types'
import { getBoolean } from '@/lib/feature-toggle'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { prisma } from '@/lib/prisma'
import { getLeagueManagerHealth } from '@/lib/commissioner-hub/managerHealth'
import { readViewerPoll, isPollClosed } from '@/lib/chat-core/messagePolls'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { leagueWeekFromSettings, playoffSpots, playoffStartWeek } from '@/lib/core-app/seasonTimeline'
import {
  RECIPES_JOB_TYPE,
  RECIPES_SEND_TOGGLE,
  dueRecipeMessages,
  readRecipeSettings,
  type DueMessage,
  type RecipeFacts,
} from '@/lib/core-app/commissioner/recipes'
import { Prisma } from '@prisma/client'

const SEEN_PREFIX = 'commissioner-recipe:v1:'
const SEEN_TTL_MS = 400 * 24 * 60 * 60 * 1000

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function buildRecipesIdempotencyKey(leagueId: string, now: Date): string {
  return hashIdempotencyKey(buildIdempotencyKey([RECIPES_JOB_TYPE, leagueId, utcDay(now)]))
}

function starterSlots(playerData: unknown): unknown[] | null {
  if (!playerData || typeof playerData !== 'object' || Array.isArray(playerData)) return null
  const data = playerData as Record<string, unknown>
  if (Array.isArray(data.starters)) return data.starters
  const rows = getNormalizedLineupSections(playerData).starters
  return rows.length > 0 ? rows.map((r) => (r as Record<string, unknown>)?.id ?? null) : null
}

function emptyCount(slots: unknown[]): number {
  return slots.filter((s) => s == null || String(s).trim() === '' || String(s).trim() === '0').length
}

/** Everything `dueRecipeMessages` needs about one league, read in one pass. */
export async function readRecipeFacts(leagueId: string, now: Date): Promise<{
  facts: RecipeFacts
  settings: unknown
  platform: string
  ownerUserId: string
} | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      name: true,
      userId: true,
      platform: true,
      sport: true,
      status: true,
      season: true,
      settings: true,
      lastSyncedAt: true,
    },
  })
  if (!league?.userId) return null

  const sport = String(league.sport ?? 'NFL')
  const [teams, rosters, managers, polls, kickoffs] = await Promise.all([
    prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { teamName: true, ownerName: true, platformUserId: true, wins: true, losses: true, ties: true, pointsFor: true },
    }),
    prisma.roster.findMany({ where: { leagueId }, select: { platformUserId: true, playerData: true } }),
    getLeagueManagerHealth(leagueId).catch(() => null),
    prisma.leagueChatMessage
      .findMany({
        where: {
          leagueId,
          createdAt: { gte: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000) },
          NOT: { metadata: { path: ['poll'], equals: Prisma.AnyNull } },
        },
        select: { id: true, metadata: true },
        take: 50,
      })
      .catch(() => []),
    sport.toUpperCase() === 'NFL' && league.season != null
      ? prisma.sportsGame
          .findMany({
            where: {
              sport: 'NFL',
              season: league.season,
              seasonType: 'regular',
              startTime: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000), lte: new Date(now.getTime() + 36 * 60 * 60 * 1000) },
            },
            select: { startTime: true },
          })
          .catch(() => [])
      : Promise.resolve([] as Array<{ startTime: Date | null }>),
  ])

  const label = (t: { teamName?: string | null; ownerName?: string | null }) =>
    t.teamName?.trim() || t.ownerName?.trim() || 'An unnamed team'
  const native = resolveWriteAuthority(league.platform) === 'NATIVE'
  const dataStale =
    !native && (!league.lastSyncedAt || now.getTime() - league.lastSyncedAt.getTime() > 2 * 24 * 60 * 60 * 1000)
  const byOwner = new Map(teams.filter((t) => t.platformUserId).map((t) => [t.platformUserId as string, t]))

  const emptyLineups = rosters.flatMap((r) => {
    const slots = starterSlots(r.playerData)
    const team = byOwner.get(r.platformUserId)
    if (!slots || slots.length === 0 || !team) return []
    const empty = emptyCount(slots)
    return empty > 0 ? [{ name: label(team), empty }] : []
  })

  const openPolls = polls.flatMap((p) => {
    const poll = readViewerPoll(p.metadata, null)
    if (!poll || isPollClosed(poll, now.getTime())) return []
    return [{ id: p.id, question: poll.question, closesAt: poll.closesAt }]
  })

  const standings = [...teams]
    .sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor)
    .map((t) => ({ name: label(t), wins: t.wins, losses: t.losses, ties: t.ties }))

  return {
    platform: String(league.platform ?? '').toLowerCase(),
    settings: league.settings,
    ownerUserId: league.userId,
    facts: {
      now,
      leagueName: league.name?.trim() || 'League',
      sport,
      platform: String(league.platform ?? '').toLowerCase(),
      status: league.status,
      season: league.season,
      currentWeek: leagueWeekFromSettings(league.settings),
      playoffStartWeek: playoffStartWeek(league.settings),
      playoffSpots: playoffSpots(league.settings),
      kickoffs: kickoffs.flatMap((k) => (k.startTime ? [k.startTime] : [])),
      emptyLineups,
      inactiveTeams: managers
        ? managers.rows
            .filter((r) => r.status === 'inactive')
            .map((r) => r.teamName || r.managerName || 'An unnamed team')
        : [],
      dataStale,
      polls: openPolls,
      standings,
    },
  }
}

async function alreadySent(key: string): Promise<boolean> {
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: key }, select: { cacheKey: true } })
  return Boolean(row)
}

async function markSent(key: string, message: DueMessage): Promise<void> {
  const data = { version: 1, recipe: message.recipe, sentAt: new Date().toISOString() } as unknown as object
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: key },
    update: { data, expiresAt: new Date(Date.now() + SEEN_TTL_MS) },
    create: { cacheKey: key, data, expiresAt: new Date(Date.now() + SEEN_TTL_MS) },
  })
}

export async function runCommissionerRecipesForLeague(input: {
  leagueId: string
  now?: Date
}): Promise<AutomationResult & { jobId: string; runId: string }> {
  const now = input.now ?? new Date()
  return runAutomationJob(
    {
      leagueId: input.leagueId,
      jobType: RECIPES_JOB_TYPE,
      idempotencyKey: buildRecipesIdempotencyKey(input.leagueId, now),
      metadata: { trigger: 'scheduled', scheduledFor: now.toISOString() },
    },
    async (ctx) => {
      try {
        const locked = await withAutomationLock(
          `commissioner:recipes:${input.leagueId}`,
          { owner: ctx.jobId, ttlMs: 120_000 },
          async () => {
            const loaded = await readRecipeFacts(input.leagueId, now)
            if (!loaded) return { posted: [] as string[], due: 0 }
            const { values } = readRecipeSettings(loaded.settings, loaded.platform)
            const due = dueRecipeMessages(values, loaded.facts)
            const posted: string[] = []
            for (const message of due) {
              const key = `${SEEN_PREFIX}${input.leagueId}:${message.windowKey}`
              if (await alreadySent(key)) continue
              /*
               * Posted as a system message under the league owner's id — the same
               * shape the weekly recap uses, so chat renders it as the league's own
               * announcement rather than as a message typed by a manager.
               */
              const created = await createLeagueChatMessage(input.leagueId, loaded.ownerUserId, message.text, {
                type: 'system',
                metadata: { isSystem: true, commissionerRecipe: message.recipe, windowKey: message.windowKey },
              })
              if (!created) throw new Error(`chat post failed for ${message.recipe}`)
              await markSent(key, message)
              posted.push(message.recipe)
            }
            return { posted, due: due.length }
          },
        )

        if (!locked.ok) {
          return {
            status: 'skipped',
            message: `Another run holds this league's lock (${locked.reason})`,
            metadata: { reason: 'lock_unavailable' },
          }
        }
        const { posted, due } = locked.value
        const resultMessage =
          posted.length === 0
            ? due === 0
              ? 'Nothing was due'
              : 'Everything due had already been posted'
            : `Posted ${posted.length}: ${posted.join(', ')}`
        return { status: 'completed', message: resultMessage, metadata: { posted, due, resultMessage } }
      } catch (error) {
        throw new RetryableAutomationError(
          `${RECIPES_JOB_TYPE} failed for ${input.leagueId}: ${toErrorMessage(error)}`,
        )
      }
    },
  )
}

export type CommissionerRecipesBatchResult = {
  enabled: boolean
  discovered: number
  completed: number
  skipped: number
  failed: number
}

/**
 * The scheduled entry point. Finds leagues with any sender-run recipe on and
 * runs each on its own — one league's failure never ends the batch.
 */
export async function runCommissionerRecipesBatch(options?: {
  limit?: number
  now?: Date
  leagueId?: string
}): Promise<CommissionerRecipesBatchResult> {
  const empty = { discovered: 0, completed: 0, skipped: 0, failed: 0 }
  if (!(await getBoolean(RECIPES_SEND_TOGGLE))) return { enabled: false, ...empty }

  const now = options?.now ?? new Date()
  const leagues = await prisma.league.findMany({
    where: {
      ...(options?.leagueId ? { id: options.leagueId } : {}),
      settings: { path: ['commissionerRecipes', 'active'], equals: true },
    },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: Math.min(500, Math.max(1, options?.limit ?? 200)),
  })

  const result: CommissionerRecipesBatchResult = { enabled: true, ...empty, discovered: leagues.length }
  for (const league of leagues) {
    try {
      const outcome = await runCommissionerRecipesForLeague({ leagueId: league.id, now })
      if (outcome.status === 'completed') result.completed += 1
      else if (outcome.status === 'skipped') result.skipped += 1
      else result.failed += 1
    } catch (error) {
      result.failed += 1
      console.error('[commissioner-recipes] league failed:', league.id, toErrorMessage(error))
    }
  }
  return result
}
