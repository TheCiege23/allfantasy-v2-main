/**
 * Invariants checked between every phase of a simulated week.
 *
 * ⚠ A CHECK IS ONLY WORTH THE INDEPENDENCE OF ITS TWO NUMBERS. Wherever possible the expected value here
 * comes from something the harness owns — its own W/L ledger built from matchup scores, its own record of
 * which players it put in the lineup, the bids it submitted, the rules object — and NOT from another field
 * of the same engine output. Comparing `starterTotal` to `homeScore` alone would agree by construction.
 */
import type { CanonicalLeagueRules } from '@/lib/league-runtime'
import type { CanonicalRosterRuntimeTeamState } from '@/lib/roster-runtime/canonicalRosterRuntime'
import type { NflRedraftLiveScoringRuntimeState } from '@/lib/scoring-runtime/canonicalNflRedraftScoringRuntime'
import type {
  NflRedraftWaiverClaimInput,
  NflRedraftWaiverProcessResult,
} from '@/lib/waiver-runtime/canonicalNflRedraftWaiverRuntime'
import type { CanonicalScheduleStanding } from '@/lib/schedule-runtime/canonicalScheduleRuntime'
import type { NflRedraftPlayoffSeedState } from '@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime'
import { allRosterIds } from './bots'
import type { SimPhase, SimTeam, SimViolation } from './types'

type Where = { week: number | null; phase: SimPhase }

const round2 = (value: number) => Math.round(value * 100) / 100
const near = (a: number, b: number) => Math.abs(a - b) < 0.011

export type LedgerRow = { wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number }
export type Ledger = Map<string, LedgerRow>

/** Every player in the universe is on exactly one roster or in the free-agent pool — never both, never neither. */
export function checkPlayerConservation(input: Where & {
  teams: SimTeam[]
  freeAgentIds: string[]
  universeIds: Set<string>
}): SimViolation[] {
  const out: SimViolation[] = []
  const owner = new Map<string, string>()
  for (const team of input.teams) {
    const ids = allRosterIds(team.sections)
    if (team.eliminatedWeek != null && ids.length) {
      out.push({ ...where(input), code: 'ELIMINATED_TEAM_HOLDS_PLAYERS', rosterId: team.rosterId, message: `${team.rosterId} was eliminated in week ${team.eliminatedWeek} but still rosters ${ids.length} players.` })
    }
    for (const id of ids) {
      const prior = owner.get(id)
      if (prior) {
        out.push({ ...where(input), code: 'PLAYER_ON_TWO_ROSTERS', message: `${id} is on ${prior} and ${team.rosterId}.`, detail: { playerId: id, rosters: [prior, team.rosterId] } })
      }
      owner.set(id, team.rosterId)
      if (!input.universeIds.has(id)) {
        out.push({ ...where(input), code: 'PLAYER_INVENTED', rosterId: team.rosterId, message: `${team.rosterId} rosters ${id}, which is not in the player universe.` })
      }
    }
  }
  const pool = new Set<string>()
  for (const id of input.freeAgentIds) {
    if (owner.has(id)) {
      out.push({ ...where(input), code: 'ROSTERED_PLAYER_IN_FREE_AGENCY', message: `${id} is on ${owner.get(id)} and in the free-agent pool.` })
    }
    if (pool.has(id)) out.push({ ...where(input), code: 'FREE_AGENT_LISTED_TWICE', message: `${id} appears twice in the free-agent pool.` })
    pool.add(id)
  }
  for (const id of input.universeIds) {
    if (!owner.has(id) && !pool.has(id)) {
      out.push({ ...where(input), code: 'PLAYER_LOST', message: `${id} is on no roster and not in the free-agent pool.` })
    }
  }
  return out
}

export function checkRosterLimits(input: Where & { teams: SimTeam[]; rules: CanonicalLeagueRules }): SimViolation[] {
  const limit = input.rules.roster.size
  if (limit == null) return []
  return input.teams
    .filter((team) => team.eliminatedWeek == null)
    .filter((team) => team.sections.starters.length + team.sections.bench.length > limit)
    .map((team) => ({
      ...where(input),
      code: 'ROSTER_OVER_LIMIT',
      rosterId: team.rosterId,
      message: `${team.rosterId} rosters ${team.sections.starters.length + team.sections.bench.length} active players; the limit is ${limit}.`,
    }))
}

