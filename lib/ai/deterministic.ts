/**
 * Deterministic shortcuts for Chimmy.
 *
 * Returns a pre-built answer for questions that do not require an AI call,
 * saving provider credits and reducing latency. Returns null when the question
 * requires AI.
 *
 * Sports schedule guardrail:
 * - If the user asks about today's games and no schedule context is available,
 *   we return a deterministic refusal rather than calling a paid provider.
 * - If schedule data exists we return null so the pipeline proceeds normally
 *   (the schedule will be injected into the system prompt by the pipeline).
 */
import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveChimmyIntentRoute } from '@/lib/ai/chimmyIntentRouter'
import { DEFAULT_WORLD_CUP_SCORING } from '@/lib/world-cup/worldCupBracketBuilder'
import { findPlayerByName, getValueTier } from '@/lib/fantasycalc'
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db'
import { getEnrichedNewsFeed } from '@/lib/fantasy-news-aggregator/FantasyNewsAggregatorService'
import { getCachedGameWeather } from '@/lib/weather/weatherService'
import { resolveLanguage } from '@/lib/i18n/constants'
import { getFantasyDayWindowUTC } from '@/lib/time-engine/windows'
import { detectUpcomingIntent, findUpcomingGames } from '@/lib/ai/upcomingGames'
import {
  detectStatFamily,
  findPlayerInText,
  FAMILY_LABEL,
  readStatLeaders,
} from '@/lib/live/playerStatLeaders'

/** US sports days are Eastern days; this is what "today" and "tonight" mean. */
const SPORTS_DAY_TIMEZONE = 'America/New_York'

// ── Schedule question detection ───────────────────────────────────────────────

