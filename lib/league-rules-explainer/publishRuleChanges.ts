import 'server-only'

import type { RuleChange } from './types'

/**
 * Record a `settings_changed` league event carrying before/after values, for settings pages that save
 * outside executeLeagueSettingsPatch (the guillotine rules pages, roster slots). Those saves never
 * published an event, so this one is SILENT (no push / email): the league home's "What changed" card
 * is how members hear about it. Best-effort — it never fails the save that called it.
 */
export async function publishRuleChangesEvent(input: {
  leagueId: string
  actorUserId: string
  section: string
  changes: RuleChange[]
}): Promise<void> {
  if (!input.changes.length) return
  try {
    const { publishLeagueFanoutEvent } = await import('@/lib/league-events/publisher')
    await publishLeagueFanoutEvent({
      leagueId: input.leagueId,
      eventType: 'settings_changed',
      title: 'League settings updated',
      message: `Settings were updated (${input.section}).`,
      category: 'league_announcements',
      visibility: 'all_members',
      actorUserId: input.actorUserId,
      skipNotifications: true,
      meta: {
        section: input.section,
        updatedFields: input.changes.map((c) => c.key),
        actorUserId: input.actorUserId,
        ruleChanges: input.changes,
      },
    })
  } catch (e) {
    console.warn('[publishRuleChangesEvent]', e instanceof Error ? e.message : 'unknown error')
  }
}
