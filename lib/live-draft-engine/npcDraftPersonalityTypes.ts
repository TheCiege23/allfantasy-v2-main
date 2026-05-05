/**
 * Commissioner/orphan NPC draft personalities — TypeScript-only (stored in `commissionerAiManagers` JSON).
 */

export const NPC_DRAFT_PERSONALITIES = [
  'BALANCED',
  'NEED_BASED',
  'BEST_PLAYER_AVAILABLE',
  'YOUTH_DYNASTY_UPSIDE',
  'WIN_NOW_VETERAN',
  'STACK_TEAM_CORRELATION',
  'CONTRARIAN_CHAOS',
  'HOMER_TEAM_FAVORITE',
] as const

export type NpcDraftPersonalityId = (typeof NPC_DRAFT_PERSONALITIES)[number]

export function isNpcDraftPersonalityId(value: unknown): value is NpcDraftPersonalityId {
  return typeof value === 'string' && (NPC_DRAFT_PERSONALITIES as readonly string[]).includes(value)
}
