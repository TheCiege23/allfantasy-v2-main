import { prisma } from "../prisma"
import { currentFantasySeason } from "@/lib/core-app/connectLeague"

interface PlayerProjection {
  playerId: string
  playerName: string
  position: string
  team: string
  projectedPoints: number
  isRookie: boolean
  confidenceScore: number
  factors: {
    baseProjection: number
    opponentAdjustment: number
    offensiveLineAdjustment: number
    qbAdjustment: number
    coachingAdjustment: number
    schemeAdjustment: number
    injuryAdjustment: number
    weatherAdjustment: number
  }
}

interface RookieCollegeStats {
  passingYards: number
  passingTDs: number
  interceptions: number
  rushingYards: number
  rushingTDs: number
  receptions: number
  receivingYards: number
  receivingTDs: number
  gamesPlayed: number
}

interface TeamContext {
  offLineRank: number
  qbRank: number
  coachRank: number
  passRank: number
  rushRank: number
  passDefenseRank: number
  rushDefenseRank: number
  scheme: string
}

export class ProjectionEngine {
  /**
   * Read from the clock on each use. Was the literal 2025, so through the 2026 season every
   * `team_rankings` lookup asked for last year's row (fixed 2026-10-12). The class has no callers
   * today (see lib/af-projections/types.ts); this only stops it being wrong if one appears.
   */
  private get currentSeason(): number {
    return currentFantasySeason(new Date())
  }
  
  /**
   * Calculate rookie projection from college stats + team context
   */
  async getRookieProjection(
    playerName: string,
    position: string,
    team: string,
    collegeStats: RookieCollegeStats
  ): Promise<number> {
    // 1. Base projection from college stats
    let baseProjection = await this.calculateCollegeBase(playerName, position, collegeStats)
    
    // 2. Get team context
    const teamContext = await this.getTeamContext(team)
    
    // 3. Apply team factors
    let finalProjection = baseProjection
    
    // Offensive line adjustment
    if (teamContext?.offLineRank) {
      const olAdjustment = ((32 - teamContext.offLineRank) / 32) * 0.15
      finalProjection += baseProjection * olAdjustment
    }
    
    // QB adjustment (for WRs and TEs)
    if (teamContext?.qbRank && (position === 'WR' || position === 'TE')) {
      const qbAdjustment = ((32 - teamContext.qbRank) / 32) * 0.10
      finalProjection += baseProjection * qbAdjustment
    }
    
    // Scheme adjustment
    if (teamContext?.scheme) {
      const schemeMultipliers: Record<string, Record<string, number>> = {
        'air_raid': { 'QB': 1.2, 'WR': 1.3, 'RB': 0.7, 'TE': 0.9 },
        'west_coast': { 'QB': 1.1, 'WR': 1.1, 'RB': 0.9, 'TE': 1.2 },
        'spread': { 'QB': 1.3, 'WR': 1.2, 'RB': 0.8, 'TE': 1.0 },
        'pro_style': { 'QB': 1.0, 'WR': 1.0, 'RB': 1.1, 'TE': 1.1 },
        'zone_run': { 'QB': 0.9, 'WR': 0.9, 'RB': 1.3, 'TE': 0.9 },
      }
      const schemeMultiplier = schemeMultipliers[teamContext.scheme]?.[position] || 1.0
      finalProjection += baseProjection * (schemeMultiplier - 1)
    }
    
    // Coaching adjustment
    if (teamContext?.coachRank) {
      const coachAdjustment = ((32 - teamContext.coachRank) / 32) * 0.08
      finalProjection += baseProjection * coachAdjustment
    }
    
    return Math.round(finalProjection * 10) / 10
  }
  
  /**
   * Calculate veteran projection from pro stats + team context
   */
  async getVeteranProjection(
    playerId: string,
    playerName: string,
    position: string,
    team: string
  ): Promise<number> {
    // 1. Get historical pro stats
    const proStats = await this.getProStats(playerId)
    
    if (!proStats) {
      return 0
    }
    
    // 2. Calculate base from historical performance
    let baseProjection = this.calculateProBase(proStats)
    
    // 3. Get team context
    const teamContext = await this.getTeamContext(team)
    
    // 4. Apply adjustments
    let finalProjection = baseProjection
    
    if (teamContext?.offLineRank) {
      const olAdjustment = ((32 - teamContext.offLineRank) / 32) * 0.08
      finalProjection += baseProjection * olAdjustment
    }
    
    // 5. Check for injuries
    const injuryFactor = await this.getInjuryAdjustment(playerId)
    finalProjection *= injuryFactor
    
    return Math.round(finalProjection * 10) / 10
  }
  
  /**
   * Calculate base projection from college stats
   */
  private async calculateCollegeBase(
    playerName: string,
    position: string,
    stats: RookieCollegeStats
  ): Promise<number> {
    let points = 0
    const pos = position.toUpperCase()
    
    const conversionFactors = this.getCollegeConversionFactors(position)
    
    if (pos === 'QB') {
      const passPoints = (stats.passingYards / 25) + (stats.passingTDs * 4) - (stats.interceptions || 0) * 2
      const rushPoints = (stats.rushingYards / 10) + (stats.rushingTDs * 6)
      points = (passPoints + rushPoints) / stats.gamesPlayed
      points = points * (conversionFactors.QB || 0.65)
    } else if (pos === 'RB') {
      const rushPoints = (stats.rushingYards / 10) + (stats.rushingTDs * 6)
      const recPoints = (stats.receptions * 0.5) + (stats.receivingYards / 10) + (stats.receivingTDs * 6)
      points = (rushPoints + recPoints) / stats.gamesPlayed
      points = points * (conversionFactors.RB || 0.70)
    } else if (pos === 'WR' || pos === 'TE') {
      const recPoints = (stats.receptions * 0.5) + (stats.receivingYards / 10) + (stats.receivingTDs * 6)
      points = recPoints / stats.gamesPlayed
      if (pos === 'TE') {
        points = points * (conversionFactors.TE || 0.75)
      } else {
        points = points * (conversionFactors.WR || 0.75)
      }
    }
    
    // Draft pick bonus
    const draftBonus = await this.getDraftPickBonus(playerName)
    points = points * (1 + draftBonus)
    
    return points
  }
  
