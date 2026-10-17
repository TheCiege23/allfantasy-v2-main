import { prisma } from '@/lib/prisma'
import { isApiSportsImageUrl } from '@/lib/player-assets/imageUrlHygiene'
import { PLAYER_IMAGE_TYPE_HEADSHOT, writePrimaryPlayerImage } from '@/lib/player-assets/playerImageStore'

/**
 * Carry a verified headshot onto the canonical player, so `/api/player/resolve-headshot`
 * serves it from its `PlayerImage` cache and `Player.imageUrl` agrees with `SportsPlayer`.
 *
 * The caller supplies a `playerId` it reached through a provider IDENTITY row — never a name
 * match. That is the whole safety argument, so it is the caller's job, not this function's.
 *
 * `Player.imageUrl` is overwritten only when it is empty, an api-sports URL (very often that
 * provider's stock "no photo" picture), or exactly `previousUrl` — the value the caller's own
 * source row held. A different image came from somewhere else and is not ours to replace.
 * The `PlayerImage` primary is always written: it is history-keeping, and a verified image
 * reached by identity is the best primary available.
 *
 * Best-effort: the caller's own row write has already landed, so a failure here is logged
 * and swallowed rather than counted as that row failing.
 */
export async function writeCanonicalHeadshot(args: {
  playerId: string
  sportKey: string
  url: string
  previousUrl: string | null
  provider: string
  logTag: string
}): Promise<void> {
  try {
    const player = await prisma.player.findUnique({ where: { id: args.playerId }, select: { imageUrl: true } })
    if (!player) return
    const current = player.imageUrl
    if (!current || isApiSportsImageUrl(current) || current === args.previousUrl) {
      await prisma.player.update({ where: { id: args.playerId }, data: { imageUrl: args.url } })
    }
    await writePrimaryPlayerImage({
      playerId: args.playerId,
      sportKey: args.sportKey,
      imageType: PLAYER_IMAGE_TYPE_HEADSHOT,
      url: args.url,
      provider: args.provider,
      confidence: 1,
    })
  } catch (err) {
    console.warn(`[${args.logTag}] canonical write failed:`, err instanceof Error ? err.message : String(err))
  }
}
