import 'server-only'

import { prisma } from '@/lib/prisma'
import { gradeTrade } from '@/lib/trade-value/grader'
import { normalizedPlayerValue, type ScoringContext } from '@/lib/trade-value/valueEngine'
import type { AssetValueSnapshot, SideTotals } from '@/lib/trade-value/types'

/**
 * "IS CHASE FOR GIBBS FAIR?" — grading a trade the user DESCRIBES.
 *
 * ⚠ THIS IS THE TRADE QUESTION PEOPLE ACTUALLY ASK, and it was the only one with
 * no grounded answer. The pending-proposal path reads
 * `redraft_trade_proposals`, which is empty in production; the history path reads
 * settled Sleeper trades. Neither can price a hypothetical. This one needs no
 * proposal row at all — just player values and the league's scoring.
 *
 * ⚠ VALUE COMES FROM ADP, NOT FROM PROJECTIONS. `adp_data` carries 94,089 NFL
 * rows over 3,152 distinct player NAMES, refreshed daily — and being name-keyed
 * is exactly why a described trade can use it, when the Sleeper-id crosswalk
 * still resolves only 42%. `fantasy_projections` holds 998 rows keyed by player
 * id, so it cannot answer a question typed as prose. The block says which basis
 * it used, because "priced off draft position" and "priced off projected points"
 * are different claims.
 *
 * ⚠ IT REFUSES RATHER THAN GUESSING THE SIDES. Splitting "A and B for C" wrongly
 * produces a confident grade for a trade nobody proposed. When the message does
 * not clearly separate into two sides, or when one side prices to nothing, this
 * returns what it COULD price and declines to grade.
 */

/** A trade nobody would type: guards the name-candidate scan and the IN clause. */
const MAX_CANDIDATES = 24
/** Deepest slice in `adp_data`; used when the league's own settings find nothing. */
const FALLBACK_FORMAT = 'redraft'
const FALLBACK_SCORING = 'standard'

/**
 * The word that separates what you get from what you give. Ordered longest-first
 * so "in exchange for" wins over the "for" inside it.
 */
const SEPARATORS = [
  ' in exchange for ',
  ' straight up for ',
  ' traded for ',
  ' swap for ',
  ' for ',
  ' vs ',
  ' <-> ',
]

type AdpRow = { playerName: string; position: string; team: string; adp: number }

/**
 * Capitalised runs of 2–3 words — the shape a player's name takes in prose.
 *
 * Deliberately over-generates: every candidate is then checked against
 * `adp_data`, so a false candidate costs one row in an `IN` clause and nothing
 * else. Under-generating would silently drop a real player instead.
 */
export function extractPlayerNameCandidates(message: string): string[] {
  const out = new Set<string>()
  // Allow the internal punctuation real names carry: O'Dell, Amon-Ra, Jr., St.
  const tokens = message.match(/[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,2}/g) ?? []
  for (const t of tokens) {
    const cleaned = t.replace(/[.,!?]+$/, '').trim()
    if (cleaned.split(/\s+/).length >= 2) out.add(cleaned)
    if (out.size >= MAX_CANDIDATES) break
  }
  return [...out]
}

/** Which half of the sentence a name appears in decides which side it is on. */
function splitSides(message: string): { left: string; right: string } | null {
  const lower = message.toLowerCase()
  for (const sep of SEPARATORS) {
    const at = lower.indexOf(sep)
    if (at > 0) {
      return { left: message.slice(0, at), right: message.slice(at + sep.length) }
    }
  }
  return null
}

function scoringContextFor(league: {
  scoring: string | null
  leagueVariant: string | null
}): ScoringContext {
  const s = (league.scoring ?? '').toLowerCase()
  return {
    isSuperflex: s.includes('superflex') || s.includes('sflex'),
    is2QB: s.includes('2qb'),
    tePremium: s.includes('te_premium') || s.includes('tep') ? 0.5 : null,
    scoringFormat: s.includes('half') ? 'half_ppr' : s.includes('ppr') ? 'ppr' : 'standard',
  }
}

function toAsset(row: AdpRow, value: number, from: string, to: string): AssetValueSnapshot {
  return {
    kind: 'player',
    fromRosterId: from,
    toRosterId: to,
    playerId: null,
    playerName: row.playerName,
    position: row.position,
    team: row.team,
    sources: {
      /*
       * `projectionValue` stays null on purpose: `computeConfidence` reads exactly
       * that field to decide how much to trust the grade, and an ADP-derived
       * number is not a projection. Filling it here would inflate confidence on
       * every described trade — the value lands in `adpValue`, where it belongs.
       */
      projectionValue: null,
      rankingValue: null,
      adpValue: value,
      fantasyCalcValue: null,
      /*
       * IDP value is computed from a league's own scoring and starting slots. A
       * described trade may carry no league at all, and ADP does not price
       * defenders — so null is the truthful answer here rather than a number
       * borrowed from a different basis.
       */
      idpValue: null,
    },
    internalValue: value,
  }
}

/**
 * Grade a trade described in the message. Returns null when the message is not
 * about a trade at all, so the prompt gains no empty section.
 */
