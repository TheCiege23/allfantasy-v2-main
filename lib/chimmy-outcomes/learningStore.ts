import { prisma } from '@/lib/prisma'
import { parseAdviceLearningSnapshot, type AdviceLearningSnapshot } from './learningSnapshot'

/**
 * Where the outcome loop's snapshot is stored, and the one read of it.
 *
 * 🛑 NO `server-only` HERE, ON PURPOSE. `lib/chimmy-personalization/service.ts` reads the snapshot,
 * and client components import that module through the package index — a `server-only` import
 * anywhere below it fails the client build. This file carries exactly the exposure `service.ts`
 * already has (`@/lib/prisma`, which is unmarked for the same reason). The rebuild, which reaches
 * the Receipts module, stays in the server-only `adviceLearning.ts`.
 */

export const ADVICE_LEARNING_CACHE_KEY = 'chimmy:advice-learning:v1'

/** A request path re-reads the row at most this often per instance. */
const READ_MEMO_MS = 5 * 60 * 1000

let memo: { at: number; value: AdviceLearningSnapshot | null } | null = null

/** The stored snapshot, or null. Never throws: every caller treats "unknown" as "no effect". */
export async function readAdviceLearningSnapshot(opts: { fresh?: boolean } = {}): Promise<AdviceLearningSnapshot | null> {
  if (!opts.fresh && memo && Date.now() - memo.at < READ_MEMO_MS) return memo.value
  try {
    const row = await prisma.sportsDataCache.findUnique({
      where: { cacheKey: ADVICE_LEARNING_CACHE_KEY },
      select: { data: true },
    })
    const value = parseAdviceLearningSnapshot(row?.data ?? null)
    memo = { at: Date.now(), value }
    return value
  } catch {
    return null
  }
}

/** Forget the memoised read — after a rebuild, and between tests. */
export function resetAdviceLearningMemo(): void {
  memo = null
}
