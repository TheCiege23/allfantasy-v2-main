import type { ILeagueImportAdapter } from '../ILeagueImportAdapter'
import type { FleaflickerImportPayload } from '@/lib/league-import/fleaflicker/types'
import type { NormalizedImportResult, NormalizedRoster, SourceTracking } from '../../types'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { isAuthoritativeStatus } from '@/lib/league-import/resourceStatus'

function mapWaiverType(raw: string | null | undefined): string {
  const s = String(raw ?? '').toUpperCase()
  if (s.includes('BLIND') || s.includes('FAAB')) return 'faab'
  if (s.includes('ROLL')) return 'rolling'
  return 'rolling'
}

function detectDynasty(league: FleaflickerImportPayload['standings']['league']): boolean {
  const desc = `${league.description ?? ''} ${league.name ?? ''}`.toLowerCase()
  const keepers = league.maxKeepers != null && league.maxKeepers > 0
  return keepers || desc.includes('dynasty') || desc.includes('keeper')
}

export const FleaflickerAdapter: ILeagueImportAdapter<FleaflickerImportPayload> = {
  provider: 'fleaflicker',

  async normalize(raw) {
    const { sport, season, standings, rosters } = raw
    /*
     * IMP-04 — a roster read that FAILED is not a league of empty rosters. Absent on an
     * older payload means the fetcher predates the status, and the old behaviour (trust it)
     * is the compatible default.
     */
    const rostersStatus = raw.rostersStatus ?? 'fetched'
    const rostersAreAuthoritative = isAuthoritativeStatus(rostersStatus)
    const observedAt = new Date().toISOString()
    const lg = standings.league

    const importBatchId = `fleaflicker-${lg.id}-${Date.now()}`
    const source: SourceTracking = {
      source_provider: 'fleaflicker',
      source_league_id: String(lg.id),
      source_season_id: String(season),
      import_batch_id: importBatchId,
      imported_at: new Date().toISOString(),
    }

    /*
     * ⚠ A DIVISION CAN ARRIVE WITH NO `teams` ARRAY AT ALL, AND THE COMMITTED FIXTURE
     * PROVES IT: `contracts/fleaflicker/fixtures/standings.NFL.json` carries three
     * divisions and only the first has `teams`. `d.teams.map` threw on the second, so
     * a real Fleaflicker league with an empty division could not be imported at all.
     * An empty division is a legitimate league shape, not a malformed response.
     */
    const teamsFlat = (standings.divisions ?? []).flatMap((d) =>
      (d.teams ?? []).map((t) => ({ division: d.name, team: t })),
    )
    const rosterByTeamId = new Map<number, FleaflickerImportPayload['rosters']['rosters'][number]>()
    for (const r of rosters.rosters ?? []) {
      rosterByTeamId.set(r.team.id, r)
    }

    const leagueSize = typeof lg.size === 'number' ? lg.size : teamsFlat.length
    const rosterSize = lg.rosterRequirements?.rosterSize ?? 40

    const sportNorm = normalizeToSupportedSport(sport === 'NFL' ? 'NFL' : sport)

    const normalizedRosters: NormalizedRoster[] = teamsFlat.map(({ team: t }) => {
      const rr = rosterByTeamId.get(t.id)
      const playerIds =
        rr?.players?.map((p) => String(p.proPlayer?.id ?? '')).filter(Boolean) ?? []
      const owner = t.owners?.[0]
      const w = t.recordOverall?.wins ?? 0
      const l = t.recordOverall?.losses ?? 0
      const ties = t.recordOverall?.ties ?? 0

      return {
        source_team_id: String(t.id),
        source_manager_id: owner ? String(owner.id) : String(t.id),
        owner_name: owner?.displayName ?? t.name,
        team_name: t.name,
        avatar_url: t.logoUrl ?? null,
        wins: w,
        losses: l,
        ties,
        points_for: t.pointsFor?.value ?? 0,
        points_against: t.pointsAgainst?.value ?? undefined,
        player_ids: playerIds,
        starter_ids: [],
        reserve_ids: [],
        taxi_ids: [],
        faab_remaining: t.waiverAcquisitionBudget?.value ?? null,
        waiver_priority: null,
        /*
         * Per-team, because that is the unit a writer preserves. Fleaflicker reads every
         * roster in ONE request, so a failure is all-or-nothing and every team carries the
         * same status — unlike Yahoo, where it is genuinely per-team.
         */
        fetch_status: rostersAreAuthoritative
          ? (playerIds.length > 0 ? ('fetched' as const) : ('fetched_empty' as const))
          : rostersStatus,
        observed_at: rostersAreAuthoritative ? observedAt : null,
      }
    })

    const player_map: NormalizedImportResult['player_map'] = {}
    for (const r of rosters.rosters ?? []) {
      for (const p of r.players ?? []) {
        const id = String(p.proPlayer?.id ?? '')
        if (!id) continue
        player_map[id] = {
          name: p.proPlayer?.nameFull ?? id,
          position: p.proPlayer?.position ?? '?',
          team: p.proPlayer?.nameShort ?? '',
        }
      }
    }

    const isDynasty = detectDynasty(lg)

    const result: NormalizedImportResult = {
      source,
      league: {
        name: lg.name,
        sport: sportNorm,
        season,
        leagueSize,
        rosterSize,
        scoring: lg.description ?? 'imported',
        isDynasty,
        league_type: isDynasty ? 'dynasty' : 'redraft',
        waiver_type: mapWaiverType(lg.waiverType),
        faab_budget: lg.defaultWaiverBudget ?? undefined,
        playoff_team_count: Math.max(2, Math.floor(leagueSize / 2)),
        settings: {
          fleaflicker: { leagueId: lg.id, season },
        },
      },
      rosters: normalizedRosters,
      scoring: null,
      schedule: [],
      draft_picks: [],
      transactions: [],
      standings: normalizedRosters.map((r, i) => ({
        source_team_id: r.source_team_id,
        rank: i + 1,
        wins: r.wins,
        losses: r.losses,
        ties: r.ties,
        points_for: r.points_for,
        points_against: r.points_against,
      })),
      player_map,
      league_branding: { avatar_url: lg.logoUrl ?? null, name: lg.name },
      coverage: {
        leagueSettings: { state: 'full' },
        /*
         * 🛑 COVERAGE MUST REPORT THE READ, NOT THE ROW COUNT. "Some team has players" was
         * true for a half-read league and false for a genuinely pre-draft one — backwards in
         * both directions. A failed read is `missing`, because nothing about the current
         * rosters was observed at all.
         */
        currentRosters: !rostersAreAuthoritative
          ? {
              state: 'missing',
              note: `Roster read did not succeed (${rostersStatus}); stored rosters were left unchanged.`,
            }
          : normalizedRosters.some((x) => x.player_ids.length > 0)
            ? { state: 'full' }
            : { state: 'partial', note: 'Roster players depend on FetchLeagueRosters' },
        historicalRosterSnapshots: { state: 'missing' },
        scoringSettings: { state: 'missing', note: 'Fleaflicker scoring rules not mapped in v1' },
        playoffSettings: { state: 'partial' },
        currentStandings: { state: 'full' },
        currentSchedule: { state: 'missing' },
        draftHistory: { state: 'missing' },
        tradeHistory: { state: 'missing' },
        previousSeasons: { state: 'missing' },
        playerIdentityMap: Object.keys(player_map).length > 0 ? { state: 'full' } : { state: 'partial' },
      },
    }

    return result
  },
}
