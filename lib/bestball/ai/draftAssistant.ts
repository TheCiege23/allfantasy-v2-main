import type { BestBallSportTemplate } from '@prisma/client'
import { validateBestBallRoster } from '../rosterValidator'

/**
 * Best ball live-draft recommendations — deterministic, no model call.
 *
 * 🛑 THIS USED TO RETURN THE FIRST THREE PLAYERS THE CLIENT SENT, in the order it sent them, whatever
 * their value or the roster's needs, with reasoning strings that described analysis nobody did.
 *
 * What it can honestly use is what its one caller (`POST /api/bestball/ai/draft-rec`) receives: each
 * available player's id, name, position, optional ADP and optional NFL team, plus the drafter's
 * current roster and the league's `BestBallSportTemplate` (roster size and per-position depth
 * targets — the same `depthRequirements` `validateBestBallRoster` checks). There is no projection,
 * floor, ceiling or ownership data, so every pick below is built from ADP and roster need only, and
 * each reasoning string says which of those decided it.
 *
 * The picks are different RULES, not different slices of one list:
 *   best        lowest ADP after weighting for roster need (a needed position moves a player up by up
 *               to one round; a position already at its depth target moves him down one round)
 *   safe        the highest-ranked player left at the position you are shortest at — the consensus
 *               option there, which is the only floor signal ADP carries
 *   upside      the player who has fallen furthest past his ADP, ignoring need
 *   structural  only when a position has nobody yet: the highest-ranked player at that empty position
 *   leverage    tournament only: a pass catcher on the same NFL team as a quarterback you already
 *               have (a stack), when team data was sent
 *
 * Ordering never depends on the order players arrive in: ties break on name, then id.
 */

export type DraftedPlayer = { playerId: string; name: string; pos: string; team?: string }
export type DraftPlayer = { playerId: string; name: string; pos: string; adp?: number; team?: string }

type RecommendedPick = { playerId: string; name: string; position: string; reasoning: string }

type DraftRecommendation = {
  /** Null only when no usable player was sent. */
  bestPick: RecommendedPick | null
  safePick: RecommendedPick | null
  upsidePick: RecommendedPick | null
  structuralPick: RecommendedPick | null
  leveragePick: RecommendedPick | null
  rosterAlert: string | null
  pickContext: string
}

/** How far roster need can move a player, in picks. One round of a 12-team draft. */
const NEED_WINDOW = 12

/** Leverage never suggests reaching more than this many picks ahead of ADP. */
const LEVERAGE_REACH = NEED_WINDOW

type PositionNeed = { pos: string; required: number; have: number; deficit: number }

type Candidate = DraftPlayer & { adpValue: number | null; positions: string[] }

function positionsOf(pos: string): string[] {
  return String(pos ?? '')
    .toUpperCase()
    .split(/[/,\s]+/)
    .filter(Boolean)
}

function finiteAdp(adp: unknown): number | null {
  return typeof adp === 'number' && Number.isFinite(adp) && adp > 0 ? adp : null
}

function fmtAdp(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/** ADP ascending (unknown ADP last), then name, then id — never input order. */
function byAdp(a: Candidate, b: Candidate): number {
  const aa = a.adpValue ?? Number.POSITIVE_INFINITY
  const bb = b.adpValue ?? Number.POSITIVE_INFINITY
  if (aa !== bb) return aa < bb ? -1 : 1
  return a.name.localeCompare(b.name) || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0)
}

function readDepth(template: BestBallSportTemplate): Record<string, number> {
  const raw = template.depthRequirements
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k.toUpperCase()] = v
  }
  return out
}

function rosterNeeds(roster: DraftedPlayer[], depth: Record<string, number>): PositionNeed[] {
  return Object.keys(depth)
    .sort()
    .map((pos) => {
      const required = depth[pos]!
      const have = roster.filter((p) => positionsOf(p.pos).includes(pos)).length
      return { pos, required, have, deficit: Math.max(0, required - have) }
    })
}

function toPick(c: Candidate, reasoning: string): RecommendedPick {
  return { playerId: c.playerId, name: c.name, position: c.pos, reasoning }
}

function adpPhrase(c: Candidate): string {
  return c.adpValue != null ? `ADP ${fmtAdp(c.adpValue)}` : 'no ADP sent'
}

