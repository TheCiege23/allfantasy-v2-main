import { prisma } from '@/lib/prisma'
import { memberActivityFromReads, type MemberActivityRow } from '@/lib/core-app/commissioner/activity'
import { readMemberActivityInputs } from '@/lib/core-app/commissioner/memberActivityReads'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { MANAGER_INACTIVE_AFTER_DAYS } from '@/lib/decision-os/behavioral/manager-intelligence'
import type { ManagerHighlight } from '@/lib/commissioner-ui/decision-os-client/types'

/**
 * Mission Control's manager highlights, from who is actually playing.
 *
 * 🛑 THE CARD CALLED A RETIRED ROUTE (re-score 2026-11-17, build item 5). `getManagerHighlights` asked
 * `/api/v1/intelligence/league/managers` for retention-risk labels; that route is one of the retired profile paths
 * and answers 410 (`behavioral/api/in-process.ts`), so the card never had data to show. The owner's ruling on
 * managers is facts, not labels, so this reads the SAME member-activity judgement the Commissioner page and the
 * league Overview card show (`memberActivityFromReads`) — the three cannot disagree about who is inactive.
 */

/** At most this many quiet managers, then this many active ones: a highlight list, not the roster. */
const MAX_RISK = 5
const MAX_ACTIVE = 3

/**
 * The callouts, one per status. FIXED STRINGS on purpose: Mission Control translates a callout whole
 * (`calloutText` → `MISSION_CONTROL_ES`), and this read does not know the viewer's language, so a sentence built
 * per manager would reach a Spanish reader in English. Each states what was measured, never a label about the person.
 */
export const INACTIVE_CALLOUT = `No trade, claim or roster move in ${MANAGER_INACTIVE_AFTER_DAYS} days`
export const AT_RISK_CALLOUT = 'Activity has slowed'
export const ACTIVE_CALLOUT = 'Active and engaged'

/**
 * Quiet managers first (inactive, then at risk), then the most recently active. `unknown` rows are left out: there
 * is nothing to say about a manager whose activity could not be judged.
 */
export function managerHighlightsFromActivity(rows: readonly MemberActivityRow[]): ManagerHighlight[] {
  const risk = rows.filter((r) => r.status === 'inactive' || r.status === 'at_risk')
  const active = rows
    .filter((r) => r.status === 'active')
    .sort((a, b) => (b.lastActionAt ?? '').localeCompare(a.lastActionAt ?? ''))
  return [
    ...risk.slice(0, MAX_RISK).map((r) => ({
      id: `risk:${r.name}`,
      managerName: r.name,
      callout: r.status === 'inactive' ? INACTIVE_CALLOUT : AT_RISK_CALLOUT,
      tone: 'risk' as const,
    })),
    ...active.slice(0, MAX_ACTIVE).map((r) => ({ id: `active:${r.name}`, managerName: r.name, callout: ACTIVE_CALLOUT, tone: 'positive' as const })),
  ]
}

/** The highlights for one league, or why there are none. Never throws. */
export async function readManagerHighlights(
  leagueId: string,
  now: Date = new Date(),
): Promise<{ ok: true; highlights: ManagerHighlight[] } | { ok: false; reason: string }> {
  try {
    const [league, teams] = await Promise.all([
      prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true } }),
      prisma.leagueTeam.findMany({
        where: { leagueId },
        select: { teamName: true, ownerName: true, platformUserId: true, claimedByUserId: true, isOrphan: true, externalId: true },
      }),
    ])
    if (!league) return { ok: false, reason: 'This league could not be found.' }
    const reads = await readMemberActivityInputs(leagueId, isNativePlatform(league.platform))
    const activity = memberActivityFromReads(reads, teams, now, MANAGER_INACTIVE_AFTER_DAYS)
    if (!activity.available) return { ok: false, reason: activity.reason }
    return { ok: true, highlights: managerHighlightsFromActivity(activity.data.rows) }
  } catch {
    return { ok: false, reason: 'Manager activity could not be read right now.' }
  }
}
