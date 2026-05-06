import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import type { ExpandedStarterSlot } from '@/lib/league/lineup-expand-template'
import { normalizePositionForStarterEligibility } from '@/lib/roster/LineupTemplateValidation'

export type RosterLineupLists = {
  starters: string[]
  bench: string[]
  ir: string[]
  taxi: string[]
  devy: string[]
}

function idsFromSection(rows: Array<Record<string, unknown>>): string[] {
  return rows.map((r) => String(r.id ?? '')).filter(Boolean)
}

/** Build ordered starter IDs aligned to expanded slots (pad with empty string for empty slot). */
export function buildLineupListsFromPlayerData(
  playerData: unknown,
  starterSlotCount: number,
): RosterLineupLists {
  const sections = getNormalizedLineupSections(playerData)
  let starters = idsFromSection(sections.starters)
  let bench = idsFromSection(sections.bench)
  if (starters.length === 0 && playerData && typeof playerData === 'object' && !Array.isArray(playerData)) {
    const pd = playerData as Record<string, unknown>
    const raw = pd.starters
    if (Array.isArray(raw)) {
      starters = raw.map((x) => String(typeof x === 'string' ? x : (x as { id?: string }).id ?? '')).filter(Boolean)
    }
  }

  // Final fallback for completed-draft rosters whose `finalizeRosterAssignments`
  // step never produced `lineup_sections.starters` (e.g. roster template was
  // missing, finalize errored mid-flight, or completion happened on a code path
  // that bypassed it). The `appendPickToRosterDraftSnapshot` write path always
  // populates `playerData.draftPicks` during the draft, so we can derive a
  // greedy starter→bench split in pick order. This is a safety net for the
  // league dashboard Roster tab — `runPostDraftFinalizationArtifacts` remains
  // the canonical materialization path; this fallback just stops the dashboard
  // from rendering empty starter slots while the heal happens.
  //
  // Note: we intentionally fire this even when `bench` is already non-empty.
  // The pre-existing `starters.length === 0 && bench.length === 0` guard
  // assumed a non-empty bench meant the sections fallback had succeeded — but
  // a partial finalize can leave players in `bench` while `starters` stays
  // empty, which is exactly the bug class this fallback exists to repair.
  // Overwriting `bench` is safe because it only fires when `starters` is empty
  // (so a real lineup can never be clobbered) and the legacy
  // `playerData.starters` short-circuit above (line 25) still wins when set.
  if (starters.length === 0 && playerData && typeof playerData === 'object' && !Array.isArray(playerData)) {
    const pd = playerData as Record<string, unknown>
    const draftPicks = Array.isArray(pd.draftPicks)
      ? (pd.draftPicks as Array<Record<string, unknown>>)
      : []
    if (draftPicks.length > 0) {
      const ids = draftPicks
        .map((p) => {
          const pid = p.playerId
          if (typeof pid === 'string' && pid.trim()) return pid.trim()
          const name = p.playerName
          if (typeof name === 'string' && name.trim()) return name.trim()
          return ''
        })
        .filter(Boolean)
      const cap = Math.max(0, starterSlotCount)
      starters = ids.slice(0, cap)
      bench = ids.slice(cap)
    }
  }

  while (starters.length < starterSlotCount) starters.push('')
  if (starters.length > starterSlotCount) starters = starters.slice(0, starterSlotCount)

  return {
    starters,
    bench,
    ir: idsFromSection(sections.ir),
    taxi: idsFromSection(sections.taxi),
    devy: idsFromSection(sections.devy),
  }
}

export function playerEligibleForSlot(
  slot: ExpandedStarterSlot,
  playerPosition: string | undefined | null,
): boolean {
  const pos = normalizePositionForStarterEligibility(String(playerPosition ?? ''))
  if (!pos) return false
  const allowed = (slot.allowedPositions ?? []).map((p) =>
    normalizePositionForStarterEligibility(String(p)),
  )
  return allowed.includes(pos)
}