const SCHEDULE_PATTERNS: RegExp[] = [
  /\b(what|are|any|which)\s+(sports?\s+)?games?\s+(are\s+)?(on|playing|today|tonight|now|scheduled)\b/i,
  /\bwhat('?s|\s+is)\s+(on\s+)?(tonight|today)\b/i,
  /\b(today|tonight)('?s)?\s+(schedule|games?|matchups?|action)\b/i,
  /\bgames?\s+(?:are\s+)?(today|tonight|now|being\s+played|on\s+today)\b/i,
  /\bwhat\s+sports?\s+(are\s+)?(on|playing|happening)\s+(today|tonight|now)\b/i,
  /\b(nfl|nba|mlb|nhl|soccer|ncaa)\s+games?\s+(today|tonight)\b/i,
]

export function detectScheduleQuestion(message: string): boolean {
  return SCHEDULE_PATTERNS.some((p) => p.test(message))
}

// ── Schedule context availability ─────────────────────────────────────────────

/**
 * Returns true if there are games in the DB scheduled for today (UTC).
 * Fails safely (returns false) if the DB query errors.
 */
export async function checkScheduleContextAvailable(): Promise<boolean> {
  try {
    const now = new Date()
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1_000)

    const count = await prisma.gameSchedule.count({
      where: {
        startTime: { gte: dayStart, lt: dayEnd },
      },
    })
    return count > 0
  } catch {
    return false
  }
}

// ── Deterministic responses ───────────────────────────────────────────────────

const SCHEDULE_REFUSAL_BY_LOCALE: Record<string, string> = {
  en: "I need live schedule data connected before I can answer today's games accurately.",
  es: "Necesito datos del calendario en vivo para responder con precisión sobre los partidos de hoy.",
  zh: "我需要即時賽程資料才能準確回答今天的比賽問題。",
  fil: "Kailangan ko ng live na datos ng iskedyul bago ako makasagot nang tama tungkol sa mga laro ngayon.",
  vi: "Tôi cần dữ liệu lịch thi đấu trực tiếp để trả lời chính xác về các trận hôm nay.",
}

SCHEDULE_REFUSAL_BY_LOCALE.fr = "J'ai besoin de donnees de calendrier fiables avant de pouvoir repondre avec precision sur les matchs d'aujourd'hui."
SCHEDULE_REFUSAL_BY_LOCALE.ar = "أحتاج إلى بيانات جدول موثوقة قبل أن أجيب بدقة عن مباريات اليوم."

const RELIABLE_UNAVAILABLE_BY_LOCALE: Record<string, string> = {
  en: "I don't have reliable data for that yet.",
  es: "No tengo datos confiables para eso todavía.",
  zh: "I don't have reliable data for that yet.",
  fil: "I don't have reliable data for that yet.",
  vi: "I don't have reliable data for that yet.",
  fr: "Je n'ai pas encore de donnees fiables pour cela.",
  ar: "لا أملك بيانات موثوقة لذلك بعد.",
}

/*
 * ⚠ ORDER IS LOAD-BEARING: `resolveSportFromMessage` returns the FIRST match.
 * The college entries used to sit LAST, while the NFL pattern matches a bare
 * "football" and the NBA pattern a bare "basketball" — so "when does the
 * COLLEGE FOOTBALL season start?" resolved to NFL and answered about a
 * different sport, and "college basketball" resolved to NBA. The specific
 * leagues must be tested before the generic sport nouns contained within them.
 */
const SPORT_ALIASES: Array<{ sport: string; pattern: RegExp }> = [
  { sport: 'NCAAF', pattern: /\b(ncaaf|college football|cfb)\b/i },
  { sport: 'NCAAB', pattern: /\b(ncaab|college basketball|cbb|march madness)\b/i },
  { sport: 'NBA', pattern: /\b(nba|basketball|knicks|lakers|warriors|celtics|mavericks|thunder|nuggets|timberwolves|pacers)\b/i },
  { sport: 'MLB', pattern: /\b(mlb|baseball|yankees|mets|dodgers|red\s+sox|braves|cubs|phillies)\b/i },
  { sport: 'NHL', pattern: /\b(nhl|hockey|rangers|islanders|bruins|maple\s+leafs|panthers|oilers)\b/i },
  { sport: 'NFL', pattern: /\b(nfl|football|chiefs|mahomes|patrick\s+mahomes|cowboys|eagles|giants|jets|bills|ravens)\b/i },
  { sport: 'SOCCER', pattern: /\b(soccer|fifa|world\s+cup|mundial|copa\s+mundial|football tournament|futbol|f[uú]tbol)\b/i },
]

const TEAM_ALIASES: Record<string, Array<{ canonical: string; aliases: string[] }>> = {
  NBA: [
    { canonical: 'New York Knicks', aliases: ['knicks', 'nyk', 'new york knicks'] },
    { canonical: 'Los Angeles Lakers', aliases: ['lakers', 'lal', 'los angeles lakers'] },
    { canonical: 'Golden State Warriors', aliases: ['warriors', 'gsw', 'golden state warriors'] },
    { canonical: 'Boston Celtics', aliases: ['celtics', 'bos', 'boston celtics'] },
    { canonical: 'Indiana Pacers', aliases: ['pacers', 'ind', 'indiana pacers'] },
  ],
  MLB: [
    { canonical: 'New York Yankees', aliases: ['yankees', 'nyy', 'new york yankees'] },
    { canonical: 'New York Mets', aliases: ['mets', 'nym', 'new york mets'] },
    { canonical: 'Los Angeles Dodgers', aliases: ['dodgers', 'lad', 'los angeles dodgers'] },
  ],
  NHL: [
    { canonical: 'New York Rangers', aliases: ['rangers', 'nyr', 'new york rangers'] },
    { canonical: 'New York Islanders', aliases: ['islanders', 'nyi', 'new york islanders'] },
  ],
  NFL: [
    { canonical: 'Kansas City Chiefs', aliases: ['chiefs', 'kc', 'kansas city chiefs'] },
    { canonical: 'Dallas Cowboys', aliases: ['cowboys', 'dal', 'dallas cowboys'] },
    { canonical: 'Philadelphia Eagles', aliases: ['eagles', 'phi', 'philadelphia eagles'] },
  ],
}

const NFL_TEAM_ABBREV_ALIASES: Array<{ abbrev: string; label: string; aliases: string[] }> = [
  { abbrev: 'KC', label: 'Kansas City Chiefs', aliases: ['chiefs', 'kansas city chiefs', 'kc'] },
  { abbrev: 'DAL', label: 'Dallas Cowboys', aliases: ['cowboys', 'dallas cowboys', 'dal'] },
  { abbrev: 'PHI', label: 'Philadelphia Eagles', aliases: ['eagles', 'philadelphia eagles', 'phi'] },
  { abbrev: 'NYG', label: 'New York Giants', aliases: ['giants', 'new york giants', 'nyg'] },
  { abbrev: 'NYJ', label: 'New York Jets', aliases: ['jets', 'new york jets', 'nyj'] },
  { abbrev: 'BUF', label: 'Buffalo Bills', aliases: ['bills', 'buffalo bills', 'buf'] },
  { abbrev: 'BAL', label: 'Baltimore Ravens', aliases: ['ravens', 'baltimore ravens', 'bal'] },
  { abbrev: 'SF', label: 'San Francisco 49ers', aliases: ['49ers', 'niners', 'san francisco 49ers', 'sf'] },
  { abbrev: 'LAR', label: 'Los Angeles Rams', aliases: ['rams', 'los angeles rams', 'lar'] },
  { abbrev: 'LAC', label: 'Los Angeles Chargers', aliases: ['chargers', 'los angeles chargers', 'lac'] },
  { abbrev: 'GB', label: 'Green Bay Packers', aliases: ['packers', 'green bay packers', 'gb'] },
  { abbrev: 'CHI', label: 'Chicago Bears', aliases: ['bears', 'chicago bears', 'chi'] },
]

function reliableUnavailable(locale?: string): string {
  const safe = resolveLanguage(locale)
  return RELIABLE_UNAVAILABLE_BY_LOCALE[safe] ?? RELIABLE_UNAVAILABLE_BY_LOCALE.en
}

function detectNewsQuestion(message: string): boolean {
  return /\b(news|latest|updates?|headlines?|report|reports|what happened|breaking)\b/i.test(message)
}

function detectInjuryQuestion(message: string): boolean {
  return /\b(injur(?:y|ies|ed)|hurt|questionable|doubtful|out|suspension|suspended|availability)\b/i.test(message)
}

function detectWeatherQuestion(message: string): boolean {
  return /\b(weather|forecast|wind|rain|snow|temperature|temp|cold|hot|dome|outdoor)\b/i.test(message)
}

/*
 * ⚠ ABBREVIATIONS BYPASSED THIS GUARD. It matched "touchdowns" and not "TDs",
 * so "who has the most TDs today?" sailed past the one check that exists to
 * stop invented stats, and went to a model with no play-by-play data behind
 * it. A guard is worth nothing if the shortest, most natural phrasing walks
 * through it — and TD, RBI and HR are how people actually write these.
 */
function detectUnsupportedStatEventQuestion(message: string): boolean {
  /*
   * ⚠ `hr` DID NOT MATCH "HRs". The `\b` after it requires a boundary, and the
   * plural `s` is a word character — so "who hit the most HRs today?" walked
   * straight past this guard into a model with no baseball play-by-play behind
   * it. Exactly the gap that `TDs` had, reintroduced one abbreviation over.
   * Every abbreviation here now carries its own optional plural.
   */
  return /\b(home runs?|homers?|hrs?|hit a home run|touchdowns?|tds?|rbis?|ypc|goalscorers?|who scored|box score|stat ?line|player stats?|passing yards?|rushing yards?|receiving yards?)\b/i.test(
    message,
  )
}

function resolveNflTeamForWeather(message: string): { abbrev: string; label: string } | null {
  const lower = message.toLowerCase()
  for (const team of NFL_TEAM_ABBREV_ALIASES) {
    if (team.aliases.some((alias) => new RegExp(`\\b${alias.replace(/\s+/g, '\\s+')}\\b`, 'i').test(lower))) {
      return { abbrev: team.abbrev, label: team.label }
    }
  }
  return null
}

function resolveSportFromMessage(message: string): string | null {
  for (const item of SPORT_ALIASES) {
    if (item.pattern.test(message)) return item.sport
  }
  return null
}

function resolveTeamAlias(message: string, sport: string | null): { canonical: string; aliases: string[] } | null {
  const lower = message.toLowerCase()
  const sportsToCheck = sport ? [sport] : Object.keys(TEAM_ALIASES)
  for (const sp of sportsToCheck) {
    for (const team of TEAM_ALIASES[sp] ?? []) {
      if (team.aliases.some((alias) => new RegExp(`\\b${alias.replace(/\s+/g, '\\s+')}\\b`, 'i').test(lower))) {
        return team
      }
    }
  }
  return null
}

/**
 * "Today" for a US sports audience, which is an EASTERN day, not a UTC one.
 *
 * ⚠ THIS BUILT A UTC CALENDAR DAY WHILE RENDERING EASTERN TIMES, and that
 * mismatch hid the entire evening slate — the games people actually ask about.
 * An 8pm ET kickoff is 00:00 UTC the NEXT day, so "what games are on tonight?"
 * excluded them by construction. Verified against production: tonight's NFL
 * preseason games sit at 03:00 UTC tomorrow and fell outside this window.
 *
 * Reuses the time engine's own day window rather than a second hand-rolled
 * offset that would be free to disagree with it.
 */
function dayWindowUtc(input: 'today' | 'yesterday') {
  const { windowStartUTC, windowEndUTC } = getFantasyDayWindowUTC(SPORTS_DAY_TIMEZONE)
  if (input === 'today') return { start: windowStartUTC, end: windowEndUTC }

  const dayMs = 24 * 60 * 60 * 1000
  return {
    start: new Date(windowStartUTC.getTime() - dayMs),
    end: new Date(windowEndUTC.getTime() - dayMs),
  }
}

function formatEt(value: Date | string | null | undefined): string {
  if (!value) return 'time TBD'
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return 'time TBD'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date)
}

