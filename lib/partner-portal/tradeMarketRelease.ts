import { HOLDOUT_CACHE_KEY, holdoutRowsOf, learnedMarketHolds } from '@/lib/trade-market/holdoutCheck'

/**
 * IS THE TRADE MARKET PANEL RELEASED ON /partners? (owner's call, 2026-11-22: "release the partner panel if the
 * numbers hold".) The panel is sample data, but it sells a real capability — so it appears only once the daily
 * hold-out check (`lib/trade-market/holdoutCheck.ts`) says the learned numbers predict later trades: at least one
 * learner held and more held than failed. No verdict, a stale one, or an unreadable store = hidden. Never throws.
 *
 * `PARTNER_TRADE_MARKET_PANEL=off` hides it regardless; `=on` shows it regardless (the owner's override).
 */
export const PARTNER_TRADE_MARKET_PANEL_ENV = 'PARTNER_TRADE_MARKET_PANEL'

type CacheReader = { sportsDataCache: { findUnique: (args: { where: { cacheKey: string } }) => PromiseLike<unknown> } }

let memo: { at: number; released: boolean } | null = null
const MEMO_MS = 10 * 60 * 1000

export async function tradeMarketPanelReleased(prisma: CacheReader, env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<boolean> {
  const override = String(env[PARTNER_TRADE_MARKET_PANEL_ENV] ?? '').trim().toLowerCase()
  if (override === 'off') return false
  if (override === 'on') return true
  if (memo && now.getTime() - memo.at < MEMO_MS) return memo.released
  let released = false
  try {
    const row = (await prisma.sportsDataCache.findUnique({ where: { cacheKey: HOLDOUT_CACHE_KEY } })) as { data?: unknown } | null
    released = learnedMarketHolds(holdoutRowsOf(row?.data ?? null, now))
  } catch {
    released = false
  }
  memo = { at: now.getTime(), released }
  return released
}

/** Test hook: forget the memo. */
export function resetTradeMarketReleaseMemo(): void {
  memo = null
}
