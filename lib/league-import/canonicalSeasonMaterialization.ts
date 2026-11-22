/**
 * Canonical imported-league lifecycle completion. Reads the `League` and
 * `LeagueTeam` rows already persisted by import, including Fantrax’s
 * period metadata in league settings.
 *
 * Scope, stated honestly: this does NOT touch the renewal engine
 * (`lib/redraft/renewal/**`) and does not create a second lifecycle
 * system. It materializes the exact same `RedraftSeason`/`RedraftRoster`
 * models the renewal engine already uses, so every downstream consumer
 * that reads those tables (Trade Decision OS today; potentially Waiver/
 * Draft/Playoff engines later) works identically whether a league was
 * created natively, drafted, renewed, or imported from any provider.
 */
import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { reconcileRosterRedraftLinks } from '@/lib/league-runtime/reconcileRosterRedraftLinks'
import { materializeRedraftRosterPlayersForLeague } from '@/lib/league-runtime/materializeRedraftRosterPlayers'
import { DAILY_SPORT_SEASON_SHAPE, playoffStartWeekFor, type DailySeasonSport } from '@/lib/sportConfig/dailySportSeasonShape'
import { SOCCER_CONFIG } from '@/lib/sportConfig/configs/soccer'
import { NCAAB_CONFIG } from '@/lib/sportConfig/configs/ncaab'
import { usesFantraxPeriodCalendar } from './fantrax/fantraxProSports'

/** Sports whose imported leagues get a season on the canonical tables. */
const MATERIALIZED_SPORTS = new Set<string>(['NFL', 'NCAAF', 'NBA', 'NHL', 'MLB'])

function isDailySeasonSport(sport: string): sport is DailySeasonSport {
  return Object.prototype.hasOwnProperty.call(DAILY_SPORT_SEASON_SHAPE, sport)
}

