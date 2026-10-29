import 'server-only'

/** The facts `buildAutomationOverview` (./automationOverview.ts) needs, read for one league. */
import { prisma } from '@/lib/prisma'
import { getLeagueRole } from '@/lib/league/permissions'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { isDynastyFamilyLeague } from '@/lib/redraft/offseason/carryDynastyRosters'
import { ownerHasAfCommissionerPlan } from '@/lib/stat-corrections/applyStatCorrections'
import { resolveRookieDraftAutoOpen } from '@/lib/dynasty-core/rookieDraftCalendar'
import { readLiveRookieOrderSettings } from '@/lib/rookie-order/liveRookieOrderService'
import { readTankingPenaltyPolicy } from '@/lib/integrity/tankingPenalties'
import { readHoldFlaggedTradesMode } from '@/lib/integrity/holdFlaggedTradesMode'
import { buildAutomationOverview, type AutomationRow } from './automationOverview'

export type AutomationOverviewView = { supported: true; rows: AutomationRow[]; commissionerPlan: boolean } | { supported: false }

export async function readAutomationOverview(leagueId: string, userId: string): Promise<{ ok: true; view: AutomationOverviewView } | { ok: false; status: 403 | 404 }> {
  const role = await getLeagueRole(leagueId, userId)
  if (role !== 'commissioner' && role !== 'co_commissioner') return { ok: false, status: 403 }
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, platform: true, settings: true, leagueType: true, isDynasty: true } })
  if (!league) return { ok: false, status: 404 }
  // The automations act on leagues AllFantasy runs; an imported league's are its host's.
  if (resolveWriteAuthority(league.platform) !== 'NATIVE') return { ok: true, view: { supported: false } }
  const [commissionerPlan, integrity] = await Promise.all([
    ownerHasAfCommissionerPlan(league.userId),
    prisma.leagueIntegritySettings.findUnique({ where: { leagueId }, select: { tankingMonitorEnabled: true } }).catch(() => null),
  ])
  const rows = buildAutomationOverview({
    leagueId,
    settings: league.settings,
    dynasty: isDynastyFamilyLeague(league),
    commissionerPlan,
    rookieDraftAutoOpen: resolveRookieDraftAutoOpen({ settings: league.settings, commissionerPlan, offseasonStartedAt: new Date() }).autoOpen,
    liveRookieOrderOn: readLiveRookieOrderSettings(league.settings).enabled,
    tankingMonitorOn: Boolean(integrity?.tankingMonitorEnabled),
    tankingPenaltiesOn: readTankingPenaltyPolicy(league.settings).enabled,
    holdFlaggedTradesMode: readHoldFlaggedTradesMode(league.settings),
  })
  return { ok: true, view: { supported: true, rows, commissionerPlan } }
}
