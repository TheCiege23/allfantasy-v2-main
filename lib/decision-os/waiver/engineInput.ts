import type { WaiverAIServiceInput } from '@/lib/waiver-ai-engine'
import type { WaiverWorldFacts } from './loader'
import type { WaiverPool } from './pool'

/**
 * The waiver engine's input for one manager, from the facts and the pool — built in ONE place.
 *
 * ⚠ THE WHOLE INPUT, NOT JUST THE NAMES. Prices let the scorer rank at all; the asker's slotted
 * roster is what lets it name a drop; the league's rosters are the median behind "your weakest
 * slot"; the traits are read from the same market context that priced the wire, so no predicate is
 * derived twice. Passing only `availablePlayers` is what made every answer "Hold your FAAB".
 *
 * Shared by Chimmy's waiver slice (grounding/decisionBridge.ts) and /api/ai/waivers/recommend, so
 * the two surfaces ask the engine the same question and cannot drift into two answers.
 */
export function waiverEngineInputFrom(facts: WaiverWorldFacts, pool: WaiverPool): WaiverAIServiceInput {
  return {
    sport: facts.sport,
    leagueSettings: {
      faabBudget: facts.settings.faabBudget ?? null,
      faabRemaining: facts.faabRemaining,
      numTeams: pool.leagueTraits.numTeams,
      isSF: pool.leagueTraits.isSF,
      isTEP: pool.leagueTraits.isTEP,
      isDynasty: pool.leagueTraits.isDynasty,
    },
    roster: pool.myRoster,
    rosterPositions: pool.rosterPositions,
    allLeagueRosters: pool.leagueRosters,
    /* Precomputed in `loadWaiverPool`, so the season's bye slate is a server read. */
    ...(pool.teamNeeds ? { teamNeeds: pool.teamNeeds } : {}),
    ...(pool.currentWeek != null ? { currentWeek: pool.currentWeek } : {}),
    availablePlayers: pool.availablePlayers,
  }
}
