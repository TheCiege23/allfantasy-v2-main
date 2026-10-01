import type { OutlookLeague, SeasonOutlook } from '@/lib/core-app/seasonOutlook'

/**
 * `/core/standings` with no league held — the cross-league board's view model.
 *
 * Pure derivation over `SeasonOutlook`, which already carries everything below: the simulation's
 * playoff / bye / title odds, clinch and elimination status by arithmetic, all-play expected wins and
 * each contested league's swing game. The old board printed two of those numbers for ten leagues and
 * dropped the rest; this module is what lets the board use them without a second loader.
 *
 * ⚠ SEED, NOT POINTS FOR, IS STILL THE CROSS-LEAGUE AXIS. Points-for only means something inside one
 * league. Everything ranked here across leagues is a seed, a probability or a count of wins — all
 * three mean the same thing in a 10-team PPR league as in a 32-team superflex one.
 *
 * ⚠ THE SLIM ROW IS WHAT CROSSES TO THE CLIENT. `OutlookLeague` carries every team, the assumptions
 * block and (for one league) the focus object; serialising that for 60+ leagues to drive a filter
 * would ship the simulation's working to the browser. Rows carry only what the board draws.
 */

export type Tier = 'clinched' | 'control' | 'bubble' | 'longshot' | 'out'

export const TIER_ORDER: readonly Tier[] = ['clinched', 'control', 'bubble', 'longshot', 'out']

export const TIER_LABEL: Record<Tier, string> = {
  clinched: 'Clinched',
  control: 'In control',
  bubble: 'On the bubble',
  longshot: 'Long shot',
  out: 'Out',
}

/** Above this the field is all but locked in; below the lower one, all but gone. Same lines as before. */
export const SAFE_PCT = 60
export const LONG_SHOT_PCT = 25

/** A record this far from what the scores earned is worth naming. Under one win it is noise. */
export const LUCK_THRESHOLD = 1

/** A swing game is only worth a badge on the row when the result moves the odds this much. */
export const SWING_BADGE_PTS = 15

export type StandingsRow = {
  id: string
  name: string
  platform: string
  href: string
  seed: number
  teams: number
  playoffTeams: number
  byeTeams: number
  /** Null when no game has been played — never "0-0", which states a result. */
  record: string | null
  wins: number
  losses: number
  /** Rounded playoff odds, 0–100. */
  pct: number
  titlePct: number
  /** False when too few weeks to model this team — the percentage is the prior. */
  modelled: boolean
  tier: Tier
  inField: boolean
  inBye: boolean
  /** Wins minus all-play expected wins. Positive = the record flatters the scores. Null when unknown. */
  luck: number | null
  decides: string
  weeksRemaining: number
  swing: { week: number; opponent: string | null; ifWin: number; ifLose: number; clinchOnWin: boolean } | null
}

export type Spotlight = {
  key: 'top' | 'game' | 'title' | 'lucky' | 'robbed'
  label: string
  value: string
  league: string
  detail: string
  href: string
  tone: 'good' | 'warn' | 'bad' | 'accent'
}

export type StandingsPortfolio = {
  rows: StandingsRow[]
  /** Leagues with a simulated season where we could not tell which team is yours. */
  unidentified: number
  tierCounts: Record<Tier, number>
  stats: {
    leagues: number
    inFieldNow: number
    topSeeds: number
    clinched: number
    /** Sum of playoff probabilities — the number of playoff berths the simulation expects you to earn. */
    expectedBerths: number
    wins: number
    losses: number
  }
  headline: string
  spotlights: Spotlight[]
  /** Withheld leagues grouped by their reason, so one repeated reason is printed once. */
  withheld: Array<{ reason: string; leagues: string[] }>
  anyUnmodelled: boolean
}

type Ranked = OutlookLeague & { you: NonNullable<OutlookLeague['you']> }

