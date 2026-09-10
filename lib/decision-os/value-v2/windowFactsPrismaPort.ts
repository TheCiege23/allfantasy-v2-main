import type { PrismaClient } from '@prisma/client'
import type {
  AllPlayRecord, InjuryLoad, RestOfSeasonStrength, StoredDynastyProjection, StoredForecast,
  TeamIdentity, WindowFactsPort, WindowFactsScope,
} from './windowFacts'

/**
 * The Prisma implementation of `WindowFactsPort`.
 *
 * Reads only models that already exist. Nothing here writes, and nothing here
 * calls a provider. Every field this port cannot source is returned as null so
 * the assembler refuses with a named gap, rather than being filled with a
 * plausible number.
 *
 * Models read:
 *   `WeeklyMatchup`               — record and all-play, per week
 *   `LeagueTeam`                  — team and manager identity
 *   `SeasonForecastSnapshot`      — playoff probability, per week
 *   `DynastyProjectionSnapshot`   — 3-year and next-year strength, timeline
 *   `SportsPlayer` (via F2.3)     — injury availability
 *
 * ⚠ `WeeklyMatchup.leagueId` HOLDS THE PLATFORM LEAGUE ID, NOT `League.id`.
 * `lib/core-app/allPlay.ts` carries the same warning. A caller that passes the
 * AllFantasy league id into the matchup query gets zero rows and a team that
 * looks like it has never played, so the platform id is a separate, required
 * input here rather than something inferred.
 */

export interface WindowFactsPrismaDeps {
  prisma: PrismaClient
  /** `WeeklyMatchup.leagueId`. Distinct from the AllFantasy `League.id` in scope. */
  platformLeagueId: string | null
  sport: string
  /** Canonical roster player ids, for the F2.3 injury read. */
  rosterPlayerIds: readonly string[]
  /**
   * F2.3 availability categories by player id. Injected so this port stays a
   * pure Prisma seam and the injury feed choice stays in one place.
   */
  loadAvailability: (sport: string, ids: string[]) => Promise<Map<string, string>>
  /**
   * REDRAFT rest-of-season strength, injected for the same reason `loadAvailability` is.
   *
   * ⚠ IT LIVES OUTSIDE THIS PORT BECAUSE THE SEASON CONTEXT DOES. A rest-of-season share is
   * league-relative, so computing it needs every team's roster for a specific `RedraftSeason` —
   * an id this port has never been given and should not start guessing at from `scope`. The
   * caller that already resolved the season supplies the loader; absent one, the port answers
   * null and the assembler refuses with `rest_of_season_projection_missing` rather than
   * pretending the format is unsupported.
   */
  loadRestOfSeason?: (scope: WindowFactsScope) => Promise<RestOfSeasonStrength | null>
}

/**
 * A read that FAILED, as distinct from one that found nothing.
 *
 * 🛑 EVERY READ IN THIS PORT USED TO SWALLOW ITS OWN ERROR AND RETURN AN EMPTY RESULT, WHICH
 * TURNED FIVE DATABASE FAILURES INTO FIVE CONFIDENT ABSENCES. A forecast query that threw came
 * back as `season_forecast_missing`; a matchup query that threw came back as a team that has
 * never played. Both are statements about the league made from no evidence at all, and neither is
 * distinguishable downstream from the real thing.
 *
 * The port no longer swallows. It names the stage and rethrows, so a caller can report WHICH read
 * failed instead of guessing, or reporting one broad gap for four different causes.
 */
export class WindowPortReadError extends Error {
  constructor(readonly stage: 'identity' | 'matchup' | 'forecast' | 'dynasty' | 'injury', cause: unknown) {
    super(`window port read failed at stage: ${stage}`)
    this.name = 'WindowPortReadError'
    this.cause = cause
  }
}

export const INJURY_BASIS = 'sportsplayer-availability-category:unavailable-share-of-covered-roster'

/** Categories `deriveAvailabilityCategory` can return. Only 'unavailable' counts against a team. */
const UNAVAILABLE = 'unavailable'
const UNRESOLVED = 'unknown'

function isoOrNull(d: Date | null | undefined): string | null {
  return d instanceof Date && Number.isFinite(d.getTime()) ? d.toISOString() : null
}