function isFinalStatus(status: string | null | undefined): boolean {
  return /\b(final|completed|complete|ended|ft|full time|post|closed)\b/i.test(String(status ?? ''))
}

function teamFieldMatches(value: string | null | undefined, aliases: string[]): boolean {
  const lower = String(value ?? '').toLowerCase()
  return aliases.some((alias) => lower === alias.toLowerCase() || lower.includes(alias.toLowerCase()))
}

async function buildWorldCupStartAnswer(locale?: string): Promise<string | null> {
  if (locale === 'es') {
    // Keep the static fallback short and explicit about cache availability.
    return 'La Copa Mundial FIFA 2026 está programada para comenzar el 11 de junio de 2026. Si el fixture sincronizado no está en caché, no afirmaré el partido inaugural exacto.'
  }

  const firstMatch = await (prisma as any).worldCupBracketMatch?.findFirst?.({
    where: { startsAt: { not: null } },
    orderBy: { startsAt: 'asc' },
    select: {
      homeTeamName: true,
      awayTeamName: true,
      startsAt: true,
      venueName: true,
      venueCity: true,
    },
  }).catch(() => null)

  if (firstMatch?.startsAt) {
    const teams = `${firstMatch.awayTeamName || 'TBD'} vs ${firstMatch.homeTeamName || 'TBD'}`
    const venue = [firstMatch.venueName, firstMatch.venueCity].filter(Boolean).join(', ')
    return `The first cached World Cup kickoff is ${teams} on ${formatEt(firstMatch.startsAt)}${venue ? ` at ${venue}` : ''}. Source: AllFantasy World Cup fixture cache.`
  }

  return 'The 2026 FIFA World Cup is scheduled to start on June 11, 2026. I do not have the opening-match fixture cached here yet, so I will not claim the exact first matchup from provider data.'
}

