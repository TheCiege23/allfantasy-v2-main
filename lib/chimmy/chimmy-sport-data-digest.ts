import 'server-only'

import { prisma } from '@/lib/prisma'
import { getLatestNews } from '@/lib/data/news'
import { listInjuryFacts } from '@/lib/injuries/injuryReadPort'
import { getNewsApiEverythingDbFirst } from '@/lib/news/newsapi-cache'
import { SUPPORTED_SPORTS, type SupportedSport } from '@/lib/sport-scope'

const NL = String.fromCharCode(10)

const SPORT_NEWS_QUERY: Record<SupportedSport, string> = {
  NFL: '(NFL OR "fantasy football") AND (injury OR trade OR lineup)',
  NBA: '(NBA OR "fantasy basketball") AND (injury OR trade OR lineup)',
  NHL: '(NHL OR "fantasy hockey") AND (injury OR trade OR lineup)',
  MLB: '(MLB OR "fantasy baseball") AND (injury OR trade OR lineup)',
  NCAAF: '("college football" OR NCAAF OR CFB) AND (injury OR depth chart)',
  NCAAB: '("college basketball" OR NCAAB OR CBB) AND (injury OR lineup)',
  SOCCER: '(soccer OR MLS OR UEFA) AND (injury OR suspension)',
}

export type ChimmyDataDigest = {
  text: string
  sources: string[]
  freshness: {
    overallLastSyncedAt: string | null
    perSource: Record<string, string | null>
  }
  readiness: Record<string, {
    hasSchedules: boolean
    hasLiveScores: boolean
    hasStandings: boolean
    hasInjuries: boolean
    hasNews: boolean
    hasPlayerStats: boolean
    hasRankings: boolean
    missingData: string[]
  }>
}

/**
 * Deterministic injury + player-news rows (fed by Rolling Insights / API chain / importers) plus optional NewsAPI lines.
 */
