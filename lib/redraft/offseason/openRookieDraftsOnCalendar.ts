/**
 * Open a dynasty league's rookie draft when its sport's rookie-draft window opens.
 *
 * 🛑 NOTHING SCHEDULED A ROOKIE DRAFT. The only way to get one was a commissioner clicking "Create
 * next draft" (`createNextLeagueDraft`); a league whose commissioner did not went straight from its
 * champion to kickoff (`activateDynastyNewSeasonsAtKickoff`) with no rookies drafted at all.
 *
 * Runs from the hourly week roller (no cron entry of its own — `cron-schedule.json` is at its
 * ceiling). For each native dynasty-family league whose next season is still a `setup` shell:
 *
 *   - auto-open is on (`resolveRookieDraftAutoOpen`): the commissioner's own switch, else ON when the
 *     commissioner holds AF Commissioner and OFF otherwise. A Commissioner-plan league whose offseason
 *     was already under way when that default shipped stays off, and its commissioner is told once;
 *   - the window is open — the commissioner's custom date for this offseason, else the sport's;
 *   - the sport's week 1 has not begun (an open draft holds kickoff, so opening one after it would
 *     strand a season that is already being played);
 *   - no draft exists for that season yet — one the commissioner created (open OR already run)
 *     is left alone;
 *   - this league was not auto-opened for that season before. The marker is what keeps a draft the
 *     commissioner deleted from being re-created on the next tick.
 *
 * Then `createNextLeagueDraft` creates it exactly as the button does — rosters carried, order set
 * (stored/auto-run lottery, live order, worst-to-first), league in `pre_draft` — and members are told
 * through the same league announcement that names the champion.
 *
 * Picking starts by itself only when the commissioner chose "start it N days after it opens"
 * (`autoStartDays`, phase 6 2026-10-29): the draft's date is set to that evening and Autostart is
 * switched on, so the minute draft tick (`startScheduledDynastyDrafts`) starts it then, and the
 * announcement names the time. Otherwise the commissioner still starts the draft.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { seasonSetupBlocked } from '@/lib/tournament/seasonNativeContract'
import { createNextLeagueDraft } from '@/lib/live-draft-engine/createNextLeagueDraft'
import { publishLeagueFanoutEvent } from '@/lib/league-events/publisher'
import {
  describeRookieDraftStart,
  readExplicitAutoOpen,
  readRookieDraftCalendarSettings,
  resolveRookieDraftAutoOpen,
  resolveRookieDraftWindow,
  rookieDraftAutoStartAt,
} from '@/lib/dynasty-core/rookieDraftCalendar'
import { commissionerHasRookieDraftAutoOpenPlan } from '@/lib/dynasty-core/rookieDraftAutoOpenPlan'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { isDynastyFamilyLeague } from './carryDynastyRosters'
import { rookieDraftState } from './startDynastyNewSeason'

/** `League.lifecycleMetadata` key recording which season's rookie draft was opened automatically. */
export const ROOKIE_DRAFT_AUTO_OPENED_METADATA_KEY = 'rookieDraftAutoOpened'

/** `League.lifecycleMetadata` key recording which season's "turn auto-open on?" notice was sent. */
export const ROOKIE_DRAFT_AUTO_OPEN_NOTICE_METADATA_KEY = 'rookieDraftAutoOpenNotice'

export type RookieDraftOpenOutcome = {
  seasonId: string
  leagueId: string
  action: 'opened' | 'held'
  detail: string
  sessionId?: string
}

function metaObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function wasAutoOpenedFor(lifecycleMetadata: unknown, seasonId: string): boolean {
  const marker = metaObject(metaObject(lifecycleMetadata)[ROOKIE_DRAFT_AUTO_OPENED_METADATA_KEY])
  return marker.seasonId === seasonId
}

export function wasAutoOpenNoticeSentFor(lifecycleMetadata: unknown, seasonId: string): boolean {
  const marker = metaObject(metaObject(lifecycleMetadata)[ROOKIE_DRAFT_AUTO_OPEN_NOTICE_METADATA_KEY])
  return marker.seasonId === seasonId
}

/**
 * A Commissioner-plan league whose offseason predates the plan default: tell the commissioner once,
 * privately, that the draft will not open by itself unless they switch it on. Best-effort.
 */
