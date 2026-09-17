import { recordLine, type CareerRow } from './careerModel'

/**
 * The career record book — the pure half.
 *
 * Five sections, each fed by the one source that can honestly answer it:
 *
 *   scoring / streaks  weekly games (`MatchupFact`, every season a backfill ran,
 *                      plus `WeeklyMatchup` for the live season)
 *   seasons            the stored profile's league-season rows (2019 onward)
 *   trades             graded trades (`trade-grades:v2:*`) and your own
 *                      `LeagueTrade` history
 *   drafts             Sleeper draft report cards (`draft-report:v1:*`)
 *   rivalries          the same weekly games, paired by opponent
 *
 * ⚠ A RECORD WITH NO QUALIFYING ROW IS ABSENT, NOT ZERO. Every function here
 * returns fewer records rather than a record holding a zero.
 */

export type CareerRecordSection = 'scoring' | 'streaks' | 'seasons' | 'trades' | 'drafts' | 'rivalries'

export const RECORD_SECTIONS: Array<{ key: CareerRecordSection; label: string }> = [
  { key: 'scoring', label: 'Scoring' },
  { key: 'streaks', label: 'Streaks' },
  { key: 'seasons', label: 'Seasons' },
  { key: 'trades', label: 'Trades' },
  { key: 'drafts', label: 'Drafts' },
  { key: 'rivalries', label: 'Rivalries' },
]

export type CareerRecord = {
  key: string
  section: CareerRecordSection
  label: string
  /** Already formatted for display — the unit belongs with the number. */
  value: string
  /** "Dynasty Dragons · week 14, 2022". Never fabricated. */
  context: string
  tone: 'accent' | 'good' | 'bad' | 'warn'
}

export type CareerRival = {
  /** `u:<provider user id>` when known, else `r:<league>:<slot>`. */
  key: string
  name: string
  meetings: number
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  leagues: string[]
  seasons: number[]
  lastSeason: number
}

export type CareerRecordsData = {
  records: CareerRecord[]
  /** Games the weekly records were computed over. The denominator. */
  weeksCounted: number
  /** Leagues those games came from. */
  leaguesCounted: number
  /** Records the design asks for that no table can back yet, with the reason. */
  missing: Array<{ label: string; reason: string; section: CareerRecordSection }>
  /** Most-played opponents first. */
  rivals: CareerRival[]
  /** Which seasons the weekly games cover — the completeness panel reads this. */
  weeklySeasons: Array<{ season: number; weeks: number; leagues: number }>
}

/* ───────────────────────────── weekly games ───────────────────────────── */

/**
 * One played game of yours, from whichever table recorded it.
 *
 * `result` is decided by the provider's winner where it recorded one — a league
 * with median or all-play scoring can have a winner that comparing two totals
 * would get wrong — and by the scores otherwise.
 */
export type CareerGame = {
  /** Our `League.id`. */
  leagueId: string
  leagueName: string
  season: number
  week: number
  myScore: number
  oppScore: number
  result: 'W' | 'L' | 'T'
  /** Opponent identity: provider user id when known. */
  oppKey: string | null
  oppName: string | null
}

export const RIVAL_MIN_MEETINGS = 3

function fmt(n: number): string {
  return n.toFixed(1)
}

export function rivalRecord(r: Pick<CareerRival, 'wins' | 'losses' | 'ties'>): string {
  return `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}`
}

/**
 * Weekly bests and worsts, streaks and rivalries from one list of games.
 *
 * ⚠ A STREAK IS PER LEAGUE-SEASON, NOT ACROSS THEM. The list is every league's
 * weeks; counting a run through it would chain a win in one league to a win in
 * another and report a fifty-game streak nobody played.
 */
