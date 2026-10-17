/**
 * Where next year's draft picks will land, from this season's standings — PURE.
 *
 * Guap, 2026-10-11 (trade grade audit, "go ahead with dynasty pick slots"): a dynasty pick is worth what
 * its slot is worth, and its slot follows its ORIGINAL owner's finish. FantasyCalc prices the next draft by
 * tier — on its 12-team 1-QB board a 2027 1st reads Early 4,565, Mid 3,006, Late 2,328 — and every
 * grade priced the 0-5 team's 1st and the 5-0 team's 1st the same.
 *
 * ── THE MODEL ────────────────────────────────────────────────────────────────────────────────────────
 *   - The regular season is played out from today's standings, many times over (seeded, so a grade is
 *     reproducible). Each run first draws every team's true scoring level from its points per game, with
 *     the error a few games leave (`WEEKLY_SCORE_CV`): four weeks of scoring is a noisy read of a team.
 *     Each team then wins each remaining game at its ALL-PLAY RATE among those drawn levels — the share
 *     of the league it outscores — pulled halfway to .500 for weekly luck: a team's head-to-head record
 *     follows its scoring, but loosely. Ties count half a win.
 *   - The draft order is the one most dynasty leagues use, MEASURED on 275 real Sleeper rookie drafts
 *     (2026-10-11): teams that MISS the playoffs pick in reverse standings — fewest wins first, less
 *     scoring first on a tie — and PLAYOFF teams pick by their playoff finish, the champion last. The
 *     playoffs are played out too: seeds by record, byes to the top seeds, every game decided by the two
 *     teams' rates (log5), and teams out in the same round placed by their own games (the 3rd- and
 *     5th-place games). That rule puts 86.9% of teams in their real third; reverse standings alone, 79.4%.
 *     Lotteries and manual orders are not modelled; the basis says so.
 *   - Early / Mid / Late are the draft's thirds, as FantasyCalc's tiers are.
 *
 * The answer is the probability the pick lands in each third — never one guessed slot — so a pick in week 2
 * is close to an even split, and one in week 13 is nearly certain.
 */

export type PickTier = 'early' | 'mid' | 'late'
export type TierOdds = Record<PickTier, number>

export type StandingsTeam = {
  /** The provider's team id (`LeagueTeam.externalId`): the id a pick's original owner is known by. */
  id: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
}

/**
 * Where a KNOWN order came from:
 *   - `draft_order_set` — the league's own draft, its order set by the commissioner (every slot named);
 *   - `final_standings` — the finished season and its decided playoffs, by the rule most leagues use.
 */
export type DraftOrderSource = 'draft_order_set' | 'final_standings'

export type PickSlotProjection = {
  /** The draft these odds are for. */
  draftYear: number
  oddsByTeam: ReadonlyMap<string, TierOdds>
  /** Each team's slot (1 = first pick) when the order is KNOWN rather than projected. */
  slotByTeam?: ReadonlyMap<string, number>
  orderSource?: DraftOrderSource
  /** Regular-season weeks left when projected. */
  weeksLeft: number
}

/*
 * ── CALIBRATED 2026-10-11 against 734 real regular seasons ─────────────────────────────────────────
 * Replayed from `dw_matchup_facts` (NFL 2021–2025, 8–16 teams, 97 of them median leagues; each replay
 * checked against the league's own final records), projected at weeks 2–12 and scored against how the
 * regular season actually ended (reverse-record thirds). Grid: WEEKLY_SCORE_CV 0.15–0.75 × shrink 0.5–0.8.
 *
 *   setting              log loss   Brier   (an even split: 1.099 / 0.667)
 *   CV 0.22, shrink 0.5   0.669     0.405   ← shipped first: OVERCONFIDENT — said 90%, happened 86%;
 *                                             said 70%, happened 64%
 *   CV 0.40, shrink 0.5   0.659     0.402   ← best; every probability band within ~1.5 points of what
 *                                             happened (said 90% → 91.6%, 70% → 70.8%, 30% → 30.1%)
 *
 * The surface is flat from CV 0.30 to 0.40 and shrink 0.5 to 0.6. What it does NOT measure: whether a
 * league's rookie draft really follows reverse record (lotteries, playoff-finish orders) — we hold two
 * Sleeper draft orders, not enough to test.
 */
