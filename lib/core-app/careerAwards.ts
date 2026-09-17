import type { CareerRow } from './careerModel'
import type { CareerTradeCount } from './careerProfile'

/**
 * Career awards — the shareable achievements (career brief item 8).
 *
 * ⚠ EVERY AWARD IS A THRESHOLD ON SOMETHING THE PROFILE RECORDED. Nothing is
 * awarded for a figure we had to estimate, and nothing is shown as "0 of 10" for
 * a manager whose history simply lacks the input — an award with no qualifying
 * rows is absent, the same rule the record book follows.
 *
 * ⚠ PURE AND TYPE-ONLY IMPORTS, so the share-image route, the page and the tests
 * all score the same way from the same stored rows.
 *
 * ⚠ THE SEASON AN AWARD WAS EARNED IS WHEN THE THRESHOLD WAS CROSSED, not when
 * the page was opened — walked season by season over the same rows, so the
 * timeline can place it and the card can date it.
 */

export type AwardTier = 'bronze' | 'silver' | 'gold' | 'platinum'

export const TIER_LABEL: Record<AwardTier, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
}

const TIER_ORDER: AwardTier[] = ['bronze', 'silver', 'gold', 'platinum']

export type CareerAward = {
  key: string
  name: string
  /** What the award is for, in a sentence. */
  blurb: string
  tier: AwardTier
  /** The measured value behind the tier. */
  metric: number
  /** "12 titles across 9 leagues" — the evidence, never a restated threshold. */
  evidence: string
  /** The season the CURRENT tier was reached. */
  earnedSeason: number
  /** Distance to the next tier, or null at the top. */
  next: { tier: AwardTier; threshold: number; remaining: number } | null
  /** Unit for the metric in sentences: "titles", "trades"… */
  unit: string
  /** The same unit for a count of one. */
  unitOne: string
}

type AwardInput = {
  rows: CareerRow[]
  trades: CareerTradeCount[]
}

/**
 * One award: a metric computed from rows up to a season, and four thresholds.
 * `explain` turns the final metric (and the rows) into the evidence line.
 */
type AwardSpec = {
  key: string
  name: string
  blurb: string
  unit: string
  unitOne: string
  thresholds: [number, number, number, number]
  metric: (input: AwardInput, throughSeason: number) => number
  explain: (input: AwardInput, metric: number) => string
}

const games = (r: CareerRow) => r.wins + r.losses + r.ties
const played = (rows: CareerRow[], through: number) => rows.filter((r) => r.counted && r.season <= through)

function maxTitlesInOneLeague(rows: CareerRow[]): { n: number; name: string | null } {
  const by = new Map<string, { n: number; name: string }>()
  for (const r of rows) {
    if (!r.isChampion) continue
    const held = by.get(r.leagueKey) ?? { n: 0, name: r.leagueName }
    held.n += 1
    by.set(r.leagueKey, held)
  }
  let best: { n: number; name: string | null } = { n: 0, name: null }
  for (const v of by.values()) if (v.n > best.n) best = v
  return best
}

function longestTitleRun(rows: CareerRow[]): { n: number; name: string | null } {
  const by = new Map<string, number[]>()
  for (const r of rows) {
    if (!r.isChampion) continue
    const list = by.get(r.leagueKey) ?? []
    list.push(r.season)
    by.set(r.leagueKey, list)
  }
  let best: { n: number; name: string | null } = { n: 0, name: null }
  for (const [key, seasons] of by) {
    const sorted = [...new Set(seasons)].sort((a, b) => a - b)
    let run = 0
    let prev: number | null = null
    for (const s of sorted) {
      run = prev != null && s === prev + 1 ? run + 1 : 1
      prev = s
      if (run > best.n) best = { n: run, name: rows.find((r) => r.leagueKey === key)?.leagueName ?? null }
    }
  }
  return best
}

