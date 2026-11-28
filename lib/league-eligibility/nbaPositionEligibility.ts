/**
 * NBA position eligibility for one league: the player's listed positions, plus what the
 * commissioner added, minus what the commissioner removed. Pure and client-safe.
 *
 * WHY THIS EXISTS. A native AF NBA player had exactly ONE position — `SportsPlayer.position`, copied
 * onto the roster row — and `playerEligibleForSlot` (lib/league/lineup-swap.ts) compared that single
 * string to the slot. So "Amen Thompson should also be SF" had no answer in AF at all, and a
 * commissioner had no tool. Yahoo's tool can only ADD, never remove, and keeps no log league mates
 * can read. This module is the rule; `positionEligibilityStore.ts` keeps the log.
 *
 * ⚠ THE LOG IS APPEND-ONLY AND THE CURRENT STATE IS A FOLD OF IT. Nothing is edited in place, so the
 * log league members see is the same record the lineup check reads. A "reset" entry undoes the
 * commissioner's earlier change for that position and puts the listed position back in charge.
 *
 * ⚠ A PLAYER ALWAYS KEEPS AT LEAST ONE POSITION. Removing every position would make him unstartable
 * in every slot including UTIL — a roster punishment, not an eligibility call. `planEligibilityChange`
 * refuses it, so the fold can never be asked to produce it.
 */

/** The five positions a commissioner can add or remove. `G`/`F` are slot names, not player positions. */
export const NBA_ELIGIBILITY_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const
export type NbaEligibilityPosition = (typeof NBA_ELIGIBILITY_POSITIONS)[number]

export type EligibilityAction = 'add' | 'remove' | 'reset'

export type EligibilityChange = {
  playerId: string
  playerName: string
  position: NbaEligibilityPosition
  action: EligibilityAction
  reason: string | null
  actorUserId: string
  actorName?: string | null
  createdAt: Date | string
}

export type PlayerEligibility = {
  /** Positions the player is listed at, before any commissioner change. */
  listed: NbaEligibilityPosition[]
  /** Commissioner-added positions still in force. */
  added: NbaEligibilityPosition[]
  /** Listed positions the commissioner removed, still in force. */
  removed: NbaEligibilityPosition[]
  /** What the lineup check uses: listed + added − removed, in PG→C order. */
  effective: NbaEligibilityPosition[]
}

const ORDER = new Map<string, number>(NBA_ELIGIBILITY_POSITIONS.map((p, i) => [p, i]))

export function isNbaEligibilityPosition(value: unknown): value is NbaEligibilityPosition {
  return typeof value === 'string' && ORDER.has(value.trim().toUpperCase()) && value === value.trim().toUpperCase()
}

function sortPositions(positions: Iterable<NbaEligibilityPosition>): NbaEligibilityPosition[] {
  return [...new Set(positions)].sort((a, b) => (ORDER.get(a) ?? 9) - (ORDER.get(b) ?? 9))
}

/**
 * Listed positions from a stored position string. Handles every spelling our sources write:
 * Yahoo's `display_position` ("PG,SG"), slash forms ("G/F", "SF/PF"), Rolling Insights' single code,
 * and the broad words. A broad `G` means PG+SG and `F` means SF+PF — the same people the slot table
 * (lib/core-app/sportSlotEligibility.ts) seats there. Unknown tokens are dropped, never guessed.
 */
export function parseListedNbaPositions(raw: string | null | undefined): NbaEligibilityPosition[] {
  const out: NbaEligibilityPosition[] = []
  for (const token of String(raw ?? '').toUpperCase().split(/[\s,/|-]+/)) {
    const t = token.trim()
    if (!t) continue
    if (ORDER.has(t)) out.push(t as NbaEligibilityPosition)
    else if (t === 'G' || t === 'GUARD') out.push('PG', 'SG')
    else if (t === 'F' || t === 'FORWARD') out.push('SF', 'PF')
    else if (t === 'GF') out.push('SG', 'SF')
    else if (t === 'FC') out.push('PF', 'C')
    else if (t === 'CENTER' || t === 'CENTRE') out.push('C')
  }
  return sortPositions(out)
}

/** Oldest first, ties kept in input order — the fold below depends on it. */
function chronological(changes: readonly EligibilityChange[]): EligibilityChange[] {
  return changes
    .map((c, i) => ({ c, i, t: new Date(c.createdAt).getTime() }))
    .sort((a, b) => (a.t - b.t) || (a.i - b.i))
    .map((x) => x.c)
}

/** Fold one player's change log over his listed positions. */
export function resolvePlayerEligibility(
  listedRaw: string | null | undefined,
  changes: readonly EligibilityChange[],
): PlayerEligibility {
  const listed = parseListedNbaPositions(listedRaw)
  const added = new Set<NbaEligibilityPosition>()
  const removed = new Set<NbaEligibilityPosition>()
  for (const change of chronological(changes)) {
    const p = change.position
    if (change.action === 'add') {
      removed.delete(p)
      if (!listed.includes(p)) added.add(p)
    } else if (change.action === 'remove') {
      added.delete(p)
      if (listed.includes(p)) removed.add(p)
    } else {
      added.delete(p)
      removed.delete(p)
    }
  }
  const effective = sortPositions([...listed.filter((p) => !removed.has(p)), ...added])
  return { listed, added: sortPositions(added), removed: sortPositions(removed), effective }
}