/**
 * All-play as of a week, from the weeks actually scored.
 *
 * This mirrors `getAllPlayBoard`'s arithmetic deliberately rather than calling
 * it: that function is `server-only`, returns the whole league board, and is
 * keyed to the current week. The window needs one team as of an ARBITRARY week,
 * which is what makes prior weekly classifications recoverable without storing
 * them. The week gate is the same — a week nobody scored has not been played,
 * and counting it would hand every team all-play ties and drag the spread flat.
 */
export function allPlayAsOfWeek(
  rows: readonly { rosterId: string; week: number; pointsFor: number; pointsAgainst: number; win: number | null }[],
  teamId: string,
  throughWeek: number,
): AllPlayRecord | null {
  const byWeek = new Map<number, typeof rows[number][]>()
  for (const r of rows) {
    if (r.week > throughWeek) continue
    const list = byWeek.get(r.week) ?? []
    list.push(r)
    byWeek.set(r.week, list)
  }

  let wins = 0, losses = 0, ties = 0, apw = 0, apl = 0, apt = 0, pf = 0, weeksCounted = 0

  for (const week of [...byWeek.keys()].sort((a, b) => a - b)) {
    const weekRows = byWeek.get(week)!
    const mine = weekRows.find(r => String(r.rosterId) === String(teamId))

    /*
     * 🛑 A ROW WITH `win === null` IS NOT A TIE, IT IS AN UNGRADED GAME. The previous shape was
     * `win === 1 → win`, `win === 0 && pointsFor !== pointsAgainst → loss`, `else → TIE`, so every
     * in-progress week, every bye and every row the ingester had not graded fell into the final
     * `else` and was recorded as a drawn game. That is not a cosmetic miscount: ties enter
     * `played`, `played` is the denominator of the luck adjustment, and half a phantom win per
     * ungraded week drags a genuine contender toward the middle every Sunday until the grade lands.
     *
     * ⚠ AND `weeksCounted` INCREMENTED BEFORE THE ROW WAS EVEN FOUND. A week in which this team
     * had no row at all — a bye, or a roster that joined late — still counted as a week it played,
     * on the strength of somebody else having scored. Both gates now hang off ONE condition: a
     * week counts for this team when THIS team has a completed, graded row in it.
     */
    const completed = mine != null && (mine.win === 1 || mine.win === 0)
    if (!completed) continue

    weeksCounted += 1
    pf += mine!.pointsFor

    if (mine!.win === 1) wins += 1
    else if (mine!.pointsFor === mine!.pointsAgainst) ties += 1
    else losses += 1

    /*
     * All-play compares only against teams that also COMPLETED this week. An opponent still on 0
     * points mid-Sunday is not a team this roster beat, and counting it inflates the all-play win
     * rate — which is the expected-wins term, so it would report a lucky team as unlucky.
     */
    for (const other of weekRows) {
      if (String(other.rosterId) === String(mine!.rosterId)) continue
      if (other.win !== 1 && other.win !== 0) continue
      if (mine!.pointsFor > other.pointsFor) apw += 1
      else if (mine!.pointsFor < other.pointsFor) apl += 1
      else apt += 1
    }
  }

  const played = wins + losses + ties
  if (weeksCounted === 0 || played === 0) return null
  const apPlayed = apw + apl + apt
  const expectedWins = apPlayed > 0 ? (apw / apPlayed) * played : 0
  return {
    wins, losses, ties,
    luckWins: Math.round((wins - expectedWins) * 10) / 10,
    weeksCounted,
    pointsFor: Math.round(pf * 100) / 100,
  }
}

/** Picks this team's forecast out of the stored `teamForecasts` payload. */
export function forecastForTeam(payload: unknown, teamId: string): number | null {
  if (!Array.isArray(payload)) return null
  const row = payload.find(r =>
    r && typeof r === 'object' && String((r as { teamId?: unknown }).teamId ?? '') === String(teamId))
  const pct = row && typeof row === 'object' ? (row as { playoffProbability?: unknown }).playoffProbability : null
  return typeof pct === 'number' && Number.isFinite(pct) ? pct : null
}

