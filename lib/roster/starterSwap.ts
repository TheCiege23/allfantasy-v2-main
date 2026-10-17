import { buildPlayerDataFromSections, getNormalizedLineupSections } from './LineupTemplateValidation'

/** Swap using stored player metadata, never a caller's invented position/status. */
export function applyStarterSwap(playerData: unknown, slotIndex: number, candidateId: string): Record<string,unknown> {
  const sections=getNormalizedLineupSections(playerData)
  if (!Number.isInteger(slotIndex) || slotIndex<0 || slotIndex>=sections.starters.length) throw new Error('Starting slot is unavailable. Refresh the lineup.')
  const benchIndex=sections.bench.findIndex(p=>p.id===candidateId)
  if(benchIndex<0) throw new Error('That player is no longer on your bench. Refresh the lineup.')
  const starter=sections.starters[slotIndex]
  sections.starters[slotIndex]=sections.bench[benchIndex]
  sections.bench[benchIndex]=starter
  return buildPlayerDataFromSections(playerData,sections)
}
