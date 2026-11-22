/**
 * Seeded, bot-driven season simulation over the REAL canonical league runtimes.
 *
 * `lib/redraft-season-simulation/` (G43) proves one scripted season end to end. This is its fuzz
 * counterpart: same runtimes, but every draft pick, lineup, waiver claim, trade, injury and stat line
 * comes from one seed and a cast of bot personas, and invariants are checked after every phase of every
 * week. A failure names its seed, format, week and phase, and `report.reproduce` replays it exactly.
 *
 * What is the engine and what is the harness — read this before trusting a green run:
 * - ENGINE (code under test): draft order, roster sections and lineup validation, schedule and standings,
 *   live scoring, waiver validation and processing, trade validation and execution, playoff seeding,
 *   bracket and advancement, guillotine tiebreak selection.
 * - HARNESS: stat generation, injuries, bot decisions, and the guillotine roster RELEASE (the real
 *   release engine is DB-bound). Invariants about those parts guard the harness, not the product.
 *
 * Pure by construction: no Prisma, no fetch, no notifications. Every timestamp comes from the sim clock.
 */
import type { CanonicalLeagueRules } from '@/lib/league-runtime'
import { getDraftOrderEntry, type DraftRuntimeSlot } from '@/lib/draft-runtime/canonicalDraftRuntime'
import {
  buildCanonicalRosterRuntimeState,
  buildCanonicalRosterSectionsFromDraftedPlayers,
  buildCanonicalStarterSlots,
  type RosterRuntimePlayer,
  type RosterRuntimeSections,
} from '@/lib/roster-runtime/canonicalRosterRuntime'
import {
  buildCanonicalScheduleRuntimeState,
  type CanonicalScheduleRuntimeMatchup,
  type ScheduleRuntimeMatchupInput,
} from '@/lib/schedule-runtime/canonicalScheduleRuntime'
import { buildNflRedraftLiveScoringRuntimeState, calculateNflRedraftFantasyPoints, type NflRedraftLiveScoringRuntimeState, type NflRedraftRuntimeScoreInput, type NflRedraftRuntimeTeamInput } from '@/lib/scoring-runtime/canonicalNflRedraftScoringRuntime'
import {
  buildNflRedraftWaiverRuntimeState,
  processNflRedraftWaiverClaims,
  validateNflRedraftWaiverClaim,
  type NflRedraftWaiverClaimInput,
  type NflRedraftWaiverPlayerInput,
  type NflRedraftWaiverRosterInput,
} from '@/lib/waiver-runtime/canonicalNflRedraftWaiverRuntime'
import {
  buildNflRedraftTradeRuntimeState,
  executeNflRedraftTrade,
  validateNflRedraftTradeProposal,
} from '@/lib/trade-runtime/canonicalNflRedraftTradeRuntime'
import {
  advanceNflRedraftPlayoffRound,
  buildNflRedraftPlayoffRuntimeState,
  finalizeNflRedraftPlayoffChampion,
  generateNflRedraftPlayoffBracket,
  type NflRedraftPlayoffRuntimeState,
} from '@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime'
import { resolveTiebreak } from '@/lib/guillotine/GuillotineTiebreakResolver'
import {
  allRosterIds,
  chooseLineup,
  chooseTrades,
  chooseWaiverClaims,
  receiverAccepts,
  rosterPlayerFor,
  type BotView,
  type ObservedPoints,
  type TradeIntent,
} from './bots'
import { createSimClock, nflDraftAt, nflWaiverRunAt, nflWeekStart, type SimClock } from './clock'
import {
  checkFaab,
  checkLineupFlags,
  checkPlayerConservation,
  checkPlayoffSeeds,
  checkRosterLimits,
  checkScoring,
  checkStandings,
  checkWaiverResults,
  type Ledger,
} from './invariants'
import { buildPlayerPool, rollInjuries, weeklyStatLine, type InjuryBook, type SimPlayer } from './players'
import { createSimRng, normalizeSeed, type SimRng } from './rng'
import { buildSimRules, DEFAULT_SIM_STARTERS } from './rules'
import type { BotPersona, SimPhase, SimSeasonOptions, SimSeasonReport, SimSignals, SimTeam, SimViolation } from './types'

export const DEFAULT_PERSONA_CYCLE: BotPersona[] = [
  'active', 'chaos', 'ghost', 'tanker', 'colluder', 'colluder', 'active', 'active', 'active', 'chaos', 'active', 'active',
]

const GUILLOTINE_TIEBREAKERS = ['season_points', 'bench_points', 'draft_slot'] as const

type Ctx = {
  rules: CanonicalLeagueRules
  leagueId: string
  seasonId: string
  season: number
  clock: SimClock
  universe: SimPlayer[]
  playersById: Map<string, SimPlayer>
  universeIds: Set<string>
  teams: SimTeam[]
  freeAgentIds: string[]
  injuries: InjuryBook
  observed: ObservedPoints
  ledger: Ledger
  expectedFaabTotal: number
  rng: { draft: SimRng; stats: SimRng; injuries: SimRng; bots: SimRng }
  violations: SimViolation[]
  signals: SimSignals
  maxViolations: number
  sequence: number
  pendingTrades: Array<{ intent: TradeIntent; proposalId: string; createdAtIso: string; acceptWeek: number }>
}

