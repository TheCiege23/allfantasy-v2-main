import type { DraftNoticeResult } from '@/lib/league/collegePro/draftNotices'
import { prisma } from '@/lib/prisma'
import { getCbbdDraftPicks, getCbbdTeamRoster, type CbbdDraftPick, type CbbdRosterTeam } from '@/lib/cbbd/cbbdFetch'
import { describeCfbdFailure } from '@/lib/cfbd-fetch'
import type { StoredDraftPick } from '@/lib/devy/cfbdDraftPicksStore'

/**
 * The NBA draft, keyed by the drafted player's ESPN athlete id — basketball's half of the C2C / Devy
 * pipeline. Football's is lib/devy/cfbdDraftPicksStore.ts; this mirrors it.
 *
 * THE LINK, measured in contracts/cbbd GAPS B-01 (2026-11-22). A CBBD pick carries CBBD's own
 * `athleteId`, which is the `id` on that school's roster for the season ending in the draft year.
 * That roster row's `sourceId` is the ESPN athlete id, and `PlayerIdentityMap.espnId` (NCAAB) holds
 * the same id for our college player. So:
 *
 *     pick.athleteId  ->  draft-year roster id  ->  sourceId (ESPN)  ->  PlayerIdentityMap.espnId
 *
 * No name is matched anywhere. A pick that does not survive every step is kept in `unlinked` with
 * the step it failed, so the page can say how many picks it could not check rather than imply none.
 *
 * STORED under `cbbd:draft-picks:v1:<year>` as `{ year, fetchedAt, picks, unlinked }`. `picks` uses
 * football's `StoredDraftPick` shape with the ESPN id in `collegeAthleteId` and the NBA team in
 * `nflTeam`, so lib/league/collegePro/pipeline.ts reads both sports with one parser.
 *
 * COST. One draft call plus one roster call per drafted player's school — about 25 for a draft.
 * Refreshed every 12 hours through the draft window, then once after it, then never again for that
 * year: a draft does not change. Callers gate it behind the CFBD quota reserve, which this spends.
 */

export const CBBD_DRAFT_PICKS_KEY_PREFIX = 'cbbd:draft-picks:v1:'

export type UnlinkedPick = {
  name: string
  school: string
  overall: number
  reason: 'no athlete id' | 'not on the draft-year roster' | 'roster has no ESPN id'
}

