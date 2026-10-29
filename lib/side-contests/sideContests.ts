/**
 * WEEKLY SIDE CONTESTS — high score and closest loss, each with an optional prize per week.
 *
 *   high score     the team with the most points that week, across the whole league
 *   closest loss   the team that lost its matchup by the fewest points ("heartbreak")
 *
 * The commissioner turns each on and may set a prize per week. Results are WORKED OUT FROM THE STORED
 * FINAL SCORES every time they are read, never stored: a commissioner's score adjustment or an applied
 * stat correction moves the stored score (lib/score-adjustments), so the winner follows it with nothing
 * to keep in sync.
 *
 *   counted        regular-season weeks whose real matchups are all final (lib/redraft/weekSealed.ts)
 *   not counted    playoff and consolation weeks, byes, and median-only rows — a bye team has no score
 *   a tie          every tied team wins, and they split that week's prize evenly
 *   a tied game    neither team lost, so neither is in the closest-loss running
 *
 * The prize totals per team (`prizeTotals`) are what the payout calculator sums. AllFantasy tracks
 * the money; it does not move it.
 *
 * Pure.
 */
import { isSealedWeek } from '@/lib/redraft/weekSealed'

/**
 * League.settings key. "prize" in the name puts it under the co-commissioner MONEY scope
 * (lib/league/coCommissionerScopes.ts), with dues and payouts.
 */
export const SIDE_CONTESTS_KEY = 'weekly_prize_contests'

export const CONTEST_KINDS = ['high_score', 'closest_loss'] as const
export type ContestKind = (typeof CONTEST_KINDS)[number]

export type ContestConfig = { enabled: boolean; prizeCents: number }
export type SideContestsConfig = Record<ContestKind, ContestConfig>

/** $10,000 a week is far past any real side pot; anything bigger is a typo. */
export const MAX_PRIZE_CENTS = 1_000_000

export const CONTEST_LABELS: Record<ContestKind, { en: string; es: string; helpEn: string; helpEs: string }> = {
  high_score: {
    en: 'Weekly high score',
    es: 'Puntuación más alta de la semana',
    helpEn: 'The team with the most points that week.',
    helpEs: 'El equipo con más puntos de la semana.',
  },
  closest_loss: {
    en: 'Closest loss',
    es: 'Derrota más ajustada',
    helpEn: 'The team that lost by the fewest points that week.',
    helpEs: 'El equipo que perdió por menos puntos esa semana.',
  },
}

const OFF: ContestConfig = { enabled: false, prizeCents: 0 }

function readOne(raw: unknown): ContestConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return OFF
  const o = raw as Record<string, unknown>
  const cents = typeof o.prizeCents === 'number' && Number.isInteger(o.prizeCents) && o.prizeCents >= 0 && o.prizeCents <= MAX_PRIZE_CENTS ? o.prizeCents : 0
  return { enabled: o.enabled === true, prizeCents: cents }
}

export function readSideContests(settings: unknown): SideContestsConfig {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[SIDE_CONTESTS_KEY] : null
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return { high_score: readOne(o.high_score), closest_loss: readOne(o.closest_loss) }
}

export type ParseResult = { ok: true; value: SideContestsConfig } | { ok: false; error: string }

/**
 * A commissioner's save. Each contest is `{ enabled, prize }` where `prize` is dollars (a number, or a
 * string like "25" or "12.50"); empty means no prize. A contest left out is saved as off; an unknown
 * one is refused rather than kept.
 */
export function parseSideContestsInput(body: unknown): ParseResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Send the contests to save.' }
  const o = body as Record<string, unknown>
  for (const key of Object.keys(o)) {
    if (!(CONTEST_KINDS as readonly string[]).includes(key)) return { ok: false, error: `Unknown contest: ${key}.` }
  }
  const value = { high_score: OFF, closest_loss: OFF } as SideContestsConfig
  for (const kind of CONTEST_KINDS) {
    const c = o[kind]
    if (c == null) continue
    if (typeof c !== 'object' || Array.isArray(c)) return { ok: false, error: `${CONTEST_LABELS[kind].en}: send whether it is on and its prize.` }
    const { enabled, prize } = c as Record<string, unknown>
    if (typeof enabled !== 'boolean') return { ok: false, error: `${CONTEST_LABELS[kind].en}: say whether it is on.` }
    const cents = parsePrize(prize)
    if (cents == null) return { ok: false, error: `${CONTEST_LABELS[kind].en}: the prize must be a dollar amount from $0 to $10,000, to the cent.` }
    value[kind] = { enabled, prizeCents: cents }
  }
  return { ok: true, value }
}

/** Dollars to cents. Empty or missing is $0. Null when it is not an amount. */
export function parsePrize(raw: unknown): number | null {
  if (raw == null || raw === '') return 0
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim().replace(/^\$/, '') : null
  if (text == null || !/^\d+(\.\d{1,2})?$/.test(text)) return null
  const cents = Math.round(Number(text) * 100)
  return cents <= MAX_PRIZE_CENTS ? cents : null
}

export function formatPrize(cents: number): string {
  const dollars = cents / 100
  return `$${Number.isInteger(dollars) ? dollars.toFixed(0) : dollars.toFixed(2)}`
}

