import 'server-only'

import { prisma } from '@/lib/prisma'
import { gradeTrade } from '@/lib/trade-value/grader'
import { explainPlayerValue, type ScoringContext, type ValueBasis } from '@/lib/trade-value/valueEngine'
import { newestProjectionSeason } from '@/lib/af-projections/readAfProjections'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import type { AssetValueSnapshot, SideTotals } from '@/lib/trade-value/types'
import { scoringContextFromWorld } from '@/lib/decision-os/trade/scoringContextFromWorld'

/**
 * "IS CHASE FOR GIBBS FAIR?" — grading a trade the user DESCRIBES.
 *
 * ⚠ THIS IS THE TRADE QUESTION PEOPLE ACTUALLY ASK, and it was the only one with
 * no grounded answer. The pending-proposal path reads
 * `redraft_trade_proposals`, which is empty in production; the history path reads
 * settled Sleeper trades. Neither can price a hypothetical. This one needs no
 * proposal row at all — just player values and the league's scoring.
 *
 * ⚠ VALUE NO LONGER COMES FROM ADP ALONE, AND THE REASON IT USED TO IS NOW OBSOLETE.
 *
 * This header used to read: "`fantasy_projections` holds 998 rows keyed by player id, so it
 * cannot answer a question typed as prose." True of that table, and it is why ADP — name-keyed,
 * 94,089 NFL rows over 3,152 distinct names — was the only basis a described trade could use
 * while the Sleeper-id crosswalk resolved 42%.
 *
 * `AFProjectionSnapshot` is a different table: ~19,556 rows carrying `playerName` directly, so a
 * prose question CAN reach it. Same for `allFantasy_market_player_values`. So this path now
 * consults, in the engine's own order of precedence:
 *
 *     rest-of-season projection  →  published market value  →  ADP
 *
 * ⚠ AND IT STILL SAYS WHICH ONE IT USED, PER PLAYER. "Priced off projected points", "priced off
 * the market" and "priced off draft position" are three different claims with three different
 * confidences, and a block that blurred them would be worse than the ADP-only one it replaces —
 * a mixed-basis trade where both sides look equally well-founded is exactly how a bad grade gets
 * believed.
 *
 * 🛑 THE PRECEDENCE IS NOT REIMPLEMENTED HERE. `explainPlayerValue` decides it and reports the
 * basis it chose; this module reads that report. Choosing a basis locally would be a second
 * implementation of the pricing rule, drifting the first time either side changed.
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

export interface DescribedTradeLeague {
  scoring: string | null
  leagueVariant: string | null
  /** `roster_positions`. When present the real shape is used and the label is not consulted. */
  starters?: unknown
  settings?: unknown
  rosterSize?: number | null
  irSlots?: number | null
  taxiSlots?: number | null
  teamCount?: number | null
}

/**
 * The league's scarcity context, from ROSTER SLOTS when they exist and from the scoring LABEL only
 * when they do not.
 *
 * 🛑 THE LABEL PATH IS A FALLBACK, NOT THE DESIGN, AND IT IS MEASURABLY LOSSY. It asked
 * `s.includes('2qb')`, so a league became 2QB if and only if somebody had typed that exact
 * substring. Measured against eleven plausible spellings it missed five — "Two QB Dynasty",
 * "TWO-QB", "QB2 Required", "2-QB", "startTwoQb" — and each miss priced that league's quarterbacks
 * at the 1-QB multiplier (0.85) instead of ~1.53. Roster slots cannot be misspelled.
 *
 * ⚠ AND THE LABEL PATH CANNOT SEE A 4-QB LEAGUE AT ALL. `is2QB` is a boolean; the shape carries the
 * count. That is why the fallback is kept narrow rather than improved.
 */
export function scoringContextFor(league: DescribedTradeLeague): ScoringContext {
  const starterSlots = Array.isArray(league.starters)
    ? (league.starters as unknown[]).filter((x): x is string => typeof x === 'string')
    : null

  if (starterSlots && starterSlots.length > 0 && league.teamCount && league.teamCount >= 2) {
    const fromShape = scoringContextFromWorld({
      teams: league.teamCount,
      starterSlots,
      rosterSize: league.rosterSize ?? null,
      irSlots: league.irSlots ?? null,
      taxiSlots: league.taxiSlots ?? null,
      scoringSettings: league.settings,
    })
    if (fromShape?.shape) {
      /*
       * The label still supplies scoring facts the settings blob may not carry — a league imported
       * without `scoring_settings` can still be named "…PPR TEP". Shape wins for structure; the
       * label fills only what the settings left null.
       */
      const s = (league.scoring ?? '').toLowerCase()
      return {
        ...fromShape,
        scoringFormat:
          fromShape.scoringFormat ??
          (s.includes('half') ? 'half_ppr' : s.includes('ppr') ? 'ppr' : null),
        tePremium:
          fromShape.tePremium ?? (s.includes('te_premium') || s.includes('tep') ? 0.5 : null),
      }
    }
  }

  const s = (league.scoring ?? '').toLowerCase()
  return {
    isSuperflex: s.includes('superflex') || s.includes('sflex'),
    is2QB: s.includes('2qb'),
    tePremium: s.includes('te_premium') || s.includes('tep') ? 0.5 : null,
    scoringFormat: s.includes('half') ? 'half_ppr' : s.includes('ppr') ? 'ppr' : 'standard',
  }
}

