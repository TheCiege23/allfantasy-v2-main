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

    const teamsFlat = standings.divisions.flatMap((d) => d.teams.map((t) => ({ division: d.name, team: t })))
    const rosterByTeamId = new Map<number, FleaflickerImportPayload['rosters']['rosters'][number]>()
    for (const r of rosters.rosters ?? []) {
      rosterByTeamId.set(r.team.id, r)
    }

    const leagueSize = typeof lg.size === 'number' ? lg.size : teamsFlat.length
    // Import Certification Phase A: `rosterSize` is source-provided or unknown — never
    // a magic constant. The previous `?? 40` invented a roster size for every league
    // whose `FetchLeagueStandings` response omitted `rosterRequirements`, which then
    // flowed into `League.rosterSize` indistinguishable from a real value.
    const rosterSize = lg.rosterRequirements?.rosterSize ?? null

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
        // Import Certification Phase A: Fleaflicker's `FetchLeagueStandings` payload
        // exposes NO scoring format and NO scoring rules (see `fleaflicker/types.ts`).
        // This field previously carried `lg.description` — the league's free-text
        // description — into `League.scoring`, which is a different field entirely.
        // Unknown scoring is `null`; `coverage.scoringSettings` reports it as missing.
        scoring: null,
        isDynasty,
        league_type: isDynasty ? 'dynasty' : 'redraft',
        waiver_type: mapWaiverType(lg.waiverType),
        faab_budget: lg.defaultWaiverBudget ?? undefined,
        // Import Certification Phase A: Fleaflicker exposes no playoff-team count.
        // `playoff_team_count` is deliberately omitted (undefined) rather than
        // derived as `leagueSize / 2`, which was an invention with no source
        // evidence. Downstream (`LeaguePlayoffBootstrapService`,
        // `canonicalImportNormalizer`) already fills a documented default when the
        // field is absent — a labelled default is honest, a fabricated import is not.
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
        // Import Certification Phase A: `full` is no longer unconditional. With the
        // fabricated `?? 40` removed, a league whose response omits `rosterRequirements`
        // genuinely has no roster size, and Fleaflicker never exposes scoring — so the
        // settings we hold are incomplete and must say so.
        leagueSettings:
          rosterSize != null
            ? { state: 'full' }
            : {
                state: 'partial',
                note: 'Fleaflicker did not report a roster size for this league.',
              },
        currentRosters: normalizedRosters.some((x) => x.player_ids.length > 0) ? { state: 'full' } : { state: 'partial', note: 'Roster players depend on FetchLeagueRosters' },
        historicalRosterSnapshots: { state: 'missing' },
        scoringSettings: {
          state: 'missing',
          note: 'Fleaflicker’s public standings/rosters endpoints do not expose scoring format or rules.',
        },
        // Import Certification Phase A: was `partial`, which implied some real
        // playoff data had been imported. Nothing had — the only playoff value
        // produced was a fabricated team count, now removed.
        playoffSettings: {
          state: 'missing',
          note: 'Fleaflicker’s public endpoints do not expose playoff structure or playoff-team count.',
        },
        // Import Certification Phase A: downgraded from `full`. `rank` here is a
        // POSITIONAL index (`i + 1`) over teams flattened across divisions, not a
        // provider-reported standing. For a single-division league that ordering is
        // Fleaflicker's own and is right; across multiple divisions it interleaves them,
        // so the overall rank is derived rather than sourced. The win/loss and points
        // figures ARE real, which is why this is `partial` and not `missing`.
        //
        // The rank values themselves are deliberately left as-is: inventing a tiebreak
        // rule to "correct" them would be another fabrication, and
        // `NormalizedStandingsEntry.rank` is non-optional (see the Phase B note on the
        // shared ESPN/Yahoo/MFL rank fallback).
        currentStandings: {
          state: standings.divisions.length > 1 ? 'partial' : 'full',
          note:
            standings.divisions.length > 1
              ? 'Records and points are provider-reported, but overall rank is derived from division ordering, not reported by Fleaflicker.'
              : null,
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
