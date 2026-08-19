/**
 * Canonical, provider-agnostic FAKE data for Phase 2 Canonical World Assembly tests.
 *
 * These fixtures are hand-built to exercise the substrate's fact contract — they are NOT pulled from
 * any provider SDK. Two universes are represented to prove origin-blindness:
 *   - an IMPORTED provider league (Sleeper-shaped `Roster.playerData` blob; FAAB only as remaining)
 *   - a NATIVE AllFantasy league (clean ids, stored FAAB remaining, simpler playerData)
 * The substrate must produce structurally identical fact shapes for both.
 */
import type { CanonicalWorldRawInput } from '@/lib/decision-os/world/facts'

/**
 * IMPORTED provider league. Mirrors what `SleeperLeagueCreationBootstrapService` actually writes:
 * `Roster.playerData` carries `{ players, starters, reserve, taxi, source_team_id, source_manager_id,
 * import:{...} }`; `faabRemaining` is null (the mapper cannot compute remaining at import time).
 */
export function makeImportedProviderWorld(
  overrides?: Partial<CanonicalWorldRawInput>,
): CanonicalWorldRawInput {
  const base: CanonicalWorldRawInput = {
    league: {
      id: 'lg-import-1',
      sport: 'NFL',
      season: 2025,
      scoring: 'ppr',
      scoringPresetId: 'preset-ppr',
      leagueType: 'redraft',
      isDynasty: false,
      rosterSize: 15,
      starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
      irSlots: 1,
      taxiSlots: 0,
      waiverType: 'faab',
      waiverBudget: 100,
      waiverMinBid: 0,
      waiverHours: 24,
      tradeReviewHours: 48,
      tradeDeadlineWeek: 12,
      draftPickTrading: false,
      settings: { scoring_settings: { rec: 1 } },
      lastSyncedAt: new Date('2025-10-01T00:00:00.000Z'),
      syncStatus: 'synced',
      platform: 'sleeper',
      platformLeagueId: 'sleeper-league-9999',
    },
    teams: [
      {
        id: 'team-A',
        externalId: 'roster-1',
        ownerName: 'theciege24',
        teamName: 'Da Squad',
        wins: 5,
        losses: 2,
        ties: 0,
        pointsFor: 812.4,
        pointsAgainst: 0, // not stored by import → must be derived from performances
        currentRank: 2,
        role: 'commissioner',
        isOrphan: false,
        isCommissioner: true,
        isCoCommissioner: false,
        platformUserId: 'sleeper-user-111',
        claimedByUserId: 'af-user-777',
      },
      {
        id: 'team-B',
        externalId: 'roster-2',
        ownerName: 'rivalManager',
        teamName: 'The Rivals',
        wins: 4,
        losses: 3,
        ties: 0,
        pointsFor: 760.1,
        pointsAgainst: 0,
        currentRank: 4,
        role: 'member',
        isOrphan: false,
        isCommissioner: false,
        isCoCommissioner: false,
        platformUserId: 'sleeper-user-222',
        claimedByUserId: null,
      },
    ],
    rosters: [
      {
        id: 'roster-row-A',
        platformUserId: 'af-user-777',
        playerData: {
          players: ['4046', '6794', '4035', '2133', '0'],
          starters: ['4046', '6794', '4035'],
          reserve: ['2133'],
          taxi: [],
          source_provider: 'sleeper',
          source_league_id: 'sleeper-league-9999',
          source_team_id: 'roster-1',
          source_manager_id: 'sleeper-user-111',
          import: {
            provider: 'sleeper',
            sourceLeagueId: 'sleeper-league-9999',
            sourceTeamId: 'roster-1',
            sourceManagerId: 'sleeper-user-111',
            displayName: 'Da Squad',
            ownerName: 'theciege24',
          },
        },
        faabRemaining: null, // imported: remaining not computable at import time
        waiverPriority: null,
        settings: null,
      },
      {
        id: 'roster-row-B',
        platformUserId: 'sleeper-user-222',
        playerData: {
          players: ['1234', '5678', '9012'],
          starters: ['1234', '5678'],
          reserve: [],
          taxi: [],
          source_provider: 'sleeper',
          source_league_id: 'sleeper-league-9999',
          source_team_id: 'roster-2',
          source_manager_id: 'sleeper-user-222',
        },
        faabRemaining: null,
        waiverPriority: null,
        settings: null,
      },
    ],
    performances: [
      // Week 1: A vs B — A scored 120, B scored 100
      { teamId: 'team-A', week: 1, season: 2025, points: 120, opponent: 'team-B', result: 'W' },
      { teamId: 'team-B', week: 1, season: 2025, points: 100, opponent: 'team-A', result: 'L' },
      // Week 2: A vs B — A scored 90, B scored 110
      { teamId: 'team-A', week: 2, season: 2025, points: 90, opponent: 'team-B', result: 'L' },
      { teamId: 'team-B', week: 2, season: 2025, points: 110, opponent: 'team-A', result: 'W' },
    ],
  }
  return { ...base, ...overrides }
}

