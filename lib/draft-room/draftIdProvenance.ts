/** What the resolved draft ID was actually observed as in the selected stored pool row.
 * A source label is evidence for a later registry check, never a canonical player match. */
export type DraftIdProvenance = {
  namespace: 'sleeper' | 'rolling_insights' | 'unknown'
  sourceRecordId: string | null
}
export function resolveDraftIdProvenance(sport: string, selectedId: string, row: {
  player_id?: string | null; sleeper_id?: string | null; external_source_id?: string | null;
  metadata?: Record<string, unknown> | null
} | null | undefined): DraftIdProvenance {
  const unknown: DraftIdProvenance = { namespace: 'unknown', sourceRecordId: null }
  if (!selectedId || !row?.player_id) return unknown
  if (sport === 'NFL' && row.sleeper_id && selectedId === row.sleeper_id)
    return { namespace: 'sleeper', sourceRecordId: row.player_id }
  if (sport === 'NBA' && row.metadata?.source === 'rolling_insights' &&
      row.external_source_id && selectedId === row.external_source_id && !row.sleeper_id)
    return { namespace: 'rolling_insights', sourceRecordId: row.player_id }
  return unknown
}
