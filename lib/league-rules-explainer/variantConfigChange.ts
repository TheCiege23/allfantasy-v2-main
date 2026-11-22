/**
 * A Devy or C2C commissioner config save (`/devy/config`, `/merged-devy-c2c/config`) and the rookie
 * draft it sets up.
 *
 * ⚠ THE ROOKIE DRAFT IS BUILT FROM `DynastyLeagueConfig`, NOT FROM THESE PANELS' CONFIG. Next season's
 * rookie draft takes its rounds and its type from the dynasty config (`createNextLeagueDraft`), for Devy
 * and C2C leagues too — and the rules popup reads the same row. These panels saved the rookie draft's
 * rounds and type only to `DevyLeagueConfig` / `C2CLeagueConfig`, which nothing that builds a draft
 * reads, so a commissioner's "3 rounds, snake" was ignored by the draft and absent from the popup. The
 * save now also writes those two fields to the dynasty config (`mirrorRookieDraftToDynasty`).
 *
 * The pick ORDER is not mirrored: these panels' vocabulary (`lottery`, `consolation`, `custom`) has no
 * one-to-one dynasty method, and turning the weighted lottery on or off has its own eligibility check and
 * lottery-config switch in the dynasty settings save. The order stays the dynasty settings' to set.
 *
 * And the save publishes the "What changed" card these panels never did: the rookie draft's rules and
 * the taxi squad's (whose size the popup already reads from these panels' config), read before the write
 * and after, one silent card with exactly what moved. Never throws — a card is not worth failing a save.
 */
import { prisma } from '@/lib/prisma'
import { upsertDynastyConfig } from '@/lib/dynasty-core/DynastySettingsService'
import { getEffectiveTaxiSettings } from '@/lib/taxi/TaxiSettingsService'
import { diffRuleSnapshots } from './changeKeys'
import { publishRuleChangesEvent } from './publishRuleChanges'
import { effectiveDynastyRules, taxiRulesFromEffective } from './snapshot'
import type { RuleSnapshot } from './types'

/** The rookie draft fields a panel save sent that the dynasty config can hold as they are. */
export function rookieDraftMirrorFields(body: Record<string, unknown>): { rookieDraftRounds?: number; rookieDraftType?: string } {
  const out: { rookieDraftRounds?: number; rookieDraftType?: string } = {}
  const rounds = Number(body.rookieDraftRounds)
  if (body.rookieDraftRounds != null && Number.isInteger(rounds) && rounds >= 1 && rounds <= 20) out.rookieDraftRounds = rounds
  if (body.rookieDraftType === 'snake' || body.rookieDraftType === 'linear' || body.rookieDraftType === 'auction') out.rookieDraftType = body.rookieDraftType
  return out
}

/** Write the rookie draft's rounds and type to the dynasty config the draft is built from. */
export async function mirrorRookieDraftToDynasty(leagueId: string, body: Record<string, unknown>): Promise<void> {
  const fields = rookieDraftMirrorFields(body)
  if (Object.keys(fields).length === 0) return
  try {
    await upsertDynastyConfig(leagueId, fields)
  } catch (e) {
    console.warn('[variant config] rookie draft mirror', e instanceof Error ? e.message : 'unknown error')
  }
}

export async function readVariantConfigRules(leagueId: string): Promise<Partial<RuleSnapshot> | null> {
  try {
    const [league, dynasty, taxi] = await Promise.all([
      prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }),
      prisma.dynastyLeagueConfig.findUnique({
        where: { leagueId },
        select: { rookiePickOrderMethod: true, rookieDraftRounds: true, rookieDraftType: true },
      }),
      getEffectiveTaxiSettings(leagueId).catch(() => null),
    ])
    if (!league) return null
    return { ...effectiveDynastyRules(dynasty, league.settings), ...(taxi ? taxiRulesFromEffective(taxi) : {}) }
  } catch (e) {
    console.warn('[variant config] rules read', e instanceof Error ? e.message : 'unknown error')
    return null
  }
}

export async function publishVariantConfigChange(input: {
  leagueId: string
  actorUserId: string
  section: string
  before: Partial<RuleSnapshot> | null
}): Promise<void> {
  if (!input.before) return
  const after = await readVariantConfigRules(input.leagueId)
  if (!after) return
  try {
    await publishRuleChangesEvent({
      leagueId: input.leagueId,
      actorUserId: input.actorUserId,
      section: input.section,
      changes: diffRuleSnapshots(input.before, after),
    })
  } catch (e) {
    console.warn('[variant config] change card', e instanceof Error ? e.message : 'unknown error')
  }
}
