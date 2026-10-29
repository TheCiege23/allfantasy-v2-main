import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { broadcastRefusal } from '@/lib/commissioner/broadcastAccess'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'
import { createPredictionPoll, defaultAfterPost } from '@/lib/league-chat/predictionPolls'
import { buildWeeklyHooks, topHook, type WeeklyHooks } from './hookEngine'
import { loadStoryData, type LoadedLeague } from './loadStoryData'
import {
  autoPostMessageId,
  isAutoPostDue,
  readStorylineSettings,
  storylineWeekKey,
  withStorylineSettings,
  type SettingsPatch,
  type StorylineSettings,
} from './storylineSettings'
import type { HookLanguage, StoryData, StoryHook } from './types'

/**
 * Storyline Studio — reads, posts, and the weekly auto-post sweep. The rules live in ./hookEngine.ts
 * and ./storylineSettings.ts.
 *
 * ⚠ AF COMMISSIONER IS THE GATE: `commissioner_automation`, the feature every commissioner automation
 * here uses (deadline autopilot, the AI commissioner, keeper and guillotine rules). The Studio reads
 * the VIEWER's plan; the auto-post reads the plan of whoever switched it on, at SEND time — so a
 * lapsed plan stops the posts on the next sweep, and the switch and the post history stay.
 *
 * ⚠ ONLY AN ALLFANTASY LEAGUE HAS A CHAT TO POST TO. An imported league's chat lives on Sleeper, ESPN
 * or wherever it came from; we do not write there. Its Studio is Copy only, and both "post" and the
 * auto-post switch are refused here, server-side, whatever the client shows.
 *
 * ⚠ A POST IS AN ORDINARY LEAGUE CHAT MESSAGE. It gets the same Discord relay and the same opt-in
 * "new league chat message" notification a member's own message gets (`defaultAfterPost`) — no
 * extra push to every member.
 */

export const STUDIO_FEATURE = 'commissioner_automation' as const
export const STORYLINE_SUBTYPE = 'storyline'
/** `STORYLINE_AUTOPOST=off` stops the sweep without a code deploy — the NATIVE_RESULT_PUSH convention. */
export function isAutoPostSweepDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.STORYLINE_AUTOPOST ?? '').trim().toLowerCase() === 'off'
}

export async function storylineEntitled(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false
  try {
    return (await new FeatureGateService().evaluateUserFeatureAccess(userId, STUDIO_FEATURE)).allowed
  } catch (e) {
    console.warn('[storyline-studio] plan check failed; treating as no plan', e instanceof Error ? e.message : e)
    return false
  }
}

export async function storylineUpgradePath(userId: string): Promise<string | null> {
  try {
    return (await new FeatureGateService().evaluateUserFeatureAccess(userId, STUDIO_FEATURE)).upgradePath ?? null
  } catch {
    return null
  }
}

async function mutateSettings(
  leagueId: string,
  fn: (current: StorylineSettings) => StorylineSettings | null,
): Promise<StorylineSettings | null> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const row = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    if (!row) return null
    const next = fn(readStorylineSettings(row.settings))
    if (!next) return null
    await tx.league.update({ where: { id: leagueId }, data: { settings: withStorylineSettings(row.settings, next) as Prisma.InputJsonValue } })
    return next
  })
}

export type StudioView = {
  native: boolean
  platform: string
  season: number
  week: number | null
  teams: Record<string, string>
  hooks: WeeklyHooks
  settings: Omit<StorylineSettings, 'enabledByUserId'> & { enabledByYou: boolean }
}

export async function readStudioView(leagueId: string, viewerUserId: string, lang: HookLanguage): Promise<StudioView | null> {
  const loaded = await loadStoryData(prisma, leagueId)
  if (!loaded) return null
  const { league, data } = loaded
  const settings = readStorylineSettings(league.settings)
  const { enabledByUserId, ...rest } = settings
  return {
    native: isNativePlatform(league.platform),
    platform: String(league.platform ?? ''),
    season: data.season,
    week: data.week,
    teams: Object.fromEntries([...data.teams].map(([k, t]) => [k, t.name])),
    hooks: buildWeeklyHooks(data, lang),
    settings: { ...rest, enabledByYou: enabledByUserId === viewerUserId },
  }
}

