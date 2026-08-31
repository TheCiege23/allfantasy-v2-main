import 'server-only'

import { prisma } from '@/lib/prisma'
import { getCrossLeagueExposure } from '@/lib/core-app/dash3aPanels'
import type {
  DevyCollegeTile,
  DevyCoreProps,
  DevyExposureRow,
  DevyNewsItem,
  DevyNewsKind,
  DevyPosition,
  DevyProspect,
  DevyRankedPlayer,
  DevyTrend,
} from '@/components/core-app/screens/DevyCore'

/**
 * Server data for the two devy screens.
 *
 * 🛑 EVERY FIELD HERE COMES FROM A TABLE SOMETHING ACTUALLY WRITES. The handoff's mock
 * is fictional data standing in for a feed, and the tempting move is to reproduce its
 * shape and fill the gaps with plausible numbers. That would ship a screen that looks
 * finished and reports invented facts about real prospects — worse than a screen with
 * an honest hole in it.
 *
 * So where a source exists, this reads it. Where none does, it returns empty and the
 * component renders its own "nothing here yet" copy:
 *
 *   prospects            DevyPlayer, ordered on draftProjectionScore   ✔ written by the devy intel sweep
 *   rankingsByPosition   the same rows, grouped                        ✔
 *   colleges             DevyPlayer grouped by school                  ✔
 *   exposure             getCrossLeagueExposure                        ✔ the Dash3A panel, reused
 *   news                 SportsNews where sport = NCAAF                ⚠ no writer fills this yet
 *   watchlist            —                                             ⚠ no follow model exists
 *
 * ⚠ THE LAST TWO ARE EMPTY BY CONSTRUCTION, NOT BY ACCIDENT, and that is recorded here
 * so nobody spends an afternoon debugging a query that is working correctly. There is no
 * college news ingest — `grep` for a writer of `SportsNews` with a college sport finds
 * none — and no table anywhere records a followed prospect. Both sections degrade to
 * their empty copy rather than to fabricated rows.
 */

/** Ranked prospects are capped so the hero stays a hero. */
const HERO_COUNT = 5
const RANK_PER_POSITION = 3
const COLLEGE_TILES = 8

const POSITIONS: DevyPosition[] = ['QB', 'RB', 'WR', 'TE']

type PoolRow = {
  id: string
  name: string
  position: string
  school: string
  classYearLabel: string | null
  draftProjectionScore: number | null
  stockTrendDelta: number | null
  headshotUrl: string | null
  passAttempts: number | null
  passCompletions: number | null
  adot: number | null
  airYardsAttempts: number | null
}

/**
 * `stockTrendDelta` → the three-way indicator the design draws.
 *
 * ⚠ NULL IS FLAT, NOT DOWN. A prospect nothing has re-scored yet has no trend; rendering
 * that as a red arrow would invent a fall that never happened.
 */
function trendOf(delta: number | null): DevyTrend {
  if (delta == null || delta === 0) return 'flat'
  return delta > 0 ? 'up' : 'down'
}

/**
 * The three stats beside each hero card.
 *
 * ⚠ ONLY STATS THE ROW ACTUALLY CARRIES. The mock shows yards/TD/ADOT for a quarterback,
 * but `DevyPlayer` fills those columns only for players the CFBD passing sweep has
 * reached. A missing value is omitted rather than printed as 0 — and ADOT in particular
 * is dropped unless its denominator is present, which is the rule the whole passing
 * feature was rebuilt around.
 */
function statsFor(row: PoolRow): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = []
  if (row.passAttempts != null) out.push({ label: 'Att', value: row.passAttempts.toLocaleString() })
  if (row.passCompletions != null) out.push({ label: 'Cmp', value: row.passCompletions.toLocaleString() })
  if (row.adot != null && row.airYardsAttempts != null && row.airYardsAttempts > 0) {
    out.push({ label: 'ADOT', value: row.adot.toFixed(1) })
  }
  return out.slice(0, 3)
}

function toProspect(row: PoolRow, rank: number): DevyProspect {
  return {
    id: row.id,
    rank,
    name: row.name,
    position: row.position,
    school: row.school,
    classYear: row.classYearLabel,
    grade: row.draftProjectionScore,
    trend: trendOf(row.stockTrendDelta),
    headshotUrl: row.headshotUrl,
    // No college colour table exists in this schema, so no badge rather than a grey blob.
    teamColor: null,
    teamAbbrev: null,
    stats: statsFor(row),
    // No scouting-blurb column. The mock's one-liners are copy, not data.
    blurb: null,
  }
}

function newsKindOf(category: string | null): DevyNewsKind {
  const c = (category ?? '').toLowerCase()
  if (c.includes('injur')) return 'injury'
  if (c.includes('transfer') || c.includes('portal')) return 'transfer'
  if (c.includes('combine') || c.includes('showcase')) return 'combine'
  if (c.includes('breakout') || c.includes('performance')) return 'breakout'
  return 'neutral'
}