export type ContestMatchup = {
  id: string
  week: number
  type: string | null
  status: string | null
  homeRosterId: string
  awayRosterId: string | null
  homeScore: number
  awayScore: number
  isMedianMatchup?: boolean | null
}

export type ContestWinner = {
  rosterId: string
  /** The winning score (high score) or the losing margin (closest loss). */
  value: number
  /** Their share of the week's prize, in cents; can be fractional when a tie splits it. */
  prizeCents: number
  /** Closest loss: who beat them, and with what. */
  opponentRosterId?: string
}

export type WeekResult = { week: number; contests: Partial<Record<ContestKind, ContestWinner[]>> }

const round2 = (n: number) => Math.round(n * 100) / 100
const isRegular = (m: ContestMatchup) => !m.type || m.type === 'regular'
const isRealGame = (m: ContestMatchup) => m.awayRosterId !== null && !m.isMedianMatchup

function split(rows: Array<Omit<ContestWinner, 'prizeCents'>>, prizeCents: number): ContestWinner[] {
  return rows.map((r) => ({ ...r, prizeCents: rows.length ? prizeCents / rows.length : 0 }))
}

/**
 * Every finished regular-season week's winners, oldest first. Only the contests switched on appear; a
 * week whose games are not all final is left out until they are.
 */
export function weeklyResults(matchups: readonly ContestMatchup[], config: SideContestsConfig): WeekResult[] {
  const byWeek = new Map<number, ContestMatchup[]>()
  for (const m of matchups) if (isRegular(m)) byWeek.set(m.week, [...(byWeek.get(m.week) ?? []), m])

  const out: WeekResult[] = []
  for (const week of [...byWeek.keys()].sort((a, b) => a - b)) {
    const rows = byWeek.get(week)!
    if (!isSealedWeek(rows)) continue
    const games = rows.filter(isRealGame)
    if (games.length === 0) continue
    const result: WeekResult = { week, contests: {} }

    if (config.high_score.enabled) {
      const scores = new Map<string, number>()
      for (const g of games) {
        scores.set(g.homeRosterId, Math.max(scores.get(g.homeRosterId) ?? -Infinity, round2(g.homeScore)))
        scores.set(g.awayRosterId!, Math.max(scores.get(g.awayRosterId!) ?? -Infinity, round2(g.awayScore)))
      }
      const top = Math.max(...scores.values())
      const winners = [...scores].filter(([, s]) => s === top).map(([rosterId, value]) => ({ rosterId, value }))
      result.contests.high_score = split(winners, config.high_score.prizeCents)
    }

    if (config.closest_loss.enabled) {
      const losses = games.flatMap((g) => {
        const margin = round2(Math.abs(g.homeScore - g.awayScore))
        if (margin === 0) return []
        const homeLost = g.homeScore < g.awayScore
        return [{
          rosterId: homeLost ? g.homeRosterId : g.awayRosterId!,
          opponentRosterId: homeLost ? g.awayRosterId! : g.homeRosterId,
          value: margin,
        }]
      })
      if (losses.length) {
        const closest = Math.min(...losses.map((l) => l.value))
        result.contests.closest_loss = split(losses.filter((l) => l.value === closest), config.closest_loss.prizeCents)
      }
    }

    if (Object.keys(result.contests).length) out.push(result)
  }
  return out
}

export type PrizeTotal = { rosterId: string; wins: Record<ContestKind, number>; prizeCents: number }

/**
 * The season so far, per team: contests won and prize money, most money first. What the payout
 * calculator sums. Each team's cents are rounded once, at the end, so a split prize never drifts by a
 * cent per week: $10 split three ways every week for 13 weeks is $43.33 each, not 13 × $3.33.
 */
export function prizeTotals(results: readonly WeekResult[]): PrizeTotal[] {
  const by = new Map<string, { wins: Record<ContestKind, number>; cents: number }>()
  for (const w of results) {
    for (const kind of CONTEST_KINDS) {
      for (const winner of w.contests[kind] ?? []) {
        const t = by.get(winner.rosterId) ?? { wins: { high_score: 0, closest_loss: 0 }, cents: 0 }
        t.wins[kind] += 1
        t.cents += winner.prizeCents
        by.set(winner.rosterId, t)
      }
    }
  }
  return [...by]
    .map(([rosterId, t]) => ({ rosterId, wins: t.wins, prizeCents: Math.round(t.cents) }))
    .sort((a, b) => b.prizeCents - a.prizeCents || b.wins.high_score + b.wins.closest_loss - (a.wins.high_score + a.wins.closest_loss) || a.rosterId.localeCompare(b.rosterId))
}

/** What the league sees (lib/side-contests/sideContestsService.ts builds it). */
export type NamedWinner = ContestWinner & { teamName: string; opponentName?: string }

export type SideContestsView = {
  /** False outside leagues AllFantasy scores itself; there are no stored matchups to read. */
  native: boolean
  canEdit: boolean
  config: SideContestsConfig
  season: number | null
  /** Newest week first. */
  weeks: Array<{ week: number; contests: Partial<Record<ContestKind, NamedWinner[]>> }>
  totals: Array<{ rosterId: string; teamName: string; wins: Record<ContestKind, number>; prizeCents: number }>
}
