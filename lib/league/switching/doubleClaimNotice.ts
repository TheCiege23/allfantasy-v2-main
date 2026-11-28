/**
 * Rule 1 of a switching league: a player claimed on both sides stays with the team that switched, and the
 * commissioner is told. The roster copy (lib/league-runtime/materializeRedraftRosterPlayers.ts) applies the
 * rule; this tells the commissioner, once per player and team.
 *
 * How it happens: a manager who switched adds a player here, and a manager still on the old platform adds
 * the same player there. AllFantasy is the league of record once official, so its claim stands; the old
 * platform's copy of that player is left off the other team here, and the commissioner can sort it out there.
 */
import { prisma } from '@/lib/prisma'
import { sourcePlatformLabel } from '@/lib/league/write-authority'

export type DoubleClaim = {
  playerId: string
  playerName: string | null
  /** The redraft roster of the team still on the old platform, which did NOT get the player here. */
  platformRedraftRosterId: string
  /** The redraft roster of the switched team that keeps the player. */
  allFantasyRedraftRosterId: string
}

/** One notice per player and team, ever: the copy runs every few minutes and finds the same claim each time. */
export function doubleClaimNoticeKey(leagueId: string, claim: DoubleClaim): string {
  return `switching_double_claim:${leagueId}:${claim.playerId}:${claim.platformRedraftRosterId}`
}

export async function tellCommissionerOfDoubleClaims(leagueId: string, claims: readonly DoubleClaim[]): Promise<number> {
  if (claims.length === 0) return 0
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, platform: true } })
  if (!league?.userId) return 0
  const commissionerId = league.userId
  const platform = sourcePlatformLabel(league.platform) ?? 'the other platform'

  const rosterIds = [...new Set(claims.flatMap((c) => [c.platformRedraftRosterId, c.allFantasyRedraftRosterId]))]
  const rosters = await prisma.redraftRoster.findMany({ where: { id: { in: rosterIds } }, select: { id: true, teamName: true, ownerName: true } })
  const teamName = new Map(rosters.map((r) => [r.id, r.teamName?.trim() || r.ownerName?.trim() || 'A team']))

  // The dispatcher already keeps one inbox row per key; checking first also keeps it from pushing again.
  const keys = claims.map((c) => doubleClaimNoticeKey(leagueId, c))
  const told = await prisma.platformNotification.findMany({
    where: { sourceKey: { in: keys.map((k) => `${k}:${commissionerId}`) } },
    select: { sourceKey: true },
  })
  const toldKeys = new Set(told.map((t) => t.sourceKey))

  const { dispatchNotification } = await import('@/lib/notifications/NotificationDispatcher')
  let sent = 0
  for (const claim of claims) {
    const key = doubleClaimNoticeKey(leagueId, claim)
    if (toldKeys.has(`${key}:${commissionerId}`)) continue
    const player = claim.playerName?.trim() || 'A player'
    const kept = teamName.get(claim.allFantasyRedraftRosterId) ?? 'A team'
    const other = teamName.get(claim.platformRedraftRosterId) ?? 'another team'
    await dispatchNotification({
      userIds: [commissionerId],
      category: 'commissioner_alerts',
      productType: 'app',
      type: 'switching_double_claim',
      title: `${player} is on two teams`,
      body: `${kept} has ${player} on AllFantasy, and ${other} added the same player on ${platform}. AllFantasy keeps ${player} with ${kept}. Ask ${other} to drop the player on ${platform}.`,
      actionHref: `/league/${encodeURIComponent(leagueId)}?view=roster`,
      actionLabel: 'View rosters',
      leagueId,
      severity: 'medium',
      dedupePrefix: key,
      meta: { leagueId, playerId: claim.playerId },
    }).catch(() => null)
    sent += 1
  }
  return sent
}