export function tierOf(pct: number, status: 'clinched' | 'eliminated' | null | undefined): Tier {
  if (status === 'clinched') return 'clinched'
  if (status === 'eliminated') return 'out'
  const r = Math.round(pct)
  if (r >= 100) return 'clinched'
  if (r <= 0) return 'out'
  if (pct >= SAFE_PCT) return 'control'
  if (pct >= LONG_SHOT_PCT) return 'bubble'
  return 'longshot'
}

function signed(v: number): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}

export function toRow(league: Ranked, swing: SeasonOutlook['swingByLeague'][string] | undefined): StandingsRow {
  const you = league.you
  const played = you.wins + you.losses
  const pct = Math.round(you.playoffPct)
  const expected = typeof you.expectedWins === 'number' && Number.isFinite(you.expectedWins) ? you.expectedWins : null
  return {
    id: league.leagueId,
    name: league.leagueName,
    platform: league.platform,
    href: league.href,
    seed: you.seed,
    teams: league.teams.length,
    playoffTeams: league.playoffTeams,
    byeTeams: league.byeTeams ?? 0,
    record: played === 0 ? null : `${you.wins}-${you.losses}`,
    wins: you.wins,
    losses: you.losses,
    pct,
    titlePct: Math.round(you.titlePct ?? 0),
    modelled: you.modelled,
    tier: tierOf(you.playoffPct, you.status),
    inField: you.seed <= league.playoffTeams,
    inBye: (league.byeTeams ?? 0) > 0 && you.seed <= (league.byeTeams ?? 0),
    luck: expected != null && played > 0 ? Math.round((you.wins - expected) * 10) / 10 : null,
    decides: league.whatDecidesIt,
    weeksRemaining: league.weeksRemaining ?? 0,
    swing: swing
      ? {
          week: swing.week,
          opponent: swing.opponentName,
          ifWin: Math.round(swing.ifWin),
          ifLose: Math.round(swing.ifLose),
          clinchOnWin: swing.clinchOnWin,
        }
      : null,
  }
}

/** Strongest position first: seed, then odds as the tiebreak — a #1 of 12 outranks a #2 of 10. */
export function bySeed(a: StandingsRow, b: StandingsRow): number {
  return a.seed - b.seed || b.pct - a.pct || a.name.localeCompare(b.name)
}

export function byOdds(a: StandingsRow, b: StandingsRow): number {
  return b.pct - a.pct || a.seed - b.seed || a.name.localeCompare(b.name)
}

export function buildStandingsPortfolio(outlook: SeasonOutlook): StandingsPortfolio {
  const ranked = outlook.leagues.filter((l): l is Ranked => l.you != null)
  const swings = outlook.swingByLeague ?? {}
  const rows = ranked.map((l) => toRow(l, swings[l.leagueId])).sort(byOdds)

  const tierCounts: Record<Tier, number> = { clinched: 0, control: 0, bubble: 0, longshot: 0, out: 0 }
  for (const r of rows) tierCounts[r.tier] += 1

  const stats = {
    leagues: rows.length,
    inFieldNow: rows.filter((r) => r.inField && r.record != null).length,
    topSeeds: rows.filter((r) => r.seed === 1 && r.record != null).length,
    clinched: tierCounts.clinched,
    expectedBerths: Math.round(ranked.reduce((s, l) => s + l.you.playoffPct, 0)) / 100,
    wins: rows.reduce((s, r) => s + r.wins, 0),
    losses: rows.reduce((s, r) => s + r.losses, 0),
  }

  const headline =
    rows.length === 0
      ? ''
      : stats.wins + stats.losses === 0
        ? `${plural(rows.length, 'league')} on the board — no games final yet.`
        : `In a playoff spot in ${stats.inFieldNow} of ${plural(rows.length, 'league')}` +
          (stats.topSeeds > 0 ? `, holding the #1 seed in ${stats.topSeeds}` : '') +
          '.'

  return {
    rows,
    unidentified: outlook.leagues.length - ranked.length,
    tierCounts,
    stats,
    headline,
    spotlights: spotlightsFor(rows, outlook),
    withheld: groupWithheld(outlook.withheld ?? []),
    anyUnmodelled: rows.some((r) => !r.modelled),
  }
}

