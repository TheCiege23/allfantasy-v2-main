import 'server-only'

import { prisma } from '@/lib/prisma'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import { getTeamIndex, isTeamFollowSport, listTeamsForSport } from '@/lib/follows/teamFollows'
import { resolveTeam } from '@/lib/follows/teamResolver'
import { getTeamLogoUrl } from '@/lib/players/teamLogos'
import {
  breakingStoryKey,
  classifyBreakingHeadline,
  normalizedHeadline,
  teamsMentioned,
  trustedOutlet,
  type BreakingClassification,
} from '@/lib/news/breakingNews'
import {
  buildGameFinalPosts,
  buildGamePreviewPosts,
  buildHighlightPosts,
  buildStoryPosts,
  type SocialPost,
} from '@/lib/social-newsroom/postBuilder'
import { checkFinalScore, isFinalStatus, OVERTIME_STATUS } from '@/lib/social-newsroom/scoreCheck'

/**
 * The admin Social Newsroom's data: real stories from trusted outlets across the seven sports,
 * each with ready-to-paste posts, the teams and players it names (logos, headshots) and the source
 * link — plus official highlight videos for recent finals.
 *
 * DB-FIRST: reads `sports_news` (refreshed every few minutes by /api/cron/sports-alerts and
 * /api/cron/import-news), `sports_players`, `sports_core_teams` and `SportsGame`. No provider calls.
 *
 * ⚠ "REAL STORY, NOT CLICKBAIT" IS ENFORCED, NOT HOPED FOR:
 *   - only outlets on the TRUSTED_NEWS_HOSTS allowlist, and only with a link to the article;
 *   - questions, rankings, betting, picks, fantasy advice and "you won't believe" bait are dropped;
 *   - stories credited to anonymous sources are labelled "report" in the copy;
 *   - `corroboratedBy` counts how many outlets/rows carry the same event, so a single-source report
 *     is visible as one.
 */

export type NewsroomStory = {
  id: string
  sport: string
  title: string
  description: string | null
  url: string
  outlet: { name: string; handle: string | null }
  publishedAt: string | null
  classification: BreakingClassification | null
  corroboratedBy: number
  articleImage: string | null
  teams: Array<{ abbr: string; name: string; logo: string | null }>
  players: Array<{ name: string; headshot: string | null; team: string | null }>
  posts: SocialPost[]
}

export type NewsroomHighlight = {
  id: string
  sport: string
  title: string
  videoUrl: string
  thumbnail: string | null
  startTime: string | null
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  posts: SocialPost[]
}

const STORY_WINDOW_MS = 36 * 60 * 60 * 1000
const HIGHLIGHT_WINDOW_MS = 4 * 24 * 60 * 60 * 1000

