import 'server-only'

import { prisma } from '@/lib/prisma'
import type { LeagueH2HPayload, WeeklyAwards } from '@/lib/league-history/sleeperH2HService'
import { CLOSE_FINISH_MAX_MARGIN } from '@/lib/league-chat/closeFinishRule'
import {
  chimmyMomentDedupeCacheKey,
  postChimmyMoment,
  type PostChimmyMomentResult,
} from '@/lib/league-chat/chimmyMoments'

/**
 * The weekly recap — results, the top of the table, the week's awards, records broken and Chimmy's
 * call — as a Chimmy moment (`kind: 'weekly_awards'`).
 *
 * `/api/cron/weekly-awards` still does the reading (Sleeper's week feed, the H2H aggregation) and
 * the optional email; this module owns the WORDS and the POST, so both can be tested without a
 * network and the copy lives in one place.
 *
 * Every number is counted from real matchups. Chimmy's call restates a counted fact with some
 * personality; templates vary per league and week by a deterministic hash, so a re-render says the
 * same thing. Brand voice: direct, warm, a little competitive — and never mean to the person who lost.
 */

export type WireRoster = {
  roster_id: number
  owner_id: string | null
  settings?: { wins?: number; losses?: number; ties?: number; fpts?: number; fpts_decimal?: number } | null
}
export type WireUser = { user_id: string; display_name: string; metadata?: { team_name?: string | null } | null }
export type WireMatchup = { roster_id: number; matchup_id: number | null; points: number }

/** The recap's dedupe key before it became a Chimmy moment — still honoured, still written. */
export const LEGACY_RECAP_PREFIX = 'recap-posted:v1:'
const LEGACY_TTL_MS = 365 * 24 * 60 * 60 * 1000

/** Deterministic per-league/week template pick — the same recap re-rendered picks the same line. */
function pick<T>(pool: readonly T[], seedStr: string): T {
  let h = 0
  for (let i = 0; i < seedStr.length; i += 1) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0
  return pool[h % pool.length]!
}

/** Chimmy's color commentary — every line is a counted fact with a jersey on. At most two. */
export function chimmyCall(
  sleeperLeagueId: string,
  awards: WeeklyAwards,
  nameOf: (ownerId: string | null | undefined) => string,
): string[] {
  const seed = `${sleeperLeagueId}:${awards.season}:${awards.week}`
  const out: string[] = []

  if (awards.biggestBlowout && awards.biggestBlowout.margin >= 40) {
    const w = nameOf(awards.biggestBlowout.winnerOwnerId)
    const l = nameOf(awards.biggestBlowout.loserOwnerId)
    const m = awards.biggestBlowout.margin.toFixed(1)
    out.push(
      pick(
        [
          `${w} beat ${l} by ${m}. Not close, and ${w} knows it.`,
          `${w} by ${m} over ${l}. That one goes on the fridge.`,
          `${l}, shake it off — ${w} was winning by ${m} against anybody this week.`,
        ],
        seed + ':blowout',
      ),
    )
  }

  if (awards.narrowEscape && awards.narrowEscape.margin <= CLOSE_FINISH_MAX_MARGIN) {
    const w = nameOf(awards.narrowEscape.winnerOwnerId)
    const l = nameOf(awards.narrowEscape.loserOwnerId)
    const m = awards.narrowEscape.margin.toFixed(1)
    out.push(
      pick(
        [
          `${w} got past ${l} by ${m}. Survive and advance.`,
          `${m} points between ${w} and ${l}. ${l}, you get the rematch.`,
          `${w} by ${m} — the closest call of the week, and a win is a win.`,
        ],
        seed + ':escape',
      ),
    )
  }

  if (out.length < 2 && awards.lowScore) {
    const l = nameOf(awards.lowScore.ownerId)
    const p = awards.lowScore.points.toFixed(1)
    out.push(
      pick(
        [
          `${l} put up ${p}. Every contender has one of these — make it the only one.`,
          `${p} for ${l}. Short week. The waiver wire is open.`,
          `${l} scored ${p}. Next week owes you one.`,
        ],
        seed + ':low',
      ),
    )
  }

  if (out.length === 0 && awards.topScore) {
    const w = nameOf(awards.topScore.ownerId)
    const p = awards.topScore.points.toFixed(1)
    out.push(
      pick(
        [
          `${w} dropped ${p} and made it look easy. It was not easy.`,
          `${p} for ${w}. That is the number to chase next week.`,
        ],
        seed + ':top',
      ),
    )
  }

  return out.slice(0, 2)
}

/**
 * The recap's text. PURE. `rosters` / `users` / `matchups` are Sleeper's week feed as the cron read
 * it; pass nulls when a read failed and those sections are simply left out.
 */
