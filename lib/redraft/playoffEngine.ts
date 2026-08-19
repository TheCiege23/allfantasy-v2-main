import type { RedraftRoster } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { tryGetSportConfig } from '@/lib/sportConfig'
import { getPlatformEvents, EVENT } from '@/lib/events'
import type { PlayoffStructure } from './types'

/** Bracket shape defaults from centralized sport config (commissioner can override). */
export function getPlayoffDefaults(sport: string): {
  teamCount: number
  startWeek: number
  rounds: number
  byeCount: number
} {
  const c = tryGetSportConfig(sport)
  if (!c) {
    return { teamCount: 4, startWeek: 15, rounds: 2, byeCount: 0 }
  }
  const teamCount = c.defaultPlayoffTeams
  const startWeek = c.defaultPlayoffStartWeek
  const rounds = Math.max(1, Math.ceil(Math.log2(Math.max(2, teamCount))))
  const nextPow2 = 2 ** rounds
  const byeCount = Math.max(0, nextPow2 - teamCount)
  return { teamCount, startWeek, rounds, byeCount }
}

export function generatePlayoffBracket(
  rosters: RedraftRoster[],
  playoffTeams: number,
  _hasLowerBracket: boolean,
  _lowerBracketType: 'consolation' | 'toilet_bowl',
): PlayoffStructure {
  const sorted = [...rosters].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    return b.pointsFor - a.pointsFor
  })
  const seeds = sorted.slice(0, playoffTeams).map((r) => r.id)
  const matchups: { home: string; away: string | null }[] = []
  for (let i = 0; i < Math.floor(seeds.length / 2); i++) {
    matchups.push({ home: seeds[i]!, away: seeds[seeds.length - 1 - i]! })
  }
  if (seeds.length % 2 === 1) {
    matchups.push({ home: seeds[Math.floor(seeds.length / 2)]!, away: null })
  }
  return {
    upperBracket: [{ round: 1, matchups }],
  }
}

export type AdvancePlayoffResult = {
  seasonId: string
  week: number
  /** Number of winner slots filled in the next round. */
  advanced: number
  /** Number of already-filled slots skipped (idempotent re-runs). */
  skipped: number
  /** Matchups that could not be resolved yet (incomplete scores or exact ties). */
  blocked: { matchupId: string; reason: string }[]
  /**
   * 'ok'                           — winners advanced, round still in progress
   * 'round_complete'               — all matchups resolved; next round activated
   * 'ready_for_champion_finalization' — final round is complete; champion crowning is a separate step
   * 'no_active_round'              — bracket exists but no round is currently active
   * 'no_bracket'                   — this season has no playoff bracket yet
   */
  status:
    | 'ok'
    | 'round_complete'
    | 'ready_for_champion_finalization'
    | 'no_active_round'
    | 'no_bracket'
}

/**
 * Advance winners from completed playoff matchups into the next round's slots.
 *
 * Idempotent: running twice produces the same bracket state.
 * Incomplete matchups (missing scores) are skipped without error.
 * Tied matchups are reported in `blocked` for commissioner resolution.
 * Bye matchups are auto-resolved (winnerRosterId already set at generation time).
 * When the final round is complete the function returns `ready_for_champion_finalization`
 * without touching season status — champion crowning is a separate step.
 */