async function noticeAutoOpenAvailable(
  c: { id: string; season: number; leagueId: string; sport: string; league: { userId: string | null; name: string | null; lifecycleMetadata: unknown } },
  now: Date,
): Promise<void> {
  if (!c.league.userId || wasAutoOpenNoticeSentFor(c.league.lifecycleMetadata, c.id)) return
  const leagueName = c.league.name?.trim() || 'your league'
  await dispatchNotification({
    userIds: [c.league.userId],
    category: 'commissioner_alerts',
    type: 'rookie_draft_auto_open_available',
    title: `${leagueName}: open the ${c.season} rookie draft automatically?`,
    body:
      `AF Commissioner can create your ${c.season} rookie draft when the ${c.sport.toUpperCase()} window opens, with the order set from your league's rule. ` +
      'This offseason started before that was switched on, so it stays off until you turn it on in Dynasty settings. You can also create the draft yourself.',
    actionHref: `/league/${c.leagueId}?tab=Settings&settingsTab=${encodeURIComponent('Dynasty Settings')}`,
    actionLabel: 'Open Dynasty settings',
    leagueId: c.leagueId,
    meta: { seasonId: c.id, season: c.season },
    severity: 'low',
    dedupePrefix: `rookie_draft_auto_open_available:${c.id}`,
  })
  const fresh = await prisma.league.findUnique({ where: { id: c.leagueId }, select: { lifecycleMetadata: true } })
  await prisma.league.update({
    where: { id: c.leagueId },
    data: {
      lifecycleMetadata: {
        ...metaObject(fresh?.lifecycleMetadata),
        [ROOKIE_DRAFT_AUTO_OPEN_NOTICE_METADATA_KEY]: { seasonId: c.id, season: c.season, sentAt: now.toISOString() },
      } as Prisma.InputJsonValue,
    },
  })
}

/** A completed season before this one — without it there is no rookie draft to hold yet. */
async function hasPriorSeason(c: { id: string; leagueId: string; createdAt: Date }): Promise<boolean> {
  const prior = await prisma.redraftSeason.findFirst({
    where: { leagueId: c.leagueId, status: 'complete', NOT: { id: c.id }, createdAt: { lt: c.createdAt } },
    select: { id: true },
  })
  return prior != null
}

async function planUnlessExplicit(settings: unknown, ask: () => Promise<boolean>): Promise<boolean> {
  return readExplicitAutoOpen(settings) === null ? ask() : false
}