/** Remove id from first matching section list (mutates copies). */
export function removeIdFromLists(lists: RosterLineupLists, id: string): RosterLineupLists {
  const strip = (arr: string[]) => arr.filter((x) => x !== id)
  return {
    starters: lists.starters.map((x) => (x === id ? '' : x)),
    bench: strip(lists.bench),
    ir: strip(lists.ir),
    taxi: strip(lists.taxi),
    devy: strip(lists.devy),
  }
}

export function addIdToBench(lists: RosterLineupLists, id: string): RosterLineupLists {
  if (!id || lists.bench.includes(id)) return lists
  return { ...lists, bench: [...lists.bench, id] }
}

/**
 * Apply swap / move: put `incomingId` into starters[slotIndex], move previous occupant to bench
 * or swap with another starter.
 */
export type RosterSectionKey = 'starters' | 'bench' | 'ir' | 'taxi' | 'devy'

export function findPlayerLocation(
  lists: RosterLineupLists,
  id: string,
): { section: RosterSectionKey; index: number } | null {
  if (!id?.trim()) return null
  const si = lists.starters.indexOf(id)
  if (si >= 0) return { section: 'starters', index: si }
  const bi = lists.bench.indexOf(id)
  if (bi >= 0) return { section: 'bench', index: bi }
  const ii = lists.ir.indexOf(id)
  if (ii >= 0) return { section: 'ir', index: ii }
  const ti = lists.taxi.indexOf(id)
  if (ti >= 0) return { section: 'taxi', index: ti }
  const di = lists.devy.indexOf(id)
  if (di >= 0) return { section: 'devy', index: di }
  return null
}

/**
 * Exchange two players' roster placements (any combination of starters, bench, IR, taxi, devy).
 */
export function swapPlayersInLists(lists: RosterLineupLists, idA: string, idB: string): RosterLineupLists {
  if (!idA?.trim() || !idB?.trim() || idA === idB) return lists
  const locA = findPlayerLocation(lists, idA)
  const locB = findPlayerLocation(lists, idB)
  if (!locA || !locB) return lists
  if (locA.section === locB.section && locA.index === locB.index) return lists

  const next: RosterLineupLists = {
    starters: [...lists.starters],
    bench: [...lists.bench],
    ir: [...lists.ir],
    taxi: [...lists.taxi],
    devy: [...lists.devy],
  }

  const getVal = (loc: { section: RosterSectionKey; index: number }): string => {
    if (loc.section === 'starters') return next.starters[loc.index] ?? ''
    return next[loc.section][loc.index] ?? ''
  }
  const setVal = (loc: { section: RosterSectionKey; index: number }, v: string) => {
    if (loc.section === 'starters') {
      const s = [...next.starters]
      s[loc.index] = v
      next.starters = s
    } else {
      const arr = [...next[loc.section]] as string[]
      arr[loc.index] = v
      next[loc.section] = arr
    }
  }

  const va = getVal(locA)
  const vb = getVal(locB)
  setVal(locA, vb)
  setVal(locB, va)
  return next
}

export function applyLineupPick(args: {
  lists: RosterLineupLists
  slotIndex: number
  incomingId: string
}): RosterLineupLists {
  const { lists, slotIndex, incomingId } = args
  const next: RosterLineupLists = {
    starters: [...lists.starters],
    bench: [...lists.bench],
    ir: [...lists.ir],
    taxi: [...lists.taxi],
    devy: [...lists.devy],
  }

  const prev = next.starters[slotIndex] ?? ''
  const otherIdx = next.starters.indexOf(incomingId)

  if (otherIdx >= 0 && otherIdx !== slotIndex) {
    next.starters[slotIndex] = incomingId
    next.starters[otherIdx] = prev || ''
    return next
  }

  let cleared = removeIdFromLists(next, incomingId)
  cleared.starters[slotIndex] = incomingId
  if (prev && prev !== incomingId) {
    cleared = addIdToBench(cleared, prev)
  }
  return cleared
}