export async function advancePlayoffWinners(
  seasonId: string,
  week: number,
): Promise<AdvancePlayoffResult> {
  const base: Pick<AdvancePlayoffResult, 'seasonId' | 'week'> = { seasonId, week }

  // Verify the bracket exists
  const bracket = await prisma.redraftPlayoffBracket.findUnique({ where: { seasonId } })
  if (!bracket) return { ...base, advanced: 0, skipped: 0, blocked: [], status: 'no_bracket' }

  // Load all rounds ordered; find the active one
  const allRoundsRaw = await prisma.redraftPlayoffRound.findMany({
    where: { seasonId },
    orderBy: { roundNumber: 'asc' },
    include: {
      matchups: {
        orderBy: { matchupNumber: 'asc' },
        include: { nextMatchup: true },
      },
    },
  })

  type RoundWithMatchups = (typeof allRoundsRaw)[number]
  const allRounds: RoundWithMatchups[] = allRoundsRaw

  const activeRound = allRounds.find((r: RoundWithMatchups) => r.status === 'active')
  if (!activeRound) {
    return { ...base, advanced: 0, skipped: 0, blocked: [], status: 'no_active_round' }
  }

  let advanced = 0
  let skipped = 0
  const blocked: AdvancePlayoffResult['blocked'] = []

  for (const matchup of activeRound.matchups) {
    // Resolve winner from score if not already set
    let winnerRosterId = matchup.winnerRosterId

    if (!winnerRosterId) {
      if (matchup.status === 'bye') {
        // Bye: home team auto-advances (set at generation, but guard here)
        winnerRosterId = matchup.homeRosterId
      } else if (matchup.homeScore != null && matchup.awayScore != null) {
        if (matchup.homeScore > matchup.awayScore) {
          winnerRosterId = matchup.homeRosterId
        } else if (matchup.awayScore > matchup.homeScore) {
          winnerRosterId = matchup.awayRosterId
        } else {
          // Exact tie — use points-for tiebreaker via seed order (lower seed wins)
          // Prefer home team as tiebreaker (home seed is always lower in standard seeding)
          if (
            matchup.homeSeed != null &&
            matchup.awaySeed != null &&
            matchup.homeSeed !== matchup.awaySeed
          ) {
            winnerRosterId =
              matchup.homeSeed < matchup.awaySeed ? matchup.homeRosterId : matchup.awayRosterId
          } else {
            // Cannot resolve — commissioner must set winnerRosterId manually
            blocked.push({
              matchupId: matchup.id,
              reason: `Tied score (${matchup.homeScore}–${matchup.awayScore}) with no seed tiebreaker available`,
            })
            continue
          }
        }
      } else {
        // Scores not yet set — matchup not complete
        continue
      }
    }

    if (!winnerRosterId) continue

    // Persist winner on the matchup if not already written
    if (matchup.winnerRosterId !== winnerRosterId) {
      await prisma.redraftPlayoffMatchup.update({
        where: { id: matchup.id },
        data: {
          winnerRosterId,
          // DB CHECK allows scheduled/in_progress/final/bye/cancelled — a
          // resolved matchup is 'final' (matches the regular-season convention).
          // 'complete' violated the constraint and crashed playoff advancement.
          status: matchup.status === 'bye' ? 'bye' : 'final',
        },
      })
    }

    // Advance winner into next matchup slot
    const nextMatchupId = matchup.nextMatchupId
    if (!nextMatchupId) {
      // This matchup has no next — it is the final round's matchup
      // Winner recorded; no slot to fill
      continue
    }

    const nextMatchup = await prisma.redraftPlayoffMatchup.findUnique({
      where: { id: nextMatchupId },
    })
    if (!nextMatchup) continue

    // Idempotency: check if winner is already in a slot
    if (
      nextMatchup.homeRosterId === winnerRosterId ||
      nextMatchup.awayRosterId === winnerRosterId
    ) {
      skipped += 1
      continue
    }

    // Fill the next empty slot
    if (!nextMatchup.homeRosterId) {
      await prisma.redraftPlayoffMatchup.update({
        where: { id: nextMatchupId },
        data: { homeRosterId: winnerRosterId },
      })
      advanced += 1
    } else if (!nextMatchup.awayRosterId) {
      await prisma.redraftPlayoffMatchup.update({
        where: { id: nextMatchupId },
        data: { awayRosterId: winnerRosterId },
      })
      advanced += 1
    } else {
      // Both slots filled by someone else — winner is not in either
      blocked.push({
        matchupId: matchup.id,
        reason: `Next matchup (${nextMatchupId}) already has both teams filled but winner is absent`,
      })
    }
  }

  // After advancing, reload to check if the active round is fully resolved
  const refreshedMatchups = await prisma.redraftPlayoffMatchup.findMany({
    where: { roundId: activeRound.id },
    select: { winnerRosterId: true, status: true },
  })

  const allResolved = (
    refreshedMatchups as { winnerRosterId: string | null; status: string }[]
  ).every((m) => m.winnerRosterId != null || m.status === 'bye')

  if (!allResolved) {
    return { ...base, advanced, skipped, blocked, status: 'ok' }
  }

  // Mark the active round complete. DB CHECK allows pending/active/completed/
  // cancelled — 'complete' (no -ed) violated the constraint and crashed playoff
  // round advancement.
  await prisma.redraftPlayoffRound.update({
    where: { id: activeRound.id },
    data: { status: 'completed' },
  })

  // Find the next pending round
  const nextRound = allRounds.find(
    (r: RoundWithMatchups) => r.roundNumber === activeRound.roundNumber + 1 && r.status === 'pending',
  )

  if (nextRound) {
    await prisma.redraftPlayoffRound.update({
      where: { id: nextRound.id },
      data: { status: 'active' },
    })
    return { ...base, advanced, skipped, blocked, status: 'round_complete' }
  }

  // No next round — the final round just completed
  return { ...base, advanced, skipped, blocked, status: 'ready_for_champion_finalization' }
}