class TooManyViolations extends Error {}

function record(ctx: Ctx, violations: SimViolation[]): void {
  for (const violation of violations) {
    ctx.violations.push(violation)
    if (ctx.violations.length >= ctx.maxViolations) throw new TooManyViolations(`stopped after ${ctx.maxViolations} violations`)
  }
}

function bump(ctx: Ctx, code: string): void {
  ctx.signals.rejectionCodes[code] = (ctx.signals.rejectionCodes[code] ?? 0) + 1
}

function liveTeams(ctx: Ctx): SimTeam[] {
  return ctx.teams.filter((team) => team.eliminatedWeek == null)
}

function botView(ctx: Ctx, team: SimTeam, week: number): BotView {
  return {
    rules: ctx.rules,
    week,
    team,
    teams: ctx.teams,
    freeAgentIds: ctx.freeAgentIds,
    playersById: ctx.playersById,
    injuries: ctx.injuries,
    observed: ctx.observed,
    rng: ctx.rng.bots,
    nextSequence: () => {
      ctx.sequence += 1
      return ctx.sequence
    },
  }
}

// ── Draft ──────────────────────────────────────────────────────────────

function starterNeeds(rules: CanonicalLeagueRules): Record<string, number> {
  const needs: Record<string, number> = {}
  for (const slot of buildCanonicalStarterSlots(rules)) {
    const key = slot.flexible ? 'FLEX' : slot.allowedPositions[0]!.toUpperCase()
    needs[key] = (needs[key] ?? 0) + 1
  }
  return needs
}

const DRAFT_CAPS: Record<string, number> = { QB: 2, TE: 2, K: 1, DEF: 1 }

function draftPick(ctx: Ctx, team: SimTeam, drafted: SimPlayer[], available: SimPlayer[], picksLeft: number): SimPlayer {
  const needs = starterNeeds(ctx.rules)
  const counts: Record<string, number> = {}
  for (const player of drafted) counts[player.position] = (counts[player.position] ?? 0) + 1
  const missing: Record<string, number> = {}
  let flexSurplus = 0
  for (const position of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
    const need = needs[position] ?? 0
    missing[position] = Math.max(0, need - (counts[position] ?? 0))
    if (['RB', 'WR', 'TE'].includes(position)) flexSurplus += Math.max(0, (counts[position] ?? 0) - need)
  }
  const flexMissing = Math.max(0, (needs.FLEX ?? 0) - flexSurplus)
  const totalMissing = Object.values(missing).reduce((a, b) => a + b, 0) + flexMissing
  const mustFill = picksLeft <= totalMissing
  const candidates = available.filter((player) => {
    if ((counts[player.position] ?? 0) >= (DRAFT_CAPS[player.position] ?? 99)) return false
    if (!mustFill) return true
    if ((missing[player.position] ?? 0) > 0) return true
    return flexMissing > 0 && ['RB', 'WR', 'TE'].includes(player.position)
  })
  const pool = candidates.length ? candidates : available
  if (team.persona === 'chaos') return ctx.rng.draft.pick(pool.slice(0, 12))
  return ctx.rng.draft.chance(0.2) && pool[1] ? pool[1] : pool[0]!
}

function runDraft(ctx: Ctx): void {
  const rosterSize = ctx.rules.roster.size ?? 0
  const slotOrder: DraftRuntimeSlot[] = ctx.teams.map((team) => ({
    slot: team.draftSlot,
    rosterId: team.rosterId,
    displayName: team.displayName,
    userId: team.ownerId,
  }))
  const available = [...ctx.universe].sort((a, b) => a.adp - b.adp)
  const draftedBy = new Map<string, SimPlayer[]>(ctx.teams.map((team) => [team.rosterId, []]))
  const totalPicks = ctx.teams.length * rosterSize
  for (let overall = 1; overall <= totalPicks; overall += 1) {
    const order = getDraftOrderEntry({ overall, teamCount: ctx.teams.length, draftType: 'snake', thirdRoundReversal: false, slotOrder })
    const team = ctx.teams.find((row) => row.rosterId === order.rosterId)!
    const mine = draftedBy.get(team.rosterId)!
    const picksLeft = rosterSize - mine.length
    const player = draftPick(ctx, team, mine, available, picksLeft)
    available.splice(available.indexOf(player), 1)
    mine.push(player)
  }
  for (const team of ctx.teams) {
    const players = draftedBy.get(team.rosterId)!.map((player) => ({ ...rosterPlayerFor(player, 1, ctx.injuries), acquisitionType: 'draft' }))
    team.sections = buildCanonicalRosterSectionsFromDraftedPlayers({ rules: ctx.rules, draftedPlayers: players })
  }
  ctx.freeAgentIds = available.map((player) => player.playerId)

  const rosterState = buildCanonicalRosterRuntimeState({ rules: ctx.rules, teams: ctx.teams.map(rosterInput), now: ctx.clock.now(), scoringWeek: 1 })
  record(
    ctx,
    rosterState.teams
      .filter((team) => !team.validation.ok)
      .map((team) => ({
        code: 'DRAFT_ROSTER_INVALID',
        week: 0,
        phase: 'draft' as SimPhase,
        rosterId: team.rosterId,
        message: `${team.rosterId} left the draft with an invalid roster: ${team.validation.issues.filter((issue) => issue.severity === 'blocking').map((issue) => issue.code).join(', ')}`,
      })),
  )
  record(ctx, checkPlayerConservation({ week: 0, phase: 'draft', teams: ctx.teams, freeAgentIds: ctx.freeAgentIds, universeIds: ctx.universeIds }))
}

