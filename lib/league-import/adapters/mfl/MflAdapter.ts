import type { ILeagueImportAdapter } from '../ILeagueImportAdapter'
import type { NormalizedImportResult, SourceTracking } from '../../types'
import type { MflImportPayload } from './types'
import { resolveProviderScoringStatKey } from '@/lib/scoring-defaults/ScoringKeyAliasResolver'

/**
 * The league's scoring format, or `null` when MFL did not say.
 *
 * 🛑 THIS USED TO READ THE LEAGUE'S NAME. The previous implementation was:
 *
 *     const scoringType = `${raw.settings?.scoringType ?? raw.league.name ?? ''}`.toLowerCase()
 *     if (scoringType.includes('ppr')) return 'ppr'
 *     if (scoringType.includes('half') || scoringType.includes('0.5')) return 'half'
 *     return raw.league.sport === 'NFL' ? 'standard' : ...
 *
 * So a league called "The Half Pint Dynasty" was assigned half-PPR, a league with "PPR"
 * anywhere in its title was assigned PPR, and — worse, because it is silent and universal —
 * EVERY NFL league that did not describe itself was assigned "standard" outright. That is a
 * fabricated answer presented with the same confidence as a real one, and nothing
 * downstream could tell the two apart.
 *
 * Now: MFL's own `scoring_type` field if it supplied one, otherwise the reception rule that
 * `TYPE=rules` actually returned, otherwise `null`. A null propagates into the import
 * coverage block as missing scoring, which the league dashboard states in the user's own
 * terms — an honest gap the manager can act on, instead of a wrong number they cannot see.
 */
function detectMflScoringFormat(raw: MflImportPayload): string | null {
  const declared = String(raw.settings?.scoringType ?? '').toLowerCase().trim()
  if (declared) {
    if (declared.includes('ppr') || declared.includes('point per reception')) return 'ppr'
    if (declared.includes('half') || declared.includes('0.5')) return 'half'
    if (declared.includes('standard')) return 'standard'
    /* MFL said something we do not recognise. Pass its own word through rather than
       flattening it to a format we invented. */
    return raw.settings?.scoringType ?? null
  }

  /*
   * Nothing declared — read the rules instead of the name. A reception rule is the only
   * thing that distinguishes these three formats, and its VALUE is the answer: 1 point is
   * PPR, a half point is half-PPR, zero (or no reception rule at all in a league that
   * returned rules) is standard.
   *
   * ⚠ REQUIRES A RESOLVED `rec` KEY, NOT A GUESSED CODE. `resolveProviderScoringStatKey`
   * only maps what it can justify, so this fires when MFL supplied a name we recognise and
   * stays null when it did not. Guessing which abbreviation means "reception" is exactly
   * the class of error this whole change removes.
   */
  const rules = raw.scoringRules ?? []
  if (rules.length === 0) return null

  const reception = rules.find(
    (rule) => resolveProviderScoringStatKey(`mfl_stat_${rule.code}`, { mflStatName: rule.name }) === 'rec',
  )
  if (!reception) {
    /* Rules came back and none of them is a reception we can identify. We know scoring
       exists but not which format — say nothing rather than assume standard. */
    return null
  }
  if (reception.points >= 0.75) return 'ppr'
  if (reception.points >= 0.25) return 'half'
  return 'standard'
}

function detectMflDynasty(raw: MflImportPayload): boolean {
  const settings = raw.settings?.raw ?? {}
  const keeperLikeKeys = [
    'keeper',
    'keepers',
    'dynasty',
    'uses_future_draft_picks',
    'future_draft_picks',
    'uses_contracts',
    'salary_cap_amount',
    'taxi_squad',
  ]

  return keeperLikeKeys.some((key) => {
    const value = settings[key]
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value > 0
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      return normalized === 'yes' || normalized === 'true' || normalized === '1' || normalized === 'dynasty'
    }
    return false
  })
}