// ─── Season Finalization ──────────────────────────────────────────────────────

export type FinalizeSeasonResult = {
  seasonId: string
  leagueId: string
  season: number
  alreadyFinalized: boolean
  /**
   * 'ok'                      — champion crowned, season marked complete
   * 'already_finalized'       — idempotent re-run; no changes made
   * 'no_bracket'              — bracket does not exist yet
   * 'no_final_round'          — no rounds found in bracket
   * 'final_round_incomplete'  — final round exists but not yet status=complete
   * 'no_winner'               — final matchup missing winnerRosterId
   */
  status:
    | 'ok'
    | 'already_finalized'
    | 'no_bracket'
    | 'no_final_round'
    | 'final_round_incomplete'
    | 'no_winner'
  championRosterId: string | null
  championUserId: string | null
  championTeamName: string | null
  runnerUpRosterId: string | null
}

/**
 * Crown the champion and mark the redraft season complete after the final
 * playoff round finishes.
 *
 * Idempotent: if the season is already finalized, returns `alreadyFinalized: true`
 * without re-writing any records.
 *
 * Writes:
 *  - `LeagueChampionship` upsert (@@unique on leagueId + season)
 *  - `RedraftSeason.status = 'complete'`
 *  - `RedraftPlayoffBracket.status = 'complete'`
 *  - `League.lifecycleState = 'completed'`
 *
 * Does NOT call provider APIs, AI services, or anything external.
 */
