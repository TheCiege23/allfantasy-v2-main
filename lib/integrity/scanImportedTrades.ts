import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkLeagueCommissionerEntitlement } from '@/lib/integrity/leagueEntitlement'
import { scanTradeForCollusion } from '@/lib/integrity/CollusionDetectionEngine'

/** Long enough to outlive any season; the row is a "this trade was scanned" marker, not a lock. */
const SCANNED_MARKER_MS = 400 * 24 * 60 * 60 * 1000

export function importedTradeScanMarkerKey(leagueId: string, providerTradeId: string): string {
  return `integrity-collusion-scan:${leagueId}:sleeper:${providerTradeId}`
}

export type ImportedTradeScanDeps = {
  entitled: (leagueId: string) => Promise<boolean>
  /** True when the stored trade ledger holds this trade as completed for this AF league. */
  onLedger: (leagueId: string, providerTradeId: string) => Promise<boolean>
  claim: (key: string) => Promise<boolean>
  release: (key: string) => Promise<void>
  scan: (leagueId: string, providerTradeId: string) => Promise<unknown>
}

const defaultDeps: ImportedTradeScanDeps = {
  entitled: checkLeagueCommissionerEntitlement,
  onLedger: async (leagueId, providerTradeId) =>
    Boolean(
      await prisma.providerTradeOffer.findFirst({
        where: { leagueId, provider: 'sleeper', providerTradeId, status: 'accepted' },
        select: { id: true },
      }),
    ),
  claim: async (lockKey) => {
    try {
      await prisma.automationLock.create({
        data: { lockKey, owner: 'integrity-collusion-scan', expiresAt: new Date(Date.now() + SCANNED_MARKER_MS) },
      })
      return true
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false
      throw e
    }
  },
  release: async (lockKey) => {
    await prisma.automationLock.delete({ where: { lockKey } }).catch(() => undefined)
  },
  scan: (leagueId, providerTradeId) =>
    scanTradeForCollusion(leagueId, providerTradeId, { kind: 'provider', provider: 'sleeper', providerTradeId }),
}

export type ImportedTradeScanResult = { scanned: number; skipped: number; failed: number }

/**
 * The post-trade collusion scan for IMPORTED Sleeper leagues — the same review, the same flags and the
 * same commissioner alert a league created in AllFantasy gets when a trade settles.
 *
 * Called by the Sleeper trade sweep (lib/trade-intel/tradeNotifyService.ts) with the trades it has just
 * seen complete, after it has written them to the trade ledger the review reads. A Sleeper league
 * imported by three people is three AF leagues; each is scanned only when its OWN owner has AF
 * Commissioner, because the flag and the alert belong to that copy.
 *
 * ⚠ ONCE PER TRADE PER LEAGUE, BY MARKER. A scan can ask the model for a note, and the sweep can
 * report a completion again after a delivery retry. The marker is claimed only once the trade is on the
 * ledger (a scan before that would review nothing and never retry), and released if the scan throws.
 *
 * Never throws: trade alerts must not be lost to an integrity scan.
 */
export async function scanCompletedImportedTrades(
  args: { leagueIds: readonly string[]; providerTradeIds: readonly string[] },
  deps: Partial<ImportedTradeScanDeps> = {},
): Promise<ImportedTradeScanResult> {
  const d = { ...defaultDeps, ...deps }
  const out: ImportedTradeScanResult = { scanned: 0, skipped: 0, failed: 0 }
  if (args.providerTradeIds.length === 0) return out

  for (const leagueId of new Set(args.leagueIds)) {
    const entitled = await d.entitled(leagueId).catch(() => false)
    if (!entitled) {
      out.skipped += args.providerTradeIds.length
      continue
    }
    for (const providerTradeId of new Set(args.providerTradeIds)) {
      const key = importedTradeScanMarkerKey(leagueId, providerTradeId)
      try {
        if (!(await d.onLedger(leagueId, providerTradeId)) || !(await d.claim(key))) {
          out.skipped += 1
          continue
        }
      } catch (error) {
        out.failed += 1
        console.error('[integrity] imported trade scan could not start', { leagueId, providerTradeId, error })
        continue
      }
      try {
        await d.scan(leagueId, providerTradeId)
        out.scanned += 1
      } catch (error) {
        await d.release(key)
        out.failed += 1
        console.error('[integrity] imported trade scan failed', { leagueId, providerTradeId, error })
      }
    }
  }
  return out
}