export function weeklyRecords(games: CareerGame[]): { records: CareerRecord[]; rivals: CareerRival[] } {
  const records: CareerRecord[] = []
  if (games.length === 0) return { records, rivals: [] }
  const where = (g: CareerGame) => `${g.leagueName} · week ${g.week}, ${g.season}`

  const high = games.reduce((a, b) => (b.myScore > a.myScore ? b : a))
  const low = games.reduce((a, b) => (b.myScore < a.myScore ? b : a))
  records.push({ key: 'high-week', section: 'scoring', label: 'Highest single week', value: fmt(high.myScore), context: where(high), tone: 'accent' })
  records.push({ key: 'low-week', section: 'scoring', label: 'Lowest single week', value: fmt(low.myScore), context: where(low), tone: 'bad' })

  const wins = games.filter((g) => g.result === 'W')
  if (wins.length > 0) {
    const margin = (g: CareerGame) => g.myScore - g.oppScore
    const blowout = wins.reduce((a, b) => (margin(b) > margin(a) ? b : a))
    const closest = wins.reduce((a, b) => (margin(b) < margin(a) ? b : a))
    records.push({ key: 'blowout', section: 'scoring', label: 'Biggest blowout', value: `+${fmt(margin(blowout))}`, context: where(blowout), tone: 'good' })
    records.push({ key: 'closest', section: 'scoring', label: 'Closest win', value: `+${fmt(Math.max(0, margin(closest)))}`, context: where(closest), tone: 'good' })
  }

  const losses = games.filter((g) => g.result === 'L')
  if (losses.length > 0) {
    const deficit = (g: CareerGame) => g.oppScore - g.myScore
    const worst = losses.reduce((a, b) => (deficit(b) > deficit(a) ? b : a))
    records.push({ key: 'worst-loss', section: 'scoring', label: 'Heaviest defeat', value: `−${fmt(Math.max(0, deficit(worst)))}`, context: where(worst), tone: 'bad' })
  }

  const bySeries = new Map<string, CareerGame[]>()
  for (const g of games) {
    const k = `${g.leagueId}:${g.season}`
    const list = bySeries.get(k)
    if (list) list.push(g)
    else bySeries.set(k, [g])
  }

  let bestWin = { len: 0, name: '', season: 0 }
  let bestLoss = { len: 0, name: '', season: 0 }
  for (const series of bySeries.values()) {
    const sorted = [...series].sort((a, b) => a.week - b.week)
    const first = sorted[0]
    let runW = 0
    let runL = 0
    for (const g of sorted) {
      if (g.result === 'W') {
        runW += 1
        runL = 0
      } else if (g.result === 'L') {
        runL += 1
        runW = 0
      } else {
        // A tie ends both runs without starting either.
        runW = 0
        runL = 0
      }
      if (runW > bestWin.len) bestWin = { len: runW, name: first.leagueName, season: first.season }
      if (runL > bestLoss.len) bestLoss = { len: runL, name: first.leagueName, season: first.season }
    }
  }
  /*
   * ⚠ NO "MOST POINTS IN A SEASON" FROM WEEKLY GAMES. The season records carry it
   * from the league-season rows, which hold the provider's own season total; a sum
   * of the games that happen to be on file is a second, smaller answer to the
   * same question, and the page showed both side by side.
   */
  if (bestWin.len > 0) {
    records.push({ key: 'win-streak', section: 'streaks', label: 'Longest win streak', value: `${bestWin.len} gms`, context: `${bestWin.name} · ${bestWin.season}`, tone: 'good' })
  }
  if (bestLoss.len > 0) {
    records.push({ key: 'loss-streak', section: 'streaks', label: 'Longest losing streak', value: `${bestLoss.len} gms`, context: `${bestLoss.name} · ${bestLoss.season}`, tone: 'bad' })
  }

  const rivals = buildRivals(games)
  records.push(...rivalryRecords(rivals))
  return { records, rivals }
}

/**
 * Head-to-head by opponent.
 *
 * ⚠ ONE PERSON ACROSS LEAGUES IS ONE RIVAL. Opponents are keyed on the
 * provider's user id where the team carries one (98% measured), so the same
 * manager met in three leagues is one rivalry. A game with no resolvable
 * opponent is skipped rather than filed under "Unknown".
 */
