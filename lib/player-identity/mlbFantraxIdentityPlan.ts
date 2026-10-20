import type { FantraxPlayerRef } from '@/lib/league-import/fantrax/fantraxApi'
import { planProFantraxIdentityLinks, type ProIdentityRow } from './proFantraxIdentityPlan'

export type MlbIdentityRow = ProIdentityRow

/**
 * Exact normalized name + recognized current team + batting/pitching role; never a name-only guess.
 * The rules now live in `proFantraxIdentityPlan.ts`, shared with NBA and NHL; MLB's are unchanged.
 */
export function planMlbFantraxIdentityLinks(refs: FantraxPlayerRef[], identities: MlbIdentityRow[]) {
  return planProFantraxIdentityLinks('MLB', refs, identities)
}
