/**
 * Draft pool rows carry **system/import ADP** (`adp`) and **AllFantasy AI ADP** (`aiAdp`) separately.
 * `PlayerPanel` chooses which number to sort/highlight via `useAiAdp` — it must never overwrite `adp` with AI.
 */

import { ADP_LABEL_AI, ADP_LABEL_SYSTEM } from '@/lib/draft-room/adpReadinessCopy'

export type PlayerPoolAdpColumns = {
  systemAdp: number | null
  aiAdp: number | null
  aiAdpSampleSize: number | null
  labels: { system: typeof ADP_LABEL_SYSTEM; ai: typeof ADP_LABEL_AI }
}

export function resolvePlayerPoolAdpColumns(row: {
  adp?: number | null
  aiAdp?: number | null
  aiAdpSampleSize?: number | null
}): PlayerPoolAdpColumns {
  return {
    systemAdp: row.adp ?? null,
    aiAdp: row.aiAdp ?? null,
    aiAdpSampleSize: row.aiAdpSampleSize ?? null,
    labels: { system: ADP_LABEL_SYSTEM, ai: ADP_LABEL_AI },
  }
}
