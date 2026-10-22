import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import {
  appendEntry,
  isPublic,
  PUBLIC_KEY,
  publicReputation,
  RATING_QUESTIONS,
  RATINGS_KEY,
  readEntries,
  summarize,
  validateRatings,
  type PublicReputation,
  type Summary,
} from './reputation'

/**
 * Commish reputation — reads and writes. Rules in ./reputation.
 *
 * The head commissioner is `League.userId` (the AllFantasy owner; see lib/league/permissions.ts), so
 * "every league this commissioner runs" is `league.findMany({ where: { userId } })`. Ratings stay where
 * they were already stored, in each league's settings, so there is no migration and the existing
 * rate page keeps working.
 *
 * Writes take the league row lock: the old handler read settings, appended, and wrote the whole object
 * back, so two managers rating at once could drop one rating, and the season-end prompt (which also
 * rewrote the whole object) could drop both.
 */

const CACHE_MS = 10 * 60 * 1000
const summaryCache = new Map<string, { at: number; summary: Summary }>()

async function writeSettings(leagueId: string, mutate: (settings: Record<string, unknown>) => Record<string, unknown> | null): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const row = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    if (!row) return false
    const next = mutate({ ...((row.settings as Record<string, unknown> | null) ?? {}) })
    if (!next) return false
    await tx.league.update({ where: { id: leagueId }, data: { settings: next as object } })
    return true
  })
}

/** Ratings across every league this user is head commissioner of. */
export async function commissionerSummary(commissionerUserId: string, opts: { fresh?: boolean } = {}): Promise<Summary> {
  const hit = summaryCache.get(commissionerUserId)
  if (!opts.fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.summary
  const leagues = await prisma.league.findMany({ where: { userId: commissionerUserId }, select: { id: true, settings: true } })
  const summary = summarize(leagues.map((l) => ({ leagueId: l.id, entries: readEntries(l.settings) })))
  summaryCache.set(commissionerUserId, { at: Date.now(), summary })
  return summary
}

/**
 * Public reputation for each listed league whose commissioner opted in on THAT league. Leagues not
 * opted in are absent from the map — the listing shows nothing, not "unrated".
 */
export async function publicReputationForLeagues(leagueIds: readonly string[]): Promise<Map<string, PublicReputation>> {
  const ids = [...new Set(leagueIds)].filter(Boolean)
  const out = new Map<string, PublicReputation>()
  if (ids.length === 0) return out
  const rows = await prisma.league.findMany({ where: { id: { in: ids } }, select: { id: true, userId: true, settings: true } })
  const optedIn = rows.filter((r) => r.userId && isPublic(r.settings))
  const byCommissioner = new Map<string, Summary>()
  for (const commissioner of [...new Set(optedIn.map((r) => r.userId))]) byCommissioner.set(commissioner, await commissionerSummary(commissioner))
  for (const r of optedIn) out.set(r.id, publicReputation(byCommissioner.get(r.userId)!))
  return out
}

export type SubmitError = 'not_found' | 'not_member' | 'self' | 'duplicate' | 'ratings_required' | `invalid_${string}`

export async function submitRating(
  leagueId: string,
  userId: string,
  body: { ratings?: unknown; comment?: unknown },
  now = new Date(),
): Promise<{ ok: true } | { ok: false; error: SubmitError }> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, season: true } })
  if (!league) return { ok: false, error: 'not_found' }
  if (league.userId === userId) return { ok: false, error: 'self' }
  // Only managers of this league rate its commissioner. The old handler took any signed-in user.
  const membership = await resolveLeagueMembership(leagueId, userId)
  if (!membership.ok) return { ok: false, error: 'not_member' }
  const valid = validateRatings(body.ratings)
  if (!valid.ok) return { ok: false, error: valid.error }
  const comment = typeof body.comment === 'string' && body.comment.trim() ? body.comment.trim().slice(0, 500) : null
  const season = league.season ?? now.getFullYear()

  let duplicate = false
  const written = await writeSettings(leagueId, (settings) => {
    const entries = readEntries(settings)
    if (entries.some((e) => e.userId === userId && e.season === season)) {
      duplicate = true
      return null
    }
    const store = { ...((settings[RATINGS_KEY] as Record<string, unknown> | undefined) ?? {}), entries: appendEntry(entries, { userId, season, ratings: valid.ratings, comment, submittedAt: now.toISOString() }) }
    return { ...settings, [RATINGS_KEY]: store }
  })
  if (duplicate) return { ok: false, error: 'duplicate' }
  if (!written) return { ok: false, error: 'not_found' }
  summaryCache.delete(league.userId)
  return { ok: true }
}

export async function setReputationPublic(leagueId: string, on: boolean): Promise<boolean> {
  return writeSettings(leagueId, (settings) => {
    if (on) settings[PUBLIC_KEY] = true
    else delete settings[PUBLIC_KEY]
    return settings
  })
}

/** Marks the season-end prompt as sent without overwriting anything written since it was read. */
export async function markRatingPromptSeason(leagueId: string, season: number): Promise<boolean> {
  return writeSettings(leagueId, (settings) => ({ ...settings, last_rating_prompt_season: season }))
}

export type LeagueRatingView = {
  questions: typeof RATING_QUESTIONS
  season: number
  leagueName: string | null
  userSubmitted: boolean
  isCommissioner: boolean
  totalResponses: number
  /** This league, this season — for the commissioner, or a manager who has already rated. */
  averages: Record<string, number> | null
  /** Commissioner only: every league they run, all seasons, plus the public switch for this league. */
  reputation: { summary: Summary; public: PublicReputation; isPublic: boolean } | null
}

export async function readLeagueRatingView(leagueId: string, userId: string): Promise<LeagueRatingView | null> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, season: true, userId: true, name: true } })
  if (!league) return null
  const season = league.season ?? new Date().getFullYear()
  const seasonEntries = readEntries(league.settings).filter((e) => e.season === season)
  const userSubmitted = seasonEntries.some((e) => e.userId === userId)
  const isCommissioner = league.userId === userId
  let averages: Record<string, number> | null = null
  if (isCommissioner || userSubmitted) {
    averages = {}
    for (const q of RATING_QUESTIONS) {
      const vals = seasonEntries.map((e) => e.ratings[q.id]).filter((v) => typeof v === 'number')
      averages[q.id] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
    }
  }
  let reputation: LeagueRatingView['reputation'] = null
  if (isCommissioner) {
    const summary = await commissionerSummary(userId, { fresh: true })
    reputation = { summary, public: publicReputation(summary), isPublic: isPublic(league.settings) }
  }
  return { questions: RATING_QUESTIONS, season, leagueName: league.name, userSubmitted, isCommissioner, totalResponses: seasonEntries.length, averages, reputation }
}