/** Every player's state from one league's whole log. Players with no change are absent. */
export function resolveLeagueEligibility(
  changes: readonly EligibilityChange[],
  listedById: ReadonlyMap<string, string | null | undefined>,
): Map<string, PlayerEligibility> {
  const byPlayer = new Map<string, EligibilityChange[]>()
  for (const c of changes) byPlayer.set(c.playerId, [...(byPlayer.get(c.playerId) ?? []), c])
  const out = new Map<string, PlayerEligibility>()
  for (const [playerId, list] of byPlayer) {
    const state = resolvePlayerEligibility(listedById.get(playerId), list)
    if (state.added.length || state.removed.length) out.set(playerId, state)
  }
  return out
}

/** The position string a roster row carries once commissioner changes apply ("PG,SF"). */
export function effectivePositionString(state: PlayerEligibility): string {
  return state.effective.join(',')
}

export type PlanResult =
  | { ok: true; change: Omit<EligibilityChange, 'createdAt' | 'actorUserId' | 'actorName'>; next: PlayerEligibility }
  | { ok: false; error: string }

/**
 * Validate a requested change against the player's current state before it is written. Refuses
 * no-ops (so the public log never fills with changes that changed nothing) and removing the last
 * position.
 */
export function planEligibilityChange(args: {
  playerId: string
  playerName: string
  listedRaw: string | null | undefined
  history: readonly EligibilityChange[]
  position: unknown
  action: unknown
  reason?: unknown
}): PlanResult {
  const position = typeof args.position === 'string' ? args.position.trim().toUpperCase() : ''
  if (!isNbaEligibilityPosition(position)) return { ok: false, error: 'Pick PG, SG, SF, PF or C.' }
  if (args.action !== 'add' && args.action !== 'remove' && args.action !== 'reset') return { ok: false, error: 'Choose add, remove or reset.' }
  const action: EligibilityAction = args.action
  const reason = typeof args.reason === 'string' ? args.reason.trim().slice(0, 280) : ''
  if (action !== 'reset' && !reason) return { ok: false, error: 'Add a short reason. League members see it.' }

  const current = resolvePlayerEligibility(args.listedRaw, args.history)
  if (action === 'add' && current.effective.includes(position)) {
    return { ok: false, error: `${args.playerName} already plays ${position}.` }
  }
  if (action === 'remove') {
    if (!current.effective.includes(position)) return { ok: false, error: `${args.playerName} does not play ${position}.` }
    if (current.effective.length <= 1) return { ok: false, error: `${args.playerName} needs at least one position.` }
  }
  if (action === 'reset' && !current.added.includes(position) && !current.removed.includes(position)) {
    return { ok: false, error: `There is no change to undo at ${position}.` }
  }
  const change = { playerId: args.playerId, playerName: args.playerName, position, action, reason: reason || null }
  const next = resolvePlayerEligibility(args.listedRaw, [
    ...args.history,
    { ...change, actorUserId: '', createdAt: new Date(8.64e15) },
  ])
  if (next.effective.length === 0) return { ok: false, error: `${args.playerName} needs at least one position.` }
  return { ok: true, change, next }
}

export type BoxScoreGame = { position: string | null | undefined }
export type PositionEvidence = { position: NbaEligibilityPosition; games: number }

/**
 * Games this season by the position the box score listed him at, most first. Rolling Insights
 * lists ONE position per player per game (contracts/rolling-insights/GAPS.md R-NBA-POS), so this is
 * "where the box score put him", not Basketball-Reference's minutes-by-position estimate.
 */
export function boxScorePositionEvidence(games: readonly BoxScoreGame[]): PositionEvidence[] {
  const counts = new Map<NbaEligibilityPosition, number>()
  for (const g of games) {
    for (const p of parseListedNbaPositions(g.position)) counts.set(p, (counts.get(p) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([position, games]) => ({ position, games }))
    .sort((a, b) => (b.games - a.games) || ((ORDER.get(a.position) ?? 9) - (ORDER.get(b.position) ?? 9)))
}

/**
 * A copy of a roster's `playerData` whose `lineup_sections` rows carry the commissioner's effective
 * positions, for VALIDATION ONLY. The server checks what the league's log says, not the position
 * string a client sent — so a stale screen cannot seat a player at a position the commissioner
 * removed. Rows for players without a change are returned untouched.
 */
export function withEffectivePositions(playerData: unknown, effectiveById: ReadonlyMap<string, string>): unknown {
  if (!effectiveById.size || !playerData || typeof playerData !== 'object' || Array.isArray(playerData)) return playerData
  const data = playerData as Record<string, unknown>
  const sections = data.lineup_sections
  if (!sections || typeof sections !== 'object' || Array.isArray(sections)) return playerData
  const rewritten: Record<string, unknown> = {}
  for (const [key, rows] of Object.entries(sections as Record<string, unknown>)) {
    rewritten[key] = Array.isArray(rows)
      ? rows.map((row) => {
          if (!row || typeof row !== 'object') return row
          const id = String((row as Record<string, unknown>).id ?? '')
          const effective = effectiveById.get(id)
          return effective ? { ...(row as Record<string, unknown>), position: effective } : row
        })
      : rows
  }
  return { ...data, lineup_sections: rewritten }
}