/**
 * FAAB stays in [0, budget] per team, and the league total only ever falls by what waivers actually
 * charged. `expectedLeagueTotal` is the harness's own running total: start × teams − Σ winning bids.
 */
export function checkFaab(input: Where & { teams: SimTeam[]; budget: number; expectedLeagueTotal: number }): SimViolation[] {
  const out: SimViolation[] = []
  let total = 0
  for (const team of input.teams) {
    total += team.faabBalance
    if (team.faabBalance < 0) {
      out.push({ ...where(input), code: 'FAAB_NEGATIVE', rosterId: team.rosterId, message: `${team.rosterId} has $${team.faabBalance} FAAB.` })
    }
    if (team.faabBalance > input.budget) {
      out.push({ ...where(input), code: 'FAAB_OVER_BUDGET', rosterId: team.rosterId, message: `${team.rosterId} has $${team.faabBalance} FAAB against a $${input.budget} budget.` })
    }
  }
  if (!near(total, input.expectedLeagueTotal)) {
    out.push({
      ...where(input),
      code: 'FAAB_NOT_CONSERVED',
      message: `League FAAB totals $${round2(total)}; winning bids leave $${round2(input.expectedLeagueTotal)}.`,
    })
  }
  return out
}

/** Every waiver award checked against the claim the bot actually submitted and the rosters before the run. */
export function checkWaiverResults(input: Where & {
  claims: NflRedraftWaiverClaimInput[]
  results: NflRedraftWaiverProcessResult[]
  ownerBefore: Map<string, string>
  freeAgentsBefore: Set<string>
  faabBefore: Map<string, number>
}): SimViolation[] {
  const out: SimViolation[] = []
  const claimById = new Map(input.claims.map((claim) => [claim.claimId, claim]))
  const awarded = new Map<string, string>()
  const spentByRoster = new Map<string, number>()
  for (const result of input.results) {
    if (!result.success) continue
    const claim = claimById.get(result.claimId)
    if (!claim) {
      out.push({ ...where(input), code: 'WAIVER_RESULT_FOR_UNKNOWN_CLAIM', rosterId: result.rosterId, message: `Waivers awarded claim ${result.claimId}, which no team submitted.` })
      continue
    }
    const bid = Number(claim.bidAmount ?? 0)
    if (bid < 0) {
      out.push({ ...where(input), code: 'WAIVER_NEGATIVE_BID_AWARDED', rosterId: result.rosterId, message: `Claim ${claim.claimId} bid $${bid} and won.` })
    }
    if (!input.freeAgentsBefore.has(result.addPlayerId)) {
      out.push({
        ...where(input),
        code: 'WAIVER_AWARDED_UNAVAILABLE_PLAYER',
        rosterId: result.rosterId,
        message: `${result.rosterId} won ${result.addPlayerId}, who was ${input.ownerBefore.has(result.addPlayerId) ? `on ${input.ownerBefore.get(result.addPlayerId)}` : 'not a free agent'}.`,
      })
    }
    const prior = awarded.get(result.addPlayerId)
    if (prior) {
      out.push({ ...where(input), code: 'WAIVER_PLAYER_AWARDED_TWICE', message: `${result.addPlayerId} was awarded to ${prior} and ${result.rosterId}.` })
    }
    awarded.set(result.addPlayerId, result.rosterId)
    if (result.dropPlayerId && input.ownerBefore.get(result.dropPlayerId) !== result.rosterId) {
      out.push({
        ...where(input),
        code: 'WAIVER_DROPPED_FOREIGN_PLAYER',
        rosterId: result.rosterId,
        message: `${result.rosterId} dropped ${result.dropPlayerId}, owned by ${input.ownerBefore.get(result.dropPlayerId) ?? 'nobody'}.`,
      })
    }
    if (!near(result.faabSpent, Math.max(0, bid))) {
      out.push({ ...where(input), code: 'WAIVER_CHARGED_WRONG_AMOUNT', rosterId: result.rosterId, message: `Claim ${claim.claimId} bid $${bid} but was charged $${result.faabSpent}.` })
    }
    spentByRoster.set(result.rosterId, (spentByRoster.get(result.rosterId) ?? 0) + result.faabSpent)
  }
  for (const [rosterId, spent] of spentByRoster) {
    const before = input.faabBefore.get(rosterId) ?? 0
    if (spent > before + 0.001) {
      out.push({ ...where(input), code: 'WAIVER_OVERSPEND', rosterId, message: `${rosterId} won $${spent} of claims with $${before} FAAB.` })
    }
  }
  return out
}