// ── Shapes the runtimes take ───────────────────────────────────────────

function rosterInput(team: SimTeam) {
  return { rosterId: team.rosterId, displayName: team.displayName, platformUserId: team.ownerId, sections: team.sections }
}

function slotTypeFor(section: 'starters' | 'bench' | 'ir', player: RosterRuntimePlayer): string {
  if (section === 'bench') return 'BENCH'
  if (section === 'ir') return 'IR'
  return player.position
}

function flatPlayers(team: SimTeam): NflRedraftWaiverPlayerInput[] {
  return (['starters', 'bench', 'ir'] as const).flatMap((section) =>
    team.sections[section].map((player) => ({
      playerId: player.playerId,
      playerName: player.playerName,
      position: player.position,
      team: player.team ?? null,
      sport: 'NFL',
      slotType: slotTypeFor(section, player),
      injuryStatus: player.status ?? null,
      acquisitionType: player.acquisitionType ?? null,
    })),
  )
}

function rosterRows(teams: SimTeam[]): NflRedraftWaiverRosterInput[] {
  return teams.map((team) => ({
    rosterId: team.rosterId,
    displayName: team.displayName,
    ownerId: team.ownerId,
    ownerName: team.displayName,
    faabBalance: team.faabBalance,
    waiverPriority: team.waiverPriority,
    players: flatPlayers(team),
  }))
}

function scoringTeams(teams: SimTeam[]): NflRedraftRuntimeTeamInput[] {
  return teams.map((team) => ({
    rosterId: team.rosterId,
    displayName: team.displayName,
    ownerName: team.displayName,
    players: flatPlayers(team).map((player) => ({
      rosterId: team.rosterId,
      playerId: player.playerId,
      playerName: player.playerName,
      position: player.position,
      team: player.team,
      slotType: player.slotType ?? 'BENCH',
      injuryStatus: player.injuryStatus,
    })),
  }))
}

/**
 * Applies the engine's post-transaction rosters: the set of players comes from the ENGINE; the harness only
 * keeps its own lineup order for the players that stayed, and benches new arrivals.
 */
function applyEngineRosters(ctx: Ctx, rows: Array<{ rosterId: string; faabBalance: number; waiverPriority?: number; players: Array<{ playerId: string }> }>, week: number): void {
  for (const row of rows) {
    const team = ctx.teams.find((entry) => entry.rosterId === row.rosterId)
    if (!team) continue
    const ids = new Set(row.players.map((player) => player.playerId))
    const kept = (list: RosterRuntimePlayer[]) => list.filter((player) => ids.has(player.playerId))
    const existing = new Set(allRosterIds(team.sections))
    const arrivals = [...ids]
      .filter((id) => !existing.has(id))
      .map((id) => {
        const player = ctx.playersById.get(id)
        return player ? rosterPlayerFor(player, week, ctx.injuries) : { playerId: id, playerName: id, position: 'UNK' }
      })
    team.sections = { starters: kept(team.sections.starters), bench: [...kept(team.sections.bench), ...arrivals], ir: kept(team.sections.ir) }
    team.faabBalance = row.faabBalance
    if (row.waiverPriority != null) team.waiverPriority = row.waiverPriority
  }
}

function ownerMap(teams: SimTeam[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const team of teams) for (const id of allRosterIds(team.sections)) map.set(id, team.rosterId)
  return map
}

// ── One scoring week ───────────────────────────────────────────────────

function setLineups(ctx: Ctx, week: number, teams: SimTeam[]): void {
  for (const team of teams) team.sections = chooseLineup(botView(ctx, team, week))
  const rosterState = buildCanonicalRosterRuntimeState({ rules: ctx.rules, teams: teams.map(rosterInput), now: ctx.clock.now(), scoringWeek: week })
  const flags = checkLineupFlags({ week, phase: 'lineups', rosterTeams: rosterState.teams })
  ctx.signals.inactiveStarterWeeks += flags.inactive
  ctx.signals.byeStarterWeeks += flags.bye
  record(ctx, flags.violations)
}