function positivePeriod(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function fantraxSeasonFields(league: { status: string | null; settings: unknown }, defaultWeeks: number) {
  const settings = league.settings as {
    current_week?: number
    fantrax_settings?: { lastPeriod?: number; firstPlayoffPeriod?: number } | null
  } | null
  const sourcePlayoffStart = positivePeriod(settings?.fantrax_settings?.firstPlayoffPeriod)
  const sourceCurrent = positivePeriod(settings?.current_week)
  const totalWeeks = Math.max(
    positivePeriod(settings?.fantrax_settings?.lastPeriod) ?? defaultWeeks,
    sourceCurrent ?? 1,
    sourcePlayoffStart ?? 1,
  )
  const status = league.status === 'complete' ? 'complete'
    : league.status === 'pre_draft' || league.status === 'off_season' ? 'setup'
    : 'in_season'
  return {
    status,
    totalWeeks,
    playoffStartWeek: sourcePlayoffStart ?? totalWeeks + 1,
    currentWeek: status === 'setup' ? 0 : status === 'complete' ? totalWeeks : sourceCurrent ?? 1,
  }
}

export interface CanonicalSeasonMaterializationResult {
  seasonId: string | null
  created: boolean
  rosterCount: number
  skippedReason?: 'LEAGUE_NOT_FOUND' | 'UNSUPPORTED_SPORT' | 'NO_TEAMS'
}

/**
 * Idempotent: a second call for the same league/season returns the existing
 * `RedraftSeason` id without creating a duplicate. Safe to call from any
 * import commit path (new or `allowUpdateExisting` re-commit) and to retry
 * after a partial failure. The import commit calls this as a best-effort
 * post-commit step.
 */
export async function materializeRedraftSeasonForImportedLeague(
  leagueId: string,
): Promise<CanonicalSeasonMaterializationResult> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, sport: true, platform: true, season: true, status: true, playoffStartWeek: true, settings: true },
  })
  if (!league) return { seasonId: null, created: false, rosterCount: 0, skippedReason: 'LEAGUE_NOT_FOUND' }

  const sport = normalizeToSupportedSport(league.sport)
  /*
   * ⚠ NHL AND MLB WERE LEFT OUT WHEN NBA JOINED (#2882), AND AN IMPORT WITHOUT A SEASON IS A LEAGUE WITH
   * NOTHING TO PLAY. No `RedraftSeason` means no season rosters, so lineups, scoring, waivers and the
   * standings Chimmy reads ("No standings are stored for this league") had nothing behind them — for
   * every imported NHL and MLB league, from 32 to 256 teams (Fantrax-scale simulation, 2026-11-07).
   * Native NHL and MLB leagues already play full seasons on these same tables.
   */
  const fantraxPeriodSeason = league.platform?.toLowerCase() === 'fantrax' && usesFantraxPeriodCalendar(sport)
  if (!fantraxPeriodSeason && !MATERIALIZED_SPORTS.has(sport)) {
    return { seasonId: null, created: false, rosterCount: 0, skippedReason: 'UNSUPPORTED_SPORT' }
  }
  const seasonYear = league.season ?? new Date().getFullYear()

  const existing = await prisma.redraftSeason.findUnique({
    where: { leagueId_season: { leagueId, season: seasonYear } },
  })
  if (existing && !fantraxPeriodSeason) {
    const rosterCount = await prisma.redraftRoster.count({ where: { seasonId: existing.id } })
    /*
     * 🛑 THE ALREADY-MATERIALISED PATH NEEDS THE PLAYERS TOO, AND THIS IS WHERE A FORWARD-ONLY FIX
     * WOULD HAVE FAILED. Every league whose season already exists returns here — which is all 3,039
     * empty rosters measured in production. Wiring the projection only into the create path below
     * would have fixed new imports and left every existing league exactly as broken, while looking
     * finished.
     *
     * Safe to run on this path because it is idempotent and create-only: a league that already has
     * its players does nothing but two reads, and one that lost them to a failed import gets them.
     */
    await materializeRedraftRosterPlayersForLeague(leagueId, { sport }).catch((e) => {
      console.warn(
        '[import] redraft roster player backfill failed on an existing season',
        JSON.stringify({ leagueId, error: e instanceof Error ? e.message : String(e) }),
      )
    })
    return { seasonId: existing.id, created: false, rosterCount }
  }

  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId },
    select: {
      id: true,
      ownerName: true,
      teamName: true,
      avatarUrl: true,
      platformUserId: true,
      wins: true,
      losses: true,
      ties: true,
      pointsFor: true,
      currentRank: true,
    },
  })
  if (teams.length === 0) {
    return { seasonId: null, created: false, rosterCount: 0, skippedReason: 'NO_TEAMS' }
  }

  // Real Sleeper/ESPN/etc. status vocabularies all include a 'complete'
  // value; anything else (in_season/pre_draft/drafting/unset) is treated
  // as an active, in-progress season — an imported league is, by
  // definition, already past setup/pre_draft in the source platform.
  const seasonStatus = league.status === 'complete' ? 'complete' : 'in_season'
  // The provider's playoff week when it states one. Otherwise football keeps its week 15, and a daily
  // sport takes its own season shape (what a native league of that sport plays): week 15 would end an
  // NBA, NHL or MLB season after 14 weeks, months before the real one does.
  const playoffStartWeek = league.playoffStartWeek ?? (isDailySeasonSport(sport) ? playoffStartWeekFor(sport) : 15)
  const totalWeeks = Math.max(playoffStartWeek - 1, 1)

  const defaultWeeks = sport === 'NCAAB' ? NCAAB_CONFIG.defaultSeasonWeeks : SOCCER_CONFIG.defaultSeasonWeeks
  const seasonFields = fantraxPeriodSeason ? fantraxSeasonFields(league, defaultWeeks) : {
    status: seasonStatus,
    totalWeeks,
    playoffStartWeek,
    currentWeek: seasonStatus === 'complete' ? totalWeeks : 1,
  }
  const seasonData = { leagueId, sport, season: seasonYear, ...seasonFields }
  const season = fantraxPeriodSeason
    ? await prisma.redraftSeason.upsert({
        where: { leagueId_season: { leagueId, season: seasonYear } },
        create: seasonData,
        update: seasonFields,
      })
    : await prisma.redraftSeason.create({ data: seasonData })

  const rosters = await Promise.all(
    teams.map((t) => {
      const data = {
        seasonId: season.id,
        leagueId,
        // The reconciler links a managerless roster by team using its source identity.
        ownerId: t.platformUserId || t.id,
        ownerName: t.ownerName,
        teamName: t.teamName,
        avatarUrl: t.avatarUrl,
        wins: t.wins ?? 0,
        losses: t.losses ?? 0,
        ties: t.ties ?? 0,
        pointsFor: t.pointsFor ?? 0,
        playoffSeed: t.currentRank ?? null,
      }
      return fantraxPeriodSeason
        ? prisma.redraftRoster.upsert({
            where: { seasonId_ownerId: { seasonId: season.id, ownerId: data.ownerId } },
            create: data,
            update: {},
          })
        : prisma.redraftRoster.create({ data })
    }),
  )

  /*
   * Link each `Roster` to the `RedraftRoster` just created for the same manager.
   *
   * This is the moment the correspondence first EXISTS — `Roster` rows were written during league
   * bootstrap, their redraft counterparts only now — so it is the earliest point the link can be
   * set at all. Note `ownerId` above uses the same `platformUserId || id` fallback that
   * `bootstrapLeagueFromNormalizedImport` uses for `Roster.platformUserId`, which is exactly why
   * the two resolve to each other here.
   *
   * ⚠ AN OPTIMIZATION, NOT THE GUARANTEE. `resolveRedraftRosterId` reconciles lazily on the read
   * path, so a league that never passes through this function still resolves the first time
   * something needs it. Enforcing the invariant in one place and warming it here is deliberate:
   * the alternative is the same write copied across twelve `Roster` and eight `RedraftRoster`
   * creation sites, where the next site added silently breaks it.
   *
   * Non-fatal on purpose. A failed reconcile must not fail an import — the lazy path will catch it,
   * and a league that imported is worth more than a link that can be recomputed.
   */
  await reconcileRosterRedraftLinks(leagueId).catch((e) => {
    console.warn(
      '[import] roster link reconcile failed; lazy resolution will retry',
      JSON.stringify({ leagueId, error: e instanceof Error ? e.message : String(e) }),
    )
  })

  /*
   * 🛑 AND GIVE THOSE ROSTERS THEIR PLAYERS, WHICH THIS FUNCTION HAS NEVER DONE.
   *
   * It creates a `RedraftRoster` per team and stopped there. Every writer of `RedraftRosterPlayer`
   * is a transaction path — draft finalisation, waivers, keeper carryover — and none of those runs
   * on an imported league, so an imported roster was materialised empty and stayed empty. Measured
   * on production 2026-09-04: 3,039 of 3,130 redraft rosters (97%) had no players, including 100%
   * of guillotine, zombie and survivor leagues.
   *
   * That is why the trade console could not price a deal. `captureSnapshot` builds its team profile
   * from `roster.players` and reads their positions to judge depth; with none it produces no
   * profile and the verdict degrades to "we could not price enough of this deal". Nothing was wrong
   * with the valuation — there was nothing to value.
   *
   * Non-fatal, like the reconcile above: a league that imported is worth more than a projection
   * that can be re-run, and this is idempotent so a retry costs nothing.
   */
  await materializeRedraftRosterPlayersForLeague(leagueId, { sport }).catch((e) => {
    console.warn(
      '[import] redraft roster player materialization failed',
      JSON.stringify({ leagueId, error: e instanceof Error ? e.message : String(e) }),
    )
  })

  return { seasonId: season.id, created: !existing, rosterCount: rosters.length }
}
