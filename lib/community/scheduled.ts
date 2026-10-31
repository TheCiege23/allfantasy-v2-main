import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { GAME_DAY_CHANNEL, SPORT_TAGS } from './channels'
import {
  NEWS_DESK_EARLIEST_ET_HOUR,
  easternDate,
  easternDayBoundsUtc,
  easternDayLabel,
  easternHour,
  systemKeys,
  weeklyPromptFor,
} from './schedule'
import { staffEmailSet } from './service'

/**
 * Threads the Clubhouse writes itself: the weekly prompt, the daily news desk, and the
 * game-day room. Every one is keyed by `systemKey` and written through `ensureSystemPost`,
 * so any number of runs on any number of replicas produce one thread per key.
 *
 * Reads only Postgres. The news desk is built from `player_news`, which the import-news
 * cron keeps fresh; nothing here calls a provider.
 */

export type EnsureResult =
  | { status: 'created' | 'exists'; postId: string }
  | { status: 'skipped'; reason: string }

/**
 * The account system threads are posted as: the first `ADMIN_EMAILS` address that has an
 * AppUser, in the order listed. A thread needs a real author row, and posting as the
 * founder is honest — these are the founder's prompts.
 */
export async function resolveSystemAuthorId(): Promise<string | null> {
  const emails = Array.from(staffEmailSet())
  if (emails.length === 0) return null
  const users = await prisma.appUser.findMany({
    where: { OR: emails.map((e) => ({ email: { equals: e, mode: 'insensitive' as const } })) },
    select: { id: true, email: true },
  })
  const byEmail = new Map(users.map((u) => [u.email?.toLowerCase() ?? '', u.id]))
  for (const e of emails) {
    const id = byEmail.get(e)
    if (id) return id
  }
  return null
}

export async function ensureSystemPost(args: {
  key: string
  authorUserId: string
  channel: string
  title: string
  body: string
  tags?: string[]
  pin?: boolean
}): Promise<{ status: 'created' | 'exists'; postId: string }> {
  const existing = await prisma.communityPost.findUnique({ where: { systemKey: args.key }, select: { id: true } })
  if (existing) return { status: 'exists', postId: existing.id }
  try {
    const post = await prisma.communityPost.create({
      data: {
        systemKey: args.key,
        authorUserId: args.authorUserId,
        channel: args.channel,
        title: args.title.slice(0, 160),
        body: args.body,
        tags: args.tags ?? [],
        isPinned: args.pin ?? false,
      },
      select: { id: true },
    })
    return { status: 'created', postId: post.id }
  } catch (err) {
    // Another run won the race between our read and our write: theirs is the thread.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await prisma.communityPost.findUnique({ where: { systemKey: args.key }, select: { id: true } })
      if (winner) return { status: 'exists', postId: winner.id }
    }
    throw err
  }
}

// ─── weekly prompt ───────────────────────────────────────────────────────────

/** Posts this week's prompt, pinned, and unpins earlier prompts so only one is up. */
export async function ensureWeeklyPrompt(now: Date, authorUserId: string): Promise<EnsureResult> {
  const { prompt, weekStart } = weeklyPromptFor(now)
  const key = systemKeys.weeklyPrompt(weekStart)
  const result = await ensureSystemPost({
    key,
    authorUserId,
    channel: prompt.channel,
    title: `Weekly prompt: ${prompt.title}`,
    body: `${prompt.body}\n\nA new prompt goes up every Monday. Reply below.`,
    pin: true,
  })
  await prisma.communityPost.updateMany({
    where: { systemKey: { startsWith: 'prompt:', not: key }, isPinned: true },
    data: { isPinned: false },
  })
  return result
}

// ─── news desk ───────────────────────────────────────────────────────────────

export const NEWS_DESK_MAX_ITEMS = 12
const NEWS_WINDOW_MS = 24 * 60 * 60 * 1000

export type NewsDeskItem = {
  sport: string
  playerName: string
  team: string | null
  headline: string
  impact: string
  fantasyRelevant: boolean
  source: string
  publishedAt: Date
}

const IMPACT_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

