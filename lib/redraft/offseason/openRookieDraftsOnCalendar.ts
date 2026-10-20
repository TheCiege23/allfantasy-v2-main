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
 *   - the commissioner turned auto-open on (`rookieDraftCalendar.ts`; OFF by default);
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
 * through the same league announcement that names the champion. Picking is NOT started: the
 * commissioner still starts the draft.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { seasonSetupBlocked } from '@/lib/tournament/seasonNativeContract'
import { createNextLeagueDraft } from '@/lib/live-draft-engine/createNextLeagueDraft'
import { publishLeagueFanoutEvent } from '@/lib/league-events/publisher'
import { readRookieDraftCalendarSettings, resolveRookieDraftWindow } from '@/lib/dynasty-core/rookieDraftCalendar'
import { isDynastyFamilyLeague } from './carryDynastyRosters'
import { rookieDraftState } from './startDynastyNewSeason'

/** `League.lifecycleMetadata` key recording which season's rookie draft was opened automatically. */
export const ROOKIE_DRAFT_AUTO_OPENED_METADATA_KEY = 'rookieDraftAutoOpened'

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

export async function openDynastyRookieDraftsOnCalendar(options: {
  now: Date
  limit: number
  actorUserId: string
  resolveWeek: (seasonId: string) => Promise<{ ok: boolean; phase?: string; reason?: string }>
  nativePlatforms: readonly string[]
}): Promise<RookieDraftOpenOutcome[]> {
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
      league: { select: { settings: true, leagueType: true, isDynasty: true, lifecycleMetadata: true } },
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
      if (!readRookieDraftCalendarSettings(c.league.settings).autoOpen) {
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
      const prior = await prisma.redraftSeason.findFirst({
        where: { leagueId: c.leagueId, status: 'complete', NOT: { id: c.id }, createdAt: { lt: c.createdAt } },
        select: { id: true },
      })
      if (!prior) {
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
            },
          } as Prisma.InputJsonValue,
        },
      })

      await publishLeagueFanoutEvent({
        leagueId: c.leagueId,
        eventType: 'rookie_draft_opened',
        title: `The ${created.season} rookie draft is open`,
        message:
          created.orderSource === 'lottery'
            ? `The ${created.season} rookie draft has been created and its order set by the weighted lottery. Your commissioner will start it — check the draft room for the order and settings.`
            : `The ${created.season} rookie draft has been created. Your commissioner will start it — check the draft room for the order and settings.`,
        category: 'league_announcements',
        visibility: 'all_members',
        actorUserId: options.actorUserId,
        meta: { seasonId: created.seasonId, draftSessionId: created.sessionId, orderSource: created.orderSource },
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
