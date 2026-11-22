/**
 * sync-rookies-from-sleeper.ts
 *
 * One-time (and recurring) script to pull the current NFL draft class from the
 * Sleeper player registry and upsert them into SportsPlayer so that they appear
 * in the redraft draft pool. Also graduates DevyPlayer records to NFL when a
 * matching Sleeper entry has an assigned NFL team.
 *
 * Run:
 *   npx tsx scripts/sync-rookies-from-sleeper.ts
 *   npx tsx scripts/sync-rookies-from-sleeper.ts --all   # sync ALL NFL players, not just rookies
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { isSleeperPlaceholderName } from '../lib/sleeper/placeholderPlayers'

const prisma = new PrismaClient()

const SLEEPER_API = 'https://api.sleeper.app/v1'
const BATCH_SIZE = 100
const EXPIRES_DAYS = 7

// Fantasy-relevant positions for the NFL draft pool
const SKILL_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'IDP', 'DL', 'LB', 'DB'])

interface SleeperRawPlayer {
  player_id: string
  full_name?: string
  first_name?: string
  last_name?: string
  position?: string
  team?: string
  age?: number
  years_exp?: number
  injury_status?: string
  status?: string
  fantasy_positions?: string[]
}

function normPos(pos: string | undefined): string {
  const p = String(pos ?? '').trim().toUpperCase()
  if (!p || p === 'NULL' || p === 'UNDEFINED') return 'FLEX'
  return p
}

function normTeam(team: string | undefined): string | null {
  const t = String(team ?? '').trim().toUpperCase()
  return t && t !== 'NULL' && t !== 'FA' ? t : null
}

function derivedStatus(p: SleeperRawPlayer): string {
  if (p.injury_status && p.injury_status.trim()) return p.injury_status.trim()
  if (p.status && p.status.trim()) return p.status.trim()
  return normTeam(p.team) ? 'Active' : 'FA'
}

async function main() {
  const rookieOnly = !process.argv.includes('--all')
  console.log(`[sync-rookies] mode=${rookieOnly ? 'rookies-only (years_exp=0)' : 'all NFL players'}`)

  console.log('[sync-rookies] Fetching Sleeper /players/nfl …')
  const res = await fetch(`${SLEEPER_API}/players/nfl`, {
    headers: { 'Accept': 'application/json' },
    // bypass any local in-process cache — this script runs outside Next.js
  })
  if (!res.ok) throw new Error(`Sleeper returned ${res.status}`)
  const raw: Record<string, SleeperRawPlayer> = await res.json()

  const players = Object.entries(raw)
    .map(([id, p]) => ({ ...p, player_id: id }))
    .filter((p) => {
      const pos = normPos(p.position)
      if (pos === 'FLEX' && !p.fantasy_positions?.length) return false
      if (!p.full_name && !p.first_name) return false
      // Sleeper's retired-duplicate and voided ids are not players.
      if (isSleeperPlaceholderName((p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`).trim())) return false
      if (rookieOnly) {
        const ye = p.years_exp
        return typeof ye === 'number' && ye === 0
      }
      return true
    })

  console.log(`[sync-rookies] ${players.length} players to sync`)

  const expiresAt = new Date(Date.now() + EXPIRES_DAYS * 24 * 60 * 60 * 1000)
  const fetchedAt = new Date()

  let upserted = 0
  let graduated = 0

  // Process in batches
  for (let i = 0; i < players.length; i += BATCH_SIZE) {
    const batch = players.slice(i, i + BATCH_SIZE)

    await Promise.all(
      batch.map(async (p) => {
        const fullName = (p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()).trim()
        if (!fullName) return

        const pos = normPos(p.position)
        const team = normTeam(p.team)
        const imageUrl = `https://sleepercdn.com/content/nfl/players/thumb/${p.player_id}.jpg`
        const externalId = `sleeper:${p.player_id}`

        await prisma.sportsPlayer.upsert({
          where: { sport_externalId_source: { sport: 'NFL', externalId, source: 'sleeper' } },
          create: {
            sport: 'NFL',
            externalId,
            name: fullName,
            position: pos,
            team,
            age: typeof p.age === 'number' ? p.age : null,
            imageUrl,
            sleeperId: p.player_id,
            status: derivedStatus(p),
            source: 'sleeper',
            fetchedAt,
            expiresAt,
          },
          update: {
            name: fullName,
            position: pos,
            team,
            age: typeof p.age === 'number' ? p.age : null,
            imageUrl,
            sleeperId: p.player_id,
            status: derivedStatus(p),
            fetchedAt,
            expiresAt,
          },
        })
        upserted++

        // Graduate DevyPlayer entries that now have an NFL team assignment
        if (team) {
          const normName = fullName.trim().toLowerCase()
          const devyMatch = await prisma.devyPlayer.findFirst({
            where: {
              name: { equals: fullName, mode: 'insensitive' },
              graduatedToNFL: false,
            },
          })
          if (devyMatch) {
            await prisma.devyPlayer.update({
              where: { id: devyMatch.id },
              data: { graduatedToNFL: true, nflTeam: team },
            })
            console.log(`  ↑ Graduated DevyPlayer: ${fullName} → ${team}`)
            graduated++
            void normName // suppress unused warning
          }
        }
      }),
    )

    if (i % 1000 === 0 && i > 0) {
      console.log(`  … ${i}/${players.length} processed`)
    }
  }

  console.log(`\n[sync-rookies] Done.`)
  console.log(`  SportsPlayer upserted: ${upserted}`)
  console.log(`  DevyPlayer graduated:  ${graduated}`)

  // Print a summary of the rookies we now have
  if (rookieOnly) {
    const rookieCount = await prisma.sportsPlayer.count({
      where: { sport: 'NFL', source: 'sleeper', externalId: { startsWith: 'sleeper:' } },
    })
    console.log(`  Total Sleeper NFL rows in DB: ${rookieCount}`)
  }
}

main()
  .catch((err) => { console.error('[sync-rookies] Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
