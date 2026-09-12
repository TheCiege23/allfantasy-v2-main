import type { ILeagueImportAdapter } from '../ILeagueImportAdapter'
import type { FleaflickerImportPayload } from '@/lib/league-import/fleaflicker/types'
import type { NormalizedImportResult, NormalizedRoster, SourceTracking } from '../../types'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import {
  normalizeFleaflickerScoringRules,
  summarizeFleaflickerRosterShape,
} from '@/lib/league-import/fleaflicker/fleaflickerScoringRules'

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

    /*
     * Scoring rules, from `FetchLeagueRules`. `raw.rules` is null when that call
     * failed — an enrichment, so the import proceeds and `coverage.scoringSettings`
     * says so honestly rather than claiming rules that were never read.
     */
    const scoringRules = normalizeFleaflickerScoringRules(raw.rules)
    const rosterShape = summarizeFleaflickerRosterShape(raw.rules)

    const leagueSize = typeof lg.size === 'number' ? lg.size : teamsFlat.length
    /*
     * ⚠ THE `?? 40` WAS A GUESS, AND `FetchLeagueRules` KNOWS THE ANSWER. The
     * standings league object carries `rosterRequirements.rosterSize` only
     * sometimes; the rules endpoint reports `maxRosterSize` outright (68 in the
     * committed fixture, against a hardcoded fallback of 40). Preferring the
     * provider's own number over a constant is the whole point of reading rules.
     * The 40 stays as the last resort for a league where NEITHER answered.
     */
    const rosterSize = lg.rosterRequirements?.rosterSize ?? rosterShape.maxRosterSize ?? 40

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
        /*
         * 🛑 THIS WAS `Math.max(2, Math.floor(leagueSize / 2))` — A FABRICATED NUMBER,
         * AND THE WORST KIND, BECAUSE IT IS USUALLY PLAUSIBLE. A 12-team league got 6,
         * which is the single most common real answer, so the invention was invisible
         * in exactly the leagues where anyone would have looked.
         *
         * It is not merely displayed. `lib/data/league-home.ts` does
         * `standings.slice(0, playoff.playoff_team_count)` to seed a bracket, so a
         * league that takes 4 or 8 rendered a six-team playoff picture drawn from
         * nothing but its roster count.
         *
         * ⚠ AND IT CANNOT BE REPLACED BY AN IMPORT, WHICH IS WHY IT IS `undefined`
         * RATHER THAN A BETTER FORMULA. No captured Fleaflicker endpoint carries a
         * playoff setting at all — measured against the committed fixtures:
         *   - FetchLeagueRules      67KB, 0 playoff-related leaf paths
         *   - FetchLeagueStandings  `league` object has 22 leaf paths, none playoff
         *   - FetchLeagueRosters    league configuration only
         * The ONLY playoff evidence Fleaflicker exposes is per-GAME `isPlayoffs` /
         * `isConsolation` on the scoreboard, which exists only once playoff games are
         * scheduled. For a league mid-regular-season the count is genuinely unknown,
         * and `undefined` is the honest answer. See G-09 in contracts/fleaflicker.
         *
         * ⚠ `recordPostseason` LOOKS like the shortcut and is not: it counts
         * CONSOLATION games. In the week-16 fixture the consolation bracket's teams
         * carry 2-1 and 1-1 postseason records, so counting teams with a non-zero
         * `recordPostseason` returns the whole playing field, not the playoff field.
         *
         * This now matches every sibling adapter — ESPN, MFL and Fantrax all pass
         * `undefined` when the provider does not say. `LeagueImportToExistingService`
         * maps that to `null`, and the consumers already treat absence as "unknown".
         */
        playoff_team_count: undefined,
        settings: {
          fleaflicker: {
            leagueId: lg.id,
            season,
            /* From FetchLeagueRules; null when it did not answer. */
            starters: rosterShape.starters,
            bench: rosterShape.bench,
          },
        },
      },
      rosters: normalizedRosters,
      /*
       * ⚠ `null` UNTIL 2026-09-12, and the coverage note said so in as many words.
       * Now populated from FetchLeagueRules. Still null when that call failed, so a
       * consumer can tell "no rules" from "rules we could not read" — the coverage
       * block below carries which.
       */
      scoring:
        scoringRules.length > 0
          ? {
              /*
               * ⚠ NULL, NOT A DERIVED GUESS, AND THE TYPE ASKS FOR EXACTLY THAT.
               * `scoring_format` is nullable on purpose — its own doc records that MFL
               * once assigned "standard" to every league that did not describe itself,
               * and a fabricated format is indistinguishable from a measured one.
               *
               * Fleaflicker's rules endpoint declares no format name. It is tempting to
               * derive PPR from whether receptions score, but this league's fixture
               * carries TWO `Catch` rules (one per catch AND one per two catches), so
               * even that reading is ambiguous here. A null flows into the coverage
               * block honestly; the RULES themselves are carried in full either way.
               */
              scoring_format: null,
              rules: scoringRules,
            }
          : null,
      schedule: [],
      draft_picks: [],
      transactions: [],
      /*
       * 🛑 `rank: i + 1` WAS ARRAY POSITION, NOT A RANKING, AND IT WOULD HAVE
       * FABRICATED A CHAMPIONSHIP. Whichever team happened to be first in the
       * response got rank 1 — in every league, every import, regardless of record.
       *
       * That was latent while nothing read it. It stops being latent the moment
       * legacy evidence covers this provider, because `deriveEvidenceRowsFromImport`
       * writes a `championships` row for every `rank === 1`. A synthetic rank there
       * is not a cosmetic wrong number: it awards a title to an arbitrary team, and
       * the aggregator cannot tell it from a real one.
       *
       * ⚠ AND FLEAFLICKER PUBLISHED THE REAL RANK ALL ALONG — on `recordOverall`,
       * which is why it was missed: the mapper already read `recordOverall.wins` and
       * `.losses` and stopped one field short. Confirmed in
       * contracts/fleaflicker/fixtures/scoreboard.NFL.2021.week16.json.
       *
       * The fallback is `teamsFlat.length` — LAST place — matching what the ESPN,
       * Yahoo, MFL and Fantrax adapters all do. An unknown rank must never be a
       * winning one.
       */
      standings: normalizedRosters.map((r, i) => ({
        source_team_id: r.source_team_id,
        rank: teamsFlat[i]?.team?.recordOverall?.rank ?? teamsFlat.length,
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
        scoringSettings:
            scoringRules.length > 0
              ? { state: 'full' }
              : raw.rules == null
                ? { state: 'missing', note: 'FetchLeagueRules did not answer for this league' }
                : { state: 'missing', note: 'FetchLeagueRules answered but declared no scoring rules' },
        /*
         * ⚠ WAS `{ state: 'partial' }`, WHICH WAS A CLAIM ABOUT THE FABRICATED NUMBER
         * ABOVE RATHER THAN ABOUT THE PROVIDER. "Partial" told a reader that some
         * playoff configuration had been imported and some had not. Nothing had been
         * imported: the count was computed from `leagueSize` and there is no playoff
         * field in any captured Fleaflicker payload. A coverage map that reports the
         * health of our own guess is worse than no coverage map.
         */
        playoffSettings: {
          state: 'missing',
          note: 'Fleaflicker exposes no playoff setting on any captured endpoint; only per-game isPlayoffs/isConsolation once the bracket is scheduled',
        },
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
