/**
 * The registry read behind `yahooSnapshotPlayerIds.ts`: pasted Yahoo players → our player ids, at
 * import time. Postgres only — no provider is called (the page text was pasted by the commissioner).
 *
 * ⚠ SCOPED TO THE LEAGUE'S OWN PLAYERS, the same two reads the Fantrax NFL linker makes
 * (`linkNflFantraxIdentities.ts`): the exact stored `normalizedName`, then — for names it did not
 * find — the loose read that drops punctuation and a trailing "Jr." on the stored side.
 *
 * ⚠ NEVER THROWS. Resolution improves an import; it is not a condition of it. A failed read leaves
 * every player as pasted (`yahoo-paste:`), which is what an import did before this existed.
 */
import { prisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/team-abbrev'
import { looseNflNameKey } from '@/lib/player-identity/nflFantraxIdentityPlan'
import { readRowsByLooseName } from '@/lib/player-identity/linkNflFantraxIdentities'
import type { YahooImportPayload } from '@/lib/league-import/adapters/yahoo/types'
import {
  applyYahooSnapshotPlayerIds,
  collectYahooPastePlayerRefs,
  planYahooSnapshotPlayerIds,
  yahooPasteNameKeys,
  type YahooPasteIdentityRow,
  type YahooSnapshotPlayerIdCoverage,
} from './yahooSnapshotPlayerIds'

export async function resolveYahooSnapshotPlayerIds(
  payload: YahooImportPayload,
): Promise<{ payload: YahooImportPayload; coverage: YahooSnapshotPlayerIdCoverage | null }> {
  try {
    const refs = collectYahooPastePlayerRefs(payload)
    if (refs.length === 0) return { payload, coverage: null }
    const { exact } = yahooPasteNameKeys(refs)
    const rows: YahooPasteIdentityRow[] = exact.length
      ? await prisma.playerIdentityMap.findMany({
          where: { sport: 'NFL', normalizedName: { in: exact } },
          select: { canonicalName: true, currentTeam: true, position: true, sleeperId: true },
        })
      : []
    const found = new Set(rows.map((r) => looseNflNameKey(normalizePlayerName(r.canonicalName ?? ''))))
    const looseMissing = [
      ...new Set(exact.map((k) => looseNflNameKey(k)).filter((k) => k && !found.has(k))),
    ]
    const looseRows = looseMissing.length ? await readRowsByLooseName(looseMissing) : []
    const { ids, coverage } = planYahooSnapshotPlayerIds(refs, [...rows, ...looseRows])
    console.info(
      '[YahooSnapshot] player ids: %d pasted, %d resolved, %d defences, %d unmatched, %d ambiguous',
      coverage.provided,
      coverage.resolved,
      coverage.defenses,
      coverage.unmatched,
      coverage.ambiguous,
    )
    return { payload: applyYahooSnapshotPlayerIds(payload, ids), coverage }
  } catch (error) {
    console.warn('[YahooSnapshot] player id resolution skipped:', error instanceof Error ? error.message : 'unknown error')
    return { payload, coverage: null }
  }
}
