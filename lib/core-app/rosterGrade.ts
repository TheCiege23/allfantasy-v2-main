import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * How your roster stacks up against the other teams in YOUR league.
 *
 * ⚠ A RANK, NOT A LETTER. This repo has been burned by letter grades: a "C"
 * trade grade turned out to mean "we priced nothing", and it was
 * indistinguishable from a considered verdict. A letter invents a scale and
 * hides its inputs. "3rd of 12 by roster value" names the comparison, and if
 * the comparison cannot be made the section says so instead.
 *
 * ⚠ AND IT IS COMPARED WITHIN THE LEAGUE, NOT AGAINST AN ABSOLUTE. Roster value
 * only means something relative to the people you actually play. A 12-team
 * superflex dynasty and a 10-team redraft produce totals that are not on the
 * same axis, and grading against a global average would rank a strong redraft
 * roster as thin because dynasty prices dominate the market data.
 *
 * "Ever evolving" is a property of the inputs, not of a schedule here: this
 * reads whatever the value snapshots currently say, and those are refreshed by
 * their own cron. When they move, so does this.
 */

export type PositionStrength = {
  position: string
  /** Your total value at this position. */
  value: number
  /** Where that ranks among the league's teams. 1 is best. */
  rank: number
  outOf: number
  playerCount: number
}

export type RosterGrade = {
  /** 1 is the most valuable roster in the league. */
  rank: number
  outOf: number
  /** Your roster's total value. */
  value: number
  /** The league's median, so the rank has a distance attached to it. */
  median: number
  /** Strongest and weakest positions by league rank. Null when unrankable. */
  strongest: PositionStrength | null
  weakest: PositionStrength | null
  /** How many of YOUR players carried a price, of how many held. */
  pricedPlayers: number
  totalPlayers: number
  /** The market these prices came from, so the number can be argued with. */
  basis: { format: string; qbFormat: string; capturedAt: string | null }
}

function asIds(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x))).filter(Boolean) : []
}

const EMPTY_SLOT = '0'

/**
 * Superflex changes quarterback prices enormously, so reading the wrong market
 * would misrank every roster with a good QB. Detected from the league's own
 * starting slots rather than its name.
 */
function detectQbFormat(starters: unknown): 'ONE_QB' | 'SUPERFLEX' {
  const slots = Array.isArray(starters) ? starters.map((s) => String(s).toUpperCase()) : []
  if (slots.some((s) => s.includes('SUPER_FLEX') || s === 'SUPERFLEX' || s === 'SF')) {
    return 'SUPERFLEX'
  }
  return slots.filter((s) => s === 'QB').length > 1 ? 'SUPERFLEX' : 'ONE_QB'
}

/** Median, so one superteam does not drag the midpoint the way a mean would. */
function median(ns: number[]): number {
  if (ns.length === 0) return 0
  const s = [...ns].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 100) / 100
}

export async function getRosterGrade(args: {
  leagueId: string
  /** The claimed team's platform user id candidates, same list My Team uses. */
  myPlatformUserIds: string[]
  isDynasty: boolean
  starters: unknown
}): Promise<RosterGrade | null> {
  const { leagueId, myPlatformUserIds, isDynasty, starters } = args
  if (myPlatformUserIds.length === 0) return null

  const rosters = await prisma.roster
    .findMany({
      where: { leagueId },
      select: { platformUserId: true, playerData: true },
    })
    .catch(() => [])

  // Two teams is not a league to be ranked within.
  if (rosters.length < 3) return null

  const byTeam = new Map<string, string[]>()
  for (const r of rosters) {
    const pd = (r.playerData ?? {}) as Record<string, unknown>
    /*
     * The whole roster, not the starting lineup. A grade that counted only
     * starters would rank a team with an elite bench identically to one with
     * nothing behind its starters — which is exactly the difference the grade
     * exists to show.
     */
    const ids = asIds(pd.players).filter((id) => id !== EMPTY_SLOT)
    if (ids.length > 0) byTeam.set(r.platformUserId, ids)
  }
  if (byTeam.size < 3) return null

  const mine = myPlatformUserIds.map((id) => byTeam.get(id)).find(Boolean)
  if (!mine) return null

  const everyId = [...new Set([...byTeam.values()].flat())]
  const format = isDynasty ? 'DYNASTY' : 'REDRAFT'
  const qbFormat = detectQbFormat(starters)

  const rows = await prisma.playerValueSnapshot
    .findMany({
      where: { sleeperId: { in: everyId }, source: 'FANTASYCALC', format, qbFormat },
      orderBy: { capturedAt: 'desc' },
      select: { sleeperId: true, value: true, position: true, capturedAt: true },
    })
    .catch(() => [])

  // Newest capture per player; rows arrive newest-first so the first wins.
  const priced = new Map<string, { value: number; position: string | null }>()
  let newest: Date | null = null
  for (const r of rows) {
    if (!priced.has(r.sleeperId)) {
      priced.set(r.sleeperId, { value: r.value, position: r.position })
    }
    if (!newest || r.capturedAt > newest) newest = r.capturedAt
  }

  /*
   * ⚠ THE COVERAGE GATE. Ranking on prices we hold for a third of the league
   * would produce a confident ordering of noise — and the team we happen to
   * have priced best would come first. Below half, there is no comparison to
   * report and this returns null so the screen says why.
   */
  if (priced.size < everyId.length * 0.5) return null

  const totals: Array<{ key: string; total: number }> = []
  const positionTotals = new Map<string, Array<{ key: string; total: number }>>()

  for (const [key, ids] of byTeam) {
    let total = 0
    const byPos = new Map<string, number>()
    for (const id of ids) {
      const p = priced.get(id)
      if (!p) continue
      total += p.value
      const pos = (p.position ?? 'UNK').toUpperCase()
      byPos.set(pos, (byPos.get(pos) ?? 0) + p.value)
    }
    totals.push({ key, total })
    for (const [pos, v] of byPos) {
      const list = positionTotals.get(pos) ?? []
      list.push({ key, total: v })
      positionTotals.set(pos, list)
    }
  }

  const myKey = myPlatformUserIds.find((id) => byTeam.has(id))!
  totals.sort((a, b) => b.total - a.total)
  const rank = totals.findIndex((t) => t.key === myKey) + 1
  if (rank === 0) return null

  const myTotal = totals.find((t) => t.key === myKey)!.total

  // Positional ranks, but only where enough teams carry that position for a
  // ranking to mean anything.
  const strengths: PositionStrength[] = []
  for (const [position, list] of positionTotals) {
    if (position === 'UNK' || list.length < 3) continue
    list.sort((a, b) => b.total - a.total)
    const idx = list.findIndex((t) => t.key === myKey)
    if (idx < 0) continue
    strengths.push({
      position,
      value: Math.round(list[idx].total),
      rank: idx + 1,
      outOf: list.length,
      playerCount: mine.filter((id) => (priced.get(id)?.position ?? '').toUpperCase() === position)
        .length,
    })
  }

  // Ranked by percentile so positions with different team counts compare.
  strengths.sort((a, b) => a.rank / a.outOf - b.rank / b.outOf)

  return {
    rank,
    outOf: totals.length,
    value: Math.round(myTotal),
    median: Math.round(median(totals.map((t) => t.total))),
    strongest: strengths[0] ?? null,
    weakest: strengths.length > 1 ? strengths[strengths.length - 1] : null,
    pricedPlayers: mine.filter((id) => priced.has(id)).length,
    totalPlayers: mine.length,
    basis: { format, qbFormat, capturedAt: newest?.toISOString() ?? null },
  }
}