export type SaveSettingsError = 'not_found' | 'imported' | 'not_entitled'

/** Save the switches. Turning auto-post ON needs a native league and the plan; OFF never does. */
export async function saveStudioSettings(
  leagueId: string,
  userId: string,
  patch: SettingsPatch,
): Promise<{ ok: true; settings: StorylineSettings } | { ok: false; error: SaveSettingsError }> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true } })
  if (!league) return { ok: false, error: 'not_found' }
  if (patch.autoPost === true) {
    if (!isNativePlatform(league.platform)) return { ok: false, error: 'imported' }
    if (!(await storylineEntitled(userId))) return { ok: false, error: 'not_entitled' }
  }
  if (patch.includePoll === true && !isNativePlatform(league.platform)) return { ok: false, error: 'imported' }
  const saved = await mutateSettings(leagueId, (cur) => ({
    ...cur,
    ...patch,
    // Whoever turns it on owns the posts and pays for them.
    enabledByUserId: patch.autoPost === true ? userId : cur.enabledByUserId,
  }))
  return saved ? { ok: true, settings: saved } : { ok: false, error: 'not_found' }
}

export type PostError = 'imported' | 'forbidden' | 'empty' | 'too_long' | 'not_found' | 'failed'

export const STORYLINE_MAX_LENGTH = 1000

/**
 * Post one storyline into the league chat, as the commissioner, optionally with the matchup's
 * prediction poll. `messageId` makes the post idempotent (the auto-post's per-week id).
 */
export async function postStoryline(args: {
  leagueId: string
  userId: string
  text: string
  hook: Pick<StoryHook, 'id' | 'kind' | 'season' | 'week' | 'facts'> | null
  matchupId?: string | null
  includePoll?: boolean
  messageId?: string
  auto?: boolean
}): Promise<{ ok: true; messageId: string; created: boolean; pollMessageId: string | null } | { ok: false; error: PostError }> {
  const text = args.text.trim()
  if (!text) return { ok: false, error: 'empty' }
  if (text.length > STORYLINE_MAX_LENGTH) return { ok: false, error: 'too_long' }
  const refusal = await broadcastRefusal(args.leagueId, args.userId).catch((): 'forbidden' => 'forbidden')
  if (refusal === 'imported') return { ok: false, error: 'imported' }
  if (refusal) return { ok: false, error: 'forbidden' }

  if (args.messageId) {
    const existing = await prisma.leagueChatMessage.findUnique({ where: { id: args.messageId }, select: { id: true } })
    if (existing) return { ok: true, messageId: existing.id, created: false, pollMessageId: null }
  }

  const metadata = {
    storyline: {
      hookId: args.hook?.id ?? null,
      kind: args.hook?.kind ?? null,
      season: args.hook?.season ?? null,
      week: args.hook?.week ?? null,
      auto: args.auto === true,
      // The facts the text was written from, so a reader can always ask "says who?".
      facts: (args.hook?.facts ?? []).map((f) => ({ key: f.key, value: f.value, source: f.source })),
    },
  }
  const created = await createLeagueChatMessage(args.leagueId, args.userId, text, {
    ...(args.messageId ? { idempotencyKey: args.messageId } : {}),
    type: 'text',
    metadata,
    messageSubtype: STORYLINE_SUBTYPE,
  })
  if (!created) {
    // The id refused a duplicate: a concurrent sweep already posted this week's storyline.
    return args.messageId ? { ok: true, messageId: args.messageId, created: false, pollMessageId: null } : { ok: false, error: 'failed' }
  }
  try {
    await defaultAfterPost(args.leagueId, args.userId)({
      messageId: created.id,
      body: text,
      metadata,
      authorName: created.senderName ?? 'Commissioner',
      authorAvatarUrl: created.senderAvatarUrl ?? null,
    })
  } catch (e) {
    console.warn('[storyline-studio] post side effects failed', e instanceof Error ? e.message : e)
  }

  let pollMessageId: string | null = null
  if (args.includePoll && args.matchupId) {
    const poll = await createPredictionPoll({ prisma, leagueId: args.leagueId, matchupId: args.matchupId, authorUserId: args.userId }).catch(() => null)
    if (poll?.ok) pollMessageId = poll.messageId
  }

  // The auto-post's record of the week. A commissioner's own posts are in the chat already, and
  // they do not stand in for the week's automatic one.
  if (args.auto && args.hook?.season != null && args.hook.week != null) {
    const key = storylineWeekKey(args.hook.season, args.hook.week)
    const at = new Date().toISOString()
    await mutateSettings(args.leagueId, (cur) => ({
      ...cur,
      posted: { ...cur.posted, [key]: { at, messageId: created.id, hookId: args.hook!.id, auto: true } },
    })).catch(() => null)
  }
  return { ok: true, messageId: created.id, created: true, pollMessageId }
}