function scoreWeek(ctx: Ctx, week: number, teams: SimTeam[], matchups: CanonicalScheduleRuntimeMatchup[]): NflRedraftLiveScoringRuntimeState {
  const statsByPlayer = new Map<string, Record<string, number>>()
  for (const player of ctx.universe) {
    const line = weeklyStatLine({ rng: ctx.rng.stats.fork(`${week}:${player.playerId}`), player, week, injuries: ctx.injuries })
    if (line) statsByPlayer.set(player.playerId, line)
  }
  const rostered = new Set(teams.flatMap((team) => allRosterIds(team.sections)))
  const scoreRows: NflRedraftRuntimeScoreInput[] = [...statsByPlayer.entries()]
    .filter(([id]) => rostered.has(id))
    .map(([playerId, stats]) => ({ playerId, sport: 'NFL', stats, isFinalized: true, source: 'season-sim', updatedAtIso: ctx.clock.now().toISOString() }))
  const scoring = buildNflRedraftLiveScoringRuntimeState({
    leagueId: ctx.leagueId,
    seasonId: ctx.seasonId,
    season: ctx.season,
    week,
    rules: ctx.rules,
    teams: scoringTeams(teams),
    matchups: matchups
      .filter((matchup) => matchup.week === week && !matchup.bye)
      .map((matchup) => ({ matchupId: matchup.id, week, homeRosterId: matchup.homeRosterId, awayRosterId: matchup.awayRosterId, status: 'scheduled' })),
    scoreRows,
    now: ctx.clock.now(),
  })
  record(
    ctx,
    checkScoring({
      week,
      phase: 'scoring',
      scoring,
      starterIdsByRoster: new Map(teams.map((team) => [team.rosterId, team.sections.starters.map((player) => player.playerId)])),
      playersWithStats: new Set(statsByPlayer.keys()),
    }),
  )
  // What every manager can see afterwards: each player's score, computed by the real scorer.
  for (const [playerId, stats] of statsByPlayer) {
    const player = ctx.playersById.get(playerId)!
    const { points } = calculateNflRedraftFantasyPoints({ settings: scoring.settings, stats, position: player.position })
    const seen = ctx.observed.get(playerId) ?? { total: 0, games: 0 }
    ctx.observed.set(playerId, { total: seen.total + points, games: seen.games + 1 })
  }
  return scoring
}

// ── Waivers ────────────────────────────────────────────────────────────

function runWaivers(ctx: Ctx, nextWeek: number): void {
  ctx.clock.set(nflWaiverRunAt(ctx.season, nextWeek))
  const teams = liveTeams(ctx)
  const freeAgents = (): NflRedraftWaiverPlayerInput[] =>
    ctx.freeAgentIds.map((id) => {
      const player = ctx.playersById.get(id)!
      return { playerId: id, playerName: player.playerName, position: player.position, team: player.team, sport: 'NFL', slotType: 'BENCH' }
    })
  const stateWith = (claims: NflRedraftWaiverClaimInput[]) =>
    buildNflRedraftWaiverRuntimeState({
      leagueId: ctx.leagueId,
      seasonId: ctx.seasonId,
      season: ctx.season,
      week: nextWeek,
      rules: ctx.rules,
      rosters: rosterRows(teams),
      claims,
      freeAgents: freeAgents(),
      now: ctx.clock.now(),
    })

  const accepted: NflRedraftWaiverClaimInput[] = []
  for (const team of teams) {
    for (const claim of chooseWaiverClaims(botView(ctx, team, nextWeek), ctx.clock.now())) {
      ctx.signals.waiverClaimsSubmitted += 1
      const validation = validateNflRedraftWaiverClaim({ state: stateWith(accepted), claim })
      if (validation.ok) accepted.push(claim)
      else {
        ctx.signals.waiverClaimsRejectedAtSubmit += 1
        bump(ctx, `waiver:${validation.code}`)
      }
    }
  }
  if (!accepted.length) return

  const ownerBefore = ownerMap(teams)
  const freeAgentsBefore = new Set(ctx.freeAgentIds)
  const faabBefore = new Map(teams.map((team) => [team.rosterId, team.faabBalance]))
  const processed = processNflRedraftWaiverClaims({ state: stateWith(accepted), actorUserId: 'sim-commissioner', now: ctx.clock.now() })
  record(ctx, checkWaiverResults({ week: nextWeek, phase: 'waivers', claims: accepted, results: processed.results, ownerBefore, freeAgentsBefore, faabBefore }))

  for (const result of processed.results) {
    if (!result.success) {
      ctx.signals.waiverClaimsLost += 1
      continue
    }
    ctx.signals.waiverClaimsWon += 1
    ctx.expectedFaabTotal -= Math.max(0, Number(accepted.find((claim) => claim.claimId === result.claimId)?.bidAmount ?? 0))
    ctx.freeAgentIds = ctx.freeAgentIds.filter((id) => id !== result.addPlayerId)
    if (result.dropPlayerId && !ctx.freeAgentIds.includes(result.dropPlayerId)) ctx.freeAgentIds.push(result.dropPlayerId)
  }
  applyEngineRosters(ctx, processed.teams, nextWeek)
  afterTransactions(ctx, nextWeek, 'waivers')
}

function afterTransactions(ctx: Ctx, week: number, phase: SimPhase): void {
  record(ctx, checkPlayerConservation({ week, phase, teams: ctx.teams, freeAgentIds: ctx.freeAgentIds, universeIds: ctx.universeIds }))
  record(ctx, checkRosterLimits({ week, phase, teams: ctx.teams, rules: ctx.rules }))
  record(ctx, checkFaab({ week, phase, teams: ctx.teams, budget: ctx.rules.waivers.faabBudget ?? 0, expectedLeagueTotal: ctx.expectedFaabTotal }))
}

// ── Trades ─────────────────────────────────────────────────────────────