/** Bait and filler — dropped from the newsroom even when the outlet is trusted. */
const CLICKBAIT =
  /\?\s*$|\b(you won'?t believe|shocking|insane|must[- ]see|odds|betting|bets?|parlays?|picks?|predictions?|best bets|fantasy|mock draft|power rankings|rankings|ranked|quiz|sponsored|promo code|deal of the day|how to watch|live stream|streaming|tv channel)\b/i

export function isClickbait(title: string): boolean {
  return CLICKBAIT.test(title)
}

/** YouTube thumbnail for a watch/short/youtu.be URL — the video's own poster, served by YouTube. */
export function youtubeThumbnail(url: string): string | null {
  const m = /(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/.exec(url)
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : null
}

async function teamDirectory(sport: string): Promise<Map<string, string>> {
  return new Map((await listTeamsForSport(sport)).map((t) => [t.abbr, t.name]))
}

export async function loadNewsroom(opts: { sport?: string | null; now?: Date } = {}): Promise<{
  stories: NewsroomStory[]
  highlights: NewsroomHighlight[]
}> {
  const now = opts.now ?? new Date()
  const sports = opts.sport && SUPPORTED_SPORTS.includes(opts.sport.toUpperCase() as (typeof SUPPORTED_SPORTS)[number])
    ? [opts.sport.toUpperCase()]
    : [...SUPPORTED_SPORTS]
  const since = new Date(now.getTime() - STORY_WINDOW_MS)

  const rows = await prisma.sportsNews
    .findMany({
      where: {
        sport: { in: sports },
        sourceUrl: { not: null },
        OR: [{ publishedAt: { gte: since } }, { publishedAt: null, fetchedAt: { gte: since } }],
      },
      orderBy: [{ publishedAt: 'desc' }],
      take: 500,
      select: {
        id: true,
        sport: true,
        title: true,
        description: true,
        sourceUrl: true,
        team: true,
        publishedAt: true,
        fetchedAt: true,
        imageUrl: true,
        playerNames: true,
      },
    })
    .catch(() => [])

  const dirs = new Map<string, Map<string, string>>()
  const teamsFor = async (sport: string, title: string, team: string | null): Promise<string[]> => {
    if (!isTeamFollowSport(sport)) return []
    if (sport === 'NCAAF' || sport === 'NCAAB') {
      const index = await getTeamIndex(sport)
      const t = index && team ? resolveTeam(index, team) : null
      return t ? [t] : []
    }
    return teamsMentioned(title, await listTeamsForSport(sport))
  }

  type Draft = Omit<NewsroomStory, 'posts' | 'players'> & { key: string; playerNames: string[] }
  const byKey = new Map<string, Draft>()
  for (const r of rows) {
    const outlet = trustedOutlet(r.sourceUrl)
    if (!outlet || !r.sourceUrl) continue
    if (isClickbait(r.title)) continue
    const sport = r.sport.toUpperCase()
    const classification = classifyBreakingHeadline(r.title, r.description)
    const abbrs = await teamsFor(sport, r.title, r.team)
    const at = r.publishedAt ?? r.fetchedAt
    const key = classification
      ? breakingStoryKey({ sport, kind: classification.kind, teams: abbrs, title: r.title, publishedAt: at })
      : `${sport}:${normalizedHeadline(r.title)}`
    const existing = byKey.get(key)
    if (existing) {
      existing.corroboratedBy++
      continue
    }
    if (!dirs.has(sport)) dirs.set(sport, await teamDirectory(sport))
    const dir = dirs.get(sport)!
    byKey.set(key, {
      key,
      id: r.id,
      sport,
      title: r.title,
      description: r.description,
      url: r.sourceUrl,
      outlet: { name: outlet.name, handle: outlet.handle },
      publishedAt: r.publishedAt?.toISOString() ?? null,
      classification,
      corroboratedBy: 1,
      articleImage: r.imageUrl,
      teams: abbrs.map((abbr) => ({ abbr, name: dir.get(abbr) ?? abbr, logo: getTeamLogoUrl(abbr, sport) })),
      playerNames: (r.playerNames ?? []).slice(0, 3),
    })
  }

  const drafts = [...byKey.values()]
    // Breaking first, then newest.
    .sort((a, b) => Number(!!b.classification) - Number(!!a.classification) || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .slice(0, 60)

  // Headshots in one read.
  const wanted = [...new Set(drafts.flatMap((d) => d.playerNames))]
  const players = wanted.length
    ? await prisma.sportsPlayer
        .findMany({
          where: { name: { in: wanted }, imageUrl: { not: null } },
          select: { name: true, sport: true, imageUrl: true, team: true },
          take: 500,
        })
        .catch(() => [])
    : []
  const headshot = new Map(players.map((p) => [`${p.sport.toUpperCase()}|${p.name}`, p]))

  const stories: NewsroomStory[] = drafts.map(({ key: _key, playerNames, ...d }) => ({
    ...d,
    players: playerNames.map((name) => {
      const p = headshot.get(`${d.sport}|${name}`)
      return { name, headshot: p?.imageUrl ?? null, team: p?.team ?? null }
    }),
    posts: buildStoryPosts({
      sport: d.sport,
      title: d.title,
      description: d.description,
      url: d.url,
      outletName: d.outlet.name,
      outletHandle: d.outlet.handle,
      classification: d.classification,
      teamNames: d.teams.map((t) => t.name),
    }),
  }))

  // Official highlight videos for recent finals (TheSportsDB `strVideo`, stored whole in `raw`).
  const games = await prisma.sportsGame
    .findMany({
      where: {
        sport: { in: sports },
        source: 'thesportsdb',
        raw: { path: ['strVideo'], string_starts_with: 'http' },
        startTime: { gte: new Date(now.getTime() - HIGHLIGHT_WINDOW_MS), lte: now },
      },
      orderBy: { startTime: 'desc' },
      take: 40,
      select: { id: true, sport: true, homeTeam: true, awayTeam: true, homeScore: true, awayScore: true, startTime: true, raw: true },
    })
    .catch(() => [])

  const highlights: NewsroomHighlight[] = []
  for (const g of games) {
    const raw = (g.raw ?? {}) as Record<string, unknown>
    const videoUrl = typeof raw.strVideo === 'string' ? raw.strVideo : null
    if (!videoUrl || !/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(videoUrl)) continue
    const title = typeof raw.strEvent === 'string' ? raw.strEvent : `${g.awayTeam} vs ${g.homeTeam}`
    highlights.push({
      id: g.id,
      sport: g.sport,
      title,
      videoUrl,
      thumbnail: youtubeThumbnail(videoUrl),
      startTime: g.startTime?.toISOString() ?? null,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      posts: buildHighlightPosts({
        sport: g.sport,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        homeScore: g.homeScore,
        awayScore: g.awayScore,
        videoUrl,
      }),
    })
  }

  return { stories, highlights }
}


export type NewsroomGame = {
  id: string
  sport: string
  homeTeam: string
  awayTeam: string
  homeLogo: string | null
  awayLogo: string | null
  startTime: string
  venue: string | null
  homeScore: number | null
  awayScore: number | null
  final: boolean
  /**
   * For a final: `confirmed` when another provider reports the same score, `single` when only one
   * provider has it, `conflict` when providers disagree — then no posts are built.
   */
  scoreCheck: 'confirmed' | 'single' | 'conflict' | null
  posts: SocialPost[]
}

/**
 * Which provider's rows to use for a sport's game list, best first.
 *
 * ⚠ ONE SOURCE PER SPORT, NEVER A MERGE. Every provider writes its own row per game with its own
 * spelling (`SEA`/`DEN` from espn_live, "Seattle Seahawks" from Rolling Insights, "GEORGIA SOUTHERN"
 * from api-sports), so merging produces the same game three times. TheSportsDB writes full names
 * and venues for every sport and leads; the rest are fallbacks for a sport it does not cover that day.
 */
const GAME_SOURCE_ORDER = ['thesportsdb', 'rolling_insights', 'espn', 'cfbd', 'espn_live', 'api_sports']
const FINAL_WINDOW_MS = 14 * 60 * 60 * 1000
const UPCOMING_WINDOW_MS = 18 * 60 * 60 * 1000


/**
 * Today's games — the ones still to start in the next 18 hours, and finals from the last 14 — with
 * preview or final posts. DB-first: reads `SportsGame`, written by the scores and schedule crons.
 */
export async function loadTonightsGames(opts: { sport?: string | null; now?: Date } = {}): Promise<NewsroomGame[]> {
  const now = opts.now ?? new Date()
  const sports = opts.sport && SUPPORTED_SPORTS.includes(opts.sport.toUpperCase() as (typeof SUPPORTED_SPORTS)[number])
    ? [opts.sport.toUpperCase()]
    : [...SUPPORTED_SPORTS]

  const rows = await prisma.sportsGame
    .findMany({
      where: {
        sport: { in: sports },
        startTime: { gte: new Date(now.getTime() - FINAL_WINDOW_MS), lte: new Date(now.getTime() + UPCOMING_WINDOW_MS) },
        source: { in: GAME_SOURCE_ORDER },
      },
      orderBy: { startTime: 'asc' },
      take: 2000,
      select: { id: true, sport: true, source: true, homeTeam: true, awayTeam: true, homeScore: true, awayScore: true, status: true, startTime: true, venue: true },
    })
    .catch(() => [])

  const out: NewsroomGame[] = []
  for (const sport of sports) {
    const forSport = rows.filter((r) => r.sport === sport)
    const source = GAME_SOURCE_ORDER.find((src) => forSport.some((r) => r.source === src))
    if (!source) continue
    const index = isTeamFollowSport(sport) ? await getTeamIndex(sport) : null
    const resolve = (name: string): string | null => (index ? resolveTeam(index, name, { exactNames: true }) : null)
    const logoFor = (name: string): string | null => {
      const abbr = resolve(name)
      return abbr ? getTeamLogoUrl(abbr, sport) : null
    }
    const seen = new Set<string>()
    for (const r of forSport.filter((x) => x.source === source)) {
      if (!r.startTime) continue
      const key = `${r.homeTeam}|${r.awayTeam}|${r.startTime.toISOString().slice(0, 10)}`
      if (seen.has(key)) continue
      seen.add(key)
      const final = isFinalStatus(r.status) && r.homeScore != null && r.awayScore != null
      const scoreCheck = final ? checkFinalScore(r, forSport, resolve) : null
      const started = r.startTime.getTime() <= now.getTime()
      // A game already under way (or one with an unknown result) gets no preview: "tonight at
      // 7:30" is wrong by then, and a final needs both scores.
      if (!final && started) continue
      const input = {
        sport,
        homeTeam: r.homeTeam,
        awayTeam: r.awayTeam,
        startTime: r.startTime.toISOString(),
        venue: r.venue,
        homeScore: r.homeScore,
        awayScore: r.awayScore,
        final,
        overtime: final && OVERTIME_STATUS.test(String(r.status ?? '').trim()),
        shootout: final && /^ap$/i.test(String(r.status ?? '').trim()),
      }
      out.push({
        id: r.id,
        sport,
        homeTeam: r.homeTeam,
        awayTeam: r.awayTeam,
        homeLogo: logoFor(r.homeTeam),
        awayLogo: logoFor(r.awayTeam),
        startTime: input.startTime,
        venue: r.venue,
        homeScore: r.homeScore,
        awayScore: r.awayScore,
        final,
        scoreCheck,
        posts: !final ? buildGamePreviewPosts(input) : scoreCheck === 'conflict' ? [] : buildGameFinalPosts(input),
      })
    }
  }
  // Finals first (they are the timely ones), then upcoming games by start time.
  return out.sort((a, b) => Number(b.final) - Number(a.final) || a.startTime.localeCompare(b.startTime))
}
