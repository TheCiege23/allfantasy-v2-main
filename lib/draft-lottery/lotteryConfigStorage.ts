/**
 * Read/write draft order mode and weighted lottery config from League.settings.
 */

import { prisma } from '@/lib/prisma'
import type { DraftOrderMode, WeightedLotteryConfig, WeightedLotteryResult } from './types'
import { DEFAULT_WEIGHTED_LOTTERY_CONFIG } from './types'

const KEY_ORDER_MODE = 'draft_order_mode'
const KEY_LOTTERY_CONFIG = 'draft_lottery_config'
const KEY_LOTTERY_LAST_SEED = 'draft_lottery_last_seed'
const KEY_LOTTERY_LAST_RUN_AT = 'draft_lottery_last_run_at'
const KEY_LOTTERY_LAST_RESULT = 'draft_lottery_last_result'

export function getDraftLotteryLastResultFromSettings(
  settings: Record<string, unknown> | null | undefined
): WeightedLotteryResult | null {
  const raw = settings?.[KEY_LOTTERY_LAST_RESULT]
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (!Array.isArray(o.slotOrder)) return null
  return raw as unknown as WeightedLotteryResult
}

export type DraftOrderModeAndLotteryConfig = {
  draftOrderMode: DraftOrderMode
  lotteryConfig: WeightedLotteryConfig
  lotteryLastSeed: string | null
  lotteryLastRunAt: string | null
  lotteryLastResult: WeightedLotteryResult | null
}

export async function getDraftOrderModeAndLotteryConfig(
  leagueId: string
): Promise<DraftOrderModeAndLotteryConfig> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true },
  })
  return readDraftOrderModeAndLotteryConfig(league?.settings)
}

/**
 * The same parse, from a League.settings value the caller already holds, so a screen that has
 * read the league row does not read it again just to learn the draft order mode.
 */
export function readDraftOrderModeAndLotteryConfig(rawSettings: unknown): DraftOrderModeAndLotteryConfig {
  const settings = (rawSettings as Record<string, unknown>) ?? {}
  const mode = (settings[KEY_ORDER_MODE] as DraftOrderMode) ?? 'randomize'
  const raw = settings[KEY_LOTTERY_CONFIG] as Record<string, unknown> | undefined
  const lotteryConfig: WeightedLotteryConfig = raw && typeof raw === 'object'
    ? {
        enabled: Boolean(raw.enabled),
        lotteryTeamCount: Number(raw.lotteryTeamCount) || DEFAULT_WEIGHTED_LOTTERY_CONFIG.lotteryTeamCount,
        lotteryPickCount: Number(raw.lotteryPickCount) || DEFAULT_WEIGHTED_LOTTERY_CONFIG.lotteryPickCount,
        eligibilityMode: (raw.eligibilityMode as WeightedLotteryConfig['eligibilityMode']) ?? 'non_playoff',
        bottomN: raw.bottomN != null ? Number(raw.bottomN) : undefined,
        weightingMode: (raw.weightingMode as WeightedLotteryConfig['weightingMode']) ?? 'inverse_standings',
        fallbackOrder: (raw.fallbackOrder as WeightedLotteryConfig['fallbackOrder']) ?? 'reverse_max_pf',
        tiebreakMode: (raw.tiebreakMode as WeightedLotteryConfig['tiebreakMode']) ?? 'lower_max_pf',
        randomSeed: typeof raw.randomSeed === 'string' ? raw.randomSeed : null,
        auditSeed: typeof raw.auditSeed === 'string' ? raw.auditSeed : null,
        allowCommissionerOverride: raw.allowCommissionerOverride !== false,
      }
    : { ...DEFAULT_WEIGHTED_LOTTERY_CONFIG }

  return {
    draftOrderMode: ['randomize', 'manual', 'weighted_lottery'].includes(mode) ? mode : 'randomize',
    lotteryConfig,
    lotteryLastSeed: typeof settings[KEY_LOTTERY_LAST_SEED] === 'string' ? settings[KEY_LOTTERY_LAST_SEED] : null,
    lotteryLastRunAt: typeof settings[KEY_LOTTERY_LAST_RUN_AT] === 'string' ? settings[KEY_LOTTERY_LAST_RUN_AT] : null,
    lotteryLastResult: getDraftLotteryLastResultFromSettings(settings),
  }
}

export async function setDraftOrderModeAndLotteryConfig(
  leagueId: string,
  patch: {
    draftOrderMode?: DraftOrderMode
    lotteryConfig?: Partial<WeightedLotteryConfig>
    lotteryLastSeed?: string | null
    lotteryLastRunAt?: string | null
    lotteryLastResult?: WeightedLotteryResult | null
  }
): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true },
  })
  const settings = (league?.settings as Record<string, unknown>) ?? {}
  const next = { ...settings }

  if (patch.draftOrderMode !== undefined) next[KEY_ORDER_MODE] = patch.draftOrderMode
  if (patch.lotteryConfig !== undefined) {
    const current = (next[KEY_LOTTERY_CONFIG] as Record<string, unknown>) ?? {}
    next[KEY_LOTTERY_CONFIG] = { ...current, ...patch.lotteryConfig }
  }
  if (patch.lotteryLastSeed !== undefined) next[KEY_LOTTERY_LAST_SEED] = patch.lotteryLastSeed
  if (patch.lotteryLastRunAt !== undefined) next[KEY_LOTTERY_LAST_RUN_AT] = patch.lotteryLastRunAt
  if (patch.lotteryLastResult !== undefined) next[KEY_LOTTERY_LAST_RESULT] = patch.lotteryLastResult

  await prisma.league.update({
    where: { id: leagueId },
    data: { settings: next as any, updatedAt: new Date() },
  })
}
