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
 *   - The draft order is REVERSE STANDINGS: fewest wins picks first, points scored breaking ties (the team
 *     that scored less picks earlier). Leagues that seed playoff teams by playoff finish, run a lottery or
 *     order by max points are not modelled; the basis says so.
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

export type PickSlotProjection = {
  /** The draft these odds are for: the one after the season being played. */
  draftYear: number
  oddsByTeam: ReadonlyMap<string, TierOdds>
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
  /** Overrides for calibration; production uses the defaults. */
  strengthCv?: number
  shrink?: number
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
  const sims = weeksLeft === 0 ? 1 : Math.max(1, Math.floor(args.simulations ?? PICK_SLOT_SIMULATIONS))
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
    final.forEach((f, i) => { counts.get(f.id)![tierOf(i, n)] += 1 })
  }
  const oddsByTeam = new Map<string, TierOdds>()
  for (const [id, c] of counts) oddsByTeam.set(id, { early: c.early / sims, mid: c.mid / sims, late: c.late / sims })
  return { draftYear: args.season + 1, oddsByTeam, weeksLeft }
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
 * "Picks priced by where they are projected to land, from this season's standings (reverse order of
 * record): 2027 1st projected early (62%)."
 */
export function projectedPicksNote(projections: readonly string[]): string | null {
  const list = [...new Set(projections.map((p) => p.trim()).filter(Boolean))]
  if (list.length === 0) return null
  return `Picks priced by where they are projected to land, from this season's standings (reverse order of record): ${list.join('; ')}.`
}

/** "projected early (62%)" — the likeliest third and its odds. */
export function describeOdds(odds: TierOdds): string {
  const [tier, p] = (Object.entries(odds) as Array<[PickTier, number]>).sort((a, b) => b[1] - a[1])[0]!
  return `projected ${tier} (${Math.round(p * 100)}%)`
}
