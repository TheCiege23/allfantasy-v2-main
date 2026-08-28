import 'server-only'

import { prisma } from '@/lib/prisma'
import { getAiMemory } from '@/lib/ai-memory/ai-memory-store'

type AccessibleLeagueRow = {
  id: string
  name: string | null
  season: number
  platform: string
  platformLeagueId: string
  userId: string | null
  timezone: string | null
  lastSyncedAt: Date | null
  teams: Array<{ ownerName: string; teamName: string }>
}

/**
 * One real league imported twice is ONE league to the reader.
 *
 * ⚠ IT PRODUCED A QUESTION NOBODY COULD ANSWER. Asked "is Bauer Sharp on
 * waivers in KBFL?", Chimmy replied: `I found more than one league that could
 * match: "KBFL" (2026), "KBFL" (2026). Which of those do you mean?` — two
 * identical labels and no way to pick between them, followed by "Chimmy could
 * not read your league for this answer." The conversation simply dead-ended.
 *
 * Both rows carry `platformLeagueId` 1338541390891606016 and season 2026: the
 * same Sleeper league imported by two different accounts. `getPortfolio` already
 * collapses this exact case; the route-level resolver never learned to, so the
 * league list and the chat disagreed about how many KBFLs exist.
 *
 * ⚠ COLLAPSE ON THE PROVIDER'S ID, NEVER THE NAME. Measured 2026-08-28: only two
 * groups in production share a platform id, but SEVEN name+season groups exist —
 * "AF Test ADP #002" has five copies with five DISTINCT platform ids. Those are
 * genuinely different leagues and merging them would hide four.
 */
function collapseDuplicateImports(rows: AccessibleLeagueRow[], userId: string): AccessibleLeagueRow[] {
  const byRealLeague = new Map<string, AccessibleLeagueRow>()
  const out: AccessibleLeagueRow[] = []

  for (const row of rows) {
    /* No provider id means no evidence two rows are the same thing. */
    if (!row.platformLeagueId) {
      out.push(row)
      continue
    }
    /*
     * Platform is in the key as well as the id: provider id spaces are
     * independent, so a Sleeper league and an ESPN league could in principle
     * carry the same string, and nothing about that would make them one league.
     */
    const key = `${row.platform}|${row.platformLeagueId}|${row.season}`
    const held = byRealLeague.get(key)
    if (!held) {
      byRealLeague.set(key, row)
      out.push(row)
      continue
    }
    /*
     * Prefer the copy the reader imported — it is the one whose ids their other
     * surfaces (portfolio, league home) already use.
     */
    if (row.userId === userId && held.userId !== userId) {
      byRealLeague.set(key, row)
      out[out.indexOf(held)] = row
    }
  }

  return out
}

type LeagueAliasMap = Record<string, string>

export type ChimmyLeagueSelectionResult =
  | {
      kind: 'selected'
      leagueId: string
      confidence: number
      source: 'explicit_name' | 'alias' | 'fallback_single'
      matchedLabel: string
      leagues: AccessibleLeagueRow[]
    }
  | {
      kind: 'ambiguous'
      message: string
      choices: Array<{ leagueId: string; leagueName: string; season: number; platform: string }>
      leagues: AccessibleLeagueRow[]
    }
  | {
      kind: 'ask'
      message: string
      choices: Array<{ leagueId: string; leagueName: string; season: number; platform: string }>
      leagues: AccessibleLeagueRow[]
    }

export type ChimmyManagerDisambiguation =
  | {
      kind: 'ambiguous'
      token: string
      options: string[]
      message: string
    }
  | { kind: 'ok' }

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function quoteRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/*
 * ⚠ "league" IS IN THE QUESTION AND IN NEARLY EVERY LEAGUE NAME, so scoring it
 * as a match was noise that drowned the signal. "who should I start in the
 * zombie league?" scored "Beta 1 Zombie League" at 2/4 — because `league`
 * counted, and the distinctive word `zombie` was diluted to a quarter — while
 * "World Football League" and "Last League Left" each collected free points for
 * containing the same generic word. Everything looked equally plausible.
 */
