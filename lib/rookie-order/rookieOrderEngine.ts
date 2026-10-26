/**
 * Live rookie / next-season draft order.
 *
 * The commissioner picks how non-playoff teams are ordered (reverse Max PF by default) and how
 * playoff teams are ordered (playoff finish, then seed, by default). This engine turns the season's
 * standings and whatever playoff games have been decided so far into a full draft order, with each
 * slot marked `locked` (it can no longer move) or `provisional` (it still depends on a game).
 *
 * It is run again after every playoff round, so the order fills itself in:
 *
 *   regular season final    → non-playoff slots lock; playoff teams provisional by seed
 *   each playoff round ends → the teams eliminated in that round lock into their tier
 *   title game decided      → runner-up second to last, champion last; `phase: 'final'`
 *
 * ## The tier rule
 *
 * A playoff team eliminated in round r picks before every team eliminated in a later round, and
 * the champion picks last. Teams eliminated in the SAME round are ordered by `withinRound` — the
 * worse seed first by default — unless a decided placement game (a 3rd-place game) settled them,
 * in which case the worse finish picks first. Byes need no special case: a bye team simply has no
 * game in round 1.
 *
 * ## A lower bracket that plays for the pick
 *
 * With `consolation_plays_for = 'pick'` (`lowerBracket.playsForPick`), the non-playoff teams are
 * seated with the lower bracket's result FIRST: a consolation bracket's winner (a toilet bowl's final
 * loser — last place) takes pick 1, and every other non-playoff team follows by `nonPlayoff`, the
 * reverse-standings order they get without the setting. The playoff teams are unchanged. Until the
 * bracket is decided those slots are provisional and the order is never `final`, so automation does
 * not save an order the lower bracket can still change. `cash` / `none` change nothing.
 *
 * ## Max PF
 *
 * Max PF must be TRUE Max PF (the optimal legal lineup each week), never points-for. See
 * `lib/commissioner-os/efl/maxPfEngine.ts`. When any team is missing a Max PF value the engine
 * orders by points-for for EVERY team and says so in `warnings` — mixing the two would compare
 * numbers that do not mean the same thing.
 *
 * Pure: no prisma, no clock, no randomness. Final tiebreak is `teamId`, so the same input always
 * gives the same order.
 */

export type NonPlayoffOrderMethod = 'reverse_max_pf' | 'reverse_points_for' | 'reverse_record'
export type PlayoffOrderMethod = 'finish_then_seed' | 'reverse_record' | 'reverse_max_pf'
export type WithinRoundOrder = 'worse_seed' | 'reverse_max_pf' | 'reverse_points_for'

export type RookieOrderConfig = {
  nonPlayoff: NonPlayoffOrderMethod
  playoff: PlayoffOrderMethod
  /** Only used with `playoff: 'finish_then_seed'`. */
  withinRound: WithinRoundOrder
}

export const DEFAULT_ROOKIE_ORDER_CONFIG: RookieOrderConfig = {
  nonPlayoff: 'reverse_max_pf',
  playoff: 'finish_then_seed',
  withinRound: 'worse_seed',
}

export type RookieOrderTeam = {
  teamId: string
  name: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
  /** True Max PF for the regular season, or null when it is not available. */
  maxPf: number | null
  /** Playoff seed (1 = best). Null for a team that did not make the playoffs. */
  playoffSeed: number | null
}

/**
 * One playoff game. Consolation / toilet-bowl games are NOT passed in.
 *
 * `championship` — a winners-bracket game; its loser is eliminated in `round`.
 * `placement`    — a game between already-eliminated teams that settles their finish
 *                  (`place` is the finish the WINNER takes; the loser takes `place + 1`).
 */
export type RookieOrderPlayoffGame = {
  round: number
  kind: 'championship' | 'placement'
  place?: number | null
  teamA: string | null
  teamB: string | null
  winner: string | null
}

