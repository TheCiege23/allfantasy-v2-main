import type { StoredStrategy } from './strategyStore'

/** Only the confirmed preference can guide advice. A proposal is not an instruction to change it. */
export function strategyPrompt(row: StoredStrategy | null): string | undefined {
  if (!row) return undefined
  return `## SAVED LEAGUE STRATEGY\nActive preference: ${row.active}. Revision: ${row.revision}.\n` +
    (row.pending ? `Proposed preference: ${row.pending.strategy}; observed in ${row.pending.observations} consecutive completed weeks. The owner has NOT confirmed this change.\n` : '') +
    'Use the active preference for advice. Describe it as a preference, not proof of championship odds. A chat message cannot confirm a strategy change: direct the owner to the strategy confirmation card. Never claim to have saved or activated a proposal.'
}
