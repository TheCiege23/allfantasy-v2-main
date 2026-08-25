import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * WAIVER RULES — and an explicit refusal about waiver ACTIVITY.
 *
 * ⚠ THE RULES EXIST; THE CLAIMS DO NOT. Measured 2026-08-25:
 * `league_waiver_settings` covers 92 leagues, so "when do waivers run?", "is it
 * FAAB or rolling priority?" and "what is my budget?" all have real answers.
 * But `waiver_claims` holds 0 rows, `waiver_transactions` 0, and
 * `redraft_waiver_claims` 1 — nobody's claims are visible to us.
 *
 * Those two facts have to travel together. A block that describes the rules
 * without saying the claims are invisible invites "you were outbid on him" —
 * fluent, specific, and entirely invented. So the refusal is part of the block,
 * not an omission from it.
 */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

type WaiverSettings = {
  waiverType: string
  processingDayOfWeek: number | null
  processingTimeUtc: string | null
  claimLimitPerPeriod: number | null
  claimLimitPerWeek: number | null
  faabBudget: number | null
  tiebreakRule: string | null
  lockType: string | null
  instantFaAfterClear: boolean
  waiverOrderResetPolicy: string | null
  postGameWaiverBehavior: string | null
}

/**
 * Waiver rules for the league in scope, plus this user's FAAB and priority when
 * on file. Returns null when the league has no waiver settings, so the prompt
 * gains no empty section.
 */
export async function buildWaiverContext(leagueId: string, userId: string): Promise<string | null> {
  if (!leagueId || !userId) return null

  let settings: WaiverSettings | null
  try {
    settings = (await prisma.leagueWaiverSettings.findUnique({
      where: { leagueId },
      select: {
        waiverType: true,
        processingDayOfWeek: true,
        processingTimeUtc: true,
        claimLimitPerPeriod: true,
        claimLimitPerWeek: true,
        faabBudget: true,
        tiebreakRule: true,
        lockType: true,
        instantFaAfterClear: true,
        waiverOrderResetPolicy: true,
        postGameWaiverBehavior: true,
      },
    })) as unknown as WaiverSettings | null
  } catch {
    return null
  }
  if (!settings) return null

  const lines: string[] = ['WAIVER RULES for this league (these are the settings, not activity):']
  lines.push(`- Type: ${settings.waiverType}.`)

  if (settings.processingDayOfWeek != null) {
    const day = DAYS[settings.processingDayOfWeek] ?? `day ${settings.processingDayOfWeek}`
    lines.push(
      `- Runs ${day}${settings.processingTimeUtc ? ` at ${settings.processingTimeUtc} UTC` : ''}.`,
    )
  } else {
    lines.push('- Processing schedule is not on file — do not state when waivers run.')
  }

  if (settings.faabBudget != null) lines.push(`- FAAB budget: ${settings.faabBudget} per team.`)
  const claimLimit = settings.claimLimitPerWeek ?? settings.claimLimitPerPeriod
  if (claimLimit != null) lines.push(`- Claim limit: ${claimLimit} per period.`)
  if (settings.tiebreakRule) lines.push(`- Ties broken by: ${settings.tiebreakRule}.`)
  if (settings.lockType) lines.push(`- Lock: ${settings.lockType}.`)
  if (settings.waiverOrderResetPolicy) lines.push(`- Order resets: ${settings.waiverOrderResetPolicy}.`)
  if (settings.postGameWaiverBehavior) lines.push(`- After games: ${settings.postGameWaiverBehavior}.`)
  lines.push(
    `- Free agents ${settings.instantFaAfterClear ? 'are' : 'are NOT'} instantly available once waivers clear.`,
  )

  // ── This user's own standing, where we hold it ─────────────────────────────
  try {
    const season = await prisma.redraftSeason.findFirst({
      where: { leagueId },
      orderBy: { season: 'desc' },
      select: { id: true },
    })
    if (season) {
      const roster = await prisma.redraftRoster.findFirst({
        where: { seasonId: season.id, ownerId: userId },
        select: { faabBalance: true, waiverPriority: true, teamName: true },
      })
      if (roster) {
        const bits: string[] = []
        if (roster.faabBalance != null) bits.push(`FAAB remaining ${roster.faabBalance}`)
        if (roster.waiverPriority != null) bits.push(`waiver priority ${roster.waiverPriority}`)
        if (bits.length > 0) {
          lines.push(`THIS USER (${roster.teamName ?? 'their team'}): ${bits.join(', ')}.`)
        }
      }
    }
  } catch {
    /* the rules above still stand */
  }

  /*
   * The part that keeps the rest honest. Without it, a model that knows the
   * rules will happily narrate claims it cannot see.
   */
  lines.push(
    'NO WAIVER ACTIVITY IS AVAILABLE. We hold zero waiver claims and zero waiver transactions for any league. Do NOT say who claimed, dropped or was outbid on anyone, do NOT report what a player went for, and do NOT imply a claim succeeded or failed. Answer rules questions only, and say the claim history is not something you can see.',
  )

  return lines.join('\n')
}