/** Coarse relative time. Formatted server-side so the component stays pure. */
function ageOf(at: Date | null, now: Date): string {
  if (!at) return ''
  const mins = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60000))
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export type DevyCoreData = Omit<DevyCoreProps, 'viewState'>

export async function getDevyCoreData(userId: string, leagueIds: string[], now = new Date()): Promise<DevyCoreData> {
  const pool = (await prisma.devyPlayer
    .findMany({
      where: { devyEligible: true, draftProjectionScore: { not: null } },
      orderBy: { draftProjectionScore: 'desc' },
      take: 200,
      select: {
        id: true,
        name: true,
        position: true,
        school: true,
        classYearLabel: true,
        draftProjectionScore: true,
        stockTrendDelta: true,
        headshotUrl: true,
        passAttempts: true,
        passCompletions: true,
        adot: true,
        airYardsAttempts: true,
      },
    })
    .catch(() => [])) as PoolRow[]

  const prospects = pool.slice(0, HERO_COUNT).map((row, i) => toProspect(row, i + 1))

  const rankingsByPosition: Partial<Record<DevyPosition, DevyRankedPlayer[]>> = {}
  for (const pos of POSITIONS) {
    rankingsByPosition[pos] = pool
      .filter((r) => r.position === pos)
      .slice(0, RANK_PER_POSITION)
      .map((r, i): DevyRankedPlayer => ({
        rank: i + 1,
        name: r.name,
        school: r.school,
        classYear: r.classYearLabel,
        grade: r.draftProjectionScore,
      }))
  }

  const collegeCounts = await prisma.devyPlayer
    .groupBy({
      by: ['school'],
      where: { devyEligible: true },
      _count: { _all: true },
      orderBy: { _count: { school: 'desc' } },
      take: COLLEGE_TILES,
    })
    .catch(() => [] as Array<{ school: string; _count: { _all: number } }>)

  const colleges: DevyCollegeTile[] = collegeCounts
    .filter((c) => c.school)
    .map((c) => ({
      school: c.school,
      // No conference column on DevyPlayer. Null renders an em dash, not a guess.
      conference: null,
      prospectCount: c._count._all,
      teamColor: null,
    }))

  /*
   * Exposure is the Dash3A panel, reused rather than reimplemented — it already knows how
   * to read only the rosters it can actually see and report the denominator. Its rows are
   * every sport, so college players are selected by name against the devy pool.
   */
  const poolNames = new Set(pool.map((p) => p.name.toLowerCase()))
  const exposurePanel = await getCrossLeagueExposure(userId, leagueIds, 40).catch(() => null)
  const exposure: DevyExposureRow[] =
    exposurePanel && exposurePanel.available
      ? exposurePanel.data.rows
          .filter((r) => poolNames.has(r.name.toLowerCase()))
          .slice(0, 6)
          .map((r) => ({
            player: r.name,
            rosteredIn: r.count,
            leagueCount: r.of,
            // The panel does not carry platform, and inventing one would be a lie about
            // where a player is rostered.
            platforms: [],
            exposurePct: r.of > 0 ? (r.count / r.of) * 100 : 0,
          }))
      : []

  const newsRows = await prisma.sportsNews
    .findMany({
      where: { sport: 'NCAAF' },
      orderBy: { publishedAt: 'desc' },
      take: 6,
      select: { id: true, title: true, playerName: true, category: true, publishedAt: true },
    })
    .catch(() => [])

  const news: DevyNewsItem[] = newsRows.map((n) => ({
    id: n.id,
    kind: newsKindOf(n.category),
    player: n.playerName ?? '—',
    blurb: n.title,
    age: ageOf(n.publishedAt, now),
  }))

  return {
    prospects,
    exposure,
    rankingsByPosition,
    // No follow/watch model exists — see the header. Empty renders the component's own copy.
    watchlist: [],
    colleges,
    news,
  }
}

/**
 * How many devy roster slots this league has, or 0.
 *
 * Drives both the nav item and the league tab's empty state, so a league with no devy
 * slots never shows a tab promising college prospects it cannot hold.
 *
 * ⚠ `DevyLeagueConfig.devySlotCount` IS THE SIGNAL, NOT AN `isDevy` FLAG ON `League`.
 * A first pass read `league.isDevy` by analogy with `FantraxLeague.isDevy` — that column
 * does not exist on `League`, and the flag that does exist elsewhere says a league was
 * IMPORTED as devy rather than that it currently rosters prospects. The commissioner can
 * set the slot count to zero, and the count is what the tab actually needs.
 */
export async function leagueDevySlotCount(leagueId: string): Promise<number> {
  const row = await prisma.devyLeagueConfig
    .findUnique({ where: { leagueId }, select: { devySlotCount: true } })
    .catch(() => null)
  return row?.devySlotCount ?? 0
}