async function buildTeamResultAnswer(message: string): Promise<string | null> {
  if (!/\b(did|do|does|won|win|winner|result|score)\b/i.test(message)) return null
  const sport = resolveSportFromMessage(message)
  const team = resolveTeamAlias(message, sport)
  if (!team) return null

  const targetDay = /\b(last night|yesterday)\b/i.test(message) ? 'yesterday' : 'today'
  const { start, end } = dayWindowUtc(targetDay)
  const games = await (prisma as any).sportsGame?.findMany?.({
    where: {
      ...(sport ? { sport } : {}),
      startTime: { gte: start, lt: end },
      OR: [
        ...team.aliases.map((alias) => ({ homeTeam: { contains: alias, mode: 'insensitive' as const } })),
        ...team.aliases.map((alias) => ({ awayTeam: { contains: alias, mode: 'insensitive' as const } })),
      ],
    },
    orderBy: { startTime: 'desc' },
    take: 3,
  }).catch(() => []) ?? []

  const game = games.find((row: any) =>
    teamFieldMatches(row.homeTeam, team.aliases) || teamFieldMatches(row.awayTeam, team.aliases)
  ) ?? games[0]
  if (!game) {
    return `I do not have reliable cached ${sport ?? 'sports'} score data for ${team.canonical} from ${targetDay} yet.`
  }

  const homeScore = typeof game.homeScore === 'number' ? game.homeScore : null
  const awayScore = typeof game.awayScore === 'number' ? game.awayScore : null
  const scoreKnown = homeScore != null && awayScore != null
  if (!scoreKnown) {
    return `I found a cached ${sport ?? 'sports'} game for ${game.awayTeam} at ${game.homeTeam} on ${formatEt(game.startTime)}, but the final score is not cached yet. Status: ${game.status ?? 'unknown'}.`
  }

  const isHomeTeam = teamFieldMatches(game.homeTeam, team.aliases)
  const teamScore = isHomeTeam ? homeScore : awayScore
  const opponentScore = isHomeTeam ? awayScore : homeScore
  const opponent = isHomeTeam ? game.awayTeam : game.homeTeam
  const won = teamScore > opponentScore
  const tied = teamScore === opponentScore
  const finalNote = isFinalStatus(game.status) ? 'Final' : `Status: ${game.status ?? 'cached'}`
  return tied
    ? `${team.canonical} tied ${opponent} ${teamScore}-${opponentScore}. ${finalNote}. Source: cached SportsGame row.`
    : `${won ? 'Yes' : 'No'} — ${team.canonical} ${won ? 'beat' : 'lost to'} ${opponent} ${teamScore}-${opponentScore}. ${finalNote}. Source: cached SportsGame row.`
}

/**
 * "When is the next game" / "when does the season start".
 *
 * Runs BEFORE the cached-today path, because both questions look forward and
 * that path only ever queries a single day window — which is exactly why they
 * used to fall through to a model holding no schedule at all.
 */
