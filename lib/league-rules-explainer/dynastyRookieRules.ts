/**
 * A dynasty league's rookie-draft rules as members read them: order, rounds, type, and the lottery that
 * orders it when one does.
 *
 * ⚠ A DEVY OR C2C LEAGUE KEEPS THEM IN ITS OWN CONFIG. Their commissioner panels save the rookie draft's
 * rounds, type and order to `DevyLeagueConfig` / `C2CLeagueConfig`, and the Devy draft orchestration
 * reads them from there (`lib/devy/draft/DevyDraftOrchestration.ts getPhaseConfig`). The popup used to
 * read `DynastyLeagueConfig` for every dynasty league, falling back to its defaults (max PF / 4 / linear)
 * when that row was missing — which it usually is for Devy and C2C. So their popup described a rookie
 * draft nobody had set up. Now the variant's own row wins, field by field, over the dynasty config.
 *
 * The weighted lottery is the exception: the lottery engine reads it from `DynastyLeagueConfig`
 * (`resolveWeightedLotterySlotOrderForLeague`), so it still wins there. The live and automatic orders on
 * top come from `effectiveDynastyRules`.
 */
import type { PrismaClient } from '@prisma/client'
import { readDraftOrderModeAndLotteryConfig } from '@/lib/draft-lottery/lotteryConfigStorage'
import { effectiveDynastyRules, rookieDraftLotteryRule } from './snapshot'
import type { RuleSnapshot } from './types'

type RookieConfig = { rookiePickOrderMethod?: string | null; rookieDraftRounds?: number | null; rookieDraftType?: string | null }

const DEVY_VARIANTS = new Set(['devy', 'devy_dynasty'])
const C2C_VARIANTS = new Set(['c2c', 'merged_devy_c2c'])

/** A Devy / C2C config's order method in the popup's vocabulary; an unknown one reads as no line. */
function variantOrder(method: string | null | undefined): string | null | undefined {
  if (method == null) return undefined
  if (method === 'custom') return 'commissioner'
  if (method === 'lottery') return 'weighted_lottery'
  return method
}

/** PURE: the rookie config the league actually uses, the variant's row over the dynasty config's. */
export function rookieConfigFor(dynasty: RookieConfig | null, variant: RookieConfig | null): RookieConfig | null {
  if (!variant) return dynasty
  if (dynasty?.rookiePickOrderMethod === 'weighted_lottery') {
    return { ...variant, rookiePickOrderMethod: 'weighted_lottery', rookieDraftRounds: variant.rookieDraftRounds ?? dynasty.rookieDraftRounds }
  }
  return {
    rookiePickOrderMethod: variantOrder(variant.rookiePickOrderMethod) ?? dynasty?.rookiePickOrderMethod ?? null,
    rookieDraftRounds: variant.rookieDraftRounds ?? dynasty?.rookieDraftRounds ?? null,
    rookieDraftType: variant.rookieDraftType ?? dynasty?.rookieDraftType ?? null,
  }
}

export type DynastyRookieRules = Pick<RuleSnapshot, 'rookieDraftOrder' | 'rookieDraftRounds' | 'rookieDraftType' | 'rookieDraftLottery'>

const SELECT = { rookiePickOrderMethod: true, rookieDraftRounds: true, rookieDraftType: true } as const

export async function loadDynastyRookieRules(
  db: Pick<PrismaClient, 'dynastyLeagueConfig' | 'devyLeagueConfig' | 'c2CLeagueConfig'>,
  input: { leagueId: string; leagueVariant: string | null | undefined; settings: unknown },
): Promise<DynastyRookieRules> {
  const variant = String(input.leagueVariant ?? '').toLowerCase()
  const where = { leagueId: input.leagueId }
  const [dynasty, variantRow] = await Promise.all([
    db.dynastyLeagueConfig.findUnique({ where, select: SELECT }),
    DEVY_VARIANTS.has(variant)
      ? db.devyLeagueConfig.findUnique({ where, select: SELECT })
      : C2C_VARIANTS.has(variant)
        ? db.c2CLeagueConfig.findUnique({ where, select: SELECT })
        : Promise.resolve(null),
  ])
  const rules = effectiveDynastyRules(rookieConfigFor(dynasty, variantRow), input.settings)
  return {
    ...rules,
    rookieDraftLottery: rookieDraftLotteryRule(rules.rookieDraftOrder, readDraftOrderModeAndLotteryConfig(input.settings).lotteryConfig),
  }
}
