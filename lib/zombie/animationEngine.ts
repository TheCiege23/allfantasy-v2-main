import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { zombieClipForAnimation } from '@/lib/zombie/videoAssets'

/**
 * Queue a client-visible animation row. Consumers: SSE (`zombie_event_animation`), league home, universe hub.
 *
 * ## Placement (where UX should react)
 * - **zombie_turn**: League home card + event feed + league chat system line + push (spoiler-safe).
 * - **mauling**: Home banner ~5s, matchup overlay, chat red alert, feed, universe hub, push (spoiler-safe).
 * - **player_revived**: Home gold flash, feed top, chat, push (spoiler-safe).
 * - **weapon_acquired / weapon_stolen**: Chat-only anonymous emoji; no push.
 * - **bomb_detonated**: Full-screen overlay ~6s home + matchup, chat explosion card, universe hub, push allowed.
 * - **serum_used**: Chat teal flash only; no push.
 * - **ambush_triggered**: Chat cryptic card; whisperer push optional; commissioner notified elsewhere.
 * - **whisperer_replaced**: Fullscreen ~7s home, chat drama, universe hub, push.
 * - **horde_grows**: Home horde bar + feed milestone; no push.
 * - **last_survivor**: Home persistent urgent banner, universe flag, push with counts only.
 *
 * ## CSS classes (see `app/globals.css`)
 * Map `animationType` to a class on the client when handling SSE `zombie_event_animation`:
 * - `zombie_turn` → `.zombie-turn-anim` (~1200ms)
 * - `player_revived` → `.revival-anim` (~1000ms ×3 pulses)
 * - `mauling` / mauling → `.mauling-anim` (~1500ms)
 * - `bashing` → impact can use `.weapon-pop-anim` or custom flash (~800ms)
 * - `weapon_acquired` → `.weapon-pop-anim` (~600ms)
 * - `weapon_stolen` → `.weapon-pop-anim` + slide (client)
 * - `bomb_detonated` → `.bomb-anim` (~2000ms)
 * - `serum_used` → `.serum-anim` (~800ms)
 * - `ambush_triggered` → `.ambush-anim` (~1000ms)
 * - `whisperer_replaced` → crimson pulse (reuse `.revival-anim` border color override or custom)
 * - `horde_grows` / `last_survivor` → banner + `.zombie-turn-anim` subset as needed
 *
 * Prefer `durationMs` on the row; classes use defaults above. `prefers-reduced-motion: reduce` zeroes animations.
 */
export async function queueAnimation(
  leagueId: string,
  week: number,
  animationType: string,
  primaryUserId: string,
  metadata: object,
  displayLocation?: string,
  secondaryUserId?: string | null,
  durationMs?: number,
  reducedMotion?: boolean,
) {
  return queueAnimationIn(prisma, leagueId, week, animationType, primaryUserId, metadata, displayLocation, secondaryUserId, durationMs, reducedMotion)
}

/**
 * `queueAnimation` on a given client — pass a transaction so the animation commits (or rolls back) with
 * the event it shows. The 2025 item rules settle combat and revivals inside one transaction; an animation
 * written beside it could play for a bashing or revival that then rolled back.
 */
export async function queueAnimationIn(
  client: Pick<Prisma.TransactionClient, 'zombieEventAnimation'>,
  leagueId: string,
  week: number,
  animationType: string,
  primaryUserId: string,
  metadata: object,
  displayLocation?: string,
  secondaryUserId?: string | null,
  durationMs?: number,
  reducedMotion?: boolean,
) {
  const clip = zombieClipForAnimation(animationType)
  const baseMeta =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {}
  const enriched: Record<string, unknown> = { ...baseMeta }
  if (clip && typeof enriched.clipUrl !== 'string') {
    enriched.clipUrl = clip.url
    enriched.clipType = clip.type
  }

  return client.zombieEventAnimation.create({
    data: {
      leagueId,
      week,
      animationType,
      primaryUserId,
      secondaryUserId: secondaryUserId ?? null,
      displayLocation: displayLocation ?? 'league_chat_and_home',
      durationMs: durationMs ?? 3000,
      metadata: enriched as object,
      reducedMotion: reducedMotion ?? false,
    },
  })
}

/**
 * Cron hook: mark stale pending animations as delivered so dashboards do not grow unbounded.
 * Live SSE clients already received rows while `isDelivered` was false; this is housekeeping.
 */
export async function deliverPendingAnimations(leagueId: string, maxAgeMs = 86_400_000): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs)
  const res = await prisma.zombieEventAnimation.updateMany({
    where: {
      leagueId,
      isDelivered: false,
      createdAt: { lt: cutoff },
    },
    data: { isDelivered: true, deliveredAt: new Date() },
  })
  return res.count
}