async function buildUpcomingGamesAnswer(message: string): Promise<string | null> {
  const intent = detectUpcomingIntent(message, resolveSportFromMessage)
  if (!intent) return null

  const { games, alreadyUnderway } = await findUpcomingGames(intent)

  /*
   * Nothing scheduled is a real answer, and a far better one than widening the
   * search until something matches a question nobody asked.
   */
  if (games.length === 0) {
    const what = [intent.seasonType === 'pre' ? 'preseason' : null, intent.sport]
      .filter(Boolean)
      .join(' ')
    return `${reliableUnavailable()} I have no upcoming ${what || 'games'} on the schedule I can verify. Source: cached SportsGame rows.`
  }

  const describe = (game: any) => {
    const kind = game.seasonType === 'pre' ? ' (preseason)' : ''
    const week = typeof game.week === 'number' ? ` · Week ${game.week}` : ''
    const where = game.venue ? ` · ${game.venue}` : ''
    return `- ${game.awayTeam} @ ${game.homeTeam}${kind}${week} — ${formatEt(game.startTime)}${where}`
  }

  const first = games[0]
  const label = `${first.sport}${intent.seasonType === 'pre' ? ' preseason' : ''}`

  if (intent.kind === 'season-start') {
    /*
     * Saying "the season starts <next game>" about a season already running
     * would be flatly wrong — so that case says which it is instead.
     */
    const opener = alreadyUnderway
      ? `The ${first.season ?? ''} ${first.sport} regular season has already started. The next game I have is:`
      : `The next ${label} game on my schedule — the earliest I can verify — is:`
    return `${opener}
${describe(first)}
Source: cached SportsGame rows.`
  }

  const lines = games.map(describe)
  return `Next ${label} ${games.length === 1 ? 'game' : `${games.length} games`} I can verify:
${lines.join('\n')}
Source: cached SportsGame rows.`
}

async function buildCachedGamesAnswer(message: string): Promise<string | null> {
  if (!detectScheduleQuestion(message) && !/\b(live scores?|scores?|games? today|tonight|playing now)\b/i.test(message)) {
    return null
  }
  const sport = resolveSportFromMessage(message)
  const { start, end } = dayWindowUtc(/\b(yesterday|last night)\b/i.test(message) ? 'yesterday' : 'today')
  const games = await (prisma as any).sportsGame?.findMany?.({
    where: {
      ...(sport ? { sport } : {}),
      startTime: { gte: start, lt: end },
    },
    orderBy: { startTime: 'asc' },
    take: 12,
  }).catch(() => []) ?? []

  if (!games.length) return null

  /*
   * ⚠ THE SAME FIXTURE IS STORED SEVERAL TIMES. Production carries duplicate
   * `SportsGame` rows per fixture — tonight's Steelers @ Bills appears three
   * times, differing only in `seasonType` and `status` — so listing rows
   * verbatim reads as three separate games. Collapse on the pairing and
   * kickoff, preferring whichever copy actually carries a score.
   */
  const unique = new Map<string, any>()
  for (const game of games) {
    const key = `${game.sport}|${game.awayTeam}|${game.homeTeam}|${new Date(game.startTime).getTime()}`
    const held = unique.get(key)
    const hasScore = typeof game.awayScore === 'number' && typeof game.homeScore === 'number'
    const heldScored = held && typeof held.awayScore === 'number' && typeof held.homeScore === 'number'
    if (!held || (hasScore && !heldScored)) unique.set(key, game)
  }

  const lines = [...unique.values()].map((game: any) => {
    const score =
      typeof game.awayScore === 'number' && typeof game.homeScore === 'number'
        ? `${game.awayScore}-${game.homeScore}`
        : 'score TBD'
    return `- ${game.awayTeam} @ ${game.homeTeam}: ${score} (${game.status ?? 'scheduled'}) — ${formatEt(game.startTime)}`
  })
  return `Here are the cached ${sport ?? 'sports'} games I can verify for that window:\n${lines.join('\n')}\nSource: cached SportsGame rows.`
}

function extractLikelyPlayerName(message: string): string | null {
  const afterValue = message.match(/\b(?:value|worth|on|for)\s+([A-Z][a-z'.-]+(?:\s+[A-Z][a-z'.-]+){1,3})/)
  if (afterValue?.[1]) return afterValue[1].trim()
  const proper = message.match(/\b([A-Z][a-z'.-]+(?:\s+[A-Z][a-z'.-]+){1,3})\b/)
  if (proper?.[1] && !/World Cup|All Fantasy|AllFantasy/.test(proper[1])) return proper[1].trim()
  return null
}

