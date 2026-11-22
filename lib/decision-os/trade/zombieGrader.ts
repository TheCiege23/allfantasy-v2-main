import 'server-only'

import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import type { TradeGradeView } from './tradeGrade'
import { loadZombiePlayerContext, type GuillotineContextResult } from './guillotineContext'
import { gradeZombiePlayerDeal } from './zombieValue'

export function createZombieGrader(
  args: {
    leagueType: string | null | undefined
    dynastyBase: boolean
    league: { id: string; settings: unknown; leagueSize: number | null; sport: string | null }
  },
  deps?: { loadContext: typeof loadZombiePlayerContext },
): { grade(give: readonly TradeAssetInput[], get: readonly TradeAssetInput[]): Promise<TradeGradeView> } | null {
  if (String(args.leagueType ?? '').toLowerCase() !== 'zombie') return null
  const loadContext = deps?.loadContext ?? loadZombiePlayerContext
  let loaded: Promise<GuillotineContextResult> | null = null
  return {
    async grade(give, get) {
      if (args.dynastyBase) {
        return { graded: false, basis: null, reason: 'This Zombie league also carries players into future seasons. A one-season free-agent comparison would miss dynasty value, so the full deal is not graded.' }
      }
      loaded ??= loadContext(args.league).catch((): GuillotineContextResult => ({ ok: false, reason: 'Zombie player values could not be loaded just now.' }))
      const result = await loaded
      if (!result.ok) return { graded: false, reason: result.reason, basis: null }
      return gradeZombiePlayerDeal({ give, get, ctx: result.ctx })
    },
  }
}
