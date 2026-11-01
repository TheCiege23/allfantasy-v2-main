import 'server-only'

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import type { RunBudget } from '@/lib/cron/runBudget'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { listSportsAlertAudience } from '@/lib/notifications/sportAudience'
import { isClickbait, newsDeliveryKey } from '@/lib/news/newsroomFilter'
import { getTeamIndex, isTeamFollowSport, listFollowerIdsForTeam, listTeamsForSport } from '@/lib/follows/teamFollows'
import { resolveTeam } from '@/lib/follows/teamResolver'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import {
  breakingAlertTitle,
  breakingStoryKey,
  classifyBreakingHeadline,
  isCollegeStoryForProSport,
  teamsMentioned,
  trustedOutlet,
  type BreakingClassification,
} from '@/lib/news/breakingNews'

/**
 * Sports-news alerts: every fresh trusted story that qualifies for the admin newsroom
 * reaches the sport audience by push and in-app within one cron tick of landing in `sports_news`.
 *
 * WHY THIS EXISTS. `notification-engine.ts` had a `breaking_news` type and a `breakingNews()`
 * factory that nothing called, and the player-news sender (PlayerNewsNotificationService) only
 * reaches managers who roster the player or follow him or his team. So a headline trade — measured
 * case: Marvin Harrison Jr., Cardinals → Texans — sent nothing to anyone who did not already follow
 * one of the three. This is the sport-wide path.
 *
 * Everyone who plays the sport, plus followers of named teams, receives each story.
 * The category remains `breaking_news` for existing settings compatibility and is labelled
 * "Sports news" in the settings UI. The editorial clickbait filter is shared with the admin page.
 * PUSH + BELL ONLY, never email or text (owner's call, 2026-10-25): after the player-news fix it was
 * the biggest email type left — 176 emails to 43 people in two and a half days, up to 5 a day each.
 *
 * DB-FIRST: reads `sports_news` only. The cron that calls this refreshes ESPN news first.
 *
 * ⚠ FRESH STORIES ONLY. A story published more than FRESH_WINDOW_MS ago is history: a cron outage
 * or a first deploy must not blast yesterday's trades. And the same event reported by two outlets
 * is ONE alert — `breakingStoryKey` is claimed in `SportsDataCache` (primary key) before sending,
 * so concurrent runs cannot both send it either.
 */

/** @deprecated Kept for import compatibility; newsroom alerts are no longer daily-capped. */
export const BREAKING_NEWS_PER_DAY = 4
const FRESH_WINDOW_MS = 3 * 60 * 60 * 1000
const LEDGER_TTL_MS = 3 * 24 * 60 * 60 * 1000
/** The admin newsroom displays at most 60 stories; this sender uses the same bound. */
const MAX_STORIES_PER_RUN = 60

type NewsRow = {
  id: string
  sport: string
  title: string
  description: string | null
  source: string
  sourceUrl: string | null
  team: string | null
  publishedAt: Date | null
  fetchedAt: Date
}

export type BreakingCandidate = {
  row: NewsRow
  classification: BreakingClassification | null
  outlet: { host: string; name: string; handle: string | null }
  teams: string[]
  storyKey: string
}

/** The teams a story names: nickname scan for the pros, the article's own team field for college. */
async function teamsForStory(row: NewsRow): Promise<string[]> {
  const sport = row.sport.toUpperCase()
  if (!isTeamFollowSport(sport)) return []
  if (sport === 'NCAAF' || sport === 'NCAAB') {
    const index = await getTeamIndex(sport)
    const t = index && row.team ? resolveTeam(index, row.team) : null
    return t ? [t] : []
  }
  const teams = await listTeamsForSport(sport)
  return teamsMentioned(row.title, teams)
}

