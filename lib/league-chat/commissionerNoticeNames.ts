import 'server-only'

import { prisma } from '@/lib/prisma'
import { safeDisplayName } from '@/lib/chat-notifications/displayName'
import { UNNAMED_MANAGER, type NoticeAlert, type NoticeNames } from '@/lib/league-chat/chimmyCommissionerNotices'

/**
 * Who the ids in an AI Commissioner alert ARE, so the league-chat copy can say names
 * (lib/league-chat/chimmyCommissionerNotices.ts → `namesInNoticeText`). Postgres only.
 *
 * A manager id, as the governance analyzer stores it, is a `LeagueTeam.externalId` (the platform
 * roster id or team key) or — when a team has none — its `ownerName`; a trade partner is the
 * `LeagueTrade.partnerRosterId` or `partnerName`. Each resolves, in order, to:
 *
 *     team name → manager display name → the claiming user's display name → username → "a manager"
 *
 * through `safeDisplayName`, which skips anything shaped like an email or a phone number. The alert
 * rows are never written: the ids stay in the stored alert, which is the commissioner's record.
 *
 * Never throws — a failed read resolves nobody, and the renderer then says "a manager".
 */

type TeamRow = {
  externalId: string
  ownerName: string | null
  teamName: string | null
  claimedByUserId: string | null
}

function managerIdsOf(alerts: readonly NoticeAlert[]): string[] {
  const out = new Set<string>()
  for (const a of alerts) for (const id of a.relatedManagerIds ?? []) if (String(id ?? '').trim()) out.add(String(id).trim())
  return [...out]
}

export async function resolveCommissionerNoticeNames(leagueId: string, alerts: readonly NoticeAlert[]): Promise<NoticeNames> {
  const managers: Record<string, string> = {}
  const trades: Record<string, { refs: string[]; partner: string | null }> = {}
  try {
    const tradeIds = [
      ...new Set(alerts.map((a) => (typeof a.relatedTradeId === 'string' ? a.relatedTradeId.trim() : '')).filter(Boolean)),
    ]
    const tradeRows = tradeIds.length
      ? await prisma.leagueTrade
          .findMany({
            where: { id: { in: tradeIds } },
            select: { id: true, transactionId: true, partnerRosterId: true, partnerName: true },
          })
          .catch(() => [] as Array<{ id: string; transactionId: string; partnerRosterId: number | null; partnerName: string | null }>)
      : []

    const partnerKeyOf = (t: { partnerRosterId: number | null; partnerName: string | null }) =>
      t.partnerRosterId != null ? String(t.partnerRosterId) : (t.partnerName?.trim() ?? '')
    const ids = [...new Set([...managerIdsOf(alerts), ...tradeRows.map(partnerKeyOf).filter(Boolean)])]

    const teams: TeamRow[] = ids.length
      ? await prisma.leagueTeam
          .findMany({
            where: { leagueId, OR: [{ externalId: { in: ids } }, { ownerName: { in: ids } }] },
            select: { externalId: true, ownerName: true, teamName: true, claimedByUserId: true },
          })
          .catch(() => [] as TeamRow[])
      : []
    const userIds = [...new Set(teams.map((t) => t.claimedByUserId).filter((v): v is string => Boolean(v)))]
    const users = userIds.length
      ? await prisma.appUser
          .findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true, username: true } })
          .catch(() => [] as Array<{ id: string; displayName: string | null; username: string | null }>)
      : []

    const nameOfTeam = (t: TeamRow): string => {
      const user = t.claimedByUserId ? users.find((u) => u.id === t.claimedByUserId) : undefined
      return safeDisplayName([t.teamName, t.ownerName, user?.displayName, user?.username], UNNAMED_MANAGER)
    }
    for (const id of ids) {
      const team = teams.find((t) => t.externalId === id) ?? teams.find((t) => t.ownerName === id)
      if (team) managers[id] = nameOfTeam(team)
    }

    for (const t of tradeRows) {
      const key = partnerKeyOf(t)
      const partner = (key && managers[key]) || safeDisplayName([t.partnerName], '') || null
      trades[t.id] = { refs: t.transactionId ? [t.transactionId] : [], partner: partner && partner !== UNNAMED_MANAGER ? partner : null }
    }
  } catch {
    /* resolve nobody: the renderer says "a manager" */
  }
  return { managers, trades }
}
