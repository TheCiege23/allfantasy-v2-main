/**
 * Pure pieces of the Zombie home summary (`/api/leagues/[leagueId]/zombie/summary`): which week to show,
 * which scene to paint, which matchup is the viewer's, and what to call each team. No IO.
 */
import { ZOMBIE_THEME_LIST, getZombieTheme, type ZombieBackgroundTheme } from '@/lib/zombie/zombieBackgroundThemes'
import { matchTeamIdForRoster, type TeamIdentityRow } from '@/lib/leagues/rosterTeamIdentity'
import type { NativeWeekResult } from '@/lib/zombie/ZombieInfectionEngine'

/**
 * The league's scene. `ZombieLeague.themeLabel` holds the commissioner's (or setup's random) pick; a league
 * created without one gets a theme derived from its id, so the header is the same on every visit rather
 * than re-rolled per render.
 */
export function zombieThemeForLeague(themeLabel: string | null | undefined, leagueId: string): ZombieBackgroundTheme {
  const chosen = getZombieTheme(themeLabel)
  if (chosen) return chosen.id
  let h = 0
  for (let i = 0; i < leagueId.length; i++) h = (h * 31 + leagueId.charCodeAt(i)) >>> 0
  return ZOMBIE_THEME_LIST[h % ZOMBIE_THEME_LIST.length]!.id
}

/**
 * The week to show: the one asked for (clamped to the season), else the league's current week. Before
 * activation `currentWeek` is 0, which shows week 1.
 */
export function resolveSummaryWeek(
  weekParam: string | null | undefined,
  currentWeek: number | null | undefined,
  totalWeeks: number | null | undefined,
): number {
  const max = Math.max(1, Number(totalWeeks) || 1)
  const asked = weekParam != null && weekParam !== '' ? parseInt(weekParam, 10) : NaN
  const base = Number.isFinite(asked) ? asked : Number(currentWeek) || 1
  return Math.min(max, Math.max(1, base))
}

export type ZombieMyMatchup = {
  opponentRosterId: string
  myScore: number
  opponentScore: number
  final: boolean
}

/** The viewer's head-to-head for the week, from their side. Null on a bye or before the schedule exists. */
export function pickMyMatchup(results: readonly NativeWeekResult[] | null, myRosterId: string | null | undefined): ZombieMyMatchup | null {
  if (!results || !myRosterId) return null
  for (const r of results) {
    if (r.homeRosterId === myRosterId && r.awayRosterId) {
      return { opponentRosterId: r.awayRosterId, myScore: r.homeScore, opponentScore: r.awayScore, final: r.final }
    }
    if (r.awayRosterId === myRosterId && r.homeRosterId) {
      return { opponentRosterId: r.homeRosterId, myScore: r.awayScore, opponentScore: r.homeScore, final: r.final }
    }
  }
  return null
}

/** Report detail attached by the summary route: the scores, and the points the engine moved. */
export type ZombieBoardDetail = { winnerScore?: number; loserScore?: number; amount?: number }

export type ZombieBoardEntry =
  | ({ kind: 'infection'; victimRosterId: string; infectorRosterId: string | null } & ZombieBoardDetail)
  | ({ kind: 'mauling' | 'bashing'; winnerRosterId: string; loserRosterId: string; margin: number } & ZombieBoardDetail)

/**
 * The board with each entry's scores and points moved, read off the week's matchup views (the winnings
 * engine's own transfers). An entry whose matchup cannot be found is returned unchanged.
 */
export function withBoardDetail(
  board: readonly ZombieBoardEntry[],
  views: ReadonlyArray<{
    home: { rosterId: string; score: number }
    away: { rosterId: string; score: number }
    transfer: { fromRosterId: string; toRosterId: string; amount: number } | null
  }>,
): ZombieBoardEntry[] {
  return board.map((e) => {
    const loser = e.kind === 'infection' ? e.victimRosterId : e.loserRosterId
    const v = views.find((x) => x.home.rosterId === loser || x.away.rosterId === loser)
    if (!v) return e
    const loserSide = v.home.rosterId === loser ? v.home : v.away
    const winnerSide = v.home.rosterId === loser ? v.away : v.home
    const amount = v.transfer && v.transfer.fromRosterId === loser ? v.transfer.amount : undefined
    return { ...e, winnerScore: winnerSide.score, loserScore: loserSide.score, ...(amount != null ? { amount } : {}) }
  })
}

/**
 * What happened in a week, in roster ids, from the week's final results and the teams' own records:
 * infections (a team that turned this week, beaten by the team that turned it), then maulings and
 * bashings on the engine's margins (largest first). `hiddenInfector` nulls an infector the viewer may
 * not know — a hidden Whisperer is not named even as "the team that beat you", because the redacted
 * status would show it as a Survivor that infects.
 */