export async function buildDescribedTradeContext(args: {
  message: string
  leagueId: string | null
  sport: string
}): Promise<string | null> {
  const { message, leagueId, sport } = args
  if (!message?.trim()) return null

  const sides = splitSides(message)
  const candidates = extractPlayerNameCandidates(message)
  if (candidates.length === 0) return null
  // One name and no separator is a player question, not a trade.
  if (!sides && candidates.length < 2) return null

  let league: { scoring: string | null; leagueVariant: string | null } | null = null
  if (leagueId) {
    league = await prisma.league
      .findUnique({ where: { id: leagueId }, select: { scoring: true, leagueVariant: true } })
      .catch(() => null)
  }

  let rows: AdpRow[] = []
  try {
    const found = await prisma.adpDataRecord.findMany({
      where: { playerName: { in: candidates }, sport: { equals: sport, mode: 'insensitive' } },
      select: { playerName: true, position: true, team: true, adp: true, format: true, scoring: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_CANDIDATES * 8,
    })
    /*
     * A player carries a row per format/scoring combination. Prefer the slice
     * matching this league, then the deepest general slice — never mix bases
     * across the two sides of one trade, which would price them on different
     * scales and call the result fair.
     */
    const preferredFormat = league?.leagueVariant?.toLowerCase().includes('dynasty')
      ? 'dynasty'
      : FALLBACK_FORMAT
    const preferredScoring = (league?.scoring ?? '').toLowerCase().includes('ppr')
      ? 'ppr'
      : FALLBACK_SCORING
    const best = new Map<string, AdpRow>()
    for (const pass of [
      (r: (typeof found)[number]) => r.format === preferredFormat && r.scoring === preferredScoring,
      (r: (typeof found)[number]) => r.format === preferredFormat,
      () => true,
    ]) {
      for (const r of found) {
        if (best.has(r.playerName)) continue
        if (!pass(r)) continue
        best.set(r.playerName, {
          playerName: r.playerName,
          position: r.position,
          team: r.team,
          adp: r.adp,
        })
      }
    }
    rows = [...best.values()]
  } catch {
    return null
  }

  if (rows.length === 0) return null

  const scoring = league ? scoringContextFor(league) : null
  const priced = rows.map((r) => ({
    row: r,
    value: normalizedPlayerValue({
      projection: null,
      adp: r.adp,
      position: r.position,
      scoring,
    }),
  }))

  const unresolved = candidates.filter((c) => !rows.some((r) => r.playerName === c))
  const lines: string[] = ['DESCRIBED TRADE — priced from current draft position (ADP), not from projected points.']

  for (const p of priced) {
    lines.push(
      `- ${p.row.playerName} (${p.row.position}, ${p.row.team}): ADP ${p.row.adp.toFixed(1)}, trade value ${p.value}.`,
    )
  }

  const left = sides ? priced.filter((p) => sides.left.includes(p.row.playerName)) : []
  const right = sides ? priced.filter((p) => sides.right.includes(p.row.playerName)) : []

  if (left.length === 0 || right.length === 0) {
    /*
     * Either no separator, or everything landed on one side. Both mean the two
     * halves of the deal are not established, and a grade would be invented.
     */
    lines.push(
      'NOT GRADED: the two sides of this trade could not be separated with confidence. Give the values above, say you could not tell which players are going which way, and ask the user to phrase it as "X for Y". Do NOT compute a fairness verdict yourself.',
    )
    if (unresolved.length > 0) {
      lines.push(`No value on file for: ${unresolved.join(', ')}. Never invent one.`)
    }
    return lines.join('\n')
  }

  const sideA: SideTotals = {
    rosterId: 'described-a',
    total: left.reduce((n, p) => n + p.value, 0),
    assets: left.map((p) => toAsset(p.row, p.value, 'described-a', 'described-b')),
  }
  const sideB: SideTotals = {
    rosterId: 'described-b',
    total: right.reduce((n, p) => n + p.value, 0),
    assets: right.map((p) => toAsset(p.row, p.value, 'described-b', 'described-a')),
  }

  const { grade } = gradeTrade(sideA, sideB)

  lines.push(
    `Side 1 (${left.map((p) => p.row.playerName).join(', ')}): ${sideA.total}. Side 2 (${right
      .map((p) => p.row.playerName)
      .join(', ')}): ${sideB.total}.`,
  )

  if (grade.insufficientData || grade.grade == null) {
    // The grader's own honesty pass — a letter here would mean nothing priced.
    lines.push(
      'NOT GRADED: nothing on either side resolved to a usable value. Say the trade cannot be priced rather than assigning a grade.',
    )
  } else {
    lines.push(
      `Grade ${grade.grade}, fairness ${grade.fairnessScore}/100, confidence ${grade.confidenceScore}/100, value gap ${Math.abs(grade.valueDifference)}.`,
    )
    if (grade.confidenceScore < 60) {
      lines.push(
        `⚠ CONFIDENCE IS LOW (${grade.confidenceScore}/100) because these are priced off draft position with no projections behind them. Lead with that caveat rather than the letter.`,
      )
    }
    for (const b of grade.bullets ?? []) lines.push(`  ${b}`)
  }

  if (unresolved.length > 0) {
    lines.push(
      `No value on file for: ${unresolved.join(', ')}. They are NOT included in the totals above — say so, and never invent a value for them.`,
    )
  }

  lines.push(
    'RULES: this is an opinion on value, not an instruction. AllFantasy never accepts or rejects a trade; point the user to their platform to act.',
  )

  return lines.join('\n')
}
