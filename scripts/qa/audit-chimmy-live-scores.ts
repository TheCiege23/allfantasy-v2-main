import { prisma } from '@/lib/prisma'
import { fetchEspnScoreboard, resolveGameState } from '@/lib/sports-live-scores-service'

const SPORTS = ['NFL', 'NCAAF', 'NBA', 'NCAAB', 'NHL', 'MLB', 'SOCCER'] as const

async function main() {
  const seconds = Number(process.argv[2] ?? 90)
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 900) throw new Error('Choose 0–900 seconds')
  const until = Date.now() + seconds * 1000
  const prior = new Map<string, string>()
  const waiting = new Map<string, { sport: typeof SPORTS[number]; externalId: string; score: string; detectedAt: Date }>()
  const verified = new Set<string>()
  do {
    const slate = await Promise.all(SPORTS.map(async (sport) => {
      const rows = await fetchEspnScoreboard(sport)
      const inProgress = rows.filter((row) => resolveGameState(row.status) === 'in_progress')
      for (const row of rows) {
        const status = resolveGameState(row.status)
        if (status !== 'in_progress' && status !== 'final') continue
        if (row.homeScore == null || row.awayScore == null) continue
        const key = sport + ':' + row.gameId
        const score = row.awayScore + '-' + row.homeScore
        const previous = prior.get(key)
        prior.set(key, score)
        if (previous !== undefined && previous !== score && !verified.has(key)) {
          waiting.set(key, { sport, externalId: row.gameId, score, detectedAt: new Date() })
        }
      }
      return { sport, games: rows.length, inProgress: inProgress.length }
    }))
    for (const [key, change] of waiting) {
      const { sport, externalId, score, detectedAt } = change
      const row = await prisma.sportsGame.findUnique({
        where: { sport_externalId_source: { sport, externalId, source: 'espn_live' } },
        select: { homeScore: true, awayScore: true, fetchedAt: true },
      })
      if (!row || row.homeScore == null || row.awayScore == null ||
          row.awayScore + '-' + row.homeScore !== score || Date.now() - row.fetchedAt.getTime() > 120_000) continue
      verified.add(key)
      waiting.delete(key)
      console.log(JSON.stringify({ event: 'confirmed_score_change', sport, externalId, score, detectedAt, persistedAt: row.fetchedAt }))
    }
    console.log(JSON.stringify({ at: new Date(), slate, pendingScoreChanges: waiting.size, verifiedScoreChanges: verified.size }))
    const remaining = until - Date.now()
    if (remaining <= 0 || !slate.some((sport) => sport.inProgress) && waiting.size === 0) break
    await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, remaining)))
  } while (Date.now() <= until)
}
main().catch(() => { console.error('Live score audit failed'); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