/**
 * Score = Σ the starters THE HARNESS SET, every bench point excluded, players with no stat line at zero,
 * and the matchup winner is the higher score.
 */
export function checkScoring(input: Where & {
  scoring: NflRedraftLiveScoringRuntimeState
  starterIdsByRoster: Map<string, string[]>
  playersWithStats: Set<string>
}): SimViolation[] {
  const out: SimViolation[] = []
  for (const team of input.scoring.teams) {
    const expected = new Set(input.starterIdsByRoster.get(team.rosterId) ?? [])
    const scored = new Set(team.starters.map((player) => player.playerId))
    const benchCounted = [...scored].filter((id) => !expected.has(id))
    const starterMissed = [...expected].filter((id) => !scored.has(id))
    if (benchCounted.length || starterMissed.length) {
      out.push({ ...where(input), code: 'SCORED_STARTERS_MISMATCH', rosterId: team.rosterId, message: `${team.rosterId} scored a different set of starters than it set.`, detail: { benchCounted, starterMissed } })
    }
    const sum = round2(team.starters.reduce((total, player) => total + player.fantasyPoints, 0))
    if (!near(sum, team.starterTotal)) {
      out.push({ ...where(input), code: 'TEAM_SCORE_NOT_STARTER_SUM', rosterId: team.rosterId, message: `${team.rosterId} starter total ${team.starterTotal} ≠ Σ starters ${sum}.` })
    }
    for (const player of [...team.starters, ...team.bench]) {
      if (!input.playersWithStats.has(player.playerId) && player.fantasyPoints !== 0) {
        out.push({ ...where(input), code: 'PLAYER_WITHOUT_STATS_SCORED', rosterId: team.rosterId, message: `${player.playerId} did not play (bye or injured) but scored ${player.fantasyPoints}.` })
      }
    }
  }
  for (const matchup of input.scoring.matchups) {
    if (!near(matchup.homeScore, matchup.home.starterTotal) || (matchup.away && !near(matchup.awayScore ?? NaN, matchup.away.starterTotal))) {
      out.push({ ...where(input), code: 'MATCHUP_SCORE_NOT_TEAM_SCORE', message: `Matchup ${matchup.matchupId} shows ${matchup.homeScore}-${matchup.awayScore} for teams scoring ${matchup.home.starterTotal}-${matchup.away?.starterTotal}.` })
    }
    if (!matchup.complete || matchup.awayScore == null) continue
    const expectedWinner =
      matchup.homeScore > matchup.awayScore ? matchup.homeRosterId : matchup.homeScore < matchup.awayScore ? matchup.awayRosterId : null
    if (expectedWinner !== matchup.winnerRosterId) {
      out.push({ ...where(input), code: 'MATCHUP_WINNER_WRONG', message: `Matchup ${matchup.matchupId} ${matchup.homeScore}-${matchup.awayScore} names ${matchup.winnerRosterId ?? 'no winner'}.` })
    }
  }
  return out
}

/** The engine's standings against the harness's own ledger, built from the scored matchups. */
export function checkStandings(input: Where & { standings: CanonicalScheduleStanding[]; ledger: Ledger }): SimViolation[] {
  const out: SimViolation[] = []
  let wins = 0
  let losses = 0
  for (const row of input.standings) {
    wins += row.wins
    losses += row.losses
    const mine = input.ledger.get(row.rosterId)
    if (!mine) continue
    // The schedule runtime keeps PF to one decimal, re-rounding the running total each week, so allow
    // half a tenth per game played. Anything beyond that is a real disagreement, not display precision.
    const games = mine.wins + mine.losses + mine.ties
    const pfClose = Math.abs(row.pointsFor - mine.pointsFor) <= 0.05 * Math.max(1, games) + 0.001
    if (row.wins !== mine.wins || row.losses !== mine.losses || row.ties !== mine.ties || !pfClose) {
      out.push({
        ...where(input),
        code: 'STANDINGS_MISMATCH',
        rosterId: row.rosterId,
        message: `${row.rosterId} standings ${row.wins}-${row.losses}-${row.ties} (${row.pointsFor} PF); results say ${mine.wins}-${mine.losses}-${mine.ties} (${round2(mine.pointsFor)} PF).`,
      })
    }
  }
  if (wins !== losses) {
    out.push({ ...where(input), code: 'STANDINGS_UNBALANCED', message: `League standings show ${wins} wins against ${losses} losses.` })
  }
  return out
}