const GENERIC_NAME_TOKENS = new Set([
  'league', 'fantasy', 'football', 'the', 'and', 'for', 'my', 'our', 'this',
  'season', 'team', 'teams', 'dynasty league', 'redraft',
])

function distinctiveTokens(leagueName: string): string[] {
  return leagueName
    .split(' ')
    .filter((token) => token.length >= 3 && !GENERIC_NAME_TOKENS.has(token))
}

function startsOrContainsWord(text: string, value: string): boolean {
  if (!value) return false
  const escaped = quoteRegex(value)
  const re = new RegExp(`(^|\\b)${escaped}(\\b|$)`, 'i')
  return re.test(text)
}

function extractAliasMap(raw: unknown): LeagueAliasMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const record = raw as Record<string, unknown>
  const aliases = record.leagueAliases
  if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) return {}

  const map: LeagueAliasMap = {}
  for (const [alias, value] of Object.entries(aliases as Record<string, unknown>)) {
    if (typeof value !== 'string') continue
    const key = normalizeToken(alias)
    if (!key) continue
    map[key] = value
  }
  return map
}

async function listAccessibleLeagues(userId: string): Promise<AccessibleLeagueRow[]> {
  const rows = await prisma.league.findMany({
    where: {
      OR: [
        { userId },
        {
          teams: {
            some: { claimedByUserId: userId },
          },
        },
      ],
    },
    select: {
      id: true,
      name: true,
      season: true,
      platform: true,
      platformLeagueId: true,
      userId: true,
      timezone: true,
      lastSyncedAt: true,
      teams: {
        select: {
          ownerName: true,
          teamName: true,
        },
      },
    },
    orderBy: [{ updatedAt: 'desc' }],
  })

  /*
   * Collapsed at the single choke point, so EVERY downstream path benefits —
   * scoring, the ambiguity branch, the "which league?" ask, and the
   * fallback_single rule that only fires when exactly one league is accessible.
   * Two copies of one league were enough to defeat that last one too.
   */
  return collapseDuplicateImports(rows, userId)
}