export function createWindowFactsPrismaPort(deps: WindowFactsPrismaDeps): WindowFactsPort {
  const { prisma, platformLeagueId, sport, rosterPlayerIds, loadAvailability } = deps

  return {
    async identity(scope: WindowFactsScope): Promise<TeamIdentity | null> {
      const team = await prisma.leagueTeam.findFirst({
        where: { leagueId: scope.leagueId, externalId: String(scope.teamId) },
        select: { externalId: true, teamName: true, ownerName: true },
      }).catch(e => { throw new WindowPortReadError('identity', e) })
      if (!team) return null
      return {
        teamId: String(team.externalId),
        teamName: team.teamName ?? null,
        managerName: team.ownerName ?? null,
        rosterSize: rosterPlayerIds.length,
      }
    },

    async allPlay(scope: WindowFactsScope): Promise<AllPlayRecord | null> {
      if (!platformLeagueId) return null
      const rows = await prisma.weeklyMatchup.findMany({
        where: { leagueId: platformLeagueId, seasonYear: scope.season, week: { lte: scope.week } },
        select: { rosterId: true, week: true, pointsFor: true, pointsAgainst: true, win: true },
        orderBy: { week: 'asc' },
      }).catch(e => { throw new WindowPortReadError('matchup', e) })
      if (!rows.length) return null
      return allPlayAsOfWeek(
        rows.map(r => ({ ...r, rosterId: String(r.rosterId) })),
        String(scope.teamId),
        scope.week,
      )
    },

    async forecast(scope: WindowFactsScope): Promise<StoredForecast | null> {
      // The most recent snapshot at or before the requested week. The assembler
      // decides whether that lag is acceptable; this only reports what exists.
      const row = await prisma.seasonForecastSnapshot.findFirst({
        where: { leagueId: scope.leagueId, season: scope.season, week: { lte: scope.week } },
        orderBy: { week: 'desc' },
        select: { season: true, week: true, teamForecasts: true, generatedAt: true },
      }).catch(e => { throw new WindowPortReadError('forecast', e) })
      if (!row) return null
      const pct = forecastForTeam(row.teamForecasts, scope.teamId)
      if (pct === null) return null
      return {
        season: row.season, week: row.week,
        playoffProbabilityPct: pct,
        generatedAt: isoOrNull(row.generatedAt),
      }
    },

    async dynasty(scope: WindowFactsScope): Promise<StoredDynastyProjection | null> {
      const row = await prisma.dynastyProjectionSnapshot.findFirst({
        where: { leagueId: scope.leagueId, teamId: String(scope.teamId), season: scope.season },
        select: {
          season: true, projectedStrength3Years: true, projectedStrengthNextYear: true,
          windowStartYear: true, windowEndYear: true, confidenceScore: true, generatedAt: true,
        },
      }).catch(e => { throw new WindowPortReadError('dynasty', e) })
      if (!row) return null
      return {
        season: row.season,
        projectedStrength3YearsPct: row.projectedStrength3Years,
        projectedStrengthNextYearPct: row.projectedStrengthNextYear ?? null,
        windowStartYear: row.windowStartYear ?? null,
        windowEndYear: row.windowEndYear ?? null,
        confidencePct: row.confidenceScore ?? null,
        generatedAt: isoOrNull(row.generatedAt),
      }
    },

    async injuries(): Promise<InjuryLoad | null> {
      const ids = rosterPlayerIds.filter(id => typeof id === 'string' && id.length > 0)
      if (!ids.length) return null
      const byId = await loadAvailability(sport, [...ids]).catch(e => { throw new WindowPortReadError('injury', e) })
      if (!byId) return null

      let covered = 0, unavailable = 0
      for (const id of ids) {
        const category = byId.get(id)
        if (!category || category === UNRESOLVED) continue
        covered += 1
        if (category === UNAVAILABLE) unavailable += 1
      }
      if (covered === 0) return null
      return {
        unavailableShare: unavailable / covered,
        basis: INJURY_BASIS,
        coverage: covered / ids.length,
        // The AF projection path applies injury designation to CONFIDENCE, not
        // to the projected points the forecast simulates, so the stored playoff
        // probability has not already priced this. See the audit's §5.2.
        treatment: 'excluded',
      }
    },

    /**
     * REDRAFT only, and delegated.
     *
     * Returning null when no loader was supplied is not a silent degrade: the assembler treats a
     * null rest-of-season as `rest_of_season_projection_missing` and refuses, so a redraft caller
     * that forgot to wire the loader gets a named refusal rather than a window built without it.
     */
    async restOfSeason(scope: WindowFactsScope): Promise<RestOfSeasonStrength | null> {
      return deps.loadRestOfSeason ? deps.loadRestOfSeason(scope) : null
    },
  }
}
