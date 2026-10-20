/**
 * Apply an NBA/NHL/MLB dynasty format preset to an EXISTING league, before its draft.
 *
 * Writes the same places league creation writes for these values, through the existing writers:
 *   - roster slots (BN / IL-or-IR / TAXI)     → `updateLeagueRosterConfig` (the commissioner roster save)
 *   - taxi slots + taxi eligibility years      → `upsertDynastyConfig` (DynastyLeagueConfig)
 *   - `bench_slots` / `ir_slots` / `taxi_slots` → League.settings, as `createCanonicalLeagueInTransaction`
 *
 * Scoring is NOT rewritten: every preset is points scoring, and switching an existing league's scoring
 * belongs to the Scoring tab's own save path.
 */
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { getRosterEngineRegistry, updateLeagueRosterConfig } from '@/lib/roster-engine'
import { resolveLeagueStage } from '@/lib/league-stage/leagueStage'
import { upsertDynastyConfig } from './DynastySettingsService'
import { findDynastySportPreset, rosterSlotsWithDynastySportPreset } from './DynastySportPresets'

/** Stages before the first pick. `drafting` is deliberately absent: the roster is being filled. */
const BEFORE_DRAFT_STAGES = new Set(['setup', 'pre_draft', 'predraft'])

export function isLeagueBeforeDraft(league: { status?: string | null; lifecycleState?: string | null }): boolean {
  const stage = resolveLeagueStage(league)
  return stage !== null && BEFORE_DRAFT_STAGES.has(stage)
}

export type ApplyDynastySportPresetResult =
  | { ok: true; presetId: string; slots: Record<string, number> }
  | { ok: false; status: number; error: string }

export async function applyDynastySportPresetToLeague(
  leagueId: string,
  presetId: string,
  userId: string,
): Promise<ApplyDynastySportPresetResult> {
  const preset = findDynastySportPreset(presetId)
  if (!preset) return { ok: false, status: 400, error: 'Unknown dynasty format preset.' }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true, status: true, lifecycleState: true, settings: true },
  })
  if (!league) return { ok: false, status: 404, error: 'League not found' }
  if (String(league.sport).toUpperCase() !== preset.sport) {
    return { ok: false, status: 400, error: `That preset is for ${preset.sport} leagues.` }
  }
  if (!isLeagueBeforeDraft(league)) {
    return { ok: false, status: 409, error: 'Dynasty format presets can only be applied before the draft.' }
  }

  const service = getRosterEngineRegistry().getService(preset.sport)
  const current = await service.getConfig(leagueId)
  const slots = rosterSlotsWithDynastySportPreset(current.slots ?? {}, preset)
  const dynastyTemplate = service.resolveDefaultTemplate('dynasty')
  const matchesTemplate = Object.keys({ ...slots, ...dynastyTemplate.slots })
    .every((key) => (slots[key] ?? 0) === (dynastyTemplate.slots[key] ?? 0))
  await updateLeagueRosterConfig(leagueId, { templateKey: matchesTemplate ? dynastyTemplate.key : 'custom', slots }, userId)

  await upsertDynastyConfig(leagueId, {
    taxiSlots: preset.taxiSlotCount,
    taxiEligibilityYears: preset.taxiEligibilityYears,
  })

  // Re-read: updateLeagueRosterConfig rewrote League.settings, and spreading the copy read above
  // would put its old roster block back.
  const fresh = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const settings = ((fresh?.settings ?? league.settings) as Record<string, unknown> | null) ?? {}
  await prisma.league.update({
    where: { id: leagueId },
    data: {
      settings: toPrismaJsonInput({
        ...settings,
        bench_slots: preset.benchCount,
        ir_slots: preset.irCount,
        taxi_slots: preset.taxiSlotCount,
        dynasty_sport_preset_id: preset.id,
      }),
    },
  })

  return { ok: true, presetId: preset.id, slots }
}
