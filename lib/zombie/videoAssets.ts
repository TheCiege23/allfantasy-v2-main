/**
 * Zombie league media under `/public/zombie/videos/`.
 * Filenames match current assets; rename files anytime and update paths here.
 */

export const ZOMBIE_VIDEO_DIRS = {
  humanToZombie: '/zombie/videos/human-to-zombie',
  zombieToHuman: '/zombie/videos/zombie-to-human',
  bashing: '/zombie/videos/bashing',
  ambush: '/zombie/videos/ambush',
  whisperer: '/zombie/videos/whisperer',
} as const

/**
 * Canonical URLs for animation overlays (see `animationEngine` metadata enrichment).
 *
 * 🛑 THE TWO TRANSITION FILENAMES DESCRIBE THE WINNING SIDE, NOT THE TRANSITION, SO THEY READ
 * BACKWARDS. These mappings are CORRECT — do not "fix" them. Verified 2026-09-20 by extracting
 * frames rather than by reading the names:
 *
 *   revival-win.mp4    opens on the silver AF robot cracking apart into an infected human and
 *                      ends on a full green zombie under "UNDEAD CHAMPIONS"  → human → zombie
 *   infection-win.mp4  ends on the clean silver AF robot standing over a bone → zombie → human
 *
 * The previous note here ("If your file names differ, swap these two paths") invited exactly
 * that inversion, which would play a revival when a manager gets infected.
 */
export const ZOMBIE_VIDEO_ASSETS = {
  /** Survivor → Zombie (infection). File is named for the winner; see the block above. */
  humanToZombie: '/zombie/videos/human-to-zombie/revival-win.mp4',
  /** Zombie → Survivor (revival / serum). File is named for the winner; see the block above. */
  zombieToHuman: '/zombie/videos/zombie-to-human/infection-win.mp4',
  bashing: '/zombie/videos/bashing/bashing.mp4',
  ambush: '/zombie/videos/ambush/ambush.mp4',
  whispererChosen: '/zombie/videos/whisperer/Whisperer.mp4',
} as const

export type ZombieClip = { url: string; type: 'video' | 'image' }

/**
 * Default clip for an animation row. Callers may override via metadata; `animationEngine` merges this in.
 */
export function zombieClipForAnimation(animationType: string): ZombieClip | null {
  switch (animationType) {
    case 'zombie_turn':
      return { url: ZOMBIE_VIDEO_ASSETS.humanToZombie, type: 'video' }
    case 'player_revived':
      return { url: ZOMBIE_VIDEO_ASSETS.zombieToHuman, type: 'video' }
    case 'bashing':
      return { url: ZOMBIE_VIDEO_ASSETS.bashing, type: 'video' }
    case 'ambush_triggered':
      return { url: ZOMBIE_VIDEO_ASSETS.ambush, type: 'video' }
    case 'whisperer_selected':
    case 'whisperer_replaced':
      return { url: ZOMBIE_VIDEO_ASSETS.whispererChosen, type: 'video' }
    default:
      return null
  }
}
