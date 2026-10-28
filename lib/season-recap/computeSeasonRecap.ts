/**
 * The season recap — champion, standings and the season's awards — from data already in Postgres. PURE.
 *
 * Everything here is computed from rows the season itself wrote (rosters, matchups, the playoff
 * bracket, trades and their frozen value snapshots, roster moves and stored weekly player scores).
 * No provider is called anywhere on this path; the loader (./loadSeasonRecapInput.ts) reads Postgres
 * only. An award whose data does not exist is reported as missing, never guessed:
 *
 *   - best / worst trade need a frozen value snapshot; a trade without one is not ranked at all,
 *     because "no value" is not "worth zero";
 *   - the best pickup needs the week the player was added and his stored weekly scores;
 *   - most improved prefers last season's record for the same manager, and falls back to the
 *     second half against the first half of this season when there is no prior season — the basis
 *     is written on the award so the page can say which it is.
 *
 * The output is versioned and stored as JSON with the season's history, so a later change to this
 * file never rewrites a recap a league has already seen; the page reads what was stored.
 */

export const SEASON_RECAP_VERSION = 1

export type RecapTeam = {
  rosterId: string
  name: string
  ownerId: string | null
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  playoffSeed: number | null
}

export type RecapGame = { week: number; homeRosterId: string; awayRosterId: string; homeScore: number; awayScore: number }

export type RecapLowerBracketFinal = { mode: 'consolation' | 'toilet_bowl'; winnerRosterId: string; loserRosterId: string }

/** One executed trade, with each side's frozen value in and out. */
export type RecapTrade = {
  tradeId: string
  executedAt: string | null
  sides: { rosterId: string; valueIn: number; valueOut: number }[]
}

export type RecapPickup = {
  rosterId: string
  playerId: string
  playerName: string
  position: string | null
  pickupWeek: number
  /** Fantasy points in the weeks after the pickup week while he stayed on the roster. */
  pointsAfter: number
  weeksCounted: number
}

export type SeasonRecapInput = {
  leagueId: string
  season: number
  sport: string
  playoffStartWeek: number
  teams: RecapTeam[]
  /** Final regular-season head-to-head games (median games excluded). */
  regularGames: RecapGame[]
  championRosterId: string | null
  runnerUpRosterId: string | null
  /**
   * The finish order the playoff finalizer stored (`RedraftPlayoffBracket.structure.finalStandings`),
   * best first. When absent the standings are champion, runner-up, then regular-season order.
   */
  finishOrder?: string[] | null
  /**
   * The rosters that made the playoff field (`RedraftPlayoffSeed`). `RedraftRoster.playoffSeed` is not
   * this: the standings engine seeds EVERY team (1..N) during the season. Null when unknown.
   */
  playoffRosterIds?: string[] | null
  /** The consolation or toilet bowl final, when the bracket had one and it was played. */
  lowerBracketFinal: RecapLowerBracketFinal | null
  /** Null when trades could not be read; [] when the season had none. */
  trades: RecapTrade[] | null
  /** Executed trades that carried no usable value snapshot — counted, not ranked. */
  unvaluedTradeCount?: number
  /** Null when pickups could not be measured (no pickup weeks or no stored scores). */
  pickups: RecapPickup[] | null
  /** Last season's records for the same managers, keyed by owner id. Null when there is none. */
  priorSeasonByOwnerId: Record<string, { wins: number; losses: number; ties: number }> | null
  computedAt: string
}

export type TeamRef = { rosterId: string; name: string }

export type RecapGameAward = {
  week: number
  winner: TeamRef
  loser: TeamRef
  winnerScore: number
  loserScore: number
  margin: number
  tie: boolean
}

export type RecapTeamLine = {
  team: TeamRef
  rank: number
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  playoffSeed: number | null
  finish: 'champion' | 'runner_up' | 'playoffs' | 'missed_playoffs'
  bestWeek: { week: number; points: number } | null
  worstWeek: { week: number; points: number } | null
  longestWinStreak: number
}

