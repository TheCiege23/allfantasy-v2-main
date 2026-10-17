import { buildCareerData, NO_CAREER_FILTER, type CareerData, type CareerFilter, type CareerSource } from './careerModel'

/**
 * Career compare (live-career plan, phase 5) — two slices of one career, side by side.
 *
 * A side is one of: a platform, a league, a season, a sport, or the whole career. Each is a
 * `CareerFilter`, and each side's numbers come from `buildCareerData` over the SAME profile the
 * overview renders, so a compare row can never disagree with what the overview shows for that
 * filter. Nothing is re-scored here; rows only read fields `CareerData` already carries.
 *
 * ⚠ THE PARAMETERS ARE `ca` AND `cb`, NEVER `league=`. `?league=` is the page's authorization
 * boundary and swaps the screen to one league's own career (see `careerModel.ts`); a compare side
 * naming a league uses its NAME KEY inside `ca`/`cb`, the same key the `lg` filter uses.
 *
 * Spec grammar, deliberately tiny and validated against the account's own options:
 *   all | platform:<p> | league:<league key> | season:<yyyy> | sport:<SPORT>
 * Anything that does not resolve to an option this account has falls back to the default side,
 * so a hand-edited URL cannot build a side the picker could not.
 */

export type CompareKind = 'all' | 'platform' | 'league' | 'season' | 'sport'

export type CompareOption = {
  spec: string
  label: string
  group: 'Career' | 'Platforms' | 'Leagues' | 'Seasons' | 'Sports'
}

export type CompareSide = {
  spec: string
  label: string
  data: CareerData
}

export type CompareRow = {
  key: string
  label: string
  a: string
  b: string
  /** Which side is ahead on a metric where "ahead" means something; null for ties and counts. */
  better: 'a' | 'b' | null
}

export type CareerCompare = {
  a: CompareSide
  b: CompareSide
  rows: CompareRow[]
  options: CompareOption[]
}

const PLATFORM_NAMES: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  fantrax: 'Fantrax',
  mfl: 'MFL',
  fleaflicker: 'Fleaflicker',
  allfantasy: 'AllFantasy',
}
const platformName = (p: string) => PLATFORM_NAMES[p] ?? p.charAt(0).toUpperCase() + p.slice(1)

/** Every side this account can be compared on, built from the UNFILTERED board's options. */
export function compareOptions(whole: CareerData): CompareOption[] {
  const o = whole.filterOptions
  return [
    { spec: 'all', label: 'Whole career', group: 'Career' as const },
    ...o.platforms.map((p) => ({ spec: `platform:${p}`, label: platformName(p), group: 'Platforms' as const })),
    ...o.leagues.map((l) => ({ spec: `league:${l.key}`, label: `${l.name} (${platformName(l.platform)})`, group: 'Leagues' as const })),
    ...[...o.seasons].sort((a, b) => b - a).map((s) => ({ spec: `season:${s}`, label: String(s), group: 'Seasons' as const })),
    ...(o.sports.length > 1 ? o.sports.map((s) => ({ spec: `sport:${s}`, label: s, group: 'Sports' as const })) : []),
  ]
}

export function filterForSpec(spec: string): CareerFilter {
  const [kind, ...rest] = spec.split(':')
  const value = rest.join(':')
  switch (kind as CompareKind) {
    case 'platform':
      return { ...NO_CAREER_FILTER, platform: value.toLowerCase() }
    case 'league':
      return { ...NO_CAREER_FILTER, league: value.toLowerCase() }
    case 'season': {
      const y = Number(value)
      return { ...NO_CAREER_FILTER, fromSeason: y, toSeason: y }
    }
    case 'sport':
      return { ...NO_CAREER_FILTER, sport: value.toUpperCase() }
    default:
      return NO_CAREER_FILTER
  }
}

/**
 * The two sides shown when the URL names none: the two platforms with the most history, else the
 * two newest seasons, else the whole career against the newest season.
 */
export function defaultSpecs(whole: CareerData): [string, string] {
  const plats = [...whole.coverage.platforms].sort((x, y) => y.leagueSeasons - x.leagueSeasons)
  if (plats.length >= 2) return [`platform:${plats[0].platform}`, `platform:${plats[1].platform}`]
  const seasons = [...whole.filterOptions.seasons].sort((a, b) => b - a)
  if (seasons.length >= 2) return [`season:${seasons[0]}`, `season:${seasons[1]}`]
  return ['all', seasons.length ? `season:${seasons[0]}` : 'all']
}

