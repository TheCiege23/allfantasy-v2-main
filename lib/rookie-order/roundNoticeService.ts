import 'server-only'

/**
 * Hourly: refresh the live rookie order of every league that automates it, and announce the picks each
 * playoff round locked (see ./roundNotices.ts for what is stored and when a notice fires).
 *
 * The refresh is `refreshLiveRookieOrder` itself, so the sweep also saves the final order the moment
 * the title game is decided — before this, only opening the panel or building the next draft did.
 * It runs where the automation runs: switched on, and the league entitled or switched on while
 * entitled this season (`automationActive`). A league whose order is already final and announced for
 * its season is not read at all.
 */
import { prisma } from '@/lib/prisma'
import { leagueSettingsHomeHref } from '@/lib/league-settings-home/settingsEntryRouting'
import { refreshLiveRookieOrder } from './liveRookieOrderService'
import {
  liveRookieOrderRaw,
  readLastRoundNotice,
  readRoundNoticeSettings,
  roundNoticeChange,
  roundNoticeText,
  type LastRoundNotice,
  type NoticeLanguage,
} from './roundNotices'

export type RookieOrderRoundNoticeRun = {
  leagues: number
  refreshed: number
  announced: number
  notified: number
  posted: number
  skipped: Record<string, number>
  failures: { leagueId: string; error: string }[]
}

const DEFAULT_LEAGUE_LIMIT = 50

export async function runRookieOrderRoundNotices(opts?: { limit?: number; deadline?: number }): Promise<RookieOrderRoundNoticeRun> {
  const deadline = opts?.deadline ?? Date.now() + 25_000
  const run: RookieOrderRoundNoticeRun = { leagues: 0, refreshed: 0, announced: 0, notified: 0, posted: 0, skipped: {}, failures: [] }
  const skip = (reason: string) => (run.skipped[reason] = (run.skipped[reason] ?? 0) + 1)
  // Least recently announced first, so a long list is worked through rather than starved.
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM leagues
    WHERE settings -> 'rookie_draft_order' -> 'live' ->> 'enabled' = 'true'
      AND NOT (
        COALESCE(settings -> 'rookie_draft_order' -> 'live' -> 'lastRoundNotice' ->> 'phase', '') = 'final'
        AND COALESCE(settings -> 'rookie_draft_order' -> 'live' -> 'lastRoundNotice' ->> 'season', '') = season::text
      )
    ORDER BY COALESCE(settings -> 'rookie_draft_order' -> 'live' -> 'lastRoundNotice' ->> 'at', '') ASC, id
    LIMIT ${Math.max(1, Math.min(opts?.limit ?? DEFAULT_LEAGUE_LIMIT, 200))}`

  for (const { id: leagueId } of ids) {
    if (Date.now() >= deadline) break
    run.leagues += 1
    try {
      const view = await refreshLiveRookieOrder(leagueId)
      if (!view) {
        skip('no_season_data')
        continue
      }
      run.refreshed += 1
      if (!view.automationActive) {
        skip('not_entitled')
        continue
      }
      const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, name: true, settings: true } })
      if (!league) continue
      const change = roundNoticeChange({ leagueId, season: view.basedOnSeason, result: view.result, last: readLastRoundNotice(league.settings) })
      if (!change) {
        skip(view.result.phase === 'regular_season' ? 'regular_season' : 'no_change')
        continue
      }
      // Marked before announcing: a failed send is retried by nobody, but a crash after a send must
      // not announce the same round twice. The notification and chat post are idempotent on `key` too.
      await writeLastRoundNotice(leagueId, change.next)
      run.announced += 1

      const choice = readRoundNoticeSettings(league.settings)
      const lang = await commissionerLanguage(league.userId)
      const text = roundNoticeText(change, view.draftSeason, lang)
      const leagueName = league.name ?? (lang === 'es' ? 'tu liga' : 'your league')
      if (choice.notify) {
        const { dispatchNotification } = await import('@/lib/notifications/NotificationDispatcher')
        await dispatchNotification({
          userIds: [league.userId],
          category: 'commissioner_alerts',
          type: 'rookie_order_round',
          title: text.title,
          body: `${leagueName}: ${text.body}`,
          smsBody: lang === 'es' ? `AllFantasy: el orden del draft de novatos de ${leagueName} cambió. Ábrelo en la app.` : `AllFantasy: the ${leagueName} rookie draft order changed. Open the app to see it.`,
          actionHref: leagueSettingsHomeHref(leagueId, 'draft'),
          actionLabel: lang === 'es' ? 'Ver orden' : 'See order',
          leagueId,
          severity: change.final ? 'medium' : 'low',
          dedupePrefix: change.key,
          meta: { season: change.season, lockedCount: change.lockedCount, total: change.total, final: change.final },
        })
        run.notified += 1
      }
      if (choice.chat) {
        const { createLeagueChatMessage } = await import('@/lib/league-chat/LeagueChatMessageService')
        // Authored by the owner and tagged as a host announcement — the stand-in every automated post uses.
        const posted = await createLeagueChatMessage(leagueId, league.userId, text.chat, {
          type: 'host_announcement',
          idempotencyKey: change.key.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 190),
          metadata: { senderIsHost: true, contentType: 'rookie_order_update', season: change.season, lockedCount: change.lockedCount, final: change.final },
        })
        if (posted) run.posted += 1
      }
    } catch (e) {
      run.failures.push({ leagueId, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return run
}

async function commissionerLanguage(userId: string): Promise<NoticeLanguage> {
  const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { preferredLanguage: true } }).catch(() => null)
  return profile?.preferredLanguage === 'es' ? 'es' : 'en'
}

/** Read-merge-write of `live.lastRoundNotice` only; every other key of the live order is kept. */
async function writeLastRoundNotice(leagueId: string, next: LastRoundNotice): Promise<void> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const settings = (league?.settings && typeof league.settings === 'object' ? league.settings : {}) as Record<string, unknown>
  const rookie = (settings.rookie_draft_order && typeof settings.rookie_draft_order === 'object' ? settings.rookie_draft_order : {}) as Record<string, unknown>
  await prisma.league.update({
    where: { id: leagueId },
    data: { settings: { ...settings, rookie_draft_order: { ...rookie, live: { ...liveRookieOrderRaw(settings), lastRoundNotice: next } } } as never },
  })
}
