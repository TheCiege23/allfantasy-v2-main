/**
 * lib/commissioner/CommissionerRatingTrigger.ts
 * Posts a commissioner rating link to the league chat when the offseason starts.
 * Called once per season at season end / offseason transition.
 * Idempotent: checks if already posted for this season before sending.
 */

import { prisma } from '@/lib/prisma'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'
import { markRatingPromptSeason } from '@/lib/commish-reputation/reputationService'

const RATING_MSG_SUBTYPE = 'commissioner_rating_prompt'

/**
 * Post the commissioner rating link to league chat.
 * Idempotent — only posts once per league per season.
 */
export async function triggerCommissionerRatingPrompt(
  leagueId: string,
  season: number
): Promise<{ sent: boolean; reason?: string }> {
  // 1. Get league info
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, userId: true, name: true, settings: true },
  })
  if (!league) return { sent: false, reason: 'League not found' }

  // 2. Check if already posted for this season
  const settings = (league.settings as Record<string, unknown>) ?? {}
  const lastRatingPromptSeason = settings.last_rating_prompt_season as number | undefined
  if (lastRatingPromptSeason === season) {
    return { sent: false, reason: 'Already posted for this season' }
  }

  // 3. Build the rating link message
  const ratingUrl = `/league/${leagueId}/rate-commissioner`
  const message = [
    `🏆 **Season ${season} is Complete!**`,
    ``,
    `Time to rate your commissioner! Let them know how they did this season.`,
    ``,
    `⭐ **[Rate Your Commissioner](${ratingUrl})**`,
    ``,
    `Your ratings are anonymous and help improve the league experience for everyone.`,
  ].join('\n')

  // 4. Post to league chat (as system message from commissioner's user ID)
  try {
    await createLeagueChatMessage(leagueId, league.userId, message, {
      type: 'text',
      source: null,
      messageSubtype: RATING_MSG_SUBTYPE,
      metadata: {
        season,
        ratingUrl,
        isSystemMessage: true,
        isRatingPrompt: true,
      },
    })
  } catch (e) {
    console.warn('[CommissionerRatingTrigger] Failed to post chat message:', e)
    return { sent: false, reason: 'Chat post failed' }
  }

  // 5. Mark as posted for this season (prevent duplicates). A locked single-key write: spreading the
  //    settings read in step 2 back over the row would drop any rating submitted in between.
  try {
    await markRatingPromptSeason(leagueId, season)
  } catch {
    // Non-fatal — message was already posted
  }

  return { sent: true }
}

/**
 * Check if a league's season has ended and trigger the rating prompt.
 * Safe to call repeatedly — idempotent.
 */
export async function checkAndTriggerRatingIfOffseason(
  leagueId: string
): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      season: true,
      status: true,
      settings: true,
    },
  })
  if (!league) return

  const settings = (league.settings as Record<string, unknown>) ?? {}
  const status = (league.status ?? '').toLowerCase()
  const phase = ((settings.dynastySeasonPhase ?? settings.season_phase ?? '') as string).toLowerCase()

  // Determine if offseason
  const isOffseason =
    status === 'complete' ||
    status === 'post_season' ||
    status === 'offseason' ||
    phase === 'offseason' ||
    phase === 'complete'

  if (isOffseason) {
    await triggerCommissionerRatingPrompt(leagueId, league.season)
  }
}