export async function openDynastyRookieDraftsOnCalendar(options: {
  now: Date
  limit: number
  actorUserId: string
  resolveWeek: (seasonId: string) => Promise<{ ok: boolean; phase?: string; reason?: string }>
  nativePlatforms: readonly string[]
  /** Does this commissioner hold AF Commissioner? Injected for tests. */
  commissionerHasPlan?: (userId: string | null) => Promise<boolean>
}): Promise<RookieDraftOpenOutcome[]> {
  const commissionerHasPlan = options.commissionerHasPlan ?? commissionerHasRookieDraftAutoOpenPlan
  const candidates = await prisma.redraftSeason.findMany({
    where: {
      status: 'setup',
      league: {
        platform: { in: [...options.nativePlatforms] },
        OR: [
          { isDynasty: true },
          ...['dynasty', 'devy', 'c2c'].map((t) => ({ leagueType: { equals: t, mode: 'insensitive' as const } })),
        ],
      },
    },
    select: {
      id: true,
      season: true,
      status: true,
      createdAt: true,
      currentWeek: true,
      leagueId: true,
      sport: true,
      league: { select: { settings: true, leagueType: true, isDynasty: true, lifecycleMetadata: true, userId: true, name: true } },
    },
    take: options.limit,
  })

  const outcomes: RookieDraftOpenOutcome[] = []
  for (const c of candidates) {
    const held = (detail: string) => outcomes.push({ seasonId: c.id, leagueId: c.leagueId, action: 'held', detail })
    try {
      if (!c.league || !isDynastyFamilyLeague(c.league) || seasonSetupBlocked(c.league.settings)) {
        held('not_dynasty')
        continue
      }
      const autoOpen = resolveRookieDraftAutoOpen({
        settings: c.league.settings,
        // Asked only when the commissioner has not set the switch themselves.
        commissionerPlan: await planUnlessExplicit(c.league.settings, () => commissionerHasPlan(c.league.userId)),
        offseasonStartedAt: c.createdAt,
      })
      if (autoOpen.source === 'plan_default_predates') {
        // Told only when there is a rookie draft to open: not a league's first season, and not one
        // whose commissioner already created it.
        if (!wasAutoOpenNoticeSentFor(c.league.lifecycleMetadata, c.id) && (await hasPriorSeason(c)) && (await rookieDraftState(c.leagueId, c)) === 'none') {
          await noticeAutoOpenAvailable({ ...c, league: c.league }, options.now).catch((error) => {
            console.warn('[rookie-draft-calendar] auto-open notice failed', { leagueId: c.leagueId, error: String(error) })
          })
        }
        held('AUTO_OPEN_OFF_PREDATES_PLAN_DEFAULT')
        continue
      }
      if (!autoOpen.autoOpen) {
        held('AUTO_OPEN_OFF')
        continue
      }
      if (wasAutoOpenedFor(c.league.lifecycleMetadata, c.id)) {
        held('ALREADY_AUTO_OPENED')
        continue
      }
      const window = resolveRookieDraftWindow({
        sport: c.sport,
        season: c.season,
        settings: c.league.settings,
        offseasonStartedAt: c.createdAt,
      })
      if (!window) {
        held('NO_SPORT_CALENDAR')
        continue
      }
      if (options.now.getTime() < window.opensAt.getTime()) {
        held(`WINDOW_NOT_OPEN:${window.opensAt.toISOString()}`)
        continue
      }
      if (!(await hasPriorSeason(c))) {
        held('first_season')
        continue
      }
      const draft = await rookieDraftState(c.leagueId, c)
      if (draft !== 'none') {
        held(draft === 'open' ? 'DRAFT_ALREADY_OPEN' : 'ROOKIE_DRAFT_DONE')
        continue
      }
      const week = await options.resolveWeek(c.id)
      if (!week.ok) {
        held(`WEEK_UNRESOLVED:${week.reason ?? 'unknown'}`)
        continue
      }
      if (week.phase !== 'preseason') {
        held('SEASON_KICKED_OFF')
        continue
      }

      const created = await createNextLeagueDraft(c.leagueId, options.actorUserId)
      if (!created.ok) {
        held(created.code)
        continue
      }

      // The commissioner's "start it N days after it opens": the date and Autostart the draft tick reads.
      const autoStartDays = readRookieDraftCalendarSettings(c.league.settings).autoStartDays
      const startsAt = autoStartDays ? rookieDraftAutoStartAt(options.now, autoStartDays) : null
      if (startsAt) {
        await prisma.leagueSettings.upsert({
          where: { leagueId: c.leagueId },
          create: { leagueId: c.leagueId, draftDateUtc: startsAt, autostart: true },
          update: { draftDateUtc: startsAt, autostart: true },
        })
      }

      // Re-read: `createNextLeagueDraft` has just written the lifecycle metadata.
      const fresh = await prisma.league.findUnique({ where: { id: c.leagueId }, select: { lifecycleMetadata: true } })
      await prisma.league.update({
        where: { id: c.leagueId },
        data: {
          lifecycleMetadata: {
            ...metaObject(fresh?.lifecycleMetadata),
            [ROOKIE_DRAFT_AUTO_OPENED_METADATA_KEY]: {
              seasonId: c.id,
              season: c.season,
              sessionId: created.sessionId,
              openedAt: options.now.toISOString(),
              windowSource: window.source,
              orderSource: created.orderSource,
              ...(startsAt ? { startsAt: startsAt.toISOString() } : {}),
            },
          } as Prisma.InputJsonValue,
        },
      })

      await publishLeagueFanoutEvent({
        leagueId: c.leagueId,
        eventType: 'rookie_draft_opened',
        title: `The ${created.season} rookie draft is open`,
        message: `${
          created.orderSource === 'lottery'
            ? `The ${created.season} rookie draft has been created and its order set by the weighted lottery.`
            : `The ${created.season} rookie draft has been created.`
        } ${
          startsAt
            ? `It starts by itself on ${describeRookieDraftStart(startsAt)} — set your queue before then, or Auto-pick picks for you when your clock runs out.`
            : 'Your commissioner will start it — check the draft room for the order and settings.'
        }`,
        category: 'league_announcements',
        visibility: 'all_members',
        actorUserId: options.actorUserId,
        meta: {
          seasonId: created.seasonId,
          draftSessionId: created.sessionId,
          orderSource: created.orderSource,
          ...(startsAt ? { startsAt: startsAt.toISOString() } : {}),
        },
        dedupeKey: `rookie-draft-open:${c.id}`,
        actionHref: `/league/${c.leagueId}/draft`,
        actionLabel: 'Open draft room',
      }).catch((error) => {
        console.warn('[rookie-draft-calendar] announcement failed', { leagueId: c.leagueId, error: String(error) })
      })

      outcomes.push({ seasonId: c.id, leagueId: c.leagueId, action: 'opened', detail: window.source, sessionId: created.sessionId })
    } catch (error) {
      held(`error:${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return outcomes
}