function tradeState(ctx: Ctx, week: number, proposal: { proposalId: string; intent: TradeIntent; createdAtIso: string }) {
  return buildNflRedraftTradeRuntimeState({
    leagueId: ctx.leagueId,
    seasonId: ctx.seasonId,
    season: ctx.season,
    week,
    rules: ctx.rules,
    rosters: rosterRows(liveTeams(ctx)),
    proposals: [
      {
        proposalId: proposal.proposalId,
        proposerRosterId: proposal.intent.proposerRosterId,
        receiverRosterId: proposal.intent.receiverRosterId,
        status: 'pending',
        vetoMode: 'no_veto',
        createdAtIso: proposal.createdAtIso,
        expiresAtIso: new Date(Date.parse(proposal.createdAtIso) + 14 * 86_400_000).toISOString(),
        assets: proposal.intent.assets,
      },
    ],
    activeRosterLimit: ctx.rules.roster.size,
    now: ctx.clock.now(),
  })
}

function executeTrade(ctx: Ctx, week: number, pending: { proposalId: string; intent: TradeIntent; createdAtIso: string }): void {
  const ownerBefore = ownerMap(liveTeams(ctx))
  const result = executeNflRedraftTrade({ state: tradeState(ctx, week, pending), proposalId: pending.proposalId, actorUserId: pending.intent.receiverRosterId, now: ctx.clock.now() })
  if (!result.ok) {
    bump(ctx, `trade-execute:${result.validation.ok ? 'unknown' : result.validation.code}`)
    return
  }
  ctx.signals.tradesExecuted += 1
  const deadline = ctx.rules.trades.deadlineWeek
  if (deadline != null && week > deadline) {
    record(ctx, [{ code: 'TRADE_EXECUTED_AFTER_DEADLINE', week, phase: 'trades', message: `Trade ${pending.proposalId} (${pending.intent.label}) executed in week ${week}; the deadline is week ${deadline}.` }])
  }
  for (const asset of pending.intent.assets) {
    if (asset.playerId && ownerBefore.get(asset.playerId) !== asset.fromRosterId) {
      record(ctx, [{
        code: 'TRADE_MOVED_UNOWNED_PLAYER',
        week,
        phase: 'trades',
        rosterId: asset.fromRosterId,
        message: `Trade ${pending.proposalId} (${pending.intent.label}) moved ${asset.playerId} from ${asset.fromRosterId}, but it belonged to ${ownerBefore.get(asset.playerId) ?? 'nobody'}.`,
      }])
    }
  }
  applyEngineRosters(ctx, result.teams, week)
}

function runTrades(ctx: Ctx, week: number): void {
  // Offers accepted a week late — the ones that can straddle the deadline or a waiver drop.
  const due = ctx.pendingTrades.filter((row) => row.acceptWeek === week)
  ctx.pendingTrades = ctx.pendingTrades.filter((row) => row.acceptWeek !== week)
  for (const row of due) executeTrade(ctx, week, row)

  for (const team of liveTeams(ctx)) {
    const view = botView(ctx, team, week)
    for (const intent of chooseTrades(view)) {
      ctx.signals.tradesProposed += 1
      const proposalId = `trade-w${week}-${team.rosterId}-${intent.label}-${view.nextSequence()}`
      const createdAtIso = ctx.clock.now().toISOString()
      const state = tradeState(ctx, week, { proposalId, intent, createdAtIso })
      const validation = validateNflRedraftTradeProposal({
        state,
        proposerRosterId: intent.proposerRosterId,
        receiverRosterId: intent.receiverRosterId,
        assets: intent.assets,
        now: ctx.clock.now(),
      })
      if (!validation.ok) {
        ctx.signals.tradesRejectedAtValidation += 1
        bump(ctx, `trade:${validation.code}`)
        continue
      }
      const receiver = ctx.teams.find((entry) => entry.rosterId === intent.receiverRosterId)
      if (!receiver || !receiverAccepts(view, receiver, intent)) continue
      if (intent.acceptAfterWeeks > 0) ctx.pendingTrades.push({ intent, proposalId, createdAtIso, acceptWeek: week + intent.acceptAfterWeeks })
      else executeTrade(ctx, week, { proposalId, intent, createdAtIso })
    }
  }
  afterTransactions(ctx, week, 'trades')
}

// ── Formats ────────────────────────────────────────────────────────────

/**
 * Persists a closed week. The canonical scoring runtime calls a matchup `complete` only when EVERY starter
 * has a finalized stat line, so a starter who did not play (bye, injured) leaves it `live` forever. The
 * production week finalizer (`lib/redraft/weekFinalizer.ts`, DB-bound) closes weeks on its own terms, so
 * the harness plays that role and marks the week final — and counts how often the pure runtime disagreed,
 * because that gap is itself worth a look.
 */
function appendScheduleScores(ctx: Ctx, rows: ScheduleRuntimeMatchupInput[], scoring: NflRedraftLiveScoringRuntimeState): ScheduleRuntimeMatchupInput[] {
  ctx.signals.matchupsNotFinalAtWeekEnd += scoring.matchups.filter((matchup) => !matchup.complete).length
  return [
    ...rows,
    ...scoring.matchups.map((matchup) => ({
      id: matchup.matchupId,
      week: matchup.week,
      homeRosterId: matchup.homeRosterId,
      awayRosterId: matchup.awayRosterId,
      homeScore: matchup.homeScore,
      awayScore: matchup.awayScore,
      status: 'final',
      type: 'regular',
    })),
  ]
}

