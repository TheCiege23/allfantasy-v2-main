import 'server-only'

/**
 * Reads what `offseasonCalendar` (./offseasonCalendar.ts) needs for one dynasty league, from the same
 * sources the rookie-draft job (lib/redraft/offseason/openRookieDraftsOnCalendar.ts) acts on. Null when
 * the league is not in its offseason — no next season being set up — or is not a dynasty league played
 * on AllFantasy. Any member (or the commissioner) may read it.
 */
import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { isElevatedCommissioner } from '@/server/services/permissionService'
import { isDynastyFamilyLeague } from '@/lib/redraft/offseason/carryDynastyRosters'
import { rookieDraftState } from '@/lib/redraft/offseason/startDynastyNewSeason'
import { ROOKIE_DRAFT_AUTO_OPENED_METADATA_KEY } from '@/lib/redraft/offseason/openRookieDraftsOnCalendar'
import { commissionerHasRookieDraftAutoOpenPlan } from './rookieDraftAutoOpenPlan'
import { readExplicitAutoOpen, readRookieDraftCalendarSettings, resolveRookieDraftAutoOpen, resolveRookieDraftWindow } from './rookieDraftCalendar'
import { readLiveRookieOrderSettings } from '@/lib/rookie-order/liveRookieOrderService'
import { loadTaxiEnforcement } from '@/lib/taxi/taxiRulesService'
import { offseasonCalendar, type OffseasonStep } from './offseasonCalendar'

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const date = (v: unknown): Date | null => {
  if (typeof v !== 'string' && !(v instanceof Date)) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export type OffseasonCalendarView = { season: number; steps: OffseasonStep[] }

export async function readOffseasonCalendar(leagueId: string, userId: string, now = new Date()): Promise<{ ok: true; view: OffseasonCalendarView | null } | { ok: false; status: 403 | 404 }> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, userId: true, platform: true, settings: true, leagueType: true, isDynasty: true, lifecycleMetadata: true },
  })
  if (!league) return { ok: false, status: 404 }
  const [member, commissioner] = await Promise.all([
    prisma.roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } }),
    isElevatedCommissioner(leagueId, userId),
  ])
  if (!member && !commissioner) return { ok: false, status: 403 }
  if (resolveWriteAuthority(league.platform) !== 'NATIVE' || !isDynastyFamilyLeague(league)) return { ok: true, view: null }

  const next = await prisma.redraftSeason.findFirst({
    where: { leagueId, status: 'setup' },
    orderBy: { season: 'desc' },
    select: { id: true, season: true, status: true, createdAt: true, currentWeek: true, sport: true },
  })
  if (!next) return { ok: true, view: null }

  const explicit = readExplicitAutoOpen(league.settings)
  const autoOpen = resolveRookieDraftAutoOpen({
    settings: league.settings,
    commissionerPlan: explicit === null ? await commissionerHasRookieDraftAutoOpenPlan(league.userId) : false,
    offseasonStartedAt: next.createdAt,
  })
  const marker = asRecord(asRecord(league.lifecycleMetadata)[ROOKIE_DRAFT_AUTO_OPENED_METADATA_KEY])
  const autoOpened = marker.seasonId === next.id && date(marker.openedAt) ? { openedAt: date(marker.openedAt)!, startsAt: date(marker.startsAt) } : null
  const [draft, leagueSettings, taxi] = await Promise.all([
    rookieDraftState(leagueId, next),
    prisma.leagueSettings.findUnique({ where: { leagueId }, select: { draftDateUtc: true } }).catch(() => null),
    loadTaxiEnforcement(leagueId).catch(() => null),
  ])
  const steps = offseasonCalendar({
    season: next.season,
    offseasonStartedAt: next.createdAt,
    window: resolveRookieDraftWindow({ sport: next.sport, season: next.season, settings: league.settings, offseasonStartedAt: next.createdAt }),
    autoOpen,
    autoStartDays: readRookieDraftCalendarSettings(league.settings).autoStartDays,
    draft,
    autoOpened,
    // A draft date set before this offseason belongs to last year's draft.
    draftDate: leagueSettings?.draftDateUtc && leagueSettings.draftDateUtc >= next.createdAt ? leagueSettings.draftDateUtc : null,
    liveOrderOn: readLiveRookieOrderSettings(league.settings).enabled,
    taxi: taxi ? { promotionDeadlineWeek: taxi.rules.promotionDeadlineWeek, lockAfterWeek: taxi.rules.lockAfterWeek } : null,
    now,
  })
  return { ok: true, view: { season: next.season, steps } }
}
