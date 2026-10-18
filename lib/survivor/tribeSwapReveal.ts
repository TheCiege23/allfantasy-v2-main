/**
 * TRIBE SWAP + MERGE NAMING — pure rules (no DB).
 *
 * Swap: the new tribes are drawn on the server, stored, and SEALED until the reveal (the next
 * lineup lock, or earlier if the commissioner reveals). Before the reveal a client sees only the
 * current tribes — never the draw. At the reveal each manager shows "From {old tribe}" (moved) or
 * "Stays in {tribe}". Idols are bound to the manager (roster/user), not the tribe, so they travel;
 * Exile tokens are untouched.
 *
 * Merge naming: three suggestions from the tribe catalogue names no tribe in this league has used,
 * picked deterministically per league. The commissioner picks, or the remaining managers vote.
 */

import { createHash } from 'node:crypto'

export interface TribeSnapshot {
  tribeId: string
  rosterIds: string[]
}

/** Deal the shuffled managers round-robin into the same tribes, so sizes stay within one. */
export function drawSwapAssignment(before: ReadonlyArray<TribeSnapshot>, randomIndex: (exclusiveMax: number) => number): TribeSnapshot[] {
  const all = before.flatMap((t) => t.rosterIds)
  for (let i = all.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1)
    ;[all[i], all[j]] = [all[j]!, all[i]!]
  }
  return before.map((tribe, slot) => ({ tribeId: tribe.tribeId, rosterIds: all.filter((_, index) => index % before.length === slot) }))
}

export function readTribeSnapshot(value: unknown): TribeSnapshot[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const r = row as Record<string, unknown>
    if (typeof r.tribeId !== 'string' || !Array.isArray(r.rosterIds)) return []
    return [{ tribeId: r.tribeId, rosterIds: r.rosterIds.filter((id): id is string => typeof id === 'string') }]
  })
}

export type SwapMemberStatus = { rosterId: string; tribeId: string; fromTribeId: string | null; moved: boolean }

export function swapMemberStatuses(before: ReadonlyArray<TribeSnapshot>, after: ReadonlyArray<TribeSnapshot>): SwapMemberStatus[] {
  const oldTribe = new Map<string, string>()
  for (const tribe of before) for (const id of tribe.rosterIds) oldTribe.set(id, tribe.tribeId)
  return after.flatMap((tribe) => tribe.rosterIds.map((rosterId) => {
    const from = oldTribe.get(rosterId) ?? null
    return { rosterId, tribeId: tribe.tribeId, fromTribeId: from, moved: from !== tribe.tribeId }
  }))
}

export function isSwapSealed(swap: { revealAt: Date | null; revealedAt: Date | null } | null | undefined): boolean {
  return Boolean(swap && swap.revealAt && !swap.revealedAt)
}

export function isSwapDue(swap: { revealAt: Date | null; revealedAt: Date | null }, now: Date): boolean {
  return isSwapSealed(swap) && swap.revealAt!.getTime() <= now.getTime()
}

/**
 * What a client may see about a swap. Sealed: only that a swap is coming and when. Revealed (or
 * legacy, already applied): before, after and each manager's From/Stays status.
 */
export function swapViewForClient(swap: { week: number; revealAt: Date | null; revealedAt: Date | null; beforeSnapshot: unknown; afterSnapshot: unknown } | null) {
  if (!swap) return null
  const before = readTribeSnapshot(swap.beforeSnapshot)
  if (isSwapSealed(swap)) {
    return { week: swap.week, sealed: true as const, revealAt: swap.revealAt!.toISOString(), before, after: null, members: null, movedCount: null }
  }
  const after = readTribeSnapshot(swap.afterSnapshot)
  const members = swapMemberStatuses(before, after)
  return { week: swap.week, sealed: false as const, revealAt: swap.revealAt?.toISOString() ?? null, before, after, members, movedCount: members.filter((m) => m.moved).length }
}

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve']

export function swapHeadline(movedCount: number): string {
  const word = NUMBER_WORDS[movedCount] ?? String(movedCount)
  return `${word} manager${movedCount === 1 ? '' : 's'} changed tribes`
}

/** Three catalogue names unused by this league, ordered deterministically per league. */
export function mergeNameSuggestions(leagueId: string, catalogNames: ReadonlyArray<string>, usedNames: ReadonlyArray<string>, count = 3): string[] {
  const used = new Set(usedNames.map((n) => n.trim().toLowerCase()))
  return catalogNames
    .filter((name) => !used.has(name.trim().toLowerCase()))
    .map((name) => ({ name, key: createHash('sha256').update(`${leagueId}:merge:${name}`).digest('hex') }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(0, count)
    .map((row) => row.name)
}

/** Plurality of manager votes; ties go to the earlier suggestion. Null when nobody voted. */
export function tallyMergeNameVotes(suggestions: ReadonlyArray<string>, votes: ReadonlyArray<string>): string | null {
  const counts = new Map<string, number>()
  for (const v of votes) if (suggestions.includes(v)) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: string | null = null
  for (const name of suggestions) if ((counts.get(name) ?? 0) > (best ? counts.get(best) ?? 0 : 0)) best = name
  return best
}

export const PROVISIONAL_MERGED_TRIBE_NAME = 'The merged tribe'