/**
 * A REALISTIC imported `League.settings` snapshot — the shape `canonicalImportNormalizer` actually
 * persists for a Sleeper import (see the real "KBI Smoke Black" staging league). It deliberately folds
 * BOTH genuine scoring config AND league chrome / provenance that carry provider-branded strings:
 *   - `visualTheme.logoUrl` / `mediaSettings.logoUrl` = a `sleepercdn.com` URL  ← the F0-1 leak source
 *   - `avatar`, `name`, `leagueSize` league chrome
 *   - `scoringSettings.source = 'sleeper'` provenance nested inside the scoring slice
 *   - `conceptRules.extensions.importSource = 'sleeper'`, `source_tracking`, `identity_mappings`
 * The substrate must surface the scoring config while letting NONE of the `sleeper` strings reach a fact.
 */
export const IMPORTED_SETTINGS_SNAPSHOT_WITH_PROVIDER_CHROME = {
  name: 'KBI Smoke Black',
  avatar: 'aecc2886e68404faed2ff80ee53f3277',
  leagueSize: 12,
  scoring: 'PPR TEP',
  snapshotVersion: 1,
  visualTheme: { logoUrl: 'https://sleepercdn.com/avatars/thumbs/aecc2886e68404faed2ff80ee53f3277' },
  mediaSettings: { logoUrl: 'https://sleepercdn.com/avatars/thumbs/aecc2886e68404faed2ff80ee53f3277' },
  scoringSettings: {
    rules: { rec: 1, rec_yd: 0.1, bonus_rec_te: 0.5 },
    format: 'custom',
    source: 'sleeper', // provenance nested in the scoring slice — must be stripped, not surfaced
    scoringTemplateId: 'fb_half_ppr',
  },
  scoring_settings: { rec: 1, rec_yd: 0.1, bonus_rec_te: 0.5 },
  conceptRules: { concept: 'redraft', extensions: { importSource: 'sleeper', sourceLeagueId: '1096853585905799168' } },
  source_tracking: { source_provider: 'sleeper', source_league_id: '1096853585905799168' },
  identity_mappings: [{ stable_key: 'sleeper:league:1096853585905799168', source_provider: 'sleeper' }],
} as const

/**
 * NATIVE AllFantasy league. Clean ids, stored FAAB remaining, persisted waiver_budget_used, simple
 * playerData. Proves the substrate produces the same fact shape without any provider metadata.
 */
export function makeNativeAfWorld(
  overrides?: Partial<CanonicalWorldRawInput>,
): CanonicalWorldRawInput {
  const base: CanonicalWorldRawInput = {
    league: {
      id: 'lg-native-1',
      sport: 'NFL',
      season: 2025,
      scoring: 'half_ppr',
      scoringPresetId: 'preset-half-ppr',
      leagueType: 'redraft',
      isDynasty: false,
      rosterSize: 14,
      starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
      irSlots: 0,
      taxiSlots: 0,
      waiverType: 'faab',
      waiverBudget: 100,
      waiverMinBid: 0,
      waiverHours: 24,
      tradeReviewHours: 24,
      tradeDeadlineWeek: 13,
      draftPickTrading: true,
      settings: null,
      lastSyncedAt: new Date('2025-10-01T00:00:00.000Z'),
      syncStatus: 'synced',
      platform: null, // native: no provider
      platformLeagueId: null,
    },
    teams: [
      {
        id: 'nteam-A',
        externalId: 'nteam-A',
        ownerName: 'Commish',
        teamName: 'Home Team',
        wins: 6,
        losses: 1,
        ties: 0,
        pointsFor: 901.2,
        pointsAgainst: 743.6, // native: stored directly
        currentRank: 1,
        role: 'commissioner',
        isOrphan: false,
        isCommissioner: true,
        isCoCommissioner: false,
        platformUserId: 'af-user-001',
        claimedByUserId: 'af-user-001',
      },
    ],
    rosters: [
      {
        id: 'nroster-A',
        platformUserId: 'af-user-001',
        playerData: {
          players: ['p1', 'p2', 'p3', 'p4'],
          starters: ['p1', 'p2'],
          reserve: [],
          taxi: [],
        },
        faabRemaining: 73, // native: stored remaining
        waiverPriority: 1,
        settings: { waiver_budget_used: 27 },
      },
    ],
    performances: [
      { teamId: 'nteam-A', week: 1, season: 2025, points: 130, opponent: null, result: 'W' },
      { teamId: 'nteam-A', week: 2, season: 2025, points: 125, opponent: null, result: 'W' },
      { teamId: 'nteam-A', week: 3, season: 2025, points: 118, opponent: null, result: 'W' },
    ],
  }
  return { ...base, ...overrides }
}