export async function buildChimmySportDataDigest(args: {
  sport: SupportedSport | 'all'
  question?: string
  timezone?: string
  includeNewsApi?: boolean
}): Promise<ChimmyDataDigest> {
  const sources: string[] = []
  const chunks: string[] = []
  const sourceFreshness: Record<string, string | null> = {}
  const readiness: ChimmyDataDigest['readiness'] = {}
  const questionLower = String(args.question ?? '').toLowerCase()
  const timezone = args.timezone ?? 'America/New_York'
  const now = new Date()
  const lookback = new Date(now.getTime() - 48 * 60 * 60 * 1000)
  const lookahead = new Date(now.getTime() + 72 * 60 * 60 * 1000)

  const sports: SupportedSport[] =
    args.sport === 'all' ? [...SUPPORTED_SPORTS] : [args.sport]

  const wantsGames =
    questionLower.length === 0 ||
    /\b(game|games|tonight|today|schedule|scores?|final|playoff|series|record|standing|standings|draft)\b/.test(
      questionLower
    )
  const wantsTransactions =
    questionLower.length === 0 || /\b(trade|signed|signing|waived|waiver|released|transaction)\b/.test(questionLower)
  const wantsPlayerStats =
    questionLower.length === 0 || /\b(points?|stats?|yards?|rebounds?|assists?|goals?|historic|history)\b/.test(questionLower)

  const formatEt = (date: Date | null | undefined): string => {
    if (!date) return 'TBD'
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(date)
    } catch {
      return date.toISOString()
    }
  }

  const extractPlayerMentions = (input: string): string[] => {
    if (!input) return []
    const tokens = input
      .split(/\s+/)
      .map((t) => t.replace(/[^a-zA-Z'.-]/g, ''))
      .filter(Boolean)
    const out: string[] = []
    for (let i = 0; i < tokens.length - 1; i += 1) {
      const a = tokens[i] ?? ''
      const b = tokens[i + 1] ?? ''
      if (/^[A-Z]/.test(a) && /^[A-Z]/.test(b) && a.length > 1 && b.length > 1) {
        const name = `${a} ${b}`
        if (!out.includes(name)) out.push(name)
      }
    }
    return out.slice(0, 6)
  }
  const playerMentions = extractPlayerMentions(args.question ?? '')

  const toIso = (value: Date | string | null | undefined): string | null => {
    if (!value) return null
    const stamp = value instanceof Date ? value.getTime() : new Date(value).getTime()
    if (!Number.isFinite(stamp)) return null
    return new Date(stamp).toISOString()
  }

  const maxIso = (values: Array<Date | string | null | undefined>): string | null => {
    let max = 0
    for (const value of values) {
      if (!value) continue
      const stamp = value instanceof Date ? value.getTime() : new Date(value).getTime()
      if (Number.isFinite(stamp) && stamp > max) {
        max = stamp
      }
    }
    return max > 0 ? new Date(max).toISOString() : null
  }

  const setSourceFreshness = (sourceKey: string, values: Array<Date | string | null | undefined>) => {
    sourceFreshness[sourceKey] = maxIso(values)
  }

  const ensureReadiness = (sport: SupportedSport) => {
    readiness[sport] ??= {
      hasSchedules: false,
      hasLiveScores: false,
      hasStandings: false,
      hasInjuries: false,
      hasNews: false,
      hasPlayerStats: false,
      hasRankings: false,
      missingData: [],
    }
    return readiness[sport]
  }

  for (const sp of sports) {
    const sportReady = ensureReadiness(sp)
    const [newsRows, injRows, gameRows, standingsRows, transactionRows] = await Promise.all([
      getLatestNews(sp, args.sport === 'all' ? 8 : 20),
      // The canonical injury read port: TTL-respected, one row per player,
      // freshest source wins, and it reports its own staleness.
      //
      // This previously called getInjuryReport, which reads injury_report_records
      // and only refreshes when that table is EMPTY. It has not been empty since
      // April, so Chimmy was handed 108-day-old designations with no date on them
      // and stated them as current, while the live feed sat one table away.
      // A fallback written for absence does nothing about staleness.
      listInjuryFacts({ sport: sp, limit: args.sport === 'all' ? 12 : 35 }),
      wantsGames
        ? prisma.sportsGame.findMany({
            where: {
              sport: sp,
              startTime: {
                gte: lookback,
                lte: lookahead,
              },
            },
            orderBy: { startTime: 'asc' },
            take: args.sport === 'all' ? 8 : 12,
          })
        : Promise.resolve([]),
      wantsGames
        ? prisma.sportsDataCache.findMany({
            where: {
              OR: [
                { cacheKey: { contains: `${sp}:standings:` } },
                { cacheKey: { contains: `${sp.toLowerCase()}:standings:` } },
              ],
              expiresAt: { gte: now },
            },
            take: 40,
          })
        : Promise.resolve([]),
      wantsTransactions
        ? prisma.sportsNews.findMany({
            where: {
              sport: sp,
              OR: [
                { title: { contains: 'trade', mode: 'insensitive' } },
                { title: { contains: 'signed', mode: 'insensitive' } },
                { title: { contains: 'waive', mode: 'insensitive' } },
                { title: { contains: 'release', mode: 'insensitive' } },
              ],
            },
            orderBy: { publishedAt: 'desc' },
            take: args.sport === 'all' ? 6 : 10,
          })
        : Promise.resolve([]),
    ])

    if (gameRows.length) {
      sportReady.hasSchedules = true
      sportReady.hasLiveScores = true
      const sourceKey = `games_${sp}`
      sources.push(sourceKey)
      setSourceFreshness(sourceKey, gameRows.map((g) => g.updatedAt ?? g.startTime))
      chunks.push(
        `### ${sp} — Upcoming/recent games (DB)
${gameRows
  .map(
    (g) =>
      `- ${g.awayTeam} @ ${g.homeTeam} — ${g.awayScore ?? '-'}-${g.homeScore ?? '-'} (${g.status ?? 'Scheduled'}) · ${formatEt(g.startTime)}`
  )
  .join('\n')}`
      )
    }

    if (standingsRows.length) {
      sportReady.hasStandings = true
      const parsed = standingsRows
        .map((row) => {
          const data = row.data as Record<string, unknown>
          const teamName = String(data.teamName ?? data.team ?? '')
          const rank = typeof data.position === 'number' ? data.position : null
          const points = typeof data.points === 'number' ? data.points : null
          const won = typeof data.won === 'number' ? data.won : null
          const lost = typeof data.lost === 'number' ? data.lost : null
          if (!teamName) return null
          return { teamName, rank, points, won, lost }
        })
        .filter((r): r is { teamName: string; rank: number | null; points: number | null; won: number | null; lost: number | null } => Boolean(r))
        .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
        .slice(0, args.sport === 'all' ? 4 : 8)

      if (parsed.length) {
        const sourceKey = `standings_${sp}`
        sources.push(sourceKey)
        setSourceFreshness(
          sourceKey,
          standingsRows.map((row) => {
            const cacheRow = row as typeof row & { updatedAt?: Date | string | null }
            return cacheRow.updatedAt ?? row.createdAt ?? row.expiresAt
          })
        )
        chunks.push(
          `### ${sp} — Standings snapshot (DB)
${parsed
  .map(
    (row) =>
      `- #${row.rank ?? '?'} ${row.teamName}${row.points != null ? ` · pts ${row.points}` : ''}${
        row.won != null || row.lost != null ? ` · W-L ${row.won ?? '?'}-${row.lost ?? '?'}` : ''
      }`
  )
  .join('\n')}`
        )
      }
    }

    if (newsRows.length) {
      sportReady.hasNews = true
      const sourceKey = `player_news_${sp}`
      sources.push(sourceKey)
      setSourceFreshness(sourceKey, newsRows.map((n) => n.publishedAt))
      chunks.push(
        `### ${sp} — Player news (DB / sports ingest)\n${newsRows
          .slice(0, args.sport === 'all' ? 6 : 15)
          .map(
            (n) =>
              `- ${n.headline}${n.playerName ? ` — ${n.playerName}` : ''}${n.team ? ` (${n.team})` : ''} [${n.source}] ${n.publishedAt.toISOString().slice(0, 10)}`
          )
          .join('\n')}`
      )
    } else {
      const legacyNewsRows = await prisma.sportsNews.findMany({
        where: { sport: sp },
        orderBy: { publishedAt: 'desc' },
        take: args.sport === 'all' ? 6 : 15,
      })
      if (legacyNewsRows.length) {
        sportReady.hasNews = true
        const sourceKey = `sports_news_${sp}`
        sources.push(sourceKey)
        setSourceFreshness(sourceKey, legacyNewsRows.map((n) => n.publishedAt ?? n.fetchedAt ?? n.updatedAt))
        chunks.push(
          `### ${sp} - Sports news (DB cache)\n${legacyNewsRows
            .map(
              (n) =>
                `- ${n.title}${n.playerName ? ` - ${n.playerName}` : ''}${n.team ? ` (${n.team})` : ''} [${n.source}] ${
                  n.publishedAt ? n.publishedAt.toISOString().slice(0, 10) : 'recent'
                }`
            )
            .join('\n')}`
        )
      }
    }

    // Injuries are rendered ONLY when the feed is alive, and every line carries
    // its own age. A stale designation is a confident false statement about a
    // real player's availability — worse than saying nothing, because the model
    // has no way to tell it is old and will present it as today's news.
    //
    // When the feed is stale or empty we say so and mark the category missing,
    // rather than reaching for the older table. Falling back to staler data is
    // what produced the three-month-old report in the first place.
    const injuryFacts = injRows.facts ?? []
    const freshInjuries = injuryFacts.filter((f) => !f.stale)

    if (freshInjuries.length > 0) {
      sportReady.hasInjuries = true
      const sourceKey = `injury_facts_${sp}`
      sources.push(sourceKey)
      setSourceFreshness(sourceKey, freshInjuries.map((f) => f.fetchedAt))
      const newestIso = injRows.newestFetchedAt
        ? injRows.newestFetchedAt.toISOString().slice(0, 10)
        : 'unknown'
      chunks.push(
        `### ${sp} — Injury report (live feed, newest ${newestIso})
${freshInjuries
          .slice(0, args.sport === 'all' ? 12 : 35)
          .map((f) => {
            const age = f.ageHours < 24
              ? `${Math.max(0, Math.round(f.ageHours))}h ago`
              : `${Math.round(f.ageHours / 24)}d ago`
            // A null status means no designation was stated. It does NOT mean
            // healthy, and must not be rendered as though it did.
            const status = f.status ?? 'no designation stated'
            const detail = f.description ? ` — ${String(f.description).slice(0, 120)}` : ''
            const part = f.type ? ` [${f.type}]` : ''
            return `- ${f.playerName}${f.team ? ` (${f.team})` : ''}: ${status}${part}${detail} (reported ${age})`
          })
          .join(NL)}`
      )
    } else {
      const reason = injuryFacts.length > 0
        ? 'every row in the feed is past its freshness window'
        : 'no live injury feed for this sport'
      chunks.push(
        `### ${sp} — Injury report
UNAVAILABLE: ${reason}. Do not state or imply any player's injury status for ${sp}; say the feed is unavailable instead.`
      )
    }

    // Game weather. The forecast pipeline exists and runs — /api/weather/refresh-cron
    // every three hours, OpenWeatherMap key verified live — but nothing in the
    // Chimmy path ever read it, so the assistant could not answer "is it going to
    // be windy in Buffalo" despite the row sitting in the database.
    //
    // Only unexpired rows are used. A lapsed forecast is not a forecast, and the
    // read paths that honour expiresAt are the reason the TTL had to be raised to
    // outlive the refresh cadence.
    if (wantsGames) {
      const weatherRows = await prisma.weatherCache
        .findMany({
          where: { sport: sp, expiresAt: { gt: now } },
          orderBy: { forecastForTime: 'asc' },
          take: args.sport === 'all' ? 4 : 10,
        })
        .catch(() => [] as Array<Record<string, unknown>>)

      if (weatherRows.length) {
        const sourceKey = `weather_${sp}`
        sources.push(sourceKey)
        setSourceFreshness(sourceKey, weatherRows.map((w: any) => w.fetchedAt))
        chunks.push(
          `### ${sp} — Game weather (forecast)${NL}${weatherRows
            .map((w: any) => {
              const indoors = Boolean(w.isIndoor || w.isDome || w.roofClosed)
              if (indoors) {
                // Stating the roof matters more than the number: an indoor game
                // has no weather effect, and quoting a temperature invites one.
                return `- ${w.cacheKey ?? 'venue'}: indoors — weather not a factor`
              }
              const bits: string[] = []
              if (typeof w.temperatureF === 'number') bits.push(`${Math.round(w.temperatureF)}F`)
              if (w.conditionLabel) bits.push(String(w.conditionLabel))
              if (typeof w.windSpeedMph === 'number') bits.push(`wind ${Math.round(w.windSpeedMph)}mph`)
              if (typeof w.precipChancePct === 'number') bits.push(`precip ${Math.round(w.precipChancePct)}%`)
              const when = w.forecastForTime ? formatEt(new Date(w.forecastForTime)) : 'time TBD'
              return `- ${w.cacheKey ?? 'venue'} (${when}): ${bits.length ? bits.join(', ') : 'no readings'}`
            })
            .join(NL)}`
        )
      }
    }

    if (transactionRows.length) {
      const sourceKey = `transactions_${sp}`
      sources.push(sourceKey)
      setSourceFreshness(sourceKey, transactionRows.map((n) => n.publishedAt ?? n.updatedAt))
      chunks.push(
        `### ${sp} — Transactions (DB news ingest)
${transactionRows
  .map(
    (n) =>
      `- ${n.title}${n.playerName ? ` — ${n.playerName}` : ''}${n.team ? ` (${n.team})` : ''} [${n.source}] ${
        n.publishedAt ? n.publishedAt.toISOString().slice(0, 10) : 'recent'
      }`
  )
  .join('\n')}`
      )
    }

    if (wantsPlayerStats && playerMentions.length > 0) {
      const playerStatsRows = await prisma.playerSeasonStats.findMany({
        where: {
          sport: sp,
          OR: playerMentions.map((name) => ({
            playerName: { contains: name, mode: 'insensitive' },
          })),
        },
        orderBy: [{ season: 'desc' }, { updatedAt: 'desc' }],
        take: args.sport === 'all' ? 6 : 10,
      })

      // player_season_stats holds NFL only (5,186 rows; zero for any other
      // sport). College season stats live in fantasy_stat_lines — 5,530 NCAAF
      // rows loaded from CFBD — where the player NAME is inside the stats JSON
      // rather than a column, which is why a name query against the first table
      // silently returned nothing for college and Chimmy reported no stats.
      let fallbackStatChunk: string | null = null
      let fallbackStatDates: Array<Date | null> = []
      if (playerStatsRows.length === 0) {
        // The JSON name filter is case-sensitive in Postgres and stored names
        // are Title Case, while mentions arrive as the user typed them.
        // Normalising the whole word — not just its first letter — is what lets
        // an ALL-CAPS "JORDAN BROWN" match the stored "Jordan Brown".
        const titleCase = (value: string) =>
          value
            .toLowerCase()
            .split(' ')
            .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
            .join(' ')
        const nameFilters = [
          ...new Set(
            playerMentions.flatMap((n) => {
              const title = titleCase(n)
              return title === n ? [n] : [n, title]
            })
          ),
        ]
        const lineRows = await prisma.fantasyStatLine.findMany({
          where: {
            sport: sp,
            OR: nameFilters.map((name) => ({
              stats: { path: ['name'], string_contains: name },
            })),
          },
          orderBy: [{ season: 'desc' }, { week: 'desc' }],
          take: args.sport === 'all' ? 6 : 10,
        }).catch(() => [] as Array<Record<string, unknown>>)

        if (lineRows.length) {
          fallbackStatDates = lineRows.map((r: any) => r.updatedAt ?? r.fetchedAt ?? null)
          fallbackStatChunk = lineRows
            .map((r: any) => {
              const st = (r.stats ?? {}) as Record<string, any>
              const agg = (st.regular_season ?? {}) as Record<string, any>
              const name = st.name ?? st.riPlayerName ?? r.playerId
              const bits: string[] = []
              const push = (label: string, v: unknown) => {
                if (typeof v === 'number') bits.push(`${label}: ${v}`)
              }
              push('G', agg.games_played)
              push('Pts', agg.DK_fantasy_points)
              push('PPG', agg.DK_fantasy_points_per_game)
              push('PassYds', agg['passing.YDS'])
              push('RushYds', agg['rushing.YDS'])
              push('RecYds', agg['receiving.YDS'])
              // The season is stated because these are completed-season
              // aggregates. Without it the model presents last season's
              // production as this year's form.
              return `- ${name}${r.team ? ` (${r.team})` : ''} [${r.season} season totals]${bits.length ? ` · ${bits.join(', ')}` : ''}`
            })
            .join(NL)
        }
      }

      if (fallbackStatChunk) {
        sportReady.hasPlayerStats = true
        const sourceKey = `fantasy_stat_lines_${sp}`
        sources.push(sourceKey)
        setSourceFreshness(sourceKey, fallbackStatDates)
        chunks.push(`### ${sp} — Player season stats (fantasy stat lines)${NL}${fallbackStatChunk}`)
      }

      if (playerStatsRows.length) {
        sportReady.hasPlayerStats = true
        const sourceKey = `player_stats_${sp}`
        sources.push(sourceKey)
        setSourceFreshness(sourceKey, playerStatsRows.map((row) => row.updatedAt))
        chunks.push(
          `### ${sp} — Player season stats (DB)
${playerStatsRows
  .map((row) => {
    const stats = (row.stats ?? {}) as Record<string, unknown>
    const pieces: string[] = []
    const pushMetric = (label: string, key: string) => {
      const value = stats[key]
      if (typeof value === 'number') pieces.push(`${label}: ${value}`)
    }
    pushMetric('Pts', 'DK_fantasy_points')
    pushMetric('PPG', 'DK_fantasy_points_per_game')
    pushMetric('PassYds', 'passing_yards')
    pushMetric('RushYds', 'rushing_yards')
    pushMetric('RecYds', 'receiving_yards')
    pushMetric('Goals', 'goals')
    pushMetric('Assists', 'assists')
    return `- ${row.playerName}${row.team ? ` (${row.team})` : ''} [${row.season}]${pieces.length ? ` · ${pieces.join(', ')}` : ''}`
  })
  .join('\n')}`
        )
      }
    }

    sportReady.missingData = [
      !sportReady.hasSchedules ? 'schedules' : null,
      !sportReady.hasLiveScores ? 'live scores' : null,
      !sportReady.hasStandings ? 'standings' : null,
      !sportReady.hasInjuries ? 'injuries' : null,
      !sportReady.hasNews ? 'news' : null,
      !sportReady.hasPlayerStats ? 'player stats' : null,
      !sportReady.hasRankings ? 'rankings/projections' : null,
    ].filter((item): item is string => Boolean(item))
  }

  if (args.includeNewsApi !== false && (process.env.NEWS_API_KEY || process.env.NEWSAPI_KEY)) {
    try {
      const primary = args.sport === 'all' ? 'NFL' : args.sport
      const { articles } = await getNewsApiEverythingDbFirst({
        query: SPORT_NEWS_QUERY[primary],
        sport: primary,
        pageSize: args.sport === 'all' ? 8 : 12,
        sortBy: 'publishedAt',
      })
      if (articles.length) {
        sources.push('newsapi_everything')
        setSourceFreshness('newsapi_everything', articles.map((a) => toIso(a.published)))
        chunks.push(
          `### Headlines (NewsAPI — supplemental)\n${articles
            .slice(0, 10)
            .map((a) => `- ${a.title} [${a.source}]`)
            .join('\n')}`
        )
      }
    } catch {
      /* non-fatal */
    }
  }

  if (chunks.length === 0) {
    return {
      text: '',
      sources,
      freshness: {
        overallLastSyncedAt: null,
        perSource: sourceFreshness,
      },
      readiness,
    }
  }

  const readinessLines = Object.entries(readiness).map(([sport, state]) =>
    `- ${sport}: missing ${state.missingData.length ? state.missingData.join(', ') : 'no critical cached categories'}`
  )
  const body = [
    'Use only the facts below when answering; do not invent scores, standings, transactions, schedules, or player statuses.',
    readinessLines.length ? `### Cached data readiness\n${readinessLines.join('\n')}` : '',
    ...chunks,
  ].filter(Boolean).join(
    '\n\n'
  )
  return {
    text: body.length > 8000 ? `${body.slice(0, 8000)}\n…` : body,
    sources,
    freshness: {
      overallLastSyncedAt: maxIso(Object.values(sourceFreshness)),
      perSource: sourceFreshness,
    },
    readiness,
  }
}