export function buildRivals(games: CareerGame[]): CareerRival[] {
  type Acc = CareerRival & { leagueSet: Set<string>; seasonSet: Set<number> }
  const acc = new Map<string, Acc>()
  for (const g of games) {
    if (!g.oppKey) continue
    let r = acc.get(g.oppKey)
    if (!r) {
      r = {
        key: g.oppKey,
        name: g.oppName ?? 'Unnamed manager',
        meetings: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        leagues: [],
        seasons: [],
        lastSeason: g.season,
        leagueSet: new Set<string>(),
        seasonSet: new Set<number>(),
      }
      acc.set(g.oppKey, r)
    }
    r.meetings += 1
    if (g.result === 'W') r.wins += 1
    else if (g.result === 'L') r.losses += 1
    else r.ties += 1
    r.pointsFor += g.myScore
    r.pointsAgainst += g.oppScore
    r.leagueSet.add(g.leagueName)
    r.seasonSet.add(g.season)
    if (g.season >= r.lastSeason) {
      r.lastSeason = g.season
      if (g.oppName) r.name = g.oppName
    }
  }
  return [...acc.values()]
    .map(({ leagueSet, seasonSet, ...r }) => ({
      ...r,
      pointsFor: Math.round(r.pointsFor * 10) / 10,
      pointsAgainst: Math.round(r.pointsAgainst * 10) / 10,
      leagues: [...leagueSet].sort(),
      seasons: [...seasonSet].sort((a, b) => a - b),
    }))
    .sort((a, b) => b.meetings - a.meetings || b.wins - a.wins || a.name.localeCompare(b.name))
}

/** Most-played, best and toughest — best and toughest need `RIVAL_MIN_MEETINGS`. */
export function rivalryRecords(rivals: CareerRival[]): CareerRecord[] {
  const out: CareerRecord[] = []
  if (rivals.length === 0) return out
  const most = rivals[0]
  out.push({
    key: 'rival-most',
    section: 'rivalries',
    label: 'Most-played opponent',
    value: `${most.meetings} gms`,
    context: `${most.name} · ${rivalRecord(most)} · ${most.leagues.slice(0, 2).join(', ')}${most.leagues.length > 2 ? ` +${most.leagues.length - 2}` : ''}`,
    tone: 'accent',
  })
  const qualified = rivals.filter((r) => r.meetings >= RIVAL_MIN_MEETINGS)
  if (qualified.length === 0) return out
  const pct = (r: CareerRival) => (r.wins + r.ties / 2) / r.meetings
  const best = [...qualified].sort((a, b) => pct(b) - pct(a) || b.meetings - a.meetings)[0]
  const worst = [...qualified].sort((a, b) => pct(a) - pct(b) || b.meetings - a.meetings)[0]
  out.push({
    key: 'rival-best',
    section: 'rivalries',
    label: 'Best record vs one opponent',
    value: rivalRecord(best),
    context: `${best.name} · ${best.meetings} meetings`,
    tone: 'good',
  })
  if (worst.key !== best.key && pct(worst) < pct(best)) {
    out.push({
      key: 'rival-worst',
      section: 'rivalries',
      label: 'Toughest opponent',
      value: rivalRecord(worst),
      context: `${worst.name} · ${worst.meetings} meetings`,
      tone: 'bad',
    })
  }
  return out
}

/* ─────────────────────────── season records ─────────────────────────── */