function updateLedger(ctx: Ctx, scoring: NflRedraftLiveScoringRuntimeState): void {
  for (const matchup of scoring.matchups) {
    if (!matchup.awayRosterId || matchup.awayScore == null) continue
    const home = ctx.ledger.get(matchup.homeRosterId)!
    const away = ctx.ledger.get(matchup.awayRosterId)!
    home.pointsFor += matchup.homeScore
    home.pointsAgainst += matchup.awayScore
    away.pointsFor += matchup.awayScore
    away.pointsAgainst += matchup.homeScore
    if (matchup.homeScore > matchup.awayScore) {
      home.wins += 1
      away.losses += 1
    } else if (matchup.homeScore < matchup.awayScore) {
      away.wins += 1
      home.losses += 1
    } else {
      home.ties += 1
      away.ties += 1
    }
  }
}

function startWeek(ctx: Ctx, week: number): void {
  ctx.clock.set(nflWeekStart(ctx.season, week))
  rollInjuries({ rng: ctx.rng.injuries, players: ctx.universe, week, book: ctx.injuries })
}

function runRedraft(ctx: Ctx, regularSeasonWeeks: number): { weeks: number; champion: string | null } {
  const scheduleTeams = ctx.teams.map((team) => ({ rosterId: team.rosterId, displayName: team.displayName, ownerName: team.displayName }))
  const schedule = buildCanonicalScheduleRuntimeState({ rules: ctx.rules, teams: scheduleTeams, currentWeek: 1, status: 'active', now: ctx.clock.now() })
  const matchups = schedule.weeks.flatMap((week) => week.matchups)
  let completed: ScheduleRuntimeMatchupInput[] = []
  let standings = schedule.standings

  for (let week = 1; week <= regularSeasonWeeks; week += 1) {
    startWeek(ctx, week)
    setLineups(ctx, week, ctx.teams)
    const scoring = scoreWeek(ctx, week, ctx.teams, matchups)
    updateLedger(ctx, scoring)
    completed = appendScheduleScores(ctx, completed, scoring)
    standings = buildCanonicalScheduleRuntimeState({ rules: ctx.rules, teams: scheduleTeams, persistedMatchups: completed, currentWeek: week, status: 'active', now: ctx.clock.now() }).standings
    record(ctx, checkStandings({ week, phase: 'standings', standings, ledger: ctx.ledger }))
    if (week < regularSeasonWeeks) {
      runWaivers(ctx, week + 1)
      runTrades(ctx, week + 1)
    }
  }

  // Playoffs.
  const playoffWeek0 = regularSeasonWeeks + 1
  ctx.clock.set(nflWeekStart(ctx.season, playoffWeek0))
  let playoffs: NflRedraftPlayoffRuntimeState = buildNflRedraftPlayoffRuntimeState({
    leagueId: ctx.leagueId,
    seasonId: ctx.seasonId,
    season: ctx.season,
    week: playoffWeek0,
    rules: ctx.rules,
    teams: standings.map((row) => ({
      rosterId: row.rosterId,
      displayName: row.displayName,
      wins: row.wins,
      losses: row.losses,
      ties: row.ties,
      pointsFor: row.pointsFor,
      pointsAgainst: row.pointsAgainst,
    })),
    now: ctx.clock.now(),
  })
  record(ctx, checkPlayoffSeeds({ week: playoffWeek0, phase: 'playoffs', seeds: playoffs.seeds, ledger: ctx.ledger, fieldSize: ctx.rules.playoffs.teamCount ?? 0 }))
  const bracket = generateNflRedraftPlayoffBracket({ state: playoffs, actorUserId: 'sim-commissioner', lockBracket: true })
  playoffs = { ...playoffs, bracket: bracket.bracket }

  let week = playoffWeek0
  for (let guard = 0; guard < 6; guard += 1, week += 1) {
    startWeek(ctx, week)
    setLineups(ctx, week, ctx.teams)
    const scoring = scoreWeek(ctx, week, ctx.teams, [])
    const points = new Map(scoring.teams.map((team) => [team.rosterId, team.starterTotal]))
    playoffs = {
      ...playoffs,
      bracket: {
        ...playoffs.bracket,
        rounds: playoffs.bracket.rounds.map((round) =>
          round.status !== 'active'
            ? round
            : {
                ...round,
                matchups: round.matchups.map((matchup) => {
                  if (matchup.bye || !matchup.homeRosterId || !matchup.awayRosterId) return matchup
                  let homeScore = points.get(matchup.homeRosterId) ?? 0
                  const awayScore = points.get(matchup.awayRosterId) ?? 0
                  if (homeScore === awayScore) {
                    // No playoff tiebreaker is configured here; the higher seed (home) takes it, and the run says so.
                    bump(ctx, 'playoff:TIE_NUDGED_TO_HOME')
                    homeScore += 0.01
                  }
                  return { ...matchup, homeScore, awayScore, status: 'final' as const }
                }),
              },
        ),
      },
    }
    const advanced = advanceNflRedraftPlayoffRound({ state: playoffs, actorUserId: 'sim-commissioner' })
    if (!advanced.ok) {
      record(ctx, [{ code: 'PLAYOFF_ADVANCE_FAILED', week, phase: 'playoffs', message: `${advanced.code}: ${advanced.message}` }])
      return { weeks: week, champion: null }
    }
    playoffs = advanced.state
    if (advanced.status === 'championship_ready' || !playoffs.bracket.rounds.some((round) => round.status === 'active')) break
  }
  const finalized = finalizeNflRedraftPlayoffChampion({ state: playoffs, actorUserId: 'sim-commissioner' })
  if (!finalized.ok) {
    record(ctx, [{ code: 'PLAYOFFS_DID_NOT_FINISH', week, phase: 'playoffs', message: `${finalized.code}: ${finalized.message}` }])
    return { weeks: week, champion: null }
  }
  if (!playoffs.seeds.some((seed) => seed.rosterId === finalized.championRosterId)) {
    record(ctx, [{ code: 'CHAMPION_NOT_SEEDED', week, phase: 'playoffs', message: `${finalized.championRosterId} won the title without a playoff seed.` }])
  }
  return { weeks: week, champion: finalized.championRosterId }
}

