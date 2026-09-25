/**
 * Dynamic Survivor + Exile FAQ for league chat (broadcast + pin).
 *
 * 🛑 IT COULD NOT POST ANYWHERE (found 2026-09-25). It needed `settings.leagueChatThreadId`, which
 * nothing in the app sets (0 of 390 leagues in production), and posted into that platform thread —
 * so every "Post FAQ & pin" answered "link a league chat thread", pointing at a control that does
 * not exist. It now posts into the league's OWN chat, the same store and `broadcast` type as
 * `POST /api/commissioner/broadcast`, and pins it the way league chat pins (a `pin` row carrying
 * `{ messageId, snippet }`, as `/api/shared/chat/threads/league:<id>/pin` writes).
 */

import { prisma } from '@/lib/prisma'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'
import { getExileLeagueId } from '@/lib/survivor/SurvivorExileEngine'
import { seasonWeekBoundsForSport } from '@/lib/survivor/survivorSeasonCalendar'

/** The pin's preview length — the same cut the league pin route makes. */
const FAQ_PIN_SNIPPET_MAX = 120

export function buildSurvivorFaqMarkdown(args: {
  leagueName: string
  sportLabel: string
  tribeCount: number
  mergeWeek: number | null
  mergeTrigger: string
  exileReturnEnabled: boolean
  exileReturnTokens: number
  challengesSystemRun: boolean
  seasonThemeLabel: string | null
  firstWeek?: number
  lastWeek?: number
  exileConfigured: boolean
}): string {
  const theme =
    args.seasonThemeLabel?.trim() ||
    `${args.tribeCount} tribes — theme set by your commissioner in Survivor settings`
  const lines = [
    `📜 SURVIVOR LEAGUE FAQ — ${args.leagueName}`,
    ``,
    `Season theme: ${theme}`,
    `Sport: ${args.sportLabel} · Tribes: ${args.tribeCount} · Merge: ${args.mergeTrigger}${args.mergeWeek != null ? ` (week ${args.mergeWeek})` : ''}`,
    `Regular-season scoring weeks (no playoffs): ${args.firstWeek ?? 1}–${args.lastWeek ?? '?'}.`,
    ``,
    `Challenges: ${args.challengesSystemRun ? 'SYSTEM-GENERATED from the challenge catalog each week (commissioner is not picking props by hand — reduces collusion).' : 'Manual / commissioner — confirm with your host.'}`,
    `Votes: cast with @Chimmy in chat. Scroll reveals are posted when Tribal closes.`,
    ``,
    `Exile: ${args.exileConfigured ? `Enabled. Return tokens required: ${args.exileReturnTokens}. Exile weeks follow the same regular-season window as the main island.` : 'Not linked for this league.'}`,
    ``,
    `Conduct: compete hard; harassment and leaking host DMs are out. Information is currency.`,
  ]
  return lines.join('\n')
}

/**
 * Posts FAQ as broadcast and pins it. Idempotent when `faqSeededAt` is set (caller can skip).
 */
export async function seedSurvivorFaqToLeagueChat(args: {
  leagueId: string
  commissionerUserId: string
  /** Post a fresh FAQ even if one was already seeded (e.g. after settings change). */
  force?: boolean
}): Promise<{ ok: true; messageId?: string } | { ok: false; error: string }> {
  const { leagueId, commissionerUserId, force } = args

  const row = await prisma.survivorLeagueConfig.findUnique({
    where: { leagueId },
    include: { league: { select: { name: true, sport: true } } },
  })
  if (!row) return { ok: false, error: 'Survivor config missing' }

  if (row.faqSeededAt && !force) {
    return { ok: true }
  }

  const league = row.league

  const exileId = await getExileLeagueId(leagueId).catch(() => null)
  const bounds = seasonWeekBoundsForSport(league.sport, row.regularSeasonEndWeek ?? null)

  const text = buildSurvivorFaqMarkdown({
    leagueName: league.name ?? 'League',
    sportLabel: String(league.sport ?? 'NFL'),
    tribeCount: row.tribeCount,
    mergeWeek: row.mergeWeek,
    mergeTrigger: row.mergeTrigger,
    exileReturnEnabled: row.exileReturnEnabled,
    exileReturnTokens: row.exileReturnTokens,
    challengesSystemRun: row.challengesSystemRun,
    seasonThemeLabel: row.seasonThemeLabel,
    firstWeek: bounds.firstWeek,
    lastWeek: bounds.lastWeek,
    exileConfigured: Boolean(exileId),
  })

  const created = await createLeagueChatMessage(leagueId, commissionerUserId, text, {
    type: 'broadcast',
    metadata: { survivorFaq: true },
  })
  if (!created?.id) {
    return { ok: false, error: "The FAQ didn't post to league chat. Give it another shot in a moment." }
  }

  const snippet = text.length > FAQ_PIN_SNIPPET_MAX ? `${text.slice(0, FAQ_PIN_SNIPPET_MAX).trim()}…` : text
  await createLeagueChatMessage(leagueId, commissionerUserId, JSON.stringify({ messageId: created.id, snippet }), {
    type: 'pin',
  })

  await prisma.survivorLeagueConfig.update({
    where: { leagueId },
    data: { faqSeededAt: new Date() },
  })

  return { ok: true, messageId: created.id }
}
