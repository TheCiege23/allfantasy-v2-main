/**
 * Step 5 of a switching league: the switching period ends. Everyone has switched, or the head commissioner says
 * "Everyone's here". From then on every team counts as switched (switchingLeague.ts `hasTeamSwitched`), so the old
 * platform's copy leaves every team alone, and lineups, waivers and trades all run here. Teams that had not switched
 * keep their rosters as they stand and are run here from now on; the commissioner is told which ones and who manages
 * them, so they can follow up.
 *
 * Mid-season this is the end. In the offseason the in-place "Switch to AllFantasy" (convertImportedLeagueInPlace.ts)
 * turns the league native for good (owner, 2026-11-27).
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { sourcePlatformLabel } from '@/lib/league/write-authority'
import {
  everyTeamSwitched,
  isOfficialOnAllFantasy,
  readSwitchingState,
  withEnded,
  type LeftBehindTeam,
  type SwitchStamp,
} from './switchingLeague'

type Tx = Prisma.TransactionClient

const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

export type EndSwitchingResult =
  | { ok: true; alreadyEnded: boolean; leftBehind: LeftBehindTeam[] }
  | { ok: false; status: number; reason: string }

/**
 * Ends the switching period inside a caller's transaction, when the league is official and not already ended.
 * `onlyIfEveryoneSwitched` is the automatic end (the last team just switched): it does nothing while any team is
 * still on the old platform. Returns null when nothing was written.
 */
export async function endSwitchingInTransaction(
  tx: Tx,
  args: { leagueId: string; stamp: SwitchStamp; onlyIfEveryoneSwitched: boolean },
): Promise<LeftBehindTeam[] | null> {
  const league = await tx.league.findUnique({ where: { id: args.leagueId }, select: { settings: true } })
  const state = readSwitchingState(league?.settings)
  if (!state?.official || state.ended) return null
  const teams = await tx.leagueTeam.findMany({ where: { leagueId: args.leagueId }, select: { id: true, teamName: true, ownerName: true } })
  if (args.onlyIfEveryoneSwitched && !everyTeamSwitched(league?.settings, teams.map((t) => t.id))) return null
  const leftBehind = teams
    .filter((t) => !state.teams[t.id])
    .map((t) => ({ teamId: t.id, name: t.teamName?.trim() || 'A team', manager: t.ownerName?.trim() || null }))
  const next = withEnded(league?.settings, args.stamp, leftBehind)
  await tx.league.update({ where: { id: args.leagueId }, data: { settings: { ...record(league?.settings), switching: next } as never } })
  return leftBehind
}

/** The head commissioner's "Everyone's here". Idempotent. */
export async function endSwitchingPeriod(args: { leagueId: string; userId: string; now?: Date }): Promise<EndSwitchingResult> {
  const league = await prisma.league.findUnique({ where: { id: args.leagueId }, select: { settings: true } })
  if (!league) return { ok: false, status: 404, reason: 'League not found.' }
  if (!isOfficialOnAllFantasy(league.settings)) return { ok: false, status: 409, reason: 'Make the league official first.' }
  const before = readSwitchingState(league.settings)
  if (before?.ended) return { ok: true, alreadyEnded: true, leftBehind: before.leftBehind ?? [] }

  const stamp = { at: (args.now ?? new Date()).toISOString(), byUserId: args.userId }
  const leftBehind = await prisma.$transaction((tx) => endSwitchingInTransaction(tx, { leagueId: args.leagueId, stamp, onlyIfEveryoneSwitched: false }))
  if (leftBehind == null) {
    const now = await prisma.league.findUnique({ where: { id: args.leagueId }, select: { settings: true } })
    return { ok: true, alreadyEnded: true, leftBehind: readSwitchingState(now?.settings)?.leftBehind ?? [] }
  }
  await tellCommissionerSwitchingEnded(args.leagueId, leftBehind)
  return { ok: true, alreadyEnded: false, leftBehind }
}

/** One notice per league, ever. Names the teams that had not switched and who manages them. */
export async function tellCommissionerSwitchingEnded(leagueId: string, leftBehind: readonly LeftBehindTeam[]): Promise<void> {
  try {
    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, platform: true } })
    if (!league?.userId) return
    const platform = sourcePlatformLabel(league.platform) ?? 'the other platform'
    const named = leftBehind.map((t) => (t.manager ? `${t.name} (${t.manager})` : t.name))
    const { dispatchNotification } = await import('@/lib/notifications/NotificationDispatcher')
    await dispatchNotification({
      userIds: [league.userId],
      category: 'commissioner_alerts',
      productType: 'app',
      type: 'switching_ended',
      title: leftBehind.length === 0 ? 'Everyone has switched to AllFantasy' : 'Your league now runs fully on AllFantasy',
      body: leftBehind.length === 0
        ? `Every team now runs on AllFantasy, and nothing is copied from ${platform} any more.`
        : `Nothing is copied from ${platform} any more. These teams hadn't switched, so AllFantasy now runs them as they stood: ${named.join(', ')}. Send them your league's invite link.`,
      actionHref: `/league/${encodeURIComponent(leagueId)}?view=commissioner`,
      actionLabel: 'Open Commissioner',
      leagueId,
      severity: 'medium',
      dedupePrefix: `switching_ended:${leagueId}`,
      meta: { leagueId, leftBehind: leftBehind.map((t) => t.teamId) },
    })
  } catch {
    // A notice that fails to send must not undo the end, which has already been written.
  }
}