function runGuillotine(ctx: Ctx, maxWeeks: number): { weeks: number; champion: string | null } {
  const seasonPoints = new Map<string, number>(ctx.teams.map((team) => [team.rosterId, 0]))
  const previous = new Map<string, number>()
  const draftSlots = new Map(ctx.teams.map((team) => [team.rosterId, team.draftSlot]))
  let week = 1
  for (; week <= maxWeeks && liveTeams(ctx).length > 1; week += 1) {
    startWeek(ctx, week)
    const live = liveTeams(ctx)
    setLineups(ctx, week, live)
    const scoring = scoreWeek(ctx, week, live, [])
    const candidates = scoring.teams.map((team) => {
      seasonPoints.set(team.rosterId, (seasonPoints.get(team.rosterId) ?? 0) + team.starterTotal)
      return {
        rosterId: team.rosterId,
        periodPoints: team.starterTotal,
        seasonPointsCumul: seasonPoints.get(team.rosterId)!,
        previousPeriodPoints: previous.get(team.rosterId),
        benchPoints: team.benchTotal,
        draftSlot: draftSlots.get(team.rosterId),
      }
    })
    for (const row of candidates) previous.set(row.rosterId, row.periodPoints)
    const chop = resolveTiebreak({ candidates, tiebreakerOrder: [...GUILLOTINE_TIEBREAKERS], teamsPerChop: 1, weekOrPeriod: week, draftSlotByRoster: draftSlots })
    if (chop.choppedRosterIds.length !== 1) {
      record(ctx, [{ code: 'CHOP_COUNT_WRONG', week, phase: 'guillotine', message: `${chop.choppedRosterIds.length} teams chopped with ${live.length} alive; expected 1.` }])
    }
    const low = Math.min(...candidates.map((row) => row.periodPoints))
    for (const rosterId of chop.choppedRosterIds) {
      const row = candidates.find((entry) => entry.rosterId === rosterId)
      if (!row) {
        record(ctx, [{ code: 'CHOPPED_TEAM_NOT_ALIVE', week, phase: 'guillotine', rosterId, message: `${rosterId} was chopped but was not among the live teams.` }])
        continue
      }
      if (row.periodPoints > low + 0.001) {
        record(ctx, [{ code: 'CHOPPED_NOT_LOWEST', week, phase: 'guillotine', rosterId, message: `${rosterId} scored ${row.periodPoints} and was chopped over a ${low}.` }])
      }
      // HARNESS: the real roster release is DB-bound, so released players go straight to the pool here.
      const team = ctx.teams.find((entry) => entry.rosterId === rosterId)!
      ctx.freeAgentIds.push(...allRosterIds(team.sections))
      team.sections = { starters: [], bench: [], ir: [] }
      team.eliminatedWeek = week
      ctx.signals.guillotineChops += 1
    }
    afterTransactions(ctx, week, 'guillotine')
    if (liveTeams(ctx).length > 1) {
      runWaivers(ctx, week + 1)
      runTrades(ctx, week + 1)
    }
  }
  const survivors = liveTeams(ctx)
  if (survivors.length !== 1) {
    record(ctx, [{ code: 'GUILLOTINE_DID_NOT_FINISH', week, phase: 'season', message: `${survivors.length} teams still alive after ${maxWeeks} weeks.` }])
    return { weeks: week - 1, champion: null }
  }
  return { weeks: week - 1, champion: survivors[0]!.rosterId }
}

// ── Entry point ────────────────────────────────────────────────────────

function emptySignals(): SimSignals {
  return {
    waiverClaimsSubmitted: 0,
    waiverClaimsRejectedAtSubmit: 0,
    waiverClaimsWon: 0,
    waiverClaimsLost: 0,
    tradesProposed: 0,
    tradesRejectedAtValidation: 0,
    tradesExecuted: 0,
    inactiveStarterWeeks: 0,
    byeStarterWeeks: 0,
    guillotineChops: 0,
    matchupsNotFinalAtWeekEnd: 0,
    rejectionCodes: {},
  }
}

function assignPersonas(teamCount: number, personas: BotPersona[]): Array<{ persona: BotPersona; partner: number | null }> {
  const list = Array.from({ length: teamCount }, (_, index) => personas[index % personas.length]!)
  const partners: Array<number | null> = list.map(() => null)
  let open: number | null = null
  list.forEach((persona, index) => {
    if (persona !== 'colluder') return
    if (open == null) open = index
    else {
      partners[open] = index
      partners[index] = open
      open = null
    }
  })
  return list.map((persona, index) => ({ persona, partner: partners[index]! }))
}

