/**
 * The "What changed" card for a Devy or C2C commissioner config save (`/devy/config`,
 * `/merged-devy-c2c/config`). Those panels save the rookie draft's order, rounds and type and the taxi
 * squad's size to the variant's own config, which the popup reads (./dynastyRookieRules.ts,
 * `getEffectiveTaxiSettings`), and they published no card — so a rule members read changed silently.
 *
 * Read before the write, compare after: one silent card under the Dynasty section with exactly the
 * rules that moved. Never throws — a card is not worth failing a saved setting over.
 */
import { prisma } from '@/lib/prisma'
import { getEffectiveTaxiSettings } from '@/lib/taxi/TaxiSettingsService'
import { diffRuleSnapshots } from './changeKeys'
import { loadDynastyRookieRules } from './dynastyRookieRules'
import { publishRuleChangesEvent } from './publishRuleChanges'
import { taxiRulesFromEffective } from './snapshot'
import type { RuleSnapshot } from './types'

export async function readVariantConfigRules(leagueId: string): Promise<Partial<RuleSnapshot> | null> {
  try {
    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { leagueVariant: true, settings: true } })
    if (!league) return null
    const [rookie, taxi] = await Promise.all([
      loadDynastyRookieRules(prisma, { leagueId, leagueVariant: league.leagueVariant, settings: league.settings }),
      getEffectiveTaxiSettings(leagueId).catch(() => null),
    ])
    const { rookieDraftLottery: _lottery, ...rookieRules } = rookie
    return { ...rookieRules, ...(taxi ? taxiRulesFromEffective(taxi) : {}) }
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