export async function finalizeRedraftSeasonChampion(
  seasonId: string,
  recordedByUserId: string,
): Promise<FinalizeSeasonResult> {
  // Load the season
  const season = await prisma.redraftSeason.findUnique({
    where: { id: seasonId },
    select: { id: true, leagueId: true, season: true, status: true },
  })
  if (!season) {
    // Season not found — treat as a safe no-op with a clear status
    return {
      seasonId,
      leagueId: '',
      season: 0,
      alreadyFinalized: false,
      status: 'no_bracket',
      championRosterId: null,
      championUserId: null,
      championTeamName: null,
      runnerUpRosterId: null,
    }
  }

  const base = { seasonId, leagueId: season.leagueId, season: season.season }

  // Idempotency: already finalized
  if (season.status === 'complete') {
    return {
      ...base,
      alreadyFinalized: true,
      status: 'already_finalized',
      championRosterId: null,
      championUserId: null,
      championTeamName: null,
      runnerUpRosterId: null,
    }
  }

  // Load bracket
  const bracket = await prisma.redraftPlayoffBracket.findUnique({ where: { seasonId } })
  if (!bracket) {
    return { ...base, alreadyFinalized: false, status: 'no_bracket', championRosterId: null, championUserId: null, championTeamName: null, runnerUpRosterId: null }
  }

  // Load all rounds to find the final one (highest roundNumber)
  const rounds = await prisma.redraftPlayoffRound.findMany({
    where: { seasonId },
    orderBy: { roundNumber: 'desc' },
    take: 1,
    include: {
      matchups: {
        orderBy: { matchupNumber: 'asc' },
        select: {
          id: true,
          homeRosterId: true,
          awayRosterId: true,
          winnerRosterId: true,
          status: true,
          nextMatchupId: true,
        },
      },
    },
  })

  if (rounds.length === 0) {
    return { ...base, alreadyFinalized: false, status: 'no_final_round', championRosterId: null, championUserId: null, championTeamName: null, runnerUpRosterId: null }
  }

  const finalRound = rounds[0]!

  // The final round must be complete (DB stores 'completed', not 'complete').
  if (finalRound.status !== 'completed') {
    return { ...base, alreadyFinalized: false, status: 'final_round_incomplete', championRosterId: null, championUserId: null, championTeamName: null, runnerUpRosterId: null }
  }

  // Find the championship matchup — the one with no nextMatchupId
  type FinalMatchup = { id: string; homeRosterId: string | null; awayRosterId: string | null; winnerRosterId: string | null; status: string; nextMatchupId: string | null }
  const champMatchup = (finalRound.matchups as FinalMatchup[]).find((m) => !m.nextMatchupId)
  if (!champMatchup?.winnerRosterId) {
    return { ...base, alreadyFinalized: false, status: 'no_winner', championRosterId: null, championUserId: null, championTeamName: null, runnerUpRosterId: null }
  }

  const championRosterId = champMatchup.winnerRosterId
  const runnerUpRosterId =
    champMatchup.homeRosterId === championRosterId
      ? champMatchup.awayRosterId
      : champMatchup.homeRosterId

  // Load champion roster details
  const championRoster = await prisma.redraftRoster.findUnique({
    where: { id: championRosterId },
    select: { ownerId: true, ownerName: true, teamName: true, pointsFor: true },
  })

  const championUserId = championRoster?.ownerId ?? null
  const championTeamName = championRoster?.teamName ?? championRoster?.ownerName ?? null
  const championPointsFor = championRoster?.pointsFor ?? null

  // Persist champion + mark season complete — all in one transaction
  await prisma.$transaction(async (tx) => {
    // Record championship
    await (tx as typeof prisma).leagueChampionship.upsert({
      where: { leagueId_season: { leagueId: season.leagueId, season: season.season } },
      create: {
        leagueId: season.leagueId,
        season: season.season,
        championUserId: championUserId ?? '',
        teamName: championTeamName,
        pointsFor: championPointsFor,
        recordedBy: recordedByUserId,
      },
      update: {
        championUserId: championUserId ?? '',
        teamName: championTeamName,
        pointsFor: championPointsFor,
        recordedBy: recordedByUserId,
      },
    })

    // Mark redraft season complete
    await (tx as typeof prisma).redraftSeason.update({
      where: { id: seasonId },
      data: { status: 'complete' },
    })

    // Mark bracket complete
    await (tx as typeof prisma).redraftPlayoffBracket.update({
      where: { seasonId },
      data: { status: 'complete' },
    })

    // Transition league lifecycle to completed
    await (tx as typeof prisma).league.update({
      where: { id: season.leagueId },
      data: { lifecycleState: 'completed' },
    })
  })

  // G15.2 — publish (best-effort, post-commit; never throws, never affects the result).
  // Reached only on first finalize (re-finalize returns early above), so the
  // deterministic idempotency keys yield exactly one event per season.
  const events = getPlatformEvents()
  await events.emit(EVENT.CHAMPION_CROWNED, {
    leagueId: season.leagueId,
    seasonId,
    actor: { type: 'system', id: recordedByUserId },
    idempotencyKey: `champion.crowned:${seasonId}`,
    source: 'engine:playoff',
    subjects: [
      { kind: 'season', id: seasonId },
      { kind: 'roster', id: championRosterId },
    ],
    payload: { seasonId, championRosterId, championUserId: championUserId ?? undefined },
  })
  await events.emit(EVENT.SEASON_COMPLETED, {
    leagueId: season.leagueId,
    seasonId,
    actor: { type: 'system', id: recordedByUserId },
    idempotencyKey: `season.completed:${seasonId}`,
    source: 'engine:playoff',
    subjects: [{ kind: 'season', id: seasonId }],
    payload: { seasonId },
  })

  return {
    ...base,
    alreadyFinalized: false,
    status: 'ok',
    championRosterId,
    championUserId,
    championTeamName,
    runnerUpRosterId,
  }
}