export type RookieOrderLowerBracket = {
  mode: 'consolation' | 'toilet_bowl'
  /** `consolation_plays_for === 'pick'`. Anything else leaves the order alone. */
  playsForPick: boolean
  /** Non-playoff teams, best finish first, once the lower bracket is decided; null while it is played. */
  finishOrder: readonly string[] | null
}

export type RookieOrderInput = {
  teams: readonly RookieOrderTeam[]
  regularSeasonComplete: boolean
  playoffGames: readonly RookieOrderPlayoffGame[]
  config?: Partial<RookieOrderConfig>
  /** The season's consolation bracket or toilet bowl; absent when it had none. */
  lowerBracket?: RookieOrderLowerBracket | null
}

export type RookieOrderSlot = {
  slot: number
  teamId: string
  name: string
  group: 'non_playoff' | 'playoff'
  status: 'locked' | 'provisional'
  /** 'Champion', 'Runner-up', '3rd place', 'Lost in Semifinal', 'Alive (seed 2)', or null. */
  finish: string | null
  /** One line a manager can read: why this team is in this slot. */
  reason: string
}

export type RookieOrderResult = {
  phase: 'regular_season' | 'playoffs' | 'final'
  config: RookieOrderConfig
  /** Which number ordered teams by "Max PF". */
  maxPfSource: 'max_pf' | 'points_for'
  slots: RookieOrderSlot[]
  warnings: string[]
}

type Ctx = {
  metric: (t: RookieOrderTeam) => number
  metricLabel: string
}

function winPct(t: RookieOrderTeam): number {
  const games = t.wins + t.losses + t.ties
  return games > 0 ? (t.wins + 0.5 * t.ties) / games : 0
}

function byTeamId(a: RookieOrderTeam, b: RookieOrderTeam): number {
  return a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0
}

/** Ascending comparators: the team that should pick EARLIER sorts first. */
function chain(...cmps: Array<(a: RookieOrderTeam, b: RookieOrderTeam) => number>) {
  return (a: RookieOrderTeam, b: RookieOrderTeam) => {
    for (const c of cmps) {
      const d = c(a, b)
      if (d !== 0) return d
    }
    return byTeamId(a, b)
  }
}

function nonPlayoffComparator(method: NonPlayoffOrderMethod, ctx: Ctx) {
  const byMetric = (a: RookieOrderTeam, b: RookieOrderTeam) => ctx.metric(a) - ctx.metric(b)
  const byPf = (a: RookieOrderTeam, b: RookieOrderTeam) => a.pointsFor - b.pointsFor
  const byRecord = (a: RookieOrderTeam, b: RookieOrderTeam) => winPct(a) - winPct(b)
  if (method === 'reverse_points_for') return chain(byPf, byMetric, byRecord)
  if (method === 'reverse_record') return chain(byRecord, byMetric, byPf)
  return chain(byMetric, byPf, byRecord)
}

