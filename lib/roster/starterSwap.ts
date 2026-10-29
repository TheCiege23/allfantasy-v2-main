import { buildPlayerDataFromSections, getNormalizedLineupSections } from './LineupTemplateValidation'

/** Swap using stored player metadata, never a caller's invented position/status. */
export function applyStarterSwap(playerData: unknown, slotIndex: number, candidateId: string): Record<string,unknown> {
  const sections=getNormalizedLineupSections(playerData)
  if (!Number.isInteger(slotIndex) || slotIndex<0 || slotIndex>=sections.starters.length) throw new Error('Starting slot is unavailable. Refresh the lineup.')
  const benchIndex=sections.bench.findIndex(p=>p.id===candidateId)
  if(benchIndex<0) throw new Error('That player is no longer on your bench. Refresh the lineup.')
  const starter=sections.starters[slotIndex]
  // The incoming player takes the outgoing starter's lineup slot position (lib/league/lineupSlotPositions.ts);
  // buildPlayerDataFromSections strips it from the benched row.
  const incoming={...sections.bench[benchIndex]}
  if (starter.slotIndex!==undefined) incoming.slotIndex=starter.slotIndex
  else delete incoming.slotIndex
  sections.starters[slotIndex]=incoming
  sections.bench[benchIndex]=starter
  return buildPlayerDataFromSections(playerData,sections)
}