/**
 * Most newsworthy first: fantasy-relevant before not, high impact before low, then newest.
 * One story per (player, headline) — the importer stores the same story from each feed.
 */
export function pickNewsDeskItems(rows: NewsDeskItem[], max = NEWS_DESK_MAX_ITEMS): NewsDeskItem[] {
  const seen = new Set<string>()
  const sorted = [...rows].sort(
    (a, b) =>
      Number(b.fantasyRelevant) - Number(a.fantasyRelevant) ||
      (IMPACT_RANK[a.impact] ?? 3) - (IMPACT_RANK[b.impact] ?? 3) ||
      b.publishedAt.getTime() - a.publishedAt.getTime(),
  )
  const out: NewsDeskItem[] = []
  for (const r of sorted) {
    const k = `${r.playerName.toLowerCase()}|${r.headline.toLowerCase().replace(/\s+/g, ' ').trim()}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(r)
    if (out.length >= max) break
  }
  return out
}

export function newsDeskBody(items: NewsDeskItem[]): string {
  const lines = items.map((i) => {
    const who = i.team ? `${i.playerName} (${i.team})` : i.playerName
    const flag = i.impact === 'high' ? ' 🔺' : ''
    return `• [${i.sport}] ${who}: ${i.headline}${flag}`
  })
  return [
    "The last 24 hours of player news, most fantasy-relevant first. What's the move? Reply with your take.",
    '',
    ...lines,
    '',
    '🔺 = high impact. Headlines come from AllFantasy’s news feed.',
  ].join('\n')
}

export async function ensureNewsDesk(now: Date, authorUserId: string): Promise<EnsureResult> {
  const day = easternDate(now)
  const key = systemKeys.newsDesk(day)
  const existing = await prisma.communityPost.findUnique({ where: { systemKey: key }, select: { id: true } })
  if (existing) return { status: 'exists', postId: existing.id }
  if (easternHour(now) < NEWS_DESK_EARLIEST_ET_HOUR) {
    return { status: 'skipped', reason: `news desk waits until ${NEWS_DESK_EARLIEST_ET_HOUR}:00 ET` }
  }

  const rows = await prisma.playerNewsRecord.findMany({
    where: { publishedAt: { gte: new Date(now.getTime() - NEWS_WINDOW_MS), lte: now } },
    orderBy: { publishedAt: 'desc' },
    take: 200,
    select: {
      sport: true,
      playerName: true,
      team: true,
      headline: true,
      impact: true,
      fantasyRelevant: true,
      source: true,
      publishedAt: true,
    },
  })
  const items = pickNewsDeskItems(rows)
  // An empty thread is worse than no thread: it reads as "nothing happened" when the feed
  // may simply be stale. Skip, and let the run report why.
  if (items.length === 0) return { status: 'skipped', reason: 'no player news in the last 24h' }

  const known = new Set<string>(SPORT_TAGS)
  const tags = Array.from(new Set(items.map((i) => i.sport.toUpperCase()).filter((s) => known.has(s)))).slice(0, 3)
  return ensureSystemPost({
    key,
    authorUserId,
    channel: 'sports-news',
    title: `News desk: ${easternDayLabel(day)}`,
    body: newsDeskBody(items),
    tags,
  })
}

// ─── game day ────────────────────────────────────────────────────────────────

export async function ensureGameDayRoom(now: Date, authorUserId: string): Promise<EnsureResult> {
  const day = easternDate(now)
  return ensureSystemPost({
    key: systemKeys.gameDay(day),
    authorUserId,
    channel: GAME_DAY_CHANNEL,
    title: `Game day chat: ${easternDayLabel(day)}`,
    body: "Today's live room. Talk about the games as they happen: big plays, bad beats, lineup regrets. Keep it friendly.",
  })
}

/** Today's room id, created on first visit if the cron has not made it yet. Null without a system author. */
export async function todayGameDayPostId(now = new Date()): Promise<string | null> {
  const existing = await prisma.communityPost.findUnique({
    where: { systemKey: systemKeys.gameDay(easternDate(now)) },
    select: { id: true, removedAt: true },
  })
  if (existing) return existing.removedAt ? null : existing.id
  const author = await resolveSystemAuthorId()
  if (!author) return null
  const result = await ensureGameDayRoom(now, author)
  return result.status === 'skipped' ? null : result.postId
}

export type SlateGame = {
  key: string
  sport: string
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  status: string | null
  startTime: string | null
}

const SLATE_SPORTS = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER']

type SlateRow = {
  sport: string
  externalId: string
  source: string
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  status: string | null
  startTime: Date | null
  fetchedAt: Date
}

/**
 * Today's games, one row per game. Several sources write the same game and they do not
 * agree on team names ("KC" vs "Kansas City Chiefs"), so rows cannot be merged on teams.
 * Instead each sport is read from ONE source — whichever fetched most recently today —
 * and de-duplicated on that source's own `externalId`.
 */
export function mergeSlate(rows: SlateRow[]): SlateGame[] {
  const freshest = new Map<string, SlateRow>()
  for (const r of rows) {
    const prev = freshest.get(r.sport)
    if (!prev || r.fetchedAt > prev.fetchedAt) freshest.set(r.sport, r)
  }
  const seen = new Set<string>()
  const out: SlateGame[] = []
  for (const r of rows) {
    if (freshest.get(r.sport)?.source !== r.source) continue
    const key = `${r.sport}|${r.source}|${r.externalId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      key,
      sport: r.sport,
      homeTeam: r.homeTeam,
      awayTeam: r.awayTeam,
      homeScore: r.homeScore,
      awayScore: r.awayScore,
      status: r.status,
      startTime: r.startTime?.toISOString() ?? null,
    })
  }
  return out.sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.sport.localeCompare(b.sport))
}