export const MflAdapter: ILeagueImportAdapter<MflImportPayload> = {
  provider: 'mfl',

  async normalize(raw) {
    const importBatchId = `mfl-${raw.league.leagueId}-${Date.now()}`
    const source: SourceTracking = {
      source_provider: 'mfl',
      source_league_id: raw.league.leagueId,
      source_season_id: raw.league.season != null ? String(raw.league.season) : undefined,
      import_batch_id: importBatchId,
      imported_at: new Date().toISOString(),
    }

    const scoringFormat = detectMflScoringFormat(raw)
    const isDynasty = detectMflDynasty(raw)
    const rosterPositions = raw.settings?.rosterPositions ?? []
    const rosterSize =
      rosterPositions.length > 0
        ? rosterPositions.reduce((total, slot) => total + Math.max(0, slot.count), 0)
        : raw.teams.reduce((max, team) => Math.max(max, team.rosterPlayerIds.length), 0) || null

    const rosters = raw.teams.map((team) => ({
      source_team_id: team.franchiseId,
      source_manager_id: team.managerId,
      owner_name: team.managerName,
      team_name: team.teamName,
      avatar_url: team.logoUrl,
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      points_for: team.pointsFor,
      points_against: team.pointsAgainst ?? undefined,
      player_ids: team.rosterPlayerIds,
      starter_ids: team.starterPlayerIds,
      reserve_ids: team.reservePlayerIds,
      taxi_ids: team.taxiPlayerIds,
      faab_remaining: team.faabRemaining,
      waiver_priority: team.waiverPriority,
    }))

    /*
     * ⚠ `rules: []` WAS HARDCODED — MFL SHIPPED WITH NO SCORING RULES AT ALL, because
     * nothing ever requested `TYPE=rules`. They are real now.
     *
     * Keys are namespaced `mfl_stat_<code>`, exactly as ESPN and Yahoo are, and resolved
     * downstream by the single `ScoringKeyAliasResolver`. Storing MFL's own code rather
     * than a translated key is what keeps a mapping we cannot yet justify out of the data:
     * an unresolved key scores nothing, a WRONG key scores everything wrongly.
     *
     * ⚠ AND THE FORMAT IS NO LONGER FORCED TO 'standard'. `?? 'standard'` was the last
     * place a fabricated answer could re-enter after `detectMflScoringFormat` honestly
     * returned null.
     */
    const mflScoringRules = (raw.scoringRules ?? []).map((rule) => ({
      stat_key: `mfl_stat_${rule.code}`,
      points_value: rule.points,
    }))
    const scoring =
      raw.settings != null || mflScoringRules.length > 0
        ? {
            scoring_format: scoringFormat ?? raw.settings?.scoringType ?? null,
            rules: mflScoringRules,
            raw: raw.settings?.raw ?? {},
          }
        : null

    const schedule = raw.schedule.map((week) => ({
      week: week.week,
      season: week.season,
      matchups: week.matchups.map((matchup) => ({
        roster_id_1: matchup.franchiseId1,
        roster_id_2: matchup.franchiseId2,
        points_1: matchup.points1,
        points_2: matchup.points2,
      })),
    }))

    const transactions = raw.transactions.map((transaction) => ({
      source_transaction_id: transaction.transactionId,
      type:
        transaction.type.includes('trade')
          ? ('trade' as const)
          : transaction.type.includes('waiver')
            ? ('waiver' as const)
            : transaction.type.includes('drop')
              ? ('drop' as const)
              : ('free_agent' as const),
      status: transaction.status,
      created_at: transaction.createdAt ?? source.imported_at,
      adds: Object.keys(transaction.adds).length > 0 ? transaction.adds : undefined,
      drops: Object.keys(transaction.drops).length > 0 ? transaction.drops : undefined,
      roster_ids: transaction.franchiseIds,
      draft_picks: [],
    }))

    const draftPicks = raw.draftPicks.map((pick) => ({
      round: pick.round,
      pick_no: pick.pickNumber,
      source_roster_id: pick.franchiseId,
      source_player_id: pick.playerId,
      season: raw.league.season,
      source_draft_id: `${raw.league.leagueId}:${raw.league.season ?? 'unknown'}`,
      player_name: pick.playerName ?? null,
      position: pick.position ?? null,
      team: pick.team ?? null,
    }))

    const standings = raw.teams.map((team) => ({
      source_team_id: team.franchiseId,
      rank: team.rank ?? raw.teams.length,
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      points_for: team.pointsFor,
      points_against: team.pointsAgainst ?? undefined,
    }))

    const playerIdentityCount = Object.keys(raw.playerMap).length
    const rosterPlayerCount = new Set(raw.teams.flatMap((team) => team.rosterPlayerIds)).size

    return {
      source,
      league: {
        name: raw.league.name,
        sport: raw.league.sport,
        season: raw.league.season,
        leagueSize: raw.league.size,
        rosterSize,
        scoring: scoringFormat,
        isDynasty,
        // Same fix as Sleeper/ESPN/Yahoo: `League.status` has no DB default, so a
        // missing value here leaves imported leagues invisible on Dashboard. MFL's
        // real signal is coarser (season-year comparison, not a live in-season
        // flag) but still real, not fabricated — `raw.league.isFinished`.
        status: raw.league.isFinished ? 'complete' : 'in_season',
        playoff_team_count: raw.league.playoffTeamCount ?? undefined,
        regular_season_length: raw.league.regularSeasonLength ?? undefined,
        schedule_unit: 'week',
        matchup_frequency: 'head_to_head',
        waiver_type: raw.settings?.usesFaab ? 'faab' : raw.settings?.waiverType ?? undefined,
        faab_budget: raw.settings?.acquisitionBudget ?? null,
        roster_positions: rosterPositions.map((slot) => `${slot.position}:${slot.count}`),
        mfl_settings: raw.settings?.raw ?? null,
      },
      rosters,
      scoring,
      schedule,
      /*
       * ⚠ ONLY THE PICKS THAT ACTUALLY MOVED. MFL's export lists every future pick a
       * franchise holds, its own included — the opposite of Sleeper's `/traded_picks`,
       * which contains a row only once a pick has left its original roster. That
       * difference is load-bearing: `persistTradedPicks` writes `traded: true`
       * unconditionally, so passing MFL's full list through would mark every untraded
       * pick in the league as traded, and a league that has never made a pick trade
       * would import with a full board of them.
       *
       * Franchise ids are the same identity `source_team_id` uses, so these join to
       * `league_teams.externalId` exactly as Sleeper's roster ids do.
       */
      traded_picks: (raw.futureDraftPicks ?? [])
        .filter((pick) => pick.originalFranchiseId !== pick.currentOwnerFranchiseId)
        .map((pick) => ({
          season: pick.season,
          round: pick.round,
          original_roster_id: pick.originalFranchiseId,
          current_owner_roster_id: pick.currentOwnerFranchiseId,
        })),
      draft_picks: draftPicks,
      transactions,
      standings,
      player_map: raw.playerMap,
      previous_seasons: raw.previousSeasons.map((season) => ({
        season: season.season,
        source_league_id: season.sourceLeagueId,
      })),
      coverage: {
        leagueSettings: {
          state: raw.settings ? 'full' : 'partial',
          count: 1,
          note: raw.settings ? null : 'MFL league metadata was available, but detailed settings were only partially parsed.',
        },
        currentRosters: {
          state:
            rosters.length === 0
              ? 'missing'
              : raw.lineupBreakdownAvailable
                ? 'full'
                : 'partial',
          count: rosters.length,
          note:
            rosters.length === 0
              ? 'No MFL roster data was available for this league.'
              : raw.lineupBreakdownAvailable
                ? null
                : 'MFL roster players were imported, but starter versus bench status was not fully exposed by the fetched roster payload.',
        },
        historicalRosterSnapshots: {
          state: raw.previousSeasons.length > 0 ? 'partial' : 'missing',
          count: raw.previousSeasons.length,
          note:
            raw.previousSeasons.length > 0
              ? 'Historical MFL season-end roster snapshots are completed during post-import backfill for discovered prior seasons.'
              : 'No prior MFL seasons were discovered for historical roster backfill.',
        },
        scoringSettings: {
          state: raw.settings ? 'partial' : 'missing',
          count: 0,
          note:
            raw.settings
              ? 'MFL scoring format and raw settings were imported, but detailed rule-by-rule scoring normalization is still partial.'
              : 'MFL scoring settings were not available from the fetched league metadata.',
        },
        playoffSettings: {
          state:
            raw.league.playoffTeamCount != null || raw.league.regularSeasonLength != null
              ? 'full'
              : raw.settings
                ? 'partial'
                : 'missing',
          note:
            raw.league.playoffTeamCount != null || raw.league.regularSeasonLength != null
              ? null
              : 'MFL playoff settings were only partially available from league metadata.',
        },
        currentStandings: {
          state: standings.length > 0 ? 'full' : 'missing',
          count: standings.length,
        },
        currentSchedule: {
          state: schedule.length > 0 ? 'partial' : 'missing',
          count: schedule.length,
          note:
            schedule.length > 0
              ? 'MFL matchup weeks were imported when schedule data was available, but expected-week coverage is not fully verified yet.'
              : 'No MFL schedule data was available for this league preview.',
        },
        draftHistory: {
          state:
            draftPicks.length > 0
              ? raw.previousSeasons.length > 0
                ? 'partial'
                : 'full'
              : 'missing',
          count: draftPicks.length,
          note:
            draftPicks.length > 0
              ? raw.previousSeasons.length > 0
                ? 'MFL preview includes accessible current-league draft results; discovered prior-season draft facts are completed during post-import backfill.'
                : null
              : 'No MFL draft results were available for this league preview.',
        },
        tradeHistory: {
          state:
            transactions.length > 0
              ? raw.previousSeasons.length > 0
                ? 'partial'
                : 'full'
              : 'missing',
          count: transactions.length,
          note:
            transactions.length > 0
              ? raw.previousSeasons.length > 0
                ? 'MFL preview includes accessible current-league transactions; discovered prior-season transaction facts are completed during post-import backfill.'
                : null
              : 'No MFL transactions were available for this league preview.',
        },
        previousSeasons: {
          state: raw.previousSeasons.length > 0 ? 'partial' : 'missing',
          count: raw.previousSeasons.length,
          note:
            raw.previousSeasons.length > 0
              ? 'MFL previous seasons were discovered by checking the same league ID across earlier seasons, then used during post-import backfill.'
              : 'No prior MFL seasons were discovered for this league ID.',
        },
        playerIdentityMap: {
          state:
            playerIdentityCount === 0
              ? 'missing'
              : playerIdentityCount >= rosterPlayerCount && rosterPlayerCount > 0
                ? 'full'
                : 'partial',
          count: playerIdentityCount,
          note:
            playerIdentityCount > 0 && playerIdentityCount < rosterPlayerCount
              ? 'MFL player IDs were matched through the local player identity map where possible.'
              : playerIdentityCount === 0
                ? 'No local player identity matches were found for the imported MFL player IDs.'
                : null,
        },
      },
    } satisfies NormalizedImportResult
  },
}