function nonPlayoffReason(method: NonPlayoffOrderMethod, t: RookieOrderTeam, rank: number, of: number, ctx: Ctx): string {
  const nth = `${ordinal(rank)} ${method === 'reverse_record' ? 'worst' : 'lowest'} of ${of} non-playoff teams`
  if (method === 'reverse_points_for') return `${t.pointsFor.toFixed(1)} points for — ${nth}`
  if (method === 'reverse_record') return `${recordLabel(t)} — ${nth}`
  return `${ctx.metric(t).toFixed(1)} ${ctx.metricLabel} — ${nth}`
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

function recordLabel(t: RookieOrderTeam): string {
  return `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`
}

function roundName(round: number, finalRound: number): string {
  const fromEnd = finalRound - round
  if (fromEnd === 0) return 'Final'
  if (fromEnd === 1) return 'Semifinal'
  if (fromEnd === 2) return 'Quarterfinal'
  return `Round ${round}`
}

/**
 * A "championship" game whose team already lost an earlier championship game is really a
 * placement game (a 3rd-place game recorded without its placement number, as old Sleeper
 * metadata does). Treating it as a bracket game would eliminate a team twice.
 */
function normalizeGames(games: readonly RookieOrderPlayoffGame[]): RookieOrderPlayoffGame[] {
  const sorted = [...games].sort((a, b) => a.round - b.round)
  const lostIn = new Map<string, number>()
  const out: RookieOrderPlayoffGame[] = []
  for (const g of sorted) {
    if (g.kind === 'championship') {
      const priorLoss = [g.teamA, g.teamB].some((t) => t != null && lostIn.has(t) && lostIn.get(t)! < g.round)
      if (priorLoss) {
        out.push({ ...g, kind: 'placement', place: g.place ?? null })
        continue
      }
      if (g.winner) {
        const loser = g.winner === g.teamA ? g.teamB : g.teamA
        if (loser) lostIn.set(loser, g.round)
      }
    }
    out.push(g)
  }
  return out
}

export function computeRookieOrder(input: RookieOrderInput): RookieOrderResult {
  const config: RookieOrderConfig = { ...DEFAULT_ROOKIE_ORDER_CONFIG, ...(input.config ?? {}) }
  const warnings: string[] = []
  const teams = [...input.teams]

  const needsMaxPf =
    config.nonPlayoff === 'reverse_max_pf' ||
    config.playoff === 'reverse_max_pf' ||
    (config.playoff === 'finish_then_seed' && config.withinRound === 'reverse_max_pf')
  const missingMaxPf = teams.filter((t) => t.maxPf == null || !Number.isFinite(t.maxPf))
  const useMaxPf = missingMaxPf.length === 0
  if (needsMaxPf && !useMaxPf) {
    warnings.push(
      `Max PF is not available for ${missingMaxPf.length} of ${teams.length} teams, so every team is ordered by points for instead.`,
    )
  }
  const ctx: Ctx = useMaxPf
    ? { metric: (t) => t.maxPf as number, metricLabel: 'max PF' }
    : { metric: (t) => t.pointsFor, metricLabel: 'points for' }
  const base = { config, maxPfSource: (useMaxPf ? 'max_pf' : 'points_for') as RookieOrderResult['maxPfSource'], warnings }

  // ── Regular season still running: everything is a projection. ──
  if (!input.regularSeasonComplete) {
    const sorted = teams.sort(nonPlayoffComparator(config.nonPlayoff, ctx))
    return {
      ...base,
      phase: 'regular_season',
      slots: sorted.map((t, i) => ({
        slot: i + 1,
        teamId: t.teamId,
        name: t.name,
        group: 'non_playoff',
        status: 'provisional',
        finish: null,
        reason: `Projected — ${nonPlayoffReason(config.nonPlayoff, t, i + 1, sorted.length, ctx)}`,
      })),
    }
  }

  const nonPlayoff = teams.filter((t) => t.playoffSeed == null).sort(nonPlayoffComparator(config.nonPlayoff, ctx))
  const playoff = teams.filter((t) => t.playoffSeed != null)

  const lower = input.lowerBracket?.playsForPick && nonPlayoff.length > 0 ? input.lowerBracket : null
  const slots: RookieOrderSlot[] = lower
    ? lowerBracketSlots(nonPlayoff, lower, config.nonPlayoff, ctx)
    : nonPlayoff.map((t, i) => ({
        slot: i + 1,
        teamId: t.teamId,
        name: t.name,
        group: 'non_playoff',
        status: 'locked',
        finish: null,
        reason: nonPlayoffReason(config.nonPlayoff, t, i + 1, nonPlayoff.length, ctx),
      }))
  // The order is not final while a lower bracket that plays for the pick is undecided.
  const lowerPending = Boolean(lower && !lower.finishOrder)
  const push = (t: RookieOrderTeam, status: RookieOrderSlot['status'], finish: string | null, reason: string) =>
    slots.push({ slot: slots.length + 1, teamId: t.teamId, name: t.name, group: 'playoff', status, finish, reason })

  // ── Playoff results ignored: one ordering for every playoff team. ──
  if (config.playoff !== 'finish_then_seed') {
    const method: NonPlayoffOrderMethod = config.playoff === 'reverse_max_pf' ? 'reverse_max_pf' : 'reverse_record'
    playoff.sort(nonPlayoffComparator(method, ctx)).forEach((t, i) => {
      const value = method === 'reverse_record' ? recordLabel(t) : `${ctx.metric(t).toFixed(1)} ${ctx.metricLabel}`
      push(t, 'locked', `Seed ${t.playoffSeed}`, `${value} — ${ordinal(i + 1)} ${method === 'reverse_record' ? 'worst' : 'lowest'} of ${playoff.length} playoff teams`)
    })
    return { ...base, phase: lowerPending ? 'playoffs' : 'final', slots }
  }

  // ── Playoff finish, then seed. ──
  const playoffIds = new Set(playoff.map((t) => t.teamId))
  const games = normalizeGames(input.playoffGames).filter(
    (g) => (g.teamA == null || playoffIds.has(g.teamA)) && (g.teamB == null || playoffIds.has(g.teamB)),
  )
  const bracketGames = games.filter((g) => g.kind === 'championship')
  const placementGames = games.filter((g) => g.kind === 'placement')
  // Later rounds may not exist yet (Sleeper and the native runtime add them as the bracket fills),
  // so the length comes from the team count: 5–8 teams is 3 rounds, 9–16 is 4.
  const finalRound = Math.max(
    bracketGames.reduce((m, g) => Math.max(m, g.round), 0),
    playoff.length > 1 ? Math.ceil(Math.log2(playoff.length)) : 0,
  )
  const titleGames = bracketGames.filter((g) => g.round === finalRound)
  if (titleGames.length > 1) {
    warnings.push(`Found ${titleGames.length} title games in round ${finalRound}; the champion cannot be identified yet.`)
  }
  const titleGame = titleGames.length === 1 ? titleGames[0] : null

  const eliminatedIn = new Map<string, number>()
  for (const g of bracketGames) {
    if (!g.winner) continue
    const loser = g.winner === g.teamA ? g.teamB : g.teamA
    if (loser) eliminatedIn.set(loser, g.round)
  }
  const championId = titleGame?.winner ?? null
  const roundDecided = (r: number) => bracketGames.filter((g) => g.round === r).every((g) => g.winner != null)

  const finishByTeam = new Map<string, number>()
  const undecidedPlacement = new Set<string>()
  for (const g of placementGames) {
    const pair = [g.teamA, g.teamB].filter((t): t is string => t != null)
    if (!g.winner || g.place == null) {
      if (!g.winner) pair.forEach((t) => undecidedPlacement.add(t))
      continue
    }
    finishByTeam.set(g.winner, g.place)
    const loser = g.winner === g.teamA ? g.teamB : g.teamA
    if (loser) finishByTeam.set(loser, g.place + 1)
  }

  const seedDesc = (a: RookieOrderTeam, b: RookieOrderTeam) => (b.playoffSeed ?? 0) - (a.playoffSeed ?? 0)
  const within =
    config.withinRound === 'reverse_max_pf'
      ? chain((a, b) => ctx.metric(a) - ctx.metric(b), seedDesc)
      : config.withinRound === 'reverse_points_for'
        ? chain((a, b) => a.pointsFor - b.pointsFor, seedDesc)
        : chain(seedDesc)
  const withinLabel =
    config.withinRound === 'reverse_max_pf'
      ? `lower ${ctx.metricLabel} picks first`
      : config.withinRound === 'reverse_points_for'
        ? 'lower points for picks first'
        : 'worse seed picks first'

  // Tiers by elimination round; alive teams after them; champion last.
  const tiers = new Map<number, RookieOrderTeam[]>()
  const alive: RookieOrderTeam[] = []
  let champion: RookieOrderTeam | null = null
  for (const t of playoff) {
    if (t.teamId === championId) champion = t
    else if (eliminatedIn.has(t.teamId)) {
      const r = eliminatedIn.get(t.teamId)!
      tiers.set(r, [...(tiers.get(r) ?? []), t])
    } else alive.push(t)
  }

  for (const r of [...tiers.keys()].sort((a, b) => a - b)) {
    const group = tiers.get(r)!
    const allPlaced = group.length > 1 && group.every((t) => finishByTeam.has(t.teamId))
    group.sort(allPlaced ? (a, b) => finishByTeam.get(b.teamId)! - finishByTeam.get(a.teamId)! : within)
    const locked = roundDecided(r) && group.every((t) => !undecidedPlacement.has(t.teamId))
    const isTitleRound = titleGame != null && r === finalRound
    for (const t of group) {
      const place = finishByTeam.get(t.teamId)
      const finish = isTitleRound ? 'Runner-up' : place != null ? `${ordinal(place)} place` : `Lost in ${roundName(r, finalRound)}`
      const why = isTitleRound
        ? 'Lost the title game — picks second to last'
        : allPlaced
          ? `${finish} — decided by the placement game`
          : group.length > 1
            ? `Lost in ${roundName(r, finalRound)} (seed ${t.playoffSeed}) — ${withinLabel}`
            : `Lost in ${roundName(r, finalRound)} (seed ${t.playoffSeed})`
      push(t, locked ? 'locked' : 'provisional', finish, locked ? why : `${why}; waiting on other ${roundName(r, finalRound)} results`)
    }
  }

  alive.sort(seedDesc).forEach((t) =>
    push(t, 'provisional', `Alive (seed ${t.playoffSeed})`, 'Still alive in the playoffs — slot depends on how far they go'),
  )
  if (champion) push(champion, 'locked', 'Champion', 'Won the title — picks last')

  return { ...base, phase: champion && !lowerPending ? 'final' : 'playoffs', slots }
}

/**
 * Non-playoff slots when the lower bracket plays for the pick: the team it decided picks FIRST — a
 * consolation bracket's winner, or a toilet bowl's final loser (last place) — and every other
 * non-playoff team follows in `nonPlayoff`, the same reverse-standings order they get without the
 * setting. Only slot 1 is the bracket's; the rest of its finish order is not used. A result that does
 * not name a non-playoff team (it cannot happen for a native bracket) leaves the standings order alone.
 */
function lowerBracketSlots(nonPlayoff: RookieOrderTeam[], lower: RookieOrderLowerBracket, method: NonPlayoffOrderMethod, ctx: Ctx): RookieOrderSlot[] {
  const label = lower.mode === 'toilet_bowl' ? 'toilet bowl' : 'consolation bracket'
  const standings = (t: RookieOrderTeam, i: number): RookieOrderSlot => ({
    slot: i + 1,
    teamId: t.teamId,
    name: t.name,
    group: 'non_playoff',
    status: 'locked',
    finish: null,
    reason: nonPlayoffReason(method, t, i + 1, nonPlayoff.length, ctx),
  })
  if (!lower.finishOrder) {
    return nonPlayoff.map((t, i) => ({
      ...standings(t, i),
      status: 'provisional',
      reason: `Waiting on the ${label} — its winner picks first`,
    }))
  }
  const ids = new Set(nonPlayoff.map((t) => t.teamId))
  const named = lower.finishOrder.filter((id) => ids.has(id))
  const firstId = lower.mode === 'toilet_bowl' ? named.at(-1) : named[0]
  const first = nonPlayoff.find((t) => t.teamId === firstId)
  if (!first) return nonPlayoff.map(standings)
  const rest = nonPlayoff.filter((t) => t !== first)
  return [
    {
      slot: 1,
      teamId: first.teamId,
      name: first.name,
      group: 'non_playoff',
      status: 'locked',
      finish: lower.mode === 'toilet_bowl' ? 'Toilet bowl loser' : 'Consolation winner',
      reason:
        lower.mode === 'toilet_bowl'
          ? 'Lost the toilet bowl final (last place) — picks first'
          : 'Won the consolation bracket — picks first',
    },
    ...rest.map((t, i) => ({ ...standings(t, i + 1), reason: nonPlayoffReason(method, t, i + 1, rest.length, ctx) })),
  ]
}