export type SeasonRecap = {
  version: number
  leagueId: string
  season: number
  sport: string
  computedAt: string
  champion: TeamRef | null
  runnerUp: TeamRef | null
  topSeed: (TeamRef & { wins: number; losses: number; ties: number }) | null
  mostPointsFor: (TeamRef & { points: number }) | null
  highestWeek: (TeamRef & { week: number; points: number }) | null
  biggestBlowout: RecapGameAward | null
  closestGame: RecapGameAward | null
  bestTrade: (TeamRef & { tradeId: string; partner: TeamRef | null; net: number; valueIn: number; valueOut: number }) | null
  worstTrade: (TeamRef & { tradeId: string; partner: TeamRef | null; net: number; valueIn: number; valueOut: number }) | null
  bestPickup: (TeamRef & { playerId: string; playerName: string; position: string | null; pickupWeek: number; pointsAfter: number; weeksCounted: number }) | null
  mostImproved: (TeamRef & { basis: 'prior_season' | 'second_half'; before: number; after: number; delta: number }) | null
  lowerBracket: { mode: 'consolation' | 'toilet_bowl'; winner: TeamRef; loser: TeamRef } | null
  /** Final standings: the stored finish order, else champion, runner-up, then regular-season order. */
  teamLines: RecapTeamLine[]
  tradeCount: number
  /** What could not be computed, and why — shown on the page rather than hidden. */
  missing: string[]
}

const round2 = (n: number) => Math.round(n * 100) / 100

function regularSeasonOrder(a: RecapTeam, b: RecapTeam): number {
  const pct = (t: RecapTeam) => {
    const g = t.wins + t.losses + t.ties
    return g > 0 ? (t.wins + t.ties / 2) / g : 0
  }
  return pct(b) - pct(a) || b.pointsFor - a.pointsFor || a.name.localeCompare(b.name)
}

function winPct(r: { wins: number; losses: number; ties: number }): number | null {
  const g = r.wins + r.losses + r.ties
  return g > 0 ? (r.wins + r.ties / 2) / g : null
}

