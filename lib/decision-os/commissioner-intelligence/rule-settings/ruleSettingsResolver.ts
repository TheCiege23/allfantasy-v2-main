/**
 * Commissioner Intelligence Platform — Phase 6: Rule / Settings resolver.
 *
 * Live, READ-ONLY provider. Reads the `League` row, parses the typed
 * `SettingsSnapshot`, resolves the normalized roster config + per-sport defaults,
 * and runs the pure `aggregateCommissionerRuleSettings`. Consumes NORMALIZED /
 * RESOLVED settings, never raw JSON, and NO AI/recommendation source.
 *
 * Read-only: one `findUnique`, zero writes. Unlike the other Commissioner
 * modules this reads STORED config (not DomainEvent projections), so it returns
 * data even for import-only leagues. The route enforces commissioner auth.
 */

import { prisma } from '@/lib/prisma'
import { parseSettingsSnapshot } from '@/lib/league-contract/types'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { getRedraftSportConfig } from '@/lib/redraft/sportConfig'
import { aggregateCommissionerRuleSettings } from './ruleSettingsAggregator'
import type { CommissionerRuleSettingsV1, RuleSettingsInput, RuleSettingsSource } from './types'

export interface RuleSettingsResolverArgs {
  leagueId: string
}

export interface RuleSettingsDataProvider {
  /** Returns the contract, or null when the league row does not exist. */
  getCommissionerRuleSettings(args: RuleSettingsResolverArgs): Promise<CommissionerRuleSettingsV1 | null>
}

export function createLiveRuleSettingsDataProvider(): RuleSettingsDataProvider {
  return {
    async getCommissionerRuleSettings({ leagueId }) {
      const league = await prisma.league.findUnique({
        where: { id: leagueId },
        select: {
          sport: true,
          scoring: true,
          scoringPresetId: true,
          settings: true,
          leagueType: true,
          waiverType: true,
          tradeReviewHours: true,
          tradeDeadlineWeek: true,
          playoffTeams: true,
          playoffStartWeek: true,
          playoffSeedingRule: true,
          _count: { select: { teams: true } },
        },
      })
      if (!league) return null

      const sport = String(league.sport ?? 'nfl')
      const snap = parseSettingsSnapshot(league.settings ?? null)
      const rosterCfg = resolveRedraftRosterConfig(sport, league.settings ?? null)
      const defaults = getRedraftSportConfig(sport)

      const starterSlots: Record<string, number> = {}
      for (const [token, count] of rosterCfg.starterCapacities) starterSlots[token] = count

      const scoring = snap?.scoringSettings ?? null
      const commish = snap?.commissionerSettings ?? null
      const playoff = snap?.playoffSettings ?? null

      const source: RuleSettingsSource = snap
        ? 'settings_snapshot'
        : rosterCfg.source === 'commissioner'
          ? 'league_columns'
          : 'defaults'

      const input: RuleSettingsInput = {
        hasSettings: true, // the league row exists → we can always describe something
        source,
        starterSlots,
        benchSlots: rosterCfg.benchSlots,
        irSlots: rosterCfg.irSlots,
        taxiSlots: rosterCfg.taxiSlots,
        devyCollegeSlots: Number(snap?.rosterSettings?.devyCollegeSlots ?? 0) || 0,
        scoringFormat: scoring?.format ?? league.scoring ?? league.scoringPresetId ?? null,
        scoringMode: scoring?.scoringMode ?? null,
        scoringRules: (scoring?.rules as Record<string, unknown> | undefined) ?? null,
        leagueType: league.leagueType ?? null,
        waiverType: snap?.waiverSettings?.waiverType ?? league.waiverType ?? null,
        tradeReviewMode: commish?.tradeReviewMode ?? null,
        tradeReviewHours: league.tradeReviewHours ?? null,
        tradeDeadlineWeek: commish?.tradeDeadlineWeek ?? league.tradeDeadlineWeek ?? null,
        playoffTeams: playoff?.playoffTeams ?? league.playoffTeams ?? null,
        playoffStartWeek: playoff?.playoffStartWeek ?? league.playoffStartWeek ?? null,
        playoffSeedingRule: playoff?.seedingRule ?? league.playoffSeedingRule ?? null,
        leagueTeamCount: league._count.teams,
        defaults: {
          starterCount: defaults.starterSlots.length,
          benchSlots: defaults.benchSlots,
          irSlots: defaults.irSlots,
          scoringFormat: defaults.defaultScoringFormat,
          playoffTeams: defaults.defaultPlayoffTeams,
          teamCount: defaults.defaultTeamCount,
          waiverType: defaults.defaultWaiverType,
          seasonWeeks: defaults.regularSeasonWeeks,
        },
      }

      return aggregateCommissionerRuleSettings(input)
    },
  }
}