export async function getGameDaySlate(now = new Date()): Promise<SlateGame[]> {
  const { start, end } = easternDayBoundsUtc(easternDate(now))
  const rows = await prisma.sportsGame.findMany({
    where: { sport: { in: SLATE_SPORTS }, startTime: { gte: start, lt: end } },
    orderBy: { startTime: 'asc' },
    take: 300,
    select: {
      sport: true,
      externalId: true,
      source: true,
      homeTeam: true,
      awayTeam: true,
      homeScore: true,
      awayScore: true,
      status: true,
      startTime: true,
      fetchedAt: true,
    },
  })
  return mergeSlate(rows).slice(0, 80)
}

// ─── the daily run ───────────────────────────────────────────────────────────

export const CLUBHOUSE_SCHEDULE_JOB = 'cron-clubhouse-schedule'

export type ScheduleOutcome = { prompt: EnsureResult; news: EnsureResult; gameDay: EnsureResult }

const NO_AUTHOR: EnsureResult = {
  status: 'skipped',
  reason: 'no system author: no ADMIN_EMAILS address matches an AllFantasy account',
}

async function runStep(fn: () => Promise<EnsureResult>): Promise<EnsureResult> {
  try {
    return await fn()
  } catch (err) {
    // One failed thread must not stop the other two.
    return { status: 'skipped', reason: `error: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}` }
  }
}

export async function runClubhouseSchedule(now = new Date()): Promise<ScheduleOutcome> {
  const author = await resolveSystemAuthorId()
  if (!author) return { prompt: NO_AUTHOR, news: NO_AUTHOR, gameDay: NO_AUTHOR }
  const [prompt, news, gameDay] = await Promise.all([
    runStep(() => ensureWeeklyPrompt(now, author)),
    runStep(() => ensureNewsDesk(now, author)),
    runStep(() => ensureGameDayRoom(now, author)),
  ])
  return { prompt, news, gameDay }
}

/** Shapes a run for `sync_job_runs`: a missing thread with a reason is a warning, a thrown one an error. */
export function summarizeSchedule(o: ScheduleOutcome) {
  const all = [o.prompt, o.news, o.gameDay]
  const skipped = all.flatMap((r) => (r.status === 'skipped' ? [r.reason] : []))
  return {
    rowsWritten: all.filter((r) => r.status === 'created').length,
    errors: skipped.filter((r) => r.startsWith('error:')),
    warnings: skipped.filter((r) => !r.startsWith('error:')),
    metadata: { ...o },
  }
}
