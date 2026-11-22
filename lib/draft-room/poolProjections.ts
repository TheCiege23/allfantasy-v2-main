/**
 * Season projections from a draft pool's entries, keyed for the draft engine (2026-11-14).
 *
 * The draft room has always passed `projectedPoints` to the engine (buildLiveDraftBrainPayload.ts),
 * so replacement value ran there. The Decision OS card and Chimmy assemble their engine input from
 * the ADP snapshot instead and passed none — so replacement value, on by default since 2026-11-14,
 * never reached them. This reads the SAME pool rows with the SAME rule the room uses: the entry's own
 * `projectedPoints`, else `nflDraftProjectionSplits.projectedPoints`.
 *
 * PURE. Key: lower-cased trimmed name + "|" + upper-cased position — the engine-side join in
 * DraftContextAssembler uses `projectionKey` too, so the two cannot drift.
 */

export function projectionKey(name: string, position: string): string {
  return `${String(name ?? '').trim().toLowerCase()}|${String(position ?? '').trim().toUpperCase()}`
}

function finite(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

export function projectionsFromPoolEntries(entries: unknown): Map<string, number> {
  const out = new Map<string, number>()
  if (!Array.isArray(entries)) return out
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') continue
    const e = raw as {
      name?: unknown
      position?: unknown
      projectedPoints?: unknown
      nflDraftProjectionSplits?: { projectedPoints?: unknown } | null
    }
    if (typeof e.name !== 'string' || typeof e.position !== 'string') continue
    const points = finite(e.projectedPoints) ?? finite(e.nflDraftProjectionSplits?.projectedPoints)
    // No line (null — emptyNflDraftProjectionSplits) or a zero is not a forecast the engine can use.
    if (points == null || points <= 0) continue
    out.set(projectionKey(e.name, e.position), points)
  }
  return out
}
