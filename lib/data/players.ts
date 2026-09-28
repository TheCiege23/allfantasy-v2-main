import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { DATA_TTLS, isFreshDate, triggerBackgroundRefresh } from '@/lib/data/shared'
import { currentSeasonReportWhere } from '@/lib/injuries/injuryRecency'
import { runInjuryImporter } from '@/lib/workers/injury-importer'
import { runNewsImporter } from '@/lib/workers/news-importer'
import { runSportsDataImporter } from '@/lib/workers/sports-data-importer'
import { requestPlayerImportRefresh } from '@/lib/workers/sports-data-import-coordinator'

/**
 * One player record by id.
 *
 * `sport` is the caller's league sport, when it knows it — used only to read a BARE provider id
 * (see below). Omit it and a bare id is read as given and never guessed into a sport.
 */
export async function getPlayer(playerId: string, opts: { sport?: string | null } = {}) {
  const id = playerId.trim()
  let row = await prisma.sportsPlayerRecord.findUnique({ where: { id } })
  /*
   * 🛑 A BARE PROVIDER ID IS A KEY IN ANOTHER SPACE, NOT A MISSING PLAYER (2026-09-25).
   * Records are keyed `<SPORT>:<sleeperId>` (SleeperPlayerSeedService writes `${sport}:${player.playerId}`),
   * but roster screens carry the BARE Sleeper id — the Trade Center sends `4984`, never `NFL:4984`.
   * Every such lookup missed, and every miss queued a whole-sport importer run: one per Trade Center
   * analysis in a Sleeper league (throttled to one per five minutes), measured on the test DB as
   * `get_player_miss` in the dev log. The prefixed key is tried before a miss is declared.
   *
   * ⚠ ONLY UNDER A SPORT THE CALLER NAMED. Each sport's provider ids are their own namespace, so a
   * bare `1308` guessed as `NFL:1308` can be a DIFFERENT player from an NBA roster's `1308` — a
   * confident wrong row where a miss used to be. No sport, no guess.
   */
  const sport = normalizeToSupportedSport(opts.sport ?? (id.includes(':') ? id.split(':')[0] : undefined))
  if (!row && id && !id.includes(':') && opts.sport) {
    row = await prisma.sportsPlayerRecord.findUnique({ where: { id: `${sport}:${id}` } })
  }
  if (!row) {
    /*
     * ── 🛑 A CACHE MISS USED TO RUN THE ENTIRE IMPORTER ON THE CUSTOMER'S REQUEST ────────────
     *
     * This awaited `runSportsDataImporter({ sports: [sport] })` inline. A previous session
     * MEASURED that at 90-190s per sport and built
     * `lib/workers/sports-data-import-coordinator.ts` specifically for these three miss paths —
     * then never wired it. The coordinator had zero callers; the comment at the top of it names
     * `getPlayer()`/`searchPlayers()` as the reason it exists.
     *
     * That is the trade console taking 30s to two minutes: `runTradeConsoleAnalysis` calls
     * `getPlayer` once per asset in a sequential loop, so a deal containing two players the table
     * does not know could serialise two full imports behind one click.
     *
     * `requestPlayerImportRefresh` is fire-and-forget, single-flight per sport, and suppressed for
     * five minutes after an attempt, so a miss now costs one extra query rather than a provider
     * round trip.
     *
     * ⚠ THE RETURN CHANGES, AND CALLERS MUST HANDLE IT. A miss now returns null instead of
     * blocking until the import can answer. That is the intended trade: the row was not there
     * when the request arrived, and a caller who needs it is better served by "unknown" now than
     * by the correct answer three minutes later. `runTradeConsoleAnalysis` already treats a null
     * row as unresolved and reports the gap rather than inventing a price.
     */
    requestPlayerImportRefresh(sport, 'get_player_miss')
    return null
  }

  /*
   * ⚠ A STALE HIT NO LONGER IMPORTS FROM THE REQUEST PATH (2026-09-25). This ran
   * `runSportsDataImporter` in-process whenever the row was older than `DATA_TTLS.players` (6 h),
   * single-flighted only while it ran — no suppression window. Freshness belongs to the scheduled
   * `/api/cron/import-players`; and a record from a source the importer no longer writes stays stale
   * forever, so every hit on it re-ran the whole importer. Measured on the test DB 2026-09-25: 0 of
   * 21,668 NFL records were inside the 6 h window, so once bare ids started resolving, every Trade
   * Center analysis would have traded one throttled import for an unthrottled one.
   */
  return row
}

