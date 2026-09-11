import type { ILeagueImportAdapter } from '../ILeagueImportAdapter'
import type { FleaflickerImportPayload } from '@/lib/league-import/fleaflicker/types'
import type { NormalizedImportResult, NormalizedRoster, SourceTracking } from '../../types'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

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
        currentRosters: normalizedRosters.some((x) => x.player_ids.length > 0) ? { state: 'full' } : { state: 'partial', note: 'Roster players depend on FetchLeagueRosters' },
        historicalRosterSnapshots: { state: 'missing' },
        scoringSettings: { state: 'missing', note: 'Fleaflicker scoring rules not mapped in v1' },
        playoffSettings: { state: 'partial' },
        /*
         * ⚠ MEASURED, NOT ASSERTED — AND `lg.size` IS WHAT MAKES THAT POSSIBLE.
         *
         * This was a bare `{ state: 'full' }`: an assertion that every team's
         * standing came across, made without looking. `standings` is derived
         * from `teamsFlat`, so its length is knowable, and `lg.size` is an
         * INDEPENDENT count from the league object — comparing the two is a real
         * completeness check rather than a tautology.
         *
         * ⚠ EXCEPT WHEN `lg.size` IS ABSENT, where `leagueSize` falls back to
         * `teamsFlat.length` and the comparison becomes circular — it would
         * always agree with itself and always say 'full'. That case reports
         * `partial` with a named reason instead, because "we could not verify"
         * and "we verified it is complete" are different answers and only one of
         * them should let a surface present the standings as whole.
         */
        currentStandings:
          normalizedRosters.length === 0
            ? { state: 'missing' }
            : typeof lg.size !== 'number'
              ? {
                  state: 'partial',
                  count: normalizedRosters.length,
                  note: 'Fleaflicker did not report a league size, so standings completeness could not be verified',
                }
              : normalizedRosters.length >= lg.size
                ? { state: 'full', count: normalizedRosters.length }
                : {
                    state: 'partial',
                    count: normalizedRosters.length,
                    note: `Standings cover ${normalizedRosters.length} of ${lg.size} teams`,
                  },
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
