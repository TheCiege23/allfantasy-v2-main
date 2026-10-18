/**
 * Draft pulse — pure helpers behind the "draft pulse" strip and the board's
 * steal / reach badges.
 *
 * Pure logic only — no Prisma, no fetch, no React.
 *
 * ADP here is the MARKET ADP (`PlayerEntry.adp`). The AI board is deliberately
 * not used as a fallback: a value badge reads as a market claim ("taken 9 spots
 * after ADP"), and the room already refuses to narrate the AI number as one
 * (see the `hasRealAdp` note in DraftRoomPageClient). No ADP → no badge.
 *
 * Sign convention, everywhere in this module:
 *   delta = overall - adp
 *   delta > 0  → taken LATER than ADP (value / steal)
 *   delta < 0  → taken EARLIER than ADP (reach)
 */

export type PulsePick = {
  overall: number
  rosterId: string
  displayName: string | null
  playerName: string
  position: string
  playerId: string | null
  /** Commissioner pick editor cleared this cell; no player assigned. */
  pickEditorEmpty?: boolean
}

export type PulsePoolPlayer = {
  playerId?: string | null
  name: string
  position: string
  adp?: number | null
}

export type AdpLookup = (pick: Pick<PulsePick, 'playerId' | 'playerName' | 'position'>) => number | null