export async function getLiveDraftRecommendation(
  currentRoster: DraftedPlayer[],
  availablePlayers: DraftPlayer[],
  sport: string,
  variant: string,
  draftSlot: number,
  pickNumber: number,
  template: BestBallSportTemplate,
): Promise<DraftRecommendation> {
  const roster = Array.isArray(currentRoster) ? currentRoster.filter((p) => p && typeof p.pos === 'string') : []
  const v = validateBestBallRoster(
    roster.map((p) => ({ position: p.pos })),
    template,
  )
  const depth = readDepth(template)
  const needs = rosterNeeds(roster, depth)
  const needByPos = new Map(needs.map((n) => [n.pos, n]))
  const picksLeft = Math.max(0, (Number(template.rosterSize) || 0) - roster.length)

  // Only players actually sent, each once, never one already on this roster.
  const owned = new Set(roster.map((p) => p.playerId))
  const seen = new Set<string>()
  const pool: Candidate[] = []
  for (const p of Array.isArray(availablePlayers) ? availablePlayers : []) {
    if (!p || typeof p.playerId !== 'string' || !p.playerId || typeof p.pos !== 'string' || !p.pos.trim()) continue
    if (owned.has(p.playerId) || seen.has(p.playerId)) continue
    seen.add(p.playerId)
    pool.push({ ...p, name: typeof p.name === 'string' && p.name ? p.name : p.playerId, adpValue: finiteAdp(p.adp), positions: positionsOf(p.pos) })
  }
  pool.sort(byAdp)
  const hasAdp = pool.some((c) => c.adpValue != null)

  const needLine = needs
    .filter((n) => n.deficit > 0)
    .map((n) => `${n.pos} ${n.have} of ${n.required}`)
    .join(', ')
  const contextParts = [
    `Pick ${pickNumber} (slot ${draftSlot}), ${sport} ${variant}: ${picksLeft} roster spot${picksLeft === 1 ? '' : 's'} left.`,
    needLine ? `Still short of depth targets at ${needLine}.` : 'Every depth target is met.',
  ]
  if (!hasAdp && pool.length) contextParts.push('No ADP was sent, so players are compared on roster need only and listed by name.')

  if (pool.length === 0) {
    return {
      bestPick: null,
      safePick: null,
      upsidePick: null,
      structuralPick: null,
      leveragePick: null,
      rosterAlert: v.criticalErrors[0]?.issue ?? null,
      pickContext: [...contextParts, 'No available players were sent, so there is nothing to recommend.'].join(' '),
    }
  }

  /** The most a player's positions are needed: 1 = none of that position yet, 0 = target met. */
  const needRatio = (c: Candidate): number => {
    let best = -1
    for (const pos of c.positions) {
      const n = needByPos.get(pos)
      if (n) best = Math.max(best, n.deficit / n.required)
    }
    return best
  }
  /** Picks moved: up to a round earlier when needed, a round later when the position is full or off-template. */
  const needShift = (c: Candidate): number => {
    const r = needRatio(c)
    return r > 0 ? -NEED_WINDOW * r : NEED_WINDOW
  }
  const weighted = (c: Candidate): number => (c.adpValue ?? 10_000) + needShift(c)
  const scored = [...pool].sort((a, b) => weighted(a) - weighted(b) || byAdp(a, b))

  // ── Structural: a position with nobody on it. Scarcest such position first.
  const emptyPositions = needs.filter((n) => n.have === 0)
  let structural: { candidate: Candidate; need: PositionNeed } | null = null
  const unfillable: string[] = []
  {
    const options = emptyPositions
      .map((need) => ({ need, players: pool.filter((c) => c.positions.includes(need.pos)) }))
      .filter((o) => {
        if (o.players.length === 0) unfillable.push(o.need.pos)
        return o.players.length > 0
      })
      .sort((a, b) => a.players.length - b.players.length || b.need.required - a.need.required || a.need.pos.localeCompare(b.need.pos))
    if (options[0]) structural = { candidate: options[0].players[0]!, need: options[0].need }
  }
  // Out of room: when the spots left cannot cover every empty position, the structural pick IS the pick.
  const forced = structural != null && picksLeft > 0 && picksLeft <= emptyPositions.length

  // ── Best.
  const bestCandidate = forced ? structural!.candidate : scored[0]!
  const bestReason = (() => {
    const c = bestCandidate
    if (forced) {
      return `You have ${picksLeft} spot${picksLeft === 1 ? '' : 's'} left and no ${structural!.need.pos} yet, so this pick has to be a ${structural!.need.pos}; ${c.name} is the highest-ranked one left (${adpPhrase(c)}).`
    }
    const r = needRatio(c)
    const pos = c.positions.find((p) => needByPos.get(p)?.deficit) ?? c.positions[0] ?? c.pos
    const n = needByPos.get(pos)
    if (r > 0 && n) {
      return `Best value once roster need is counted: ${adpPhrase(c)}, and you have ${n.have} of the ${n.required} ${pos} your depth target asks for.`
    }
    return hasAdp
      ? `Best value left by ADP (${adpPhrase(c)}). Every position he plays already meets its depth target, but nobody at a needed position is close enough in ADP to take first.`
      : `Every needed position is filled, and no ADP was sent to rank the rest, so this is the first player by name.`
  })()
  const taken = new Set<string>([bestCandidate.playerId])

  // ── Safe: the consensus option at your thinnest position.
  let safe: RecommendedPick | null = null
  {
    const thin = needs
      .filter((n) => n.deficit > 0)
      .map((n) => ({ n, players: pool.filter((c) => c.positions.includes(n.pos) && !taken.has(c.playerId)) }))
      .filter((o) => o.players.length > 0)
      .sort((a, b) => b.n.deficit / b.n.required - a.n.deficit / a.n.required || b.n.deficit - a.n.deficit || a.n.pos.localeCompare(b.n.pos))[0]
    if (thin) {
      const c = thin.players[0]!
      safe = toPick(
        c,
        `Your thinnest position is ${thin.n.pos} (${thin.n.have} of ${thin.n.required}); ${c.name} is the highest-ranked ${thin.n.pos} left (${adpPhrase(c)}), the consensus way to fill it.`,
      )
    } else {
      const c = pool.find((p) => !taken.has(p.playerId))
      if (c) {
        safe = toPick(
          c,
          needs.some((n) => n.deficit > 0)
            ? `Nobody else is left at a position you still need, so this is the highest-ranked player remaining (${adpPhrase(c)}).`
            : `Every depth target is met, so this is the highest-ranked player remaining after the best pick (${adpPhrase(c)}).`,
        )
      }
    }
    if (safe) taken.add(safe.playerId)
  }

  // ── Upside: furthest past ADP, ignoring need. Needs ADP to mean anything.
  let upside: RecommendedPick | null = null
  {
    const c = pool.find((p) => p.adpValue != null && !taken.has(p.playerId))
    if (c) {
      const gap = pickNumber - c.adpValue!
      upside = toPick(
        c,
        gap >= 1
          ? `Biggest fall on the board: ${adpPhrase(c)} at pick ${pickNumber}, ${fmtAdp(gap)} pick${gap === 1 ? '' : 's'} later than drafters usually take him. This ignores roster need.`
          : `The best ADP left after the picks above (${adpPhrase(c)}). Nobody remaining has fallen past his ADP at pick ${pickNumber}. This ignores roster need.`,
      )
      taken.add(c.playerId)
    }
  }

  // ── Structural pick.
  const structuralPick = structural
    ? toPick(
        structural.candidate,
        `You have no ${structural.need.pos} yet and need ${structural.need.required} for a legal best ball lineup across bye and rest weeks; ${structural.candidate.name} is the highest-ranked ${structural.need.pos} left (${adpPhrase(structural.candidate)}).`,
      )
    : null

  // ── Leverage: tournament-only QB stack, when team data allows.
  let leveragePick: RecommendedPick | null = null
  if (variant === 'tournament' && depth.QB) {
    const qbTeams = new Set(
      roster
        .filter((p) => positionsOf(p.pos).includes('QB') && typeof p.team === 'string' && p.team.trim())
        .map((p) => p.team!.trim().toUpperCase()),
    )
    if (qbTeams.size) {
      const stack = pool.find(
        (c) =>
          !taken.has(c.playerId) &&
          typeof c.team === 'string' &&
          qbTeams.has(c.team.trim().toUpperCase()) &&
          c.positions.some((p) => p === 'WR' || p === 'TE') &&
          c.adpValue != null &&
          c.adpValue <= pickNumber + LEVERAGE_REACH,
      )
      if (stack) {
        const team = stack.team!.trim().toUpperCase()
        const qb = roster.find((p) => positionsOf(p.pos).includes('QB') && p.team?.trim().toUpperCase() === team)
        leveragePick = toPick(
          stack,
          `Stacks with your quarterback${qb?.name ? ` ${qb.name}` : ''} on ${team}: in a tournament, a quarterback and his pass catcher having the same big week is what separates a top finish (${adpPhrase(stack)}).`,
        )
      }
    }
  }

  const alerts: string[] = []
  if (v.criticalErrors[0]) alerts.push(v.criticalErrors[0].issue)
  if (unfillable.length) alerts.push(`No ${unfillable.join(', ')} left in the players sent — that position cannot be filled from this list.`)
  if (structural && picksLeft > 0 && picksLeft <= emptyPositions.length) {
    alerts.push(`Only ${picksLeft} spot${picksLeft === 1 ? '' : 's'} left for ${emptyPositions.length} empty position${emptyPositions.length === 1 ? '' : 's'}.`)
  }

  return {
    bestPick: toPick(bestCandidate, bestReason),
    safePick: safe,
    upsidePick: upside,
    structuralPick,
    leveragePick,
    rosterAlert: alerts.length ? alerts.join(' ') : null,
    pickContext: contextParts.join(' '),
  }
}