export type StoredCbbdDraftPicks = {
  year: number
  fetchedAt: string
  picks: StoredDraftPick[]
  unlinked: UnlinkedPick[]
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** The NBA draft is held in late June. The window it is refreshed through: June 20 to July 10 (UTC). */
export function inNbaDraftWindow(now: Date): boolean {
  const m = now.getUTCMonth()
  const d = now.getUTCDate()
  return (m === 5 && d >= 20) || (m === 6 && d <= 10)
}

/** The end of a year's draft window: a row fetched after this is final. */
export function nbaDraftWindowEnd(year: number): Date {
  return new Date(Date.UTC(year, 6, 11))
}

/** The most recent NBA draft: this year's from June 20 on, last year's before. */
export function latestNbaDraftYear(now: Date): number {
  const m = now.getUTCMonth()
  return m > 5 || (m === 5 && now.getUTCDate() >= 20) ? now.getUTCFullYear() : now.getUTCFullYear() - 1
}

/** The schools whose draft-year rosters the link needs: college picks that carry an athlete id. */
export function schoolsToRead(picks: readonly CbbdDraftPick[]): string[] {
  const out = new Set<string>()
  for (const p of picks) {
    if (p.sourceTeamCollegeId != null && p.athleteId != null && p.sourceTeamLocation) out.add(p.sourceTeamLocation)
  }
  return [...out].sort()
}

/**
 * Pure: CBBD picks + the draft-year rosters of their schools -> what is stored. Non-college picks
 * (an international club) are left out entirely: they were never on a college roster, so there is
 * nothing to check and nothing to report.
 */
export function linkCbbdPicks(
  picks: readonly CbbdDraftPick[],
  rostersBySchool: ReadonlyMap<string, CbbdRosterTeam | null>,
): { picks: StoredDraftPick[]; unlinked: UnlinkedPick[] } {
  const stored: StoredDraftPick[] = []
  const unlinked: UnlinkedPick[] = []
  for (const p of picks) {
    if (p.sourceTeamCollegeId == null) continue
    const school = p.sourceTeamLocation ?? ''
    const miss = (reason: UnlinkedPick['reason']) => unlinked.push({ name: p.name, school, overall: p.overall, reason })
    if (p.athleteId == null) {
      miss('no athlete id')
      continue
    }
    const player = rostersBySchool.get(school)?.players.find((r) => r.id === p.athleteId)
    if (!player) {
      miss('not on the draft-year roster')
      continue
    }
    const espnId = String(player.sourceId ?? '').trim()
    if (!/^\d+$/.test(espnId)) {
      miss('roster has no ESPN id')
      continue
    }
    stored.push({
      collegeAthleteId: espnId,
      name: p.name,
      position: p.position ?? '',
      collegeTeam: school,
      nflTeam: p.draftTeam,
      round: p.round,
      pick: p.pick,
      overall: p.overall,
    })
  }
  return { picks: stored, unlinked }
}

export type CbbdDraftPicksRefresh =
  | { year: number; stored: number; unlinked: number; schools: number; notified: DraftNoticeResult | null }
  | { year: number; skipped: string }
  | { year: number; error: string }

/**
 * Fetch, link and store the latest NBA draft when due. Writes nothing unless every roster it needed
 * was read: a partial row would report players as "not drafted" who were.
 */
export async function refreshCbbdDraftPicks(opts: { now?: Date; deadlineAt?: number } = {}): Promise<CbbdDraftPicksRefresh> {
  const now = opts.now ?? new Date()
  const year = latestNbaDraftYear(now)
  const key = `${CBBD_DRAFT_PICKS_KEY_PREFIX}${year}`

  const existing = await prisma.sportsDataCache.findUnique({ where: { cacheKey: key }, select: { data: true } }).catch(() => null)
  const fetchedAt = (existing?.data as { fetchedAt?: unknown } | null)?.fetchedAt
  const last = typeof fetchedAt === 'string' ? Date.parse(fetchedAt) : NaN
  if (Number.isFinite(last)) {
    if (last >= nbaDraftWindowEnd(year).getTime()) return { year, skipped: 'final for this draft' }
    if (inNbaDraftWindow(now) && now.getTime() - last < 12 * HOUR_MS) return { year, skipped: 'within cadence' }
  }

  const draft = await getCbbdDraftPicks(year)
  if (!draft.ok) return { year, error: describeCfbdFailure(draft.failure) }
  if (!Array.isArray(draft.data) || draft.data.length === 0) return { year, skipped: 'no picks published yet' }

  const rosters = new Map<string, CbbdRosterTeam | null>()
  for (const school of schoolsToRead(draft.data)) {
    if (opts.deadlineAt && Date.now() > opts.deadlineAt) return { year, skipped: 'deferred: run budget spent mid-draft' }
    const res = await getCbbdTeamRoster(year, school)
    if (!res.ok) return { year, error: `${school}: ${describeCfbdFailure(res.failure)}` }
    rosters.set(school, Array.isArray(res.data) ? res.data[0] ?? null : null)
  }

  const { picks, unlinked } = linkCbbdPicks(draft.data, rosters)
  const data: StoredCbbdDraftPicks = { year, fetchedAt: now.toISOString(), picks, unlinked }
  const expiresAt = new Date(now.getTime() + 2 * 365 * DAY_MS)
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: key },
    create: { cacheKey: key, data: data as never, expiresAt },
    update: { data: data as never, expiresAt },
  })
  const notified = await notifyPairedLeagues('NCAAB', year, existing?.data, picks, now)
  return { year, stored: picks.length, unlinked: unlinked.length, schools: rosters.size, notified }
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
