/**
 * AI League Advisor — aggregates roster, injuries, and optional waiver/trade context; calls OpenAI for advice.
 */

import { prisma } from '@/lib/prisma'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { isForeignIdSpace, sleeperReadablePlayerData } from '@/lib/core-app/rosterIdSpace'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { openaiChatJson, parseJsonContentFromChatCompletion } from '@/lib/openai-client'
import type { LeagueAdvisorAdvice, LeagueAdvisorContext } from './types'

const ADVISOR_SYSTEM = `You are a personal fantasy league advisor. Given a user's league context (roster summary, injuries, FAAB, waiver priority), produce concise, actionable advice in four categories:

1. **Lineup** — who to start/sit this week, position upgrades, bye/injury fill-ins. Prioritize clear swaps.
2. **Trade** — 1–3 targeted suggestions: buy-low, sell-high, or hold. Be specific (player names if provided).
3. **Waiver** — top waiver targets or drop candidates given roster and FAAB/priority. Mention priority if relevant.
4. **Injury** — react to listed injuries: who to bench, stash on IR, or replace.

Rules:
- Return only valid JSON. No markdown.
- Each category is an array of items. Each item has: summary (string), priority ("high"|"medium"|"low"), and category-specific fields (e.g. playerNames, addTarget, dropCandidate, playerName, status, suggestedAction, direction, targetPlayer).
- Keep each summary 1–2 sentences. Use the sport (NFL, NBA, etc.) for context.
- If you have no real advice for a category, return an empty array for it.
- generatedAt, leagueId, sport will be set by the server; your response must include exactly: lineup (array), trade (array), waiver (array), injury (array).`

export interface GetAdvisorInput {
  leagueId: string
  userId: string
}

async function getLeagueAndRoster(leagueId: string, userId: string) {
  const league = await (prisma as any).league.findFirst({
    where: { id: leagueId, userId },
    select: { id: true, name: true, sport: true, platform: true },
  })
  if (!league) return null

  const roster = await (prisma as any).roster.findFirst({
    where: { leagueId, platformUserId: userId },
    select: { playerData: true, faabRemaining: true, waiverPriority: true },
  })
  if (!roster) return null

  return { league, roster }
}

/** Resolve roster player IDs to names for NFL (Sleeper). Other sports may get IDs only. */
async function resolveRosterPlayerNames(
  playerIds: string[],
  sport: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (playerIds.length === 0) return map

  const upper = sport?.toUpperCase() ?? 'NFL'
  if (upper === 'NFL') {
    try {
      const { getAllPlayers } = await import('@/lib/sleeper-client')
      const all = await getAllPlayers()
      for (const id of playerIds) {
        const p = all[id]
        const name = p?.full_name || (p ? `${(p as any).first_name ?? ''} ${(p as any).last_name ?? ''}`.trim() : null)
        if (name) map.set(id, name)
        else map.set(id, `Player ${id.slice(0, 8)}`)
      }
    } catch {
      playerIds.forEach((id) => map.set(id, `Player ${id.slice(0, 8)}`))
    }
    return map
  }

  // Optional: PlayerIdentityMap by sleeperId for other sports
  try {
    const rows = await prisma.playerIdentityMap.findMany({
      where: { sleeperId: { in: playerIds }, sport: upper },
      select: { sleeperId: true, canonicalName: true },
    })
    for (const r of rows) {
      if (r.sleeperId) map.set(r.sleeperId, r.canonicalName)
    }
  } catch {
    // ignore
  }
  playerIds.forEach((id) => {
    if (!map.has(id)) map.set(id, `Player ${id.slice(0, 8)}`)
  })
  return map
}

/** Build roster summary string (starters vs bench if we have structure; else flat list). */
function buildRosterSummary(
  playerIds: string[],
  nameMap: Map<string, string>,
  playerDataRaw: unknown
): string {
  const names = playerIds.map((id) => nameMap.get(id) || id).filter(Boolean)
  const raw = playerDataRaw as { starters?: string[]; players?: string[] } | null
  if (raw?.starters && Array.isArray(raw.starters)) {
    const starters = raw.starters.map((id) => nameMap.get(id) || id)
    const bench = (raw.players || []).filter((id) => !raw.starters!.includes(id)).map((id) => nameMap.get(id) || id)
    return `Starters: ${starters.join(', ')}. Bench: ${bench.join(', ')}.`
  }
  return `Roster: ${names.join(', ')}.`
}