/** What every source found for one named player, plus the engine's verdict on it. */
type PricedPlayer = {
  playerName: string
  position: string
  team: string | null
  adp: number | null
  /** REST OF SEASON points. Never the per-game figure — see the lookup. */
  rosProjection: number | null
  marketValue: number | null
  value: number
  basis: ValueBasis
}

function toAsset(p: PricedPlayer, from: string, to: string): AssetValueSnapshot {
  return {
    kind: 'player',
    fromRosterId: from,
    toRosterId: to,
    playerId: null,
    playerName: p.playerName,
    position: p.position,
    team: p.team,
    sources: {
      /*
       * ⚠ `projectionValue` IS NOW FILLED WHEN THERE GENUINELY IS ONE, and the old comment here
       * said it must stay null. That was right for its time and is wrong now. The reasoning was:
       * `computeConfidence` reads this field to decide how much to trust the grade, and an
       * ADP-DERIVED number is not a projection, so filling it would inflate confidence on every
       * described trade.
       *
       * Both halves still hold. What changed is that a real rest-of-season projection is now
       * reachable by name, so this carries the projection when one exists and null when it does
       * not — which is what makes the confidence score mean something instead of being uniformly
       * pessimistic.
       */
      projectionValue: p.rosProjection,
      rankingValue: null,
      adpValue: p.adp,
      fantasyCalcValue: p.marketValue,
      /*
       * IDP value is computed from a league's own scoring and starting slots, and is keyed on
       * `sleeperId` — the crosswalk a described trade cannot rely on. Still null, still the
       * truthful answer, and the block below now says so out loud for defenders rather than
       * letting an ADP number stand in silently.
       */
      idpValue: null,
    },
    internalValue: p.value,
  }
}

/** Positions this path cannot price honestly: IDP values need a league AND a sleeperId. */
const IDP_POSITIONS = new Set(['LB', 'DL', 'DE', 'DT', 'DB', 'CB', 'S', 'SS', 'FS', 'ILB', 'OLB'])

