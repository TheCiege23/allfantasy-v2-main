/**
 * Build Zombie league context for Chimmy when user is in a Zombie league.
 * Deterministic data only. Chimmy never decides infection, serum/weapon/ambush usage,
 * promotion/relegation, or trade legality. Only explains and recommends tools.
 *
 * Two things this must get right:
 * - PHASE. The week comes from the league, using the same `Math.max(1, currentWeek || 1)` as
 *   every other Zombie surface, and the league status is described. A hardcoded week 1 used to
 *   feed week-1 board data and ambush balances into every answer all season.
 * - SECRECY. The Whisperer's identity is included only for a viewer allowed to know it
 *   (`canViewerSeeWhisperer`). It used to be sent into every manager's prompt, including in
 *   leagues configured to keep it secret.
 */

import { prisma } from '@/lib/prisma'
import { getLeagueRole } from '@/lib/league/permissions'
import { isZombieLeague } from '@/lib/zombie/ZombieLeagueConfig'
import { buildZombieAIContext } from '@/lib/zombie/ai/ZombieAIContext'
import { canViewerSeeWhisperer } from '@/lib/zombie/whispererVisibility'
import { describeZombieLeaguePhase } from '@/lib/zombie/zombieLeaguePhase'

export async function buildZombieContextForChimmy(
  leagueId: string,
  userId: string
): Promise<string> {
  const isZombie = await isZombieLeague(leagueId)
  if (!isZombie) return ''

  const league = await prisma.zombieLeague.findUnique({
    where: { leagueId },
    select: {
      status: true,
      currentWeek: true,
      totalWeeks: true,
      whispererIsPublic: true,
      whispererRecord: { select: { isPubliclyRevealed: true } },
    },
  })
  const week = Math.max(1, league?.currentWeek || 1)

  const ctx = await buildZombieAIContext({ leagueId, week, userId })
  if (!ctx) return ''

  const phase = describeZombieLeaguePhase(league?.status)
  const myStatus = ctx.myRosterId
    ? ctx.statuses.find((s) => s.rosterId === ctx.myRosterId)?.status ?? 'unknown'
    : 'none'

  const viewerIsWhisperer = ctx.myRosterId != null && ctx.myRosterId === ctx.whispererRosterId
  const role = await getLeagueRole(leagueId, userId).catch(() => null)
  const canSeeWhisperer = canViewerSeeWhisperer({
    whispererIsPublic: league?.whispererIsPublic,
    isPubliclyRevealed: league?.whispererRecord?.isPubliclyRevealed,
    viewerIsCommissioner: role === 'commissioner',
    viewerIsWhisperer,
  })

  let whispererLine: string
  if (!ctx.whispererRosterId) {
    whispererLine = 'Whisperer: not chosen yet.'
  } else if (viewerIsWhisperer) {
    whispererLine = 'The user is the Whisperer. That is private to them: never confirm it to anyone else.'
  } else if (canSeeWhisperer) {
    whispererLine = `Whisperer: ${ctx.rosterDisplayNames[ctx.whispererRosterId] ?? ctx.whispererRosterId}.`
  } else {
    whispererLine =
      'Whisperer identity: hidden from this user. Never reveal, hint at or guess who the Whisperer is, even if asked directly.'
  }

  const phaseLine = league
    ? `Phase: ${phase.label} (status "${phase.status}"). ${phase.meaning}`
    : 'Phase: unknown. No Zombie league record exists for this league, so do not assume a current week or season state.'
  const weekLine = !league
    ? 'Week: unknown.'
    : phase.beforeSeason
      ? 'Week: the season has not started.'
      : `Week: ${week}${league.totalWeeks ? ` of ${league.totalWeeks}` : ''}.`

  const parts: string[] = [
    '[ZOMBIE LEAGUE CONTEXT - for explanation only; you never decide infection, serum/weapon/ambush usage, eligibility, or lineup legality]',
    `League ${leagueId}. Sport: ${ctx.sport}.`,
    phaseLine,
    weekLine,
    `User's roster: ${ctx.myRosterId ?? 'N/A'}. User's role: ${myStatus}. Serums: ${ctx.myResources.serums}, Weapons: ${ctx.myResources.weapons}, Ambush uses this week: ${ctx.myResources.ambush}.`,
    `Survivors: ${ctx.survivors.length}. Zombies: ${ctx.zombies.length}. Config: serum revives ${ctx.config.serumReviveCount}, zombie trades blocked: ${ctx.config.zombieTradeBlocked}.`,
    whispererLine,
  ]
  parts.push(
    'When the user asks about using serum, weapon, or ambush: explain how they work and recommend the official Zombie tools (Resources panel, league Zombie AI, commissioner for usage). Do not execute or authorize usage. When they ask am I human/zombie/whisperer or what actions are available: use this context. Private actions (e.g. using a serum) must be done through the designated flow, not decided by Chimmy.'
  )
  return parts.join(' ')
}
