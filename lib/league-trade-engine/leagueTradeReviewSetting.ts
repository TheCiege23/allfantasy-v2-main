/**
 * Saving a league's trade review mode so every trade runtime actually reads it.
 *
 * 🛑 WHY THIS EXISTS. The commissioner Trade Settings panel saved `settings.tradeReviewType`, a key no
 * trade runtime reads. Each runtime reads its own store:
 *
 *   generic engine (lib/league-trade-engine/tradeSettingsResolver.ts)  settings.commissionerSettings.tradeReviewMode
 *   redraft runtime (lib/redraft/tradeGovernance.ts)                   RedraftLeagueExtendedSettings.commissionerTradeReviewType
 *   rules popup (lib/league-rules-explainer/snapshot.ts)               settings.trade_review_mode
 *
 * so a commissioner who switched to a league vote kept getting commissioner review, with the panel
 * showing the new choice. A save now writes all three (plus the legacy key the panel and the AI context
 * read), with one canonical value.
 *
 * ⚠ "No review" IS STORED AS `instant`. The panel offers `none` labelled "No review". The generic engine
 * reads `none` as instant, but the redraft runtime reads a stored `none` as "trades are disabled" and
 * fails closed to commissioner review — so writing `none` there would keep the review the commissioner
 * just turned off. `instant` means the same thing to both.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { diffRuleSnapshots } from '@/lib/league-rules-explainer/changeKeys'
import { tradeReviewMode, effectiveVetoRule } from '@/lib/league-rules-explainer/snapshot'
import { publishRuleChangesEvent } from '@/lib/league-rules-explainer/publishRuleChanges'

export type LeagueTradeReviewMode = 'commissioner' | 'league_vote' | 'instant'

/** A panel or API value as the mode it means; null for anything unrecognised. */
export function normalizeTradeReviewChoice(raw: unknown): LeagueTradeReviewMode | null {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (value === 'league_vote') return 'league_vote'
  if (value === 'commissioner') return 'commissioner'
  if (value === 'instant' || value === 'none' || value === 'no_veto') return 'instant'
  return null
}

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** League.settings with the mode written to every key a reader uses. Pure; returns a new object. */
export function withTradeReviewMode(settings: Record<string, unknown>, mode: LeagueTradeReviewMode): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...settings,
    trade_review_mode: mode,
    tradeReviewType: mode,
    commissionerSettings: { ...record(settings.commissionerSettings), tradeReviewMode: mode },
  }
  // League creation mirrors the block under a snake_case key; keep the mirror equal where it exists.
  if (settings.commissioner_settings && typeof settings.commissioner_settings === 'object') {
    next.commissioner_settings = { ...record(settings.commissioner_settings), tradeReviewMode: mode }
  }
  return next
}

/**
 * Write the league row and the redraft runtime's store in ONE transaction, so the two runtimes cannot
 * disagree after a save. `updateMany` is a no-op for a league with no RedraftLeagueExtendedSettings row.
 */
export async function writeLeagueWithTradeReview<S extends Prisma.LeagueSelect>(
  leagueId: string,
  data: Prisma.LeagueUpdateInput,
  mode: LeagueTradeReviewMode | null,
  select?: S,
): Promise<Prisma.LeagueGetPayload<{ select: S }>> {
  const leagueWrite = prisma.league.update({ where: { id: leagueId }, data, ...(select ? { select } : {}) })
  if (!mode) return (await leagueWrite) as Prisma.LeagueGetPayload<{ select: S }>
  const [league] = await prisma.$transaction([
    leagueWrite,
    prisma.redraftLeagueExtendedSettings.updateMany({ where: { leagueId }, data: { commissionerTradeReviewType: mode } }),
  ])
  return league as Prisma.LeagueGetPayload<{ select: S }>
}

/** The league home's "What changed" card, read with the popup's own reader. Never throws. */
export async function publishTradeReviewChange(input: {
  leagueId: string
  actorUserId: string | undefined
  settingsBefore: Record<string, unknown>
  settingsAfter: Record<string, unknown>
}): Promise<void> {
  if (!input.actorUserId) return
  await publishRuleChangesEvent({
    leagueId: input.leagueId,
    actorUserId: input.actorUserId,
    section: 'trades',
    changes: diffRuleSnapshots({ tradeReview: tradeReviewMode(input.settingsBefore), vetoThreshold: effectiveVetoRule(input.settingsBefore) }, { tradeReview: tradeReviewMode(input.settingsAfter), vetoThreshold: effectiveVetoRule(input.settingsAfter) }),
  })
}