export function runSeasonSim(options: SimSeasonOptions): SimSeasonReport {
  const format = options.format ?? 'redraft'
  const teamCount = options.teamCount ?? 12
  const season = options.season ?? 2026
  const regularSeasonWeeks = options.regularSeasonWeeks ?? 14
  const seed = normalizeSeed(options.seed)
  const root = createSimRng(seed)
  const leagueId = `sim-${format}-${seed}`
  const clock = createSimClock(nflDraftAt(season))
  const rules = buildSimRules({
    leagueId,
    season,
    format,
    teamCount,
    starters: DEFAULT_SIM_STARTERS,
    benchSize: options.benchSize ?? 6,
    regularSeasonWeeks,
    playoffTeams: options.playoffTeams ?? Math.min(6, teamCount),
    tradeDeadlineWeek: options.tradeDeadlineWeek ?? Math.min(10, regularSeasonWeeks - 1),
    faabBudget: options.faabBudget ?? 100,
    scoringPreset: 'nfl_half_ppr',
    generatedAt: clock.now(),
  })
  const universe = buildPlayerPool({ rng: root.fork('pool'), teamCount, rosterSize: rules.roster.size ?? 0 })
  const assigned = assignPersonas(teamCount, options.personas?.length ? options.personas : DEFAULT_PERSONA_CYCLE)
  const draftOrder = root.fork('draft-order').shuffle(assigned.map((_, index) => index))
  const teams: SimTeam[] = assigned.map(({ persona, partner }, index) => {
    const id = `t${String(index + 1).padStart(2, '0')}`
    return {
      rosterId: id,
      displayName: `Team ${index + 1} (${persona})`,
      ownerId: `sim-user-${index + 1}`,
      persona,
      partnerRosterId: partner == null ? null : `t${String(partner + 1).padStart(2, '0')}`,
      draftSlot: draftOrder.indexOf(index) + 1,
      faabBalance: rules.waivers.faabBudget ?? 100,
      waiverPriority: draftOrder.indexOf(index) + 1,
      sections: { starters: [], bench: [], ir: [] } as RosterRuntimeSections,
      eliminatedWeek: null,
    }
  })

  const ctx: Ctx = {
    rules,
    leagueId,
    seasonId: `${leagueId}-${season}`,
    season,
    clock,
    universe,
    playersById: new Map(universe.map((player) => [player.playerId, player])),
    universeIds: new Set(universe.map((player) => player.playerId)),
    teams,
    freeAgentIds: [],
    injuries: new Map(),
    observed: new Map(),
    ledger: new Map(teams.map((team) => [team.rosterId, { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }])),
    expectedFaabTotal: teams.reduce((sum, team) => sum + team.faabBalance, 0),
    rng: { draft: root.fork('draft'), stats: root.fork('stats'), injuries: root.fork('injuries'), bots: root.fork('bots') },
    violations: [],
    signals: emptySignals(),
    maxViolations: options.maxViolations ?? 200,
    sequence: 0,
    pendingTrades: [],
  }

  let aborted: string | null = null
  let outcome: { weeks: number; champion: string | null } = { weeks: 0, champion: null }
  let phase: SimPhase = 'draft'
  try {
    runDraft(ctx)
    phase = 'season'
    outcome = format === 'guillotine' ? runGuillotine(ctx, Math.max(teamCount + 2, 17)) : runRedraft(ctx, regularSeasonWeeks)
  } catch (error) {
    if (error instanceof TooManyViolations) aborted = error.message
    else {
      aborted = error instanceof Error ? error.message : String(error)
      ctx.violations.push({
        code: 'ENGINE_THREW',
        week: null,
        phase,
        message: aborted,
        detail: { stack: error instanceof Error ? error.stack?.split('\n').slice(0, 8).join('\n') : undefined },
      })
    }
  }

  const reproduceArgs = [`--seed=${options.seed}`, `--format=${format}`, `--teams=${teamCount}`]
  if (options.regularSeasonWeeks != null) reproduceArgs.push(`--weeks=${regularSeasonWeeks}`)
  return {
    seed,
    seedInput: options.seed,
    format,
    leagueId,
    season,
    teamCount,
    weeksSimulated: outcome.weeks,
    personas: Object.fromEntries(teams.map((team) => [team.rosterId, team.persona])),
    championRosterId: outcome.champion,
    violations: ctx.violations,
    signals: ctx.signals,
    reproduce: `npm run sim:season -- ${reproduceArgs.join(' ')}`,
    aborted,
  }
}

/** Many leagues from one seed: league i uses seed `${seed}-${i}` and cycles through the formats. */
export function runSeasonSimBatch(input: {
  seed: number | string
  leagues: number
  formats?: SimSeasonReport['format'][]
  teamCount?: number
}): SimSeasonReport[] {
  const formats = input.formats?.length ? input.formats : (['redraft', 'guillotine'] as const)
  return Array.from({ length: input.leagues }, (_, index) =>
    runSeasonSim({ seed: `${input.seed}-${index}`, format: formats[index % formats.length], teamCount: input.teamCount }),
  )
}