/** Fetch injuries for league sport; filter by roster player names if we have them. */
async function getInjurySummary(sport: string, rosterPlayerNames: string[]): Promise<string> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const normSport = normalizeToSupportedSport(sport)
  try {
    const injuries = await prisma.sportsInjury.findMany({
      where: {
        sport: normSport,
        updatedAt: { gte: since },
        ...(rosterPlayerNames.length > 0
          ? {
              OR: rosterPlayerNames.map((name) => ({
                playerName: { contains: name, mode: 'insensitive' as const },
              })),
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { playerName: true, team: true, status: true, type: true },
    })
    if (injuries.length === 0) return 'No recent injuries for your roster.'
    return injuries
      .map((i) => `${i.playerName} (${i.team ?? '?'}): ${i.status}${i.type ? ` — ${i.type}` : ''}`)
      .join('. ')
  } catch {
    return 'Injury data unavailable.'
  }
}

async function getRecentInjuries(
  sport: string,
  rosterPlayerNames: string[]
): Promise<Array<{ playerName: string; team: string | null; status: string | null; type: string | null }>> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const normSport = normalizeToSupportedSport(sport)
  try {
    return await prisma.sportsInjury.findMany({
      where: {
        sport: normSport,
        updatedAt: { gte: since },
        ...(rosterPlayerNames.length > 0
          ? {
              OR: rosterPlayerNames.map((name) => ({
                playerName: { contains: name, mode: 'insensitive' as const },
              })),
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { playerName: true, team: true, status: true, type: true },
    })
  } catch {
    return []
  }
}

async function getRosterTrendSummary(
  sport: string,
  playerIds: string[],
  nameMap: Map<string, string>
): Promise<{
  summary: string
  hot: string[]
  cold: string[]
  rising: string[]
}> {
  if (!playerIds.length) {
    return { summary: 'No trend data for current roster.', hot: [], cold: [], rising: [] }
  }
  try {
    const rows = await prisma.playerMetaTrend.findMany({
      where: {
        sport: normalizeToSupportedSport(sport),
        playerId: { in: playerIds },
      },
      orderBy: { trendScore: 'desc' },
      take: 50,
      select: { playerId: true, trendScore: true, trendingDirection: true },
    })
    const hot = rows
      .filter((r) => String(r.trendingDirection).toLowerCase() === 'hot')
      .slice(0, 3)
      .map((r) => nameMap.get(r.playerId) ?? r.playerId)
    const rising = rows
      .filter((r) => String(r.trendingDirection).toLowerCase() === 'rising')
      .slice(0, 3)
      .map((r) => nameMap.get(r.playerId) ?? r.playerId)
    const cold = rows
      .filter((r) => ['cold', 'falling', 'down'].includes(String(r.trendingDirection).toLowerCase()))
      .slice(0, 3)
      .map((r) => nameMap.get(r.playerId) ?? r.playerId)

    const parts = [
      hot.length ? `Hot: ${hot.join(', ')}` : '',
      rising.length ? `Rising: ${rising.join(', ')}` : '',
      cold.length ? `Cold/Falling: ${cold.join(', ')}` : '',
    ].filter(Boolean)
    return {
      summary: parts.length ? parts.join('. ') + '.' : 'No trend data for current roster.',
      hot,
      cold,
      rising,
    }
  } catch {
    return { summary: 'Trend data unavailable.', hot: [], cold: [], rising: [] }
  }
}

function priorityFromInjuryStatus(status?: string | null): 'high' | 'medium' | 'low' {
  const s = String(status ?? '').toLowerCase()
  if (['out', 'ir', 'pup', 'doubtful', 'suspended'].includes(s)) return 'high'
  if (['questionable', 'day-to-day'].includes(s)) return 'medium'
  return 'low'
}

function buildDeterministicFallbackAdvice(input: {
  leagueId: string
  sport: string
  rosterSummary: string
  faabRemaining?: number | null
  waiverPriority?: number | null
  injuries: Array<{ playerName: string; team: string | null; status: string | null; type: string | null }>
  hot: string[]
  cold: string[]
  rising: string[]
}): LeagueAdvisorAdvice {
  const injuryItems = input.injuries.slice(0, 5).map((i) => {
    const status = String(i.status ?? '').trim()
    const isSevere = ['out', 'ir', 'pup', 'doubtful', 'suspended'].includes(status.toLowerCase())
    return {
      summary: isSevere
        ? `${i.playerName} carries a significant availability risk this week.`
        : `${i.playerName} is managing an injury tag and should be monitored before lock.`,
      playerName: i.playerName,
      status: i.status ?? undefined,
      suggestedAction: isSevere ? 'Move to bench/IR and secure a replacement.' : 'Check final status before starting.',
      priority: priorityFromInjuryStatus(i.status),
    }
  })

  const lineup: LeagueAdvisorAdvice['lineup'] = []
  if (injuryItems.length > 0) {
    lineup.push({
      summary: 'Lineup risk detected from current injuries; prioritize healthy starters with secure workloads.',
      action: 'Bench risky injury tags unless late-week reports improve.',
      priority: 'high',
      playerNames: injuryItems.slice(0, 3).map((i) => i.playerName),
    })
  }
  if (input.rising.length > 0) {
    lineup.push({
      summary: `${input.rising.join(', ')} have positive usage trends and are worth stronger start consideration.`,
      action: 'Prefer rising players in flex/tiebreak start-sit spots.',
      priority: 'medium',
      playerNames: input.rising,
    })
  }

  const trade: LeagueAdvisorAdvice['trade'] = []
  if (input.hot.length > 0) {
    trade.push({
      summary: `${input.hot[0]} is trending hot; evaluate sell-high offers while market sentiment is elevated.`,
      direction: 'sell',
      targetPlayer: input.hot[0],
      priority: 'medium',
    })
  }
  if (input.cold.length > 0) {
    trade.push({
      summary: `${input.cold[0]} is trending down; hold unless your league still values prior production.`,
      direction: 'hold',
      targetPlayer: input.cold[0],
      priority: 'medium',
    })
  }
  if (input.rising.length > 1) {
    trade.push({
      summary: `${input.rising[0]} profiles as a buy-low/breakout acquisition if manager confidence remains muted.`,
      direction: 'buy',
      targetPlayer: input.rising[0],
      priority: 'low',
    })
  }

  const waiver: LeagueAdvisorAdvice['waiver'] = []
  const faab = input.faabRemaining ?? null
  if (injuryItems.length > 0) {
    waiver.push({
      summary: 'Use waivers to backfill injury risk this week, with focus on immediate-volume replacements.',
      addTarget: input.rising[0],
      dropCandidate: input.cold[0],
      priority: 'high',
    })
  }
  if (faab != null) {
    waiver.push({
      summary:
        faab >= 60
          ? `You have strong FAAB flexibility ($${faab}); you can be aggressive on impact adds.`
          : faab <= 20
            ? `FAAB is limited ($${faab}); prioritize low-cost contingency adds and churn depth spots.`
            : `FAAB is moderate ($${faab}); target 1-2 priority adds without overbidding.`,
      addTarget: input.rising[1] ?? input.rising[0],
      dropCandidate: input.cold[1] ?? input.cold[0],
      priority: faab <= 20 ? 'high' : 'medium',
    })
  } else if (input.waiverPriority != null) {
    waiver.push({
      summary: `Waiver priority is ${input.waiverPriority}; time claims around urgency and replacement-level depth.`,
      addTarget: input.rising[0],
      dropCandidate: input.cold[0],
      priority: 'medium',
    })
  }

  return {
    lineup,
    trade,
    waiver,
    injury: injuryItems,
    generatedAt: new Date().toISOString(),
    leagueId: input.leagueId,
    sport: input.sport,
  }
}

/** Build advisor context and call AI; return structured advice. */
export async function getLeagueAdvisorAdvice(input: GetAdvisorInput): Promise<LeagueAdvisorAdvice | null> {
  const { leagueId, userId } = input
  const data = await getLeagueAndRoster(leagueId, userId)
  if (!data) return null

  const { league, roster } = data
  const sport = normalizeToSupportedSport(league.sport)
  // A Fleaflicker/MFL/Fantrax/Yahoo roster id collides with real Sleeper ids, so it is never named
  // as one; and with no names, the injury reads below would return the whole sport's list as "yours".
  const unreadable = isForeignIdSpace(league.platform)
  const playerData = sleeperReadablePlayerData(league.platform, roster.playerData)
  const playerIds = getRosterPlayerIds(playerData)
  const nameMap = await resolveRosterPlayerNames(playerIds, sport)
  const rosterNames = [...nameMap.values()]
  const [rosterTrends, injuries] = await Promise.all([
    getRosterTrendSummary(sport, playerIds, nameMap),
    unreadable ? [] : getRecentInjuries(sport, rosterNames),
  ])
  const rosterSummary = unreadable
    ? "Roster: this platform's player ids cannot be resolved to players yet."
    : buildRosterSummary(playerIds, nameMap, playerData)
  const injurySummary =
    injuries.length > 0
      ? injuries
          .map((i) => `${i.playerName} (${i.team ?? '?'}): ${i.status}${i.type ? ` — ${i.type}` : ''}`)
          .join('. ')
      : unreadable
        ? 'Injury status for this roster is unavailable.'
        : await getInjurySummary(sport, rosterNames)

  const waiverHint =
    roster.waiverPriority != null
      ? `Waiver priority: ${roster.waiverPriority} (lower = earlier).`
      : undefined
  const faabHint =
    roster.faabRemaining != null ? `FAAB remaining: $${roster.faabRemaining}.` : undefined
  const tradeHint = 'Consider buy-low or sell-high based on roster and injuries.'

  const context: LeagueAdvisorContext = {
    leagueId,
    leagueName: league.name ?? 'My League',
    sport,
    rosterSummary,
    faabRemaining: roster.faabRemaining,
    waiverPriority: roster.waiverPriority,
    injurySummary,
    trendSummary: rosterTrends.summary,
    waiverHint: [waiverHint, faabHint].filter(Boolean).join(' ') || undefined,
    tradeHint,
  }

  const userContent = `
League: ${context.leagueName} (${context.sport})
${context.rosterSummary}
${context.injurySummary}
${context.trendSummary ?? ''}
${context.waiverHint ?? ''}
${context.tradeHint ?? ''}
`.trim()

  const result = await openaiChatJson({
    messages: [
      { role: 'system', content: ADVISOR_SYSTEM },
      { role: 'user', content: userContent },
    ],
    temperature: 0.4,
    maxTokens: 1200,
  })

  if (!result.ok || !result.json) {
    return buildDeterministicFallbackAdvice({
      leagueId,
      sport,
      rosterSummary,
      faabRemaining: roster.faabRemaining,
      waiverPriority: roster.waiverPriority,
      injuries,
      hot: rosterTrends.hot,
      cold: rosterTrends.cold,
      rising: rosterTrends.rising,
    })
  }

  const parsed = parseJsonContentFromChatCompletion(result.json)
  const raw = (parsed ?? {}) as Record<string, unknown>
  const lineup = Array.isArray(raw.lineup) ? raw.lineup : []
  const trade = Array.isArray(raw.trade) ? raw.trade : []
  const waiver = Array.isArray(raw.waiver) ? raw.waiver : []
  const injury = Array.isArray(raw.injury) ? raw.injury : []

  const hasAnyAdvice = lineup.length + trade.length + waiver.length + injury.length > 0
  if (!hasAnyAdvice) {
    return buildDeterministicFallbackAdvice({
      leagueId,
      sport,
      rosterSummary,
      faabRemaining: roster.faabRemaining,
      waiverPriority: roster.waiverPriority,
      injuries,
      hot: rosterTrends.hot,
      cold: rosterTrends.cold,
      rising: rosterTrends.rising,
    })
  }

  return {
    lineup: lineup.map(normalizeLineupItem),
    trade: trade.map(normalizeTradeItem),
    waiver: waiver.map(normalizeWaiverItem),
    injury: injury.map(normalizeInjuryItem),
    generatedAt: new Date().toISOString(),
    leagueId,
    sport,
  }
}

function normalizeLineupItem(x: any): LeagueAdvisorAdvice['lineup'][0] {
  return {
    summary: String(x?.summary ?? ''),
    action: x?.action != null ? String(x.action) : undefined,
    priority: ['high', 'medium', 'low'].includes(x?.priority) ? x.priority : 'medium',
    playerNames: Array.isArray(x?.playerNames) ? x.playerNames.map(String) : undefined,
  }
}

function normalizeTradeItem(x: any): LeagueAdvisorAdvice['trade'][0] {
  return {
    summary: String(x?.summary ?? ''),
    direction: ['buy', 'sell', 'hold'].includes(x?.direction) ? x.direction : undefined,
    targetPlayer: x?.targetPlayer != null ? String(x.targetPlayer) : undefined,
    priority: ['high', 'medium', 'low'].includes(x?.priority) ? x.priority : 'medium',
  }
}

function normalizeWaiverItem(x: any): LeagueAdvisorAdvice['waiver'][0] {
  return {
    summary: String(x?.summary ?? ''),
    addTarget: x?.addTarget != null ? String(x.addTarget) : undefined,
    dropCandidate: x?.dropCandidate != null ? String(x.dropCandidate) : undefined,
    priority: ['high', 'medium', 'low'].includes(x?.priority) ? x.priority : 'medium',
  }
}

function normalizeInjuryItem(x: any): LeagueAdvisorAdvice['injury'][0] {
  return {
    summary: String(x?.summary ?? ''),
    playerName: String(x?.playerName ?? ''),
    status: x?.status != null ? String(x.status) : undefined,
    suggestedAction: x?.suggestedAction != null ? String(x.suggestedAction) : undefined,
    priority: ['high', 'medium', 'low'].includes(x?.priority) ? x.priority : 'medium',
  }
}