/** How each basis is described to the model. The wording carries the confidence. */
const BASIS_PHRASE: Record<ValueBasis, string> = {
  projection: 'projected points',
  market: 'published market value',
  none: 'draft position only',
  idp: 'defensive scarcity',
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

  let league: DescribedTradeLeague | null = null
  if (leagueId) {
    const row = await prisma.league
      .findUnique({
        where: { id: leagueId },
        select: {
          scoring: true, leagueVariant: true,
          starters: true, settings: true, rosterSize: true, irSlots: true, taxiSlots: true,
          _count: { select: { teams: true } },
        },
      })
      .catch(() => null)
    if (row) {
      league = {
        scoring: row.scoring, leagueVariant: row.leagueVariant,
        starters: row.starters, settings: row.settings, rosterSize: row.rosterSize,
        irSlots: row.irSlots, taxiSlots: row.taxiSlots,
        teamCount: row._count?.teams ?? null,
      }
    }
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

  /*
   * ── The two sources that were unreachable when this module was written ──────────────────
   *
   * Both are name-keyed, so a prose question reaches them; both are best-effort, so a failure
   * degrades to the ADP-only behaviour this path has always had rather than losing the answer.
   *
   * ⚠ ONLY `rosProjection` IS TAKEN, NEVER `afProjection`. The engine expects a REST-OF-SEASON
   * total and `afProjection` is PER GAME — substituting it understates a player by roughly the
   * weeks remaining, and it would look entirely plausible.
   */
  const byName = <T extends { playerName: string | null }>(list: T[]) => {
    const m = new Map<string, T>()
    for (const r of list) {
      const k = normalizePlayerName(String(r.playerName ?? ''))
      if (k && !m.has(k)) m.set(k, r)
    }
    return m
  }

  const projSeason = await newestProjectionSeason(sport).catch(() => null)
  const [projRows, marketRows] = await Promise.all([
    projSeason == null
      ? Promise.resolve([])
      : prisma.aFProjectionSnapshot
          .findMany({
            where: { sport, season: projSeason, playerName: { in: candidates } },
            select: { playerName: true, position: true, rosProjection: true, week: true, computedAt: true },
            orderBy: [{ week: { sort: 'desc', nulls: 'last' } }, { computedAt: 'desc' }],
            take: MAX_CANDIDATES * 6,
          })
          .catch(() => []),
    prisma.allFantasyMarketPlayerValue
      .findMany({
        where: { published: true, sport, playerName: { in: candidates } },
        select: { playerName: true, position: true, marketValue: true },
        orderBy: { marketValue: 'desc' },
        take: MAX_CANDIDATES * 4,
      })
      .catch(() => []),
  ])

  const projByName = byName(projRows)
  const marketByName = byName(marketRows)

  /*
   * ⚠ THE UNION, NOT THE ADP LIST. A player with a projection but no ADP row used to be
   * "no value on file" — which was true of ADP and false of us.
   */
  const merged = new Map<string, { playerName: string; position: string; team: string | null }>()
  for (const r of rows) {
    merged.set(normalizePlayerName(r.playerName), { playerName: r.playerName, position: r.position, team: r.team })
  }
  for (const [k, r] of projByName) {
    if (!merged.has(k)) merged.set(k, { playerName: r.playerName ?? '', position: r.position ?? '', team: null })
  }
  for (const [k, r] of marketByName) {
    if (!merged.has(k)) merged.set(k, { playerName: r.playerName ?? '', position: r.position ?? '', team: null })
  }
  if (merged.size === 0) return null

  const adpByName = byName(rows)
  const scoring = league ? scoringContextFor(league) : null

  const priced: PricedPlayer[] = [...merged.entries()].map(([k, base]) => {
    const adp = adpByName.get(k)?.adp ?? null
    const ros = projByName.get(k)?.rosProjection ?? null
    const market = marketByName.get(k)?.marketValue ?? null
    const d = explainPlayerValue({
      projection: ros,
      adp,
      position: base.position,
      marketValue: market,
      idpValue: null,
      scoring,
    })
    return {
      playerName: base.playerName,
      position: base.position,
      team: base.team,
      adp,
      rosProjection: ros,
      marketValue: market,
      value: d.value,
      basis: d.basis,
    }
  })

  const unresolved = candidates.filter((c) => !merged.has(normalizePlayerName(c)))

  /*
   * ⚠ THE HEADLINE NAMES THE MIX. Every player priced off projections is a different claim from
   * every player priced off draft position, and a trade spanning both is weaker than either.
   */
  const bases = [...new Set(priced.map((p) => p.basis))]
  const headline =
    bases.length === 1
      ? `DESCRIBED TRADE — every player priced from ${BASIS_PHRASE[bases[0]]}.`
      : `DESCRIBED TRADE — MIXED BASES: ${bases.map((b) => BASIS_PHRASE[b]).join(' and ')}. Say so; the sides are not equally well-founded.`
  const lines: string[] = [headline]

  for (const p of priced) {
    const detail: string[] = []
    if (p.rosProjection != null) detail.push(`${p.rosProjection.toFixed(1)} projected points (rest of season)`)
    if (p.marketValue != null) detail.push(`market ${p.marketValue.toLocaleString()}`)
    if (p.adp != null) detail.push(`ADP ${p.adp.toFixed(1)}`)
    lines.push(
      `- ${p.playerName} (${p.position}${p.team ? `, ${p.team}` : ''}): trade value ${p.value}, from ${BASIS_PHRASE[p.basis]}${detail.length ? ` — ${detail.join(', ')}` : ''}.`,
    )
  }

  /*
   * 🛑 DEFENDERS ARE NOT PRICED HERE, AND SILENCE ABOUT THAT IS THE DANGEROUS PART. An IDP value
   * needs the league's own defensive slots AND a sleeperId, neither of which a prose question
   * reliably carries. Without this line a linebacker priced off his ADP looks exactly like a
   * receiver priced off his projection, and the grade reads as sound.
   */
  const idpNames = priced.filter((p) => IDP_POSITIONS.has(p.position.toUpperCase())).map((p) => p.playerName)
  if (idpNames.length > 0) {
    lines.push(
      `⚠ ${idpNames.join(', ')} ${idpNames.length === 1 ? 'is a defensive player' : 'are defensive players'}, and this path cannot price defenders properly — an IDP value needs the league's own defensive starting slots. Any number above for ${idpNames.length === 1 ? 'him' : 'them'} is borrowed from a different basis. Say that plainly before giving a verdict.`,
    )
  }

  const left = sides ? priced.filter((p) => sides.left.includes(p.playerName)) : []
  const right = sides ? priced.filter((p) => sides.right.includes(p.playerName)) : []

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
    assets: left.map((p) => toAsset(p, 'described-a', 'described-b')),
  }
  const sideB: SideTotals = {
    rosterId: 'described-b',
    total: right.reduce((n, p) => n + p.value, 0),
    assets: right.map((p) => toAsset(p, 'described-b', 'described-a')),
  }

  const { grade } = gradeTrade(sideA, sideB)

  lines.push(
    `Side 1 (${left.map((p) => p.playerName).join(', ')}): ${sideA.total}. Side 2 (${right
      .map((p) => p.playerName)
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
      /*
       * ⚠ THIS USED TO ASSERT THE CAUSE — "because these are priced off draft position with no
       * projections behind them" — which was true when ADP was the only basis available and is
       * now a guess. With projections wired in, a low score can also mean a thin or one-sided
       * deal. So it reports the bases actually used and lets the reason follow from them, rather
       * than naming a cause it did not measure.
       */
      const used = [...new Set(priced.map((p) => BASIS_PHRASE[p.basis]))].join(' and ')
      lines.push(
        `⚠ CONFIDENCE IS LOW (${grade.confidenceScore}/100). These players were priced from ${used}. Lead with that caveat rather than the letter.`,
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
