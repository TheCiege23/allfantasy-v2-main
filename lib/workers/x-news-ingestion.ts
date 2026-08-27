/**
 * X (Twitter) API News Ingestion Engine
 *
 * Fetches real-time player news from X/Twitter via the Grok search API.
 * Categories: injuries, suspensions, trades, signings, team news, player news.
 * Results are persisted to PlayerNewsRecord and InjuryReportRecord tables.
 * Cached until new updates arrive for each player.
 *
 * Flow:
 * 1. Cron runs every 5-15 minutes (configurable)
 * 2. Searches X for sport-specific keywords
 * 3. Deduplicates against existing records
 * 4. Classifies by category (injury, trade, signing, suspension, etc.)
 * 5. Persists to DB
 * 6. Triggers notifications for affected rostered players
 */

import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import {
  classifyPlayerNewsCategory,
  type PlayerNewsCategory,
} from '@/lib/news/player-news-category'
// Aliased: this file already has a private `searchXForNews` that predates the
// real one and passes `web_search` rather than `x_search`.
import {
  searchXForNews as searchSubjectOnX,
  type XNewsKind,
  type XNewsResult,
} from '@/lib/ai/xNewsSearch'

export type { PlayerNewsCategory as NewsCategory } from '@/lib/news/player-news-category'

export type XNewsItem = {
  headline: string
  body: string
  playerName: string | null
  team: string | null
  sport: string
  category: PlayerNewsCategory
  impact: 'high' | 'medium' | 'low'
  source: string
  sourceUrl: string | null
  publishedAt: Date
}

// Sport-specific search queries for X API
const SPORT_SEARCH_QUERIES: Record<string, string[]> = {
  nfl: [
    '(injury OR injured OR ruled out OR questionable OR doubtful OR IR OR concussion) (NFL) -fantasy -DFS -bet',
    '(traded OR trade OR signs OR signed OR released OR waived OR cut) (NFL) -fantasy -mock',
    '(suspended OR suspension) (NFL)',
    '(placed on IR OR injured reserve OR out for season) (NFL)',
  ],
  nba: [
    '(injury OR injured OR out tonight OR GTD OR game-time decision OR ruled out) (NBA)',
    '(traded OR trade OR signs OR signed OR released OR waived) (NBA)',
    '(suspended OR suspension) (NBA)',
    '(load management OR rest OR sitting out) (NBA)',
  ],
  mlb: [
    '(injured list OR IL OR day-to-day OR TJS OR Tommy John) (MLB)',
    '(traded OR trade OR signs OR signed OR DFA OR designated for assignment) (MLB)',
    '(suspended OR suspension) (MLB)',
  ],
  nhl: [
    '(injury OR injured OR day-to-day OR LTIR OR IR) (NHL)',
    '(traded OR trade OR signs OR signed OR waived) (NHL)',
    '(suspended OR suspension) (NHL)',
  ],
  ncaaf: [
    '(injury OR injured OR out for season OR transfer portal) (college football OR CFB)',
    '(transfer portal OR commits OR decommits) (college football)',
  ],
  ncaab: [
    '(injury OR injured OR out OR transfer portal) (college basketball OR CBB)',
    '(transfer portal OR commits) (college basketball)',
  ],
  soccer: [
    '(injury OR injured OR ruled out OR doubtful) (Premier League OR La Liga OR Serie A OR Bundesliga)',
    '(transfer OR signs OR signed OR loan) (Premier League OR La Liga)',
  ],
}

// Impact classification
const HIGH_IMPACT_KEYWORDS = ['ruled out', 'out for season', 'traded', 'suspended', 'released', 'placed on IR', 'ACL', 'torn', 'fracture', 'surgery', 'TJS']
const MEDIUM_IMPACT_KEYWORDS = ['questionable', 'doubtful', 'day-to-day', 'signed', 'extension', 'limited', 'DNP']

/**
 * Run the X API news ingestion for all sports.
 * Called by cron every 5-15 minutes.
 */