const pct = (n: number | null) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`)

function pointsPerGame(d: CareerData): number | null {
  let pts = 0
  let games = 0
  for (const s of d.seasons) {
    if (s.pointsFor == null) continue
    pts += s.pointsFor
    games += s.pointsGames
  }
  return games > 0 ? pts / games : null
}

function ahead(a: number | null, b: number | null): 'a' | 'b' | null {
  if (a == null || b == null || a === b) return null
  return a > b ? 'a' : 'b'
}

export function compareRows(a: CareerData, b: CareerData): CompareRow[] {
  const record = (d: CareerData) => (d.games > 0 ? `${d.wins}-${d.losses}${d.ties ? `-${d.ties}` : ''}` : '—')
  const ppgA = pointsPerGame(a)
  const ppgB = pointsPerGame(b)
  const best = (d: CareerData) => {
    const s = d.accomplishments.bestSeasons.at(0)
    return s ? `${s.season} ${s.leagueName} (${s.record})` : '—'
  }
  const span = (d: CareerData) => (d.firstSeason == null ? '—' : d.firstSeason === d.lastSeason ? String(d.firstSeason) : `${d.firstSeason}–${d.lastSeason}`)
  return [
    { key: 'record', label: 'Record', a: record(a), b: record(b), better: null },
    { key: 'winRate', label: 'Win rate', a: pct(a.winRate), b: pct(b.winRate), better: ahead(a.winRate, b.winRate) },
    { key: 'titles', label: 'Titles', a: String(a.championships), b: String(b.championships), better: ahead(a.championships, b.championships) },
    {
      key: 'titleRate',
      label: 'Titles per league-season',
      a: a.leaguesPlayed ? pct(a.championships / a.leaguesPlayed) : '—',
      b: b.leaguesPlayed ? pct(b.championships / b.leaguesPlayed) : '—',
      better: ahead(a.leaguesPlayed ? a.championships / a.leaguesPlayed : null, b.leaguesPlayed ? b.championships / b.leaguesPlayed : null),
    },
    {
      key: 'playoffs',
      label: 'Playoff berths',
      a: String(a.accomplishments.playoffAppearances),
      b: String(b.accomplishments.playoffAppearances),
      better: null,
    },
    {
      key: 'playoffRate',
      label: 'Playoff rate',
      a: pct(a.accomplishments.playoffRate),
      b: pct(b.accomplishments.playoffRate),
      better: ahead(a.accomplishments.playoffRate, b.accomplishments.playoffRate),
    },
    {
      key: 'ppg',
      label: 'Points per game',
      a: ppgA == null ? '—' : ppgA.toFixed(1),
      b: ppgB == null ? '—' : ppgB.toFixed(1),
      // Only comparable inside one sport — a basketball and a football ppg are different units.
      better: a.sports.length === 1 && b.sports.length === 1 && a.sports[0] === b.sports[0] ? ahead(ppgA, ppgB) : null,
    },
    { key: 'leagueSeasons', label: 'League-seasons', a: String(a.leaguesPlayed), b: String(b.leaguesPlayed), better: null },
    { key: 'span', label: 'Seasons', a: span(a), b: span(b), better: null },
    { key: 'best', label: 'Best season', a: best(a), b: best(b), better: null },
  ]
}

export function buildCareerCompare(
  source: CareerSource,
  rawA: string | null | undefined,
  rawB: string | null | undefined,
): CareerCompare {
  const whole = buildCareerData(source)
  const options = compareOptions(whole)
  const valid = new Set(options.map((o) => o.spec))
  const [defA, defB] = defaultSpecs(whole)
  const specA = rawA && valid.has(rawA) ? rawA : defA
  const specB = rawB && valid.has(rawB) ? rawB : defB
  const labelOf = (spec: string) => options.find((o) => o.spec === spec)?.label ?? 'Whole career'
  const a: CompareSide = { spec: specA, label: labelOf(specA), data: buildCareerData(source, filterForSpec(specA)) }
  const b: CompareSide = { spec: specB, label: labelOf(specB), data: buildCareerData(source, filterForSpec(specB)) }
  return { a, b, rows: compareRows(a.data, b.data), options }
}

/** The compare view's URL. `ca`/`cb` only — see the note at the top. */
export function compareHref(a: string, b: string): string {
  const p = new URLSearchParams({ view: 'compare', ca: a, cb: b })
  return `/core/career?${p.toString()}`
}