export async function resolveChimmyLeagueSelection(args: {
  userId: string
  message: string
  leagueNameHint?: string | null
  threshold?: number
}): Promise<ChimmyLeagueSelectionResult> {
  const threshold = args.threshold ?? 0.85
  const [leagues, rawPref] = await Promise.all([
    listAccessibleLeagues(args.userId),
    getAiMemory(args.userId, 'user_preferences', { key: 'coaching_profile' }).catch(() => null),
  ])

  const choices = leagues.slice(0, 12).map((league) => ({
    leagueId: league.id,
    leagueName: league.name ?? 'Unnamed league',
    season: league.season,
    platform: league.platform,
  }))

  if (leagues.length === 0) {
    return {
      kind: 'ask',
      message: 'I could not find any leagues you own or belong to yet. Import or create a league first.',
      choices: [],
      leagues,
    }
  }

  const aliasMap = extractAliasMap(rawPref)
  const inputText = normalizeToken([args.message, args.leagueNameHint ?? ''].filter(Boolean).join(' '))

  for (const [alias, leagueId] of Object.entries(aliasMap)) {
    if (!startsOrContainsWord(inputText, alias)) continue
    const match = leagues.find((league) => league.id === leagueId)
    if (match) {
      return {
        kind: 'selected',
        leagueId: match.id,
        confidence: 0.97,
        source: 'alias',
        matchedLabel: alias,
        leagues,
      }
    }
  }

  const scored = leagues
    .map((league) => {
      const leagueName = normalizeToken(league.name ?? '')
      if (!leagueName) return null

      let score = 0
      if (leagueName === inputText) score = 1
      else if (startsOrContainsWord(inputText, leagueName)) score = 0.94
      else if (leagueName.includes(inputText) && inputText.length >= 4) score = 0.88
      else if (inputText.includes(leagueName) && leagueName.length >= 4) score = 0.9
      else {
        /*
         * ⚠ THIS PATH COULD NEVER SELECT ANYTHING. It capped at 0.82 while the
         * threshold is 0.85, so every question that did not match a name
         * exactly or by containment fell through to "ambiguous" no matter how
         * clearly it named a league. The cap is now above the threshold, and
         * only DISTINCTIVE tokens count toward it.
         */
        const tokens = distinctiveTokens(leagueName)
        const hitCount = tokens.filter((token) => startsOrContainsWord(inputText, token)).length
        if (tokens.length > 0) {
          score = Math.min(0.93, hitCount / tokens.length)
        }
      }

      if (score <= 0) return null
      return { league, score, label: league.name ?? 'Unnamed league' }
    })
    .filter((row): row is { league: AccessibleLeagueRow; score: number; label: string } => Boolean(row))
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) {
    if (leagues.length === 1) {
      const only = leagues[0]!
      return {
        kind: 'selected',
        leagueId: only.id,
        confidence: 0.86,
        source: 'fallback_single',
        matchedLabel: only.name ?? 'Unnamed league',
        leagues,
      }
    }

    return {
      kind: 'ask',
      message: `Which league do you want me to use? Yours are: ${choices
        .map((c) => `"${c.leagueName}"`)
        .join(', ')}.`,
      choices,
      leagues,
    }
  }

  /*
   * ⚠ A WORD THAT APPEARS IN EXACTLY ONE OF THIS USER'S LEAGUE NAMES IS AN
   * ANSWER, not a hint. "zombie" names precisely one of these six leagues, so
   * "who should I start in the zombie league?" has one correct reading — and it
   * was being returned as "I found multiple league matches" because the generic
   * word `league` made three others look partially plausible.
   *
   * Checked BEFORE the score threshold because a distinctive word beats a
   * fractional overlap: it is evidence about which league, not about how much of
   * a name was typed.
   */
  const discriminators = new Map<string, string[]>()
  for (const league of leagues) {
    for (const token of distinctiveTokens(normalizeToken(league.name ?? ''))) {
      if (!startsOrContainsWord(inputText, token)) continue
      discriminators.set(token, [...(discriminators.get(token) ?? []), league.id])
    }
  }
  for (const [token, ids] of discriminators) {
    if (ids.length !== 1) continue
    const match = leagues.find((league) => league.id === ids[0])
    if (!match) continue
    return {
      kind: 'selected',
      leagueId: match.id,
      confidence: 0.95,
      source: 'explicit_name',
      matchedLabel: `${match.name ?? 'Unnamed league'} (matched "${token}")`,
      leagues,
    }
  }

  const top = scored[0]!
  const second = scored[1]
  const margin = second ? top.score - second.score : top.score

  if (top.score >= threshold && margin >= 0.08) {
    return {
      kind: 'selected',
      leagueId: top.league.id,
      confidence: top.score,
      source: 'explicit_name',
      matchedLabel: top.label,
      leagues,
    }
  }

  const ambiguousChoices = scored.slice(0, 5).map((row) => ({
    leagueId: row.league.id,
    leagueName: row.league.name ?? 'Unnamed league',
    season: row.league.season,
    platform: row.league.platform,
  }))

  /*
   * ⚠ THE NAMES WERE COMPUTED AND THEN THROWN AWAY. `ambiguousChoices` has
   * carried `leagueName` all along while the message said only "multiple league
   * matches" — a question the reader cannot answer, because nothing on screen
   * says which leagues were meant. Same shape as the "which of the two KBFL
   * leagues did you mean?" that named neither.
   */
  return {
    kind: 'ambiguous',
    message: `I found more than one league that could match: ${ambiguousChoices
      .map((c) => `"${c.leagueName}"${c.season ? ` (${c.season})` : ''}`)
      .join(', ')}. Which of those do you mean?`,
    choices: ambiguousChoices,
    leagues,
  }
}