export async function runXNewsIngestion(sports?: string[]): Promise<{
  fetched: number
  newRecords: number
  duplicatesSkipped: number
  injuryRecords: number
  errors: string[]
}> {
  const targetSports = sports ?? Object.keys(SPORT_SEARCH_QUERIES)
  let fetched = 0
  let newRecords = 0
  let duplicatesSkipped = 0
  let injuryRecords = 0
  const errors: string[] = []

  for (const sport of targetSports) {
    const queries = SPORT_SEARCH_QUERIES[sport]
    if (!queries) continue

    for (const query of queries) {
      try {
        const items = await searchXForNews(query, sport)
        fetched += items.length

        for (const item of items) {
          const persisted = await persistNewsItem(item)
          if (persisted === 'new') {
            newRecords++
            // If it's an injury, also create/update injury record
            if (item.category === 'injury' && item.playerName) {
              await persistInjuryFromNews(item)
              injuryRecords++
            }
          } else if (persisted === 'duplicate') {
            duplicatesSkipped++
          }
        }
      } catch (e) {
        errors.push(`${sport}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  return { fetched, newRecords, duplicatesSkipped, injuryRecords, errors }
}

/**
 * Search X/Twitter for news using Grok's search capabilities.
 */
async function searchXForNews(query: string, sport: string): Promise<XNewsItem[]> {
  try {
    const { xaiResponsesJson, parseTextFromXaiResponse } = await import('@/lib/xai-client')

    const result = await xaiResponsesJson({
      model: 'grok-3-mini',
      messages: [
        {
          role: 'user',
          content: `Search X/Twitter for the latest fantasy sports news. Extract player names, teams, and categorize each result.\n\nSearch query: ${query}\n\nFor each result, return JSON array with objects containing: headline, playerName, team, category (injury/trade/signing/suspension/release/roster_move), impact (high/medium/low), body (brief summary).`,
        },
      ],
      tools: [{ type: 'web_search' as const }],
    })

    if (!result.ok) return []

    // Responses API returns structured output on result.json.output — pull the
    // text payload via the shared helper and hand it to the parser.
    const outputText = parseTextFromXaiResponse(result.json)
    if (!outputText) return []

    return parseXNewsResponse(outputText, sport)
  } catch (e) {
    console.warn(`[x-news] Search failed for ${sport}:`, e instanceof Error ? e.message : String(e))
    return []
  }
}

/**
 * Parse Grok's response into structured news items.
 */
function parseXNewsResponse(output: unknown, sport: string): XNewsItem[] {
  const items: XNewsItem[] = []

  // Extract text from response
  let text = ''
  if (typeof output === 'string') {
    text = output
  } else if (Array.isArray(output)) {
    text = output.map((o) => {
      if (typeof o === 'string') return o
      if (typeof o === 'object' && o !== null && 'text' in o) return String((o as { text: unknown }).text)
      return JSON.stringify(o)
    }).join('\n')
  } else if (typeof output === 'object' && output !== null) {
    text = JSON.stringify(output)
  }

  // Try to extract JSON array from response
  const jsonMatch = text.match(/\[[\s\S]*?\]/g)
  if (jsonMatch) {
    for (const match of jsonMatch) {
      try {
        const arr = JSON.parse(match) as Array<Record<string, unknown>>
        for (const obj of arr) {
          if (!obj.headline && !obj.playerName) continue
          items.push({
            headline: String(obj.headline ?? obj.title ?? ''),
            body: String(obj.body ?? obj.summary ?? obj.description ?? ''),
            playerName: obj.playerName ? String(obj.playerName) : null,
            team: obj.team ? String(obj.team) : null,
            sport: normalizeToSupportedSport(sport),
            category: classifyPlayerNewsCategory(String(obj.headline ?? ''), String(obj.body ?? '')),
            impact: classifyImpact(String(obj.headline ?? '') + ' ' + String(obj.body ?? '')),
            source: 'x_grok_search',
            sourceUrl: obj.url ? String(obj.url) : null,
            publishedAt: new Date(),
          })
        }
      } catch { /* not valid JSON array, skip */ }
    }
  }

  // If no JSON found, try to extract from plain text
  if (items.length === 0 && text.length > 20) {
    const lines = text.split('\n').filter((l) => l.trim().length > 10)
    for (const line of lines.slice(0, 10)) {
      const playerMatch = line.match(/([A-Z][a-z]+ [A-Z][a-z]+)/)
      if (playerMatch) {
        items.push({
          headline: line.trim().slice(0, 200),
          body: line.trim(),
          playerName: playerMatch[1],
          team: null,
          sport: normalizeToSupportedSport(sport),
          category: classifyPlayerNewsCategory(line, ''),
          impact: classifyImpact(line),
          source: 'x_grok_search',
          sourceUrl: null,
          publishedAt: new Date(),
        })
      }
    }
  }

  return items.slice(0, 20) // Max 20 items per query
}

function classifyImpact(text: string): 'high' | 'medium' | 'low' {
  const lower = text.toLowerCase()
  if (HIGH_IMPACT_KEYWORDS.some((kw) => lower.includes(kw))) return 'high'
  if (MEDIUM_IMPACT_KEYWORDS.some((kw) => lower.includes(kw))) return 'medium'
  return 'low'
}

/**
 * Persist a news item to the database, deduplicating by headline + player + time.
 */
async function persistNewsItem(item: XNewsItem): Promise<'new' | 'duplicate' | 'error'> {
  if (!item.headline.trim()) return 'error'

  // Check for recent duplicate (same player + similar headline in last 4 hours)
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000)
  const existing = await prisma.playerNewsRecord.findFirst({
    where: {
      sport: item.sport,
      playerName: item.playerName ?? undefined,
      headline: item.headline,
      publishedAt: { gte: fourHoursAgo },
    },
  }).catch(() => null)

  if (existing) return 'duplicate'

  await prisma.playerNewsRecord.create({
    data: {
      sport: item.sport,
      playerId: null,
      // PlayerNewsRecord.playerName is a non-nullable String column; coerce
      // null items (unattributed headlines) to an empty string. Downstream
      // notification dispatch filters these out via a trim check.
      playerName: item.playerName ?? '',
      team: item.team,
      headline: item.headline,
      body: item.body.slice(0, 2000),
      impact: item.impact,
      fantasyRelevant: true,
      source: item.source,
      publishedAt: item.publishedAt,
    },
  }).catch((e) => {
    console.warn('[x-news] Insert failed (likely duplicate):', e instanceof Error ? e.message : '')
  })

  return 'new'
}

/**
 * Create/update an injury record from a news item.
 */
async function persistInjuryFromNews(item: XNewsItem): Promise<void> {
  if (!item.playerName) return

  const lower = item.headline.toLowerCase() + ' ' + item.body.toLowerCase()

  // Determine injury status
  let status = 'Unknown'
  if (lower.includes('ruled out') || lower.includes('out for')) status = 'Out'
  else if (lower.includes('doubtful')) status = 'Doubtful'
  else if (lower.includes('questionable')) status = 'Questionable'
  else if (lower.includes('day-to-day')) status = 'Day-to-Day'
  else if (lower.includes('placed on ir') || lower.includes('injured reserve')) status = 'IR'
  else if (lower.includes('concussion')) status = 'Concussion Protocol'
  else if (lower.includes('limited')) status = 'Limited'

  // Determine body part
  let bodyPart = 'Undisclosed'
  const bodyParts = ['hamstring', 'knee', 'ankle', 'shoulder', 'back', 'groin', 'calf', 'hip', 'wrist', 'elbow', 'foot', 'neck', 'ribs', 'quad', 'achilles', 'thumb', 'finger', 'toe', 'hand', 'arm', 'leg']
  for (const part of bodyParts) {
    if (lower.includes(part)) { bodyPart = part.charAt(0).toUpperCase() + part.slice(1); break }
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  await prisma.injuryReportRecord.upsert({
    where: {
      uniq_injury_reports_player_report_status: {
        sport: item.sport,
        playerId: item.playerName, // Use name as ID fallback
        reportDate: today,
        status,
      },
    },
    create: {
      sport: item.sport,
      playerId: item.playerName,
      playerName: item.playerName,
      team: item.team ?? 'UNKNOWN',
      status,
      bodyPart,
      notes: item.headline,
      reportDate: today,
    },
    update: {
      status,
      bodyPart,
      notes: item.headline,
      team: item.team ?? 'UNKNOWN',
    },
  }).catch(() => {})
}

// ─────────────────────────────────────────────────────────────────────────────
// Player-scoped ingestion, via first-party X search
// ─────────────────────────────────────────────────────────────────────────────

/** PlayerNewsRecord.headline is VarChar(256); persistNewsItem does not truncate it. */
const HEADLINE_MAX = 256

/**
 * Deliberately small. Each subject spends — see the cost note on
 * ingestXNewsForPlayers before raising it.
 */
const DEFAULT_MAX_SUBJECTS = 25

/**
 * Convert one search result into PlayerNewsRecord-shaped items.
 *
 * One bullet is one attributed statement, so one bullet is one record. When the
 * model returned prose instead of the requested JSON (parseModelJson's fallback
 * path) there is still a single item worth keeping.
 *
 * Exported for tests: the mapping choices here (what becomes a headline, what
 * `publishedAt` actually means, where citations go now that there is no URL
 * column) are the kind that rot silently.
 */
export function toNewsItems(
  result: Extract<XNewsResult, { ok: true }>,
  ctx: { sport: string; name: string; team: string | null },
): XNewsItem[] {
  // Citations are search-level, not claim-level: every annotation comes back
  // with start_index and end_index 0, so nothing maps a post to the bullet it
  // supports. Attaching the whole list to each row is therefore the only honest
  // representation — and PlayerNewsRecord has no URL column, so they ride in
  // `body` rather than being dropped the way sourceUrl is.
  const sources = result.citations.length
    ? `\n\nSources consulted:\n${result.citations.map((c) => c.url).join('\n')}`
    : ''

  const lines = result.bullets.length > 0 ? result.bullets : result.summary ? [result.summary] : []

  return lines.map((line) => {
    const headline = line.trim().slice(0, HEADLINE_MAX)
    const body = `${result.summary || line}${sources}`
    return {
      headline,
      body,
      // Exact by construction — this is the name we searched for, not one the
      // model extracted. That is the whole point: see the note on the caller.
      playerName: ctx.name,
      team: ctx.team,
      sport: ctx.sport,
      // Both classifiers are deterministic keyword rules. The model never gets
      // to decide category or impact, per the boundary in lib/ai/xNewsSearch.ts.
      category: classifyPlayerNewsCategory(headline, body),
      impact: classifyImpact(`${headline} ${body}`),
      source: 'x_search',
      sourceUrl: result.citations[0]?.url ?? null,
      // NOT when the reporter posted. x_search annotations carry no timestamp,
      // so this is when WE searched. Never render it as "reported at".
      publishedAt: new Date(result.searchedAt),
    }
  })
}

/**
 * Search X for a KNOWN list of players and write the results to PlayerNewsRecord.
 *
 * WHY THIS EXISTS ALONGSIDE runXNewsIngestion. That function sweeps sport-wide
 * keyword queries and asks the model to extract player names from whatever comes
 * back. Decision OS cannot consume most of that: its reader in
 * lib/decision-os/world/port.ts matches `playerName` against roster names with an
 * exact case-insensitive `in` list and no fuzzy fallback, so an extracted name
 * spelled even slightly differently is invisible to it. Here the name is an
 * INPUT, so it matches by construction. That is the difference between rows that
 * reach lineup signals and rows that just sit in the table.
 *
 * It also genuinely searches X. runXNewsIngestion passes `web_search`, not
 * `x_search`, so despite this file's name it has never had first-party X access.
 *
 * COST — READ THIS BEFORE ADDING A CALLER. One subject is not one API call. Grok
 * picks its own retrieval budget and was observed issuing 8-15 server-side
 * x_search calls for a single subject (2026-08-27), each billed. Sweeping one
 * 12-team league's rosters would be thousands of billed searches per run. That is
 * why `players` is an explicit list with a hard cap and there is no "all rostered
 * players" mode: this is an on-demand, narrow-scope tool, not a cron over
 * everyone.
 *
 * Never throws. A disabled spend switch, a provider error and a genuine "no news"
 * are all reported in the return value, because a news lookup failing should
 * degrade a surface, not break the request that asked for it.
 */
export async function ingestXNewsForPlayers(input: {
  sport: string
  players: Array<{ name: string; team?: string | null }>
  kind?: XNewsKind
  lookbackHours?: number
  /** Hard ceiling on subjects searched in one call. Each one spends. */
  maxPlayers?: number
}): Promise<{
  searched: number
  /** Subjects dropped because they exceeded maxPlayers. */
  skipped: number
  newRecords: number
  duplicatesSkipped: number
  injuryRecords: number
  /** Searched successfully and there was genuinely nothing to report. Not errors. */
  noNews: string[]
  errors: string[]
}> {
  // Same normalisation the sweep path writes with, so both produce rows that
  // port.ts's `where: { sport }` finds. It is non-nullable and falls back to a
  // default sport rather than returning null.
  const sport = normalizeToSupportedSport(input.sport)

  const seen = new Set<string>()
  const subjects = input.players.filter((p) => {
    const name = p.name?.trim()
    if (!name) return false
    const key = name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const cap = Math.max(0, input.maxPlayers ?? DEFAULT_MAX_SUBJECTS)
  const targets = subjects.slice(0, cap)

  let newRecords = 0
  let duplicatesSkipped = 0
  let injuryRecords = 0
  const noNews: string[] = []
  const errors: string[] = []

  for (const player of targets) {
    const name = player.name.trim()
    const result = await searchSubjectOnX({
      sport: input.sport,
      subject: name,
      teamName: player.team ?? null,
      // Injury is the kind whose value decays fastest, and the one Decision OS
      // lineup signals actually consume.
      kind: input.kind ?? 'injury',
      lookbackHours: input.lookbackHours,
    })

    if (!result.ok) {
      errors.push(`${name}: ${result.error}`)
      continue
    }
    // A well-formed empty result is a real answer, and writing a row for it
    // would manufacture news that nobody reported.
    if (result.empty) {
      noNews.push(name)
      continue
    }

    for (const item of toNewsItems(result, { sport, name, team: player.team ?? null })) {
      // Counts come from persistNewsItem, which reports 'new' even when its
      // insert is rejected — headlines are truncated above so this path should
      // not be reached, but the number is optimistic by inheritance.
      const persisted = await persistNewsItem(item)
      if (persisted === 'new') {
        newRecords++
        if (item.category === 'injury') {
          await persistInjuryFromNews(item)
          injuryRecords++
        }
      } else if (persisted === 'duplicate') {
        duplicatesSkipped++
      }
    }
  }

  return {
    searched: targets.length,
    skipped: subjects.length - targets.length,
    newRecords,
    duplicatesSkipped,
    injuryRecords,
    noNews,
    errors,
  }
}