export function buildWeeklyRecap(input: {
  leagueName: string
  sleeperLeagueId: string
  h2h: Pick<LeagueH2HPayload, 'managers' | 'records'>
  awards: WeeklyAwards
  rosters: WireRoster[] | null
  users: WireUser[] | null
  matchups: WireMatchup[] | null
}): string {
  const { awards, h2h } = input
  const nameOf = (ownerId: string | null | undefined) => h2h.managers.find((m) => m.ownerId === ownerId)?.name ?? 'Manager'

  const lines: string[] = [`📺 Week ${awards.week} recap — ${input.leagueName} (${awards.season})`]

  // ── Results: straight from the Sleeper week feed ──
  if (input.rosters && input.users && input.matchups) {
    const ownerOf = new Map(input.rosters.map((r) => [r.roster_id, r.owner_id]))
    const displayOf = new Map(input.users.map((u) => [u.user_id, u.metadata?.team_name?.trim() || u.display_name]))
    const label = (rosterId: number) => {
      const owner = ownerOf.get(rosterId)
      return (owner && (displayOf.get(owner) ?? nameOf(owner))) || `Team ${rosterId}`
    }
    const byMatchup = new Map<number, WireMatchup[]>()
    for (const m of input.matchups) {
      if (m.matchup_id == null) continue
      const list = byMatchup.get(m.matchup_id) ?? []
      list.push(m)
      byMatchup.set(m.matchup_id, list)
    }
    const results: string[] = []
    for (const pair of byMatchup.values()) {
      if (pair.length !== 2) continue
      const [a, b] = pair as [WireMatchup, WireMatchup]
      if ((a.points ?? 0) === 0 && (b.points ?? 0) === 0) continue
      const [w, l] = a.points >= b.points ? [a, b] : [b, a]
      results.push(
        a.points === b.points
          ? `${label(a.roster_id)} ${a.points.toFixed(1)} tied ${label(b.roster_id)} ${b.points.toFixed(1)}`
          : `${label(w.roster_id)} ${w.points.toFixed(1)} def. ${label(l.roster_id)} ${l.points.toFixed(1)}`,
      )
    }
    if (results.length > 0) {
      lines.push('', '🏈 Results')
      lines.push(...results.map((r) => `  ${r}`))
    }

    // ── Top of the table: wins, then points-for ──
    const fpts = (r: WireRoster) => (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100
    const top = [...input.rosters]
      .sort((x, y) => (y.settings?.wins ?? 0) - (x.settings?.wins ?? 0) || fpts(y) - fpts(x))
      .slice(0, 3)
    if (top.length > 0 && top.some((r) => (r.settings?.wins ?? 0) + (r.settings?.losses ?? 0) > 0)) {
      lines.push(
        '',
        `📈 Top of the table: ${top
          .map((r, i) => `${i + 1}. ${label(r.roster_id)} (${r.settings?.wins ?? 0}-${r.settings?.losses ?? 0})`)
          .join(' · ')}`,
      )
    }
  }

  // ── Weekly awards (the same numbers the Legacy tab shows) ──
  lines.push('', '🏆 Weekly awards')
  if (awards.topScore) lines.push(`  🚀 Boom of the week: ${nameOf(awards.topScore.ownerId)}, ${awards.topScore.points.toFixed(1)}`)
  if (awards.lowScore) lines.push(`  🥀 Bust of the week: ${nameOf(awards.lowScore.ownerId)}, ${awards.lowScore.points.toFixed(1)}`)
  if (awards.narrowEscape)
    lines.push(
      `  😅 Narrow escape: ${nameOf(awards.narrowEscape.winnerOwnerId)} over ${nameOf(awards.narrowEscape.loserOwnerId)} by ${awards.narrowEscape.margin.toFixed(1)}`,
    )
  if (awards.biggestBlowout)
    lines.push(
      `  🔨 Hammer of the week: ${nameOf(awards.biggestBlowout.winnerOwnerId)} over ${nameOf(awards.biggestBlowout.loserOwnerId)} by ${awards.biggestBlowout.margin.toFixed(1)}`,
    )

  // ── All-time records broken THIS week (from the records book) ──
  const r = h2h.records
  const isThisWeek = (season?: string | null, week?: number | null) => season === awards.season && week === awards.week
  const broken: string[] = []
  if (r.highestWeek && isThisWeek(r.highestWeek.season, r.highestWeek.week))
    broken.push(`${nameOf(r.highestWeek.ownerId)} set the all-time single-week high: ${r.highestWeek.points.toFixed(1)}`)
  if (r.biggestBlowout && isThisWeek(r.biggestBlowout.season, r.biggestBlowout.week))
    broken.push(
      `${nameOf(r.biggestBlowout.winnerOwnerId)} posted the biggest blowout in league history, by ${r.biggestBlowout.margin.toFixed(1)}`,
    )
  if (r.closestGame && isThisWeek(r.closestGame.season, r.closestGame.week))
    broken.push(`${nameOf(r.closestGame.winnerOwnerId)} won the closest game in league history, by ${r.closestGame.margin.toFixed(1)}`)
  if (r.longestWinStreak?.active && r.longestWinStreak.toSeason === awards.season && r.longestWinStreak.toWeek === awards.week)
    broken.push(`${nameOf(r.longestWinStreak.ownerId)} extended the longest win streak ever to ${r.longestWinStreak.length} straight`)
  if (broken.length > 0) {
    lines.push('', '📜 Records broken')
    lines.push(...broken.map((b) => `  ${b}`))
  }

  // ── Chimmy's call. The post is Chimmy's, so it is said in the first person. ──
  const call = chimmyCall(input.sleeperLeagueId, awards, nameOf)
  if (call.length > 0) {
    lines.push('', '🎙 My call')
    lines.push(...call.map((c) => `  ${c}`))
  }

  lines.push('', 'Every number here comes from your real matchups. The full records book is in the Legacy tab.')
  return lines.join('\n')
}

export function legacyRecapCacheKey(sleeperLeagueId: string, season: string, week: number): string {
  return `${LEGACY_RECAP_PREFIX}${sleeperLeagueId}:${season}:${week}`
}

function recapDedupeKey(season: string, week: number): string {
  return `${season}:${week}`
}

/**
 * Cheap pre-check the cron makes BEFORE it reads Sleeper's week feed, so an already-recapped league
 * costs one indexed lookup instead of three vendor calls. A read failure answers "not posted" — the
 * post itself is still deduped, so the worst case is the three reads it always used to make.
 */
export async function weeklyRecapAlreadyPosted(input: {
  afLeagueId: string
  sleeperLeagueId: string
  season: string
  week: number
}): Promise<boolean> {
  const keys = [
    legacyRecapCacheKey(input.sleeperLeagueId, input.season, input.week),
    chimmyMomentDedupeCacheKey(input.afLeagueId, 'weekly_awards', recapDedupeKey(input.season, input.week)),
  ]
  const rows = await prisma.sportsDataCache
    .findMany({ where: { cacheKey: { in: keys }, expiresAt: { gt: new Date() } }, select: { cacheKey: true } })
    .catch(() => [] as Array<{ cacheKey: string }>)
  return rows.length > 0
}

export type WeeklyRecapPostResult =
  | PostChimmyMomentResult
  | { posted: false; reason: 'already_posted_legacy' }

/**
 * Post the recap as Chimmy — once per league per week.
 *
 * ⚠ THE OLD DEDUPE KEY IS STILL READ AND STILL WRITTEN. Before this was a Chimmy moment the recap
 * deduped on `recap-posted:v1:<sleeperLeagueId>:<season>:<week>`. A week already posted under that key
 * must not be posted again as Chimmy on the next manual run, and writing it after a post keeps a
 * rollback to the old route from double-posting too. It is keyed on the SLEEPER league, exactly as
 * before: two AllFantasy leagues over one Sleeper league still share one recap a week.
 */
export async function postWeeklyRecapAsChimmy(input: {
  afLeagueId: string
  sleeperLeagueId: string
  season: string
  week: number
  text: string
  now?: Date
}): Promise<WeeklyRecapPostResult> {
  const now = input.now ?? new Date()
  const legacyKey = legacyRecapCacheKey(input.sleeperLeagueId, input.season, input.week)
  const legacy = await prisma.sportsDataCache.findUnique({ where: { cacheKey: legacyKey } }).catch(() => null)
  if (legacy) return { posted: false, reason: 'already_posted_legacy' }

  const result = await postChimmyMoment({
    leagueId: input.afLeagueId,
    kind: 'weekly_awards',
    dedupeKey: recapDedupeKey(input.season, input.week),
    text: input.text,
    card: { weeklyRecap: true, season: input.season, week: input.week },
    messageType: 'system',
    now,
  })
  if (result.posted) {
    const data = { version: 1, postedAt: now.toISOString() } as unknown as object
    await prisma.sportsDataCache
      .upsert({
        where: { cacheKey: legacyKey },
        update: { data, expiresAt: new Date(now.getTime() + LEGACY_TTL_MS) },
        create: { cacheKey: legacyKey, data, expiresAt: new Date(now.getTime() + LEGACY_TTL_MS) },
      })
      .catch(() => null)
  }
  return result
}