/** Records from the league-season rows — the only source that reaches back to 2019. */
export function seasonRecords(rows: CareerRow[]): CareerRecord[] {
  const out: CareerRecord[] = []
  const counted = rows.filter((r) => r.counted && r.wins + r.losses + r.ties > 0)
  if (counted.length === 0) return out
  const games = (r: CareerRow) => r.wins + r.losses + r.ties
  const pct = (r: CareerRow) => (r.wins + r.ties / 2) / games(r)
  const label = (r: CareerRow) => `${r.leagueName} · ${r.season}`

  const eligible = counted.filter((r) => games(r) >= 6)
  if (eligible.length > 0) {
    const best = [...eligible].sort((a, b) => pct(b) - pct(a) || games(b) - games(a) || b.season - a.season)[0]
    out.push({
      key: 'best-record',
      section: 'seasons',
      label: 'Best regular season',
      value: recordLine(best.wins, best.losses, best.ties) ?? '—',
      context: `${label(best)}${best.isChampion ? ' · champion' : ''}`,
      tone: 'good',
    })
  }

  const withPoints = counted.filter((r) => r.pointsFor != null)
  if (withPoints.length > 0) {
    const most = withPoints.reduce((a, b) => ((b.pointsFor as number) > (a.pointsFor as number) ? b : a))
    out.push({
      key: 'most-points-season',
      section: 'seasons',
      label: 'Most points in a season',
      value: (most.pointsFor as number).toLocaleString('en-US', { maximumFractionDigits: 1 }),
      context: `${label(most)} · ${games(most)} games`,
      tone: 'accent',
    })
    const ppgEligible = withPoints.filter((r) => games(r) >= 6)
    if (ppgEligible.length > 0) {
      const ppg = (r: CareerRow) => (r.pointsFor as number) / games(r)
      const top = ppgEligible.reduce((a, b) => (ppg(b) > ppg(a) ? b : a))
      out.push({
        key: 'best-ppg',
        section: 'seasons',
        label: 'Best points per game',
        value: fmt(ppg(top)),
        context: label(top),
        tone: 'accent',
      })
    }
  }

  // Titles and runs inside one league — the dynasty records.
  const byLeague = new Map<string, CareerRow[]>()
  for (const r of rows.filter((x) => x.counted)) {
    const list = byLeague.get(r.leagueKey)
    if (list) list.push(r)
    else byLeague.set(r.leagueKey, [r])
  }
  let mostTitles: { name: string; titles: number; seasons: number[] } | null = null
  let titleRun: { name: string; len: number; end: number } | null = null
  let playoffRun: { name: string; len: number; end: number } | null = null
  for (const list of byLeague.values()) {
    const sorted = [...list].sort((a, b) => a.season - b.season)
    const titles = sorted.filter((r) => r.isChampion)
    if (titles.length > 0 && (!mostTitles || titles.length > mostTitles.titles)) {
      mostTitles = { name: sorted[sorted.length - 1].leagueName, titles: titles.length, seasons: titles.map((t) => t.season) }
    }
    let tRun = 0
    let pRun = 0
    let prev: number | null = null
    for (const r of sorted) {
      const consecutive = prev != null && r.season === prev + 1
      tRun = r.isChampion ? (consecutive ? tRun + 1 : 1) : 0
      pRun = r.playoffKnown && r.madePlayoffs ? (consecutive ? pRun + 1 : 1) : 0
      if (tRun > 0 && (!titleRun || tRun > titleRun.len)) titleRun = { name: r.leagueName, len: tRun, end: r.season }
      if (pRun > 0 && (!playoffRun || pRun > playoffRun.len)) playoffRun = { name: r.leagueName, len: pRun, end: r.season }
      prev = r.season
    }
  }
  if (mostTitles && mostTitles.titles > 1) {
    out.push({
      key: 'league-titles',
      section: 'seasons',
      label: 'Most titles in one league',
      value: String(mostTitles.titles),
      context: `${mostTitles.name} · ${mostTitles.seasons.join(', ')}`,
      tone: 'warn',
    })
  }
  if (titleRun && titleRun.len > 1) {
    out.push({
      key: 'title-streak',
      section: 'streaks',
      label: 'Consecutive titles',
      value: `${titleRun.len} in a row`,
      context: `${titleRun.name} · ${titleRun.end - titleRun.len + 1}–${titleRun.end}`,
      tone: 'warn',
    })
  }
  if (playoffRun && playoffRun.len > 1) {
    out.push({
      key: 'playoff-streak',
      section: 'streaks',
      label: 'Consecutive playoff berths',
      value: `${playoffRun.len} seasons`,
      context: `${playoffRun.name} · ${playoffRun.end - playoffRun.len + 1}–${playoffRun.end}`,
      tone: 'good',
    })
  }

  const bySeason = new Map<number, number>()
  for (const r of counted) bySeason.set(r.season, (bySeason.get(r.season) ?? 0) + 1)
  const busiest = [...bySeason.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]
  if (busiest && busiest[1] > 1) {
    out.push({
      key: 'busiest-year',
      section: 'seasons',
      label: 'Most leagues finished in a year',
      value: String(busiest[1]),
      context: `${busiest[0]}`,
      tone: 'accent',
    })
  }
  return out
}

/* ─────────────────────────── trade records ──────────────────────────── */

export type GradedTradeFact = {
  id: string
  date: string
  season: number
  leagueName: string
  /** Net points the pieces produced for you since the trade. */
  net: number
  initialGrade: string
  currentGrade: string
  received: string[]
  sent: string[]
  partner: string
}

