/**
 * Game Day Context Assembler — Phase 9.
 *
 * Assembles ONE league's Game Day context for a viewing user by wrapping two
 * real, already-live engines confirmed during the audit — never recomputing
 * their math:
 *  - server/services/matchupCenterService.ts's buildMatchupCenterPayload() —
 *    THE single real matchup/scoring entry point (branches redraft-family vs
 *    generic TeamWeekResult/Roster internally; already merges per-player
 *    scores via canonicalPlayerScores.ts).
 *  - lib/chimmy-context/providers/_helpers/currentWeek.ts's resolveCurrentWeek()
 *    — the real, provider-neutral current-week cascade (RedraftSeason →
 *    TeamWeekResult → WeeklyMatchup(Sleeper) → league settings → fallback),
 *    used here instead of matchupCenterService's own weaker
 *    settings-only weekFromSettings() fallback, so the week this module
 *    reports is the most authoritative one available.
 *
 * This assembler adds only what didn't already exist: source attribution,
 * freshness, and a richer provider-neutral matchup-state normalization (see
 * MatchupStateNormalizer.ts).
 */

import { prisma } from '@/lib/prisma'
import { buildMatchupCenterPayload } from '@/server/services/matchupCenterService'
import { resolveCurrentWeek } from '@/lib/chimmy-context/providers/_helpers/currentWeek'
import { normalizeMatchupState, type CertifiedMatchupEvidenceInput } from './MatchupStateNormalizer'
import type { LeagueGameDayContext } from './types'
import { isSportsDataEnabled } from '@/lib/fantasy-os/sports-runtime/gates'
import { CertifiedMatchupIntegrationService } from '@/lib/fantasy-os/sports-runtime/matchupIntegration'

export interface BuildLeagueGameDayContextInput {
  leagueId: string
  viewerUserId: string
  season?: number
  week?: number
}

export async function buildLeagueGameDayContext(input: BuildLeagueGameDayContextInput): Promise<LeagueGameDayContext> {
  const fetchedAt = new Date().toISOString()

  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { sport: true, platform: true, season: true },
  })
  if (!league) {
    return {
      leagueId: input.leagueId,
      season: input.season ?? 0,
      week: input.week ?? 0,
      sport: 'unknown',
      platform: 'unknown',
      weekResolution: { source: 'fallback', isPlayoffWeek: false, playoffStartWeek: null },
      matchup: null,
      matchupState: {
        state: 'unavailable',
        attribution: { source: 'game-day-context-assembler', fetchedAt, providerTimestamp: null, freshness: 'unknown', confidence: 0, missingDataReason: 'League not found.' },
      },
      unavailableReason: 'League not found.',
    }
  }

  const weekResolved = await resolveCurrentWeek({ leagueId: input.leagueId, week: input.week, season: input.season })

  const result = await buildMatchupCenterPayload({
    leagueId: input.leagueId,
    viewerUserId: input.viewerUserId,
    season: input.season ?? weekResolved.season,
    week: input.week ?? weekResolved.week,
  })

  const matchup = 'error' in result ? null : result
  const unavailableReason = 'error' in result ? result.error : null

  // Gated, additive certified GAME evidence (informational). NFL only; wrapped so it can never fail the read and
  // never alters the authoritative matchup state / persisted scores. Passed to the normalizer as an input fact.
  let certifiedGameEvidence: CertifiedMatchupEvidenceInput | null = null
  if (isSportsDataEnabled('matchup') && String(league.sport ?? 'NFL').toUpperCase() === 'NFL') {
    try {
      const ctx = await new CertifiedMatchupIntegrationService().describeMatchupGameStates({ season: String(weekResolved.season), week: String(weekResolved.week) })
      certifiedGameEvidence = { available: ctx.available, freshnessStatus: ctx.freshnessStatus, snapshotVersion: ctx.snapshotVersion, totalGames: ctx.totalGames, finalGames: ctx.finalGames, allGamesFinal: ctx.allGamesFinal }
    } catch {
      certifiedGameEvidence = null
    }
  }

  return {
    leagueId: input.leagueId,
    season: weekResolved.season,
    week: weekResolved.week,
    sport: league.sport,
    platform: league.platform,
    weekResolution: {
      source: weekResolved.source,
      isPlayoffWeek: weekResolved.isPlayoffWeek,
      playoffStartWeek: weekResolved.playoffStartWeek,
    },
    matchup,
    matchupState: normalizeMatchupState({ matchup, fetchedAt, unavailableReason, certifiedGameEvidence }),
    unavailableReason,
  }
}
