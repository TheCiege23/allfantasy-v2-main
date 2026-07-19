/* eslint-env node */
/**
 * Manual player-image sync.
 *
 * This script used to carry its own copy of the provider logic (TheSportsDB → API-Sports)
 * and its own `PlayerImage` write. That write was dead code: it passed a `source` field the
 * model does not have and omitted the required `sportKey`/`imageType`, so every call threw
 * `Argument 'sportKey' is missing` into a bare `catch {}` and `sports_core_player_images`
 * stayed permanently empty.
 *
 * It is now a thin CLI over the same resolver and write-through store used by
 * `/api/cron/sync-player-images`, so the manual and scheduled paths cannot drift. Routine
 * refreshes happen on the cron; reach for this when backfilling or debugging a single sport.
 *
 * Usage:
 *   tsx scripts/sync-player-images.ts [--sport NFL] [--limit 50] [--dry-run]
 */

import { prisma } from '@/lib/prisma'
import { createBatchPlayerHeadshotResolver } from '@/lib/player-assets/resolvePlayerHeadshot'

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`)
  return idx >= 0 && process.argv[idx + 1] ? String(process.argv[idx + 1]) : fallback
}

async function syncPlayerImages() {
  const sport = arg('sport', 'NFL').toUpperCase()
  const limit = Math.max(Number(arg('limit', '50')) || 50, 1)
  const dryRun = process.argv.includes('--dry-run')

  // Phase 2: canonical-first. `player.id` here is `Player.id`, so the write-through keys
  // PlayerImage by the canonical id rather than the legacy SportsPlayer.id.
  const players = await prisma.player.findMany({
    where: { sport, imageUrl: null },
    take: limit,
    orderBy: { lastSyncedAt: 'asc' },
    select: { id: true, name: true, team: true, sport: true, position: true, providerIds: true },
  })

  console.log(`Found ${players.length} canonical ${sport} players without images${dryRun ? ' (dry run)' : ''}`)
  if (dryRun || players.length === 0) return

  const resolver = await createBatchPlayerHeadshotResolver({ sport })
  let successCount = 0
  let failCount = 0

  for (const player of players) {
    try {
      // resolve() performs the canonical PlayerImage write-through internally.
      const result = await resolver.resolve({
        name: player.name,
        sport: player.sport,
        team: player.team,
        position: player.position,
        playerId: player.id,
      })

      if (result.imageUrl) {
        await prisma.player.update({
          where: { id: player.id },
          data: { imageUrl: result.imageUrl, lastSeenAt: new Date() },
        })
        // Legacy mirror via providerIds, kept in step with the cron until Phase 3.
        const providerIds = (player.providerIds ?? {}) as Record<string, unknown>
        for (const [source, externalId] of Object.entries(providerIds)) {
          if (typeof externalId !== 'string' || !externalId) continue
          await prisma.sportsPlayer.updateMany({
            where: { sport: player.sport, source, externalId },
            data: { imageUrl: result.imageUrl },
          })
        }
        successCount++
        console.log(`SUCCESS ${player.name} [${result.source}]: ${result.imageUrl}`)
      } else {
        failCount++
        console.log(`FAIL ${player.name}: No image found`)
      }
    } catch (error) {
      console.error(`Error processing ${player.name}:`, error)
      failCount++
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  console.log(`Sync complete!  Success: ${successCount}  Failed: ${failCount}`)
}

syncPlayerImages()
  .then(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
  .catch(async (error) => {
    console.error('Fatal error:', error)
    await prisma.$disconnect()
    process.exit(1)
  })