/** How far a team's all-play rate is pulled toward .500 for a single game. */
export const ALL_PLAY_SHRINK = 0.5
export const PICK_SLOT_SIMULATIONS = 4000
/**
 * One week's score varies around a team's true level by about this share of the league's average
 * score. It is what makes four weeks of scoring a noisy read of a team's strength: each simulated season
 * redraws every team's level from its average with error `WEEKLY_SCORE_CV × league average / √weeks
 * played`. Fitted, not assumed (above) — it also absorbs what scoring alone cannot see: injuries, trades,
 * a rebuilding team selling.
 */
export const WEEKLY_SCORE_CV = 0.4

/*
 * ── WHICH RULE THE LEAGUE USES IS ITSELF UNKNOWN ───────────────────────────────────────────────────
 * Scored against 275 REAL Sleeper rookie drafts (2026-10-11), the model said "certain" too often: with the
 * season over, picks it called 100% landed in that third 85% of the time. About one draft in eight follows
 * neither rule — plain reverse standings, a manual or random order. So the odds are blended with an even
 * split by `RULE_UNCERTAINTY × (share of the regular season played)³`:
 *
 *   end of season (275 drafts)   playoffs alone: log loss 0.917   + this blend: 0.591  (reverse standings 1.440)
 *   mid-season (40 leagues)      no blend 0.696 · linear 0.715 · squared 0.707 · CUBED 0.702
 *
 * Cubed, because early in the season the games still to play already carry the uncertainty — every blend
 * cost a little there — and the blend matters where the model would otherwise be sure: from the end of the
 * regular season to the rookie draft, which is when most picks change hands. The mid-season sample is the 40
 * leagues whose weekly data and draft agree on team ids, which leans toward stable, rule-following leagues.
 */
export const RULE_UNCERTAINTY = 0.2

/** mulberry32: a small seeded generator, so a grade is the same every time it is computed. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const played = (t: StandingsTeam) => Math.max(0, t.wins) + Math.max(0, t.losses) + Math.max(0, t.ties)

/**
 * Each team's chance of winning one remaining game: its all-play rate among these scoring levels (the
 * share of the league it outscores), pulled toward .500 by `shrink`.
 */
export function gameWinOdds(levels: ReadonlyArray<{ id: string; v: number }>, shrink = ALL_PLAY_SHRINK): Map<string, number> {
  const out = new Map<string, number>()
  const others = Math.max(1, levels.length - 1)
  for (const me of levels) {
    let beats = 0
    for (const o of levels) {
      if (o.id === me.id) continue
      if (me.v > o.v) beats += 1
      else if (me.v === o.v) beats += 0.5
    }
    out.set(me.id, 0.5 + (beats / others - 0.5) * (1 - shrink))
  }
  return out
}

