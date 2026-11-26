type AdpLikeEntry = {
  name?: string | null
  position?: string | null
  team?: string | null
  adp?: number | null
  aiAdp?: number | null
  display?: { stats?: { projectedPointsPerGame?: number | null } | null } | null
}

function normalizeAdpValue(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value <= 0) return null
  return value
}

function projectedRate(entry: AdpLikeEntry): number | null {
  const value = entry.display?.stats?.projectedPointsPerGame
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

export function resolvePreferredAdp(
  rawAdp: number | null | undefined,
  averagedAdp: number | null | undefined,
): number | null {
  const raw = normalizeAdpValue(rawAdp)
  if (raw != null) return raw
  return normalizeAdpValue(averagedAdp)
}

export function compareDraftEntriesByStableRank(
  a: AdpLikeEntry,
  b: AdpLikeEntry,
  indexA: number,
  indexB: number,
): number {
  const adpA = normalizeAdpValue(a.adp)
  const adpB = normalizeAdpValue(b.adp)
  if (adpA != null && adpB != null && adpA !== adpB) return adpA - adpB
  if (adpA != null && adpB == null) return -1
  if (adpA == null && adpB != null) return 1

  const aiA = normalizeAdpValue(a.aiAdp)
  const aiB = normalizeAdpValue(b.aiAdp)
  if (aiA != null && aiB != null && aiA !== aiB) return aiA - aiB
  if (aiA != null && aiB == null) return -1
  if (aiA == null && aiB != null) return 1

  /*
   * Neither has an ADP of any kind: the higher projected scorer first. Without this a sport with no
   * ADP feed lists, and autopicks, alphabetically — NBA did until its ADP import (fantraxNbaAdp.ts),
   * and college basketball did on 2026-11-25. Only the per-game projection key is read, so NFL, whose
   * boards are ADP-ordered, is unaffected.
   */
  if (adpA == null && adpB == null && aiA == null && aiB == null) {
    const projA = projectedRate(a)
    const projB = projectedRate(b)
    if (projA != null && projB != null && projA !== projB) return projB - projA
    if (projA != null && projB == null) return -1
    if (projA == null && projB != null) return 1
  }

  const nameCmp = String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' })
  if (nameCmp !== 0) return nameCmp

  const posCmp = String(a.position ?? '').localeCompare(String(b.position ?? ''), undefined, {
    sensitivity: 'base',
  })
  if (posCmp !== 0) return posCmp

  const teamCmp = String(a.team ?? '').localeCompare(String(b.team ?? ''), undefined, {
    sensitivity: 'base',
  })
  if (teamCmp !== 0) return teamCmp

  return indexA - indexB
}
