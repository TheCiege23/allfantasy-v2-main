/**
 * The "What changed" card for a save that moves the rookie draft order the engine uses
 * (`effectiveRookieDraftOrder`): the automatic order (`/rookie-draft-order`) and the live order
 * (`/rookie-draft-order/live`) both write `League.settings.rookie_draft_order`, which the popup now
 * reads. One silent card under the Dynasty section's `rookieDraftOrder` key, and only when the order the
 * engine seats from actually changes. Never throws: a card is not worth failing a saved setting over.
 */
import { prisma } from '@/lib/prisma'
import { publishRuleChangesEvent } from './publishRuleChanges'
import { effectiveRookieDraftOrder } from './snapshot'

export async function publishRookieDraftOrderChange(input: {
  leagueId: string
  actorUserId: string
  settingsBefore: unknown
}): Promise<void> {
  try {
    const [league, dynasty] = await Promise.all([
      prisma.league.findUnique({ where: { id: input.leagueId }, select: { settings: true } }),
      prisma.dynastyLeagueConfig.findUnique({ where: { leagueId: input.leagueId }, select: { rookiePickOrderMethod: true } }),
    ])
    const method = dynasty?.rookiePickOrderMethod ?? 'max_pf'
    const before = effectiveRookieDraftOrder(method, input.settingsBefore)
    const after = effectiveRookieDraftOrder(method, league?.settings)
    if (before === after) return
    await publishRuleChangesEvent({
      leagueId: input.leagueId,
      actorUserId: input.actorUserId,
      section: 'rookie-draft-order',
      changes: [{ key: 'rookieDraftOrder', before, after }],
    })
  } catch (e) {
    console.warn('[rookie-draft-order] change card', e instanceof Error ? e.message : 'unknown error')
  }
}