/** The roster engine must flag a starter the harness knows is out or on bye. */
export function checkLineupFlags(input: Where & {
  rosterTeams: CanonicalRosterRuntimeTeamState[]
  week: number
}): { violations: SimViolation[]; inactive: number; bye: number } {
  const violations: SimViolation[] = []
  let inactive = 0
  let bye = 0
  for (const team of input.rosterTeams) {
    const codesFor = (playerId: string) =>
      new Set(team.validation.issues.filter((issue) => issue.playerId === playerId).map((issue) => issue.code))
    for (const starter of team.sections.starters) {
      const codes = codesFor(starter.playerId)
      if (String(starter.status).toUpperCase() === 'OUT') {
        inactive += 1
        if (!codes.has('INACTIVE_STARTER')) {
          violations.push({ ...where(input), code: 'INACTIVE_STARTER_NOT_FLAGGED', rosterId: team.rosterId, message: `${team.rosterId} starts ${starter.playerId} (OUT) and the roster engine raised nothing.` })
        }
      }
      if (starter.byeWeek === input.week) {
        bye += 1
        if (!codes.has('STARTER_ON_BYE')) {
          violations.push({ ...where(input), code: 'BYE_STARTER_NOT_FLAGGED', rosterId: team.rosterId, message: `${team.rosterId} starts ${starter.playerId} on bye and the roster engine raised nothing.` })
        }
      }
    }
  }
  return { violations, inactive, bye }
}

/**
 * The playoff field against the harness's own ordering (win %, wins, points for, fewer points against).
 * Only asserted where the ordering is strict at the cut line; a dead heat there is the engine's call.
 */
export function checkPlayoffSeeds(input: Where & { seeds: NflRedraftPlayoffSeedState[]; ledger: Ledger; fieldSize: number }): SimViolation[] {
  const rows = [...input.ledger.entries()].map(([rosterId, row]) => {
    const games = row.wins + row.losses + row.ties
    return { rosterId, ...row, winPct: games ? (row.wins + row.ties * 0.5) / games : 0 }
  })
  const key = (row: (typeof rows)[number]) => [row.winPct, row.wins, round2(row.pointsFor), -round2(row.pointsAgainst)]
  const cmp = (a: (typeof rows)[number], b: (typeof rows)[number]) => {
    const ka = key(a)
    const kb = key(b)
    for (let i = 0; i < ka.length; i += 1) if (ka[i] !== kb[i]) return kb[i]! - ka[i]!
    return 0
  }
  rows.sort(cmp)
  const out: SimViolation[] = []
  const field = Math.min(input.fieldSize, rows.length)
  const seeded = new Set(input.seeds.map((seed) => seed.rosterId))
  if (input.seeds.length !== field) {
    out.push({ ...where(input), code: 'PLAYOFF_FIELD_SIZE_WRONG', message: `${input.seeds.length} teams seeded; the field is ${field}.` })
  }
  const lastIn = rows[field - 1]
  const firstOut = rows[field]
  if (lastIn && (!firstOut || cmp(lastIn, firstOut) !== 0)) {
    const expected = rows.slice(0, field).map((row) => row.rosterId)
    const missing = expected.filter((id) => !seeded.has(id))
    if (missing.length) {
      out.push({ ...where(input), code: 'PLAYOFF_FIELD_WRONG', message: `Standings put ${missing.join(', ')} in the playoffs; the bracket left them out.`, detail: { expected, seeded: [...seeded] } })
    }
  }
  if (rows[0] && rows[1] && cmp(rows[0], rows[1]) !== 0) {
    const top = input.seeds.find((seed) => seed.seed === 1)
    if (top && top.rosterId !== rows[0].rosterId) {
      out.push({ ...where(input), code: 'TOP_SEED_WRONG', message: `${rows[0].rosterId} has the best record outright but ${top.rosterId} is the 1 seed.` })
    }
  }
  return out
}

function where(input: Where): Where {
  return { week: input.week, phase: input.phase }
}