async function buildFantasyCalcValueAnswer(message: string): Promise<string | null> {
  if (!/\b(trade value|fantasycalc|value|worth)\b/i.test(message)) return null
  const playerName = extractLikelyPlayerName(message)
  if (!playerName) return null
  const isDynasty = /\bdynasty|keeper|future\b/i.test(message)
  const isSuperflex = /\bsuperflex|\bsf\b|2qb|two qb/i.test(message)

  try {
    const values = await getFantasyCalcValuesDbFirst({
      isDynasty,
      numQbs: isSuperflex ? 2 : 1,
      numTeams: 12,
      ppr: 1,
    })
    const found = findPlayerByName(values, playerName)
    if (!found) {
      return `I could not find ${playerName} in the FantasyCalc value feed I can access right now.`
    }
    const tier = getValueTier(found.value)
    return `${found.player.name}'s FantasyCalc ${isDynasty ? 'dynasty' : 'redraft'} value is ${found.value} (${tier} tier), overall rank #${found.overallRank}, position rank #${found.positionRank}, with a 30-day trend of ${found.trend30Day > 0 ? '+' : ''}${found.trend30Day}. Settings: ${isSuperflex ? 'superflex' : '1QB'}, 12-team PPR. Source: FantasyCalc current values.`
  } catch {
    return `I do not have reliable FantasyCalc value data for ${playerName} right now.`
  }
}