/* ─── The weekly sweep ──────────────────────────────────────────────────────────────────────── */

export type AutoPostRun = {
  ran: true
  leagues: number
  posted: number
  notDue: number
  notEntitled: number
  refused: number
  nothingToSay: number
  alreadyPosted: number
  budgetStopped: boolean
  errors: Array<{ leagueId: string; error: string }>
}

type SweepDeps = {
  now?: Date
  dryRun?: boolean
  budgetMs?: number
  entitled?: (userId: string) => Promise<boolean>
  load?: (leagueId: string) => Promise<{ league: LoadedLeague; data: StoryData } | null>
  post?: typeof postStoryline
  listLeagues?: () => Promise<Array<{ id: string; platform: string | null; settings: unknown }>>
}

/**
 * Every league with auto-post on: if it is that league's posting day and hour, post the week's top
 * hook (and its poll, when asked) — once per fantasy week, by row id.
 */
export async function runStorylineAutoPost(deps: SweepDeps = {}): Promise<AutoPostRun> {
  const started = Date.now()
  const now = deps.now ?? new Date()
  const run: AutoPostRun = {
    ran: true, leagues: 0, posted: 0, notDue: 0, notEntitled: 0, refused: 0, nothingToSay: 0, alreadyPosted: 0, budgetStopped: false, errors: [],
  }
  const leagues = deps.listLeagues
    ? await deps.listLeagues()
    : await prisma.league.findMany({
        where: { settings: { path: ['storyline_studio', 'autoPost'], equals: true } },
        select: { id: true, platform: true, settings: true },
      })
  const entitled = deps.entitled ?? storylineEntitled
  const load = deps.load ?? ((id: string) => loadStoryData(prisma, id))
  const post = deps.post ?? postStoryline

  for (const league of leagues) {
    if (deps.budgetMs != null && Date.now() - started > deps.budgetMs) {
      run.budgetStopped = true
      break
    }
    run.leagues += 1
    try {
      const s = readStorylineSettings(league.settings)
      if (!isNativePlatform(league.platform)) {
        run.refused += 1
        continue
      }
      if (!isAutoPostDue(s, now)) {
        run.notDue += 1
        continue
      }
      if (!s.enabledByUserId || !(await entitled(s.enabledByUserId))) {
        run.notEntitled += 1
        continue
      }
      const loaded = await load(league.id)
      if (!loaded || loaded.data.week == null) {
        run.nothingToSay += 1
        continue
      }
      const { data } = loaded
      const key = storylineWeekKey(data.season, data.week!)
      if (s.posted[key]) {
        run.alreadyPosted += 1
        continue
      }
      const hook = topHook(buildWeeklyHooks(data, 'en'))
      if (!hook) {
        run.nothingToSay += 1
        continue
      }
      if (deps.dryRun) {
        run.posted += 1
        continue
      }
      const result = await post({
        leagueId: league.id,
        userId: s.enabledByUserId,
        text: hook.text,
        hook,
        matchupId: hook.matchup?.matchupId ?? null,
        includePoll: s.includePoll,
        messageId: autoPostMessageId(league.id, data.season, data.week!),
        auto: true,
      })
      if (!result.ok) {
        if (result.error === 'forbidden' || result.error === 'imported') run.refused += 1
        else run.errors.push({ leagueId: league.id, error: result.error })
      } else if (result.created) run.posted += 1
      else run.alreadyPosted += 1
    } catch (e) {
      run.errors.push({ leagueId: league.id, error: (e instanceof Error ? e.message : String(e)).slice(0, 160) })
    }
  }
  return run
}
