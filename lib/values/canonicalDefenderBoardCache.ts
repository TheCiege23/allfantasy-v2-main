import type { PrismaClient } from '@prisma/client'

import { loadCanonicalDefenderBoard } from './canonicalDefenderBoard'

/**
 * The canonical defender board, precomputed. A request path reads this; nothing else.
 *
 * 🛑 THE READ PATH NEVER COMPUTES, AND THAT IS A DELIBERATE DEPARTURE FROM THE READ-THROUGH
 * PATTERN THIS REPO OTHERWISE PREFERS. `getFantasyCalcValuesDbFirst` is self-populating because
 * its miss costs ONE HTTP fetch. This board's miss costs **26.7 seconds** measured end to end on
 * production — it projects 5,385 defenders to establish where replacement level sits, and it has
 * to price the whole pool to price anyone. Making that lazy would hand the first visitor after
 * every expiry a 27-second page, or a timeout.
 *
 * So a miss returns null and the caller shows nothing. "No IDP value yet" is a correct and cheap
 * answer; a 27-second wait is neither.
 *
 * ⚠ WHICH MAKES THE SCHEDULED WRITER LOad-BEARING, NOT AN OPTIMISATION. CLAUDE.md records
 * `ingestCFBDStats` existing for months with no scheduled caller, so DevyPlayer stat columns were
 * never current and a surface reading them failed silently while looking correct. A cache nothing
 * refreshes is worse than the live call it replaced. The writer is wired in the SAME change as
 * the reader — `/api/cron/adp-refresh`, beside `ingestPlayerValues`, which is the job that already
 * refreshes player values daily.
 */

/**
 * ⚠ VERSIONED KEY. The board's meaning depends on the reference league and the scoring profile;
 * change either and the cached numbers are answers to a question nobody is asking any more.
 * Bumping `v1` retires them rather than serving them under new labels.
 */
export function canonicalDefenderBoardCacheKey(isDynasty: boolean): string {
  return `af:idp:canonical-board:v1:${isDynasty ? 'dynasty' : 'redraft'}`
}

/** Slightly over a day, so a single missed cron run degrades to stale rather than to empty. */
const TTL_MS = 30 * 60 * 60 * 1000

export interface CachedDefenderBoard {
  /** Sleeper id -> value on the IDP curve, in the same 0–10000 convention the trade engine uses. */
  valueBySleeperId: Record<string, number>
  /** Rank within his own position group, for display. */
  positionRankBySleeperId: Record<string, number>
  reference: { numTeams: number; idpStarters: number; scoringFormat: string }
  coverage: { candidates: number; priced: number }
  computedAt: string
}

/**
 * Recompute the board and store it. Called by the cron, never by a request.
 *
 * Returns what happened rather than throwing: a cron that dies on one sub-job takes its siblings
 * with it, and this one is the least important thing `adp-refresh` does.
 */
export async function refreshCanonicalDefenderBoardCache(args: {
  prisma: PrismaClient
  isDynasty?: boolean
}): Promise<{ ok: true; cached: CachedDefenderBoard } | { ok: false; reason: string }> {
  const isDynasty = args.isDynasty ?? true
  try {
    const board = await loadCanonicalDefenderBoard({ prisma: args.prisma, isDynasty })
    if (board.skipped) return { ok: false, reason: board.skipped }
    if (board.valueBySleeperId.size === 0) return { ok: false, reason: 'no_defender_priced' }

    const cached: CachedDefenderBoard = {
      valueBySleeperId: Object.fromEntries(board.valueBySleeperId),
      positionRankBySleeperId: Object.fromEntries(board.positionRankBySleeperId),
      reference: {
        numTeams: board.reference.numTeams,
        idpStarters: board.reference.idpStarters,
        scoringFormat: board.reference.scoringFormat,
      },
      coverage: { candidates: board.candidates, priced: board.coverage?.priced ?? board.valueBySleeperId.size },
      computedAt: new Date().toISOString(),
    }

    const cacheKey = canonicalDefenderBoardCacheKey(isDynasty)
    const expiresAt = new Date(Date.now() + TTL_MS)
    await args.prisma.sportsDataCache.upsert({
      where: { cacheKey },
      create: { cacheKey, expiresAt, data: cached as unknown as object },
      update: { expiresAt, data: cached as unknown as object },
    })
    return { ok: true, cached }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 120) : 'unknown' }
  }
}

/**
 * Read the stored board. Null means "not computed yet or expired" — NOT "this player is worthless".
 *
 * ⚠ AN EXPIRED ROW IS TREATED AS ABSENT rather than served stale-with-a-warning, because the
 * caller has no way to render "these numbers are three weeks old" usefully and a silently ancient
 * board is the failure mode this whole area keeps hitting.
 */
export async function readCanonicalDefenderBoard(args: {
  prisma: PrismaClient
  isDynasty?: boolean
}): Promise<CachedDefenderBoard | null> {
  const cacheKey = canonicalDefenderBoardCacheKey(args.isDynasty ?? true)
  const row = await args.prisma.sportsDataCache
    .findUnique({ where: { cacheKey }, select: { data: true, expiresAt: true } })
    .catch(() => null)
  if (!row) return null
  if (row.expiresAt.getTime() <= Date.now()) return null

  const data = row.data as unknown as CachedDefenderBoard | null
  if (!data || typeof data !== 'object' || !data.valueBySleeperId) return null
  return data
}

export interface CanonicalDefenderValue {
  value: number
  positionRank: number | null
  reference: CachedDefenderBoard['reference']
  computedAt: string
}

/**
 * One defender's canonical value, or null.
 *
 * ⚠ THE REFERENCE COMES BACK WITH IT, ALWAYS. "Worth 3,284" is not a fact about the world; it is
 * a fact about a 12-team league starting three defenders under Balanced scoring. A caller that
 * renders the number without the league is making a claim the board cannot support — so the type
 * makes the reference impossible to drop by accident.
 */
export async function getCanonicalDefenderValue(args: {
  prisma: PrismaClient
  sleeperId: string | null | undefined
  isDynasty?: boolean
}): Promise<CanonicalDefenderValue | null> {
  if (!args.sleeperId) return null
  const board = await readCanonicalDefenderBoard({ prisma: args.prisma, isDynasty: args.isDynasty })
  if (!board) return null
  const value = board.valueBySleeperId[args.sleeperId]
  if (typeof value !== 'number') return null
  return {
    value,
    positionRank: board.positionRankBySleeperId[args.sleeperId] ?? null,
    reference: board.reference,
    computedAt: board.computedAt,
  }
}
