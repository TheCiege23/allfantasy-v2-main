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
// BUG-1: read the league instead of guessing from the question. `leagueValueFormat` is a pure
// module (one import) rather than `grounding/packet`, whose 17 imports include ChimmyContextEngine
// — this path runs on EVERY chat message, including the ones that never build a packet.
import { createLeagueOsLoaders } from '@/lib/decision-os/league-os'
import { deriveValueFormat, deriveLeagueSizeAndPpr } from '@/lib/decision-os/grounding/leagueValueFormat'
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db'
import { looksLikeTradeTargetQuestion, namesBothSidesOfTrade } from '@/lib/chimmy/tradeTargetQuestion'
import { getEnrichedNewsFeed } from '@/lib/fantasy-news-aggregator/FantasyNewsAggregatorService'
import { listInjuryFacts } from '@/lib/injuries/injuryReadPort'
import { getCachedGameWeather } from '@/lib/weather/weatherService'
import { resolveLanguage } from '@/lib/i18n/constants'
import { getFantasyDayWindowUTC } from '@/lib/time-engine/windows'
import { detectUpcomingIntent, findUpcomingGames } from '@/lib/ai/upcomingGames'
import { dedupeFixtures } from '@/lib/sports/dedupeFixtures'
import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import { LIVE_SCORE_SOURCES, pickFreshestSourceRows } from '@/lib/scores/liveSourceSelection'
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
  /\b(?:what|which|any)\b[^?]*\bgames?\b[^?]*\b(?:right now|currently|live)\b/i,
]

export function detectScheduleQuestion(message: string): boolean {
  return SCHEDULE_PATTERNS.some((p) => p.test(message))
}

// ── Personal / cross-league scope detection ───────────────────────────────────

/*
 * 🛑 A BARE "TONIGHT" HIJACKED A QUESTION ABOUT THE USER'S OWN LEAGUES.
 *
 * Measured in production 2026-09-17:
 *
 *   Q  "seeing as there is a game tonight, how many leagues do I have fantasy
 *       players playing tonight? as a starter? for NFL"
 *   A  "Here are the cached NFL games I can verify for that window:
 *       - Detroit Lions @ Buffalo Bills: score TBD (scheduled) — Sep 17, 8:15 PM EDT"
 *
 * TWO patterns caught it independently. `buildCachedGamesAnswer` falls back to a
 * bare `\btonight\b` anywhere in the message, and SCHEDULE_PATTERNS' `games?\s+
 * (today|tonight)` matches the incidental "a game tonight," clause the user only
 * wrote as context. So a cross-league roster question came back as a fixture list
 * — returned as `kind: 'answer'`, which short-circuits the whole pipeline before
 * the tool loop that could have answered it ever runs.
 *
 * ⚠ A SCHEDULE DUMP IS NEVER THE ANSWER TO A FIRST-PERSON ROSTER QUESTION. The
 * fixtures are part of the answer, but only joined to the asker's own starters —
 * which is `get_my_starters_playing`'s job, not this module's. These builders
 * yield so the pipeline can do it properly.
 *
 * ⚠ SCOPED TO THE SCHEDULE BUILDERS, deliberately NOT hoisted into the top-level
 * bail-out in `tryDeterministicAnswerDetailed`. Returning null for the whole
 * module would also discard the cached weather, injury, news and value answers,
 * several of which are naturally asked in exactly this first person ("what is my
 * guy worth") and are answered correctly today.
 */
const PERSONAL_SCOPE_PATTERNS: RegExp[] = [
  /\bdo\s+i\s+have\b/i,
  /\bam\s+i\s+(?:starting|playing|start)\b/i,
  /\b(?:how\s+many|which|any)\s+of\s+(?:my|our)\b/i,
  /*
   * ⚠ THE FIRST PERSON IS NOT OPTIONAL HERE. This was written as
   * `how many (?:of )?(?:my )?leagues?` and the control caught it: with `my`
   * optional it also matched "how many leagues does the NFL have", a pure world
   * question, which would have suppressed the cached fixture answer for it.
   * Requiring an explicit "I" is what separates the two.
   */
  /\bhow\s+many\s+leagues?\b[^?]*\b(?:i\s+(?:have|am|play|start)|(?:do|did|am|have)\s+i)\b/i,
  /\b(?:my|our)\s+(?:\w+\s+){0,2}(?:leagues?|rosters?|lineups?|starters?|bench)\b/i,
  /\bas\s+a\s+starter\b/i,
  /\bin\s+(?:my|our)\s+lineups?\b/i,
]

/**
 * Is this a question about the ASKER'S OWN teams rather than about the world?
 *
 * Deliberately narrow: it needs a first-person reference to a league, a lineup or
 * a starter. "Who is playing tonight" stays a world question and still gets the
 * cached fixture list; "do I have anyone playing tonight" does not.
 */
export function isPersonalRosterScoped(message: string): boolean {
  return PERSONAL_SCOPE_PATTERNS.some((p) => p.test(message))
}

/*
 * 🛑 "WHAT GAMES ARE ON RIGHT NOW" IS NOT A SCHEDULE QUESTION, AND TREATING IT AS ONE
 * REPORTS A LIVE SLATE AS EMPTY.
 *
 * Measured in production: "what college football games are on right now?" was not recognised
 * as a live-game request, so it reached the model, which reached for the only games tool there
 * is — a FORWARD-looking schedule tool that excludes anything already kicked off. ESPN's own
 * scoreboard was showing live college football at that moment. The answer was "none", and it
 * was produced by a tool that is incapable of returning a game in progress.
 *
 * ⚠ The failure was NOT a timezone bug, which is the first thing this looks like. A UTC/Eastern
 * error moves games by hours; this dropped exactly the games that had STARTED, which is the
 * signature of a forward-only window, not of an offset.
 */