function normName(name: string | null | undefined): string {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function normPos(pos: string | null | undefined): string {
  return String(pos ?? '').trim().toUpperCase()
}

function validAdp(adp: number | null | undefined): adp is number {
  return typeof adp === 'number' && Number.isFinite(adp) && adp > 0
}

/** Picks that carry a real player (skips commissioner-cleared cells). */
export function isFilledPick(pick: PulsePick): boolean {
  return !pick.pickEditorEmpty && String(pick.playerName ?? '').trim().length > 0
}

/** Build a market-ADP lookup keyed by player id first, then name + position. */
export function buildAdpLookup(pool: readonly PulsePoolPlayer[]): AdpLookup {
  const byId = new Map<string, number>()
  const byNamePos = new Map<string, number>()
  for (const p of pool) {
    if (!validAdp(p.adp)) continue
    const id = p.playerId ? String(p.playerId).trim() : ''
    if (id && !byId.has(id)) byId.set(id, p.adp)
    const key = `${normName(p.name)}|${normPos(p.position)}`
    if (!byNamePos.has(key)) byNamePos.set(key, p.adp)
  }
  return (pick) => {
    const id = pick.playerId ? String(pick.playerId).trim() : ''
    if (id && byId.has(id)) return byId.get(id)!
    return byNamePos.get(`${normName(pick.playerName)}|${normPos(pick.position)}`) ?? null
  }
}

/** overall - adp; null when the player has no market ADP. */
export function pickAdpDelta(overall: number, adp: number | null | undefined): number | null {
  if (!validAdp(adp) || !Number.isFinite(overall)) return null
  return overall - adp
}

/** Board badge map: overall → rounded delta, only where |delta| >= threshold. */
export function buildAdpDeltaByOverall(
  picks: readonly PulsePick[],
  lookup: AdpLookup,
  threshold = 3,
): Record<number, number> {
  const out: Record<number, number> = {}
  for (const pick of picks) {
    if (!isFilledPick(pick)) continue
    const d = pickAdpDelta(pick.overall, lookup(pick))
    if (d == null || Math.abs(d) < threshold) continue
    out[pick.overall] = Math.round(d)
  }
  return out
}

export type PositionRun = {
  position: string
  /** Consecutive most-recent picks at `position`. */
  length: number
}

/**
 * The trailing streak of same-position picks, when it is at least `minRun` long.
 * Picks are ordered by `overall`; cleared cells are skipped.
 */
export function detectPositionRun(picks: readonly PulsePick[], minRun = 3): PositionRun | null {
  const filled = picks.filter(isFilledPick).sort((a, b) => a.overall - b.overall)
  if (filled.length === 0) return null
  const position = normPos(filled[filled.length - 1]!.position)
  if (!position) return null
  let length = 0
  for (let i = filled.length - 1; i >= 0; i -= 1) {
    if (normPos(filled[i]!.position) !== position) break
    length += 1
  }
  return length >= minRun ? { position, length } : null
}

/** Positions of the last `size` filled picks, oldest first. */
export function recentPickPositions(picks: readonly PulsePick[], size = 8): string[] {
  return picks
    .filter(isFilledPick)
    .sort((a, b) => a.overall - b.overall)
    .slice(-size)
    .map((p) => normPos(p.position))
}

/**
 * Available players at `position` whose market ADP falls inside the next
 * `horizon` picks — "how much of this tier is left". Sorted by ADP.
 */
export function positionTierRemaining(
  available: readonly PulsePoolPlayer[],
  position: string,
  currentOverall: number,
  horizon: number,
): PulsePoolPlayer[] {
  const pos = normPos(position)
  return available
    .filter((p) => normPos(p.position) === pos && validAdp(p.adp) && p.adp <= currentOverall + horizon)
    .sort((a, b) => (a.adp as number) - (b.adp as number))
}

export type PickValueRef = {
  overall: number
  playerName: string
  displayName: string | null
  delta: number
}

export type DraftValueSummary = {
  /** Sum of the viewer's deltas; null when none of their picks has ADP. */
  viewerTotal: number | null
  viewerPicksWithAdp: number
  biggestSteal: PickValueRef | null
  biggestReach: PickValueRef | null
}

export function summarizeDraftValue(
  picks: readonly PulsePick[],
  lookup: AdpLookup,
  viewerRosterId: string | null | undefined,
): DraftValueSummary {
  let viewerTotal = 0
  let viewerPicksWithAdp = 0
  let biggestSteal: PickValueRef | null = null
  let biggestReach: PickValueRef | null = null
  for (const pick of picks) {
    if (!isFilledPick(pick)) continue
    const delta = pickAdpDelta(pick.overall, lookup(pick))
    if (delta == null) continue
    const ref: PickValueRef = {
      overall: pick.overall,
      playerName: pick.playerName,
      displayName: pick.displayName,
      delta,
    }
    if (delta > 0 && (!biggestSteal || delta > biggestSteal.delta)) biggestSteal = ref
    if (delta < 0 && (!biggestReach || delta < biggestReach.delta)) biggestReach = ref
    if (viewerRosterId && pick.rosterId === viewerRosterId) {
      viewerTotal += delta
      viewerPicksWithAdp += 1
    }
  }
  return {
    viewerTotal: viewerPicksWithAdp > 0 ? viewerTotal : null,
    viewerPicksWithAdp,
    biggestSteal,
    biggestReach,
  }
}

/**
 * Rough chance a player is still on the board at `targetOverall`, from market
 * ADP alone: a logistic curve centred on ADP. `spread` is in picks — larger
 * means draft rooms deviate more from ADP. A heuristic, not a model; callers
 * should present it as an estimate.
 */
export function survivalProbability(
  adp: number | null | undefined,
  targetOverall: number,
  spread = 6,
): number | null {
  if (!validAdp(adp) || !Number.isFinite(targetOverall) || spread <= 0) return null
  return 1 / (1 + Math.exp(-(adp - targetOverall) / spread))
}

export type ManagerTendencyKind = 'reacher' | 'value_hunter' | 'adp_loyal' | 'unknown'

export type ManagerTendency = {
  kind: ManagerTendencyKind
  /** Mean delta across the manager's picks that have ADP. */
  averageDelta: number | null
  sample: number
}

/**
 * Classify a manager from this draft's picks so far. Needs at least
 * `minSample` picks with ADP; `band` is the +/- picks counted as "on ADP".
 */
export function classifyManagerTendency(
  picks: readonly PulsePick[],
  rosterId: string,
  lookup: AdpLookup,
  { minSample = 2, band = 2 }: { minSample?: number; band?: number } = {},
): ManagerTendency {
  const deltas: number[] = []
  for (const pick of picks) {
    if (pick.rosterId !== rosterId || !isFilledPick(pick)) continue
    const d = pickAdpDelta(pick.overall, lookup(pick))
    if (d != null) deltas.push(d)
  }
  if (deltas.length < minSample) {
    return { kind: 'unknown', averageDelta: null, sample: deltas.length }
  }
  const averageDelta = deltas.reduce((s, d) => s + d, 0) / deltas.length
  const kind: ManagerTendencyKind =
    averageDelta <= -band ? 'reacher' : averageDelta >= band ? 'value_hunter' : 'adp_loyal'
  return { kind, averageDelta, sample: deltas.length }
}

/** "+4.5" / "−3.0" / "0.0" — signed, one decimal, typographic minus. */
export function formatAdpDelta(delta: number): string {
  const abs = Math.abs(delta).toFixed(1)
  if (delta > 0) return `+${abs}`
  if (delta < 0) return `−${abs}`
  return abs
}