function extractManagerToken(message: string): string | null {
  const lowered = message.toLowerCase()
  const patterns = [
    /\bmanager\s+([a-z0-9][a-z0-9 ._'-]{1,40})/i,
    /\bfor\s+([a-z0-9][a-z0-9 ._'-]{1,40})\s*(?:\?|$)/i,
    /\b([a-z0-9][a-z0-9 ._'-]{1,40})'s\s+(?:team|roster|draft|waiver|trade)/i,
  ]

  for (const pattern of patterns) {
    const match = lowered.match(pattern)
    if (!match?.[1]) continue
    const token = normalizeToken(match[1])
    if (!token) continue
    if (['me', 'my team', 'my roster', 'us', 'our team'].includes(token)) return null
    if (token.length < 3) continue
    return token
  }
  return null
}

export function detectManagerAmbiguity(args: {
  message: string
  league:
    | {
        teams: Array<{ ownerName: string; teamName: string }>
      }
    | null
}): ChimmyManagerDisambiguation {
  if (!args.league) return { kind: 'ok' }
  const token = extractManagerToken(args.message)
  if (!token) return { kind: 'ok' }

  const matches = args.league.teams
    .map((team) => ({
      ownerName: team.ownerName?.trim() ?? '',
      teamName: team.teamName?.trim() ?? '',
    }))
    .filter((team) => {
      const owner = normalizeToken(team.ownerName)
      const tName = normalizeToken(team.teamName)
      return startsOrContainsWord(owner, token) || startsOrContainsWord(tName, token)
    })

  if (matches.length <= 1) return { kind: 'ok' }

  const options = matches
    .slice(0, 6)
    .map((team) => `${team.ownerName || 'Unknown owner'} (${team.teamName || 'Unnamed team'})`)

  return {
    kind: 'ambiguous',
    token,
    options,
    message: `I found multiple manager matches for "${token}". Which manager did you mean?`,
  }
}

export function buildChimmyStalenessWarning(args: {
  lastSyncedAt: Date | null
  intent: string
  now?: Date
}): { warning: string | null; staleMinutes: number | null; thresholdMinutes: number } {
  const thresholdByIntent: Record<string, number> = {
    trade: 5,
    waiver: 5,
    roster: 10,
    draft: 15,
    general: 30,
  }

  const thresholdMinutes = thresholdByIntent[args.intent] ?? thresholdByIntent.general
  if (!args.lastSyncedAt) {
    return {
      warning: `League data sync timestamp is unavailable. Answers may be stale (target freshness <= ${thresholdMinutes} min).`,
      staleMinutes: null,
      thresholdMinutes,
    }
  }

  const now = args.now ?? new Date()
  const staleMinutes = Math.max(0, Math.floor((now.getTime() - args.lastSyncedAt.getTime()) / 60_000))

  if (staleMinutes <= thresholdMinutes) {
    return { warning: null, staleMinutes, thresholdMinutes }
  }

  return {
    warning: `Data may be stale: last synced ${staleMinutes} min ago (target <= ${thresholdMinutes} min for ${args.intent} requests).`,
    staleMinutes,
    thresholdMinutes,
  }
}

export function buildChimmySourceReferences(args: {
  leagueId: string | null
  intent: string
}): Array<{ label: string; href: string }> {
  if (!args.leagueId) return []

  const refs: Array<{ label: string; href: string }> = [
    { label: 'League Home', href: `/league/${args.leagueId}` },
    { label: 'League Settings', href: `/league/${args.leagueId}/settings` },
  ]

  if (args.intent === 'draft') {
    // The draft room lives at /draft, not /draft-room — the old href 404'd and
    // was also injected into the model prompt as a "source".
    refs.push({ label: 'Draft Room', href: `/league/${args.leagueId}/draft` })
  }
  if (args.intent === 'waiver') {
    refs.push({ label: 'Waivers', href: `/league/${args.leagueId}?tab=waivers` })
  }
  if (args.intent === 'trade') {
    refs.push({ label: 'Trade Center', href: `/league/${args.leagueId}?tab=trades` })
  }
  return refs
}