/** Fresh newsroom stories — classified and keyed, not yet claimed. */
export async function findBreakingCandidates(now: Date = new Date()): Promise<BreakingCandidate[]> {
  const since = new Date(now.getTime() - FRESH_WINDOW_MS)
  const rows = (await prisma.sportsNews
    .findMany({
      where: {
        sport: { in: [...SUPPORTED_SPORTS] },
        OR: [{ publishedAt: { gte: since } }, { publishedAt: null, fetchedAt: { gte: since } }],
      },
      orderBy: [{ publishedAt: 'desc' }],
      take: 400,
      select: {
        id: true,
        sport: true,
        title: true,
        description: true,
        source: true,
        sourceUrl: true,
        team: true,
        publishedAt: true,
        fetchedAt: true,
      },
    })
    .catch(() => [])) as NewsRow[]

  const out: BreakingCandidate[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    // A future-dated row is a provider clock error, not news from the future.
    const at = row.publishedAt ?? row.fetchedAt
    if (at.getTime() > now.getTime() + 10 * 60 * 1000) continue
    // A college story stored under a pro league would push to everyone who plays that league.
    if (isCollegeStoryForProSport(row.sport, row.sourceUrl)) continue
    if (isClickbait(row.title)) continue
    const classification = classifyBreakingHeadline(row.title, row.description)
    const outlet = trustedOutlet(row.sourceUrl)
    if (!outlet) continue
    const teams = await teamsForStory(row)
    const storyKey = classification
      ? breakingStoryKey({ sport: row.sport.toUpperCase(), kind: classification.kind, teams, title: row.title, publishedAt: at })
      : newsDeliveryKey(row.sport, row.title, at)
    if (seen.has(storyKey)) continue
    seen.add(storyKey)
    out.push({ row, classification, outlet, teams, storyKey })
  }
  return out.sort((a, b) => Number(!!b.classification) - Number(!!a.classification) ||
    (b.row.publishedAt ?? b.row.fetchedAt).getTime() - (a.row.publishedAt ?? a.row.fetchedAt).getTime()).slice(0, MAX_STORIES_PER_RUN)
}

/** Claim one story so no other run sends it. false = already sent. */
async function claimStory(key: string, row: NewsRow, now: Date): Promise<boolean> {
  try {
    await prisma.sportsDataCache.create({
      data: {
        cacheKey: key,
        expiresAt: new Date(now.getTime() + LEDGER_TTL_MS),
        data: { sentAt: now.toISOString(), newsId: row.id, title: row.title } as Prisma.InputJsonValue,
      },
    })
    return true
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false
    throw err
  }
}

export async function dispatchBreakingNewsAlerts(input: { now?: Date; budget?: RunBudget } = {}): Promise<{
  candidates: number
  sent: number
  alreadySent: number
  recipients: number
  capped: number
  stories: Array<{ sport: string; kind: string; tier: string; title: string; recipients: number }>
}> {
  const now = input.now ?? new Date()
  const out = { candidates: 0, sent: 0, alreadySent: 0, recipients: 0, capped: 0, stories: [] as Array<{ sport: string; kind: string; tier: string; title: string; recipients: number }> }

  const candidates = await findBreakingCandidates(now)
  out.candidates = candidates.length

  for (const c of candidates) {
    if (input.budget?.exhausted()) break
    const sport = c.row.sport.toUpperCase()

    const audience = new Set<string>()
    for (const team of c.teams) {
      for (const id of (await listFollowerIdsForTeam(sport, team).catch(() => null)) ?? []) audience.add(id)
    }
    for (const id of await listSportsAlertAudience(sport)) audience.add(id)
    if (audience.size === 0) continue

    if (!(await claimStory(c.storyKey, c.row, now).catch(() => false))) {
      out.alreadySent++
      continue
    }

    const allowed = [...audience]
    if (allowed.length === 0) continue

    const title = c.classification ? breakingAlertTitle(sport, c.classification) : `${sport} news`
    const body = `${c.row.title} — via ${c.outlet.name}`
    const deliveryKey = newsDeliveryKey(sport, c.row.title, c.row.publishedAt ?? c.row.fetchedAt)
    const dispatched = await dispatchNotification({
      userIds: allowed,
      category: 'breaking_news',
      type: c.classification ? 'breaking_news' : 'sports_news',
      title,
      body,
      actionHref: c.row.sourceUrl ?? undefined,
      actionLabel: `Read on ${c.outlet.name}`,
      leagueId: null,
      severity: c.classification?.tier === 'major' ? 'high' : 'medium',
      dedupePrefix: deliveryKey,
      skipChannels: { email: true, sms: true },
      meta: {
        sport,
        eventKey: deliveryKey,
        occurredAt: (c.row.publishedAt ?? c.row.fetchedAt).toISOString(),
        detectedAt: now.toISOString(),
        kind: c.classification?.kind ?? 'news',
        tier: c.classification?.tier ?? 'notable',
        confidence: c.classification?.confidence ?? null,
        teams: c.teams,
        source: c.outlet.name,
        sourceUrl: c.row.sourceUrl,
        newsId: c.row.id,
      },
    }).catch(async (err) => {
      await prisma.sportsDataCache.delete({ where: { cacheKey: c.storyKey } })
      throw err
    })
    if (dispatched && dispatched.failed > 0) {
      await prisma.sportsDataCache.delete({ where: { cacheKey: c.storyKey } })
      throw new Error('Breaking news recipient dispatch incomplete; retry on next tick')
    }
    out.sent++
    out.recipients += allowed.length
    out.stories.push({ sport, kind: c.classification?.kind ?? 'news', tier: c.classification?.tier ?? 'notable', title: c.row.title, recipients: allowed.length })
  }
  return out
}