/**
 * IMPORTED Sleeper DYNASTY / SUPERFLEX / IDP / TE-PREMIUM league. One realistic fixture folds the
 * dynasty-specific dimensions the substrate must carry without branching:
 *   - `isDynasty: true` + `taxiSlots > 0`, with a populated `taxi` stash on the roster
 *   - a SUPER_FLEX starting slot and IDP slots (`DL` / `LB` / `DB`) in `starters` — must survive as raw
 *     slot strings (the substrate never interprets position type)
 *   - a TE-premium scoring blob in `settings` — must ride through `scoringSettings` opaque, NOT parsed
 * Proves the contract holds for a dynasty config that is structurally identical (same fact keys) to the
 * redraft + native worlds.
 */
export function makeImportedSleeperDynastyWorld(
  overrides?: Partial<CanonicalWorldRawInput>,
): CanonicalWorldRawInput {
  const base: CanonicalWorldRawInput = {
    league: {
      id: 'lg-dynasty-1',
      sport: 'NFL',
      season: 2025,
      scoring: 'ppr',
      scoringPresetId: 'preset-ppr-tep',
      leagueType: 'dynasty',
      isDynasty: true,
      rosterSize: 30,
      // Superflex + IDP starting lineup — raw slot strings the substrate must NOT branch on.
      starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'DL', 'LB', 'DB', 'K', 'DEF'],
      irSlots: 3,
      taxiSlots: 4,
      waiverType: 'faab',
      waiverBudget: 200,
      waiverMinBid: 0,
      waiverHours: 24,
      tradeReviewHours: 24,
      tradeDeadlineWeek: 12,
      draftPickTrading: true,
      // TE-premium: scoring rides through as an opaque blob; the substrate must never interpret it.
      settings: { scoring_settings: { rec: 1, bonus_rec_te: 0.5 } },
      lastSyncedAt: new Date('2025-10-01T00:00:00.000Z'),
      syncStatus: 'synced',
      platform: 'sleeper',
      platformLeagueId: 'sleeper-dynasty-7777',
    },
    teams: [
      {
        id: 'dteam-A',
        externalId: 'droster-1',
        ownerName: 'theciege24',
        teamName: 'Dynasty Kings',
        wins: 7,
        losses: 1,
        ties: 0,
        pointsFor: 1042.6,
        pointsAgainst: 0, // imported: derive from performances
        currentRank: 1,
        role: 'commissioner',
        isOrphan: false,
        isCommissioner: true,
        isCoCommissioner: false,
        platformUserId: 'sleeper-user-aaa',
        claimedByUserId: 'af-user-aaa',
      },
      {
        id: 'dteam-B',
        externalId: 'droster-2',
        ownerName: 'dynastyRival',
        teamName: 'Empire',
        wins: 5,
        losses: 3,
        ties: 0,
        pointsFor: 980.2,
        pointsAgainst: 0,
        currentRank: 3,
        role: 'co_commissioner',
        isOrphan: false,
        isCommissioner: false,
        isCoCommissioner: true, // distinct co-commissioner — exercised by the commissioner-views assertion
        platformUserId: 'sleeper-user-bbb',
        claimedByUserId: null,
      },
    ],
    rosters: [
      {
        id: 'droster-row-A',
        platformUserId: 'af-user-aaa',
        playerData: {
          // QB/RB/WR/TE + IDP (DL/LB/DB) starters, a 2-deep taxi stash, and a "0" placeholder to drop.
          players: ['4046', '6794', '4035', '2133', 'idp-dl-1', 'idp-lb-1', 'idp-db-1', 'taxi-1', 'taxi-2', '0'],
          starters: ['4046', '6794', '4035', '2133', 'idp-dl-1', 'idp-lb-1', 'idp-db-1'],
          reserve: [],
          taxi: ['taxi-1', 'taxi-2'],
          source_provider: 'sleeper',
          source_league_id: 'sleeper-dynasty-7777',
          source_team_id: 'droster-1',
          source_manager_id: 'sleeper-user-aaa',
        },
        faabRemaining: null,
        waiverPriority: null,
        settings: null,
      },
      {
        id: 'droster-row-B',
        platformUserId: 'sleeper-user-bbb',
        playerData: {
          players: ['1234', '5678', '9012'],
          starters: ['1234', '5678'],
          reserve: [],
          taxi: [],
          source_provider: 'sleeper',
          source_league_id: 'sleeper-dynasty-7777',
          source_team_id: 'droster-2',
          source_manager_id: 'sleeper-user-bbb',
        },
        faabRemaining: null,
        waiverPriority: null,
        settings: null,
      },
    ],
    performances: [
      { teamId: 'dteam-A', week: 1, season: 2025, points: 140, opponent: 'dteam-B', result: 'W' },
      { teamId: 'dteam-B', week: 1, season: 2025, points: 120, opponent: 'dteam-A', result: 'L' },
      { teamId: 'dteam-A', week: 2, season: 2025, points: 132, opponent: 'dteam-B', result: 'W' },
      { teamId: 'dteam-B', week: 2, season: 2025, points: 128, opponent: 'dteam-A', result: 'L' },
    ],
  }
  return { ...base, ...overrides }
}