/** A standard normal draw from the seeded generator (Box–Muller). */
function normal(rand: () => number): number {
  const u = Math.max(rand(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

/**
 * Games a week, from the standings and the schedule: 2 when the league also plays the week's median.
 *
 * Our league settings do not carry Sleeper's `league_average_match`, so it is read off the records: a
 * median league has played about twice as many games as weeks gone by. The 1.5 threshold survives a
 * standings feed one week behind the schedule either way. Without a schedule, only records longer than
 * the whole regular season prove it.
 */
export function gamesPerWeekFrom(maxPlayed: number, weeksDone: number | null, seasonWeeks: number): 1 | 2 {
  if (weeksDone != null && weeksDone > 0) return maxPlayed >= 1.5 * weeksDone ? 2 : 1
  return maxPlayed > seasonWeeks ? 2 : 1
}

/** One game between two teams, from each one's rate against the field (log5). */
function beats(a: number, b: number): number {
  const x = a * (1 - b)
  const y = b * (1 - a)
  return x + y > 0 ? x / (x + y) : 0.5
}

/** Seed order of a standard bracket of `size` (a power of 2): 1 v size, then 4 v 5 … — byes are the seeds past the field. */
function bracketSlots(size: number): number[] {
  let order = [1]
  while (order.length < size) {
    const m = order.length * 2
    order = order.flatMap((s) => [s, m + 1 - s])
  }
  return order
}

/**
 * Every team's finishing place, best first, for teams listed best seed first: a knockout with byes to the
 * top seeds, then the same played again among the teams out in each round — the 3rd-place game, the
 * 5th-place game — so every place is decided by games, as Sleeper's winners bracket does. Not modelled:
 * re-seeding after a round (`playoff_seed_type`), division winners' seeds.
 */
export function playBracket(seeds: readonly string[], rates: ReadonlyMap<string, number>, rand: () => number): string[] {
  if (seeds.length <= 1) return [...seeds]
  let size = 1
  while (size < seeds.length) size *= 2
  let round: Array<string | null> = bracketSlots(size).map((s) => seeds[s - 1] ?? null)
  const outByRound: string[][] = []
  while (round.length > 1) {
    const next: Array<string | null> = []
    const out: string[] = []
    for (let i = 0; i < round.length; i += 2) {
      const a = round[i] ?? null
      const b = round[i + 1] ?? null
      if (!a || !b) { next.push(a ?? b); continue }
      const aWins = rand() < beats(rates.get(a) ?? 0.5, rates.get(b) ?? 0.5)
      next.push(aWins ? a : b)
      out.push(aWins ? b : a)
    }
    outByRound.push(out)
    round = next
  }
  const seedOf = new Map(seeds.map((id, i) => [id, i]))
  const places = [round[0]!]
  for (let r = outByRound.length - 1; r >= 0; r--) {
    const group = [...outByRound[r]!].sort((x, y) => seedOf.get(x)! - seedOf.get(y)!)
    places.push(...playBracket(group, rates, rand))
  }
  return places
}

function tierOf(slotIndex: number, teams: number): PickTier {
  const third = teams / 3
  return slotIndex < third ? 'early' : slotIndex < 2 * third ? 'mid' : 'late'
}

/**
 * The odds each team's NEXT-draft picks land Early / Mid / Late. Null when there is nothing to project:
 * fewer than three teams, or no season length.
 */
export function projectPickSlots(args: {
  teams: readonly StandingsTeam[]
  /** Regular-season WEEKS. */
  seasonWeeks: number
  /**
   * Games each team plays a week: 2 in a league that also plays the week's median score, whose standings
   * count both. 🛑 Read as 1 there, a median league looks twice as far through its season — certain by
   * mid-season (33 of 215 dynasty/keeper Sleeper leagues on 2026-10-11).
   */
  gamesPerWeek?: 1 | 2
  /** The season being played; the projection is for `season + 1`'s draft. */
  season: number
  simulations?: number
  seed?: number
  /**
   * Teams that make the playoffs (the league's `playoff_teams`). Playoff teams draft by playoff finish;
   * without it, or with every team in, the order is reverse standings for all.
   */
  playoffTeams?: number | null
  /** Overrides for calibration; production uses the defaults. */
  strengthCv?: number
  shrink?: number
  ruleUncertainty?: number
}): PickSlotProjection | null {
  const teams = args.teams.filter((t) => t.id)
  const n = teams.length
  if (n < 3 || !(args.seasonWeeks > 0)) return null
  const gpw = args.gamesPerWeek === 2 ? 2 : 1
  const cv = args.strengthCv ?? WEEKLY_SCORE_CV
  const shrink = args.shrink ?? ALL_PLAY_SHRINK
  const weeksOf = (t: StandingsTeam) => played(t) / gpw
  const weeksLeft = Math.max(0, Math.round(args.seasonWeeks - Math.max(0, ...teams.map(weeksOf))))
  // A week's score is counted once in `pointsFor`, whichever number of games it decided.
  const ppw = teams.map((t) => ({ id: t.id, v: weeksOf(t) > 0 ? t.pointsFor / weeksOf(t) : 0, n: weeksOf(t) }))
  const scored = ppw.filter((x) => x.n > 0)
  const leagueAvg = scored.length > 0 ? scored.reduce((s, x) => s + x.v, 0) / scored.length : 0
  const counts = new Map<string, TierOdds>(teams.map((t) => [t.id, { early: 0, mid: 0, late: 0 }]))
  const P = Math.floor(args.playoffTeams ?? 0)
  const playoffs = P >= 2 && P < n
  // A finished regular season is certain only when no playoffs decide the order.
  const sims = weeksLeft === 0 && !playoffs ? 1 : Math.max(1, Math.floor(args.simulations ?? PICK_SLOT_SIMULATIONS))
  const rand = seeded(args.seed ?? 20261011)
  for (let s = 0; s < sims; s++) {
    // This season's draw of every team's true level: its average, give or take what so few weeks can tell.
    const levels = ppw.map((x) => ({
      id: x.id,
      v: x.n > 0 ? x.v + (weeksLeft > 0 ? normal(rand) * (cv * leagueAvg) / Math.sqrt(x.n) : 0) : leagueAvg,
    }))
    const odds = gameWinOdds(levels, shrink)
    const level = new Map(levels.map((x) => [x.id, x.v]))
    const final = teams.map((t) => {
      let w = t.wins + t.ties / 2
      const p = odds.get(t.id) ?? 0.5
      for (let g = 0; g < weeksLeft * gpw; g++) if (rand() < p) w += 1
      // Points keep accruing at the team's drawn level: the tiebreak is the season's points, not today's.
      return { id: t.id, w, pf: t.pointsFor + weeksLeft * (level.get(t.id) ?? 0) }
    })
    // Fewest wins picks first; less scoring picks earlier on a tie.
    final.sort((a, b) => a.w - b.w || a.pf - b.pf)
    let order = final.map((f) => f.id)
    if (playoffs) {
      // The best P by record are seeded 1..P; they pick after every other team, champion last.
      const seeds = order.slice(n - P).reverse()
      order = [...order.slice(0, n - P), ...playBracket(seeds, odds, rand).reverse()]
    }
    order.forEach((id, i) => { counts.get(id)![tierOf(i, n)] += 1 })
  }
  const seasonDone = args.seasonWeeks > 0 ? Math.min(1, Math.max(0, (args.seasonWeeks - weeksLeft) / args.seasonWeeks)) : 0
  const e = (args.ruleUncertainty ?? RULE_UNCERTAINTY) * seasonDone ** 3
  const blend = (x: number) => (1 - e) * (x / sims) + e / 3
  const oddsByTeam = new Map<string, TierOdds>()
  for (const [id, c] of counts) oddsByTeam.set(id, { early: blend(c.early), mid: blend(c.mid), late: blend(c.late) })
  return { draftYear: args.season + 1, oddsByTeam, weeksLeft }
}

/**
 * The draft order once the season AND its playoffs are over, by the rule `projectPickSlots` simulates:
 * teams outside the bracket in reverse standings, then the bracket's teams from worst place to champion.
 * Null while any bracket team has no decided place — the playoffs are still being played, or the league's
 * bracket has no game for that place — and the caller keeps simulating.
 */
export function draftOrderFromFinish(
  records: readonly StandingsTeam[],
  playoffs: { teams: ReadonlySet<string>; placeByTeam: ReadonlyMap<string, number> },
): string[] | null {
  const ids = new Set(records.map((r) => r.id))
  if (playoffs.teams.size < 2 || [...playoffs.teams].some((t) => !ids.has(t) || !playoffs.placeByTeam.has(t))) return null
  const out = records
    .filter((r) => !playoffs.teams.has(r.id))
    .sort((a, b) => a.wins + a.ties / 2 - (b.wins + b.ties / 2) || a.pointsFor - b.pointsFor)
    .map((r) => r.id)
  const po = [...playoffs.teams].sort((a, b) => playoffs.placeByTeam.get(b)! - playoffs.placeByTeam.get(a)!)
  return [...out, ...po]
}

/**
 * A projection from an order that is KNOWN. A set draft order is taken as it stands. One read off the
 * finished season keeps `RULE_UNCERTAINTY`: on 275 real drafts the rule fit about seven in eight, so a team
 * the rule puts in a third lands there 85% of the time, not always.
 */
export function projectionFromOrder(args: {
  order: readonly string[]
  source: DraftOrderSource
  draftYear: number
  ruleUncertainty?: number
}): PickSlotProjection | null {
  const n = args.order.length
  if (n < 3) return null
  const e = args.source === 'draft_order_set' ? 0 : args.ruleUncertainty ?? RULE_UNCERTAINTY
  const oddsByTeam = new Map<string, TierOdds>()
  const slotByTeam = new Map<string, number>()
  args.order.forEach((id, i) => {
    const t = tierOf(i, n)
    oddsByTeam.set(id, {
      early: (t === 'early' ? 1 - e : 0) + e / 3,
      mid: (t === 'mid' ? 1 - e : 0) + e / 3,
      late: (t === 'late' ? 1 - e : 0) + e / 3,
    })
    slotByTeam.set(id, i + 1)
  })
  return { draftYear: args.draftYear, oddsByTeam, weeksLeft: 0, slotByTeam, orderSource: args.source }
}

/**
 * How much the odds say about the pick: 0 for an even three-way split, 1 for a certain third — the
 * odds' distance from an even split (total variation), over the largest distance there is (4/3).
 */
export function oddsCertainty(odds: TierOdds): number {
  const d = (Object.values(odds) as number[]).reduce((s, p) => s + Math.abs(p - 1 / 3), 0)
  return Math.max(0, Math.min(1, d / (4 / 3)))
}

/**
 * A pick's price from its odds.
 *
 * 🛑 NOT THE PLAIN EXPECTATION OVER THE TIER PRICES. FantasyCalc's own price for a pick whose slot is
 * unknown ("2027 1st", 2,764 on the 12-team 1-QB board) sits BELOW the mean of its three tier rows
 * (4,565 / 3,006 / 2,328 → 3,300): the market pays less for a pick nobody can place yet. So an even
 * three-way split — a week-1 pick — would price 19% above the market's own number for exactly that pick.
 * The price moves from the generic row to the tier expectation as the odds firm up: weighted by
 * `oddsCertainty`, a week-1 pick is the generic price and a pick whose third is settled is that tier's.
 */
export function projectedPickPrice(
  odds: TierOdds,
  prices: { early: number; mid: number; late: number; generic: number },
): number {
  const expected = odds.early * prices.early + odds.mid * prices.mid + odds.late * prices.late
  const c = oddsCertainty(odds)
  return Math.round(c * expected + (1 - c) * prices.generic)
}

/**
 * The grade's note for its projected picks — said beside the letter, because the price is an estimate:
 * "Picks priced by where they land in the draft — the order the league set, else this season's standings
 * and playoffs: 2027 1st projected early (62%)."
 */
export function projectedPicksNote(projections: readonly string[]): string | null {
  const list = [...new Set(projections.map((p) => p.trim()).filter(Boolean))]
  if (list.length === 0) return null
  return `Picks priced by where they land in the draft — the order the league set, else this season's standings and playoffs: ${list.join('; ')}.`
}

/** "projected early (62%)" — the likeliest third and its odds. */
export function describeOdds(odds: TierOdds): string {
  const [tier, p] = (Object.entries(odds) as Array<[PickTier, number]>).sort((a, b) => b[1] - a[1])[0]!
  return `projected ${tier} (${Math.round(p * 100)}%)`
}
