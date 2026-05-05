import 'server-only'

import { prisma } from '@/lib/prisma'
import { getLatestNews } from '@/lib/data/news'
import { getInjuryReport } from '@/lib/data/players'
import { getNewsApiEverythingDbFirst } from '@/lib/news/newsapi-cache'
import { SUPPORTED_SPORTS, type SupportedSport } from '@/lib/sport-scope'

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

  for (const sp of sports) {
    const [newsRows, injRows, gameRows, standingsRows, transactionRows] = await Promise.all([
      getLatestNews(sp, args.sport === 'all' ? 8 : 20),
      getInjuryReport(sp),
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
        setSourceFreshness(sourceKey, standingsRows.map((row) => row.createdAt))
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
    }

    if (injRows.length) {
      const sourceKey = `injury_report_${sp}`
      sources.push(sourceKey)
      setSourceFreshness(sourceKey, injRows.map((r) => r.reportDate))
      chunks.push(
        `### ${sp} — Injury report (DB / sports ingest)\n${injRows
          .slice(0, args.sport === 'all' ? 12 : 35)
          .map(
            (r) =>
              `- ${r.playerName}${r.team ? ` (${r.team})` : ''}: ${r.status ?? 'Unknown'}${r.notes ? ` — ${String(r.notes).slice(0, 120)}` : ''}`
          )
          .join('\n')}`
      )
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

      if (playerStatsRows.length) {
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
    }
  }

  const body = ['Use only the facts below when answering; do not invent scores, standings, transactions, schedules, or player statuses.', ...chunks].join(
    '\n\n'
  )
  return {
    text: body.length > 8000 ? `${body.slice(0, 8000)}\n…` : body,
    sources,
    freshness: {
      overallLastSyncedAt: maxIso(Object.values(sourceFreshness)),
      perSource: sourceFreshness,
    },
  }
}
