import 'server-only'

import { prisma } from '@/lib/prisma'
import type { LeagueGroundingRoster } from '@/lib/ai/leagueSportsGroundingPacket'

/**
 * WHAT MOVED THIS PLAYER — the news behind a number.
 *
 * ⚠ CHIMMY COULD STATE A PROJECTION BUT NOT EXPLAIN IT. The grounding packet
 * carries `projectedPoints` per roster player and nothing about why it is what it
 * is, so "why did my projection drop?" had no grounded answer. `player_news`
 * holds 9,787 rows keyed by player NAME — which is what makes it reachable at
 * all, given the Sleeper-id crosswalk still resolves only 42%.
 *
 * ⚠ NEWS IS EVIDENCE, NOT A RECOMPUTATION. We are not re-deriving a projection
 * from these headlines, and the block says so. The failure it guards against is
 * a model reading "coach says he is limited in practice" beside a number and
 * asserting the number fell BECAUSE of it — a causal claim nobody computed. What
 * is true is that this news exists and is dated; whether the projection moved,
 * and by how much, is not something this block knows.
 */

/** Enough to explain a lineup decision without turning the prompt into a feed. */
const MAX_ITEMS = 10
const MAX_PLAYERS = 40
/** Older than this and it is background, not an explanation for today's number. */
const LOOKBACK_DAYS = 14

type NewsRow = {
  playerName: string
  team: string | null
  headline: string
  impact: string
  fantasyRelevant: boolean
  publishedAt: Date
  source: string
}

function rosterPlayerNames(rosters: LeagueGroundingRoster[] | null | undefined): string[] {
  if (!rosters?.length) return []
  const names = new Set<string>()
  for (const roster of rosters) {
    for (const p of [...(roster.starters ?? []), ...(roster.bench ?? [])]) {
      if (p?.playerName) names.add(p.playerName)
      if (names.size >= MAX_PLAYERS) return [...names]
    }
  }
  return [...names]
}

/**
 * Recent, fantasy-relevant news for the players this user actually rosters, plus
 * anyone the message names. Returns null when there is nothing recent, so the
 * prompt gains no empty section.
 */
export async function buildPlayerNewsContext(args: {
  rosters: LeagueGroundingRoster[] | null | undefined
  extraNames?: string[]
  sport: string
  now?: Date
}): Promise<string | null> {
  const names = [...new Set([...rosterPlayerNames(args.rosters), ...(args.extraNames ?? [])])].slice(
    0,
    MAX_PLAYERS,
  )
  if (names.length === 0) return null

  const since = new Date((args.now ?? new Date()).getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

  let rows: NewsRow[]
  try {
    rows = (await prisma.playerNewsRecord.findMany({
      where: {
        playerName: { in: names },
        sport: { equals: args.sport, mode: 'insensitive' },
        publishedAt: { gte: since },
      },
      orderBy: { publishedAt: 'desc' },
      take: MAX_ITEMS,
      select: {
        playerName: true,
        team: true,
        headline: true,
        impact: true,
        fantasyRelevant: true,
        publishedAt: true,
        source: true,
      },
    })) as unknown as NewsRow[]
  } catch {
    return null
  }
  if (rows.length === 0) return null

  const lines: string[] = [
    `RECENT NEWS on players this user rosters (last ${LOOKBACK_DAYS} days, newest first):`,
  ]
  for (const r of rows) {
    lines.push(
      `- ${r.publishedAt.toISOString().slice(0, 10)} ${r.playerName}${r.team ? ` (${r.team})` : ''}: ${r.headline} [impact: ${r.impact}${r.fantasyRelevant ? ', fantasy-relevant' : ''}; source ${r.source}]`,
    )
  }

  /*
   * The instruction that keeps this from becoming a causal story. Reading a
   * headline next to a projection and asserting the projection moved because of
   * it is exactly the confident-wrong shape this whole grounding effort exists to
   * close.
   */
  lines.push(
    'HOW TO USE THIS: these items are CONTEXT, not a recalculation. You do NOT have a before-and-after projection for any player, so do NOT say a projection "dropped because of" any of this, and do NOT quantify an effect. You may say what the news is, when it landed, and that it is the kind of thing that usually matters — attributing a number to it is a claim nobody computed.',
  )

  return lines.join('\n')
}