export async function searchPlayers(query: string, sport: string) {
  const normalizedSport = normalizeToSupportedSport(sport)
  let rows = await prisma.sportsPlayerRecord.findMany({
    where: {
      sport: normalizedSport,
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { team: { equals: query.toUpperCase() } },
      ],
    },
    orderBy: [{ lastUpdated: 'desc' }, { name: 'asc' }],
    take: 30,
  })

  if (rows.length === 0) {
    /*
     * Same inline import, same 90-190s, same coordinator — and worse here, because Phase 20 found
     * up to SIX parallel `searchPlayers()` calls from a single unified-orchestration request. The
     * coordinator's single-flight guard is what collapses those into one background import.
     *
     * ⚠ An empty result now means "we do not have this player indexed", not "no such player". The
     * refresh is requested, so the next lookup within the session can answer.
     */
    requestPlayerImportRefresh(normalizedSport, 'search_players_miss')
  } else if (!isFreshDate(rows[0]?.lastUpdated, DATA_TTLS.players)) {
    triggerBackgroundRefresh(`players:${normalizedSport}`, () => runSportsDataImporter({ sports: [normalizedSport] }))
  }

  return rows
}

export async function getPlayersByTeam(team: string, sport: string) {
  const normalizedSport = normalizeToSupportedSport(sport)
  let rows = await prisma.sportsPlayerRecord.findMany({
    where: {
      sport: normalizedSport,
      team: team.toUpperCase(),
    },
    orderBy: [{ lastUpdated: 'desc' }, { name: 'asc' }],
    take: 100,
  })

  if (rows.length === 0) {
    // Third of the three miss paths the coordinator was built for, same reasoning as above.
    requestPlayerImportRefresh(normalizedSport, 'get_players_by_team_miss')
  } else if (!isFreshDate(rows[0]?.lastUpdated, DATA_TTLS.players)) {
    triggerBackgroundRefresh(`players-team:${normalizedSport}:${team}`, () => runSportsDataImporter({ sports: [normalizedSport] }))
  }

  return rows
}

/**
 * ⚠ NOT THE CANONICAL INJURY READ. `lib/injuries/injuryReadPort` is — it reads
 * `SportsInjury` (refreshed every 30 minutes), returns one row per player with the
 * freshest source winning, and REPORTS staleness rather than hiding it. Most
 * callers have already moved; `app/api/start-sit/injuries` keeps this only as a
 * fallback when the port returns nothing.
 *
 * 🛑 BOUNDED TO THE CURRENT SEASON AT THE SOURCE, ON PURPOSE. This had no recency
 * filter of its own, and `injury_reports` has no scheduled writer outside NFL —
 * NBA, NHL, MLB and NCAAB were all last written 2026-04-26, measured 135 days
 * stale on 2026-09-09 (see lib/injuries/injuryRecency.ts). Every caller was
 * therefore expected to remember to filter, and the one that did wrote its own
 * horizon inline. Bounding it here means a new caller cannot be handed last
 * season by accident — the failure mode was silent, since an April "Out" is a
 * perfectly well-formed row.
 */
export async function getInjuryReport(sport: string, week?: number) {
  const normalizedSport = normalizeToSupportedSport(sport)
  const where = {
    sport: normalizedSport,
    ...currentSeasonReportWhere(),
    ...(typeof week === 'number' ? { week } : {}),
  }
  const rows = await prisma.injuryReportRecord.findMany({
    where,
    orderBy: { reportDate: 'desc' },
    take: 250,
  })

  /*
   * ⚠ NON-BLOCKING ON A MISS, AND THE BOUND ABOVE IS WHY THAT HAD TO CHANGE.
   *
   * A miss used to `await runInjuryImporter(...)` and re-read. That was safe only
   * because the unbounded read almost never missed — for NBA, NHL and MLB it
   * returned last April's rows and the importer was never reached. Bounding the
   * read makes those sports MISS on every call, which would have turned a silent
   * staleness bug into a synchronous provider fanout on a request path, once per
   * request, for exactly the sports nothing writes.
   *
   * `triggerBackgroundRefresh` dedupes by key, so a burst collapses to one import,
   * and this matches how every sibling in this file already handles a miss. The
   * caller gets an honest empty list meanwhile — and its own primary source is the
   * canonical port, which is current to the half-hour.
   *
   * Cold and stale are therefore the same instruction now: go and refresh, answer
   * with what is genuinely on hand.
   */
  if (rows.length === 0 || !isFreshDate(rows[0]?.reportDate, DATA_TTLS.injuries)) {
    triggerBackgroundRefresh(`injuries:${normalizedSport}:${week ?? 'all'}`, () =>
      runInjuryImporter({ sports: [normalizedSport], week })
    )
  }

  return rows
}

export async function getPlayerNews(playerId: string, limit: number = 10) {
  let rows = await prisma.playerNewsRecord.findMany({
    where: {
      OR: [{ playerId }, { playerName: { contains: playerId, mode: 'insensitive' } }],
    },
    orderBy: { publishedAt: 'desc' },
    take: limit,
  })

  if (rows.length === 0) {
    await runNewsImporter()
    rows = await prisma.playerNewsRecord.findMany({
      where: {
        OR: [{ playerId }, { playerName: { contains: playerId, mode: 'insensitive' } }],
      },
      orderBy: { publishedAt: 'desc' },
      take: limit,
    })
  } else if (!isFreshDate(rows[0]?.publishedAt, DATA_TTLS.news)) {
    triggerBackgroundRefresh(`player-news:${playerId}`, () => runNewsImporter())
  }

  return rows
}
