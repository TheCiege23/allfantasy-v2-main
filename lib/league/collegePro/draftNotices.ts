import 'server-only'
import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import type { CollegeDraftSport } from './draftPicksOnFile'
import type { DraftedPlayer } from './draftPipeline'
import { normalizeCollegeSport } from './format'
import { COLLEGE_PRO_PAIR_KEY, loadPairContext, readLeaguePair } from './leaguePair'
import { draftReportForPair } from './loadCollegeProDraft'
import { halfLabel } from './pairLink'

/**
 * Tell each paired college + pro league about the draft as it happens, with nothing to set up: when
 * a refresh stores picks it did not have before, every manager whose college player was taken hears
 * that he moves up to their pro roster, and the commissioner hears once per draft that the offseason
 * checklist is ready.
 *
 * Called by the two draft-pick writers (lib/devy/cfbdDraftPicksStore.ts, cbbdDraftPicksStore.ts)
 * with the athlete ids they held before writing, so only NEW picks notify: a daily refresh of a draft
 * already on file sends nothing, and deploying this sends nothing about drafts already past.
 *
 * Each notice is claimed first (a `sportsDataCache` row whose key is the event), the same pattern the
 * dispatcher uses for SMS, so a re-run, a retry or a corrected pick never sends twice.
 */

const YEAR_MS = 365 * 24 * 60 * 60 * 1000

async function claim(key: string): Promise<boolean> {
  try {
    await prisma.sportsDataCache.create({ data: { cacheKey: key, data: { claimedAt: new Date().toISOString() }, expiresAt: new Date(Date.now() + 2 * YEAR_MS) } })
    return true
  } catch {
    // Already claimed (P2002), or the write failed: either way, do not send.
    return false
  }
}

const describePick = (p: DraftedPlayer) => `${p.name} (${p.proTeam}, round ${p.round}, pick ${p.pick})`

export type DraftNoticeResult = { leagues: number; managers: number; commissioners: number }

export async function notifyNewDraftPicks(args: {
  sport: CollegeDraftSport
  year: number
  /** Athlete ids stored before this write. */
  previousIds: ReadonlySet<string>
  /** Athlete ids stored now. */
  currentIds: readonly string[]
  now?: Date
}): Promise<DraftNoticeResult> {
  const now = args.now ?? new Date()
  const result: DraftNoticeResult = { leagues: 0, managers: 0, commissioners: 0 }
  // Only this year's draft: a backfill of an older year is news to nobody.
  if (args.year !== now.getUTCFullYear()) return result
  const fresh = new Set(args.currentIds.filter((id) => !args.previousIds.has(id)))
  if (fresh.size === 0) return result

  const pros = await prisma.league.findMany({
    where: { settings: { path: [COLLEGE_PRO_PAIR_KEY, 'role'], equals: 'pro' } },
    select: { id: true, userId: true, name: true, sport: true, settings: true },
  })
  for (const pro of pros) {
    const pair = readLeaguePair(pro.settings)
    if (!pair) continue
    const college = await prisma.league.findUnique({ where: { id: pair.otherLeagueId }, select: { name: true, sport: true } })
    if (!college || normalizeCollegeSport(college.sport) !== args.sport) continue
    const ctx = await loadPairContext(pro.id, pair.linkedByUserId).catch(() => null)
    if (!ctx) continue
    const report = await draftReportForPair(ctx, args.sport, now).catch(() => null)
    if (!report || report.year !== args.year) continue
    result.leagues++

    const proLabel = halfLabel(pro.sport)
    const proName = (pro.name ?? '').trim() || 'your pro league'
    const collegeName = (college.name ?? '').trim() || 'your college league'
    const href = `/league/${pro.id}?tab=draft`

    for (const franchise of report.movingUp) {
      const players = franchise.players.filter((p) => fresh.has(p.athleteId))
      if (players.length === 0) continue
      const userIds = [
        ...new Set(
          ctx.owners
            .filter((o) => (o.role === 'college' && o.key === franchise.collegeKey) || (o.role === 'pro' && franchise.proKey != null && o.key === franchise.proKey))
            .map((o) => o.userId),
        ),
      ]
      if (userIds.length === 0) continue
      const ids = players.map((p) => p.athleteId).sort()
      if (!(await claim(`c2c-draft-notice:${pro.id}:${args.year}:${ids.join(',')}`))) continue
      const one = players.length === 1
      await dispatchNotification({
        userIds,
        category: 'imported_draft',
        type: 'c2c_draft_move_up',
        title: one ? `${players[0]!.name} was drafted` : `${players.length} of your college players were drafted`,
        body: one
          ? `${players[0]!.proTeam} took him in round ${players[0]!.round}, pick ${players[0]!.pick}. He moves from ${collegeName} to your ${proLabel} roster in ${proName}.`
          : `${players.map(describePick).join('; ')}. They move from ${collegeName} to your ${proLabel} roster in ${proName}.`,
        actionHref: href,
        actionLabel: 'See your pipeline',
        leagueId: pro.id,
        meta: { year: args.year, athleteIds: ids },
      }).catch(() => null)
      result.managers += userIds.length
    }

    if (pro.userId && (await claim(`c2c-draft-checklist:${pro.id}:${args.year}`))) {
      const moving = report.movingUp.reduce((n, f) => n + f.players.length, 0)
      await dispatchNotification({
        userIds: [pro.userId],
        category: 'commissioner_alerts',
        type: 'c2c_draft_checklist',
        // Sent on the first picks of the draft, which may still be under way: "so far", not a total.
        title: `${args.year} ${proLabel} draft: your offseason checklist is ready`,
        body: `${moving} ${moving === 1 ? 'player' : 'players'} from ${collegeName} drafted so far. Track who moves up to ${proName}, the rookie pool and the rookie draft in one place.`,
        actionHref: href,
        actionLabel: 'Open the checklist',
        leagueId: pro.id,
        meta: { year: args.year },
      }).catch(() => null)
      result.commissioners++
    }
  }
  return result
}
