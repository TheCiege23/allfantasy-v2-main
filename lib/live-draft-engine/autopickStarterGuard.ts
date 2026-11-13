/**
 * ONE STARTER GUARD FOR EVERY WAY A PICK IS MADE FOR AN ABSENT MANAGER.
 *
 * 🛑 THE GUARD IN `autopickStarterNeeds.ts` PROTECTED ONLY THE LAST BRANCH. Autopick tries the
 * manager's queue first, then "draft as me", then need-based, and only then best available — and the
 * starter guard ran inside best available alone. The Chimmy / orphan drafter had none. So a team whose
 * remaining picks were exactly its open starting spots could still be handed a fourth wide receiver from
 * its queue, and finish the season with no quarterback, no goalie or no pitcher. In best ball, where the
 * draft is the whole season, that seat is empty every week.
 *
 * The rule is unchanged and deliberately narrow: it bites ONLY once this pick and every later one are
 * needed to fill the team's open starting spots (`mustFillStarter`). Until then the queue, the
 * manager's style and best available are untouched. A league with no readable template is not guarded,
 * exactly as before.
 */
import { getLeagueDraftTemplatePayload } from '@/lib/league/league-draft-template-payload'
import {
  fitsOpenStarterSlot,
  mustFillStarter,
  openStarterSlots,
  starterSlotsFromTemplate,
  type StarterSlotNeed,
} from '@/lib/live-draft-engine/autopickStarterNeeds'

export type StarterGuard = {
  /** True when this pick must fill an open starting spot. */
  mustFill: boolean
  open: StarterSlotNeed[]
  /** Whether a player at `position` may be taken for this pick. Always true when not forced. */
  allows: (position: string | null | undefined) => boolean
}

export const OPEN_GUARD: StarterGuard = { mustFill: false, open: [], allows: () => true }

/** Pure: the guard for a team, from the template's slots, its own picks so far and the draft's rounds. */
export function starterGuardFor(
  templateSlots: Parameters<typeof starterSlotsFromTemplate>[0] | null | undefined,
  ownPositions: readonly string[],
  rounds: number,
): StarterGuard {
  if (!templateSlots || !Number.isFinite(rounds) || rounds <= 0) return OPEN_GUARD
  const open = openStarterSlots(starterSlotsFromTemplate(templateSlots), ownPositions)
  const mustFill = mustFillStarter(open, rounds - ownPositions.length)
  if (!mustFill) return { mustFill: false, open, allows: () => true }
  return { mustFill: true, open, allows: (position) => fitsOpenStarterSlot(String(position ?? ''), open) }
}

/** The guard for one league's on-clock team. Fails open (no guard) when the template cannot be read. */
export async function loadStarterGuard(leagueId: string, ownPositions: readonly string[], rounds: number): Promise<StarterGuard> {
  const template = (await getLeagueDraftTemplatePayload(leagueId).catch(() => null))?.template
  return starterGuardFor(template?.slots, ownPositions, rounds)
}

/**
 * Keep only the candidates the guard allows — unless none would remain, in which case keep them all:
 * a forced pick with no eligible player left must still be a pick, never a stalled draft.
 */
export function guardCandidates<T>(guard: StarterGuard, candidates: readonly T[], positionOf: (c: T) => string | null | undefined): T[] {
  if (!guard.mustFill) return [...candidates]
  const allowed = candidates.filter((c) => guard.allows(positionOf(c)))
  return allowed.length > 0 ? allowed : [...candidates]
}
