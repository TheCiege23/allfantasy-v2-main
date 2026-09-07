import { lookbackDays } from '@/lib/decision-os/behavioral/api/real-data-provider'
import { MANAGER_INACTIVE_AFTER_DAYS } from '@/lib/decision-os/behavioral/manager-intelligence'
import { readActivityWindow } from '@/lib/league-history/leagueWarehouseReads'
import type { AnalyticsDataWindow } from './decision-os-client/types'

/**
 * The provenance behind Commissioner OS's window-derived KPIs — how fresh the data is, and what
 * the league looks like OUTSIDE the window.
 *
 * ⚠ NO PRISMA HERE, DELIBERATELY. `lib/commissioner-ui/**` is restricted from importing prisma,
 * from raw SQL and from `findUnique` (`.eslintrc.json`, Commissioner OS invariants 1 and 2), with
 * a bounded exemption list of three grandfathered files. The first version of this file ignored
 * all three and became a fourth. The read now lives in `lib/league-history/`, beside the other
 * readers of the same facts warehouse; this file is the mapper that turns it into the shape the
 * view renders.
 *
 * Both thresholds are IMPORTED rather than restated — `lookbackDays()` and
 * `MANAGER_INACTIVE_AFTER_DAYS` each keep a single definition, so a tuned window can never
 * disagree with the sentence describing it.
 */
export async function readAnalyticsDataWindow(leagueId: string): Promise<AnalyticsDataWindow | null> {
  try {
    const window = await readActivityWindow(leagueId)

    /*
     * A league with genuinely zero imported activity is a different thing from one whose activity
     * is merely old, and the caller must be able to tell them apart. Returning null here would
     * collapse both into "window unknown", so the row is returned with a null `lastActivityAt` and
     * honest zero counts instead.
     */
    const lastActivityAt = window.lastActivityAt

    return {
      lookbackDays: lookbackDays(),
      inactiveAfterDays: MANAGER_INACTIVE_AFTER_DAYS,
      lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
      daysSinceLastActivity: lastActivityAt
        ? Math.floor((Date.now() - lastActivityAt.getTime()) / 86_400_000)
        : null,
      allTime: {
        tradeCount: window.tradeCount,
        waiverCount: window.waiverCount,
        eventCount: window.eventCount,
      },
    }
  } catch {
    // Never let provenance break the page it is annotating — a missing window renders exactly as
    // this page did before the window existed.
    return null
  }
}
