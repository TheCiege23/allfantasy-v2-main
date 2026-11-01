import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeLockTeam } from '@/lib/redraft/lineupLock'
import { resolveDailySportSeasonStart } from '@/lib/season-week/dailySportSeasonStarts'

type ScoredGame = { homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null }
type TeamRate = { games: number; scored: number; allowed: number }
export type StrengthAdjustment = { factor: number; opponents: number; sampleGames: number; source: string }

/** A bounded real-score proxy; it is not position-specific fantasy points allowed. */
export function opponentScoreAdjustment(args: { sport: string; position: string | null;
  opponents: string[]; games: ScoredGame[] }): StrengthAdjustment | null {
  const sport = args.sport.toUpperCase()
  if (!['NBA', 'NHL', 'MLB'].includes(sport) || !args.opponents.length) return null
  const rates = new Map<string, TeamRate>()
  let totalScore = 0
  let totalGames = 0
  for (const game of args.games) {
    if (game.homeScore == null || game.awayScore == null || game.homeScore < 0 || game.awayScore < 0) continue
    const home = normalizeLockTeam(sport, game.homeTeam)
    const away = normalizeLockTeam(sport, game.awayTeam)
    if (!home || !away || home === away) continue
    const put = (key: string, scored: number, allowed: number) => {
      const row = rates.get(key) ?? { games: 0, scored: 0, allowed: 0 }
      row.games++; row.scored += scored; row.allowed += allowed
      rates.set(key, row)
    }
    put(home, game.homeScore, game.awayScore)
    put(away, game.awayScore, game.homeScore)
    totalScore += game.homeScore + game.awayScore
    totalGames++
  }
  if (totalGames < 20) return null
  const leagueMean = totalScore / (2 * totalGames)
  if (leagueMean <= 0) return null
  const defensiveRole = sport === 'MLB' ? /^(P|SP|RP)$/.test(String(args.position ?? '').toUpperCase())
    : sport === 'NHL' && String(args.position ?? '').toUpperCase() === 'G'
  let factorSum = 0
  let sampleGames = 0
  for (const opponent of args.opponents) {
    const rate = rates.get(normalizeLockTeam(sport, opponent))
    if (!rate || rate.games < 5) return null
    // Hitters and skaters benefit from a defense conceding more. Pitchers and goalies
    // face more difficulty when an opponent scores more. No speculative cross-sport mapping.
    const observed = (defensiveRole ? rate.scored : rate.allowed) / rate.games
    factorSum += Math.max(0.9, Math.min(1.1, defensiveRole ? leagueMean / Math.max(observed, 0.01) : observed / leagueMean))
    sampleGames += rate.games
  }
  return { factor: factorSum / args.opponents.length, opponents: args.opponents.length,
    sampleGames, source: 'completed TheSportsDB real-game scores' }
}

export async function loadOpponentScoreAdjustments(args: { sport: string; season: number; now: Date;
  players: Array<{ position: string | null; opponents: string[] }> }): Promise<Array<StrengthAdjustment | null>> {
  const sport = args.sport.toUpperCase()
  const opener = resolveDailySportSeasonStart(sport, args.season)
  if (!opener || !['NBA', 'NHL', 'MLB'].includes(sport)) return args.players.map(() => null)
  const games = await prisma.sportsGame.findMany({ where: { sport, season: args.season, source: 'thesportsdb',
    startTime: { gte: new Date(opener), lte: args.now }, status: { in: ['FT', 'AOT', 'AP'] },
    homeScore: { not: null }, awayScore: { not: null }, OR: [{ seasonType: 'regular' }, { seasonType: null }] },
  select: { homeTeam: true, awayTeam: true, homeScore: true, awayScore: true }, take: 3000 })
  return args.players.map((player) => opponentScoreAdjustment({ sport, position: player.position,
    opponents: player.opponents, games }))
}
