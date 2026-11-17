import type { SimGame } from './outlookSim'
import type { OutlookLeague, OutlookTeam } from './seasonOutlook'
import type { WarPosture } from './warRoomFront'

/**
 * The race — War Room phase 8, for the league on screen: the teams fighting over the last playoff
 * spots, side by side, with what each of them still has to play.
 *
 * Season Outlook already computes every input: each team's odds, record and points for, and each
 * team's remaining strength of schedule (`scheduleStrength`: the average fitted weekly score of the
 * opponents still to come, ranked across the league). This lines them up around the playoff cut and
 * adds the one fact a bubble team most wants — which of these rivals it still plays, and when.
 *
 * ⚠ FACTS ABOUT RIVALS, NEVER LABELS (Scout's rule). "3rd-hardest schedule left of 12" and "62%" are
 * measurements; nothing calls a team fading, lucky, or a pushover.
 *
 * ⚠ THE CUT IS THE MODEL'S. `inField` is today's seed against the playoff team count — the same rule the
 * simulation seeds by (wins, then points for). Divisions and head-to-head tiebreaks are not modelled,
 * and Season Outlook says so in its own assumptions.
 *
 * Pure and client-safe.
 */

/** Postures for which the race is live. A clinched or eliminated team has no race to show. */
const RACING: ReadonlySet<WarPosture> = new Set(['bubble', 'contender', 'long_shot'])

/** A team is in the race when its odds sit strictly between these, or it is near the cut by seed. */
const CONTESTED_LOW = 2
const CONTESTED_HIGH = 98
/** Seeds this close to the cut line (either side) are in the race whatever their odds say. */
const NEAR_CUT = 2
export const MAX_ROWS = 8

export type RaceRow = {
  rosterId: string
  name: string | null
  isYou: boolean
  seed: number
  wins: number
  losses: number
  ties: number
  pointsFor: number
  /** Null for a team the model does not simulate. */
  playoffPct: number | null
  /** Inside the playoff field as things stand. */
  inField: boolean
  /** Remaining schedule: 1 = hardest left in the league. Null when not rankable. */
  scheduleRank: number | null
  /** Their remaining opponents' average weekly score, and the league's. */
  opponentAvg: number | null
  gamesLeft: number
  /** Weeks this team still plays YOU. Empty on your own row. */
  vsYou: number[]
}

export type WarRace =
  | {
      kind: 'race'
      playoffTeams: number
      /** Teams with a rankable remaining schedule — the "of N" in "3rd hardest of N". */
      ranked: number
      leagueAvg: number | null
      /** Seed order. */
      rows: RaceRow[]
    }
  | { kind: 'none'; why: 'settled' | 'unplaced' }

export function buildWarRace(args: {
  row: Pick<OutlookLeague, 'teams' | 'playoffTeams' | 'you'> | null
  posture: WarPosture
  /** The simulation's remaining games (the roster model's `sim.remaining`); null when not loaded. */
  remaining: readonly SimGame[] | null
}): WarRace {
  const row = args.row
  if (!row?.you || args.posture === 'unplaced') return { kind: 'none', why: 'unplaced' }
  if (!RACING.has(args.posture)) return { kind: 'none', why: 'settled' }

  const cut = row.playoffTeams
  const you = row.you
  const contested = (t: OutlookTeam) =>
    t.isYou ||
    (t.status == null && t.modelled && t.playoffPct > CONTESTED_LOW && t.playoffPct < CONTESTED_HIGH) ||
    // Seeds cut-NEAR_CUT+1 … cut+NEAR_CUT: the last NEAR_CUT spots in and the first NEAR_CUT out.
    (t.status == null && t.seed > cut - NEAR_CUT && t.seed <= cut + NEAR_CUT)

  const vsYou = (id: string) =>
    (args.remaining ?? [])
      .filter((g) => (g.a === id && g.b === you.rosterId) || (g.b === id && g.a === you.rosterId))
      .map((g) => g.week)
      .sort((a, b) => a - b)

  // Nearest the cut first when the cap bites, so the rows kept are the ones the race is about.
  const chosen = row.teams
    .filter(contested)
    .sort((a, b) => Math.abs(a.seed - cut - 0.5) - Math.abs(b.seed - cut - 0.5) || a.seed - b.seed)
  const kept = chosen.filter((t) => t.isYou).concat(chosen.filter((t) => !t.isYou).slice(0, MAX_ROWS - 1))

  const ranked = row.teams.filter((t) => t.schedule?.remainingRank != null).length
  const leagueAvg = row.teams.find((t) => t.schedule?.leagueMu != null)?.schedule?.leagueMu ?? null

  const rows: RaceRow[] = kept
    .sort((a, b) => a.seed - b.seed)
    .map((t) => ({
      rosterId: t.rosterId,
      name: t.name,
      isYou: t.isYou,
      seed: t.seed,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties ?? 0,
      pointsFor: t.pointsFor,
      playoffPct: t.modelled ? t.playoffPct : null,
      inField: t.seed <= cut,
      scheduleRank: t.schedule?.remainingRank ?? null,
      opponentAvg: t.schedule?.remainingOpponentMu ?? null,
      gamesLeft: t.schedule?.remainingGames ?? 0,
      vsYou: t.isYou ? [] : vsYou(t.rosterId),
    }))

  // You alone is not a race.
  if (rows.length < 2) return { kind: 'none', why: 'settled' }
  return { kind: 'race', playoffTeams: cut, ranked, leagueAvg, rows }
}