export function buildZombieWeeklyBoard(input: {
  week: number
  results: readonly NativeWeekResult[] | null
  teams: ReadonlyArray<{ rosterId: string; weekBecameZombie: number | null; killedByRosterId: string | null }>
  bashingMargin: number
  maulingMargin: number
  hiddenInfector: (rosterId: string) => boolean
}): ZombieBoardEntry[] {
  const out: ZombieBoardEntry[] = []
  const infectedThisWeek = new Set<string>()
  for (const t of input.teams) {
    if (t.weekBecameZombie !== input.week) continue
    infectedThisWeek.add(t.rosterId)
    const infector = t.killedByRosterId && !input.hiddenInfector(t.killedByRosterId) ? t.killedByRosterId : null
    out.push({ kind: 'infection', victimRosterId: t.rosterId, infectorRosterId: infector })
  }
  const blowouts: ZombieBoardEntry[] = []
  for (const r of input.results ?? []) {
    if (!r.final || !r.homeRosterId || !r.awayRosterId || r.homeScore === r.awayScore) continue
    const homeWon = r.homeScore > r.awayScore
    const winner = homeWon ? r.homeRosterId : r.awayRosterId
    const loser = homeWon ? r.awayRosterId : r.homeRosterId
    if (infectedThisWeek.has(loser)) continue // the infection already tells that story
    const margin = Math.round(Math.abs(r.homeScore - r.awayScore) * 10) / 10
    if (margin >= input.maulingMargin) blowouts.push({ kind: 'mauling', winnerRosterId: winner, loserRosterId: loser, margin })
    else if (margin >= input.bashingMargin) blowouts.push({ kind: 'bashing', winnerRosterId: winner, loserRosterId: loser, margin })
  }
  blowouts.sort((a, b) => (b as { margin: number }).margin - (a as { margin: number }).margin)
  out.push(...blowouts)
  return out
}

type NamedTeam =TeamIdentityRow & { id: string; teamName: string | null; ownerName: string | null }
type NamedRoster = {
  id: string
  platformUserId: string | null
  playerData: unknown
  redraftRoster?: { teamName: string | null; ownerName: string | null } | null
}

/**
 * A display name per roster: its league team (the shared roster↔team rule, never list position), else its
 * season roster, else a numbered placeholder. Never a raw id — a user id in a team name is a leak.
 */
export function zombieRosterDisplayNames(rosters: readonly NamedRoster[], teams: readonly NamedTeam[]): Record<string, string> {
  const out: Record<string, string> = {}
  rosters.forEach((roster, i) => {
    const teamId = matchTeamIdForRoster(roster, teams)
    const team = teamId ? teams.find((t) => t.id === teamId) : undefined
    const name =
      team?.teamName?.trim() ||
      team?.ownerName?.trim() ||
      roster.redraftRoster?.teamName?.trim() ||
      roster.redraftRoster?.ownerName?.trim() ||
      `Team ${i + 1}`
    out[roster.id] = name
  })
  return out
}

export type ZombieTurnMoment = {
  kind: 'turned' | 'survived' | 'revived'
  /** The resolved week it happened in (revived: the latest resolved week when it was seen). */
  week: number
  /** Null when the opponent is someone this viewer may not know (a hidden Whisperer) or unknown. */
  opponentName: string | null
  myScore: number | null
  opponentScore: number | null
  /** Stable per moment, so the overlay shows each one once. */
  key: string
}

/**
 * The status change the ZombieTurn overlay announces, for the latest resolved week — or null.
 * Priority: turned (you became a Zombie that week), revived (you came back from the dead), survived (you
 * beat an infected opponent). Statuses passed in are already redacted, so "survived" never fires against a
 * hidden Whisperer — that would announce one exists in your matchup.
 */
export function pickTurnMoment(input: {
  lastResolvedWeek: number | null
  me: { rosterId: string; status: string; weekBecameZombie: number | null; killedByRosterId: string | null; revivedAt: Date | null } | null
  results: readonly NativeWeekResult[] | null
  statusOf: (rosterId: string) => string
  nameOf: (rosterId: string) => string
  hiddenRoster: (rosterId: string) => boolean
}): ZombieTurnMoment | null {
  const { lastResolvedWeek: week, me } = input
  if (week == null || !me) return null
  const game = pickMyMatchup(input.results, me.rosterId)
  const scores = { myScore: game?.myScore ?? null, opponentScore: game?.opponentScore ?? null }

  if (/zombie/i.test(me.status) && me.weekBecameZombie === week) {
    const by = me.killedByRosterId ?? game?.opponentRosterId ?? null
    return {
      kind: 'turned',
      week,
      opponentName: by && !input.hiddenRoster(by) ? input.nameOf(by) : null,
      ...scores,
      key: `turned:${week}`,
    }
  }
  if (/survivor/i.test(me.status) && me.revivedAt) {
    return { kind: 'revived', week, opponentName: null, myScore: null, opponentScore: null, key: `revived:${me.revivedAt.toISOString()}` }
  }
  if (/survivor/i.test(me.status) && game?.final && game.myScore >= game.opponentScore) {
    const opp = input.statusOf(game.opponentRosterId)
    if (/zombie|whisperer/i.test(opp)) {
      return { kind: 'survived', week, opponentName: input.nameOf(game.opponentRosterId), ...scores, key: `survived:${week}` }
    }
  }
  return null
}
