/**
 * Post guillotine-related messages to league chat (chop announcement, etc.).
 */

import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'

/**
 * ⚠ AUTHORED BY THE LEAGUE OWNER, TAGGED AS A HOST ANNOUNCEMENT. `LeagueChatMessage.userId` must be a
 * real AppUser, and there is no system user — the league owner is the established stand-in
 * (`lib/notifications/outboxRelay.ts`, `lib/league/faqGenerator.ts`, the zombie weekly update). As a
 * plain `text` message it read as the owner typing it; `host_announcement` + `senderIsHost` is how
 * every other automated post in league chat says otherwise.
 */
export async function postChopToLeagueChat(args: {
  leagueId: string
  weekOrPeriod: number
  choppedRosterIds: string[]
  displayNames: Record<string, string>
  userId: string
}): Promise<void> {
  const { leagueId, weekOrPeriod, choppedRosterIds, displayNames, userId } = args
  const names = choppedRosterIds.map((id) => displayNames[id] ?? id).join(', ')
  const message =
    choppedRosterIds.length > 1
      ? `Week ${weekOrPeriod} — Chopped: ${names}. Their rosters have been released to waivers.`
      : `Week ${weekOrPeriod} — ${names} has been chopped. Their roster has been released to waivers.`
  await createLeagueChatMessage(leagueId, userId, message, {
    type: 'host_announcement',
    metadata: { senderIsHost: true, contentType: 'guillotine_chop', guillotineChop: true, weekOrPeriod, choppedRosterIds },
  })
}
