/**
 * The Matchup screen's "scoring environment" — the betting market read as a FORECAST of how many
 * points each of your starters' offenses is expected to score this week.
 *
 * PURE: no Prisma, no fetch. The route (`app/api/core/matchup-market`) does the one DB read through
 * `lib/odds/gameOddsReads.ts` and hands the result to `pickMarketForTeams`; the panel
 * (`components/core-app/MatchupMarketPanel.tsx`) joins it onto the lineup with `buildMarketRows`.
 *
 * History: this panel was built 2026-09-10 (9de0c7df0) inside `MatchupPrepModal`, a modal nothing
 * had mounted since July, so nobody ever saw it; it went with the rest of `components/ai-tools` in
 * f6a1405cd. Restored onto /core Matchup 2026-10-06.
 *
 * 🛑 NOT A BETTING SURFACE. `readWeekMarketContextByTeam` returns forecast fields only — no prices,
 * no sportsbook names — and the payload below narrows that further: no win probability either,
 * because the screen's own "Win probability" is the FANTASY head-to-head and an NFL team's chance of
 * winning its game sitting under it is the likeliest misreading this panel could invite.
 */
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import type { MatchupPlayerCell, MatchupSlot } from '@/lib/core-app/matchup'

/** One club's game environment, from that club's point of view. What the route sends. */
export type MatchupMarketTeam = {
  opponent: string | null
  isHome: boolean
  /** Points this club is implied to score. Null when only one side of the market parsed. */
  impliedTeamTotal: number | null
  /** Negative = favored, from THIS club's side. */
  spread: number | null
  gameTotal: number | null
  isStale: boolean
}

/** The route's response body. A requested club with no read this week maps to null, never to zeros. */
export type MatchupMarketResponse = { teams: Record<string, MatchupMarketTeam | null> }

/** The subset of `TeamMarketContext` this module reads — kept structural so it needs no server import. */
type MarketSource = {
  opponent: string | null
  isHome: boolean
  impliedTeamTotal: number | null
  spread: number | null
  gameTotal: number | null
  isStale: boolean
}

/**
 * Answer for exactly the clubs asked about, keyed by the code AS ASKED.
 *
 * ⚠ BOTH SIDES OF THE JOIN GO THROUGH `normalizeTeamAbbrev`. The map is keyed on the canonical code
 * (see `readWeekMarketContextByTeam`), and a roster can still carry an alias (JAC, WSH, LA) — looking
 * the raw code up would drop that starter silently, with no error and no gap.
 */
export function pickMarketForTeams(
  byTeam: ReadonlyMap<string, MarketSource>,
  teams: readonly string[],
): MatchupMarketResponse {
  const out: Record<string, MatchupMarketTeam | null> = {}
  for (const raw of teams) {
    const key = normalizeTeamAbbrev(raw) ?? raw
    const m = byTeam.get(key)
    out[raw] = m
      ? {
          opponent: m.opponent,
          isHome: m.isHome,
          impliedTeamTotal: m.impliedTeamTotal,
          spread: m.spread,
          gameTotal: m.gameTotal,
          isStale: m.isStale,
        }
      : null
  }
  return { teams: out }
}

/** A starter the panel can ask about: named, with a club, actually in a slot. */
export type MarketStarter = { key: string; name: string; team: string }

/**
 * Your starters, in board order. Empty slots, unresolved ids and club-less players are left out —
 * there is nothing to ask the market about them. Never the opponent's: the panel is about YOUR
 * lineup decisions, as it was in the prep modal.
 */
export function marketStarters(slots: readonly MatchupSlot[]): MarketStarter[] {
  return slots
    .map((s) => s.you)
    .filter((c): c is MatchupPlayerCell => c != null && !c.empty && !!c.name && !!c.team)
    .map((c) => ({ key: c.playerId, name: c.name as string, team: c.team as string }))
}

/** Only NFL has a market feed (`game_odds` is fed by the API-Sports American Football endpoints). */
export function isMarketSport(slots: readonly MatchupSlot[]): boolean {
  const sports = slots
    .map((s) => s.you?.sport)
    .filter((x): x is string => !!x)
    .map((x) => x.toUpperCase())
  return sports.length > 0 && sports.every((x) => x === 'NFL')
}

export type MarketRow = {
  key: string
  name: string
  team: string
  impliedTeamTotal: number
  spread: number | null
  gameTotal: number | null
  opponent: string | null
  isHome: boolean
  isStale: boolean
}

/**
 * Join the starters onto the market read.
 *
 * A starter whose club has no read — no line posted yet, or a game not in the feed — is COUNTED in
 * `withoutRead`, never rendered as "—" or "0.0": a zero is the plausible-looking kind of wrong this
 * feature exists to avoid. The same goes for a read whose implied total is null. Highest-scoring
 * environment first, the order a lineup decision reads in.
 */
export function buildMarketRows(
  starters: readonly MarketStarter[],
  teams: Readonly<Record<string, MatchupMarketTeam | null>>,
): { rows: MarketRow[]; withoutRead: number } {
  const rows: MarketRow[] = []
  let withoutRead = 0
  for (const s of starters) {
    const m = teams[s.team]
    if (!m || m.impliedTeamTotal == null || !Number.isFinite(m.impliedTeamTotal)) {
      withoutRead++
      continue
    }
    rows.push({
      key: s.key,
      name: s.name,
      team: s.team,
      impliedTeamTotal: m.impliedTeamTotal,
      spread: m.spread,
      gameTotal: m.gameTotal,
      opponent: m.opponent,
      isHome: m.isHome,
      isStale: m.isStale,
    })
  }
  rows.sort((a, b) => b.impliedTeamTotal - a.impliedTeamTotal)
  return { rows, withoutRead }
}