/**
 * IMPORTED league on a PRIORITY (rolling) waiver system rather than FAAB. Proves two things:
 *   1. FAAB degrades honestly when the league has no budget — `waiverBudget: null` + `faabRemaining:
 *      null` ⇒ `faab.remaining` stays null (never fabricated), with the honest completeness warning.
 *   2. The per-team waiver ORDER (`Roster.waiverPriority`) is carried into the canonical facts — the
 *      fact that previously dropped on the floor (closed in Phase D.2, consumed by `waiver ← canonical`).
 */
export function makePriorityWaiverWorld(
  overrides?: Partial<CanonicalWorldRawInput>,
): CanonicalWorldRawInput {
  const base: CanonicalWorldRawInput = {
    league: {
      id: 'lg-priority-1',
      sport: 'NFL',
      season: 2025,
      scoring: 'standard',
      scoringPresetId: 'preset-standard',
      leagueType: 'redraft',
      isDynasty: false,
      rosterSize: 15,
      starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
      irSlots: 1,
      taxiSlots: 0,
      waiverType: 'priority', // rolling/priority waivers — NO FAAB budget
      waiverBudget: null,
      waiverMinBid: null,
      waiverHours: 24,
      tradeReviewHours: 48,
      tradeDeadlineWeek: 12,
      draftPickTrading: false,
      settings: { scoring_settings: { rec: 0 } },
      lastSyncedAt: new Date('2025-10-01T00:00:00.000Z'),
      syncStatus: 'synced',
      platform: 'sleeper',
      platformLeagueId: 'sleeper-priority-5555',
    },
    teams: [
      {
        id: 'pteam-A',
        externalId: 'proster-1',
        ownerName: 'theciege24',
        teamName: 'Priority Pickers',
        wins: 3,
        losses: 4,
        ties: 0,
        pointsFor: 690.5,
        pointsAgainst: 701.2, // stored here to keep this fixture focused on the waiver dimension
        currentRank: 6,
        role: 'member',
        isOrphan: false,
        isCommissioner: false,
        isCoCommissioner: false,
        platformUserId: 'sleeper-user-p1',
        claimedByUserId: 'af-user-p1',
      },
    ],
    rosters: [
      {
        id: 'proster-row-A',
        platformUserId: 'af-user-p1',
        playerData: {
          players: ['4046', '6794', '4035'],
          starters: ['4046', '6794'],
          reserve: ['4035'],
          taxi: [],
          source_provider: 'sleeper',
          source_league_id: 'sleeper-priority-5555',
          source_team_id: 'proster-1',
          source_manager_id: 'sleeper-user-p1',
        },
        faabRemaining: null, // priority league: no FAAB at all
        waiverPriority: 3, // the per-team order that previously never reached the facts
        settings: null,
      },
    ],
    performances: [
      { teamId: 'pteam-A', week: 1, season: 2025, points: 95, opponent: null, result: 'L' },
      { teamId: 'pteam-A', week: 2, season: 2025, points: 101, opponent: null, result: 'W' },
    ],
  }
  return { ...base, ...overrides }
}
