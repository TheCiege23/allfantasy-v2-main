/**
 * The season recap, stored with the league's history and announced to its members.
 *
 * WHERE IT LIVES. One `LeagueStoryline` row per league and season, `storyType = 'season_recap'`, the
 * recap JSON in `metadata`. That table already holds a league's season-scoped history documents (the
 * constitution, weekly storylines) keyed by league and season, and it outlives the rollover: renewal
 * creates a new `RedraftSeason`, it never touches a storyline. No new table and no migration.
 * `LeagueSeason.teamRecords` was the other candidate and was rejected: it is an ARRAY that four readers
 * index as the standings, so a recap key cannot be added to it without changing what they read.
 * Every existing storyline reader filters on its own `storyType`, so a recap row is invisible to them.
 *
 * WHEN. The finalize chain (lib/redraft/offseason/finalizeSeasonAndEnterOffseason.ts) calls
 * `publishSeasonRecap` once the champion is crowned and the season archived. Idempotent: a re-finalize
 * recomputes and overwrites the same row, and the members' notice carries a per-season idempotency key,
 * so it is sent once.
 *
 * FREE. The recap is computed from stored data with no AI call; see the PR for the AF Commish add-on
 * (AI-written recap text) proposed on top of it.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { computeSeasonRecap, seasonRecapHeadline, SEASON_RECAP_VERSION, type SeasonRecap } from './computeSeasonRecap'
import { loadSeasonRecapInput } from './loadSeasonRecapInput'

export const SEASON_RECAP_STORY_TYPE = 'season_recap'

/** The league's History tab, opened on that season's recap (no new page: see the route note). */
export function seasonRecapHref(leagueId: string, season: number): string {
  return `/league/${encodeURIComponent(leagueId)}?view=history&recap=${season}`
}

function isRecap(value: unknown, leagueId: string, season: number): value is SeasonRecap {
  const v = value as Partial<SeasonRecap> | null
  return !!v && typeof v === 'object' && v.leagueId === leagueId && v.season === season && typeof v.version === 'number' && Array.isArray(v.teamLines)
}

/** The stored recap, or null when none has been published for that season. */
export async function readStoredSeasonRecap(leagueId: string, season: number): Promise<SeasonRecap | null> {
  const row = await prisma.leagueStoryline.findFirst({
    where: { leagueId, storyType: SEASON_RECAP_STORY_TYPE, season },
    orderBy: { updatedAt: 'desc' },
    select: { metadata: true },
  })
  return row && isRecap(row.metadata, leagueId, season) ? row.metadata : null
}

/**
 * The recap for a page: the stored one, else computed on the spot WITHOUT storing it (a finished
 * season finalized before recaps existed still gets a page). `stored` says which.
 */
export async function getSeasonRecap(leagueId: string, season: number): Promise<{ recap: SeasonRecap; stored: boolean } | null> {
  const stored = await readStoredSeasonRecap(leagueId, season)
  if (stored) return { recap: stored, stored: true }
  const input = await loadSeasonRecapInput(leagueId, season)
  return input ? { recap: computeSeasonRecap(input), stored: false } : null
}

export type PublishSeasonRecapResult =
  | { ok: true; recap: SeasonRecap; created: boolean; notified: boolean }
  | { ok: false; reason: 'season_not_found' }

/**
 * Compute, store and announce. `notify: false` skips the members' notice (a repair run).
 * The notice goes through the notification engine, which applies each member's settings; tests inject
 * `deps.notify` and never reach a real transport.
 */
export async function publishSeasonRecap(
  leagueId: string,
  season: number,
  opts: { notify?: boolean; deps?: { notify?: (recap: SeasonRecap, userIds: string[]) => Promise<boolean> } } = {},
): Promise<PublishSeasonRecapResult> {
  const input = await loadSeasonRecapInput(leagueId, season)
  if (!input) return { ok: false, reason: 'season_not_found' }
  const recap = computeSeasonRecap(input)
  const headline = seasonRecapHeadline(recap)
  const data = {
    title: `${season} season recap`.slice(0, 160),
    summary: headline,
    metadata: recap as unknown as Prisma.InputJsonValue,
    source: 'engine',
  }
  const existing = await prisma.leagueStoryline.findFirst({
    where: { leagueId, storyType: SEASON_RECAP_STORY_TYPE, season },
    select: { id: true },
  })
  if (existing) await prisma.leagueStoryline.update({ where: { id: existing.id }, data })
  else await prisma.leagueStoryline.create({ data: { leagueId, season, storyType: SEASON_RECAP_STORY_TYPE, ...data } })

  let notified = false
  if (opts.notify !== false) {
    // The season's managers, by app user id: a native league's `LeagueTeam` claims can be sparse, so the
    // engine's own member lookup alone would miss most of the league.
    const userIds = [...new Set(input.teams.map((t) => t.ownerId).filter((id): id is string => !!id && !id.startsWith('orphan-') && !id.startsWith('open-slot-')))]
    notified = await (opts.deps?.notify ?? notifySeasonRecapReady)(recap, userIds).catch(() => false)
  }
  return { ok: true, recap, created: !existing, notified }
}

/** "Your 2026 season recap is ready" to every member, once per league and season. */
export async function notifySeasonRecapReady(recap: SeasonRecap, userIds: string[] = []): Promise<boolean> {
  const { ingest } = await import('@/lib/notification-engine')
  const result = await ingest({
    // Empty → the engine resolves the league's members itself.
    ...(userIds.length > 0 ? { userIds } : {}),
    type: 'storyline_generated',
    title: `Your ${recap.season} season recap is ready`,
    body: `${seasonRecapHeadline(recap)}. See the final standings and the season's awards.`,
    leagueId: recap.leagueId,
    actionHref: seasonRecapHref(recap.leagueId, recap.season),
    actionLabel: 'View recap',
    meta: { idempotencyKey: `season-recap:${recap.leagueId}:${recap.season}:v${SEASON_RECAP_VERSION}`, season: recap.season },
    source: 'season-recap',
  })
  return result.dispatched
}