function dynastyKeys(rows: CareerRow[]): Set<string> {
  return new Set(
    rows.filter((r) => /dynasty|devy|c2c/i.test(r.leagueType ?? '')).map((r) => r.leagueKey),
  )
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

export const AWARD_SPECS: AwardSpec[] = [
  {
    key: 'ring-collector',
    name: 'Ring Collector',
    blurb: 'Championships won, across every league you have played.',
    unit: 'titles',
    unitOne: 'title',
    thresholds: [1, 3, 5, 10],
    metric: ({ rows }, t) => played(rows, t).filter((r) => r.isChampion).length,
    explain: ({ rows }, m) => {
      const leagues = new Set(rows.filter((r) => r.counted && r.isChampion).map((r) => r.leagueKey)).size
      return `${plural(m, 'title')} across ${plural(leagues, 'league')}`
    },
  },
  {
    key: 'dynasty-builder',
    name: 'Dynasty Builder',
    blurb: 'The most titles you have won inside one league.',
    unit: 'titles in one league',
    unitOne: 'title in one league',
    thresholds: [2, 3, 4, 6],
    metric: ({ rows }, t) => maxTitlesInOneLeague(played(rows, t)).n,
    explain: ({ rows }, m) => `${plural(m, 'title')} in ${maxTitlesInOneLeague(played(rows, 9999)).name ?? 'one league'}`,
  },
  {
    key: 'back-to-back',
    name: 'Back-to-Back',
    blurb: 'Consecutive championships in the same league.',
    unit: 'straight titles',
    unitOne: 'straight title',
    thresholds: [2, 3, 4, 5],
    metric: ({ rows }, t) => longestTitleRun(played(rows, t)).n,
    explain: ({ rows }, m) => `${m} straight in ${longestTitleRun(played(rows, 9999)).name ?? 'one league'}`,
  },
  {
    key: 'playoff-regular',
    name: 'Playoff Regular',
    blurb: 'Playoff berths in finished seasons whose league recorded its cut.',
    unit: 'berths',
    unitOne: 'berth',
    thresholds: [5, 15, 40, 100],
    metric: ({ rows }, t) => played(rows, t).filter((r) => r.playoffKnown && r.madePlayoffs).length,
    explain: ({ rows }, m) => {
      const known = rows.filter((r) => r.counted && r.playoffKnown).length
      return `${plural(m, 'berth')} in ${plural(known, 'league-season')} with a known cut`
    },
  },
  {
    key: 'dynasty-deal-maker',
    name: 'Dynasty Deal Maker',
    blurb: 'Trades you made in dynasty leagues.',
    unit: 'dynasty trades',
    unitOne: 'dynasty trade',
    thresholds: [10, 25, 50, 100],
    metric: ({ rows, trades }, t) => {
      const keys = dynastyKeys(rows)
      return trades.filter((x) => x.season <= t && x.leagueKey && keys.has(x.leagueKey)).reduce((s, x) => s + x.count, 0)
    },
    explain: ({ rows, trades }, m) => {
      const keys = dynastyKeys(rows)
      const leagues = new Set(trades.filter((x) => x.leagueKey && keys.has(x.leagueKey)).map((x) => x.leagueKey)).size
      return `${plural(m, 'trade')} across ${plural(leagues, 'dynasty league')}`
    },
  },
  {
    key: 'deal-maker',
    name: 'Deal Maker',
    blurb: 'Every trade on file for your account.',
    unit: 'trades',
    unitOne: 'trade',
    thresholds: [10, 50, 150, 400],
    metric: ({ trades }, t) => trades.filter((x) => x.season <= t).reduce((s, x) => s + x.count, 0),
    explain: ({ trades }, m) => {
      const seasons = new Set(trades.map((x) => x.season))
      return `${plural(m, 'trade')} over ${plural(seasons.size, 'season')}`
    },
  },
  {
    key: 'iron-manager',
    name: 'Iron Manager',
    blurb: 'Seasons with at least one finished league.',
    unit: 'seasons',
    unitOne: 'season',
    thresholds: [3, 5, 7, 10],
    metric: ({ rows }, t) => new Set(played(rows, t).map((r) => r.season)).size,
    explain: ({ rows }, m) => {
      const seasons = [...new Set(rows.filter((r) => r.counted).map((r) => r.season))].sort((a, b) => a - b)
      return `${plural(m, 'season')}${seasons.length ? `, ${seasons[0]}–${seasons[seasons.length - 1]}` : ''}`
    },
  },
  {
    key: 'century-club',
    name: 'Century Club',
    blurb: 'Regular-season wins across your career.',
    unit: 'wins',
    unitOne: 'win',
    thresholds: [100, 250, 500, 1000],
    metric: ({ rows }, t) => played(rows, t).reduce((s, r) => s + r.wins, 0),
    explain: ({ rows }, m) => {
      const g = rows.filter((r) => r.counted).reduce((s, r) => s + games(r), 0)
      return `${plural(m, 'win')} in ${plural(g, 'game')}`
    },
  },
  {
    key: 'juggernaut',
    name: 'Juggernaut',
    blurb: 'League-seasons won at an .800 clip or better over at least ten games.',
    unit: 'dominant seasons',
    unitOne: 'dominant season',
    thresholds: [1, 3, 6, 12],
    metric: ({ rows }, t) =>
      played(rows, t).filter((r) => games(r) >= 10 && (r.wins + r.ties / 2) / games(r) >= 0.8).length,
    explain: ({ rows }, m) => {
      const unbeaten = rows.filter((r) => r.counted && games(r) >= 10 && r.losses === 0).length
      return `${plural(m, 'season')} at .800 or better${unbeaten ? `, ${unbeaten} unbeaten` : ''}`
    },
  },
  {
    key: 'portfolio-manager',
    name: 'Portfolio Manager',
    blurb: 'The most leagues you have finished in a single year.',
    unit: 'leagues in a year',
    unitOne: 'league in a year',
    thresholds: [10, 25, 50, 100],
    metric: ({ rows }, t) => {
      const by = new Map<number, number>()
      for (const r of played(rows, t)) by.set(r.season, (by.get(r.season) ?? 0) + 1)
      return Math.max(0, ...by.values())
    },
    explain: ({ rows }, m) => {
      const by = new Map<number, number>()
      for (const r of rows.filter((x) => x.counted)) by.set(r.season, (by.get(r.season) ?? 0) + 1)
      const year = [...by.entries()].find(([, n]) => n === m)?.[0]
      return `${plural(m, 'league')} finished${year ? ` in ${year}` : ''}`
    },
  },
  {
    key: 'multi-sport',
    name: 'Multi-Sport',
    blurb: 'Sports you have finished a season in.',
    unit: 'sports',
    unitOne: 'sport',
    thresholds: [2, 3, 4, 5],
    metric: ({ rows }, t) => new Set(played(rows, t).map((r) => r.sport).filter(Boolean)).size,
    explain: ({ rows }) => [...new Set(rows.filter((r) => r.counted).map((r) => r.sport).filter(Boolean))].sort().join(' · '),
  },
  {
    key: 'cross-platform',
    name: 'Cross-Platform',
    blurb: 'Platforms you have finished a season on.',
    unit: 'platforms',
    unitOne: 'platform',
    thresholds: [2, 3, 4, 5],
    metric: ({ rows }, t) => new Set(played(rows, t).map((r) => r.platform)).size,
    explain: ({ rows }) =>
      [...new Set(rows.filter((r) => r.counted).map((r) => r.platform))]
        .sort()
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(' · '),
  },
]

function tierFor(value: number, thresholds: AwardSpec['thresholds']): AwardTier | null {
  let tier: AwardTier | null = null
  thresholds.forEach((t, i) => {
    if (value >= t) tier = TIER_ORDER[i]
  })
  return tier
}

export function computeCareerAwards(input: AwardInput): CareerAward[] {
  const seasons = [
    ...new Set([...input.rows.filter((r) => r.counted).map((r) => r.season), ...input.trades.map((t) => t.season)]),
  ].sort((a, b) => a - b)
  if (seasons.length === 0) return []
  const last = seasons[seasons.length - 1]

  const out: CareerAward[] = []
  for (const spec of AWARD_SPECS) {
    const metric = spec.metric(input, last)
    const tier = tierFor(metric, spec.thresholds)
    if (!tier) continue
    const tierIndex = TIER_ORDER.indexOf(tier)
    const needed = spec.thresholds[tierIndex]
    const earnedSeason = seasons.find((s) => spec.metric(input, s) >= needed) ?? last
    const nextIndex = tierIndex + 1
    out.push({
      key: spec.key,
      name: spec.name,
      blurb: spec.blurb,
      tier,
      metric,
      evidence: spec.explain(input, metric),
      earnedSeason,
      next:
        nextIndex < TIER_ORDER.length
          ? {
              tier: TIER_ORDER[nextIndex],
              threshold: spec.thresholds[nextIndex],
              remaining: spec.thresholds[nextIndex] - metric,
            }
          : null,
      unit: spec.unit,
      unitOne: spec.unitOne,
    })
  }
  return out.sort(
    (a, b) => TIER_ORDER.indexOf(b.tier) - TIER_ORDER.indexOf(a.tier) || b.earnedSeason - a.earnedSeason || a.name.localeCompare(b.name),
  )
}

export function findAward(awards: CareerAward[], key: string | null | undefined): CareerAward | null {
  if (!key) return null
  return awards.find((a) => a.key === key) ?? null
}
