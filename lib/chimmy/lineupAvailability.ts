import 'server-only'

import { readInjuryStatusById } from '@/lib/core-app/injuryStatusById'
import { isHealthyDesignation, isRuledOut } from '@/lib/core-app/injuryStatus'

export type LineupMetadata = {
  name: string | null
  position: string | null
  team?: string | null
  injury?: string | null
}

/** Weekly lineup availability, including the provider's short inactive spellings. */
export function unavailableForLineup(status: string | null | undefined): boolean {
  return isRuledOut(status) || /^(o|inact|inactive|sus|dnr|cov|covid)$/i.test(status?.trim() ?? '')
}

export function lineupDesignation(status: string | null | undefined): string | null {
  return !status || isHealthyDesignation(status) || /^act$/i.test(status.trim()) ? null : status
}

/** Reuse roster identities; one batched injury read supplies current, club-matched aliases. */
export async function enrichLineupAvailability(
  sport: string,
  metadata: ReadonlyMap<string, LineupMetadata>,
): Promise<Map<string, LineupMetadata>> {
  const names = new Map([...metadata].flatMap(([id, player]) => player.name ? [[id, [player.name]] as const] : []))
  const teams = new Map([...metadata].map(([id, player]) => [id, player.team ?? null]))
  const injury = await readInjuryStatusById(sport, names, teams)
  return new Map([...metadata].map(([id, player]) => [id, {
    ...player, injury: lineupDesignation(injury.has(id) ? injury.get(id) : player.injury),
  }]))
}