export function computeSeasonRecap(input: SeasonRecapInput): SeasonRecap {
  const missing: string[] = []
  const byId = new Map(input.teams.map((t) => [t.rosterId, t]))
  const ref = (rosterId: string | null | undefined): TeamRef | null => {
    if (!rosterId) return null
    const t = byId.get(rosterId)
    return t ? { rosterId, name: t.name } : null
  }

  // Games that were actually played: both scores in, not a 0-0 placeholder.
  const games = input.regularGames.filter(
    (g) => byId.has(g.homeRosterId) && byId.has(g.awayRosterId) && Number.isFinite(g.homeScore) && Number.isFinite(g.awayScore) && g.homeScore + g.awayScore > 0,
  )
  if (games.length === 0) missing.push('No final regular-season scores were stored, so the weekly awards are empty.')

  const award = (g: RecapGame): RecapGameAward => {
    const homeWins = g.homeScore >= g.awayScore
    const w = homeWins ? g.homeRosterId : g.awayRosterId
    const l = homeWins ? g.awayRosterId : g.homeRosterId
    const ws = homeWins ? g.homeScore : g.awayScore
    const ls = homeWins ? g.awayScore : g.homeScore
    return { week: g.week, winner: ref(w)!, loser: ref(l)!, winnerScore: round2(ws), loserScore: round2(ls), margin: round2(ws - ls), tie: g.homeScore === g.awayScore }
  }

  // Ties break to the earlier week, so the award is stable across recomputes.
  const byWeek = [...games].sort((a, b) => a.week - b.week)
  let blowout: RecapGame | null = null
  let closest: RecapGame | null = null
  let highest: { rosterId: string; week: number; points: number } | null = null
  const weekly = new Map<string, { week: number; points: number; won: boolean | null }[]>()
  for (const g of byWeek) {
    const margin = Math.abs(g.homeScore - g.awayScore)
    if (!blowout || margin > Math.abs(blowout.homeScore - blowout.awayScore)) blowout = g
    if (!closest || margin < Math.abs(closest.homeScore - closest.awayScore)) closest = g
    for (const [rosterId, points, opp] of [[g.homeRosterId, g.homeScore, g.awayScore], [g.awayRosterId, g.awayScore, g.homeScore]] as const) {
      if (!highest || points > highest.points) highest = { rosterId, week: g.week, points }
      const list = weekly.get(rosterId) ?? []
      list.push({ week: g.week, points, won: points === opp ? null : points > opp })
      weekly.set(rosterId, list)
    }
  }

  const regularOrder = [...input.teams].sort(regularSeasonOrder)
  const seeded = input.teams.filter((t) => t.playoffSeed === 1)
  const topSeedTeam = seeded.length === 1 ? seeded[0] : regularOrder[0] ?? null
  const mostPf = [...input.teams].sort((a, b) => b.pointsFor - a.pointsFor)[0] ?? null

  // ── Trades ────────────────────────────────────────────────────────────────
  type TradeAward = NonNullable<SeasonRecap['bestTrade']>
  let bestTrade: TradeAward | null = null
  let worstTrade: TradeAward | null = null
  const tradeCount = (input.trades?.length ?? 0) + (input.unvaluedTradeCount ?? 0)
  if (input.trades == null) {
    missing.push('Trades could not be read for this season.')
  } else {
    for (const t of input.trades) {
      for (const side of t.sides) {
        const team = ref(side.rosterId)
        if (!team) continue
        const partnerId = t.sides.find((s) => s.rosterId !== side.rosterId)?.rosterId ?? null
        const row: TradeAward = { ...team, tradeId: t.tradeId, partner: t.sides.length === 2 ? ref(partnerId) : null, net: round2(side.valueIn - side.valueOut), valueIn: round2(side.valueIn), valueOut: round2(side.valueOut) }
        if (!bestTrade || row.net > bestTrade.net) bestTrade = row
        if (!worstTrade || row.net < worstTrade.net) worstTrade = row
      }
    }
    if ((input.unvaluedTradeCount ?? 0) > 0) {
      missing.push(`${input.unvaluedTradeCount} trade(s) had no stored trade value, so they are not ranked.`)
    }
    /*
     * Best = the biggest value a team GAINED in one trade; worst = the biggest it GAVE AWAY. With one
     * lopsided trade those are its two sides, which is the honest reading: one team won it, one lost it.
     */
    if (bestTrade && bestTrade.net <= 0) bestTrade = null
    if (worstTrade && worstTrade.net >= 0) worstTrade = null
  }

  // ── Best pickup ───────────────────────────────────────────────────────────
  let bestPickup: SeasonRecap['bestPickup'] = null
  if (input.pickups == null) {
    missing.push('Waiver pickups could not be measured: the pickup week or the stored weekly scores are missing.')
  } else {
    for (const p of input.pickups) {
      const team = ref(p.rosterId)
      if (!team || p.weeksCounted <= 0) continue
      if (!bestPickup || p.pointsAfter > bestPickup.pointsAfter) {
        bestPickup = { ...team, playerId: p.playerId, playerName: p.playerName, position: p.position, pickupWeek: p.pickupWeek, pointsAfter: round2(p.pointsAfter), weeksCounted: p.weeksCounted }
      }
    }
  }

  // ── Most improved ─────────────────────────────────────────────────────────
  let mostImproved: SeasonRecap['mostImproved'] = null
  if (input.priorSeasonByOwnerId) {
    for (const t of input.teams) {
      const prior = t.ownerId ? input.priorSeasonByOwnerId[t.ownerId] : undefined
      const before = prior ? winPct(prior) : null
      const after = winPct(t)
      if (before == null || after == null) continue
      const delta = after - before
      if (delta > 0 && (!mostImproved || delta > mostImproved.delta)) {
        mostImproved = { rosterId: t.rosterId, name: t.name, basis: 'prior_season', before: round2(before), after: round2(after), delta: round2(delta) }
      }
    }
  }
  if (!mostImproved) {
    const weeks = [...new Set(games.map((g) => g.week))].sort((a, b) => a - b)
    const mid = weeks[Math.floor(weeks.length / 2)]
    if (weeks.length >= 2 && mid != null) {
      for (const t of input.teams) {
        const list = weekly.get(t.rosterId) ?? []
        const first = list.filter((w) => w.week < mid)
        const second = list.filter((w) => w.week >= mid)
        if (first.length === 0 || second.length === 0) continue
        const before = first.reduce((s, w) => s + w.points, 0) / first.length
        const after = second.reduce((s, w) => s + w.points, 0) / second.length
        const delta = after - before
        if (delta > 0 && (!mostImproved || delta > mostImproved.delta)) {
          mostImproved = { rosterId: t.rosterId, name: t.name, basis: 'second_half', before: round2(before), after: round2(after), delta: round2(delta) }
        }
      }
    }
  }

  // ── Lower bracket ─────────────────────────────────────────────────────────
  const lb = input.lowerBracketFinal
  const lowerBracket = lb && ref(lb.winnerRosterId) && ref(lb.loserRosterId)
    ? { mode: lb.mode, winner: ref(lb.winnerRosterId)!, loser: ref(lb.loserRosterId)! }
    : null

  // ── Standings and each team's line ────────────────────────────────────────
  const champion = ref(input.championRosterId)
  const runnerUp = ref(input.runnerUpRosterId)
  if (!champion) missing.push('No champion is recorded for this season.')
  const head = (input.finishOrder?.length
    ? input.finishOrder
    : [champion?.rosterId, runnerUp?.rosterId]
  ).filter((id, i, all): id is string => typeof id === 'string' && byId.has(id) && all.indexOf(id) === i)
  const placed = new Set(head)
  const playoffField = new Set(input.playoffRosterIds ?? [])
  if (!input.playoffRosterIds?.length) missing.push('The playoff field is not recorded, so no team is marked as a playoff team.')
  const ordered = [...head.map((id) => byId.get(id)!), ...regularOrder.filter((t) => !placed.has(t.rosterId))]
  const teamLines: RecapTeamLine[] = ordered.map((t, i) => {
    const list = (weekly.get(t.rosterId) ?? []).sort((a, b) => a.week - b.week)
    let best: { week: number; points: number } | null = null
    let worst: { week: number; points: number } | null = null
    let streak = 0
    let longest = 0
    for (const w of list) {
      if (!best || w.points > best.points) best = { week: w.week, points: round2(w.points) }
      if (!worst || w.points < worst.points) worst = { week: w.week, points: round2(w.points) }
      streak = w.won === true ? streak + 1 : 0
      longest = Math.max(longest, streak)
    }
    const finish: RecapTeamLine['finish'] =
      t.rosterId === champion?.rosterId ? 'champion'
        : t.rosterId === runnerUp?.rosterId ? 'runner_up'
          : playoffField.has(t.rosterId) ? 'playoffs' : 'missed_playoffs'
    return {
      team: { rosterId: t.rosterId, name: t.name },
      rank: i + 1,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      pointsFor: round2(t.pointsFor),
      pointsAgainst: round2(t.pointsAgainst),
      playoffSeed: t.playoffSeed,
      finish,
      bestWeek: best,
      worstWeek: worst,
      longestWinStreak: longest,
    }
  })

  return {
    version: SEASON_RECAP_VERSION,
    leagueId: input.leagueId,
    season: input.season,
    sport: input.sport,
    computedAt: input.computedAt,
    champion,
    runnerUp,
    topSeed: topSeedTeam ? { rosterId: topSeedTeam.rosterId, name: topSeedTeam.name, wins: topSeedTeam.wins, losses: topSeedTeam.losses, ties: topSeedTeam.ties } : null,
    mostPointsFor: mostPf ? { rosterId: mostPf.rosterId, name: mostPf.name, points: round2(mostPf.pointsFor) } : null,
    highestWeek: highest ? { ...ref(highest.rosterId)!, week: highest.week, points: round2(highest.points) } : null,
    biggestBlowout: blowout ? award(blowout) : null,
    closestGame: closest ? award(closest) : null,
    bestTrade,
    worstTrade,
    bestPickup,
    mostImproved,
    lowerBracket,
    teamLines,
    tradeCount,
    missing,
  }
}

/** The one-line headline a notification and the page's title share. */
export function seasonRecapHeadline(recap: Pick<SeasonRecap, 'season' | 'champion'>): string {
  return recap.champion ? `${recap.champion.name} won the ${recap.season} title` : `The ${recap.season} season recap`
}