function spotlightsFor(rows: StandingsRow[], outlook: SeasonOutlook): Spotlight[] {
  const out: Spotlight[] = []
  const played = rows.filter((r) => r.record != null)

  const top = [...played].sort(bySeed)[0]
  if (top) {
    out.push({
      key: 'top',
      label: 'Best seat',
      value: `#${top.seed} of ${top.teams}`,
      league: top.name,
      detail: `${top.record} · ${top.pct}%${top.modelled ? '' : '*'} playoff odds`,
      href: top.href,
      tone: 'good',
    })
  }

  /*
   * ⚠ THE SAME GAME SEASON OUTLOOK LEADS WITH, ON PURPOSE. This board is about where you sit; that one
   * game is the fastest way the seat changes, so it is surfaced here and links to the league.
   */
  const game = outlook.weekThatMatters
  if (game) {
    const row = rows.find((r) => r.id === game.leagueId)
    out.push({
      key: 'game',
      label: 'Game that matters',
      value: `${Math.round(game.swing)} pts`,
      league: game.leagueName,
      detail:
        `Week ${game.week}${game.opponentName ? ` vs ${game.opponentName}` : ''} — ` +
        (game.clinchOnWin
          ? `win and you are in; lose and it drops to ${Math.round(game.ifLose)}%.`
          : `win: ${Math.round(game.ifWin)}%, lose: ${Math.round(game.ifLose)}%.`),
      href: row?.href ?? `/core/season-outlook?league=${encodeURIComponent(game.leagueId)}`,
      tone: 'accent',
    })
  }

  const title = [...rows].sort((a, b) => b.titlePct - a.titlePct)[0]
  if (title && title.titlePct > 0) {
    out.push({
      key: 'title',
      label: 'Best title shot',
      value: `${title.titlePct}%`,
      league: title.name,
      detail: `#${title.seed} of ${title.teams} today`,
      href: title.href,
      tone: 'accent',
    })
  }

  const withLuck = rows.filter((r): r is StandingsRow & { luck: number } => r.luck != null)
  const lucky = [...withLuck].sort((a, b) => b.luck - a.luck)[0]
  if (lucky && lucky.luck >= LUCK_THRESHOLD) {
    out.push({
      key: 'lucky',
      label: 'Luckiest record',
      value: `${signed(lucky.luck)} W`,
      league: lucky.name,
      detail: `${lucky.record}, but your scores earned ${(lucky.wins - lucky.luck).toFixed(1)} wins against the whole league.`,
      href: lucky.href,
      tone: 'warn',
    })
  }
  const robbed = [...withLuck].sort((a, b) => a.luck - b.luck)[0]
  if (robbed && robbed.luck <= -LUCK_THRESHOLD) {
    out.push({
      key: 'robbed',
      label: 'Most robbed',
      value: `${signed(robbed.luck)} W`,
      league: robbed.name,
      detail: `${robbed.record}, but your scores earned ${(robbed.wins - robbed.luck).toFixed(1)} wins against the whole league.`,
      href: robbed.href,
      tone: 'bad',
    })
  }
  return out
}

/**
 * ⚠ ONE REASON, PRINTED ONCE. The old note joined `name (reason)` for each withheld league, so twenty
 * guillotine leagues missing the same schedule printed the same forty-word sentence twenty times and
 * still cut off at four. Grouping keeps every league named and every reason stated.
 */
export function groupWithheld(withheld: SeasonOutlook['withheld']): StandingsPortfolio['withheld'] {
  const byReason = new Map<string, string[]>()
  for (const w of withheld) {
    const list = byReason.get(w.reason)
    if (list) list.push(w.leagueName)
    else byReason.set(w.reason, [w.leagueName])
  }
  return [...byReason.entries()]
    .map(([reason, leagues]) => ({ reason, leagues }))
    .sort((a, b) => b.leagues.length - a.leagues.length)
}