  /**
   * Get college-to-NFL conversion factors by position
   */
  private getCollegeConversionFactors(position: string): Record<string, number> {
    return {
      'QB': 0.65,
      'RB': 0.70,
      'WR': 0.75,
      'TE': 0.75,
    }
  }
  
  /**
   * Get draft pick bonus (higher pick = more likely to succeed)
   */
  private async getDraftPickBonus(playerName: string): Promise<number> {
    try {
      const devyPlayer = await prisma.devyPlayer.findFirst({
        where: {
          name: {
            contains: playerName,
            mode: 'insensitive',
          },
        },
        select: {
          draftRound: true,
          draftPick: true,
        },
      })
      
      if (devyPlayer?.draftRound) {
        if (devyPlayer.draftRound === 1) return 0.15
        if (devyPlayer.draftRound === 2) return 0.10
        if (devyPlayer.draftRound === 3) return 0.05
      }
    } catch (error) {}
    
    return 0
  }
  
  /**
   * Get team context (offensive line, QB, coaching, scheme)
   */
  private async getTeamContext(team: string): Promise<TeamContext | null> {
    try {
      const teamRanking = await prisma.$queryRaw`
        SELECT off_line_rank, qb_rank, coach_rank, pass_rank, rush_rank, 
               pass_defense_rank, rush_defense_rank, scheme
        FROM team_rankings
        WHERE team = ${team}
          AND sport = 'NFL'
          AND season = ${this.currentSeason}
        LIMIT 1
      ` as any[]
      
      if (teamRanking && teamRanking.length > 0) {
        return {
          offLineRank: teamRanking[0].off_line_rank || 16,
          qbRank: teamRanking[0].qb_rank || 16,
          coachRank: teamRanking[0].coach_rank || 16,
          passRank: teamRanking[0].pass_rank || 16,
          rushRank: teamRanking[0].rush_rank || 16,
          passDefenseRank: teamRanking[0].pass_defense_rank || 16,
          rushDefenseRank: teamRanking[0].rush_defense_rank || 16,
          scheme: teamRanking[0].scheme || 'pro_style',
        }
      }
    } catch (error) {
      console.error(`Failed to get team context for ${team}:`, error)
    }
    
    return null
  }
  
  /**
   * Get pro stats for veteran players
   */
  private async getProStats(playerId: string): Promise<any> {
    try {
      const stats = await prisma.$queryRaw`
        SELECT fantasy_points, games_played, season_key
        FROM player_season_stats
        WHERE player_id = ${playerId}
          AND sport = 'NFL'
        ORDER BY season_key DESC
        LIMIT 2
      ` as any[]
      
      if (stats && stats.length > 0) {
        let totalPoints = 0
        let totalWeight = 0
        
        stats.forEach((stat: any, index: number) => {
          const weight = 1 + (stats.length - index - 1) * 0.5
          const games = stat.games_played || 1
          const ppg = (stat.fantasy_points || 0) / games
          totalPoints += ppg * weight
          totalWeight += weight
        })
        
        return {
          ppg: totalPoints / totalWeight,
          gamesPlayed: stats.reduce((sum: number, s: any) => sum + (s.games_played || 0), 0),
          seasons: stats.length,
        }
      }
    } catch (error) {
      console.error(`Failed to get pro stats for player ${playerId}:`, error)
    }
    
    return null
  }
  
  /**
   * Calculate base from pro stats
   */
  private calculateProBase(proStats: any): number {
    if (!proStats) return 0
    return proStats.ppg || 0
  }
  
  /**
   * Get injury adjustment factor
   */
  private async getInjuryAdjustment(playerId: string): Promise<number> {
    try {
      const injury = await prisma.$queryRaw`
        SELECT missed_games, return_week
        FROM injury_adjustments
        WHERE player_id = ${playerId}
          AND sport = 'NFL'
          AND season = ${this.currentSeason}
        LIMIT 1
      ` as any[]
      
      if (injury && injury.length > 0) {
        const missed = injury[0].missed_games || 0
        if (missed > 0) {
          return 1 - (missed * 0.02)
        }
      }
    } catch (error) {}
    
    return 1.0
  }
  
  /**
   * Get opponent adjustment for a specific week
   */
  async getOpponentAdjustment(
    team: string,
    opponent: string,
    week: number
  ): Promise<number> {
    try {
      const opponentContext = await this.getTeamContext(opponent)
      
      if (!opponentContext) return 0
      
      const avgDefenseRank = (opponentContext.passDefenseRank + opponentContext.rushDefenseRank) / 2
      const adjustment = ((32 - avgDefenseRank) / 32) * 0.15
      
      return adjustment
    } catch (error) {
      return 0
    }
  }
}