export type TradeCountFact = { season: number; leagueKey: string | null; count: number; maxAssets: number }

export function tradeRecords(counts: TradeCountFact[], graded: GradedTradeFact[]): CareerRecord[] {
  const out: CareerRecord[] = []
  if (counts.length > 0) {
    const bySeason = new Map<number, number>()
    for (const c of counts) bySeason.set(c.season, (bySeason.get(c.season) ?? 0) + c.count)
    const top = [...bySeason.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]
    out.push({
      key: 'trades-season',
      section: 'trades',
      label: 'Most trades in a season',
      value: String(top[1]),
      context: `${top[0]} · across your leagues`,
      tone: 'warn',
    })
    const biggest = counts.reduce((a, b) => (b.maxAssets > a.maxAssets ? b : a))
    if (biggest.maxAssets > 2) {
      out.push({
        key: 'trade-size',
        section: 'trades',
        label: 'Biggest trade by pieces moved',
        value: `${biggest.maxAssets} assets`,
        context: `${biggest.season}${biggest.leagueKey ? '' : ' · league not on file'}`,
        tone: 'accent',
      })
    }
  }
  if (graded.length > 0) {
    const best = graded.reduce((a, b) => (b.net > a.net ? b : a))
    const worst = graded.reduce((a, b) => (b.net < a.net ? b : a))
    out.push({
      key: 'trade-best',
      section: 'trades',
      label: 'Best trade',
      value: `${best.net >= 0 ? '+' : ''}${Math.round(best.net)} pts`,
      context: `${best.leagueName} · ${best.season} · got ${best.received.slice(0, 2).join(', ') || 'picks'} · now ${best.currentGrade}`,
      tone: 'good',
    })
    if (worst.id !== best.id && worst.net < 0) {
      out.push({
        key: 'trade-worst',
        section: 'trades',
        label: 'Trade that hurt most',
        value: `${Math.round(worst.net)} pts`,
        context: `${worst.leagueName} · ${worst.season} · gave ${worst.sent.slice(0, 2).join(', ') || 'picks'} · now ${worst.currentGrade}`,
        tone: 'bad',
      })
    }
  }
  return out
}

/* ─────────────────────────── draft records ──────────────────────────── */

export type DraftCardFact = {
  season: number
  leagueName: string
  grade: string
  score: number
  picks: number
  scoringNote: string | null
}

export type DraftStealFact = {
  season: number
  leagueName: string
  playerName: string
  round: number
  pickNo: number
  valueOver: number
}

export function draftRecords(cards: DraftCardFact[], steals: DraftStealFact[], picksOnFile: number): CareerRecord[] {
  const out: CareerRecord[] = []
  if (cards.length > 0) {
    const best = cards.reduce((a, b) => (b.score > a.score ? b : a))
    out.push({
      key: 'draft-best',
      section: 'drafts',
      label: 'Best draft',
      value: best.grade,
      context: `${best.leagueName} · ${best.season} · ${best.picks} picks graded`,
      tone: 'good',
    })
    const worst = cards.reduce((a, b) => (b.score < a.score ? b : a))
    if (cards.length > 1 && worst.score < best.score) {
      out.push({
        key: 'draft-worst',
        section: 'drafts',
        label: 'Toughest draft',
        value: worst.grade,
        context: `${worst.leagueName} · ${worst.season}`,
        tone: 'bad',
      })
    }
  }
  if (steals.length > 0) {
    const steal = steals.reduce((a, b) => (b.valueOver > a.valueOver ? b : a))
    out.push({
      key: 'draft-steal',
      section: 'drafts',
      label: 'Best value pick',
      value: `+${Math.round(steal.valueOver)}`,
      context: `${steal.playerName} · round ${steal.round}, pick ${steal.pickNo} · ${steal.leagueName} ${steal.season}`,
      tone: 'good',
    })
  }
  if (picksOnFile > 0) {
    out.push({
      key: 'draft-picks',
      section: 'drafts',
      label: 'Draft picks on file',
      value: picksOnFile.toLocaleString('en-US'),
      context: 'every pick your teams made in drafts we have imported',
      tone: 'accent',
    })
  }
  return out
}