async function buildCachedNewsAnswer(message: string, locale?: string): Promise<string | null> {
  if (!detectNewsQuestion(message) && !/\bwhat'?s new\b/i.test(message)) return null
  const sport = resolveSportFromMessage(message) ?? 'NFL'
  const playerName = extractLikelyPlayerName(message)
  const team = resolveTeamAlias(message, sport)

  try {
    const feed = await getEnrichedNewsFeed({
      sport,
      feedType: playerName ? 'player' : team ? 'team' : 'sport',
      playerQuery: playerName ?? undefined,
      teamQuery: team?.canonical ?? undefined,
      limit: 5,
      enrich: false,
      refresh: false,
    })

    if (!feed.length) {
      return `${reliableUnavailable(locale)} I do not have cached ${sport} news${playerName ? ` for ${playerName}` : team ? ` for ${team.canonical}` : ''} right now. Source checked: AllFantasy SportsNews cache.`
    }

    const lines = feed.slice(0, 5).map((item, index) => {
      const published = item.publishedAt ? new Date(item.publishedAt).toISOString().slice(0, 10) : 'recent'
      return `${index + 1}. ${item.headline ?? item.title} (${item.source}, ${published})`
    })
    return `Here are the cached ${sport} news items I can verify:\n${lines.join('\n')}\nSource: AllFantasy SportsNews cache${playerName ? ` for ${playerName}` : team ? ` for ${team.canonical}` : ''}.`
  } catch {
    return `${reliableUnavailable(locale)} The news cache could not be read safely.`
  }
}

async function buildCachedInjuryAnswer(message: string, locale?: string): Promise<string | null> {
  if (!detectInjuryQuestion(message)) return null
  const sport = resolveSportFromMessage(message) ?? 'NFL'
  const playerName = extractLikelyPlayerName(message)
  const team = resolveTeamAlias(message, sport)

  try {
    const rows = await (prisma as any).sportsInjury?.findMany?.({
      where: {
        sport,
        ...(playerName ? { playerName: { contains: playerName, mode: 'insensitive' as const } } : {}),
        ...(!playerName && team ? {
          OR: team.aliases.map((alias) => ({ team: { contains: alias, mode: 'insensitive' as const } })),
        } : {}),
      },
      orderBy: [{ date: 'desc' }, { updatedAt: 'desc' }],
      take: 6,
    }).catch(() => []) ?? []

    if (!rows.length) {
      return `${reliableUnavailable(locale)} I do not have cached ${sport} injury data${playerName ? ` for ${playerName}` : team ? ` for ${team.canonical}` : ''} right now.`
    }

    const lines = rows.map((row: any) =>
      `- ${row.playerName}${row.team ? ` (${row.team})` : ''}: ${row.status ?? row.type ?? 'status unknown'}${row.description ? ` - ${String(row.description).slice(0, 140)}` : ''}`
    )
    return `Cached ${sport} injury report:\n${lines.join('\n')}\nSource: AllFantasy SportsInjury cache.`
  } catch {
    return `${reliableUnavailable(locale)} The injury cache could not be read safely.`
  }
}

async function buildCachedWeatherAnswer(message: string, locale?: string): Promise<string | null> {
  if (!detectWeatherQuestion(message)) return null
  const team = resolveNflTeamForWeather(message)
  if (!team) {
    return `${reliableUnavailable(locale)} Tell me the NFL team or game and I can check cached WeatherCache venue data when it exists.`
  }

  try {
    const weather = await getCachedGameWeather({ sport: 'NFL', homeTeam: team.abbrev, referenceDate: new Date() })
    if (!weather) {
      return `${reliableUnavailable(locale)} I do not have cached weather for ${team.label} right now.`
    }
    if (weather.isDome) {
      return `${team.label} plays in ${weather.venue}; cached weather says this is an indoor/dome setup, so there is no weather impact. Source: WeatherCache/OpenWeather venue layer.`
    }
    return `${team.label} weather at ${weather.venue}: ${Math.round(weather.weather.temp)}F, wind ${Math.round(weather.weather.windSpeed)} mph, ${weather.weather.description}. Fantasy impact: ${weather.weather.fantasyImpact}. Source: WeatherCache/OpenWeather venue layer.`
  } catch {
    return `${reliableUnavailable(locale)} The weather cache could not be read safely.`
  }
}

/**
 * "Who has the most TDs today?" answered from the live play-by-play feed.
 *
 * Returns null when the question is not a stat-leader question OR when the feed
 * holds nothing, so the honest refusal below still fires in exactly the case it
 * was written for: no data. What it must never do is refuse while the answer is
 * sitting in cache, which is what happened before this existed.
 */
async function buildStatLeaderAnswer(message: string, locale?: string): Promise<string | null> {
  /* Only leaderboard-shaped questions; "did Kelce score?" is a different ask. */
  if (!/\b(most|lead|leads|leading|leader|leaderboard|top)\b/i.test(message)) return null

  const family = detectStatFamily(message)
  if (!family) return null

  const { leaders, eventsScanned } = await readStatLeaders(family, 5)

  /*
   * An empty window is NOT "nobody scored" — it is "no games in the last six
   * hours, or none polled". Saying the first would be a fabricated fact about
   * the day, so this defers to the refusal instead.
   */
  if (eventsScanned === 0 || leaders.length === 0) return null

  const label = FAMILY_LABEL[family]
  const lines = leaders.map((leader, i) => {
    const team = leader.team ? ` (${leader.team})` : ''
    return `${i + 1}. ${leader.playerName}${team} — ${leader.total} ${label}`
  })

  const head = locale === 'es'
    ? `Líderes de ${label} en las jugadas en vivo que tengo:`
    : `Leaders in ${label} from the live plays I have:`

  /*
   * The window is stated, not implied. This is a six-hour rolling feed capped at
   * 200 events, so calling it "today" would overclaim on a Sunday and underclaim
   * at midnight.
   */
  const caveat = locale === 'es'
    ? `Basado en ${eventsScanned} jugadas en vivo de las últimas horas, no en la temporada completa.`
    : `Based on ${eventsScanned} plays from the live feed of the last few hours — not full-season totals.`

  return `${head}\n${lines.join('\n')}\n${caveat}`
}

/**
 * "How many TDs did Josh Allen have today?" — one player, not a leaderboard.
 *
 * ⚠ THIS QUESTION USED TO REFUSE WHILE THE ANSWER WAS IN HAND. The leader
 * answer only fires on "most / lead / top" phrasing, so a specific-player
 * question fell to the blanket refusal — even though the feed stores every
 * player's cumulative total per stat. Refusing with the data present is worse
 * than not having it: it teaches people the assistant cannot do something it
 * can.
 *
 * ⚠ NOT IN THE WINDOW IS NOT ZERO. The feed is at most 200 events over about
 * six hours. A player absent from it may simply not have appeared in what we
 * hold, so this says that rather than reporting a nil — a fabricated zero about
 * a real player is the worst answer available here.
 */
async function buildPlayerStatAnswer(message: string, locale?: string): Promise<string | null> {
  const family = detectStatFamily(message)
  if (!family) return null

  /* Leaderboard questions belong to the other builder. */
  if (/\b(most|lead|leads|leading|leader|leaderboard|top)\b/i.test(message)) return null

  const { leaders, eventsScanned } = await readStatLeaders(family, 200)

  /* No feed at all — defer to the refusal, which says why. */
  if (eventsScanned === 0) return null

  const player = findPlayerInText(leaders, message)
  if (!player) {
    /*
     * A stat question naming nobody we can see. Only answer it if the asker
     * clearly named someone; otherwise let the refusal handle it.
     */
    return null
  }

  const label = FAMILY_LABEL[family]
  const team = player.team ? ` (${player.team})` : ''

  if (locale === 'es') {
    return `${player.playerName}${team}: ${player.total} ${label} en las ${eventsScanned} jugadas en vivo que tengo de las últimas horas. No son totales de temporada.`
  }
  return `${player.playerName}${team} has ${player.total} ${label} in the ${eventsScanned} live plays I have from the last few hours. That is the live window, not a season total — if they played earlier outside it, this will undercount.`
}

function buildUnsupportedStatEventAnswer(message: string, locale?: string): string | null {
  if (!detectUnsupportedStatEventQuestion(message)) return null
  return `${reliableUnavailable(locale)} I need cached play-by-play/player event data before I can answer that exact stat question. I will not invent home runs, touchdowns, player stats, goals, injuries, or box-score details.`
}

function buildWorldCupScoringAnswer(locale?: string): string {
  const s = DEFAULT_WORLD_CUP_SCORING
  const base =
    `World Cup bracket scoring is supported in AllFantasy. Standard scoring rewards later rounds more heavily: ` +
    `Round of 32 ${s.roundOf32Points} points, Round of 16 ${s.roundOf16Points}, quarterfinals ${s.quarterFinalPoints}, semifinals ${s.semiFinalPoints}, finals ${s.finalPoints}, and a ${s.championBonusPoints}-point champion bonus` +
    `${s.thirdPlacePoints ? `, with ${s.thirdPlacePoints} points for third-place picks` : ""}. ` +
    `Group-stage picks matter for building the knockout bracket and pool strategy. If you open a specific World Cup pool, I can use that pool's saved settings, leaderboard, and your picks for a pool-specific answer.`

  if (locale === 'es') {
    return `La puntuación de brackets del Mundial sí está soportada en AllFantasy. La puntuación estándar vale más en rondas posteriores: Ronda de 32 ${s.roundOf32Points}, Ronda de 16 ${s.roundOf16Points}, cuartos ${s.quarterFinalPoints}, semifinales ${s.semiFinalPoints}, final ${s.finalPoints}, y bono de campeón de ${s.championBonusPoints}. Abre un pool específico para que use sus ajustes, tabla y tus picks.`
  }
  return base
}

function buildUnsupportedLiveWorldCupAnswer(locale?: string): string {
  if (locale === 'es') {
    return "No tengo datos frescos y confiables del proveedor en vivo para eso ahora mismo. Puedo ayudarte con reglas de puntuación, picks guardados, leaderboard del pool y contexto visible del bracket sin cobrar tokens por datos no disponibles."
  }
  return "I don't have fresh live provider data for that right now. I can still help with World Cup scoring rules, saved bracket picks, pool standings, and visible pool context, and this unavailable-data answer should not charge tokens."
}

/**
 * Check whether the message can be answered deterministically.
 *
 * Returns the deterministic answer string, or null if the pipeline should run.
 *
 * Current shortcuts:
 * 1. Schedule question with no schedule data in the DB →
 *    returns the guardrail refusal without calling any provider.
 *
 * @param message  The user's message.
 * @param locale   The user's selected locale (af_lang cookie value). Defaults to 'en'.
 */
export async function tryDeterministicAnswer(message: string, locale?: string): Promise<string | null> {
  const safeLocale = resolveLanguage(locale)
  const intentRoute = resolveChimmyIntentRoute(message)
  if (/\bwhen\s+(does|is|do).*\bworld\s*cup\b.*\b(start|begin|kick\s*off)|\bworld\s*cup\b.*\b(start|begin|kick\s*off)\b/i.test(message)) {
    return buildWorldCupStartAnswer(safeLocale)
  }
  const teamResult = await buildTeamResultAnswer(message)
  if (teamResult) return teamResult
  const fantasyCalcValue = await buildFantasyCalcValueAnswer(message)
  if (fantasyCalcValue) return fantasyCalcValue
  const weather = await buildCachedWeatherAnswer(message, safeLocale)
  if (weather) return weather
  const injuries = await buildCachedInjuryAnswer(message, safeLocale)
  if (injuries) return injuries
  const news = await buildCachedNewsAnswer(message, safeLocale)
  if (news) return news
  /*
   * Try to ANSWER the stat question before refusing it. The refusal below is
   * correct when there is no play-by-play in the window, and was previously the
   * only outcome — even while the feed held the answer. Data first, refusal as
   * the fallback, never the other way round.
   */
  const statLeaders = await buildStatLeaderAnswer(message, safeLocale)
  if (statLeaders) return statLeaders
  /* One named player, before the blanket refusal that used to swallow these. */
  const playerStat = await buildPlayerStatAnswer(message, safeLocale)
  if (playerStat) return playerStat
  const unsupportedStatEvent = buildUnsupportedStatEventAnswer(message, safeLocale)
  if (unsupportedStatEvent) return unsupportedStatEvent
  /* Forward-looking first: the cached path below only knows about today. */
  const upcoming = await buildUpcomingGamesAnswer(message)
  if (upcoming) return upcoming
  const cachedGames = await buildCachedGamesAnswer(message)
  if (cachedGames) return cachedGames
  if (intentRoute.category === 'world_cup_scoring') {
    return buildWorldCupScoringAnswer(safeLocale)
  }
  if (intentRoute.category === 'unsupported_live_data') {
    return buildUnsupportedLiveWorldCupAnswer(safeLocale)
  }
  if (detectScheduleQuestion(message)) {
    const hasContext = await checkScheduleContextAvailable()
    if (!hasContext) {
      return SCHEDULE_REFUSAL_BY_LOCALE[safeLocale] ?? SCHEDULE_REFUSAL_BY_LOCALE.en
    }
  }
  return null
}

/** Metadata marker for deterministic responses. */
export const DETERMINISTIC_SOURCE = 'deterministic' as const