const LIVE_GAMES_PATTERNS: RegExp[] = [
  /\b(?:what|which|any)\b[^?]*\bgames?\b[^?]*\b(?:right now|currently|live)\b/i,
  /\bgames?\s+(?:are\s+)?(?:on|playing|live|in[- ]progress)(?:\s+right)?\s+now\b/i,
  /\bwho(?:'s|\s+is)\s+playing(?:\s+right)?\s+now\b/i,
  /\blive\s+(?:[a-z]+\s+){0,3}games?\b/i,
]

export function detectLiveGamesQuestion(message: string): boolean {
  return LIVE_GAMES_PATTERNS.some((pattern) => pattern.test(message))
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

/*
 * ⚠ A CACHE MISS AND A CACHE HIT COME BACK FROM THE SAME BUILDER AS THE SAME
 * TYPE, which is how "live World Cup odds and injuries" got answered with
 * "I do not have cached SOCCER injury data" instead of the unsupported-live-data
 * refusal the router had already chosen for it: the injury builder runs first,
 * matched on the word "injuries", missed, and its miss ended the dispatch.
 *
 * This asks the ONE function that produces every such miss prefix whether a
 * given string is one. Deliberately not a regex over the miss wording — a
 * second implementation of that rule is how the wording and the test drift
 * apart, which is the bug this repairs.
 */
function isReliableUnavailableMiss(text: string, locale?: string): boolean {
  return text.startsWith(reliableUnavailable(locale))
}

function detectNewsQuestion(message: string): boolean {
  return /\b(news|latest|updates?|headlines?|report|reports|what happened|breaking)\b/i.test(message)
}

/*
 * 🛑 A BARE `out` MADE EVERY PHRASAL VERB AN INJURY QUESTION.
 *
 * This matched `\bout\b` anywhere, so "help me figure out my flex spot" and "check out this
 * trade offer" were answered with the six newest league-wide NFL injury rows, signed as a
 * sourced report and returned as `kind: 'answer'` — which short-circuits the pipeline before
 * the tool loop that could actually have read the asker's roster.
 *
 * "out" is an injury word only as a STATUS: "is he out", "who's out", "ruled out",
 * "out for the season". Those are matched by shape below; the verb particle is not.
 */
const INJURY_WORD_PATTERN =
  /\b(injur(?:y|ies|ed)|hurt|questionable|doubtful|suspension|suspended|availability|inactives?|ruled\s+out|day[- ]to[- ]day)\b/i
const OUT_STATUS_PATTERNS: RegExp[] = [
  /* "is Mahomes out", "who's out", "are any of them out" — a copula before `out`, not "of" after it. */
  /\b(?:is|are|was|were|be|been|being|who's|whos|he's|she's|anyone|anybody)\s+(?:[\w'.-]+\s+){0,2}out\b(?!\s+(?:of|there|here)\b)/i,
  /\bout\s+for\s+(?:the\s+)?(?:season|year|week|game|month|playoffs|tonight|sunday|monday|thursday)\b/i,
  /\bout\s+(?:this|next)\s+week\b/i,
  /\bout\s+(?:tonight|today|indefinitely)\b/i,
]

function detectInjuryQuestion(message: string): boolean {
  return INJURY_WORD_PATTERN.test(message) || OUT_STATUS_PATTERNS.some((p) => p.test(message))
}

/*
 * 🛑 "WHO'S OUT IN MY LEAGUES" WAS ANSWERED WITH SOMEBODY ELSE'S PLAYERS.
 *
 * The injury builder has no user and no league — it can only list sport-wide rows. A
 * first-person roster question ("any injuries on my team", "my RB is out, who do I pick up")
 * therefore got the six newest NFL injuries across the whole league, none necessarily on the
 * asker's roster, stated as the answer. That is a confident false answer, not a partial one.
 *
 * So these yield (return null) and the pipeline answers from the user's own rosters. A
 * NAMED player still gets the cached row even in the first person ("is my guy Josh Allen
 * hurt") — that lookup is about the player, and the cache answers it correctly.
 *
 * ⚠ Broader than `isPersonalRosterScoped` on purpose, and kept separate from it: that
 * predicate gates the SCHEDULE builders, where "my team" can legitimately mean a real-world
 * team the user follows. Here there is no reading of "injuries on my team" the cache answers.
 */
const OWN_ROSTER_PATTERNS: RegExp[] = [
  /\b(?:my|our)\s+(?:[\w'-]+\s+){0,2}(?:teams?|players?|guys|squads?|rosters?|lineups?|starters?|bench|leagues?|rb|rbs|wr|wrs|qb|qbs|te|tes|flex|kicker|dst|def|defense)\b/i,
  /\bon\s+my\s+(?:[\w'-]+\s+){0,2}(?:team|roster)\b/i,
]

function isOwnRosterQuestion(message: string): boolean {
  return isPersonalRosterScoped(message) || OWN_ROSTER_PATTERNS.some((p) => p.test(message))
}

/**
 * "Who's out in my leagues" — an injury question about the asker's OWN rosters, with no named
 * player. The ONE rule for it: the injury builder below yields on it, and the chat route uses it
 * to decide when to run the cross-league roster injury check (myRosterInjuriesTool.ts). Two
 * copies of this would drift, and the two callers must agree on which questions they own.
 */
export function isOwnRosterInjuryQuestion(message: string): boolean {
  return detectInjuryQuestion(message) && !extractLikelyPlayerName(message) && isOwnRosterQuestion(message)
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

/*
 * ── WHICH STAT QUESTIONS THE STORED-STATS TOOLS OWN (2026-09-23) ─────────────────────────────
 *
 * Chimmy now has tools over our stored NFL and college football stats (season totals, NFL game
 * logs, season leaders, standings — lib/chimmy/tools/realStatsTools.ts). They run in the tool
 * loop, which runs AFTER this module — so anything this module answers or refuses never reaches
 * them. Two things intercepted them:
 *
 *   - the live-window builders answered "who leads the NFL in rushing" / "how many TDs does Allen
 *     have this season" from the last few hours of plays (correctly caveated, still the wrong
 *     question), and
 *   - the blanket stat refusal turned every season question into a paid web search while the
 *     answer sat in fantasy_stat_lines.
 *
 * So the live window answers only questions about NOW, and the refusal yields for stored-sport
 * questions about a SEASON or a WEEK (or, for the daily sports, "last night"). Sports we do not
 * store — soccer, the WNBA — keep the refusal and its web-search escalation.
 */
const LIVE_WINDOW_CUE = /\b(today|tonight|right now|currently|live|in the game|this game)\b/i

const SEASON_OR_WEEK_CUE =
  /\b(this season|season|this year|so far|last week|last night|week\s*\d+|last \d+ games?|last game|last start|career|leads? the (nfl|nba|nhl|mlb|majors|league|nation|country)|in the (nfl|nba|nhl|mlb|majors)|college football|college basketball|ncaa|cfb|cbb)\b/i

/*
 * Phase 3 (2026-09-24) stores MLB / NBA / NHL too, so those questions now belong to the same
 * tools. What still keeps the refusal (and its web-search escalation) is the sports we do NOT
 * store: soccer and the WNBA. "goals" alone is NOT here — it is the NHL's headline stat — so a
 * soccer question has to name soccer (EPL, MLS, …) to be refused.
 */
const UNSTORED_SPORT_STAT_CUE =
  /\b(wnba|mls|soccer|futbol|fútbol|premier league|epl|la ?liga|serie a|bundesliga|champions league|world cup|goalscorers?)\b/i

export function isLiveWindowStatQuestion(message: string): boolean {
  return LIVE_WINDOW_CUE.test(message)
}

export function isStoredStatsQuestion(message: string): boolean {
  return SEASON_OR_WEEK_CUE.test(message) && !UNSTORED_SPORT_STAT_CUE.test(message) && !LIVE_WINDOW_CUE.test(message)
}

/** @deprecated The stored stats now cover MLB / NBA / NHL too; use `isStoredStatsQuestion`. */
export const isStoredFootballStatsQuestion = isStoredStatsQuestion

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
  /* The weather resolver already carries all 32 NFL clubs. Reuse that complete
   * registry for results and schedules too, instead of maintaining a second
   * three-team NFL list that silently excluded ordinary questions about the Jets. */
  if (!sport || sport === 'NFL') {
    for (const team of NFL_TEAM_ABBREV_ALIASES) {
      if (team.aliases.some((alias) => new RegExp(`\\b${alias.replace(/\s+/g, '\\s+')}\\b`, 'i').test(lower))) {
        return { canonical: team.label, aliases: [...new Set([...team.aliases, team.abbrev])] }
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

type CurrentGameRow = {
  sport: string
  externalId: string
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  status: string | null
  startTime: Date | null
  fetchedAt: Date | null
  source: string | null
  /** Selected so pickFreshestSourceRows can choose one source per season-week. */
  season?: number | null
  week?: number | null
}

const LIVE_GAME_LOOKBACK_MS = 8 * 60 * 60 * 1_000
const LIVE_GAME_LOOKAHEAD_MS = 18 * 60 * 60 * 1_000
const LIVE_GAME_STALE_MS = 5 * 60 * 1_000

/**
 * Fast, DB-only answer for "what games are on right now?". This must run BEFORE the
 * model/tool loop: the tool set only has a forward-looking schedule tool, which excludes
 * games after kickoff and so can turn a live slate into "none".
 *
 * ⚠ STALENESS IS A REFUSAL, NOT AN EMPTY SLATE. The two are indistinguishable downstream
 * and only one of them is honest: a feed that stopped updating an hour ago cannot tell you
 * nothing is live, it can only tell you it does not know. So an old cache returns
 * `reliable: false` — which the dispatcher types `refusal`, letting the route escalate —
 * rather than the far more damaging "no games are on".
 */
async function buildCurrentGamesAnswer(
  message: string,
  locale?: string,
): Promise<{ text: string; reliable: boolean } | null> {
  if (!detectLiveGamesQuestion(message)) return null

  const sport = resolveSportFromMessage(message)
  const now = new Date()
  const rows = await (prisma as any).sportsGame?.findMany?.({
    where: {
      ...(sport ? { sport } : {}),
      startTime: {
        gte: new Date(now.getTime() - LIVE_GAME_LOOKBACK_MS),
        lte: new Date(now.getTime() + LIVE_GAME_LOOKAHEAD_MS),
      },
      /*
       * Ranked live feeds only — the same set as the public scoreboard reader. Without this the
       * query also returned `cfbd`, which has no live status at all.
       */
      source: { in: [...LIVE_SCORE_SOURCES] },
    },
    orderBy: { startTime: 'asc' },
    take: 1200,
    select: {
      sport: true,
      externalId: true,
      homeTeam: true,
      awayTeam: true,
      homeScore: true,
      awayScore: true,
      status: true,
      startTime: true,
      fetchedAt: true,
      source: true,
      /*
       * ⚠ Selected so pickFreshestSourceRows can choose per season-week. Without them every row
       * shares one slice, the old whole-call selection returns, and the partial `espn` college
       * slate (24 of 131 week-2 games) wins this answer again.
       */
      season: true,
      week: true,
    },
  }).catch(() => null) as CurrentGameRow[] | null

  const label = sport ?? 'sports'
  if (!rows || rows.length === 0) {
    return {
      reliable: false,
      text: `${reliableUnavailable(locale)} I could not verify the current ${label} slate from the live-score cache.`,
    }
  }

  /*
   * Select the best current provider independently PER SPORT. ESPN is the preferred co-fresh
   * source for NFL/NCAAF because it reports in-progress state; `SportsGame` is unique on
   * (sport, externalId, source), so one fixture carries a row per provider and taking the
   * NEWEST row per fixture would let a later schedule-only writer replace ESPN's live state
   * with "scheduled" — reporting a game in progress as not yet started.
   */
  const selected: CurrentGameRow[] = []
  for (const sportName of [...new Set(rows.map((row) => row.sport))]) {
    const candidates = rows.filter((row) => row.sport === sportName)
    selected.push(...pickFreshestSourceRows(candidates, now.getTime()))
  }

  const fixtures = dedupeFixtures(selected)
  const newestFetchedAt = selected.reduce<Date | null>((latest, row) => {
    if (!row.fetchedAt) return latest
    return !latest || row.fetchedAt > latest ? row.fetchedAt : latest
  }, null)

  if (!newestFetchedAt || now.getTime() - newestFetchedAt.getTime() > LIVE_GAME_STALE_MS) {
    const age = newestFetchedAt ? ` It was last updated ${formatEt(newestFetchedAt)}.` : ''
    return {
      reliable: false,
      text: `${reliableUnavailable(locale)} The ${label} live-score cache is too old to say what is on right now.${age}`,
    }
  }

  const live = fixtures
    .filter((game) => normalizeGameStatus(game.status) === 'live')
    .sort((a, b) => (a.startTime?.getTime() ?? 0) - (b.startTime?.getTime() ?? 0))

  const describe = (game: CurrentGameRow) => {
    const score =
      typeof game.awayScore === 'number' && typeof game.homeScore === 'number'
        ? ` — ${game.awayScore}-${game.homeScore}`
        : ''
    return `- ${game.awayTeam} @ ${game.homeTeam}${score}`
  }
  const asOf = formatEt(newestFetchedAt)

  if (live.length > 0) {
    return {
      reliable: true,
      text: `Live ${label} games as of ${asOf}:\n${live.slice(0, 20).map(describe).join('\n')}\nSource: AllFantasy live-score cache.`,
    }
  }

  const upcoming = fixtures
    .filter((game) => normalizeGameStatus(game.status) === 'scheduled' && game.startTime && game.startTime > now)
    .sort((a, b) => a.startTime!.getTime() - b.startTime!.getTime())
    .slice(0, 3)

  const next = upcoming.length > 0
    ? `\nNext scheduled:\n${upcoming.map((game) => `${describe(game)} — ${formatEt(game.startTime)}`).join('\n')}`
    : ''
  return {
    reliable: true,
    text: `No live ${label} games are showing in the score feed as of ${asOf}.${next}\nSource: AllFantasy live-score cache.`,
  }
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

async function buildTeamResultAnswer(message: string, locale?: string): Promise<string | null> {
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
    /*
     * Routed through `reliableUnavailable` like every other miss in this file, so that
     * ONE predicate can tell a miss from a hit. It previously opened with its own
     * sentence, which made it invisible to `isReliableUnavailableMiss` and therefore
     * typed `answer` — a "we have nothing" reply that told the caller it was data.
     */
    return `${reliableUnavailable(locale)} I have no cached ${sport ?? 'sports'} score for ${team.canonical} from ${targetDay}.`
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
async function buildUpcomingGamesAnswer(message: string, locale?: string): Promise<string | null> {
  /* See isPersonalRosterScoped: their starters are not on this schedule. */
  if (isPersonalRosterScoped(message)) return null
  const intent = detectUpcomingIntent(message, resolveSportFromMessage)
  if (!intent) return null

  const team = resolveTeamAlias(message, intent.sport)
  const scopedIntent = team ? { ...intent, team } : intent
  const { games, alreadyUnderway } = await findUpcomingGames(scopedIntent)

  /*
   * Nothing scheduled is a real answer, and a far better one than widening the
   * search until something matches a question nobody asked.
   */
  if (games.length === 0) {
    const what = [team?.canonical, intent.seasonType === 'pre' ? 'preseason' : null, intent.sport]
      .filter(Boolean)
      .join(' ')
    /*
     * ⚠ `reliableUnavailable()` was called with NO locale here while every sibling passes
     * one, so a Spanish or French caller got the English prefix — and, because the
     * miss predicate compares against the LOCALE's prefix, the miss also failed to be
     * recognised as one for any non-English caller. One missing argument, two bugs.
     */
    return `${reliableUnavailable(locale)} I have no upcoming ${what || 'games'} on the schedule I can verify. Source: cached SportsGame rows.`
  }

  const describe = (game: any) => {
    const kind = game.seasonType === 'pre' ? ' (preseason)' : ''
    const week = typeof game.week === 'number' ? ` · Week ${game.week}` : ''
    const where = game.venue ? ` · ${game.venue}` : ''
    return `- ${game.awayTeam} @ ${game.homeTeam}${kind}${week} — ${formatEt(game.startTime)}${where}`
  }

  const first = games[0]
  const label = `${team?.canonical ?? first.sport}${intent.seasonType === 'pre' ? ' preseason' : ''}`

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
  /* See isPersonalRosterScoped: a fixture list is not an answer about their roster. */
  if (isPersonalRosterScoped(message)) return null
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
   * ⚠ THIS DE-DUPLICATION USED TO DO NOTHING, and the reason is worth keeping.
   * The key included `awayTeam`, so the four provider rows for one fixture —
   * "PIT" from espn_live and "Pittsburgh Steelers" from the other three —
   * hashed apart and every one survived. A user was shown six games for three
   * fixtures, with contradictory scores for each.
   *
   * Team identity now compares the NAMES, because there is no id to join on:
   * `homeTeamId` is null on every source but TheSportsDB, which uses its own
   * id space. See lib/sports/dedupeFixtures.ts.
   */
  const lines = dedupeFixtures(games as any[]).map((game: any) => {
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

/**
 * ── 🛑 THIS USED TO READ THE QUESTION AND CALL IT THE LEAGUE'S SETTINGS (BUG-1) ──────────────
 *
 * Measured in production 2026-09-02 on a league the owner confirms is DYNASTY:
 *
 *   Q  "What's Jeremiyah Love worth in King Gingerbeards SF 2026!!!?"
 *   A  "...FantasyCalc REDRAFT value is 3779 ... Settings: superflex, 12-team PPR."
 *      correct dynasty value 6644 — a 43% understatement of a dynasty asset
 *
 * Four inputs were fabricated and all four were presented as the user's league settings:
 *   isDynasty     /dynasty|keeper|future/i against the MESSAGE
 *   isSuperflex   /superflex|\bsf\b|2qb/i  against the MESSAGE — right only because the league
 *                 NAME happened to contain "SF"
 *   numTeams/ppr  hardcoded in the query
 *   "12-team PPR" a string LITERAL, emitted identically for every league on the platform
 *
 * It signed off "Source: FantasyCalc current values", which made invented settings read as sourced.
 *
 * ⚠ THE PRICE IS THE DEFECT; THE SENTENCE IS ONLY HOW IT ANNOUNCED ITSELF. Deleting the settings
 * line would have silenced the symptom while still serving a redraft price to a dynasty league.
 * So the fix changes what is FETCHED, and the wording follows from it.
 *
 * ⚠ EXPORTED so the behaviour is testable directly. The short-circuit that calls this runs before
 * the grounding packet on every message (`route.ts:1387` vs `1667`), so nothing downstream can
 * correct it — it has to be right here.
 */
export async function buildFantasyCalcValueAnswer(
  message: string,
  /**
   * 🛑 THIS MUST BE AN **AUTHORIZED** LEAGUE ID, NEVER THE RAW REQUEST FIELD.
   * `loadRules` performs no membership check of its own — it is a cache loader, not a guard — so
   * whatever id arrives here is read. The route's obligation is to pass
   * `leagueSnapshot?.id ?? null`, which exists only because membership was proved.
   */
  leagueId?: string | null,
  /**
   * Whether the CALLER named a league at all, independent of whether they may see it.
   *
   * ⚠ WITHOUT THIS THE FALLBACK SENTENCE BECOMES A LIE THE MOMENT THE ID IS WITHHELD. Passing
   * `null` for an unauthorized league would make the answer say "You did not name a league",
   * which is false — they did, they just may not read it. It is deliberately a BOOLEAN and not
   * the id: it says a league was requested without saying which, so `not_member` and `not_found`
   * stay indistinguishable here exactly as they are in the refusal path.
   *
   * Defaults to `leagueId != null` so every existing caller and test keeps its current wording.
   */
  leagueRequested: boolean = leagueId != null,
): Promise<string | null> {
  if (!/\b(trade value|fantasycalc|value|worth)\b/i.test(message)) return null
  /*
   * 🛑 A DECISION IS NOT A PRICE LOOKUP. "Is it worth me trading for Rashee Rice in this league?"
   * matched the word "worth" and was answered with Rice's chart value — free, confident, and not
   * what was asked (user report, 2026-09-16). So was "Should I trade Bijan Robinson for Rashee Rice,
   * is it worth it?", which never reached the trade scenario that compares the two sides.
   *
   * Both step aside here: the first goes to the trade-target verdict, the second to the described-
   * trade scenario. A plain price question ("What is Ja'Marr Chase worth?") names neither shape.
   */
  if (looksLikeTradeTargetQuestion(message) || namesBothSidesOfTrade(message)) return null
  const playerName = extractLikelyPlayerName(message)
  if (!playerName) return null

  /*
   * Read the LEAGUE. `loadRules` is the 60s-TTL Decision OS loader the grounding packet already
   * uses, so a warm league costs nothing and producer and consumer share one derivation.
   * Null on any failure — never a default, because a default here becomes a stated claim below.
   */
  let rules: unknown = null
  if (leagueId) {
    rules = await createLeagueOsLoaders()
      .loadRules(leagueId)
      .catch(() => null)
  }
  const fmt = deriveValueFormat(rules)
  const size = deriveLeagueSizeAndPpr(rules)

  // With no resolvable league we still price the player, but on an explicitly GENERIC basis that
  // the answer names as generic. What we must never do is call it theirs.
  const isDynasty = fmt?.format === 'DYNASTY'
  const numQbs = fmt?.qbFormat === 'SUPERFLEX' ? 2 : 1

  try {
    const values = await getFantasyCalcValuesDbFirst({
      isDynasty,
      numQbs,
      numTeams: size.numTeams ?? 12,
      ppr: size.ppr ?? 1,
    })
    const found = findPlayerByName(values, playerName)
    if (!found) {
      return `I could not find ${playerName} in the FantasyCalc value feed I can access right now.`
    }
    const tier = getValueTier(found.value)
    const trend = `${found.trend30Day > 0 ? '+' : ''}${found.trend30Day}`
    const head =
      `${found.player.name}'s FantasyCalc ${isDynasty ? 'dynasty' : 'redraft'} value is ` +
      `${found.value} (${tier} tier), overall rank #${found.overallRank}, position rank ` +
      `#${found.positionRank}, with a 30-day trend of ${trend}.`

    /*
     * ⚠ THE SETTINGS SENTENCE IS EMITTED ONLY WHEN IT WAS READ. Each clause is included only if
     * the league actually stated it — a partially-known league gets a partial sentence, never a
     * padded one. No league, or unreadable rules, and the claim is replaced by a statement of what
     * basis was used and why, which is the honest version of the same information.
     */
    if (!fmt) {
      const why = leagueRequested
        ? `I could not read that league's settings, so this is the standard 1QB redraft market`
        : `You did not name a league, so this is the standard 1QB redraft market`
      return `${head} ${why}, not your league's. Source: FantasyCalc current values.`
    }
    const parts = [fmt.qbFormat === 'SUPERFLEX' ? 'superflex' : '1QB']
    if (size.numTeams != null) parts.push(`${size.numTeams}-team`)
    if (size.ppr != null) parts.push(size.ppr === 1 ? 'PPR' : size.ppr === 0.5 ? 'half-PPR' : `${size.ppr} per reception`)
    return `${head} Settings read from your league: ${parts.join(', ')}. Source: FantasyCalc current values.`
  } catch {
    return `I do not have reliable FantasyCalc value data for ${playerName} right now.`
  }
}

async function buildCachedNewsAnswer(message: string, locale?: string): Promise<string | null> {
  if (!detectNewsQuestion(message) && !/\bwhat'?s new\b/i.test(message)) return null
  const sport = resolveSportFromMessage(message) ?? 'NFL'
  const playerName = extractLikelyPlayerName(message)
  /*
   * Same reason as the injury builder: a sport-wide feed is never the answer to "news on my
   * players". Without this, "injury updates for my roster" skipped the injury builder only to
   * be caught here by the word "updates" and answered with league-wide headlines.
   */
  if (!playerName && isOwnRosterQuestion(message)) return null
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

const INJURY_ANSWER_MAX_ROWS = 6

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/*
 * 🛑 THIS READ `sportsInjury` DIRECTLY, AND SO SERVED ROWS THE REST OF THE APP HAD RETIRED.
 *
 * It ran its own findMany with no `expiresAt` filter, no report-age bound and no per-player
 * dedupe, ordered by `date` — exactly the ad-hoc read `injuryReadPort` was written to end.
 * Production holds ~2,953 NFL rows frozen at 2026-07-24 from the retired api_sports feed; the
 * port drops them as expired, this builder did not. And it printed no date at all, so a July
 * status read as today's.
 *
 * Now it goes through `listInjuryFacts` (TTL, one row per player, report-age horizon, the
 * no-source verdict) and every line carries its report date, with stale claims flagged.
 */
async function buildCachedInjuryAnswer(message: string, locale?: string): Promise<string | null> {
  if (!detectInjuryQuestion(message)) return null
  const sport = resolveSportFromMessage(message) ?? 'NFL'
  const playerName = extractLikelyPlayerName(message)
  /* See OWN_ROSTER_PATTERNS: the cache cannot answer about the asker's roster. */
  if (isOwnRosterInjuryQuestion(message)) return null
  const team = resolveTeamAlias(message, sport)
  const scope = playerName ? ` for ${playerName}` : team ? ` for ${team.canonical}` : ''

  try {
    const list = await listInjuryFacts({
      sport,
      playerNameContains: playerName,
      limit: playerName ? INJURY_ANSWER_MAX_ROWS : 1000,
    })

    if (!list.coverage.sourceAvailable) {
      return `${reliableUnavailable(locale)} ${list.coverage.reason ?? `No ${sport} injury source is connected.`}`
    }

    /*
     * Team filtering stays alias-substring, the rule the old query used — stored `team`
     * is an abbreviation from one provider and a full name from another, so the port's
     * exact-match `team` argument would miss half of them.
     */
    const facts = (!playerName && team
      ? list.facts.filter((f) => {
          const stored = (f.team ?? '').toLowerCase()
          return stored.length > 0 && team.aliases.some((alias) => stored.includes(alias))
        })
      : list.facts
    ).slice(0, INJURY_ANSWER_MAX_ROWS)

    if (!facts.length) {
      return `${reliableUnavailable(locale)} I do not have current cached ${sport} injury data${scope} right now.`
    }

    const lines = facts.map((f) => {
      const status = f.status ?? f.type ?? 'status unknown'
      const note = f.description ? ` - ${String(f.description).slice(0, 140)}` : ''
      const staleNote = f.stale ? ', may be out of date' : ''
      return `- ${f.playerName}${f.team ? ` (${f.team})` : ''}: ${status}${note} (reported ${isoDay(f.reportedAt)}${staleNote})`
    })

    const caveats: string[] = []
    if (list.feedStale && list.newestFetchedAt) {
      caveats.push(`The injury feed has not refreshed since ${isoDay(list.newestFetchedAt)}, so statuses may have changed.`)
    }
    /* A sport-wide list is not about the asker's players, and must not read as if it were. */
    if (!playerName && !team) {
      caveats.push(`These are the most recent league-wide ${sport} reports, not filtered to your rosters.`)
    }

    return [
      `Cached ${sport} injury report${scope}:`,
      ...lines,
      ...caveats,
      `Source: AllFantasy SportsInjury cache.`,
    ].join('\n')
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
 * A deterministic outcome, and CRUCIALLY which kind it is.
 *
 * ⚠ THE TWO USED TO BE INDISTINGUISHABLE, and that is why an unanswerable
 * question dead-ended. Both an answer and a refusal came back as a bare string,
 * so the route returned either one verbatim and nothing downstream could tell
 * "here is the data" from "we hold no data". A refusal is a statement about our
 * STORAGE, not about the world — someone else may still be able to answer it,
 * and the caller can only try if it knows which one it is holding.
 */
export type DeterministicResult =
  | { kind: 'answer'; text: string }
  | { kind: 'refusal'; text: string }

/**
 * Check whether the message can be answered deterministically.
 *
 * Returns the deterministic result, or null if the pipeline should run.
 *
 * Current shortcuts:
 * 1. Schedule question with no schedule data in the DB →
 *    returns the guardrail refusal without calling any provider.
 *
 * @param message  The user's message.
 * @param locale   The user's selected locale (af_lang cookie value). Defaults to 'en'.
 */
export async function tryDeterministicAnswerDetailed(
  message: string,
  locale?: string,
  /**
   * BUG-1. The route has this resolved at line 1159, two hundred lines before it calls us, and it
   * simply was not passed — which is how the value path ended up guessing league settings from the
   * question text. Optional so every existing caller and test compiles unchanged.
   *
   * 🛑 AUTHORIZED ID ONLY — see `buildFantasyCalcValueAnswer`, which reads the league off it.
   */
  leagueId?: string | null,
  /** Whether the caller named a league, regardless of whether they may read it. */
  leagueRequested: boolean = leagueId != null,
): Promise<DeterministicResult | null> {
  const answer = (text: string): DeterministicResult => ({ kind: 'answer', text })
  const refusal = (text: string): DeterministicResult => ({ kind: 'refusal', text })
  const safeLocale = resolveLanguage(locale)
  /*
   * 🛑 A MISS IS A REFUSAL. IT WAS BEING TYPED AS AN ANSWER, AND THAT SILENCED THE ONE
   * THING THAT CAN ACT ON IT.
   *
   * Nine of the eleven "we have nothing" strings in this file reached the caller as
   * `answer`, because the builders return a plain string and the dispatcher wrapped every
   * non-null string the same way. Only `buildUnsupportedStatEventAnswer` and the schedule
   * refusal were typed honestly.
   *
   * The cost is specific, not cosmetic: app/api/chat/chimmy/route.ts escalates to the
   * citation-required live search ONLY on `kind === 'refusal'`. An `answer` that says "I
   * have no cached NFL injury data" is a dead end that looks like a result — the caller
   * cannot tell it apart from data and will not look further, which is exactly the
   * distinction this result type was introduced to carry.
   *
   * ⚠ Everything user-visible is unchanged. The TEXT is identical; only `kind` moves. And
   * a refusal still costs nothing: the escalation is flag-gated, then checks the spender
   * can pay BEFORE searching and charges only after a sourced answer exists.
   */
  const classify = (text: string): DeterministicResult =>
    isReliableUnavailableMiss(text, safeLocale) ? refusal(text) : answer(text)
  const intentRoute = resolveChimmyIntentRoute(message)
  /*
   * 🛑 FIRST, AND DELIBERATELY AHEAD OF EVERY OTHER BUILDER. A live-game question must never
   * reach `buildUpcomingGamesAnswer` — that path asks a forward-only window and so answers
   * "nothing" for a slate that is mid-game, which is how a live ESPN scoreboard was reported
   * as empty in production.
   *
   * It costs nothing on the other paths: `buildCurrentGamesAnswer` returns null immediately
   * unless `detectLiveGamesQuestion` matches, so the single indexed query only runs for the
   * questions that need it.
   *
   * ⚠ Typed from the builder's OWN `reliable` flag rather than through `classify` below.
   * `classify` infers a miss by testing the text against the locale's `reliableUnavailable`
   * prefix, which is the right tool when all you have is a string; here reliability is known
   * structurally, so say it directly and do not make a second mechanism re-derive it.
   */
  const currentGames = await buildCurrentGamesAnswer(message, safeLocale)
  if (currentGames) {
    return currentGames.reliable ? answer(currentGames.text) : refusal(currentGames.text)
  }
  if (/\bwhen\s+(does|is|do).*\bworld\s*cup\b.*\b(start|begin|kick\s*off)|\bworld\s*cup\b.*\b(start|begin|kick\s*off)\b/i.test(message)) {
    /*
     * Alone among these builders this one is async AND nullable, and its null
     * ends the whole function rather than falling through to the next check —
     * which is what the bare `return` used to express. Kept exactly.
     */
    const worldCupStart = await buildWorldCupStartAnswer(safeLocale)
    return worldCupStart === null ? null : answer(worldCupStart)
  }
  const teamResult = await buildTeamResultAnswer(message, safeLocale)
  if (teamResult) return classify(teamResult)
  const fantasyCalcValue = await buildFantasyCalcValueAnswer(message, leagueId ?? null, leagueRequested)
  if (fantasyCalcValue) return classify(fantasyCalcValue)
  /*
   * DATA STILL WINS. A cache HIT from any of the three builders below is
   * returned exactly as before, for every route. Only a MISS yields, and only
   * when the router has already classified this message as live data we have no
   * provider for — in which case the specific refusal further down is the true
   * answer and the generic "no cached X" line is noise that also happens to be
   * typed `answer`, so it suppresses the live-search escalation at
   * app/api/chat/chimmy/route.ts:1413.
   *
   * ⚠ Do NOT widen this to hoist the category check above these builders.
   * `isWorldCup` in the router is `WORLD_CUP_RE || BRACKET_RE`, and BRACKET_RE
   * alone matches "champion", "bracket", "quarterfinal" — measured 2026-09-11,
   * "Any injuries on the Chiefs playoff bracket?" and "NFL playoff bracket
   * injuries" both classify as unsupported_live_data. Hoisting would answer
   * those with a World Cup refusal while cached NFL injury rows sat unread.
   */
  const preferRouteRefusal = intentRoute.category === 'unsupported_live_data'
  const weather = await buildCachedWeatherAnswer(message, safeLocale)
  if (weather && !(preferRouteRefusal && isReliableUnavailableMiss(weather, safeLocale))) {
    return classify(weather)
  }
  const injuries = await buildCachedInjuryAnswer(message, safeLocale)
  if (injuries && !(preferRouteRefusal && isReliableUnavailableMiss(injuries, safeLocale))) {
    return classify(injuries)
  }
  const news = await buildCachedNewsAnswer(message, safeLocale)
  if (news && !(preferRouteRefusal && isReliableUnavailableMiss(news, safeLocale))) {
    return classify(news)
  }
  /*
   * Try to ANSWER the stat question before refusing it. The refusal below is
   * correct when there is no play-by-play in the window, and was previously the
   * only outcome — even while the feed held the answer. Data first, refusal as
   * the fallback, never the other way round.
   */
  /* Live-window answers only for questions about NOW — see LIVE_WINDOW_CUE. */
  if (isLiveWindowStatQuestion(message)) {
    const statLeaders = await buildStatLeaderAnswer(message, safeLocale)
    if (statLeaders) return classify(statLeaders)
    /* One named player, before the blanket refusal that used to swallow these. */
    const playerStat = await buildPlayerStatAnswer(message, safeLocale)
    if (playerStat) return classify(playerStat)
  }
  /* A season/week stat question belongs to the stored-stats tools downstream. */
  const unsupportedStatEvent = isStoredStatsQuestion(message)
    ? null
    : buildUnsupportedStatEventAnswer(message, safeLocale)
  if (unsupportedStatEvent) return refusal(unsupportedStatEvent)
  /* Forward-looking first: the cached path below only knows about today. */
  const upcoming = await buildUpcomingGamesAnswer(message, safeLocale)
  if (upcoming) return classify(upcoming)
  const cachedGames = await buildCachedGamesAnswer(message)
  if (cachedGames) return classify(cachedGames)
  if (intentRoute.category === 'world_cup_scoring') {
    return answer(buildWorldCupScoringAnswer(safeLocale))
  }
  if (intentRoute.category === 'unsupported_live_data') {
    return refusal(buildUnsupportedLiveWorldCupAnswer(safeLocale))
  }
  /*
   * ⚠ AND THE REFUSAL NEEDS THE SAME GATE AS THE ANSWER. Without it, silencing
   * the fixture list above would only swap one wrong answer for another: "I need
   * live schedule data connected" to somebody who asked about their own roster,
   * which reads as a data outage rather than as the wrong question being answered.
   */
  if (detectScheduleQuestion(message) && !isPersonalRosterScoped(message)) {
    const hasContext = await checkScheduleContextAvailable()
    if (!hasContext) {
      return refusal(SCHEDULE_REFUSAL_BY_LOCALE[safeLocale] ?? SCHEDULE_REFUSAL_BY_LOCALE.en)
    }
  }
  return null
}

/**
 * The string-only view, kept because every existing caller and test wants it.
 *
 * New callers that can DO something about a refusal — ask a live-search path,
 * say — should use `tryDeterministicAnswerDetailed` instead; this signature
 * throws away the one bit that makes that possible.
 */
export async function tryDeterministicAnswer(
  message: string,
  locale?: string,
  /** 🛑 AUTHORIZED ID ONLY — see `buildFantasyCalcValueAnswer`. */
  leagueId?: string | null,
  leagueRequested: boolean = leagueId != null,
): Promise<string | null> {
  return (await tryDeterministicAnswerDetailed(message, locale, leagueId, leagueRequested))?.text ?? null
}

/** Metadata marker for deterministic responses. */
export const DETERMINISTIC_SOURCE = 'deterministic' as const
