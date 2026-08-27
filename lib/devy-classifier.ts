import { prisma } from '@/lib/prisma'

export interface ExternalNflPlayer {
  name: string
  team: string
  position?: string
  draftYear?: number
  draftRound?: number
  draftPick?: number
  sleeperId?: string
}

export interface ExternalNcaaPlayer {
  name: string
  position: string
  team: string
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '')
}

export async function syncDevyClassification(
  nflRoster: ExternalNflPlayer[],
  ncaaPlayers: ExternalNcaaPlayer[]
): Promise<{ graduated: number; reclassified: number; unchanged: number; errors: string[] }> {
  let graduated = 0
  let reclassified = 0
  let unchanged = 0
  const errors: string[] = []

  const nflByNamePos = new Map<string, ExternalNflPlayer>()
  const nflByName = new Map<string, ExternalNflPlayer>()
  for (const p of nflRoster) {
    const key = normalizeName(p.name)
    if (key.length >= 3) {
      nflByName.set(key, p)
      if (p.position) nflByNamePos.set(`${key}|${p.position}`, p)
    }
  }

  const ncaaByNamePos = new Map<string, ExternalNcaaPlayer>()
  const ncaaByName = new Map<string, ExternalNcaaPlayer>()
  for (const p of ncaaPlayers) {
    const key = normalizeName(p.name)
    if (key.length >= 3) {
      ncaaByName.set(key, p)
      if (p.position) ncaaByNamePos.set(`${key}|${p.position}`, p)
    }
  }

  const allPlayers = await prisma.devyPlayer.findMany()

  for (const player of allPlayers) {
    const key = normalizeName(player.name)
    const posKey = `${key}|${player.position}`

    const nflMatch = nflByNamePos.get(posKey) || nflByName.get(key)
    const ncaaMatch = ncaaByNamePos.get(posKey) || ncaaByName.get(key)

    if (nflMatch) {
      if (player.graduatedToNFL && player.league === 'NFL') {
        unchanged++
        continue
      }

      try {
        await prisma.devyPlayer.update({
          where: { id: player.id },
          data: {
            league: 'NFL',
            devyEligible: false,
            graduatedToNFL: true,
            nflTeam: nflMatch.team || player.nflTeam,
            sleeperId: nflMatch.sleeperId || player.sleeperId,
            draftYear: nflMatch.draftYear ?? player.draftYear,
            draftRound: nflMatch.draftRound ?? player.draftRound,
            draftPick: nflMatch.draftPick ?? player.draftPick,
            lastClassifiedAt: new Date(),
            lastSyncedAt: new Date(),
          },
        })
        graduated++
        console.log(`[DevyClassifier] Graduated: ${player.name} (${player.school}) → ${nflMatch.team}`)
      } catch (err: any) {
        errors.push(`Graduate failed ${player.name}: ${err.message?.slice(0, 100)}`)
      }
      continue
    }

    if (ncaaMatch) {
      if (player.league === 'NCAA' && player.devyEligible && !player.graduatedToNFL) {
        unchanged++
        continue
      }

      try {
        await prisma.devyPlayer.update({
          where: { id: player.id },
          data: {
            league: 'NCAA',
            devyEligible: true,
            graduatedToNFL: false,
            nflTeam: null,
            lastClassifiedAt: new Date(),
            lastSyncedAt: new Date(),
          },
        })
        reclassified++
      } catch (err: any) {
        errors.push(`Reclassify failed ${player.name}: ${err.message?.slice(0, 100)}`)
      }
      continue
    }

    unchanged++
  }

  return { graduated, reclassified, unchanged, errors }
}

export async function autoGraduateOnDraft(draftedPlayers: Array<{
  name: string
  position: string
  team: string
  round: number
  pick: number
  draftYear: number
}>): Promise<{ graduated: number; skipped: string[]; errors: string[] }> {
  let graduated = 0
  const skipped: string[] = []
  const errors: string[] = []

  for (const drafted of draftedPlayers) {
    const key = normalizeName(drafted.name)
    if (key.length < 3) continue

    try {
      const candidates = await prisma.devyPlayer.findMany({
        where: {
          normalizedName: key,
          devyEligible: true,
          graduatedToNFL: false,
        },
      })

      const positionMatches = candidates.filter(c => c.position === drafted.position)
      const player = positionMatches.length === 1 ? positionMatches[0] : null

      if (!player) {
        if (candidates.length === 1 && !drafted.position) {
          const singleMatch = candidates[0]
          await prisma.devyPlayer.update({
            where: { id: singleMatch.id },
            data: {
              league: 'NFL',
              devyEligible: false,
              graduatedToNFL: true,
              nflTeam: drafted.team,
              draftYear: drafted.draftYear,
              draftRound: drafted.round,
              draftPick: drafted.pick,
              lastClassifiedAt: new Date(),
              lastSyncedAt: new Date(),
            },
          })
          graduated++
          console.log(`[DevyClassifier] Draft graduated (single match): ${singleMatch.name} → ${drafted.team} (Rd ${drafted.round}, Pk ${drafted.pick})`)
        } else if (positionMatches.length > 1) {
          skipped.push(`${drafted.name} (${drafted.position}) — ${positionMatches.length} ambiguous matches`)
          console.warn(`[DevyClassifier] Ambiguous match skipped: ${drafted.name} (${positionMatches.length} candidates)`)
        } else {
          skipped.push(`${drafted.name} (${drafted.position}) — no eligible match found`)
        }
        continue
      }

      await prisma.devyPlayer.update({
        where: { id: player.id },
        data: {
          league: 'NFL',
          devyEligible: false,
          graduatedToNFL: true,
          nflTeam: drafted.team,
          draftYear: drafted.draftYear,
          draftRound: drafted.round,
          draftPick: drafted.pick,
          lastClassifiedAt: new Date(),
          lastSyncedAt: new Date(),
        },
      })
      graduated++
      console.log(`[DevyClassifier] Draft graduated: ${player.name} (${player.school}) → ${drafted.team} (Rd ${drafted.round}, Pk ${drafted.pick})`)
    } catch (err: any) {
      errors.push(`Draft graduate failed ${drafted.name}: ${err.message?.slice(0, 100)}`)
    }
  }

  return { graduated, skipped, errors }
}

export async function getDevyEligibleOnly(): Promise<any[]> {
  return prisma.devyPlayer.findMany({
    where: {
      league: 'NCAA',
      devyEligible: true,
      graduatedToNFL: false,
    },
    // draftProjectionScore, not devyValue: the latter is a position-and-class
    // lookup that is 0 for most of the pool, so it ranked the eligible board by
    // little more than position. See lib/devy/devyValueBoard.ts.
    orderBy: [{ draftProjectionScore: 'desc' }, { devyValue: 'desc' }],
  })
}

export async function isPlayerGraduated(playerName: string): Promise<boolean> {
  const key = normalizeName(playerName)
  const player = await prisma.devyPlayer.findFirst({
    where: {
      normalizedName: { contains: key.replace(/\s+/g, '') },
    },
  })
  return player?.graduatedToNFL === true
}
