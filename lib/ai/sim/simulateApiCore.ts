import { z } from 'zod'
import {
  simulateAdviceVsIgnore,
  simulateDraft,
  simulateFranchise,
  simulateMatchup,
  simulateNextPicks,
  simulateSeason,
  simulateTrade,
  simulateWaiver,
} from '@/lib/ai/sim/aiSimulationEngine'
import type { SimPlayerInput, SimTeamInput } from '@/lib/ai/sim/types'

const playerSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  position: z.string(),
  projection: z.number(),
  variance: z.number().optional(),
  consistency: z.number().optional(),
  injuryRisk: z.number().optional(),
  usageTrend: z.number().optional(),
})

const teamSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  roster: z.array(playerSchema),
})

export const simulateBodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('season'),
    iterations: z.number().min(20).max(2000).optional(),
    teams: z.array(teamSchema).min(2),
    weeksRemaining: z.number().min(1).max(18).optional(),
    playoffTeams: z.number().min(2).max(16).optional(),
    seed: z.number().optional(),
  }),
  z.object({
    kind: z.literal('matchup'),
    iterations: z.number().min(20).max(5000).optional(),
    teamA: teamSchema,
    teamB: teamSchema,
    seed: z.number().optional(),
  }),
  z.object({
    kind: z.literal('trade'),
    iterations: z.number().min(40).max(800).optional(),
    teams: z.array(teamSchema).min(1),
    beforePlayers: z.array(playerSchema),
    afterPlayers: z.array(playerSchema),
    focusedTeamId: z.string(),
    leagueSize: z.number().min(4).max(32).optional(),
    weeksRemaining: z.number().optional(),
    // P4-8: optional real-league grounding. When present the API route ALSO runs
    // the Gaussian win-probability engine over the league's actual remaining
    // schedule (lib/ai/sim/groundedTradeDelta) and attaches `leagueGrounded` to
    // the result. The Monte Carlo above stays synthetic and stays labeled.
    leagueGrounding: z
      .object({
        leagueId: z.string().min(1),
        sent: z.array(z.object({ name: z.string().min(1), position: z.string().min(1) })).max(12),
        received: z.array(z.object({ name: z.string().min(1), position: z.string().min(1) })).max(12),
      })
      .optional(),
  }),
  z.object({
    kind: z.literal('draft'),
    iterations: z.number().min(50).max(1000).optional(),
    userRoster: z.array(playerSchema),
    hypotheticalPick: playerSchema,
    numTeams: z.number().min(4).max(32),
    weeksRemaining: z.number().optional(),
    seed: z.number().optional(),
  }),
  z.object({
    kind: z.literal('draft_next'),
    userRoster: z.array(playerSchema),
    picks: z.array(playerSchema).min(1).max(8),
    numTeams: z.number().min(4).max(32),
  }),
  z.object({
    kind: z.literal('waiver'),
    roster: z.array(playerSchema),
    dropPlayerId: z.string(),
    addPlayer: playerSchema,
    numTeams: z.number().min(4).max(32),
    iterations: z.number().optional(),
  }),
  z.object({
    kind: z.literal('franchise'),
    roster: z.array(playerSchema),
    years: z.number().min(1).max(8),
    numTeams: z.number().min(4).max(32),
    iterations: z.number().optional(),
  }),
  z.object({
    kind: z.literal('advice'),
    baselineRoster: z.array(playerSchema),
    followRoster: z.array(playerSchema),
    numTeams: z.number().min(4).max(32),
    iterations: z.number().optional(),
  }),
])

export type ParsedSimulateBody = z.infer<typeof simulateBodySchema>

export function executeSimulateBody(b: ParsedSimulateBody): unknown {
  const it = 'iterations' in b && b.iterations != null ? b.iterations : undefined

  switch (b.kind) {
    case 'season': {
      const teams = b.teams as SimTeamInput[]
      return simulateSeason(teams, {
        iterations: it ?? 200,
        weeksRemaining: b.weeksRemaining ?? 12,
        playoffTeams: b.playoffTeams,
        seed: b.seed,
        regularSeasonWeeks: b.weeksRemaining ?? 12,
      })
    }
    case 'matchup': {
      return simulateMatchup(b.teamA as SimTeamInput, b.teamB as SimTeamInput, {
        iterations: it ?? 200,
        seed: b.seed,
      })
    }
    case 'trade': {
      return simulateTrade({
        teams: b.teams as SimTeamInput[],
        beforePlayers: b.beforePlayers as SimPlayerInput[],
        afterPlayers: b.afterPlayers as SimPlayerInput[],
        focusedTeamId: b.focusedTeamId,
        iterations: it,
        weeksRemaining: b.weeksRemaining,
        leagueSize: b.leagueSize,
      })
    }
    case 'draft': {
      return simulateDraft({
        userRoster: b.userRoster as SimPlayerInput[],
        hypotheticalPick: b.hypotheticalPick as SimPlayerInput,
        numTeams: b.numTeams,
        iterations: it,
        seed: b.seed,
        weeksRemaining: b.weeksRemaining,
      })
    }
    case 'draft_next': {
      return simulateNextPicks({
        userRoster: b.userRoster as SimPlayerInput[],
        picks: b.picks as SimPlayerInput[],
        numTeams: b.numTeams,
      })
    }
    case 'waiver': {
      return simulateWaiver({
        roster: b.roster as SimPlayerInput[],
        dropPlayerId: b.dropPlayerId,
        addPlayer: b.addPlayer as SimPlayerInput,
        numTeams: b.numTeams,
        iterations: it,
      })
    }
    case 'franchise': {
      return simulateFranchise({
        roster: b.roster as SimPlayerInput[],
        years: b.years,
        numTeams: b.numTeams,
        iterations: it,
      })
    }
    case 'advice': {
      return simulateAdviceVsIgnore({
        baselineRoster: b.baselineRoster as SimPlayerInput[],
        followRoster: b.followRoster as SimPlayerInput[],
        numTeams: b.numTeams,
        iterations: it,
      })
    }
    default:
      throw new Error('Unsupported simulation kind')
  }
}
