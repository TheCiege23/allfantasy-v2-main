/**
 * lib/draft/syncDraftRoundsToRoster.ts
 *
 * Keeps "rounds = draftable roster spots" true after the ROSTER changes. The draft settings PATCH
 * applies the rule only when the Draft tab is saved, so a commissioner who changed roster positions
 * (e.g. 4 UTIL + 1 SU + 3 BN) and never re-saved the Draft tab kept the old round count in the draft
 * room. The roster-settings routes call this right after saving.
 *
 * Only before the draft starts: an in-progress or finished draft's board is never resized. An AF
 * Commissioner's deliberate override is kept, and "deliberate" means the Draft tab saved it and set
 * `settings.draft_rounds_manual` (see markDraftRoundsManual). Inferring an override from "saved
 * rounds differed from the computed count" was wrong: creation seeds the SPORT default (NBA = 13)
 * while the NBA guillotine template has 11 spots, so every paying commissioner's league looked
 * overridden from birth and the roster change never reached the draft.
 */

import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { getDraftConfigForLeague } from '@/lib/draft-defaults/DraftRoomConfigResolver'
import { updateDraftVariantSettings } from '@/lib/draft-defaults/DraftVariantSettingsHub'
import { getComputedDraftRounds } from '@/lib/draft/computedDraftRounds'

export type DraftRoundsSyncResult =
  | { synced: true; rounds: number; previousRounds: number | null }
  | { synced: false; reason: 'draft_started' | 'no_template' | 'unchanged' | 'manual_override' }

export const DRAFT_ROUNDS_MANUAL_KEY = 'draft_rounds_manual'

/** Called by the Draft tab save: true when the commissioner picked a count other than the roster's. */
export async function markDraftRoundsManual(leagueId: string, manual: boolean): Promise<void> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  if (!league) return
  const settings = (league.settings as Record<string, unknown> | null) ?? {}
  if (Boolean(settings[DRAFT_ROUNDS_MANUAL_KEY]) === manual) return
  await prisma.league.update({
    where: { id: leagueId },
    data: { settings: { ...settings, [DRAFT_ROUNDS_MANUAL_KEY]: manual } as object },
  })
}

export async function syncDraftRoundsToRoster(
  leagueId: string,
  opts: { keepManualOverride: boolean },
): Promise<DraftRoundsSyncResult> {
  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { status: true },
  })
  if (session && session.status !== 'pre_draft') return { synced: false, reason: 'draft_started' }

  const after = await getComputedDraftRounds(leagueId)
  if (!after) return { synced: false, reason: 'no_template' }

  const saved = (await getDraftConfigForLeague(leagueId).catch(() => null))?.rounds ?? null
  if (saved === after.rounds) return { synced: false, reason: 'unchanged' }
  if (opts.keepManualOverride && saved != null) {
    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    const settings = (league?.settings as Record<string, unknown> | null) ?? {}
    if (settings[DRAFT_ROUNDS_MANUAL_KEY] === true) return { synced: false, reason: 'manual_override' }
  }

  await updateDraftVariantSettings(leagueId, { config: { rounds: after.rounds } })
  await prisma.leagueSettings.updateMany({ where: { leagueId }, data: { rounds: after.rounds } })
  return { synced: true, rounds: after.rounds, previousRounds: saved }
}

/**
 * `League.rosterSize` is what the waiver and trade roster-limit checks read
 * (lib/waiver-wire/transaction-eligibility.ts, lib/league-trade-engine/tradeValidationService.ts),
 * and the roster editor writes only the slot template. Keep the column equal to every slot the
 * template holds (starters + bench + IR + taxi/devy) — those checks count every rostered player,
 * IR included — so a roster change reaches waivers and trades as well as the draft.
 */
export async function syncLeagueRosterSizeToTemplate(leagueId: string): Promise<number | null> {
  const computed = await getComputedDraftRounds(leagueId)
  if (!computed) return null
  const total = computed.rosterSpots + computed.irExcluded + computed.taxiDevyExcluded
  if (total <= 0) return null
  await prisma.league.update({ where: { id: leagueId }, data: { rosterSize: total } })
  return total
}

/** Everything that must follow a roster-template save. Never throws: the roster save already landed. */
export async function applyRosterTemplateChange(
  leagueId: string,
  opts: { keepManualOverride: boolean; logTag: string },
): Promise<DraftRoundsSyncResult | null> {
  await syncLeagueRosterSizeToTemplate(leagueId).catch((e) => {
    console.warn(`[${opts.logTag}] roster size sync`, e instanceof Error ? e.message : 'unknown error')
  })
  return syncDraftRoundsToRoster(leagueId, { keepManualOverride: opts.keepManualOverride }).catch((e) => {
    console.warn(`[${opts.logTag}] draft rounds sync`, e instanceof Error ? e.message : 'unknown error')
    return null
  })
}
