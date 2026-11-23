import type { DraftNoticeResult } from '@/lib/league/collegePro/draftNotices'
import { prisma } from '@/lib/prisma'
import { getCFBDraftPicksResult } from '@/lib/cfb-player-data'
import { describeCfbdFailure } from '@/lib/cfbd-fetch'

/**
 * The NFL draft as CFBD records it, keyed by the drafted player's COLLEGE athlete id.
 *
 * WHY. A C2C / Devy league moves a player from a manager's college roster to their NFL roster once
 * he is drafted, and fills a shortened rookie draft with the rookies nobody held in college. Both
 * questions need "was this college player drafted", and nothing answered it:
 * - `DevyPlayer` had zero drafted rows (measured 2026-11-21: 7,291 rows, all college/declared).
 * - `classifyDraftStatus` matches draft picks to players BY NAME.
 * - College and NFL identity rows are separate rows per sport, with no link between them.
 *
 * CFBD's `/draft/picks` carries `collegeAthleteId`, the same id `PlayerIdentityMap.cfbdId` holds for
 * a college player, so the link needs no name matching at all.
 *
 * Shared contract with the C2C roster page (lib/league/collegePro/pipeline.ts): one
 * `sportsDataCache` row per draft year under `cfbd:draft-picks:v1:<year>`, holding
 * `{ year, fetchedAt, picks: StoredDraftPick[] }`. Only picks that carry an athlete id are kept.
 *
 * COST. One CFBD call per draft year, at most once a day, and every six hours across the draft
 * window. Callers gate it behind the CFBD quota reserve (lib/cfbd-quota.ts) with the other
 * background devy jobs.
 */

export const CFBD_DRAFT_PICKS_KEY_PREFIX = 'cfbd:draft-picks:v1:'

export type StoredDraftPick = {
  collegeAthleteId: string
  name: string
  position: string
  collegeTeam: string
  nflTeam: string
  round: number
  pick: number
  overall: number
}

export type StoredDraftPicks = { year: number; fetchedAt: string; picks: StoredDraftPick[] }

const DAY_MS = 24 * 60 * 60 * 1000
const DRAFT_WINDOW_MS = 6 * 60 * 60 * 1000

/**
 * The most recent NFL draft: this year's from May on, last year's before. The draft is held in late
 * April; May is the first month its results are complete.
 */
export function latestDraftYear(now: Date): number {
  return now.getUTCMonth() >= 4 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
}

/** Late April into mid-May: picks are being made or corrected, so refresh more often. */
export function inDraftWindow(now: Date): boolean {
  const m = now.getUTCMonth()
  const d = now.getUTCDate()
  return (m === 3 && d >= 20) || (m === 4 && d <= 15)
}

/** Pure: CFBD's picks -> what is stored. A pick with no athlete id cannot be linked, so it is dropped. */
export function toStoredPicks(
  picks: ReadonlyArray<{ collegeAthleteId?: string | null; playerName: string; position: string; collegeTeam: string; nflTeam: string; round: number; pick: number; overallPick: number }>,
): StoredDraftPick[] {
  const out: StoredDraftPick[] = []
  for (const p of picks) {
    if (!p.collegeAthleteId) continue
    out.push({
      collegeAthleteId: p.collegeAthleteId,
      name: p.playerName,
      position: p.position,
      collegeTeam: p.collegeTeam,
      nflTeam: p.nflTeam,
      round: p.round,
      pick: p.pick,
      overall: p.overallPick,
    })
  }
  return out
}

export type DraftPicksRefresh =
  | { year: number; stored: number; droppedWithoutAthleteId: number; notified: DraftNoticeResult | null }
  | { year: number; skipped: string }
  | { year: number; error: string }

/**
 * Fetch and store the latest draft's picks when due. In the draft window the draft being made this
 * spring is refreshed too, so picks appear as they happen.
 */
export async function refreshCfbdDraftPicks(now = new Date()): Promise<DraftPicksRefresh> {
  const year = inDraftWindow(now) ? now.getUTCFullYear() : latestDraftYear(now)
  const key = `${CFBD_DRAFT_PICKS_KEY_PREFIX}${year}`
  const cadence = inDraftWindow(now) ? DRAFT_WINDOW_MS : DAY_MS

  const existing = await prisma.sportsDataCache.findUnique({ where: { cacheKey: key }, select: { data: true } }).catch(() => null)
  const fetchedAt = (existing?.data as { fetchedAt?: unknown } | null)?.fetchedAt
  if (typeof fetchedAt === 'string' && now.getTime() - Date.parse(fetchedAt) < cadence) {
    return { year, skipped: 'within cadence' }
  }

  const res = await getCFBDraftPicksResult(year)
  // ⚠ A refused call writes NOTHING: the previous year's stored picks stand. Writing an empty list
  // would tell the roster page that nobody was drafted.
  if (!res.ok) return { year, error: describeCfbdFailure(res.failure) }

  const picks = toStoredPicks(res.data)
  const data: StoredDraftPicks = { year, fetchedAt: now.toISOString(), picks }
  // Kept two years: the roster page reads the latest draft, and last spring's still matters in May.
  const expiresAt = new Date(now.getTime() + 2 * 365 * DAY_MS)
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: key },
    create: { cacheKey: key, data: data as never, expiresAt },
    update: { data: data as never, expiresAt },
  })
  const notified = await notifyPairedLeagues('NCAAF', year, existing?.data, picks, now)
  return { year, stored: picks.length, droppedWithoutAthleteId: res.data.length - picks.length, notified }
}

/**
 * After a write: tell paired college + pro leagues about picks this write ADDED (draftNotices.ts).
 * Never throws — a notice failing must not undo or fail the store that already succeeded.
 */
async function notifyPairedLeagues(
  sport: 'NCAAF' | 'NCAAB',
  year: number,
  before: unknown,
  picks: ReadonlyArray<{ collegeAthleteId: string }>,
  now: Date,
): Promise<DraftNoticeResult | null> {
  const prior = (before as { picks?: unknown } | null)?.picks
  const previousIds = new Set(
    (Array.isArray(prior) ? prior : []).map((p) => String((p as { collegeAthleteId?: unknown })?.collegeAthleteId ?? '')).filter(Boolean),
  )
  try {
    const { notifyNewDraftPicks } = await import('@/lib/league/collegePro/draftNotices')
    return await notifyNewDraftPicks({ sport, year, previousIds, currentIds: picks.map((p) => p.collegeAthleteId), now })
  } catch {
    return null
  }
}
